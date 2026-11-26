import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { newId } from './article.js'
import { feishuImageUrls } from './markdown-images.js'

export function coverRuns(article) {
  if (article.coverRuns) return article.coverRuns
  return [...(article.coverHistory ?? []), article.cover].filter(Boolean).map(cover => ({
    ...cover, count: 1, format: 'png', images: [{ id: cover.id }], status: 'succeeded',
  }))
}

function fitTitle(base, suffix, max = 80) {
  let out = ''
  for (const ch of base) {
    if (out.length + ch.length + suffix.length > max) break
    out += ch
  }
  return out + suffix
}

function copyTitle(article) {
  const title = String(article.title ?? '').trim()
  if (!title) return ''
  return fitTitle(title, '（副本）')
}

async function copyAssets(root, directory, entries, allowedFormats) {
  const copied = []
  const ids = new Map()
  const formats = new Map()
  try {
    for (const { id: oldId, format } of entries) {
      if (ids.has(oldId)) {
        if (formats.get(oldId) !== format) {
          throw Object.assign(new Error('同一个资源 ID 对应了不同格式，未创建副本。'), { status: 409 })
        }
        continue
      }
      if (!/^[a-f0-9-]{36}$/.test(oldId ?? '') || !allowedFormats.test(format ?? '')) {
        throw Object.assign(new Error('原稿包含无效的资源记录，未创建副本。'), { status: 409 })
      }
      await mkdir(join(root, directory), { recursive: true, mode: 0o700 })
      const id = randomUUID()
      const target = join(root, directory, `${id}.${format}`)
      try {
        await copyFile(join(root, directory, `${oldId}.${format}`), target, constants.COPYFILE_EXCL)
      } catch (err) {
        throw Object.assign(new Error(err.code === 'ENOENT' ? '原稿的资源文件缺失，未创建副本。' : `资源复制失败：${err.message}`), { status: err.code === 'ENOENT' ? 409 : 500, cause: err })
      }
      copied.push(target)
      ids.set(oldId, id)
      formats.set(oldId, format)
    }
  } catch (err) {
    await Promise.all(copied.map(file => rm(file, { force: true }).catch(() => {})))
    throw err
  }
  return { ids, cleanup: () => Promise.all(copied.map(file => rm(file, { force: true }).catch(() => {}))) }
}

export async function duplicateArticle(root, source, options = {}) {
  const runs = coverRuns(source)
  const covers = await copyAssets(
    root,
    'covers',
    runs.flatMap(run => (run.images ?? []).map(image => ({ id: image.id, format: run.format ?? 'png' }))),
    /^(?:png|jpeg)$/,
  )
  let diagrams
  try {
    diagrams = await copyAssets(
      root,
      'inline-images',
      (source.inlineDiagrams ?? []).filter(item => item.assetId).map(item => ({ id: item.assetId, format: item.format ?? 'png' })),
      /^png$/,
    )
  } catch (err) {
    await covers.cleanup()
    throw err
  }

  const now = new Date().toISOString()
  const article = structuredClone(source)
  const blockIds = new Map(source.blocks.map(block => [block.id, newId()]))
  Object.assign(article, {
    id: newId('a'), createdAt: now, updatedAt: now, title: copyTitle(source), hook: null,
    blocks: source.blocks.map(block => ({ ...structuredClone(block), id: blockIds.get(block.id), check: null })),
    chat: [], history: [], zhuque: { round: 0, lastAt: null }, lastView: 'paper',
    coverRuns: runs.map(run => ({
      ...structuredClone(run),
      ...(run.id ? { id: randomUUID() } : {}),
      images: (run.images ?? []).map(image => ({ ...structuredClone(image), id: covers.ids.get(image.id) })),
    })),
    cover: source.cover && covers.ids.has(source.cover.id)
      ? { ...structuredClone(source.cover), id: covers.ids.get(source.cover.id) }
      : null,
    inlineDiagrams: (source.inlineDiagrams ?? []).map(item => ({
      ...structuredClone(item), id: randomUUID(),
      anchorId: blockIds.get(item.anchorId), insertedBlockId: blockIds.get(item.insertedBlockId),
      ...(item.assetId ? { assetId: diagrams.ids.get(item.assetId) } : {}),
    })),
    derivatives: {},
  })
  for (const block of article.blocks) delete block.prev
  for (const key of ['archivedAt', 'scheduledFor', 'publishedAt', 'publishMarkedAt', 'imageImport', 'notice', 'inlineMessage', 'coverError', 'coverHistory', 'svgCardInsertions', 'sourceBagId', 'sourceBagPromotion']) delete article[key]
  if (options && options.sponsoredSnapshot !== undefined) {
    if (options.sponsoredSnapshot === null) delete article.sponsoredSnapshot
    else article.sponsoredSnapshot = structuredClone(options.sponsoredSnapshot)
  }
  const remainingFeishu = feishuImageUrls(article.blocks).length
  if (remainingFeishu) {
    article.imageImport = { error: '原稿还有飞书图片未转存，可以重试。', remaining: remainingFeishu }
  }
  return {
    article,
    cleanup: () => Promise.all([covers.cleanup(), diagrams.cleanup()]),
  }
}

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { generateCoverImage } from './cover.js'
import { INLINE_IMAGE_SIZES } from './cover-options.js'
import { loadInlineStyle } from './inline-skill.js'

const PNG_SIGNATURE = '89504e470d0a1a0a'
const MAX_IMAGE = 24 * 1024 * 1024

const KIND_PROMPTS = {
  concept: 'Use a centered concept with 3–5 surrounding elements. Connect them with clear directional lines so the composition explains the concept rather than decorating it.',
  flow: 'Use a left-to-right sequence or an explicit loop. Show every step in reading order with unambiguous directional arrows and no crossing lines.',
  comparison: 'Use balanced left and right groups with the same comparison dimensions on both sides. Make the key difference immediately legible.',
  architecture: 'Use a layered or grouped system diagram. Keep module responsibilities short and show the primary data or control flow from top to bottom.',
}

export async function inlineDiagramPrompt(diagram, style, { skillsDir } = {}) {
  const selected = await loadInlineStyle(style, skillsDir)
  if (!Object.hasOwn(KIND_PROMPTS, diagram?.kind)) throw Object.assign(new Error('插图类型无效。'), { status: 400 })
  return [
    selected.content,
    'Create one 16:9 landscape explanatory diagram. Use large, short Simplified Chinese labels (2–6 characters where possible), established English technical terms only when necessary, and generous clear space around every label.',
    KIND_PROMPTS[diagram.kind],
    `Diagram title: ${String(diagram.title ?? '').replace(/[\r\n]+/g, ' ').slice(0, 60)}`,
    `Content and relationships supplied by the article:\n${String(diagram.brief ?? '').slice(0, 1500)}`,
    'Use only facts, nodes, labels and relationships stated above. Do not invent numbers, prices, brands, logos, people, interface screenshots, URLs, file paths, or extra annotations. Do not add decorative paragraphs or a footer slogan. Preserve all diagram edges and labels inside the image without cropping.',
  ].join('\n\n')
}

export async function generateInlineImage(diagram, { style, provider, model, apiKey, baseUrl = '', skillsDir }, fetchImpl = fetch) {
  if (!Object.hasOwn(INLINE_IMAGE_SIZES, provider)) {
    throw Object.assign(new Error('请选择有效的生图提供方。'), { status: 400 })
  }
  const prompt = await inlineDiagramPrompt(diagram, style, { skillsDir })
  const options = {
    apiKey, model, referenceImage: null, format: 'png', resolution: INLINE_IMAGE_SIZES[provider],
    size: INLINE_IMAGE_SIZES[provider], subject: '插图',
    ...(baseUrl ? { baseUrl } : {}),
    ...(provider === 'gemini' ? { aspectRatio: '16:9' } : {}),
  }
  return generateCoverImage(provider, prompt, options, fetchImpl)
}

export async function saveInlineImage(root, image) {
  if (!Buffer.isBuffer(image) || image.length > MAX_IMAGE || image.toString('hex', 0, 8) !== PNG_SIGNATURE) {
    throw new Error('插图保存失败：需要不超过 24 MB 的有效 PNG 图片。')
  }
  const dir = join(root, 'inline-images')
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const id = randomUUID()
  const output = join(dir, `${id}.png`)
  const temporary = join(dir, `.${id}.tmp`)
  try {
    await writeFile(temporary, image, { mode: 0o600 })
    await rename(temporary, output)
    return id
  } catch (err) {
    await rm(temporary, { force: true }).catch(() => {})
    throw Object.assign(new Error(`插图保存失败：${err.message}`), { cause: err })
  }
}

export function readInlineImage(root, id, format = 'png') {
  if (!/^[a-f0-9-]{36}$/.test(id ?? '') || format !== 'png') throw new Error('无效的插图资产。')
  return readFile(join(root, 'inline-images', `${id}.png`))
}

function inlineAssetIds(diagrams) {
  return new Set((diagrams ?? []).filter(item => /^[a-f0-9-]{36}$/.test(item?.assetId ?? '') && (item.format ?? 'png') === 'png').map(item => item.assetId))
}

export async function removeInlineImages(root, diagrams) {
  const ids = inlineAssetIds(diagrams)
  const results = await Promise.allSettled([...ids].map(id => rm(join(root, 'inline-images', `${id}.png`), { force: true })))
  return results.every(result => result.status === 'fulfilled')
}

export async function removeOrphanInlineImages(root, articles) {
  const referenced = inlineAssetIds((articles ?? []).flatMap(article => article.inlineDiagrams ?? []))
  let entries
  try {
    entries = await readdir(join(root, 'inline-images'), { withFileTypes: true })
  } catch (err) {
    if (err.code === 'ENOENT') return true
    throw err
  }
  const orphaned = entries.filter(entry => {
    if (!entry.isFile()) return false
    if (/^\.[a-f0-9-]{36}\.tmp$/.test(entry.name)) return true
    return /^[a-f0-9-]{36}\.png$/.test(entry.name) && !referenced.has(entry.name.slice(0, -4))
  })
  const results = await Promise.allSettled(orphaned.map(entry => rm(join(root, 'inline-images', entry.name), { force: true })))
  return results.every(result => result.status === 'fulfilled')
}

export async function readInlineAsset(root, article, diagramId, assetId) {
  const diagram = article.inlineDiagrams?.find(item => item.id === diagramId)
  if (!diagram || diagram.assetId !== assetId || diagram.format !== 'png') {
    throw Object.assign(new Error('这篇文章没有这张插图。'), { status: 404 })
  }
  return readInlineImage(root, assetId, diagram.format)
}

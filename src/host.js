import { randomUUID } from 'node:crypto'
import { COVER_PROVIDER_META, COVER_RESOLUTIONS, COVER_FORMATS, MAX_COVER_COUNT, providerFormats, providerMeta } from './cover-options.js'
// dsh-wechat-studio host 半片：/wechat-studio/* 接口。
import { join, resolve, sep } from 'node:path'
import { readFile, rm } from 'node:fs/promises'
import { defaultSelection, listModels, modelInfo, modelOverride, modelStatus, modelVisionSupport, setModelOverride, skillSources } from './ai.js'
import { BANNER_CHOICES, BANNER_STYLES, DEFAULT_BANNER } from './banner.js'
import { blockKind, clearSchedule, correctPublishedAt, createArticle, fixPlan, HOOK_IDS, isCheckable, listMeta, markPublished, newId, revisionChanges, setSchedule, snapshot, splitMarkdown, toMarkdown, touch, undo, unpublish } from './article.js'
import { MAX_LOCAL_IMAGE, transferFeishuImages, uploadInlineImage, uploadLocalImage } from './cloudinary.js'
import { feishuImageUrls, replaceFeishuImages } from './markdown-images.js'
import { applyMarkdownReimport, planMarkdownReimport } from './markdown-reimport.js'
import { generateInlineImage, readInlineAsset, readInlineImage, removeInlineImages, removeOrphanInlineImages, saveInlineImage } from './inline-assets.js'
import { THEMES as THEME_COLORS } from '../vendor/layout/layout.js'
import { deleteDerivative, derivativesView, extractArticleImages, generateDerivative, redesignXhsCard, updateDerivative } from './derive.js'
import { toPortableMarkdown } from './derive-markdown.js'
import { DERIVE_PLATFORMS } from './derive-shared.js'
import { coverRuns, duplicateArticle } from './duplicate-article.js'
import { analyzeInlineDiagrams, DIAGRAM_KINDS, insertDiagramBlock, sourceHash } from './inline-diagrams.js'
import { loadInlineStyle, readInlineStyleCatalog } from './inline-skill.js'
import { coverDownloadName, coverPrompt, generateCoverImage, readCover, saveCover } from './cover.js'
import { findBlocked, loadCoverBlocklist } from './cover-prompt.js'
import { CUSTOM_COVER_STYLE_LIMITS, extractTemplateSlots, isCustomStyleId } from './cover-styles.js'
import {
  analyzeCustomCoverStyle,
  deleteCustomCoverStyle,
  listCoverStyles,
  previewCustomCoverStyle,
  readCustomCoverStyle,
  readCustomStylePreview,
  readDraftPreview,
  resolveCoverReferenceImage,
  resolveCoverStyle,
  saveCustomCoverStyle,
} from './custom-cover-styles.js'
import { END_MARK_STYLE_IDS, normalizeEndMark, STYLES, THEMES, detectionText, renderLayout, resolveLayoutPreferences } from './layout.js'
import { applyRule, buildInsights, EXPERIMENT_RESULTS, importData, INSIGHTS_EMPTY, previewRule } from './insights.js'
import { Pipeline } from './pipeline.js'
import { runPreflight } from './preflight.js'
import {
  addBag,
  addNote,
  batchNotes,
  clusterFreeNotes,
  deleteBag,
  deleteNotes,
  deriveLinkedArticleStatus,
  extractBriefFromRaw,
  formatBriefMarkdown,
  isPrepAssetReferenced,
  PREP_EMPTY,
  PREP_LIMITS,
  promoteBag,
  readPrepAsset,
  reconcilePrep,
  removeOrphanPrepAssets,
  resetDeletedBagLink,
  resolveSponsoredBrief,
  savePrepAsset,
  transferPromotedArticleImages,
  updateBag,
  updateNote,
} from './prep.js'
import { pdfToText } from './report.js'
import { MAX_BRIEF_FILE_BYTES, readBriefFile } from './brief-file.js'
import { cacheMpHeadImg, publicSettings, readSettings, updateSettings } from './settings.js'
import { scheduleTime as parseScheduleTime } from './schedule-time.js'
import { JsonStore, Store } from './store.js'
import { createVersionChecker } from './version.js'
import { detect } from './zhuque.js'
import { draftSvgCard, insertSvgCard, previewSvgCard } from './svg-cards.js'
import { latestCover, pushWechatDraft, verifyCredentials } from './wechat.js'
import { MAX_DIGEST, sliceUtf16Safe } from './wechat-meta.js'
import { normalizeStyleProfile } from './writing-style-shared.js'
import { analyzeWritingStyle, applyWritingStyle, previewWritingStyle, readStyleState, renderHeadlineSkill, renderWriterSkill, restoreDefaultStyle } from './writing-style.js'

const MAX_JSON = 4_000_000
const MAX_ANALYZE_JSON = 10_000_000
const MAX_PDF = 30_000_000
const MAX_IMPORT = 10_000_000
const { version: VERSION } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
function json(res, status, body) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

async function readBuffer(req, limit) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw Object.assign(new Error('内容太大'), { status: 413 })
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

async function readJson(req, limit = MAX_JSON) {
  const raw = await readBuffer(req, limit)
  if (!raw.length) return {}
  try {
    return JSON.parse(raw.toString('utf8'))
  } catch {
    throw Object.assign(new Error('请求不是有效的 JSON'), { status: 400 })
  }
}

function bannerView(article) {
  const style = article.bannerStyle ?? DEFAULT_BANNER
  const saved = article.banners?.[style]
  return { style, choices: BANNER_CHOICES.map(id => ({ id, name: BANNER_STYLES[id]?.name ?? '不要横幅' })), ready: style === 'none' || Boolean(saved), warnings: saved?.warnings ?? [], at: saved?.at ?? null }
}

async function insightsView(deps, range = 'all') {
  const [insights, state] = await Promise.all([deps.insightsStore.read(), deps.store.read()])
  return buildInsights(insights, state.articles, ['7', '30', 'all'].includes(range) ? range : 'all')
}

const prepStores = new WeakMap()
const PREP_ASSET_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const PREP_ASSET_EXT_SET = new Set(['png', 'jpg', 'gif', 'webp'])

function getPrepStore(deps) {
  if (deps.prepStore) return deps.prepStore
  if (!prepStores.has(deps.store)) {
    prepStores.set(deps.store, new JsonStore(deps.store.root, { file: 'prep.json', empty: PREP_EMPTY }))
  }
  return prepStores.get(deps.store)
}

function sortBagNotes(notes) {
  return (notes ?? []).slice().sort((a, b) => {
    const pinDiff = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))
    if (pinDiff !== 0) return pinDiff
    const timeDiff = String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''))
    if (timeDiff !== 0) return timeDiff
    return String(a.id ?? '').localeCompare(String(b.id ?? ''))
  })
}

function enrichPrepView(prepState, articles) {
  const bags = (prepState?.bags ?? []).map(bag => {
    const { status: linkedArticleStatus, article } = deriveLinkedArticleStatus(bag, articles)
    const linkedArticle = article
      ? {
          id: article.id,
          title: article.title || article.topic || '未命名文章',
          scheduledFor: article.scheduledFor ?? null,
          publishedAt: article.publishedAt ?? null,
          archivedAt: article.archivedAt ?? null,
          updatedAt: article.updatedAt ?? null,
        }
      : null
    return {
      ...bag,
      linkedArticleStatus,
      linkedArticle,
    }
  })
  return {
    v: prepState?.v ?? 1,
    bags,
    notes: prepState?.notes ?? [],
  }
}

async function prepView(prepStore, store) {
  const [prepState, articleState] = await Promise.all([prepStore.read(), store.read()])
  return enrichPrepView(prepState, articleState.articles)
}

function buildPrepPlaceholders(prepState) {
  const noteCountByBag = new Map()
  for (const note of prepState?.notes ?? []) {
    if (note?.bagId) noteCountByBag.set(note.bagId, (noteCountByBag.get(note.bagId) ?? 0) + 1)
  }
  return (prepState?.bags ?? [])
    .filter(bag => bag && !bag.archivedAt && !bag.articleId && Boolean(bag.targetDate))
    .map(bag => ({
      id: bag.id,
      title: bag.title,
      type: bag.type,
      partner: bag.type === 'sponsored' ? (bag.brief?.partner ?? '') : '',
      targetDate: bag.targetDate,
      noteCount: noteCountByBag.get(bag.id) ?? 0,
    }))
    .sort((a, b) => a.targetDate.localeCompare(b.targetDate)
      || Number(b.type === 'sponsored') - Number(a.type === 'sponsored')
      || a.id.localeCompare(b.id))
}

function buildSourceBagView(article, prepState, articles) {
  if (!article?.sourceBagId && !article?.sponsoredSnapshot) return null
  const bag = article.sourceBagId
    ? (prepState?.bags ?? []).find(b => b && b.id === article.sourceBagId) ?? null
    : null
  const resolvedBrief = resolveSponsoredBrief(article, prepState)
  if (bag) {
    const { status: linkedArticleStatus } = deriveLinkedArticleStatus(bag, articles)
    const notes = sortBagNotes((prepState?.notes ?? []).filter(n => n && n.bagId === bag.id))
    return {
      id: bag.id,
      title: bag.title,
      type: bag.type,
      brief: bag.type === 'sponsored' ? resolvedBrief : null,
      notes,
      linkedArticleStatus,
      exists: true,
    }
  }
  if (resolvedBrief) {
    return {
      id: article.sourceBagId ?? null,
      title: article.topic || resolvedBrief.partner || '',
      type: 'sponsored',
      brief: resolvedBrief,
      notes: [],
      linkedArticleStatus: null,
      exists: false,
    }
  }
  return {
    id: article.sourceBagId ?? null,
    title: article.topic || '',
    type: 'topic',
    brief: null,
    notes: [],
    linkedArticleStatus: null,
    exists: false,
  }
}

async function cleanupUnreferencedPrepAssets(store, prepStore, candidateImages) {
  if (!candidateImages?.length) return
  const [prepState, articleState] = await Promise.all([prepStore.read(), store.read()])
  if (store.problems.length || prepStore.problems.length) return
  const seen = new Set()
  const dir = resolve(store.root, 'prep-assets')
  for (const img of candidateImages) {
    const assetId = typeof img?.assetId === 'string' ? img.assetId.toLowerCase() : ''
    const ext = typeof img?.ext === 'string' ? img.ext.toLowerCase() : ''
    if (!PREP_ASSET_UUID_RE.test(assetId) || !PREP_ASSET_EXT_SET.has(ext)) continue
    const key = `${assetId}.${ext}`
    if (seen.has(key)) continue
    seen.add(key)
    if (isPrepAssetReferenced(assetId, prepState, articleState.articles)) continue
    const target = resolve(dir, key)
    if (!target.startsWith(dir + sep)) continue
    await rm(target, { force: true }).catch(() => {})
  }
}

const imageJobs = new WeakMap()
const coverJobs = new WeakMap()
const coverStyleTestJobs = new WeakMap()
const diagramJobs = new WeakMap()
const deriveJobs = new WeakMap()
const xhsJobs = new WeakMap()

export const COVER_STYLE_TEST_JOB_TTL_MS = 30 * 60 * 1000
export const MAX_COVER_STYLE_TEST_JOB_HISTORY = 20

function testJobRegistry(store) {
  if (!coverStyleTestJobs.has(store)) coverStyleTestJobs.set(store, { jobs: new Map(), latestId: null })
  return coverStyleTestJobs.get(store)
}

export function pruneCoverStyleTestJobs(store, nowMs = Date.now()) {
  const reg = coverStyleTestJobs.get(store)
  if (!reg) return 0
  let removed = 0
  const finished = []
  for (const [id, job] of reg.jobs) {
    if (job.status === 'running') continue
    if (job.finishedAt && nowMs - job.finishedAt > COVER_STYLE_TEST_JOB_TTL_MS) {
      reg.jobs.delete(id)
      if (reg.latestId === id) reg.latestId = null
      removed++
    } else {
      finished.push(job)
    }
  }
  if (finished.length > MAX_COVER_STYLE_TEST_JOB_HISTORY) {
    finished.sort((a, b) => (a.finishedAt || 0) - (b.finishedAt || 0))
    const excess = finished.length - MAX_COVER_STYLE_TEST_JOB_HISTORY
    for (let i = 0; i < excess; i++) {
      const target = finished[i]
      reg.jobs.delete(target.jobId)
      if (reg.latestId === target.jobId) reg.latestId = null
      removed++
    }
  }
  return removed
}

function publicTestJob(job) {
  if (!job) return null
  return {
    jobId: job.jobId,
    status: job.status,
    stage: job.stage,
    ...(job.result ? { result: job.result } : {}),
    ...(job.error ? { error: job.error } : {}),
  }
}

function findRunningTestJob(store, { prune = true } = {}) {
  if (prune) pruneCoverStyleTestJobs(store)
  const reg = testJobRegistry(store)
  for (const job of reg.jobs.values()) {
    if (job.status === 'running') return job
  }
  return null
}

function activeTestJobForSummary(store) {
  pruneCoverStyleTestJobs(store)
  const running = findRunningTestJob(store, { prune: false })
  if (running) return publicTestJob(running)
  const reg = testJobRegistry(store)
  const latest = reg.latestId ? reg.jobs.get(reg.latestId) : null
  if (latest && !latest.consumed && latest.status === 'succeeded') return publicTestJob(latest)
  return null
}

function withCoverStylePreviewUrl(style) {
  if (!style || style.source !== 'custom') return style
  return {
    ...style,
    previewUrl: style.previewFile
      ? `wechat-studio/cover-styles/preview?${new URLSearchParams({ id: style.id, v: style.updatedAt || '1' })}`
      : null,
  }
}

function deriveJobSet(store) {
  if (!deriveJobs.has(store)) deriveJobs.set(store, new Set())
  return deriveJobs.get(store)
}

function xhsJobMap(store) {
  if (!xhsJobs.has(store)) xhsJobs.set(store, new Map())
  return xhsJobs.get(store)
}

function coverJobMap(store) {
  if (!coverJobs.has(store)) coverJobs.set(store, new Map())
  return coverJobs.get(store)
}

function startCover(deps, article, apiKey, options) {
  const { store, ctx, fetchImpl } = deps
  const jobs = coverJobMap(store)
  if (jobs.has(article.id)) return
  const title = article.title
  const markdown = toMarkdown(article)
  const { customStyle = null, runtimeReferenceImage = null, referenceKind = null, baseUrl = '', ...persisted } = options
  const { count, style } = persisted
  const record = {
    id: randomUUID(), title, ...persisted, createdAt: new Date().toISOString(),
    images: [], errors: [], status: 'running',
  }
  const job = { id: record.id, stage: 'prompt', count, index: 1 }
  jobs.set(article.id, job)
  const run = async () => {
    await store.update(() => {
      article.coverRuns ??= coverRuns(article)
      article.coverRuns.push(record)
      article.coverError = null
    })
    try {
      const prompt = await coverPrompt(ctx, title, markdown, style, persisted.persona, {
        hasReference: Boolean(persisted.referenceImage),
        referenceKind: referenceKind ?? (persisted.referenceImage ? 'portrait' : null),
        customStyle,
      })
      await store.update(() => { record.prompt = prompt })
      const effectiveReferenceImage = runtimeReferenceImage ?? persisted.referenceImage ?? null
      for (let index = 1; index <= count; index++) {
        Object.assign(job, { stage: 'generating', index })
        let id
        try {
          const image = await generateCoverImage(persisted.provider, prompt, { ...persisted, baseUrl, referenceImage: effectiveReferenceImage, apiKey }, fetchImpl)
          job.stage = 'saving'
          id = await saveCover(store.root, image, persisted.format)
        } catch (err) {
          const isMinimaxTimeout = persisted.provider === 'minimax' && (err.code === 'MINIMAX_TIMEOUT' || err.name === 'TimeoutError')
          const message = isMinimaxTimeout
            ? (err.code === 'MINIMAX_TIMEOUT' ? err.message : 'MiniMax 封面生成已等待 600 秒并断开，服务端仍可能完成并计费；请避免立即重复提交。')
            : (err.name === 'TimeoutError' ? '封面生成超时，请重试。' : err.message)
          await store.update(() => { record.errors.push(`第 ${index} 张：${message}`) })
          if (err.nonRetryable || isMinimaxTimeout) break
          continue
        }
        await store.update(() => { record.images.push({ id }) })
      }
    } catch (err) {
      await store.update(() => { record.errors.push(err.message) })
    }
    await store.update(() => {
      record.status = !record.images.length ? 'failed' : record.errors.length ? 'partial' : 'succeeded'
      if (record.images.length) {
        article.cover = { ...persisted, id: record.images[0].id, title, prompt: record.prompt, createdAt: record.createdAt }
      }
      article.coverError = record.errors[0] ?? null
    })
  }
  void run().catch(() => { article.coverError = '保存封面状态失败，请重试。' }).finally(() => jobs.delete(article.id))
}

function diagramJobMap(store) {
  if (!diagramJobs.has(store)) diagramJobs.set(store, new Map())
  return diagramJobs.get(store)
}

function activeInlineArticle(state, id) {
  const article = mustFind(state, id)
  if (article.archivedAt) throw Object.assign(new Error('归档稿件不能操作插图，请先恢复。'), { status: 409 })
  return article
}

function inlineRecord(article, diagramId) {
  const diagram = article.inlineDiagrams?.find(item => item.id === diagramId)
  if (!diagram) throw Object.assign(new Error('这条插图建议不存在'), { status: 404 })
  return diagram
}

function inlineAnchorOccupied(article, diagram, anchorId) {
  return article.inlineDiagrams?.some(item => item.id !== diagram.id && item.anchorId === anchorId && item.status !== 'ignored')
}

function inlineDiagramView(article, store) {
  const job = diagramJobMap(store).get(article.id)
  return (article.inlineDiagrams ?? []).map(diagram => {
    const anchorIndex = article.blocks.findIndex(block => block.id === diagram.anchorId)
    const insertedIndex = article.blocks.findIndex(block => block.id === diagram.insertedBlockId && Boolean(diagram.publicUrl) && block.text.includes(diagram.publicUrl))
    let status = diagram.status
    if (status === 'generating' && (job?.kind !== 'generate' || job.diagramId !== diagram.id)) status = 'interrupted'
    if (status === 'inserted' && insertedIndex === -1) status = diagram.assetId ? 'generated' : 'suggested'
    return {
      ...diagram,
      status,
      anchorNumber: anchorIndex === -1 ? null : anchorIndex + 1,
      anchorExcerpt: anchorIndex === -1 ? null : article.blocks[anchorIndex].text.replace(/\s+/g, ' ').slice(0, 100),
      currentAnchorHash: anchorIndex === -1 ? null : sourceHash(article.blocks[anchorIndex].text),
      stale: anchorIndex !== -1 && sourceHash(article.blocks[anchorIndex].text) !== diagram.sourceHash,
      insertedBlockNumber: insertedIndex === -1 ? null : insertedIndex + 1,
      insertedBlockExists: insertedIndex !== -1,
    }
  })
}

function inlineError(err, action, provider = null) {
  if (provider === 'minimax' && (err.code === 'MINIMAX_TIMEOUT' || err.name === 'TimeoutError')) {
    return err.code === 'MINIMAX_TIMEOUT'
      ? err.message
      : `MiniMax ${action}已等待 600 秒并断开，服务端仍可能完成并计费；请避免立即重复提交。`
  }
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return `${action}超时，请重试。`
  return err.message || `${action}失败，请重试。`
}

function startInlineJob(deps, articleId, job, run) {
  const { store } = deps
  const jobs = diagramJobMap(store)
  if (jobs.has(articleId)) throw Object.assign(new Error('这篇稿件已有一项插图任务进行中。'), { status: 409 })
  jobs.set(articleId, job)
  const execute = async () => {
    try {
      await run(job)
    } catch (err) {
      await store.update(state => {
        const article = state.articles.find(item => item.id === articleId)
        if (!article) return
        const message = inlineError(err, job.kind === 'generate' ? '插图生成' : job.kind === 'insert' ? '插图上传或插入' : '正文分析', job.provider)
        article.inlineMessage = { error: true, text: message, at: new Date().toISOString() }
        if (job.kind === 'generate') {
          const diagram = article.inlineDiagrams?.find(item => item.id === job.diagramId)
          if (diagram) {
            diagram.status = 'failed'
            diagram.error = message
          }
        }
      }).catch(() => {})
    } finally {
      jobs.delete(articleId)
    }
  }
  void execute()
}

function startInlineAnalysis(deps, articleId, blockId) {
  startInlineJob(deps, articleId, { kind: 'analyze', stage: 'analyzing', blockId }, async () => {
    const result = await analyzeInlineDiagrams(deps.ctx, deps.store, {
      id: articleId, blockId, skillsDir: join(deps.store.root, 'skills'),
    })
    await deps.store.update(state => {
      const article = state.articles.find(item => item.id === articleId)
      if (!article) return
      const text = result.stale ? '分析期间正文有改动，本次结果已丢弃，请重新分析。'
        : result.empty ? '暂时没有值得配图的位置。'
          : result.count ? `已更新 ${result.count} 条插图建议。` : '没有新增建议，已生成的图片和忽略项均已保留。'
      article.inlineMessage = { error: false, text, at: new Date().toISOString() }
    })
  })
}

function startInlineGeneration(deps, articleId, diagramId, style, settings) {
  const provider = settings.coverProvider
  const meta = providerMeta(provider)
  const model = settings[meta.modelField]
  const apiKey = settings[meta.keyField]
  const baseUrl = meta.baseUrlField ? settings[meta.baseUrlField] : ''
  startInlineJob(deps, articleId, { kind: 'generate', stage: 'generating', diagramId, provider, style }, async () => {
    const diagram = await deps.store.update(state => {
      const article = activeInlineArticle(state, articleId)
      const record = inlineRecord(article, diagramId)
      record.status = 'generating'
      record.error = null
      record.style = style
      record.provider = provider
      record.model = model
      article.inlineMessage = null
      return { kind: record.kind, title: record.title, brief: record.brief }
    })
    const image = await generateInlineImage(diagram, { style, provider, model, apiKey, baseUrl, skillsDir: join(deps.store.root, 'skills') }, deps.fetchImpl)
    const assetId = await saveInlineImage(deps.store.root, image)
    let previous
    try {
      previous = await deps.store.update(state => {
        const article = activeInlineArticle(state, articleId)
        const record = inlineRecord(article, diagramId)
        const previous = record.assetId ? { assetId: record.assetId, format: record.format } : null
        Object.assign(record, { assetId, format: 'png', provider, model, style, status: 'generated', error: null, generatedAt: new Date().toISOString() })
        delete record.publicUrl
        delete record.insertedBlockId
        article.inlineMessage = { error: false, text: '插图已生成，尚未上传图床，正文没有变化。', at: new Date().toISOString() }
        return previous
      })
    } catch (err) {
      await removeInlineImages(deps.store.root, [{ assetId, format: 'png' }]).catch(() => {})
      throw err
    }
    if (previous && previous.assetId !== assetId) await removeInlineImages(deps.store.root, [previous]).catch(() => {})
  })
}

function startInlineInsertion(deps, articleId, diagramId, expectedAnchorHash, acceptStale, cloudinary) {
  startInlineJob(deps, articleId, { kind: 'insert', stage: 'uploading', diagramId }, async job => {
    const prepared = await deps.store.read().then(state => {
      const article = activeInlineArticle(state, articleId)
      const diagram = inlineRecord(article, diagramId)
      if (article.blocks.some(block => block.id === diagram.insertedBlockId && Boolean(diagram.publicUrl) && block.text.includes(diagram.publicUrl))) {
        return { article, diagram, existing: true }
      }
      const anchor = mustBlock(article, diagram.anchorId)
      const currentHash = sourceHash(anchor.text)
      if (currentHash !== expectedAnchorHash) throw Object.assign(new Error('目标段落已变化，请重新确认插入位置。'), { status: 409 })
      if (currentHash !== diagram.sourceHash && !acceptStale) throw Object.assign(new Error('段落已改动，请确认是否继续使用这张旧图。'), { status: 409 })
      return { article, diagram, existing: false }
    })
    if (!prepared.diagram.publicUrl && !prepared.existing) {
      const image = await readInlineImage(deps.store.root, prepared.diagram.assetId, prepared.diagram.format)
      const publicUrl = await uploadInlineImage(image, cloudinary, { articleId, assetId: prepared.diagram.assetId }, deps.fetchImpl)
      await deps.store.update(state => {
        const diagram = inlineRecord(activeInlineArticle(state, articleId), diagramId)
        if (diagram.assetId === prepared.diagram.assetId) diagram.publicUrl = publicUrl
      })
      job.stage = 'inserting'
    }
    await deps.store.update(state => {
      const article = activeInlineArticle(state, articleId)
      const result = insertDiagramBlock(article, diagramId, { expectedAnchorHash, acceptStale })
      article.inlineMessage = {
        error: false,
        text: result.idempotent ? '这张插图已经在正文中，没有重复插入。' : '插图已插入正文，可以撤销后重新插入。',
        at: new Date().toISOString(),
      }
    })
  })
}

function imageJobMap(store) {
  if (!imageJobs.has(store)) imageJobs.set(store, new Map())
  return imageJobs.get(store)
}

function startImageImport(deps, article, urls) {
  if (!urls.length) return
  const { store, fetchImpl } = deps
  const jobs = imageJobMap(store)
  if (jobs.has(article.id)) return
  const progress = { total: urls.length, done: 0 }
  jobs.set(article.id, progress)
  const replacements = new Map()
  const run = async () => {
    const settings = await readSettings(store.root)
    let error
    try {
      error = await transferFeishuImages(urls, settings.cloudinary, (url, result) => {
        progress.done++
        if (result) replacements.set(url, result)
      }, fetchImpl)
    } catch (err) {
      error = err.message
    }
    await store.update(state => {
      const current = state.articles.find(item => item.id === article.id)
      if (!current) return
      // Apply URLs to the latest text so edits made during upload are preserved.
      const boundary = current.history.findLastIndex(entry => entry.reimportBefore)
      const recent = current.history.slice(boundary + 1)
      const blockSets = [current.blocks, ...recent.map(entry => entry.blocks)]
      for (const blocks of blockSets) {
        for (const block of blocks) {
          block.text = replaceFeishuImages(block.text, replacements)
          if (block.prev) block.prev = replaceFeishuImages(block.prev, replacements)
        }
      }
      const remaining = feishuImageUrls(current.blocks).length
      current.imageImport = remaining ? { error: error ?? '还有飞书图片待转存。', remaining } : null
    })
  }
  void run().catch(() => {
    article.imageImport = { error: '图片转存结果保存失败，请重试。' }
  }).finally(() => jobs.delete(article.id))
}

function view(article, pipeline, store, inlineStyles = [], inlineStyleWarnings = [], settings = {}, prepState = PREP_EMPTY, articles = []) {
  if (!article) return null
  const currentText = new Map(article.blocks.map(block => [block.id, block.text]))
  const previousText = new Map()
  const restoredBlocks = new Set()
  for (let i = article.history.length - 1; i >= 0; i--) {
    for (const block of article.history[i].blocks) {
      if (currentText.has(block.id) && currentText.get(block.id) !== block.text && !previousText.has(block.id)) {
        previousText.set(block.id, block.text)
        if (article.history[i].label === '恢复段落上一版') restoredBlocks.add(block.id)
      }
    }
  }
  const effectiveLayoutPreferences = resolveLayoutPreferences(settings, article)
  const themeColors = THEME_COLORS[effectiveLayoutPreferences.theme] ?? THEME_COLORS.orange
  return {
    id: article.id, topic: article.topic, title: article.title, titles: article.titles, summary: article.summary,
    publishedAt: article.publishedAt ?? null,
    blocks: article.blocks.map(block => ({
      id: block.id, text: block.text, kind: blockKind(block.text), checkable: isCheckable(block.text), check: block.check,
      hasPrev: Boolean(block.prev), previousText: previousText.get(block.id) ?? (block.prev !== block.text ? block.prev ?? null : null),
      lastChangeWasRestore: restoredBlocks.has(block.id),
    })),
    banner: bannerView(article),
    followCard: article.followCard === true,
    endMark: normalizeEndMark(article.endMark, 'horizon'),
    layoutPreferences: article.layoutPreferences ?? null,
    effectiveLayoutPreferences,
    derivatives: derivativesView(article),
    xhsJob: xhsJobMap(store).get(article.id) ?? null,
    xhsError: article.xhsError ?? null,
    articleImages: extractArticleImages(article),
    xhsPalette: {
      main: themeColors.main,
      soft: themeColors.soft,
      tint: themeColors.tint,
      line: themeColors.line,
      mark: themeColors.mark,
    },
    fixPlan: (({ picked, skipped }) => ({ count: picked.length, skipped }))(fixPlan(article)),
    chat: article.chat.slice(-40), canUndo: article.history.length > 0, zhuque: article.zhuque, notice: article.notice ?? null,
    job: pipeline.job(article.id),
    coverRuns: coverRuns(article).map(run => run.status === 'running' && coverJobMap(store).get(article.id)?.id !== run.id
      ? { ...run, status: 'interrupted' } : run),
    cover: article.cover ?? null, coverJob: coverJobMap(store).get(article.id) ?? null, coverError: article.coverError ?? null,
    imageImport: imageJobMap(store).get(article.id) ?? article.imageImport ?? null,
    inlineDiagrams: inlineDiagramView(article, store),
    inlineDiagramJob: diagramJobMap(store).get(article.id) ?? null,
    inlineDiagramMessage: article.inlineMessage ?? null,
    inlineDiagramStyles: inlineStyles,
    inlineDiagramStyleWarnings: inlineStyleWarnings,
    sourceBag: buildSourceBagView(article, prepState, articles),
    preflight: runPreflight(
      { title: article.title, blocks: article.blocks },
      {
        fixedLines: settings.fixedLines,
        customWords: settings.preflightWords,
        sponsoredBrief: resolveSponsoredBrief(article, prepState),
      },
    ),
  }
}

async function renderStylePreviewMarkdown(storeRoot, profile) {
  if (!profile) return null
  const existingHeadline = await readFile(join(storeRoot, 'skills', 'headline.md'), 'utf8').catch(() => '')
  return {
    writer: renderWriterSkill(profile),
    headline: renderHeadlineSkill(profile, existingHeadline),
  }
}

async function snapshotState(ctx, store, pipeline, prepStore) {
  const state = await store.read()
  const current = state.articles.find(a => a.id === state.currentId && !a.archivedAt) ?? null
  const info = modelInfo(ctx)
  const [settings, inlineCatalog, styleState, modelSupportsImages, prepState] = await Promise.all([
    readSettings(store.root),
    readInlineStyleCatalog(join(store.root, 'skills')),
    readStyleState(store.root),
    modelVisionSupport(ctx),
    prepStore ? prepStore.read() : Promise.resolve(PREP_EMPTY),
  ])
  return {
    brand: settings.brand,
    mp: { name: settings.mp?.name ?? '', headImg: settings.mp?.headImg ?? '' },
    fixedLines: settings.fixedLines,
    zhuqueReady: Boolean(settings.zhuqueKey),
    cloudinaryReady: Boolean(settings.cloudinary?.cloudName && settings.cloudinary?.apiKey && settings.cloudinary?.apiSecret),
    hasPersonalStyle: styleState.active,
    personalStyleScopes: styleState.scopes,
    articles: state.articles.map(article => listMeta(article, { bannerReady: bannerView(article).ready })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    current: view(current, pipeline, store, inlineCatalog.styles, inlineCatalog.warnings, settings, prepState, state.articles),
    prepPlaceholders: buildPrepPlaceholders(prepState),
    model: info ? info.model : null, modelPinned: Boolean(modelOverride()), modelOk: modelStatus.ok, modelError: modelStatus.error, modelSupportsImages,
    storageProblems: [...store.problems, ...(prepStore?.problems ?? [])].map(p => p.message),
  }
}

function mustFind(state, id) {
  const article = state.articles.find(a => a.id === (id ?? state.currentId))
  if (!article) throw Object.assign(new Error('文章不存在'), { status: 404 })
  return article
}

function mustBlock(article, id) {
  const block = article.blocks.find(b => b.id === id)
  if (!block) throw Object.assign(new Error('这一段已经不在了'), { status: 404 })
  return block
}

function notBusy(pipeline, id) {
  if (pipeline.job(id)) throw Object.assign(new Error('这篇文章还有任务在跑，等它结束再试。'), { status: 409 })
}

function scheduleTime(value) {
  try {
    return parseScheduleTime(value)
  } catch {
    throw Object.assign(new Error('请选择有效的发布时间。'), { status: 400 })
  }
}

function mustActive(article, message) {
  if (article.archivedAt) throw Object.assign(new Error(message), { status: 409 })
}

function importConflict(message) {
  return Object.assign(new Error(message), { status: 409 })
}

function assertCanReimport(deps, article) {
  mustActive(article, '归档稿件不能重新导入，请先恢复。')
  if (article.publishedAt) throw importConflict('已发布稿件不能覆盖正文。')
  notBusy(deps.pipeline, article.id)
  if (coverJobMap(deps.store).has(article.id) || imageJobMap(deps.store).has(article.id) || diagramJobMap(deps.store).has(article.id)) {
    throw importConflict('请等封面生成、图片转存或插图任务完成后再重新导入。')
  }
}

function mustPastPublication(at) {
  if (new Date(at).getTime() > Date.now()) {
    throw Object.assign(new Error('实际发表时间不能晚于现在。'), { status: 400 })
  }
}

/**
 * 处理一个 /wechat-studio/<path> 请求。鉴权在外层做完了。
 * @param {{ctx: object, store: Store, pipeline: Pipeline}} deps - 依赖。
 */
export async function route(deps, req, res) {
  const { ctx, store, pipeline } = deps
  const prepStore = getPrepStore(deps)
  const url = new URL(req.url, 'http://local')
  const path = url.pathname.replace(/^.*\/wechat-studio\/?/, '')
  const ok = async () => json(res, 200, await snapshotState(ctx, store, pipeline, prepStore))
  const get = req.method === 'GET'
  const patch = req.method === 'PATCH'
  if (!get && req.method !== 'POST' && !patch) return json(res, 405, { error: '不支持的请求方法' })
  if (patch && path !== 'prep/notes/update' && path !== 'prep/bags/update') {
    return json(res, 405, { error: '不支持的请求方法' })
  }

  if (get) {
    if (path === 'state') return ok()
    if (path === 'prep') {
      if (!store.problems.length && !prepStore.problems.length) {
        await reconcilePrep(prepStore, store)
      }
      return json(res, 200, await prepView(prepStore, store))
    }
    if (path === 'prep/assets') {
      try {
        const assetId = (url.searchParams.get('id') ?? '').trim().toLowerCase()
        let ext = (url.searchParams.get('ext') ?? '').trim().toLowerCase()
        if (!ext && PREP_ASSET_UUID_RE.test(assetId)) {
          const prepState = await prepStore.read()
          const matched = (prepState.notes ?? []).find(n => n?.image?.assetId?.toLowerCase() === assetId)
          if (matched?.image?.ext) ext = String(matched.image.ext).toLowerCase()
        }
        const { buffer, mimeType } = await readPrepAsset(store.root, assetId, ext)
        res.setHeader('content-type', mimeType)
        res.setHeader('cache-control', 'private, max-age=31536000, immutable')
        res.setHeader('x-content-type-options', 'nosniff')
        return res.end(buffer)
      } catch (err) {
        return json(res, err.status || 404, { error: err.message || '备稿图片不存在。' })
      }
    }
    if (path === 'version') return json(res, 200, await deps.versionChecker.check())
    if (path === 'settings') return json(res, 200, { ...publicSettings(await readSettings(store.root)), version: VERSION })
    if (path === 'models') return json(res, 200, { providers: await listModels(ctx), default: defaultSelection(ctx), current: modelOverride() })
    if (path === 'skills') {
      const dir = join(store.root, 'skills')
      return json(res, 200, { dir, skills: await skillSources(dir) })
    }
    if (path === 'style/profile') {
      const styleState = await readStyleState(store.root)
      return json(res, 200, {
        ...styleState,
        previewMarkdown: await renderStylePreviewMarkdown(store.root, styleState.profile),
      })
    }
    if (path === 'insights/data') return json(res, 200, await insightsView(deps, url.searchParams.get('range')))
    if (path === 'cover-styles') {
      const [{ styles, warnings }, visionSupport] = await Promise.all([
        listCoverStyles(store.root),
        modelVisionSupport(ctx),
      ])
      return json(res, 200, {
        styles: styles.map(withCoverStylePreviewUrl),
        warnings,
        visionSupport,
        activeTestJob: activeTestJobForSummary(store),
      })
    }
    if (path === 'cover-styles/item') {
      const id = url.searchParams.get('id')
      if (!isCustomStyleId(id)) return json(res, 400, { error: '无效的自定义封面风格 ID。' })
      const style = await readCustomCoverStyle(store.root, id)
      if (!style) return json(res, 404, { error: '自定义封面风格不存在。' })
      return json(res, 200, { style: withCoverStylePreviewUrl(style) })
    }
    if (path === 'cover-styles/preview') {
      try {
        const { buffer, contentType } = await readCustomStylePreview(store.root, url.searchParams.get('id'))
        res.setHeader('content-type', contentType)
        res.setHeader('cache-control', 'private, no-store')
        return res.end(buffer)
      } catch (err) {
        return json(res, err.status || 404, { error: err.message || '预览图不存在。' })
      }
    }
    if (path === 'cover-styles/draft-preview') {
      try {
        const { buffer, contentType } = await readDraftPreview(store.root, url.searchParams.get('token'))
        res.setHeader('content-type', contentType)
        res.setHeader('cache-control', 'private, no-store')
        return res.end(buffer)
      } catch (err) {
        return json(res, err.status || 404, { error: err.message || '试生成样图不存在。' })
      }
    }
    if (path === 'cover-styles/test-status') {
      pruneCoverStyleTestJobs(store)
      const reg = testJobRegistry(store)
      const requestedId = url.searchParams.get('jobId')
      if (requestedId) {
        const job = reg.jobs.get(requestedId)
        if (!job) return json(res, 404, { error: '试生成任务不存在或已过期。' })
        return json(res, 200, publicTestJob(job))
      }
      const running = findRunningTestJob(store, { prune: false })
      const job = running ?? (reg.latestId ? reg.jobs.get(reg.latestId) : null)
      return json(res, 200, publicTestJob(job))
    }
    const article = mustFind(await store.read(), url.searchParams.get('id'))
    if (path === 'inline-diagrams/image') {
      if (article.archivedAt) return json(res, 409, { error: '归档稿件不能读取插图。' })
      try {
        const asset = url.searchParams.get('asset')
        const diagramId = url.searchParams.get('diagram') ?? article.inlineDiagrams?.find(item => item.assetId === asset)?.id
        const image = await readInlineAsset(store.root, article, diagramId, asset)
        const diagram = article.inlineDiagrams?.find(item => item.id === diagramId)
        res.setHeader('content-type', 'image/png')
        res.setHeader('cache-control', 'private, max-age=31536000, immutable')
        if (url.searchParams.has('download')) {
          const title = String(diagram?.title ?? '正文插图').replace(/[\r\n]+/g, ' ').trim().slice(0, 60) || '正文插图'
          const filename = encodeURIComponent(`${title}.png`).replace(/'/g, '%27')
          res.setHeader('content-disposition', `attachment; filename="inline-diagram.png"; filename*=UTF-8''${filename}`)
        }
        return res.end(image)
      } catch (err) {
        return json(res, err.status || 404, { error: err.message || '插图文件不存在' })
      }
    }
    if (path === 'cover/image') {
      const id = url.searchParams.get('asset')
      const run = coverRuns(article).find(run => run.images.some(image => image.id === id))
      if (!run) return json(res, 404, { error: '未找到封面' })
      const format = run.format ?? 'png'
      let image
      try {
        image = await readCover(store.root, id, format)
      } catch {
        return json(res, 404, { error: '封面文件不存在' })
      }
      res.setHeader('content-type', `image/${format}`)
      res.setHeader('cache-control', 'private, no-store')
      if (url.searchParams.has('download')) {
        const liveStyle = await resolveCoverStyle(store.root, run.style)
        const filename = coverDownloadName(article, run, id, liveStyle?.name ?? '')
        const encoded = encodeURIComponent(filename).replace(/'/g, '%27')
        res.setHeader('content-disposition', `attachment; filename="cover.${format}"; filename*=UTF-8''${encoded}`)
      }
      return res.end(image)
    }
    if (path === 'revisions') {
      res.setHeader('cache-control', 'private, no-store')
      return json(res, 200, { revisions: revisionChanges(article) })
    }
    if (path === 'markdown') return json(res, 200, { markdown: toMarkdown(article) })
    if (path === 'derive/markdown') {
      const target = url.searchParams.get('target') || 'blog'
      const settings = await readSettings(store.root)
      return json(res, 200, { ...toPortableMarkdown(article, { target, fixedLines: settings.fixedLines }), target })
    }
    if (path === 'detection-text') {
      const settings = await readSettings(store.root)
      return json(res, 200, { text: await detectionText(toMarkdown(article), settings.fixedLines) })
    }
    if (path === 'layout') {
      const settings = await readSettings(store.root)
      const style = article.bannerStyle ?? DEFAULT_BANNER
      const banner = style === 'none' ? null : article.banners?.[style]?.spec ?? null
      const studioOptions = {
        banner: bannerView(article), followCard: article.followCard === true,
        endMark: normalizeEndMark(article.endMark, 'horizon'),
        layoutPreferences: article.layoutPreferences ?? null,
      }
      const { html, report } = await renderLayout(toMarkdown(article), {
        ...resolveLayoutPreferences(settings, article), banner, followCard: studioOptions.followCard, endMark: studioOptions.endMark, brand: settings.brand, studioOptions,
      })
      return json(res, 200, { html, report })
    }
    return json(res, 404, { error: '没有这个接口' })
  }

  if (path === 'zhuque/report') {
    const state = await store.read()
    const article = mustFind(state, url.searchParams.get('id'))
    notBusy(pipeline, article.id)
    const text = await pdfToText(await readBuffer(req, MAX_PDF))
    pipeline.report(article.id, text)
    return ok()
  }

  if (path === 'prep/brief-file') {
    if (Number(req.headers['content-length']) > MAX_BRIEF_FILE_BYTES) {
      return json(res, 413, { error: '文件不能超过 10 MB。' })
    }
    const buffer = await readBuffer(req, MAX_BRIEF_FILE_BYTES)
    return json(res, 200, await readBriefFile(buffer, url.searchParams.get('name') ?? ''))
  }

  if (path === 'prep/assets') {
    let image
    try {
      image = await readBuffer(req, PREP_LIMITS.maxAssetBytes)
    } catch (err) {
      if (err.status === 413) return json(res, 400, { error: '本地图片不能超过 10 MB。' })
      throw err
    }
    const name = url.searchParams.get('name') ?? ''
    const asset = await savePrepAsset(store.root, image, name)
    return json(res, 200, {
      ...asset,
      url: `wechat-studio/prep/assets?${new URLSearchParams({ id: asset.assetId, ext: asset.ext })}`,
    })
  }

  if (path === 'images/upload') {
    const article = mustFind(await store.read(), url.searchParams.get('id'))
    if (article.archivedAt) return json(res, 409, { error: '归档稿件不能上传图片，请先恢复。' })
    const image = await readBuffer(req, MAX_LOCAL_IMAGE)
    const settings = await readSettings(store.root)
    const publicUrl = await uploadLocalImage(image, settings.cloudinary, deps.fetchImpl)
    return json(res, 200, { url: publicUrl })
  }

  if (path === 'settings/portrait') {
    const image = await readBuffer(req, MAX_LOCAL_IMAGE)
    // 生图接口的参考图不收动图；uploadLocalImage 为正文图片保留了 GIF，这里单独挡掉
    if (['GIF87a', 'GIF89a'].includes(image.toString('ascii', 0, 6))) return json(res, 400, { error: '参考照片请用 PNG、JPEG 或 WebP。' })
    const settings = await readSettings(store.root)
    return json(res, 200, { url: await uploadLocalImage(image, settings.cloudinary, deps.fetchImpl) })
  }

  if (path === 'insights/import') {
    const fileName = String(url.searchParams.get('name') ?? '导出.xls').slice(0, 200)
    const parsed = importData(await readBuffer(req, MAX_IMPORT), fileName)
    await deps.insightsStore.update(state => {
      if (parsed.kind !== 'detail') {
        state[parsed.kind] = parsed
        return
      }
      const existing = (state.details ?? []).find(detail => detail.key === parsed.key)
      if (existing?.articleKey !== undefined) parsed.articleKey = existing.articleKey
      if (existing?.topic) parsed.topic = existing.topic
      state.details = [...(state.details ?? []).filter(detail => detail.key !== parsed.key), parsed]
    })
    return json(res, 200, await insightsView(deps, url.searchParams.get('range')))
  }

  const body = await readJson(
    req,
    path === 'cover-styles/analyze' || path === 'cover-styles/test-generate' || path === 'cover-styles/save'
      ? MAX_ANALYZE_JSON
      : MAX_JSON,
  )
  switch (path) {
    case 'inline-diagrams/analyze': {
      const article = activeInlineArticle(await store.read(), body.id)
      if (body.blockId) mustBlock(article, body.blockId)
      startInlineAnalysis(deps, article.id, body.blockId ?? null)
      return ok()
    }
    case 'inline-diagrams/ignore':
    case 'inline-diagrams/restore': {
      await store.update(state => {
        const article = activeInlineArticle(state, body.id)
        if (diagramJobMap(store).has(article.id)) throw Object.assign(new Error('请等当前插图任务结束后再操作。'), { status: 409 })
        const diagram = inlineRecord(article, body.diagramId)
        if (path.endsWith('/ignore')) {
          if (article.blocks.some(block => block.id === diagram.insertedBlockId)) throw Object.assign(new Error('已插入的插图不能忽略，可以直接在正文中删除。'), { status: 409 })
          diagram.status = 'ignored'
        } else {
          if (inlineAnchorOccupied(article, diagram, diagram.anchorId)) throw Object.assign(new Error('这个段落已有插图候选，已保留原忽略状态。'), { status: 409 })
          diagram.status = diagram.insertedBlockId && article.blocks.some(block => block.id === diagram.insertedBlockId)
            ? 'inserted' : diagram.assetId ? 'generated' : 'suggested'
          diagram.error = null
        }
        article.inlineMessage = null
      })
      return ok()
    }
    case 'inline-diagrams/delete': {
      const removed = await store.update(state => {
        const article = activeInlineArticle(state, body.id)
        if (diagramJobMap(store).has(article.id)) throw Object.assign(new Error('请等当前插图任务结束后再操作。'), { status: 409 })
        const diagram = inlineRecord(article, body.diagramId)
        if (article.blocks.some(block => block.id === diagram.insertedBlockId)) throw Object.assign(new Error('已插入正文的插图不能直接删除，请先在正文中删除图片。'), { status: 409 })
        article.inlineDiagrams = article.inlineDiagrams.filter(item => item.id !== diagram.id)
        article.inlineMessage = null
        return article.inlineDiagrams.some(item => item.assetId === diagram.assetId) ? null : diagram
      })
      await removeInlineImages(store.root, [removed]).catch(() => {})
      return ok()
    }
    case 'inline-diagrams/generate': {
      await loadInlineStyle(body.style, join(store.root, 'skills'))
      const article = activeInlineArticle(await store.read(), body.id)
      const diagram = inlineRecord(article, body.diagramId)
      if (!DIAGRAM_KINDS.includes(diagram.kind)) return json(res, 400, { error: '插图类型无效。' })
      if (article.blocks.some(block => block.id === diagram.insertedBlockId)) return json(res, 409, { error: '这张插图已插入正文；如需重画，请先删除正文图片。' })
      const anchor = mustBlock(article, diagram.anchorId)
      if (diagram.pendingAnalysis) return json(res, 409, { error: '换位置后需要按新段落重新分析，请先点击「刷新建议」。' })
      if (sourceHash(anchor.text) !== diagram.sourceHash) return json(res, 409, { error: '段落已改动；如需按新内容重画，请删除这条记录后用「指定段落」重新分析；插入旧图则需明确确认。' })
      const settings = await readSettings(store.root)
      const meta = providerMeta(settings.coverProvider)
      const apiKey = settings[meta.keyField]
      if (!apiKey) return json(res, 400, { error: meta.missingKeyError })
      startInlineGeneration(deps, article.id, diagram.id, body.style, settings)
      return ok()
    }
    case 'inline-diagrams/reanchor': {
      await store.update(state => {
        const article = activeInlineArticle(state, body.id)
        if (diagramJobMap(store).has(article.id)) throw Object.assign(new Error('请等当前插图任务结束后再操作。'), { status: 409 })
        const diagram = inlineRecord(article, body.diagramId)
        if (article.blocks.some(block => block.id === diagram.insertedBlockId)) throw Object.assign(new Error('已插入正文的插图不能换位置，请直接在正文中处理图片。'), { status: 409 })
        const target = mustBlock(article, body.blockId)
        if (inlineAnchorOccupied(article, diagram, target.id)) throw Object.assign(new Error('这个段落已有插图候选，一个段落只保留一条。'), { status: 409 })
        diagram.anchorId = target.id
        if (!diagram.assetId) {
          diagram.pendingAnalysis = true
          if (['failed', 'interrupted'].includes(diagram.status)) diagram.status = 'suggested'
          diagram.error = null
        }
        article.inlineMessage = {
          error: false,
          text: diagram.assetId ? '已更换插入位置；旧图仍按原段落生成，不会自动重画。' : '已更新插图位置；请点击「刷新建议」按新段落重新分析后再生图。',
          at: new Date().toISOString(),
        }
      })
      return ok()
    }
    case 'inline-diagrams/insert': {
      if (!/^[a-f0-9]{64}$/.test(body.expectedAnchorHash ?? '')) return json(res, 400, { error: '缺少目标段落版本，请重新打开插入确认。' })
      const article = activeInlineArticle(await store.read(), body.id)
      const diagram = inlineRecord(article, body.diagramId)
      if (!['generated', 'inserted'].includes(diagram.status)) return json(res, 409, { error: '这条建议当前不能插入，请先恢复或重新生成。' })
      if (!diagram.assetId || diagram.format !== 'png') return json(res, 409, { error: '请先生成插图。' })
      const settings = await readSettings(store.root)
      if (!diagram.publicUrl && (!settings.cloudinary?.cloudName || !settings.cloudinary?.apiKey || !settings.cloudinary?.apiSecret)) {
        return json(res, 400, { error: '请先在设置中配置 Cloudinary；已生成的插图会保留，配置后可直接插入。' })
      }
      startInlineInsertion(deps, article.id, diagram.id, body.expectedAnchorHash, body.acceptStale === true, settings.cloudinary)
      return ok()
    }
    case 'insights/experiment':
      await deps.insightsStore.update(async state => {
        const items = state.experiments ?? []
        const existing = body.id ? items.find(item => item.id === body.id) : null
        if (body.id && !existing) throw Object.assign(new Error('找不到这条尝试'), { status: 404 })
        const sourceKey = existing?.sourceKey ?? body.sourceKey
        const source = (state.details ?? []).find(detail => detail.key === sourceKey)
        const action = typeof body.action === 'string' ? body.action.trim() : ''
        if (!source || !action || action.length > 300) throw Object.assign(new Error('请选择来源文章，并填写 300 字以内的改法'), { status: 400 })
        const draftId = body.draftId || null
        if (draftId && !(await store.read()).articles.some(draft => draft.id === draftId)) {
          throw Object.assign(new Error('找不到关联稿件'), { status: 404 })
        }
        const result = existing && existing.draftId === draftId && existing.action === action ? body.result ?? null : null
        if (result != null && !Object.hasOwn(EXPERIMENT_RESULTS, result)) {
          throw Object.assign(new Error('请选一个有效结论'), { status: 400 })
        }
        const item = { id: existing?.id ?? randomUUID(), sourceKey, action, draftId, result }
        state.experiments = existing ? items.map(row => row.id === item.id ? item : row) : [item, ...items]
      })
      return json(res, 200, await insightsView(deps, body.range))
    case 'insights/detail-topic':
      await deps.insightsStore.update(state => {
        const detail = (state.details ?? []).find(item => item.key === body.key)
        if (!detail) throw Object.assign(new Error('没有这份单篇明细'), { status: 404 })
        detail.topic = String(body.topic ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').slice(0, 40)
      })
      return json(res, 200, await insightsView(deps, body.range))
    case 'insights/detail-match':
      await deps.insightsStore.update(state => {
        const detail = (state.details ?? []).find(item => item.key === body.key)
        if (!detail) throw Object.assign(new Error('没有这份单篇明细'), { status: 404 })
        if (body.articleKey === 'auto') delete detail.articleKey
        else if (body.articleKey == null || state.tendency?.articles.some(row => row.key === body.articleKey)) detail.articleKey = body.articleKey
        else throw Object.assign(new Error('没有这篇数据趋势文章'), { status: 404 })
      })
      return json(res, 200, await insightsView(deps, body.range))
    case 'articles/reimport/preview': {
      const article = mustFind(await store.read(), body.id)
      assertCanReimport(deps, article)
      const plan = planMarkdownReimport(article, body.markdown, { updateTitle: body.updateTitle === true })
      return json(res, 200, {
        token: plan.token, currentTitle: article.title, incomingTitle: plan.incomingTitle, finalTitle: plan.finalTitle,
        changed: plan.changed, bodyChanged: plan.bodyChanged, kept: plan.kept, removed: plan.removed, added: plan.added,
        removedMedia: plan.removedMedia, transfers: plan.bodyChanged ? feishuImageUrls(plan.entries).length : 0,
        bannerReview: Boolean(article.banners?.[article.bannerStyle ?? DEFAULT_BANNER]),
      })
    }
    case 'articles/reimport': {
      const result = await store.update(state => {
        const article = mustFind(state, body.id)
        assertCanReimport(deps, article)
        const plan = planMarkdownReimport(article, body.markdown, { updateTitle: body.updateTitle === true })
        if (plan.token !== body.token) throw importConflict('稿件或导入选项已变化，请重新预检。')
        if (plan.removedMedia.length && body.acknowledgeRemovedMedia !== true) {
          throw importConflict('请先确认将移出的图片和动画卡。')
        }
        if (!plan.changed) throw importConflict('与当前稿件一致，无需覆盖。')
        const applied = applyMarkdownReimport(article, plan)
        if (applied.urls.length) {
          article.imageImport = { error: '图片转存中断，可以重试。', remaining: applied.urls.length }
        }
        article.notice = { text: '已覆盖正文，可在改稿对比查看，或用顶部撤销恢复。', at: new Date().toISOString() }
        return applied
      })
      startImageImport(deps, result.article, result.urls)
      return ok()
    }
    case 'articles/duplicate': {
      let cleanup = null
      let rollback = null
      const prepState = await prepStore.read()
      try {
        await store.update(async state => {
          const source = mustFind(state, body.id)
          notBusy(pipeline, source.id)
          if (coverJobMap(store).has(source.id) || imageJobMap(store).has(source.id) || diagramJobMap(store).has(source.id)) {
            throw Object.assign(new Error('请等封面生成、图片转存或插图任务完成后再创建副本。'), { status: 409 })
          }
          const latestBrief = resolveSponsoredBrief(source, prepState)
          const duplicated = await duplicateArticle(store.root, source, { sponsoredSnapshot: latestBrief })
          const prevCurrentId = state.currentId
          cleanup = duplicated.cleanup
          rollback = () => {
            const index = state.articles.indexOf(duplicated.article)
            if (index !== -1) state.articles.splice(index, 1)
            state.currentId = prevCurrentId
          }
          state.articles.push(duplicated.article)
          state.currentId = duplicated.article.id
        })
      } catch (err) {
        rollback?.()
        await cleanup?.()
        throw err
      }
      return ok()
    }
    case 'articles/new': {
      const hasBody = typeof body.markdown === 'string' && body.markdown.trim()
      if (!hasBody && !String(body.topic ?? '').trim() && !String(body.material ?? '').trim()) throw Object.assign(new Error('写一句选题，或者贴入已有的文章。'), { status: 400 })
      const article = createArticle(body)
      const urls = hasBody ? feishuImageUrls(article.blocks) : []
      if (urls.length) article.imageImport = { error: '图片转存中断，可以重试。', remaining: urls.length }
      await store.update(state => {
        if (state.lastLayoutPreferences) article.layoutPreferences = { ...state.lastLayoutPreferences }
        if (state.lastEndMark) article.endMark = normalizeEndMark(state.lastEndMark, 'horizon')
        state.articles.push(article)
        state.currentId = article.id
      })
      startImageImport(deps, article, urls)
      if (!hasBody) pipeline.draft(article.id)
      else if (!article.titles.length && body.titles !== false) pipeline.titles(article.id)
      return ok()
    }
    case 'cover/select': {
      await store.update(async state => {
        const article = mustFind(state, body.id)
        if (coverJobMap(store).has(article.id)) {
          throw Object.assign(new Error('请等当前封面生成结束后再切换。'), { status: 409 })
        }
        const runs = coverRuns(article)
        const run = runs.find(entry => entry.images.some(image => image.id === body.asset))
        if (!run) throw Object.assign(new Error('这篇文章没有这张封面。'), { status: 404 })
        const { title, prompt, style, styleName, model, createdAt, resolution, count, format, provider } = run
        try {
          await readCover(store.root, body.asset, format)
        } catch {
          throw Object.assign(new Error('封面文件不存在。'), { status: 404 })
        }
        article.coverRuns = runs
        article.cover = {
          id: body.asset, title, prompt, style,
          ...(styleName ? { styleName } : {}),
          model, createdAt, resolution, count, format, provider,
        }
        touch(article)
      })
      return ok()
    }
    case 'cover/generate': {
      const resolved = await resolveCoverStyle(store.root, body.style)
      if (!resolved) return json(res, 400, { error: '请先选择封面风格。' })
      const article = mustFind(await store.read(), body.id)
      if (!article.title?.trim() || !article.blocks.length) return json(res, 400, { error: '请先选定标题并填写正文。' })
      const { resolution = '2K', count = 1, format = 'png' } = body
      if (!COVER_RESOLUTIONS.includes(resolution) || !COVER_FORMATS.includes(format) ||
          !Number.isInteger(count) || count < 1 || count > MAX_COVER_COUNT) {
        return json(res, 400, { error: '请选择有效的分辨率、格式和生成张数（1 至 4）。' })
      }
      const settings = await readSettings(store.root)
      const provider = settings.coverProvider
      if (!providerFormats(provider).includes(format)) return json(res, 400, { error: '当前封面提供方只支持 png 格式。' })
      const meta = providerMeta(provider)
      const apiKey = settings[meta.keyField]
      const model = settings[meta.modelField]
      const baseUrl = meta.baseUrlField ? settings[meta.baseUrlField] : ''
      if (!apiKey) return json(res, 400, { error: meta.missingKeyError })
      const { referenceImage: resolvedRef, referenceKind } = await resolveCoverReferenceImage(store.root, resolved, settings)
      startCover(deps, article, apiKey, {
        style: resolved.id,
        styleName: resolved.name,
        resolution,
        count,
        format,
        model,
        provider,
        baseUrl,
        referenceImage: referenceKind === 'portrait' ? resolvedRef : null,
        runtimeReferenceImage: referenceKind === 'style' ? resolvedRef : null,
        referenceKind,
        persona: settings.persona,
        customStyle: resolved.source === 'custom' ? resolved : null,
      })
      return ok()
    }
    case 'cover-styles/analyze': {
      const result = await analyzeCustomCoverStyle(ctx, {
        referenceImages: body.referenceImages,
        requirement: body.requirement,
        draft: body.draft,
        adjustment: body.adjustment,
      })
      return json(res, 200, result)
    }
    case 'cover-styles/test-generate': {
      const runningBefore = findRunningTestJob(store)
      if (runningBefore) {
        return json(res, 409, { error: '当前已有样图正在试生成，请等待完成后再试。', activeJobId: runningBefore.jobId })
      }
      const resolution = body.resolution ?? '1K'
      if (!COVER_RESOLUTIONS.includes(resolution)) {
        return json(res, 400, { error: '请选择有效的试生成分辨率（1K、1.5K 或 2K）。' })
      }
      const template = typeof body.draft?.template === 'string' ? body.draft.template.replace(/\r\n?/g, '\n').trim() : ''
      if (!template || template.length > CUSTOM_COVER_STYLE_LIMITS.maxTemplate) {
        return json(res, 400, { error: `提示词模板不能为空，且不超过 ${CUSTOM_COVER_STYLE_LIMITS.maxTemplate} 字。` })
      }
      if (extractTemplateSlots(template).length < CUSTOM_COVER_STYLE_LIMITS.minSlots) {
        return json(res, 400, { error: `提示词模板至少需要包含 ${CUSTOM_COVER_STYLE_LIMITS.minSlots} 个 {{...}} 占位符。` })
      }
      const guidance = typeof body.draft?.guidance === 'string' ? body.draft.guidance.replace(/\r\n?/g, '\n').trim() : ''
      if (guidance.length > CUSTOM_COVER_STYLE_LIMITS.maxGuidance) {
        return json(res, 400, { error: `填空指引不能超过 ${CUSTOM_COVER_STYLE_LIMITS.maxGuidance} 字。` })
      }
      const blocked = findBlocked(await loadCoverBlocklist(), template)
      if (blocked) {
        return json(res, 400, { error: `提示词模板包含封面禁用词「${blocked}」，请修改后再试生成。` })
      }
      const settings = await readSettings(store.root)
      const provider = settings.coverProvider
      const meta = Object.hasOwn(COVER_PROVIDER_META, provider) ? COVER_PROVIDER_META[provider] : null
      if (!meta) return json(res, 400, { error: '请选择有效的生图提供方。' })
      if (!settings[meta.keyField]) return json(res, 400, { error: meta.missingKeyError })

      // 异步校验完成后同步复查单活锁，消除 TOCTOU 并发双生图竞态
      const runningNow = findRunningTestJob(store)
      if (runningNow) {
        return json(res, 409, { error: '当前已有样图正在试生成，请等待完成后再试。', activeJobId: runningNow.jobId })
      }

      const reg = testJobRegistry(store)
      const jobId = randomUUID()
      const job = { jobId, status: 'running', stage: 'prompt', createdAt: Date.now(), finishedAt: null, result: null, error: null, consumed: false }
      reg.jobs.set(jobId, job)
      reg.latestId = jobId

      void (async () => {
        try {
          const preview = await previewCustomCoverStyle(ctx, store.root, settings, {
            draft: body.draft,
            testTitle: body.testTitle,
            testMarkdown: body.testMarkdown,
            resolution,
            styleReferenceImage: body.styleReferenceImage ?? null,
            onStage: stage => { job.stage = stage },
          }, deps.fetchImpl)
          job.result = {
            draftToken: preview.draftToken,
            previewUrl: `wechat-studio/cover-styles/draft-preview?${new URLSearchParams({ token: preview.draftToken })}`,
            prompt: preview.prompt,
            format: preview.format,
            provider: preview.provider,
            model: preview.model,
          }
          job.status = 'succeeded'
        } catch (err) {
          const isMinimaxTimeout = provider === 'minimax' && (err.code === 'MINIMAX_TIMEOUT' || (job.stage === 'generating' && err.name === 'TimeoutError'))
          job.error = isMinimaxTimeout
            ? (err.code === 'MINIMAX_TIMEOUT' ? err.message : 'MiniMax 样例封面生成已等待 600 秒并断开，服务端仍可能完成并计费；请避免立即重复提交。')
            : (err.name === 'TimeoutError' ? '试生成样图超时，请重试。' : (err.message || '试生成样图失败。'))
          job.status = 'failed'
        } finally {
          job.finishedAt = Date.now()
          pruneCoverStyleTestJobs(store)
        }
      })()

      return json(res, 200, publicTestJob(job))
    }
    case 'cover-styles/save': {
      const saved = await saveCustomCoverStyle(store.root, body)
      if (body.previewDraftToken) {
        const reg = coverStyleTestJobs.get(store)
        if (reg) {
          for (const job of reg.jobs.values()) {
            if (job.result?.draftToken === body.previewDraftToken) job.consumed = true
          }
        }
      }
      return json(res, 200, {
        style: withCoverStylePreviewUrl(saved.style),
        styles: saved.styles.map(withCoverStylePreviewUrl),
        warnings: saved.warnings,
      })
    }
    case 'cover-styles/delete': {
      const after = await deleteCustomCoverStyle(store.root, body.id)
      return json(res, 200, {
        styles: after.styles.map(withCoverStylePreviewUrl),
        warnings: after.warnings,
      })
    }
    case 'images/retry': {
      const article = mustFind(await store.read(), body.id)
      const urls = feishuImageUrls(article.blocks)
      if (urls.length) startImageImport(deps, article, urls)
      else await store.update(() => { article.imageImport = null })
      return ok()
    }
    case 'articles/view': {
      if (body.view !== 'paper' && body.view !== 'layout') {
        return json(res, 400, { error: '请选择有效的稿件页面。' })
      }
      await store.update(state => { mustFind(state, body.id).lastView = body.view })
      return ok()
    }
    case 'svg-cards/draft':
      return json(res, 200, await draftSvgCard(ctx, store, body))
    case 'svg-cards/preview':
      return json(res, 200, await previewSvgCard(store, body, await readSettings(store.root)))
    case 'svg-cards/insert':
      await insertSvgCard(store, body)
      return ok()
    case 'schedule/set': {
      const at = scheduleTime(body.at)
      await store.update(state => {
        const article = mustFind(state, body.id)
        mustActive(article, '归档稿件不能排期，请先恢复。')
        if (article.publishedAt) throw Object.assign(new Error('这篇已标记发布，不能改期。'), { status: 409 })
        setSchedule(article, at)
      })
      return ok()
    }
    case 'schedule/clear': {
      await store.update(state => {
        const article = mustFind(state, body.id)
        mustActive(article, '归档稿件不能取消排期，请先恢复。')
        if (article.publishedAt) throw Object.assign(new Error('这篇已标记发布，不能取消排期。'), { status: 409 })
        clearSchedule(article)
      })
      return ok()
    }
    case 'articles/publish': {
      const at = body.at == null ? new Date().toISOString() : scheduleTime(body.at)
      await store.update(state => {
        const article = mustFind(state, body.id)
        mustActive(article, '归档稿件不能标记发布，请先恢复。')
        mustPastPublication(at)
        markPublished(article, at, new Date().toISOString())
      })
      return ok()
    }
    case 'articles/correct-publish': {
      const at = scheduleTime(body.at)
      await store.update(state => {
        const article = mustFind(state, body.id)
        mustActive(article, '归档稿件不能更正发表时间，请先恢复。')
        if (!article.publishedAt) throw Object.assign(new Error('这篇还没有发布记录。'), { status: 409 })
        mustPastPublication(at)
        correctPublishedAt(article, at)
      })
      return ok()
    }
    case 'articles/unpublish': {
      await store.update(state => {
        const article = mustFind(state, body.id)
        mustActive(article, '归档稿件不能撤销发布标记，请先恢复。')
        unpublish(article)
      })
      return ok()
    }
    case 'articles/archive':
    case 'articles/restore': {
      await store.update(state => {
        const article = mustFind(state, body.id)
        if (path === 'articles/restore') {
          delete article.archivedAt
          return
        }
        notBusy(pipeline, article.id)
        if (coverJobMap(store).has(article.id) || imageJobMap(store).has(article.id) || diagramJobMap(store).has(article.id)) {
          throw Object.assign(new Error('请等封面生成、图片转存或插图任务完成后再归档。'), { status: 409 })
        }
        article.archivedAt ??= new Date().toISOString()
        if (state.currentId === article.id) state.currentId = null
      })
      return ok()
    }
    case 'articles/select':
      await store.update(state => {
        const article = mustFind(state, body.id)
        if (article.archivedAt) throw Object.assign(new Error('请先恢复这篇稿件。'), { status: 409 })
        state.currentId = article.id
      })
      return ok()
    case 'articles/delete': {
      notBusy(pipeline, body.id)
      if (coverJobMap(store).has(body.id) || diagramJobMap(store).has(body.id)) return json(res, 409, { error: '封面生成或插图任务完成后再删除这篇文章。' })
      const discarded = await store.update(state => {
        const article = mustFind(state, body.id)
        state.articles = state.articles.filter(a => a.id !== article.id)
        if (state.currentId === article.id) state.currentId = state.articles.findLast(a => !a.archivedAt)?.id ?? null
        return article.inlineDiagrams ?? []
      })
      await removeInlineImages(store.root, discarded).catch(() => {})
      return ok()
    }
    case 'chat': {
      const message = String(body.message ?? '').trim().slice(0, 4000)
      if (!message) throw Object.assign(new Error('消息为空'), { status: 400 })
      const id = await store.update(state => {
        const article = mustFind(state, body.id)
        notBusy(pipeline, article.id)
        article.chat.push({ role: 'user', text: message })
        article.notice = null
        return article.id
      })
      pipeline.chat(id, message)
      return ok()
    }
    case 'titles/regen': {
      const article = mustFind(await store.read(), body.id)
      pipeline.titles(article.id)
      return ok()
    }
    case 'title/pick':
      await store.update(state => {
        const article = mustFind(state, body.id)
        const value = String(body.text ?? '').trim().slice(0, 80)
        if (!value || value === article.title) return
        snapshot(article, '换标题')
        article.title = value
        article.hook = article.titles.find(t => t.text === value)?.hook ?? null
        touch(article)
      })
      return ok()
    case 'summary/update':
      await store.update(state => {
        const article = mustFind(state, body.id)
        mustActive(article, '归档稿件不能修改摘要，请先恢复。')
        notBusy(pipeline, article.id)
        const normalized = String(body.text ?? '').replace(/\s+/g, ' ').trim()
        const value = sliceUtf16Safe(normalized, MAX_DIGEST)
        if (value === (article.summary ?? '')) return
        article.summary = value
        touch(article)
      })
      return ok()
    case 'block/append':
      await store.update(state => {
        const article = mustFind(state, body.id)
        mustActive(article, '归档稿件不能修改正文，请先恢复。')
        notBusy(pipeline, article.id)
        const value = String(body.text ?? '').replace(/\r\n?/g, '\n').trim().slice(0, 20000)
        if (!value) throw Object.assign(new Error('请输入正文内容。'), { status: 400 })
        const pieces = splitMarkdown(value, { bodyOnly: true }).blocks
        const texts = pieces.length ? pieces : [value]
        const inserted = texts.map(text => ({ id: newId(), text, check: null }))
        if (body.afterBlockId) {
          const anchor = mustBlock(article, body.afterBlockId)
          const index = article.blocks.indexOf(anchor)
          snapshot(article, '插入段落')
          article.blocks.splice(index + 1, 0, ...inserted)
        } else {
          snapshot(article, '手写正文')
          article.blocks.push(...inserted)
        }
        touch(article)
      })
      return ok()
    case 'block/move':
      await store.update(state => {
        const article = mustFind(state, body.id)
        mustActive(article, '归档稿件不能调整段落顺序，请先恢复。')
        notBusy(pipeline, article.id)
        const direction = body.direction
        if (direction !== 'up' && direction !== 'down') {
          throw Object.assign(new Error('请指定上移或下移方向。'), { status: 400 })
        }
        const block = mustBlock(article, body.blockId)
        const index = article.blocks.indexOf(block)
        const target = direction === 'up' ? index - 1 : index + 1
        if (target < 0 || target >= article.blocks.length) return
        snapshot(article, '调整段落顺序')
        ;[article.blocks[index], article.blocks[target]] = [article.blocks[target], article.blocks[index]]
        touch(article)
      })
      return ok()
    case 'block/replace-all': {
      const find = typeof body.find === 'string' ? body.find : ''
      if (!find) throw Object.assign(new Error('请输入要查找的内容。'), { status: 400 })
      const replacement = typeof body.replace === 'string' ? body.replace : ''
      const caseSensitive = body.caseSensitive === true
      const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const regex = new RegExp(escaped, caseSensitive ? 'g' : 'gi')
      let replacedCount = 0
      let replacedBlocks = 0
      await store.update(state => {
        const article = mustFind(state, body.id)
        mustActive(article, '归档稿件不能替换正文，请先恢复。')
        notBusy(pipeline, article.id)
        const targets = body.blockId ? [mustBlock(article, body.blockId)] : article.blocks
        const updates = []
        for (const block of targets) {
          let hits = 0
          const nextText = block.text.replace(regex, () => {
            hits += 1
            return replacement
          })
          if (!hits || nextText === block.text) continue
          if (nextText.length > 20000) {
            throw Object.assign(new Error('替换后部分段落超过 20000 字符上限，请缩短替换内容。'), { status: 400 })
          }
          updates.push({ block, nextText, hits })
          replacedCount += hits
          replacedBlocks += 1
        }
        if (!updates.length) return
        snapshot(article, body.blockId ? '段落替换' : '全文替换')
        for (const { block, nextText } of updates) {
          block.text = nextText.trim()
          block.check = null
        }
        article.blocks = article.blocks.filter(block => block.text)
        touch(article)
      })
      return json(res, 200, {
        ...(await snapshotState(ctx, store, pipeline, prepStore)),
        replaced: { count: replacedCount, blocks: replacedBlocks },
      })
    }
    case 'block/update':
      await store.update(state => {
        const article = mustFind(state, body.id)
        notBusy(pipeline, article.id)
        const block = mustBlock(article, body.blockId)
        if (typeof body.expectedText === 'string' && block.text !== body.expectedText) {
          throw Object.assign(new Error('这一段已有新版本，未保存的编辑已保留。'), { status: 409 })
        }
        const value = String(body.text ?? '').replace(/\r\n?/g, '\n').trim().slice(0, 20000)
        if (value === block.text) return
        snapshot(article, '手动改稿')
        if (!value) article.blocks = article.blocks.filter(b => b !== block)
        else {
          const [first, ...rest] = splitMarkdown(value, { bodyOnly: true }).blocks
          block.text = first
          if (rest.length) article.blocks.splice(article.blocks.indexOf(block) + 1, 0,
            ...rest.map(text => ({ id: newId(), text, check: null })))
          // 自己动手改过的段落，旧的检测结论不再作数
          block.check = null
        }
        touch(article)
      })
      return ok()
    case 'layout/preferences': {
      if (!STYLES.includes(body.style) || !THEMES.includes(body.theme)) {
        return json(res, 400, { error: '请选择有效的正文风格和配色。' })
      }
      await store.update(state => {
        const article = mustFind(state, body.id)
        article.layoutPreferences = { style: body.style, theme: body.theme }
        state.lastLayoutPreferences = { ...article.layoutPreferences }
      })
      return ok()
    }
    case 'layout/follow-card': {
      if (typeof body.enabled !== 'boolean') return json(res, 400, { error: '请指定是否显示文末关注卡。' })
      await store.update(state => { mustFind(state, body.id).followCard = body.enabled })
      return ok()
    }
    case 'layout/end-mark': {
      if (!END_MARK_STYLE_IDS.includes(body.style)) return json(res, 400, { error: '请选择有效的文末标识样式。' })
      await store.update(state => {
        const article = mustFind(state, body.id)
        article.endMark = body.style
        state.lastEndMark = body.style
      })
      return ok()
    }
    case 'banner/style': {
      if (!BANNER_CHOICES.includes(body.style)) throw Object.assign(new Error('没有这种横幅风格'), { status: 400 })
      const article = await store.update(state => {
        const target = mustFind(state, body.id)
        target.bannerStyle = body.style
        touch(target)
        return target
      })
      if (body.style !== 'none' && !article.banners?.[body.style] && !pipeline.job(article.id)) pipeline.banner(article.id)
      return ok()
    }
    case 'banner/generate': {
      const article = mustFind(await store.read(), body.id)
      if ((article.bannerStyle ?? DEFAULT_BANNER) === 'none') throw Object.assign(new Error('当前设置是不要横幅'), { status: 400 })
      if (!article.blocks.length) throw Object.assign(new Error('先有正文，才能做横幅'), { status: 400 })
      pipeline.banner(article.id)
      return ok()
    }
    case 'block/fix': {
      const article = mustFind(await store.read(), body.id)
      mustBlock(article, body.blockId)
      pipeline.fix(article.id, body.blockId)
      return ok()
    }
    case 'block/fix-all': {
      const article = mustFind(await store.read(), body.id)
      if (!fixPlan(article).picked.length) throw Object.assign(new Error('没有需要处理的标红段'), { status: 400 })
      pipeline.fixAll(article.id)
      return ok()
    }
    case 'job/stop':
      pipeline.stop(mustFind(await store.read(), body.id).id)
      return ok()
    case 'block/keep':
      await store.update(state => {
        const article = mustFind(state, body.id)
        const block = mustBlock(article, body.blockId)
        block.check = { ...(block.check ?? {}), status: 'kept' }
        touch(article)
      })
      return ok()
    case 'block/restore-revision':
      await store.update(state => {
        const article = mustFind(state, body.id)
        notBusy(pipeline, article.id)
        const block = mustBlock(article, body.blockId)
        const previous = article.history.findLast(entry => entry.blocks.some(item => item.id === block.id && item.text !== block.text))
          ?.blocks.find(item => item.id === block.id)?.text ?? block.prev
        if (block.text !== body.expectedText || previous !== body.previousText || previous == null || previous === block.text) {
          throw Object.assign(new Error('这段文字或对比版本已变化，请关闭后重新打开对比。'), { status: 409 })
        }
        snapshot(article, '恢复段落上一版')
        block.text = previous
        block.prev = null
        block.check = null
        touch(article)
      })
      return ok()
    case 'block/revert':
      await store.update(state => {
        const article = mustFind(state, body.id)
        notBusy(pipeline, article.id)
        const block = mustBlock(article, body.blockId)
        if (!block.prev) throw Object.assign(new Error('这一段没有上一版'), { status: 400 })
        snapshot(article, '退回上一版')
        block.text = block.prev
        block.prev = null
        block.check = { status: 'kept', round: block.check?.round }
        touch(article)
      })
      return ok()
    case 'undo':
      await store.update(state => {
        const article = mustFind(state, body.id)
        notBusy(pipeline, article.id)
        if (article.history.at(-1)?.reimportBefore && imageJobMap(store).has(article.id)) {
          throw importConflict('图片转存完成后可恢复覆盖前版本。')
        }
        const label = undo(article)
        if (label) article.notice = { text: `已撤销：${label}`, at: new Date().toISOString() }
      })
      return ok()
    case 'notice/clear':
      await store.update(state => { mustFind(state, body.id).notice = null })
      return ok()
    case 'settings': {
      const next = await updateSettings(store.root, body)
      setModelOverride(next.model)
      return json(res, 200, { ...publicSettings(next), version: VERSION })
    }
    case 'zhuque/test': {
      // 用一句固定的话试一次，确认密钥和接口地址能用。填了新密钥就试新的，没填就试已保存的。
      const settings = await readSettings(store.root)
      const key = typeof body.zhuqueKey === 'string' && body.zhuqueKey.trim() ? body.zhuqueKey.trim() : settings.zhuqueKey
      const endpoint = typeof body.zhuqueEndpoint === 'string' && body.zhuqueEndpoint.trim() ? body.zhuqueEndpoint.trim() : settings.zhuqueEndpoint
      const result = await detect('今天下楼取快递的时候，发现小区门口新开了一家面馆，排队的人不少，我就没进去。', { key, endpoint, fetchImpl: deps.fetchImpl })
      return json(res, 200, { ok: true, tokens: result.tokens })
    }
    case 'wechat/verify': {
      // 验证公众号凭证能不能换到 access_token。填了新的就用新的，没填就用已保存的。
      const settings = await readSettings(store.root)
      const appId = typeof body.mpAppId === 'string' && body.mpAppId.trim() ? body.mpAppId.trim() : settings.mp.appId
      const appSecret = typeof body.mpAppSecret === 'string' && body.mpAppSecret.trim() ? body.mpAppSecret.trim() : settings.mp.appSecret
      if (!appId || !appSecret) throw Object.assign(new Error('请先填写 AppID 和 AppSecret 再验证。'), { status: 400 })
      const { nickname, headImg } = await verifyCredentials(appId, appSecret, deps.fetchImpl)
      if (headImg) {
        await cacheMpHeadImg(store.root, appId, headImg)
      }
      return json(res, 200, { ok: true, nickname, headImg })
    }
    case 'wechat/draft': {
      // 页面把排版好的 HTML（横幅 + 正文，和复制到公众号的同一份）发上来，推到草稿箱。
      const article = mustFind(await store.read(), body.id)
      if (typeof body.html !== 'string' || !body.html.trim()) throw Object.assign(new Error('没有要推送的正文，先回到排版预览再推送。'), { status: 400 })
      const settings = await readSettings(store.root)
      const cover = latestCover(article)
      let coverImage = null
      if (cover) {
        try {
          coverImage = { buffer: await readCover(store.root, cover.id, cover.format), format: cover.format }
        } catch {
          // 本地封面文件缺失时降级用占位图，推送照常进行
        }
      }
      const result = await pushWechatDraft({ article, html: body.html, settings, cover: coverImage, fetchImpl: deps.fetchImpl })
      // 返回完整快照和其它 act 一样，warnings 让页面在推送成功后也能看到占位封面这类提醒
      return json(res, 200, { ...(await snapshotState(ctx, store, pipeline, prepStore)), ok: true, mediaId: result.mediaId, warnings: result.warnings })
    }
    case 'zhuque/detect': {
      const article = mustFind(await store.read(), body.id)
      if (!article.blocks.length) throw Object.assign(new Error('这篇文章还没有正文'), { status: 400 })
      const settings = await readSettings(store.root)
      if (!settings.zhuqueKey) throw Object.assign(new Error('还没有设置朱雀 API Key，点右上角的齿轮去设置'), { status: 400 })
      pipeline.detect(article.id, { key: settings.zhuqueKey, endpoint: settings.zhuqueEndpoint, fixedLines: settings.fixedLines })
      return ok()
    }
    case 'insights/match': {
      const key = String(body.key ?? '')
      await deps.insightsStore.update(async state => {
        if (!state.tendency?.articles.some(a => a.key === key)) throw Object.assign(new Error('没有这篇导出文章'), { status: 404 })
        if (body.articleId === 'auto') delete state.matches[key]
        else if (body.articleId == null) state.matches[key] = null
        else {
          const draft = (await store.read()).articles.find(a => a.id === body.articleId)
          if (!draft) throw Object.assign(new Error('没有这篇稿件'), { status: 404 })
          state.matches[key] = body.articleId
        }
      })
      return json(res, 200, await insightsView(deps, body.range))
    }
    case 'insights/hook': {
      const key = String(body.key ?? '')
      const hook = body.hook == null ? null : String(body.hook)
      if (hook != null && !HOOK_IDS.includes(hook)) return json(res, 400, { error: '没有这种钩子类型' })
      await deps.insightsStore.update(state => {
        if (!state.tendency?.articles.some(a => a.key === key)) throw Object.assign(new Error('没有这篇导出文章'), { status: 404 })
        if (hook == null) delete state.hooks[key]
        else state.hooks[key] = hook
      })
      return json(res, 200, await insightsView(deps, body.range))
    }
    case 'insights/rule-preview': {
      const [insights, state] = await Promise.all([deps.insightsStore.read(), store.read()])
      return json(res, 200, await previewRule(insights, state.articles, String(body.ruleId ?? ''), join(store.root, 'skills'), body.range))
    }
    case 'insights/rule-apply': {
      const [insights, state] = await Promise.all([deps.insightsStore.read(), store.read()])
      const result = await applyRule(insights, state.articles, String(body.ruleId ?? ''), join(store.root, 'skills'), body.range)
      return json(res, 200, result)
    }
    case 'style/analyze': {
      const [state, settings] = await Promise.all([store.read(), readSettings(store.root)])
      const ids = Array.isArray(body.articleIds) ? body.articleIds : []
      const fromStore = ids
        .map(id => state.articles.find(a => a.id === id && !a.archivedAt))
        .filter(Boolean)
        .map(article => ({ title: article.title || article.topic || '未命名文章', text: toMarkdown(article) }))
      const pasted = (Array.isArray(body.pasted) ? body.pasted : [])
        .map(item => ({ title: String(item?.title ?? ''), text: String(item?.text ?? '') }))
      const controller = new AbortController()
      const onClose = () => { if (!res.writableEnded) controller.abort() }
      res.on?.('close', onClose)
      try {
        const result = await analyzeWritingStyle(ctx, [...fromStore, ...pasted], {
          userNote: body.userNote,
          fixedLines: settings.fixedLines,
          signal: controller.signal,
        })
        return json(res, 200, {
          ...result,
          previewMarkdown: await renderStylePreviewMarkdown(store.root, result.profile),
        })
      } finally {
        res.off?.('close', onClose)
      }
    }
    case 'style/render': {
      const profile = normalizeStyleProfile(body.profile)
      return json(res, 200, {
        profile,
        previewMarkdown: await renderStylePreviewMarkdown(store.root, profile),
      })
    }
    case 'style/preview': {
      const profile = normalizeStyleProfile(body.profile)
      const controller = new AbortController()
      const onClose = () => { if (!res.writableEnded) controller.abort() }
      res.on?.('close', onClose)
      try {
        const result = await previewWritingStyle(ctx, profile, body.topic, { signal: controller.signal })
        return json(res, 200, {
          ...result,
          previewMarkdown: await renderStylePreviewMarkdown(store.root, profile),
        })
      } finally {
        res.off?.('close', onClose)
      }
    }
    case 'style/apply': {
      const result = await applyWritingStyle(store.root, body.profile, {
        scopes: body.scopes,
        sampleTitles: body.sampleTitles,
      })
      return json(res, 200, {
        ...result,
        previewMarkdown: await renderStylePreviewMarkdown(store.root, result.state.profile),
        skills: await skillSources(join(store.root, 'skills')),
      })
    }
    case 'derive/generate': {
      const state = await store.read()
      const article = mustFind(state, body.id)
      if (article.archivedAt) return json(res, 409, { error: '归档稿件不能派生，请先恢复。' })
      if (!DERIVE_PLATFORMS.includes(body.platform)) {
        return json(res, 400, { error: `不支持的派生平台：${body.platform}（可选：${DERIVE_PLATFORMS.join('、')}）。` })
      }
      if (article.derivatives?.[body.platform]?.editedAt && body.confirmOverwrite !== true) {
        return json(res, 409, { error: '这份派生稿你手动改过，重新生成会覆盖。', code: 'edited' })
      }
      const jobs = deriveJobSet(store)
      const lockKey = `${article.id}:${body.platform}`
      if (jobs.has(lockKey)) return json(res, 409, { error: '这个平台的派生正在生成，请稍候。' })

      if (body.platform === 'xhs' && body.async === true) {
        jobs.add(lockKey)
        const progressMap = xhsJobMap(store)
        const initialProgress = {
          stage: 'planning',
          totalCards: 0,
          completedCards: [],
          activeCardIndex: 0,
          message: '正在策划整套小红书笔记文案与每页版式蓝图…',
        }
        progressMap.set(article.id, initialProgress)
        await store.update(s => {
          const target = s.articles.find(a => a.id === article.id)
          if (target) target.xhsError = null
        })
        const run = async () => {
          try {
            await generateDerivative(ctx, store, {
              id: article.id,
              platform: 'xhs',
              variant: body.variant,
              designPrompt: typeof body.designPrompt === 'string' ? body.designPrompt : '',
              referenceImages: Array.isArray(body.referenceImages) ? body.referenceImages : [],
              confirmOverwrite: body.confirmOverwrite === true,
              progressive: true,
              onProgress: progress => {
                progressMap.set(article.id, progress)
              },
            })
            await store.update(s => {
              const target = s.articles.find(a => a.id === article.id)
              if (target) target.xhsError = null
            })
          } catch (err) {
            await store.update(s => {
              const target = s.articles.find(a => a.id === article.id)
              if (target) target.xhsError = err.message || '小红书图文生成失败，请重试。'
            }).catch(() => {})
          } finally {
            progressMap.delete(article.id)
            jobs.delete(lockKey)
          }
        }
        void run()
        return ok()
      }

      jobs.add(lockKey)
      try {
        await generateDerivative(ctx, store, {
          id: article.id,
          platform: body.platform,
          variant: body.variant,
          designPrompt: typeof body.designPrompt === 'string' ? body.designPrompt : '',
          referenceImages: Array.isArray(body.referenceImages) ? body.referenceImages : [],
          confirmOverwrite: body.confirmOverwrite === true,
        })
      } catch (err) {
        if (err.code) return json(res, err.status || 409, { error: err.message, code: err.code })
        throw err
      } finally {
        jobs.delete(lockKey)
      }
      return ok()
    }
    case 'derive/redesign-card': {
      const state = await store.read()
      const article = mustFind(state, body.id)
      const cardIndex = Number(body.cardIndex)
      if (!Number.isInteger(cardIndex) || cardIndex < 0) {
        return json(res, 400, { error: '无效的卡片页码。' })
      }
      const jobs = deriveJobSet(store)
      const lockKey = `${article.id}:xhs`
      if (jobs.has(lockKey)) return json(res, 409, { error: '小红书卡片正在生成或重设计，请稍候。' })
      jobs.add(lockKey)
      try {
        await redesignXhsCard(ctx, store, {
          id: article.id,
          cardIndex,
          cardPrompt: typeof body.cardPrompt === 'string' ? body.cardPrompt : '',
          referenceImages: Array.isArray(body.referenceImages) ? body.referenceImages : [],
          baseCardHash: typeof body.baseCardHash === 'string' ? body.baseCardHash : '',
        })
      } catch (err) {
        if (err.code) return json(res, err.status || 409, { error: err.message, code: err.code })
        throw err
      } finally {
        jobs.delete(lockKey)
      }
      return ok()
    }
    case 'derive/update': {
      const state = await store.read()
      const article = mustFind(state, body.id)
      await updateDerivative(store, { id: article.id, platform: body.platform, payload: body.payload })
      return ok()
    }
    case 'derive/delete': {
      const state = await store.read()
      const article = mustFind(state, body.id)
      await deleteDerivative(store, { id: article.id, platform: body.platform })
      return ok()
    }
    case 'prep/notes': {
      let image = body.image ?? null
      if (!image && body.imageAssetId) {
        const assetId = String(body.imageAssetId).trim().toLowerCase()
        const candidates = body.ext ? [String(body.ext).trim().toLowerCase()] : ['png', 'jpg', 'gif', 'webp']
        let resolved = null
        for (const ext of candidates) {
          try {
            const { buffer, mimeType } = await readPrepAsset(store.root, assetId, ext)
            resolved = { assetId, ext, mimeType, bytes: buffer.length, ...(body.name ? { name: body.name } : {}) }
            break
          } catch (err) {
            if (err.status !== 404) throw err
          }
        }
        if (!resolved) throw Object.assign(new Error('备稿图片不存在。'), { status: 404 })
        image = resolved
      }
      const note = await prepStore.update(state => addNote(state, {
        text: body.text,
        bagId: body.bagId,
        image,
        pinned: body.pinned,
        included: body.included,
      }))
      return json(res, 200, { note, ...(await prepView(prepStore, store)) })
    }
    case 'prep/notes/update': {
      const noteId = body.id ?? body.noteId
      const patch = {}
      for (const key of ['text', 'bagId', 'pinned', 'included']) {
        if (Object.hasOwn(body, key)) patch[key] = body[key]
      }
      const note = await prepStore.update(state => updateNote(state, noteId, patch))
      return json(res, 200, { note, ...(await prepView(prepStore, store)) })
    }
    case 'prep/notes/delete': {
      const ids = Array.isArray(body.ids) ? body.ids : (body.id ? [body.id] : [])
      const { deleted, deletedIds } = await prepStore.update(state => deleteNotes(state, ids))
      const candidateImages = deleted.map(n => n.image).filter(Boolean)
      await cleanupUnreferencedPrepAssets(store, prepStore, candidateImages)
      return json(res, 200, { deletedIds, ...(await prepView(prepStore, store)) })
    }
    case 'prep/notes/batch': {
      const result = await prepStore.update(state => batchNotes(state, {
        action: body.action,
        noteIds: body.noteIds,
        bagId: body.bagId,
        title: body.title,
        type: body.type,
        targetDate: body.targetDate,
        brief: body.brief,
        onlyFree: body.onlyFree,
        onlyLoose: body.onlyLoose,
      }))
      return json(res, 200, { ...result, ...(await prepView(prepStore, store)) })
    }
    case 'prep/notes/insert-to-article': {
      const articleId = body.articleId ?? body.id
      const noteId = body.noteId
      if (!noteId) throw Object.assign(new Error('请指定要插入的纸条。'), { status: 400 })
      const [articleState, prepState] = await Promise.all([store.read(), prepStore.read()])
      const article = mustFind(articleState, articleId)
      mustActive(article, '归档稿件不能插入素材，请先恢复。')
      notBusy(pipeline, article.id)
      const note = (prepState.notes ?? []).find(n => n.id === noteId)
      if (!note) throw Object.assign(new Error('纸条不存在。'), { status: 404 })

      let insertedText = ''
      let fallback = false
      let uploadedUrl = null

      if (note.kind === 'image' && note.image) {
        const caption = String(note.text || note.image.name || '截图').replace(/[\r\n]+/g, ' ').trim()
        const safeAlt = caption.replace(/([\\[\]])/g, '\\$1')
        const settings = await readSettings(store.root)
        const cloudinary = settings.cloudinary
        const hasCloudinary = Boolean(cloudinary?.cloudName && cloudinary?.apiKey && cloudinary?.apiSecret)
        if (hasCloudinary) {
          if (note.image.cloudinaryUrl) {
            uploadedUrl = note.image.cloudinaryUrl
          } else {
            const { buffer } = await readPrepAsset(store.root, note.image.assetId, note.image.ext)
            uploadedUrl = await uploadLocalImage(buffer, cloudinary, deps.fetchImpl)
            await prepStore.update(state => {
              const target = state.notes.find(n => n.id === note.id)
              if (target?.image) {
                target.image.cloudinaryUrl = uploadedUrl
                target.updatedAt = new Date().toISOString()
              }
            })
          }
          insertedText = `![${safeAlt}](${uploadedUrl})`
        } else {
          fallback = true
          insertedText = `[截图：${caption}]`
        }
      } else {
        insertedText = String(note.text ?? '').replace(/\r\n?/g, '\n').trim()
        if (!insertedText) throw Object.assign(new Error('纸条内容为空，无法插入。'), { status: 400 })
      }

      const insertedBlockIds = await store.update(state => {
        const target = mustFind(state, article.id)
        mustActive(target, '归档稿件不能插入素材，请先恢复。')
        notBusy(pipeline, target.id)
        snapshot(target, '插入备稿素材')
        const pieces = splitMarkdown(insertedText, { bodyOnly: true }).blocks
        const newBlocks = (pieces.length ? pieces : [insertedText]).map(text => ({ id: newId(), text, check: null }))
        target.blocks.push(...newBlocks)
        touch(target)
        return newBlocks.map(b => b.id)
      })

      const stateSnap = await snapshotState(ctx, store, pipeline, prepStore)
      return json(res, 200, {
        ...stateSnap,
        fallback,
        insertedText,
        insertedBlockIds,
        ...(uploadedUrl ? { url: uploadedUrl } : {}),
        ...(fallback ? { warnings: ['未配置图床，已插入截图占位'] } : {}),
      })
    }
    case 'prep/bags': {
      const bag = await prepStore.update(state => addBag(state, {
        title: body.title,
        type: body.type,
        targetDate: body.targetDate,
        brief: body.brief,
      }))
      return json(res, 200, { bag, ...(await prepView(prepStore, store)) })
    }
    case 'prep/bags/update': {
      const bagId = body.id ?? body.bagId
      const patch = {}
      for (const key of ['title', 'type', 'targetDate', 'brief', 'archived']) {
        if (Object.hasOwn(body, key)) patch[key] = body[key]
      }
      const bag = await prepStore.update(state => updateBag(state, bagId, patch))
      return json(res, 200, { bag, ...(await prepView(prepStore, store)) })
    }
    case 'prep/bags/delete': {
      const bagId = body.id ?? body.bagId
      const result = await prepStore.update(state => deleteBag(state, bagId, { keepNotes: body.keepNotes !== false }))
      if (result.deletedNotes?.length) {
        const candidateImages = result.deletedNotes.map(n => n.image).filter(Boolean)
        await cleanupUnreferencedPrepAssets(store, prepStore, candidateImages)
      }
      return json(res, 200, {
        deletedBagId: result.bag.id,
        releasedNoteIds: result.releasedNoteIds,
        deletedNoteIds: result.deletedNotes.map(n => n.id),
        ...(await prepView(prepStore, store)),
      })
    }
    case 'prep/bags/reset-link': {
      const bagId = body.id ?? body.bagId
      const [prepState, articleState] = await Promise.all([prepStore.read(), store.read()])
      if (store.problems.length) {
        throw Object.assign(new Error('部分稿件读取异常，暂不允许重置关联。'), { status: 409 })
      }
      const bag = (prepState.bags ?? []).find(b => b.id === bagId)
      if (!bag) throw Object.assign(new Error('选题袋不存在。'), { status: 404 })
      const { status } = deriveLinkedArticleStatus(bag, articleState.articles)
      if (status === 'active' || status === 'archived') {
        throw Object.assign(new Error('关联稿件仍然存在，无法重置关联。'), { status: 409 })
      }
      const updated = await prepStore.update(state => resetDeletedBagLink(state, bagId))
      return json(res, 200, { bag: updated, ...(await prepView(prepStore, store)) })
    }
    case 'prep/bags/promote': {
      if (!store.problems.length && !prepStore.problems.length) {
        await reconcilePrep(prepStore, store)
      }
      const bagId = body.bagId ?? (body.noteIds ? undefined : body.id)
      const promoted = await promoteBag({
        prepStore,
        store,
        bagId,
        noteIds: body.noteIds,
        title: body.title,
        mode: body.mode,
        markdown: body.markdown,
        operationId: body.operationId,
        scheduleTime: body.scheduleTime,
      })

      let imageTransfer = null
      let warnings = []
      const article = (await store.read()).articles.find(a => a.id === promoted.articleId)

      if (promoted.mode === 'import') {
        const settings = await readSettings(store.root)
        imageTransfer = await transferPromotedArticleImages({
          store,
          prepStore,
          articleId: promoted.articleId,
          feishuUrls: promoted.feishuUrls,
          prepAssetRefs: promoted.prepAssetRefs,
          settings,
          fetchImpl: deps.fetchImpl,
        })
        warnings = imageTransfer.warnings ?? []
        if (article && !article.titles.length && body.titles !== false && !pipeline.job(promoted.articleId)) {
          pipeline.titles?.(promoted.articleId)
        }
      } else if (promoted.mode === 'ai') {
        if (article && article.blocks.length === 0 && !pipeline.job(promoted.articleId)) {
          pipeline.draft?.(promoted.articleId)
        }
      }

      const [stateSnap, prepSnap] = await Promise.all([
        snapshotState(ctx, store, pipeline, prepStore),
        prepView(prepStore, store),
      ])
      return json(res, 200, {
        ...stateSnap,
        prep: prepSnap,
        articleId: promoted.articleId,
        bagId: promoted.bagId,
        created: promoted.created,
        mode: promoted.mode,
        scheduledFor: promoted.scheduledFor,
        imageTransfer,
        warnings,
      })
    }
    case 'prep/bags/brief-markdown': {
      const bagId = body.id ?? body.bagId
      const prepState = await prepStore.read()
      const bag = (prepState.bags ?? []).find(b => b.id === bagId)
      if (!bag) throw Object.assign(new Error('选题袋不存在。'), { status: 404 })
      const bagNotes = (prepState.notes ?? []).filter(n => n.bagId === bag.id)
      return json(res, 200, {
        bagId: bag.id,
        markdown: formatBriefMarkdown(bag, bagNotes, { root: store.root }),
      })
    }
    case 'prep/ai/extract-brief': {
      const controller = new AbortController()
      const onClose = () => { if (!res.writableEnded) controller.abort() }
      res.on?.('close', onClose)
      try {
        const brief = await extractBriefFromRaw(ctx, body.rawText, { signal: controller.signal })
        return json(res, 200, brief)
      } finally {
        res.off?.('close', onClose)
      }
    }
    case 'prep/ai/cluster-notes': {
      const prepState = await prepStore.read()
      const controller = new AbortController()
      const onClose = () => { if (!res.writableEnded) controller.abort() }
      res.on?.('close', onClose)
      try {
        const clusters = await clusterFreeNotes(ctx, prepState.notes, { signal: controller.signal })
        return json(res, 200, { clusters })
      } finally {
        res.off?.('close', onClose)
      }
    }
    case 'style/restore': {
      const result = await restoreDefaultStyle(store.root, { restoreBackup: body.restoreBackup === true })
      return json(res, 200, {
        ...result,
        previewMarkdown: await renderStylePreviewMarkdown(store.root, result.state.profile),
        skills: await skillSources(join(store.root, 'skills')),
      })
    }
    default:
      return json(res, 404, { error: '没有这个接口' })
  }
}

/**
 * 把 Node IncomingMessage 整理成 DSH 0.2.3+ `connection.admit` 期望的请求事实：
 * headers、socket 和绝对 url（原生的 req.url 只有路径，和宿主 webserver/authorize 对齐）。
 */
export function admissionFacts(req) {
  const headers = req?.headers ?? {}
  const host = headers.host ?? 'localhost'
  const scheme = req?.socket?.encrypted === true ? 'https' : 'http'
  let url
  try {
    url = new URL(req?.url ?? '/', `${scheme}://${host}`).href
  } catch {
    url = `${scheme}://localhost/`
  }
  return { method: req?.method ?? 'GET', headers, socket: req?.socket, url }
}

/**
 * Web 服务不会替插件路由鉴权，每个请求都要自己过一遍 Host/Origin 和登录凭证检查。
 * 兼容 DSH < 0.2.3 的 `connection.requestRejection` 和 DSH 0.2.3+ 的 `connection.admit`。
 * 拿不到鉴权服务或鉴权调用抛错时一律拒绝。
 */
export function requestRejection(ctx, req) {
  const connection = ctx.get('connection')
  if (typeof connection?.requestRejection === 'function') {
    try {
      return connection.requestRejection({ headers: req?.headers ?? {} })
    } catch {
      return 403
    }
  }
  if (typeof connection?.admit === 'function') {
    try {
      const answer = connection.admit(admissionFacts(req))
      return typeof answer?.rejection === 'number' ? answer.rejection : answer ? undefined : 403
    } catch {
      return 403
    }
  }
  return 403
}

export function createHandler(ctx, { store = new Store(), prepStore = new JsonStore(store.root, { file: 'prep.json', empty: PREP_EMPTY }), fetchImpl, getAuthCtx } = {}) {
  const pipeline = new Pipeline({ ctx, store, skillsDir: join(store.root, 'skills'), fetchImpl })
  const insightsStore = new JsonStore(store.root, { file: 'insights.json', empty: INSIGHTS_EMPTY })
  const versionChecker = createVersionChecker({ currentVersion: VERSION, fetchImpl })
  const deps = { ctx, store, prepStore, pipeline, insightsStore, versionChecker, fetchImpl }
  const startupReady = (async () => {
    const [state] = await Promise.all([store.read(), prepStore.read()])
    for (const problem of [...store.problems, ...prepStore.problems]) {
      const warn = ctx.get('logger')?.warn
      if (typeof warn === 'function') warn(problem.message)
      else console.warn(problem.message)
    }
    // 有稿件没加载出来时，无法判断哪些插图是孤儿，宁可不清。
    if (!store.problems.length) {
      await removeOrphanInlineImages(store.root, state.articles)
    }
    if (!store.problems.length && !prepStore.problems.length) {
      await reconcilePrep(prepStore, store)
      const latestPrep = await prepStore.read()
      await removeOrphanPrepAssets(store.root, latestPrep, state.articles)
    }
  })().catch(() => {})
  // 启动时恢复用户在插件里选过的模型
  readSettings(store.root).then(saved => setModelOverride(saved.model)).catch(() => {})
  return async (req, res) => {
    await startupReady
    try {
      const rejection = requestRejection(getAuthCtx ? getAuthCtx() : ctx, req)
      if (rejection) return json(res, rejection, { error: '未授权' })
      await route(deps, req, res)
    } catch (err) {
      if (res.headersSent) return res.end()
      json(res, err.status || 500, { error: err.message, ...(err.code ? { code: err.code } : {}) })
    }
  }
}

export const name = 'dsh-wechat-studio'

export default {
  inject: ['webServer', 'connection'],
  apply(ctx) {
    // DSH 0.2.3+ 的 `connection.admit` 会经由调用方 ctx 读取 `connection.authentication`。
    // 用可选子作用域声明该依赖：旧宿主（< 0.2.3）没有此服务时不影响插件挂载，新宿主提供后自动切过去。
    let authCtx
    if (typeof ctx.inject === 'function') {
      ctx.effect(() => {
        const scope = ctx.inject(['connection', 'connection.authentication'], loginCtx => {
          authCtx = loginCtx
          return () => {
            if (authCtx === loginCtx) authCtx = undefined
          }
        })
        return () => {
          authCtx = undefined
          void Promise.resolve(scope?.dispose?.()).catch(() => {})
        }
      }, 'dsh-wechat-studio: connection.authentication scope')
    }
    const handler = createHandler(ctx, { getAuthCtx: () => authCtx ?? ctx })
    ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/wechat-studio', handler }), 'dsh-wechat-studio: /wechat-studio routes')
  },
}

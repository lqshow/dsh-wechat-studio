import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { callModel, extractJson } from './ai.js'
import { createArticle, newId, setSchedule, touch } from './article.js'
import { detectImageFormat, MAX_LOCAL_IMAGE, transferFeishuImages, uploadLocalImage } from './cloudinary.js'
import { feishuImageUrls, markdownImageDestinations, replaceFeishuImages } from './markdown-images.js'
import { atOn, parseDay, scheduleTime as parseScheduleTime } from './schedule-time.js'

/** 备稿存储初始结构。 */
export const PREP_EMPTY = { v: 1, bags: [], notes: [] }

/** 备稿服务端强制容量与字段限额。 */
export const PREP_LIMITS = Object.freeze({
  maxBags: 200,
  maxNotes: 2000,
  maxNotesPerBag: 200,
  maxBagTitle: 120,
  maxNoteText: 4000,
  maxPartner: 60,
  maxSellingPoints: 500,
  maxListItems: 20,
  maxListItemLength: 120,
  maxRawText: 20000,
  maxAssetBytes: MAX_LOCAL_IMAGE,
  orphanMaxAgeMs: 24 * 60 * 60 * 1000,
})

const EXT_MIME = Object.freeze({
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
})

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const UUID_CI_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ASSET_FILE_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(png|jpg|gif|webp)$/
const TMP_FILE_RE = /^\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/
const LOCAL_ASSET_REF_RE = /(?:^|[^\w-])(prep-assets[/\\]([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(png|jpg|gif|webp))(?=$|[^a-zA-Z0-9_-])/gi
const URL_ASSET_REF_RE = /(\/?wechat-studio\/prep\/assets\?[^\s)"'<>#]+)/gi
const FIRST_URL_RE = /https?:\/\/[^\s<>'"\u3000-\u303f\uff00-\uffef]+/i

const fail = (message, status = 400) => Object.assign(new Error(message), { status })

function ensureState(state) {
  if (!state || typeof state !== 'object') throw fail('备稿状态对象无效。', 400)
  if (!Array.isArray(state.bags)) state.bags = []
  if (!Array.isArray(state.notes)) state.notes = []
  return state
}

function extractFirstLink(text) {
  const match = FIRST_URL_RE.exec(String(text ?? ''))
  if (!match) return null
  const raw = match[0].replace(/[.,;:!?。，；：！？）】》」』]+$/, '')
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return { url: raw, host: parsed.host }
  } catch {
    return null
  }
}

/**
 * 自动判定纸条类型（image > link > text）并提取首个链接信息。
 * @param {string} text - 纸条正文。
 * @param {object|null|undefined} image - 图片附件元数据。
 * @returns {{ kind: 'image'|'link'|'text', link: { url: string, host: string } | null }}
 */
export function detectNoteKind(text, image) {
  if (image && typeof image === 'object' && image.assetId) {
    return { kind: 'image', link: null }
  }
  const link = extractFirstLink(text)
  if (link) return { kind: 'link', link }
  return { kind: 'text', link: null }
}

function normalizeListField(value, fieldLabel, { truncate = false } = {}) {
  let rawItems
  if (value == null) {
    rawItems = []
  } else if (Array.isArray(value)) {
    rawItems = value.map(item => String(item ?? '').trim()).filter(Boolean)
  } else if (typeof value === 'string') {
    rawItems = value.split(/[\r\n,，]+/).map(item => item.trim()).filter(Boolean)
  } else {
    if (truncate) rawItems = []
    else throw fail(`${fieldLabel}格式无效。`, 400)
  }

  if (truncate) {
    return rawItems
      .slice(0, PREP_LIMITS.maxListItems)
      .map(item => item.slice(0, PREP_LIMITS.maxListItemLength))
  }

  if (rawItems.length > PREP_LIMITS.maxListItems) {
    throw fail(`${fieldLabel}最多只能填写 ${PREP_LIMITS.maxListItems} 条。`, 400)
  }
  for (const item of rawItems) {
    if (item.length > PREP_LIMITS.maxListItemLength) {
      throw fail(`${fieldLabel}单条不能超过 ${PREP_LIMITS.maxListItemLength} 字。`, 400)
    }
  }
  return rawItems
}

/**
 * 规范化并校验商单甲方要点卡字段。
 * @param {object|null|undefined} input - 原始 brief 对象。
 * @param {{ truncate?: boolean }} [options] - 是否截断而非抛错（用于 AI 抽取结果清洗）。
 * @returns {{ partner: string, sellingPoints: string, mustInclude: string[], taboo: string[], rawText: string }}
 */
export function normalizeBrief(input, { truncate = false } = {}) {
  const src = input && typeof input === 'object' ? input : {}
  let partner = typeof src.partner === 'string' ? src.partner.trim() : ''
  let sellingPoints = typeof src.sellingPoints === 'string' ? src.sellingPoints.trim() : ''
  let rawText = typeof src.rawText === 'string' ? src.rawText : ''

  if (truncate) {
    partner = partner.slice(0, PREP_LIMITS.maxPartner)
    sellingPoints = sellingPoints.slice(0, PREP_LIMITS.maxSellingPoints)
    rawText = rawText.slice(0, PREP_LIMITS.maxRawText)
  } else {
    if (partner.length > PREP_LIMITS.maxPartner) {
      throw fail(`合作方名称不能超过 ${PREP_LIMITS.maxPartner} 字。`, 400)
    }
    if (sellingPoints.length > PREP_LIMITS.maxSellingPoints) {
      throw fail(`核心卖点不能超过 ${PREP_LIMITS.maxSellingPoints} 字。`, 400)
    }
    if (rawText.length > PREP_LIMITS.maxRawText) {
      throw fail(`甲方原文不能超过 ${PREP_LIMITS.maxRawText} 字。`, 400)
    }
  }

  const mustInclude = normalizeListField(src.mustInclude, '必带信息', { truncate })
  const taboo = normalizeListField(src.taboo, '禁忌红线', { truncate })
  return { partner, sellingPoints, mustInclude, taboo, rawText }
}

/**
 * 校验并规范化目标日期（YYYY-MM-DD，年份 2000–2100）。
 * @param {string|null|undefined} value - 日期字符串或空值。
 * @returns {string|null}
 */
export function normalizeTargetDate(value) {
  if (value == null) return null
  if (typeof value !== 'string') throw fail('目标日期格式无效，需为 YYYY-MM-DD。', 400)
  const trimmed = value.trim()
  if (!trimmed) return null
  let day
  try {
    day = parseDay(trimmed)
  } catch {
    throw fail('目标日期格式无效，需为有效的 YYYY-MM-DD。', 400)
  }
  const year = day.getFullYear()
  if (year < 2000 || year > 2100) {
    throw fail('目标日期年份须在 2000 至 2100 年之间。', 400)
  }
  return trimmed
}

/**
 * 从文本中提取所有备稿图片引用（支持本地相对路径、绝对 API 路径及相对 API 路径，query 参数顺序无关）。
 * @param {string} text - 待扫描的文本或 Markdown。
 * @returns {Array<{ assetId: string, ext: string | null, raw: string }>}
 */
export function extractPrepAssetRefs(text) {
  if (typeof text !== 'string' || !text) return []
  const matches = []

  LOCAL_ASSET_REF_RE.lastIndex = 0
  let m
  while ((m = LOCAL_ASSET_REF_RE.exec(text)) !== null) {
    const raw = m[1]
    const assetId = m[2].toLowerCase()
    const ext = m[3].toLowerCase()
    const index = m.index + (m[0].length - raw.length)
    matches.push({ index, assetId, ext, raw })
  }

  URL_ASSET_REF_RE.lastIndex = 0
  while ((m = URL_ASSET_REF_RE.exec(text)) !== null) {
    const raw = m[1]
    const qIdx = raw.indexOf('?')
    if (qIdx === -1) continue
    const query = raw.slice(qIdx + 1).replace(/&amp;/g, '&')
    const params = new URLSearchParams(query)
    const idParam = (params.get('id') || '').trim()
    if (!UUID_CI_RE.test(idParam)) continue
    const extParam = (params.get('ext') || '').trim().toLowerCase()
    if (extParam && !Object.hasOwn(EXT_MIME, extParam)) continue
    matches.push({
      index: m.index,
      assetId: idParam.toLowerCase(),
      ext: extParam || null,
      raw,
    })
  }

  matches.sort((a, b) => a.index - b.index)
  return matches.map(({ assetId, ext, raw }) => ({ assetId, ext, raw }))
}

function resolvePrepAssetPath(root, assetId, ext) {
  if (typeof assetId !== 'string' || !UUID_RE.test(assetId)) {
    throw fail('无效的备稿图片标识。', 400)
  }
  if (typeof ext !== 'string' || !Object.hasOwn(EXT_MIME, ext)) {
    throw fail('不支持的备稿图片格式。', 400)
  }
  const dir = resolve(root, 'prep-assets')
  const target = resolve(dir, `${assetId}.${ext}`)
  if (!target.startsWith(dir + sep)) {
    throw fail('无效的备稿图片路径。', 400)
  }
  return { dir, target, mimeType: EXT_MIME[ext] }
}

/**
 * 校验魔数与体积后，将图片原子写入 `<root>/prep-assets/<uuid>.<ext>`。
 * @param {string} root - 存储根目录。
 * @param {Buffer} buffer - 图片原始字节。
 * @param {string} [name] - 可选原始文件名。
 * @returns {Promise<{ assetId: string, ext: string, mimeType: string, bytes: number, name: string }>}
 */
export async function savePrepAsset(root, buffer, name = '') {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw fail('图片内容不能为空。', 400)
  }
  if (buffer.length > PREP_LIMITS.maxAssetBytes) {
    throw fail('本地图片不能超过 10 MB。', 400)
  }
  const format = detectImageFormat(buffer)
  if (!format) {
    throw fail('仅支持 PNG、JPEG、GIF 或 WebP 图片。', 400)
  }
  const assetId = randomUUID()
  const { dir, target } = resolvePrepAssetPath(root, assetId, format.ext)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const temporary = resolve(dir, `.${assetId}.tmp`)
  try {
    await writeFile(temporary, buffer, { mode: 0o600 })
    await rename(temporary, target)
  } catch (err) {
    await rm(temporary, { force: true }).catch(() => {})
    throw Object.assign(new Error(`备稿图片保存失败：${err.message}`), { cause: err })
  }
  const cleanName = typeof name === 'string' ? name.trim().slice(0, 120) : ''
  return {
    assetId,
    ext: format.ext,
    mimeType: format.mimeType,
    bytes: buffer.length,
    name: cleanName,
  }
}

/**
 * 读取 `<root>/prep-assets/<assetId>.<ext>`，严格校验 UUID、扩展名与目录边界。
 * @param {string} root - 存储根目录。
 * @param {string} assetId - UUID 资产 ID。
 * @param {string} ext - 允许的扩展名。
 * @returns {Promise<{ buffer: Buffer, mimeType: string }>}
 */
export async function readPrepAsset(root, assetId, ext) {
  const { target, mimeType } = resolvePrepAssetPath(root, assetId, ext)
  try {
    const buffer = await readFile(target)
    return { buffer, mimeType }
  } catch (err) {
    if (err.code === 'ENOENT') throw fail('备稿图片不存在。', 404)
    throw err
  }
}

/**
 * 检查某个备稿图片资产是否仍被任一纸条或任一文章正文块引用。
 * @param {string} assetId - 资产 UUID。
 * @param {object} prepState - 备稿状态对象。
 * @param {Array<object>} [articles] - 文章列表。
 * @returns {boolean}
 */
export function isPrepAssetReferenced(assetId, prepState, articles = []) {
  if (typeof assetId !== 'string' || !UUID_CI_RE.test(assetId)) return false
  const id = assetId.toLowerCase()

  for (const note of prepState?.notes ?? []) {
    if (note?.image?.assetId && String(note.image.assetId).toLowerCase() === id) return true
    if (note?.text && extractPrepAssetRefs(note.text).some(ref => ref.assetId === id)) return true
  }

  for (const article of articles ?? []) {
    const blockSets = [article?.blocks, ...(article?.history ?? []).map(entry => entry?.blocks)]
    for (const blocks of blockSets) {
      for (const block of blocks ?? []) {
        if (extractPrepAssetRefs(block?.text).some(ref => ref.assetId === id)) return true
        if (extractPrepAssetRefs(block?.prev).some(ref => ref.assetId === id)) return true
      }
    }
  }

  return false
}

/**
 * 回收 `<root>/prep-assets/` 中未被引用且超过 maxAgeMs 的孤儿文件。
 * @param {string} root - 存储根目录。
 * @param {object} prepState - 备稿状态对象。
 * @param {Array<object>} [articles] - 文章列表。
 * @param {{ maxAgeMs?: number, now?: number }} [options] - 清理选项。
 * @returns {Promise<{ removed: string[] }>}
 */
export async function removeOrphanPrepAssets(
  root,
  prepState,
  articles = [],
  { maxAgeMs = PREP_LIMITS.orphanMaxAgeMs, now = Date.now() } = {},
) {
  const dir = resolve(root, 'prep-assets')
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (err) {
    if (err.code === 'ENOENT') return { removed: [] }
    throw err
  }

  const removed = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const fileMatch = ASSET_FILE_RE.exec(entry.name)
    const isTmp = TMP_FILE_RE.test(entry.name)
    if (!fileMatch && !isTmp) continue

    if (fileMatch && isPrepAssetReferenced(fileMatch[1], prepState, articles)) {
      continue
    }

    const fullPath = resolve(dir, entry.name)
    if (!fullPath.startsWith(dir + sep)) continue

    let st
    try {
      st = await stat(fullPath)
    } catch {
      continue
    }
    if (now - st.mtimeMs < maxAgeMs) continue

    await rm(fullPath, { force: true })
    removed.push(entry.name)
  }

  return { removed }
}

function normalizeImageMeta(image) {
  if (image == null) return null
  if (typeof image !== 'object') throw fail('图片元数据格式无效。', 400)
  const assetId = typeof image.assetId === 'string' ? image.assetId.trim() : ''
  const ext = typeof image.ext === 'string' ? image.ext.trim().toLowerCase() : ''
  if (!UUID_RE.test(assetId) || !Object.hasOwn(EXT_MIME, ext)) {
    throw fail('图片附件标识或格式无效。', 400)
  }
  const bytes = Number(image.bytes ?? 0)
  if (!Number.isFinite(bytes) || bytes < 0 || bytes > PREP_LIMITS.maxAssetBytes) {
    throw fail('图片附件大小无效。', 400)
  }
  const normalized = {
    assetId,
    ext,
    mimeType: EXT_MIME[ext],
    bytes,
  }
  if (typeof image.name === 'string' && image.name.trim()) {
    normalized.name = image.name.trim().slice(0, 120)
  }
  if (typeof image.cloudinaryUrl === 'string' && image.cloudinaryUrl.trim()) {
    normalized.cloudinaryUrl = image.cloudinaryUrl.trim()
  }
  return normalized
}

function countBagNotes(state, bagId) {
  let count = 0
  for (const note of state.notes) {
    if (note.bagId === bagId) count += 1
  }
  return count
}

/**
 * 新增一条纸条。
 * @param {object} state - 备稿状态（原地修改）。
 * @param {object} input - 纸条输入。
 * @returns {object} 新建的纸条对象。
 */
export function addNote(state, input = {}) {
  ensureState(state)
  if (state.notes.length >= PREP_LIMITS.maxNotes) {
    throw fail(`纸条总数已达上限（${PREP_LIMITS.maxNotes} 条）。`, 400)
  }
  const text = typeof input.text === 'string' ? input.text.trim() : ''
  if (text.length > PREP_LIMITS.maxNoteText) {
    throw fail(`单条纸条正文不能超过 ${PREP_LIMITS.maxNoteText} 字。`, 400)
  }
  const image = normalizeImageMeta(input.image)
  if (!text && !image) {
    throw fail('纸条内容不能为空。', 400)
  }

  const now = input.now || new Date().toISOString()
  let bagId = null
  let targetBag = null
  if (input.bagId != null && input.bagId !== '') {
    targetBag = state.bags.find(b => b.id === input.bagId)
    if (!targetBag) throw fail('目标选题袋不存在。', 404)
    if (countBagNotes(state, targetBag.id) >= PREP_LIMITS.maxNotesPerBag) {
      throw fail(`单个选题袋最多容纳 ${PREP_LIMITS.maxNotesPerBag} 条想法。`, 400)
    }
    bagId = targetBag.id
  }

  const { kind, link } = detectNoteKind(text, image)
  const note = {
    id: newId('note'),
    text,
    kind,
    link,
    image,
    bagId,
    pinned: bagId ? Boolean(input.pinned) : false,
    included: input.included === undefined ? true : Boolean(input.included),
    createdAt: now,
    updatedAt: now,
  }
  state.notes.push(note)
  if (targetBag) targetBag.updatedAt = now
  return note
}

/**
 * 更新一条纸条的正文、归属袋、置顶或纳入状态。
 * @param {object} state - 备稿状态（原地修改）。
 * @param {string} id - 纸条 ID。
 * @param {object} patch - 更新字段。
 * @returns {object} 更新后的纸条对象。
 */
export function updateNote(state, id, patch = {}) {
  ensureState(state)
  const note = state.notes.find(n => n.id === id)
  if (!note) throw fail('纸条不存在。', 404)

  const now = patch.now || new Date().toISOString()

  let nextText
  if (patch.text !== undefined) {
    nextText = typeof patch.text === 'string' ? patch.text.trim() : ''
    if (nextText.length > PREP_LIMITS.maxNoteText) {
      throw fail(`单条纸条正文不能超过 ${PREP_LIMITS.maxNoteText} 字。`, 400)
    }
    if (!nextText && !note.image) {
      throw fail('纸条内容不能为空。', 400)
    }
  }

  if (patch.bagId !== undefined) {
    const nextBagId = patch.bagId || null
    if (nextBagId !== note.bagId) {
      let nextBag = null
      if (nextBagId) {
        nextBag = state.bags.find(b => b.id === nextBagId)
        if (!nextBag) throw fail('目标选题袋不存在。', 404)
        if (countBagNotes(state, nextBag.id) >= PREP_LIMITS.maxNotesPerBag) {
          throw fail(`单个选题袋最多容纳 ${PREP_LIMITS.maxNotesPerBag} 条想法。`, 400)
        }
      }
      if (note.bagId) {
        const oldBag = state.bags.find(b => b.id === note.bagId)
        if (oldBag) oldBag.updatedAt = now
      }
      note.bagId = nextBagId
      if (!nextBagId) note.pinned = false
      if (nextBag) nextBag.updatedAt = now
    }
  }

  if (nextText !== undefined) {
    note.text = nextText
    const detected = detectNoteKind(note.text, note.image)
    note.kind = detected.kind
    note.link = detected.link
  }

  if (patch.pinned !== undefined) {
    note.pinned = note.bagId ? Boolean(patch.pinned) : false
  }
  if (patch.included !== undefined) {
    note.included = Boolean(patch.included)
  }
  if (patch.cloudinaryUrl !== undefined && note.image) {
    note.image.cloudinaryUrl = patch.cloudinaryUrl ? String(patch.cloudinaryUrl) : undefined
  }

  note.updatedAt = now
  return note
}

/**
 * 批量删除纸条。
 * @param {object} state - 备稿状态（原地修改）。
 * @param {string|string[]} ids - 待删除纸条 ID 列表。
 * @returns {{ deleted: object[], deletedIds: string[] }}
 */
export function deleteNotes(state, ids) {
  ensureState(state)
  const idList = Array.isArray(ids) ? ids : [ids]
  const idSet = new Set(idList.filter(id => typeof id === 'string' && id))
  if (idSet.size === 0) return { deleted: [], deletedIds: [] }

  const now = new Date().toISOString()
  const deleted = []
  const kept = []
  const touchedBagIds = new Set()

  for (const note of state.notes) {
    if (idSet.has(note.id)) {
      deleted.push(note)
      if (note.bagId) touchedBagIds.add(note.bagId)
    } else {
      kept.push(note)
    }
  }

  state.notes = kept
  for (const bag of state.bags) {
    if (touchedBagIds.has(bag.id)) bag.updatedAt = now
  }
  return { deleted, deletedIds: deleted.map(n => n.id) }
}

/**
 * 批量归袋或一键合成新选题袋。
 * @param {object} state - 备稿状态（原地修改）。
 * @param {object} input - `{ action?, noteIds, bagId?, title?, type?, targetDate?, brief?, onlyFree?, onlyLoose? }`。
 * @returns {{ bag: object | null, movedIds: string[], skippedIds: string[] }}
 */
export function batchNotes(state, input = {}) {
  ensureState(state)
  const rawIds = Array.isArray(input.noteIds) ? input.noteIds : []
  const uniqueIds = [...new Set(rawIds.filter(id => typeof id === 'string' && id))]
  if (uniqueIds.length === 0) {
    throw fail('请选择至少一条纸条。', 400)
  }

  if (input.action !== undefined && input.action !== 'create-bag' && input.action !== 'assign') {
    throw fail('无效的批量操作类型。', 400)
  }

  const onlyFree = Boolean(input.onlyFree ?? input.onlyLoose)
  const noteById = new Map(state.notes.map(n => [n.id, n]))
  const eligible = []
  const skippedIds = []

  for (const id of uniqueIds) {
    const note = noteById.get(id)
    if (!note || (onlyFree && note.bagId !== null)) {
      skippedIds.push(id)
    } else {
      eligible.push(note)
    }
  }

  const now = input.now || new Date().toISOString()
  let targetBag
  const creatingBag = input.action ? input.action === 'create-bag' : !input.bagId

  if (!creatingBag) {
    targetBag = state.bags.find(b => b.id === input.bagId)
    if (!targetBag) throw fail('目标选题袋不存在。', 404)
    if (eligible.length === 0) {
      return { bag: targetBag, movedIds: [], skippedIds }
    }
    const incoming = eligible.filter(n => n.bagId !== targetBag.id).length
    if (countBagNotes(state, targetBag.id) + incoming > PREP_LIMITS.maxNotesPerBag) {
      throw fail(`单个选题袋最多容纳 ${PREP_LIMITS.maxNotesPerBag} 条想法。`, 400)
    }
  } else {
    if (eligible.length === 0) {
      return { bag: null, movedIds: [], skippedIds }
    }
    if (eligible.length > PREP_LIMITS.maxNotesPerBag) {
      throw fail(`单个选题袋最多容纳 ${PREP_LIMITS.maxNotesPerBag} 条想法。`, 400)
    }
    targetBag = addBag(state, {
      title: input.title,
      type: input.type,
      targetDate: input.targetDate,
      brief: input.brief,
      now,
    })
  }

  const movedIds = []
  const touchedOldBagIds = new Set()
  for (const note of eligible) {
    if (note.bagId && note.bagId !== targetBag.id) {
      touchedOldBagIds.add(note.bagId)
    }
    note.bagId = targetBag.id
    note.updatedAt = now
    movedIds.push(note.id)
  }

  targetBag.updatedAt = now
  for (const bag of state.bags) {
    if (touchedOldBagIds.has(bag.id)) bag.updatedAt = now
  }

  return { bag: targetBag, movedIds, skippedIds }
}

/**
 * 新建选题袋或商单袋。
 * @param {object} state - 备稿状态（原地修改）。
 * @param {object} input - 袋子输入。
 * @returns {object} 新建的袋子对象。
 */
export function addBag(state, input = {}) {
  ensureState(state)
  if (state.bags.length >= PREP_LIMITS.maxBags) {
    throw fail(`选题袋总数已达上限（${PREP_LIMITS.maxBags} 个）。`, 400)
  }

  const title = typeof input.title === 'string' ? input.title.trim() : ''
  if (!title) throw fail('选题标题不能为空。', 400)
  if (title.length > PREP_LIMITS.maxBagTitle) {
    throw fail(`选题标题不能超过 ${PREP_LIMITS.maxBagTitle} 字。`, 400)
  }

  const type = input.type ?? 'topic'
  if (type !== 'topic' && type !== 'sponsored') {
    throw fail('无效的选题袋类型。', 400)
  }

  const targetDate = normalizeTargetDate(input.targetDate)
  const brief = normalizeBrief(input.brief)
  const now = input.now || new Date().toISOString()

  const bag = {
    id: newId('bag'),
    title,
    type,
    targetDate,
    brief,
    articleId: null,
    pendingPromotion: null,
    promotedAt: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  }
  state.bags.push(bag)
  return bag
}

/**
 * 更新选题袋属性；切换 sponsored → topic 时保留 brief 数据。
 * @param {object} state - 备稿状态（原地修改）。
 * @param {string} id - 选题袋 ID。
 * @param {object} patch - 更新字段。
 * @returns {object} 更新后的袋子对象。
 */
export function updateBag(state, id, patch = {}) {
  ensureState(state)
  const current = state.bags.find(b => b.id === id)
  if (!current) throw fail('选题袋不存在。', 404)
  const bag = { ...current }

  const now = patch.now || new Date().toISOString()

  if (patch.title !== undefined) {
    const title = typeof patch.title === 'string' ? patch.title.trim() : ''
    if (!title) throw fail('选题标题不能为空。', 400)
    if (title.length > PREP_LIMITS.maxBagTitle) {
      throw fail(`选题标题不能超过 ${PREP_LIMITS.maxBagTitle} 字。`, 400)
    }
    bag.title = title
  }

  if (patch.type !== undefined) {
    if (patch.type !== 'topic' && patch.type !== 'sponsored') {
      throw fail('无效的选题袋类型。', 400)
    }
    bag.type = patch.type
  }

  if (patch.targetDate !== undefined) {
    const normalized = normalizeTargetDate(patch.targetDate)
    if (!bag.articleId) bag.targetDate = normalized
  }

  if (patch.brief !== undefined) {
    bag.brief = normalizeBrief({ ...(bag.brief ?? {}), ...(patch.brief ?? {}) })
  }

  if (patch.archived !== undefined) {
    bag.archivedAt = patch.archived ? (bag.archivedAt || now) : null
  } else if (patch.archivedAt !== undefined) {
    bag.archivedAt = patch.archivedAt || null
  }

  bag.updatedAt = now
  return Object.assign(current, bag)
}

/**
 * 删除未成稿选题袋；已成稿袋子返回 409 禁止物理删除。
 * @param {object} state - 备稿状态（原地修改）。
 * @param {string} id - 选题袋 ID。
 * @param {{ keepNotes?: boolean }} [options] - 默认 true，把袋内想法退回自由纸条。
 * @returns {{ bag: object, releasedNoteIds: string[], deletedNotes: object[] }}
 */
export function deleteBag(state, id, { keepNotes = true } = {}) {
  ensureState(state)
  const index = state.bags.findIndex(b => b.id === id)
  if (index === -1) throw fail('选题袋不存在。', 404)

  const bag = state.bags[index]
  if (bag.articleId != null || bag.pendingPromotion != null) {
    throw fail('已成稿的选题袋禁止物理删除，请改用归档。', 409)
  }

  state.bags.splice(index, 1)
  const now = new Date().toISOString()

  if (keepNotes !== false) {
    const releasedNoteIds = []
    for (const note of state.notes) {
      if (note.bagId === id) {
        note.bagId = null
        note.pinned = false
        note.updatedAt = now
        releasedNoteIds.push(note.id)
      }
    }
    return { bag, releasedNoteIds, deletedNotes: [] }
  }

  const deletedNotes = []
  const kept = []
  for (const note of state.notes) {
    if (note.bagId === id) deletedNotes.push(note)
    else kept.push(note)
  }
  state.notes = kept
  return { bag, releasedNoteIds: [], deletedNotes }
}

function sortIncludedNotes(notes) {
  return (notes ?? [])
    .filter(note => note && note.included !== false)
    .slice()
    .sort((a, b) => {
      const pinDiff = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))
      if (pinDiff !== 0) return pinDiff
      const timeDiff = String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''))
      if (timeDiff !== 0) return timeDiff
      return String(a.id ?? '').localeCompare(String(b.id ?? ''))
    })
}

const escapeCell = value => String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim()

function formatNoteBullet(note, root) {
  if (note.kind === 'image' && note.image) {
    const label = note.text || note.image.name || '截图'
    const assetPath = root
      ? join(root, 'prep-assets', `${note.image.assetId}.${note.image.ext}`)
      : `prep-assets/${note.image.assetId}.${note.image.ext}`
    return `- [截图] ${label}（\`${assetPath}\`）`
  }
  return `- ${String(note.text ?? '').replace(/\r?\n/g, '\n  ')}`
}

/**
 * 确定性生成结构化「备料单 Markdown」（供站外写作复制与 CLI 导出共用）。
 * @param {object} bag - 选题袋对象。
 * @param {Array<object>} notes - 袋内纸条列表。
 * @param {{ root?: string }} [options] - 可选存储根目录，用于拼接本地图片路径。
 * @returns {string}
 */
export function formatBriefMarkdown(bag, notes, { root } = {}) {
  const lines = [`# ${bag?.title ?? '未命名选题'}`, '']
  lines.push(`- 类型：${bag?.type === 'sponsored' ? '商单' : '普通选题'}`)
  if (bag?.targetDate) lines.push(`- 目标日期：${bag.targetDate}`)

  if (bag?.type === 'sponsored') {
    const brief = normalizeBrief(bag.brief, { truncate: true })
    lines.push('', '## 甲方要点', '')
    lines.push('| 项目 | 内容 |')
    lines.push('| :--- | :--- |')
    lines.push(`| 合作方 | ${escapeCell(brief.partner) || '-'} |`)
    lines.push(`| 核心卖点 | ${escapeCell(brief.sellingPoints) || '-'} |`)
    lines.push(`| 必带信息 | ${brief.mustInclude.length ? escapeCell(brief.mustInclude.join(' / ')) : '-'} |`)
    lines.push(`| 禁忌红线 | ${brief.taboo.length ? escapeCell(brief.taboo.join(' / ')) : '-'} |`)
  }

  const included = sortIncludedNotes(notes)
  const pinned = included.filter(n => n.pinned)
  const normal = included.filter(n => !n.pinned)

  lines.push('', '## 备料想法')
  if (included.length === 0) {
    lines.push('', '- （暂无已纳入的想法）')
  } else {
    if (pinned.length > 0) {
      lines.push('', '### ★ 核心切入点', '')
      for (const note of pinned) lines.push(formatNoteBullet(note, root))
    }
    if (normal.length > 0) {
      if (pinned.length > 0) lines.push('', '### 其他想法', '')
      else lines.push('')
      for (const note of normal) lines.push(formatNoteBullet(note, root))
    }
  }

  return `${lines.join('\n')}\n`
}

/**
 * 将选题袋与已纳入纸条整理为供 AI 起草使用的纯文本 material；图片纸条转写为 `[截图：<说明或文件名>]` 线索。
 * @param {object} bag - 选题袋对象。
 * @param {Array<object>} notes - 袋内纸条列表。
 * @returns {string}
 */
export function buildPromotionMaterial(bag, notes) {
  const sections = []

  if (bag?.type === 'sponsored') {
    const brief = normalizeBrief(bag.brief, { truncate: true })
    const briefLines = []
    if (brief.partner) briefLines.push(`合作方：${brief.partner}`)
    if (brief.sellingPoints) briefLines.push(`核心卖点：${brief.sellingPoints}`)
    if (brief.mustInclude.length) briefLines.push(`必带信息：${brief.mustInclude.join('、')}`)
    if (brief.taboo.length) briefLines.push(`禁忌红线：${brief.taboo.join('、')}`)
    if (briefLines.length) {
      sections.push(`【商单约束】\n${briefLines.join('\n')}`)
    }
  }

  const included = sortIncludedNotes(notes)
  if (included.length > 0) {
    const formatItem = note => {
      const prefix = note.pinned ? '★ ' : ''
      if (note.kind === 'image' && note.image) {
        const label = note.text || note.image.name || '图片素材'
        return `- ${prefix}[截图：${label}]`
      }
      return `- ${prefix}${note.text}`
    }
    sections.push(`【备料想法】\n${included.map(formatItem).join('\n')}`)
  }

  return sections.join('\n\n')
}

function toSponsoredSnapshot(brief) {
  const normalized = normalizeBrief(brief, { truncate: true })
  return {
    partner: normalized.partner,
    sellingPoints: normalized.sellingPoints,
    mustInclude: [...normalized.mustInclude],
    taboo: [...normalized.taboo],
  }
}

/**
 * 解析文章当前有效的商单约束（精确 3 分支规则）：
 * 1. 来源袋存在且 type === 'sponsored'（即使已归档）→ 返回实时 bag.brief；
 * 2. 来源袋存在且 type === 'topic' → 返回 null（停止商单体检）；
 * 3. 来源袋缺失或文章无 sourceBagId → 兜底返回 article.sponsoredSnapshot ?? null。
 * @param {object|null|undefined} article - 文章对象。
 * @param {object|null|undefined} prepState - 备稿状态对象。
 * @returns {{ partner: string, sellingPoints: string, mustInclude: string[], taboo: string[] } | null}
 */
export function resolveSponsoredBrief(article, prepState) {
  if (!article || typeof article !== 'object') return null
  if (article.sourceBagId) {
    const bag = (prepState?.bags ?? []).find(b => b && b.id === article.sourceBagId)
    if (bag) {
      return bag.type === 'sponsored' ? toSponsoredSnapshot(bag.brief) : null
    }
  }
  if (article.sponsoredSnapshot && typeof article.sponsoredSnapshot === 'object') {
    return toSponsoredSnapshot(article.sponsoredSnapshot)
  }
  return null
}

/**
 * 根据 Store 中的文章列表推导已成稿袋子的关联状态。
 * @param {object|null|undefined} bag - 选题袋对象。
 * @param {Array<object>} articles - 文章列表。
 * @returns {{ status: 'active'|'archived'|'deleted'|null, article: object|null }}
 */
export function deriveLinkedArticleStatus(bag, articles) {
  if (!bag?.articleId) return { status: null, article: null }
  const article = (articles ?? []).find(a => a && a.id === bag.articleId) ?? null
  if (!article) return { status: 'deleted', article: null }
  if (article.archivedAt != null) return { status: 'archived', article }
  return { status: 'active', article }
}

/**
 * 清除已删除原稿在袋子上的陈旧关联，供用户显式选择「重新升格成稿」前调用。
 * @param {object} state - 备稿状态（原地修改）。
 * @param {string} bagId - 选题袋 ID。
 * @returns {object} 更新后的袋子对象。
 */
export function resetDeletedBagLink(state, bagId) {
  ensureState(state)
  const bag = state.bags.find(b => b.id === bagId)
  if (!bag) throw fail('选题袋不存在。', 404)
  if (bag.pendingPromotion != null) {
    throw fail('选题袋正在升格中，无法重置关联。', 409)
  }
  bag.articleId = null
  bag.promotedAt = null
  delete bag.lastPromotionOp
  delete bag.expiredPromotion
  bag.updatedAt = new Date().toISOString()
  return bag
}

function isPrepAssetDestination(src, ref) {
  if (src === ref.raw || src.startsWith(`${ref.raw}#`)) return true
  if (/^prep-assets[/\\]/i.test(ref.raw) && !/^https?:\/\//i.test(src)) {
    return src.endsWith(`/${ref.raw}`) || src.endsWith(`\\${ref.raw}`)
  }
  return false
}

function matchPrepAssetDestination(src) {
  if (typeof src !== 'string' || !src) return null
  const refs = extractPrepAssetRefs(src)
  for (const ref of refs) {
    if (isPrepAssetDestination(src, ref)) return ref
  }
  return null
}

function extractArticlePrepAssetRefs(article) {
  const seen = new Set()
  const out = []
  for (const block of article?.blocks ?? []) {
    for (const { src } of markdownImageDestinations(block?.text ?? '')) {
      const ref = matchPrepAssetDestination(src)
      if (!ref || seen.has(ref.raw)) continue
      seen.add(ref.raw)
      out.push(ref)
    }
  }
  return out
}

const PROMOTE_MODES = new Set(['ai', 'blank', 'import'])

function promotionPayloadHash({ bagId, noteIds, title, mode, markdown, scheduleTime }) {
  const canonical = JSON.stringify({
    bagId: bagId ?? null,
    noteIds: Array.isArray(noteIds) ? [...new Set(noteIds)] : null,
    title: typeof title === 'string' ? title.trim() : null,
    mode,
    markdown: mode === 'import' ? String(markdown ?? '') : '',
    scheduleTime: scheduleTime ?? null,
  })
  return createHash('sha256').update(canonical).digest('hex')
}

function resolvePromotionSchedule(bagTargetDate, explicitScheduleTime) {
  if (explicitScheduleTime != null && explicitScheduleTime !== '') {
    try {
      return parseScheduleTime(explicitScheduleTime)
    } catch {
      throw fail('排期时间格式无效。', 400)
    }
  }
  if (bagTargetDate != null && bagTargetDate !== '') {
    try {
      return atOn(bagTargetDate, 20, 0)
    } catch {
      throw fail('目标日期格式无效，无法生成排期时间。', 400)
    }
  }
  return null
}

/**
 * 跨 Store 轻量对账恢复：
 * 1. pendingPromotion 对应文章已存在 → 补完绑定并清除 pendingPromotion；
 * 2. pendingPromotion 对应文章不存在且已超时（> staleMs）→ 清除 pendingPromotion 恢复可重试态；
 * 3. 无 pendingPromotion 但存在 sourceBagId 指向该袋的文章且 bag.articleId 为空 → 自动回绑。
 * @param {object} prepStore - JsonStore 实例。
 * @param {object} store - Store 实例。
 * @param {{ staleMs?: number, now?: number }} [options] - 超时阈值与当前时间戳。
 * @returns {Promise<{ completed: number, cleared: number, relinked: number }>}
 */
export async function reconcilePrep(prepStore, store, { staleMs = 30_000, now = Date.now() } = {}) {
  const articleState = await store.read()
  const articles = articleState?.articles ?? []
  const articleById = new Map()
  const articleBySourceBagId = new Map()
  for (const article of articles) {
    if (!article?.id) continue
    articleById.set(article.id, article)
    if (article.sourceBagId && !articleBySourceBagId.has(article.sourceBagId)) {
      articleBySourceBagId.set(article.sourceBagId, article)
    }
  }

  const currentPrep = await prepStore.read()
  const needsWork = (currentPrep?.bags ?? []).some(
    bag => bag && (bag.pendingPromotion != null || (!bag.articleId && articleBySourceBagId.has(bag.id))),
  )
  if (!needsWork) return { completed: 0, cleared: 0, relinked: 0 }

  return prepStore.update(state => {
    ensureState(state)
    const nowIso = new Date(now).toISOString()
    let completed = 0
    let cleared = 0
    let relinked = 0

    for (const bag of state.bags) {
      if (bag.pendingPromotion) {
        const pending = bag.pendingPromotion
        const matched = articleById.get(pending.articleId) ?? articleBySourceBagId.get(bag.id) ?? null
        if (matched) {
          bag.articleId = matched.id
          bag.promotedAt = bag.promotedAt || matched.createdAt || nowIso
          const promotion = matched.sourceBagPromotion
            ?? (matched.id === pending.articleId ? pending : null)
          if (promotion?.operationId) {
            const { operationId, payloadHash, mode } = promotion
            bag.lastPromotionOp = { operationId, payloadHash, mode }
          }
          delete bag.expiredPromotion
          bag.pendingPromotion = null
          bag.updatedAt = nowIso
          completed += 1
        } else {
          const createdMs = Date.parse(pending.createdAt)
          const ageMs = Number.isFinite(createdMs) ? now - createdMs : Infinity
          if (ageMs > staleMs) {
            bag.expiredPromotion = pending
            bag.pendingPromotion = null
            bag.updatedAt = nowIso
            cleared += 1
          }
        }
      } else if (!bag.articleId) {
        const linked = articleBySourceBagId.get(bag.id)
        if (linked) {
          bag.articleId = linked.id
          bag.promotedAt = bag.promotedAt || linked.createdAt || nowIso
          if (linked.sourceBagPromotion) bag.lastPromotionOp = linked.sourceBagPromotion
          delete bag.expiredPromotion
          bag.pendingPromotion = null
          bag.updatedAt = nowIso
          relinked += 1
        }
      }
    }

    return { completed, cleared, relinked }
  })
}

/**
 * 跨 Store 四步幂等升格协议（预占 → 建稿 → 落定 → 返回供异步流水线触发）。
 * 不使用跨 Store 嵌套锁，支持崩溃对账、同 operationId 幂等重试、载荷冲突检测与慢写竞态防护。
 * @param {object} params
 * @returns {Promise<{ articleId: string, bagId: string, created: boolean, mode: string, scheduledFor: string|null, feishuUrls: string[], prepAssetRefs: Array<{ assetId: string, ext: string|null, raw: string }> }>}
 */
export async function promoteBag({
  prepStore,
  store,
  bagId,
  noteIds,
  title,
  mode,
  markdown,
  operationId,
  scheduleTime,
  testHooks,
} = {}) {
  if (!PROMOTE_MODES.has(mode)) {
    throw fail('无效的成稿模式，仅支持 ai、blank 或 import。', 400)
  }
  if (mode === 'import' && (typeof markdown !== 'string' || !markdown.trim())) {
    throw fail('导入成稿需要提供非空 Markdown 正文。', 400)
  }

  const normalizedBagId = typeof bagId === 'string' && bagId.trim() ? bagId.trim() : null
  const normalizedNoteIds = !normalizedBagId && Array.isArray(noteIds)
    ? [...new Set(noteIds.filter(id => typeof id === 'string' && id))]
    : null

  if (!normalizedBagId && (!normalizedNoteIds || normalizedNoteIds.length === 0)) {
    throw fail('请指定选题袋或选择至少一条自由纸条。', 400)
  }

  let validatedExplicitSchedule = null
  if (scheduleTime != null && scheduleTime !== '') {
    validatedExplicitSchedule = resolvePromotionSchedule(null, scheduleTime)
  }

  const opId = typeof operationId === 'string' && operationId.trim() ? operationId.trim() : randomUUID()
  const payloadHash = promotionPayloadHash({
    bagId: normalizedBagId,
    noteIds: normalizedNoteIds,
    title: typeof title === 'string' ? title : null,
    mode,
    markdown: mode === 'import' ? markdown : '',
    scheduleTime: validatedExplicitSchedule,
  })

  // Step 1: 在 prepStore 中幂等校验并预占 pendingPromotion
  const step1 = await prepStore.update(state => {
    ensureState(state)
    const nowIso = new Date().toISOString()

    // 检查是否已有同一 operationId 的进行中或已完成记录
    const opBag = state.bags.find(
      b => b.pendingPromotion?.operationId === opId || b.lastPromotionOp?.operationId === opId
        || b.expiredPromotion?.operationId === opId,
    )
    if (opBag) {
      if (normalizedBagId && opBag.id !== normalizedBagId) {
        throw fail('操作标识已用于其他选题袋，参数冲突。', 409)
      }
      const storedRecord = opBag.pendingPromotion?.operationId === opId
        ? opBag.pendingPromotion
        : opBag.lastPromotionOp ?? opBag.expiredPromotion
      if (storedRecord?.payloadHash && storedRecord.payloadHash !== payloadHash) {
        throw fail('同一操作标识的升格参数不一致。', 409)
      }

      if (opBag.articleId && !opBag.pendingPromotion) {
        return {
          alreadyFinalized: true,
          bagId: opBag.id,
          articleId: opBag.articleId,
          mode: opBag.lastPromotionOp?.mode || mode,
        }
      }

      const scheduledFor = resolvePromotionSchedule(opBag.targetDate, validatedExplicitSchedule)
      if (opBag.pendingPromotion && opBag.pendingPromotion.operationId !== opId) {
        throw fail('该选题袋正在升格中，请稍后重试。', 409)
      }
      if (!opBag.pendingPromotion) {
        if (opBag.archivedAt) throw fail('已归档的选题袋不能直接升格，请先恢复。', 409)
        opBag.pendingPromotion = { ...storedRecord, createdAt: nowIso }
        delete opBag.expiredPromotion
        opBag.updatedAt = nowIso
      }
      const bagNotes = state.notes.filter(n => n.bagId === opBag.id)
      return {
        alreadyFinalized: false,
        bagId: opBag.id,
        articleId: opBag.pendingPromotion.articleId,
        topic: opBag.title,
        material: buildPromotionMaterial(opBag, bagNotes),
        sponsoredSnapshot: opBag.type === 'sponsored' ? toSponsoredSnapshot(opBag.brief) : null,
        scheduledFor,
      }
    }

    let bag
    if (normalizedBagId) {
      bag = state.bags.find(b => b.id === normalizedBagId)
      if (!bag) throw fail('选题袋不存在。', 404)
      if (bag.archivedAt) throw fail('已归档的选题袋不能直接升格，请先恢复。', 409)
      if (bag.articleId != null) throw fail('该选题袋已成稿，请勿重复升格。', 409)
      if (bag.pendingPromotion != null) throw fail('该选题袋正在升格中，请稍后重试。', 409)
      // 在修改任何状态前校验目标日期，避免失败时污染内存缓存
      const scheduledFor = resolvePromotionSchedule(bag.targetDate, validatedExplicitSchedule)
      const articleId = newId('a')
      bag.pendingPromotion = { operationId: opId, payloadHash, articleId, mode, createdAt: nowIso }
      bag.updatedAt = nowIso
      const bagNotes = state.notes.filter(n => n.bagId === bag.id)
      return {
        alreadyFinalized: false,
        bagId: bag.id,
        articleId,
        topic: bag.title,
        material: buildPromotionMaterial(bag, bagNotes),
        sponsoredSnapshot: bag.type === 'sponsored' ? toSponsoredSnapshot(bag.brief) : null,
        scheduledFor,
      }
    }

    // 多选自由纸条直建模式：先校验自由纸条与标题，再建袋并收拢
    const noteById = new Map(state.notes.map(n => [n.id, n]))
    const eligible = normalizedNoteIds
      .map(id => noteById.get(id))
      .filter(note => note && note.bagId === null)
    if (eligible.length === 0) {
      throw fail('选中的纸条已不存在或均已归入其他袋子。', 400)
    }
    const derivedTitle = (typeof title === 'string' && title.trim())
      ? title.trim()
      : (eligible[0].text || eligible[0].image?.name || '未命名选题').replace(/\s+/g, ' ').trim().slice(0, 24) || '未命名选题'
    if (derivedTitle.length > PREP_LIMITS.maxBagTitle) {
      throw fail(`选题标题不能超过 ${PREP_LIMITS.maxBagTitle} 字。`, 400)
    }
    const scheduledFor = resolvePromotionSchedule(null, validatedExplicitSchedule)

    const { bag: createdBag } = batchNotes(state, {
      noteIds: eligible.map(n => n.id),
      title: derivedTitle,
      onlyLoose: true,
      now: nowIso,
    })
    bag = createdBag
    const articleId = newId('a')
    bag.pendingPromotion = { operationId: opId, payloadHash, articleId, mode, createdAt: nowIso }
    bag.updatedAt = nowIso
    const bagNotes = state.notes.filter(n => n.bagId === bag.id)
    return {
      alreadyFinalized: false,
      bagId: bag.id,
      articleId,
      topic: bag.title,
      material: buildPromotionMaterial(bag, bagNotes),
      sponsoredSnapshot: null,
      scheduledFor,
    }
  })

  if (step1.alreadyFinalized) {
    const articleState = await store.read()
    const existing = (articleState?.articles ?? []).find(a => a.id === step1.articleId)
    if (!existing) {
      throw fail('原关联稿件已删除，请先重置关联后再升格。', 409)
    }
    return {
      articleId: existing.id,
      bagId: step1.bagId,
      created: false,
      mode: step1.mode,
      scheduledFor: existing.scheduledFor ?? null,
      feishuUrls: feishuImageUrls(existing.blocks),
      prepAssetRefs: extractArticlePrepAssetRefs(existing),
    }
  }

  if (testHooks?.afterPending) {
    await testHooks.afterPending({ bagId: step1.bagId, articleId: step1.articleId, operationId: opId })
  }

  // Step 2: 在 store 中幂等创建文章（同时校验 id 与 sourceBagId 防止慢写竞态）
  if (!(await prepStore.read()).bags.some(bag => bag.id === step1.bagId)) {
    throw fail('选题袋已经删除。', 409)
  }
  const requestPromotion = { operationId: opId, payloadHash, mode }
  const step2 = await store.update(state => {
    const existing = state.articles.find(a => a.id === step1.articleId || a.sourceBagId === step1.bagId)
    if (existing) {
      return {
        articleId: existing.id,
        promotion: existing.sourceBagPromotion ?? (existing.id === step1.articleId ? requestPromotion : null),
        created: false,
        scheduledFor: existing.scheduledFor ?? null,
        feishuUrls: feishuImageUrls(existing.blocks),
        prepAssetRefs: extractArticlePrepAssetRefs(existing),
      }
    }

    const article = createArticle({
      id: step1.articleId,
      topic: step1.topic,
      material: step1.material,
      markdown: mode === 'import' ? markdown : '',
      sourceBagId: step1.bagId,
      sponsoredSnapshot: step1.sponsoredSnapshot,
    })
    article.sourceBagPromotion = requestPromotion
    if (step1.scheduledFor) {
      setSchedule(article, step1.scheduledFor)
    }
    if (state.lastLayoutPreferences) article.layoutPreferences = { ...state.lastLayoutPreferences }
    if (state.lastEndMark) article.endMark = state.lastEndMark

    const feishuUrls = feishuImageUrls(article.blocks)
    if (feishuUrls.length) {
      article.imageImport = { error: '图片转存中断，可以重试。', remaining: feishuUrls.length }
    }
    const prepAssetRefs = extractArticlePrepAssetRefs(article)

    state.articles.push(article)
    state.currentId = article.id

    return {
      articleId: article.id,
      promotion: requestPromotion,
      created: true,
      scheduledFor: article.scheduledFor ?? null,
      feishuUrls,
      prepAssetRefs,
    }
  })

  if (testHooks?.afterArticleCreate) {
    await testHooks.afterArticleCreate({
      bagId: step1.bagId,
      articleId: step2.articleId,
      created: step2.created,
      operationId: opId,
    })
  }

  // Step 3: 在 prepStore 中落定 articleId / promotedAt / lastPromotionOp 并清除 pendingPromotion
  const linked = await prepStore.update(state => {
    ensureState(state)
    const bag = state.bags.find(b => b.id === step1.bagId)
    if (!bag) return false
    const nowIso = new Date().toISOString()
    if (!bag.articleId) {
      bag.articleId = step2.articleId
      bag.promotedAt = bag.promotedAt || nowIso
      if (step2.promotion) bag.lastPromotionOp = step2.promotion
      delete bag.expiredPromotion
      bag.pendingPromotion = null
      bag.updatedAt = nowIso
    } else if (bag.pendingPromotion?.operationId === opId) {
      bag.pendingPromotion = null
      bag.updatedAt = nowIso
    }
    return true
  })
  if (!linked) {
    // 删除与建稿交错时，保留已落盘的稿件，解除指向已删除袋子的关联。
    await store.update(state => {
      const article = state.articles.find(a => a.id === step2.articleId && a.sourceBagId === step1.bagId)
      if (!article) return
      delete article.sourceBagId
      delete article.sourceBagPromotion
    })
    throw fail('选题袋已经删除，已保留创建的稿件。', 409)
  }

  // Step 4: 返回结果，由调用方在两侧一致后触发异步流水线 / 图片转存
  if (step2.promotion?.operationId !== opId) {
    throw fail('该选题袋已由其他操作成稿。', 409)
  }
  return {
    articleId: step2.articleId,
    bagId: step1.bagId,
    created: step2.created,
    mode,
    scheduledFor: step2.scheduledFor,
    feishuUrls: step2.feishuUrls,
    prepAssetRefs: step2.prepAssetRefs,
  }
}

/**
 * 共享图片转存器（供 Host 与 CLI 共用）：
 * 将已升格文章中的飞书图片链接与本地 prep-assets 引用上传至 Cloudinary，
 * 复用并回写 prep note 的 cloudinaryUrl 缓存；未配置图床或上传失败时保留原路径并返回明确 warnings。
 * @param {object} params
 * @returns {Promise<{ uploaded: number, failed: number, warnings: string[] }>}
 */
export async function transferPromotedArticleImages({
  store,
  prepStore,
  articleId,
  feishuUrls,
  prepAssetRefs,
  settings,
  fetchImpl = fetch,
} = {}) {
  const articleState = await store.read()
  const targetArticle = (articleState?.articles ?? []).find(a => a.id === articleId)
  if (!targetArticle) {
    return { uploaded: 0, failed: 0, warnings: ['关联文章不存在，已跳过图片转存。'] }
  }

  const uniqueFeishu = [...new Set(
    (Array.isArray(feishuUrls) ? feishuUrls : feishuImageUrls(targetArticle.blocks))
      .filter(u => typeof u === 'string' && u),
  )]
  const rawPrepRefs = Array.isArray(prepAssetRefs) ? prepAssetRefs : extractArticlePrepAssetRefs(targetArticle)
  const assetExtById = new Map()
  for (const ref of rawPrepRefs) {
    if (!ref?.assetId || !UUID_CI_RE.test(ref.assetId)) continue
    const id = ref.assetId.toLowerCase()
    const ext = typeof ref.ext === 'string' && Object.hasOwn(EXT_MIME, ref.ext.toLowerCase())
      ? ref.ext.toLowerCase()
      : null
    if (!assetExtById.has(id) || (!assetExtById.get(id) && ext)) {
      assetExtById.set(id, ext)
    }
  }

  if (uniqueFeishu.length === 0 && assetExtById.size === 0) {
    return { uploaded: 0, failed: 0, warnings: [] }
  }

  const cloudinary = settings?.cloudinary
  const hasCloudinary = Boolean(cloudinary?.cloudName && cloudinary?.apiKey && cloudinary?.apiSecret)
  const warnings = []

  if (!hasCloudinary) {
    if (assetExtById.size > 0) {
      warnings.push(`未配置 Cloudinary，保留了 ${assetExtById.size} 张本地备稿图片路径，发布前请配置图床或手动替换。`)
    }
    if (uniqueFeishu.length > 0) {
      warnings.push(`未配置 Cloudinary，保留了 ${uniqueFeishu.length} 张飞书图片链接，配置图床后可重试转存。`)
      await store.update(state => {
        const current = state.articles.find(a => a.id === articleId)
        if (!current) return
        const remaining = feishuImageUrls(current.blocks).length
        current.imageImport = remaining ? { error: '请先在设置中配置 Cloudinary，再重试图片转存。', remaining } : null
      })
    }
    return { uploaded: 0, failed: 0, warnings }
  }

  let uploaded = 0
  let failed = 0
  const feishuReplacements = new Map()
  let feishuError = null

  if (uniqueFeishu.length > 0) {
    let feishuHandled = 0
    try {
      feishuError = await transferFeishuImages(uniqueFeishu, cloudinary, (url, result) => {
        feishuHandled += 1
        if (result) {
          feishuReplacements.set(url, result)
          uploaded += 1
        } else {
          failed += 1
        }
      }, fetchImpl)
    } catch (err) {
      feishuError = err.message
      failed += Math.max(0, uniqueFeishu.length - feishuHandled)
    }
    if (feishuError) warnings.push(feishuError)
  }

  const prepUrlByAssetId = new Map()
  const newlyUploadedByAssetId = new Map()

  if (assetExtById.size > 0) {
    const prepState = prepStore ? await prepStore.read() : null
    const cachedUrlByAssetId = new Map()
    const noteExtByAssetId = new Map()
    for (const note of prepState?.notes ?? []) {
      const id = note?.image?.assetId ? String(note.image.assetId).toLowerCase() : null
      if (!id) continue
      if (note.image.ext && Object.hasOwn(EXT_MIME, note.image.ext)) {
        noteExtByAssetId.set(id, note.image.ext)
      }
      if (typeof note.image.cloudinaryUrl === 'string' && note.image.cloudinaryUrl.trim()) {
        cachedUrlByAssetId.set(id, note.image.cloudinaryUrl.trim())
      }
    }

    for (const [assetId, refExt] of assetExtById.entries()) {
      const cached = cachedUrlByAssetId.get(assetId)
      if (cached) {
        prepUrlByAssetId.set(assetId, cached)
        continue
      }
      const ext = refExt || noteExtByAssetId.get(assetId) || null
      if (!ext) {
        failed += 1
        warnings.push(`备稿图片 ${assetId} 缺少格式信息，已保留本地路径。`)
        continue
      }
      try {
        const { buffer } = await readPrepAsset(store.root, assetId, ext)
        const publicUrl = await uploadLocalImage(buffer, cloudinary, fetchImpl)
        uploaded += 1
        prepUrlByAssetId.set(assetId, publicUrl)
        newlyUploadedByAssetId.set(assetId, publicUrl)
      } catch (err) {
        failed += 1
        warnings.push(`备稿图片 ${assetId}.${ext} 转存失败：${err.message}`)
      }
    }
  }

  if (feishuReplacements.size > 0 || prepUrlByAssetId.size > 0 || uniqueFeishu.length > 0) {
    await store.update(state => {
      const current = state.articles.find(a => a.id === articleId)
      if (!current) return

      const applyToText = text => {
        if (typeof text !== 'string' || !text) return text
        const replacements = new Map(feishuReplacements)
        if (prepUrlByAssetId.size > 0) {
          for (const { src } of markdownImageDestinations(text)) {
            if (replacements.has(src)) continue
            const matched = matchPrepAssetDestination(src)
            if (matched && prepUrlByAssetId.has(matched.assetId)) {
              replacements.set(src, prepUrlByAssetId.get(matched.assetId))
            }
          }
        }
        return replacements.size > 0 ? replaceFeishuImages(text, replacements) : text
      }

      let changed = false
      const boundary = current.history.findLastIndex(entry => entry.reimportBefore)
      const recent = current.history.slice(boundary + 1)
      const blockSets = [current.blocks, ...recent.map(entry => entry.blocks)]
      for (const blocks of blockSets) {
        for (const block of blocks) {
          const nextText = applyToText(block.text)
          if (nextText !== block.text) {
            block.text = nextText
            changed = true
          }
          if (block.prev) {
            const nextPrev = applyToText(block.prev)
            if (nextPrev !== block.prev) {
              block.prev = nextPrev
              changed = true
            }
          }
        }
      }

      const remainingFeishu = feishuImageUrls(current.blocks).length
      current.imageImport = remainingFeishu
        ? { error: feishuError ?? '还有飞书图片待转存。', remaining: remainingFeishu }
        : null
      if (changed) touch(current)
    })
  }

  if (prepStore && newlyUploadedByAssetId.size > 0) {
    await prepStore.update(state => {
      ensureState(state)
      const nowIso = new Date().toISOString()
      for (const note of state.notes) {
        const assetId = note?.image?.assetId ? String(note.image.assetId).toLowerCase() : null
        if (assetId && newlyUploadedByAssetId.has(assetId)) {
          note.image.cloudinaryUrl = newlyUploadedByAssetId.get(assetId)
          note.updatedAt = nowIso
        }
      }
    })
  }

  return { uploaded, failed, warnings }
}

const EXTRACT_BRIEF_SYSTEM = [
  '你是公众号商单需求提炼助手。请从用户提供的甲方原文/聊天记录中抽取结构化要点。',
  '只输出一个合法 JSON 对象，不要输出任何额外解释或前后缀文字，格式严格为：',
  '{"partner":"","sellingPoints":"","mustInclude":[],"taboo":[],"targetDate":null}',
  '字段约束：',
  `- partner: 字符串，合作方或产品名称，最多 ${PREP_LIMITS.maxPartner} 字，未提及留空字符串。`,
  `- sellingPoints: 字符串，核心卖点摘要，最多 ${PREP_LIMITS.maxSellingPoints} 字，未提及留空字符串。`,
  `- mustInclude: 字符串数组，必带信息（如链接、口令、活动名、引导语），最多 ${PREP_LIMITS.maxListItems} 条，每条不超过 ${PREP_LIMITS.maxListItemLength} 字。`,
  `- taboo: 字符串数组，禁忌红线或避免表述，最多 ${PREP_LIMITS.maxListItems} 条，每条不超过 ${PREP_LIMITS.maxListItemLength} 字。`,
  '- targetDate: 仅当原文明确给出具体公历年月日（YYYY-MM-DD，年份 2000–2100）时填写，否则一律填 null；禁止输出“下周四”“本月底”等相对日期。',
].join('\n')

/**
 * 按需调用模型从甲方原文提炼商单要点；所有模型输出视为不可信，经严格校验与截断后返回建议值。
 * @param {object} ctx - Cordis 上下文。
 * @param {string} rawText - 甲方原文（非空且不超过 20000 字）。
 * @param {{ signal?: AbortSignal, callModelImpl?: typeof callModel }} [options] - 可选取消信号或测试注入函数。
 * @returns {Promise<{ partner: string, sellingPoints: string, mustInclude: string[], taboo: string[], targetDate: string | null }>}
 */
export async function extractBriefFromRaw(ctx, rawText, { signal, callModelImpl = callModel } = {}) {
  if (typeof rawText !== 'string' || !rawText.trim()) {
    throw fail('甲方原文不能为空。', 400)
  }
  if (rawText.length > PREP_LIMITS.maxRawText) {
    throw fail(`甲方原文不能超过 ${PREP_LIMITS.maxRawText} 字。`, 400)
  }

  const user = `请从以下甲方原文中提炼商单要点，仅输出 JSON：\n\n<raw_brief>\n${rawText}\n</raw_brief>`
  const output = await callModelImpl(ctx, {
    system: EXTRACT_BRIEF_SYSTEM,
    user,
    task: 'prep-extract-brief',
    maxTokens: 1200,
    signal,
  })

  const parsed = extractJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw fail('模型未返回有效的 JSON 提炼结果，请重试。', 502)
  }

  const sanitized = normalizeBrief(parsed, { truncate: true })
  let targetDate = null
  if (parsed.targetDate != null) {
    try {
      targetDate = normalizeTargetDate(parsed.targetDate)
    } catch {
      targetDate = null
    }
  }

  return {
    partner: sanitized.partner,
    sellingPoints: sanitized.sellingPoints,
    mustInclude: sanitized.mustInclude,
    taboo: sanitized.taboo,
    targetDate,
  }
}

const CLUSTER_NOTES_SYSTEM = [
  '你是公众号选题编辑助手。请从用户提供的自由灵感纸条中，提炼 1 到 3 组可写的公众号选题角度建议。',
  '只输出一个合法 JSON 对象，不要输出任何额外解释或前后缀文字，格式严格为：',
  '{"clusters":[{"title":"","angle":"","noteIds":["note_1","note_2"]}]}',
  '约束：',
  '- 最多返回 3 组聚类；每组至少关联 2 条高度相关的纸条 ID。',
  '- noteIds 只能使用输入列表里真实存在的纸条 id，禁止编造或修改 id，禁止重复同一个 id。',
  `- title: 简洁具体的选题方向标题，不超过 ${PREP_LIMITS.maxBagTitle} 字。`,
  '- angle: 一句话说明这组纸条组合起来的可写切入角度，不超过 240 字。',
  '- 无法凑出合理聚类时返回 {"clusters":[]}。',
].join('\n')

const MAX_CLUSTERS = 3
const MIN_FREE_NOTES_FOR_CLUSTER = 5
const MAX_CLUSTER_PROMPT_NOTES = 80

/**
 * 按需调用模型从自由纸条池（bagId === null）提炼 1～3 组可写选题建议。
 * 对模型返回的 noteIds 做去重、白名单过滤（剔除不存在/已归袋 ID）、丢弃 <2 条的组，并上限 3 组。
 * @param {object} ctx - Cordis 上下文。
 * @param {Array<object>} notes - 当前纸条列表。
 * @param {{ signal?: AbortSignal, callModelImpl?: typeof callModel }} [options] - 可选取消信号或测试注入函数。
 * @returns {Promise<Array<{ title: string, angle: string, noteIds: string[] }>>}
 */
export async function clusterFreeNotes(ctx, notes, { signal, callModelImpl = callModel } = {}) {
  const freeNotes = (Array.isArray(notes) ? notes : []).filter(
    note => note && typeof note.id === 'string' && note.id && note.bagId === null,
  )
  if (freeNotes.length < MIN_FREE_NOTES_FOR_CLUSTER) {
    throw fail(`至少需要 ${MIN_FREE_NOTES_FOR_CLUSTER} 条自由纸条才能进行角度聚拢。`, 400)
  }

  const allowedIds = new Set(freeNotes.map(n => n.id))
  const noteById = new Map(freeNotes.map(n => [n.id, n]))

  const promptNotes = freeNotes.length > MAX_CLUSTER_PROMPT_NOTES
    ? freeNotes
      .slice()
      .sort((a, b) => String(b.updatedAt ?? b.createdAt ?? '').localeCompare(String(a.updatedAt ?? a.createdAt ?? '')))
      .slice(0, MAX_CLUSTER_PROMPT_NOTES)
    : freeNotes

  const noteLines = promptNotes.map(note => {
    const label = note.kind === 'image' && note.image
      ? `[截图] ${(note.text || note.image.name || '图片素材').replace(/\s+/g, ' ').trim()}`
      : String(note.text ?? '').replace(/\s+/g, ' ').trim()
    return `- id=${note.id} | ${label.slice(0, 300)}`
  })

  const user = `以下是当前自由纸条列表（共 ${promptNotes.length} 条），请提炼 1～3 组可写选题建议，仅输出 JSON：\n\n${noteLines.join('\n')}`
  const output = await callModelImpl(ctx, {
    system: CLUSTER_NOTES_SYSTEM,
    user,
    task: 'prep-cluster-notes',
    maxTokens: 1600,
    signal,
  })

  const parsed = extractJson(output)
  const rawClusters = Array.isArray(parsed)
    ? parsed
    : (parsed && typeof parsed === 'object' && Array.isArray(parsed.clusters) ? parsed.clusters : null)
  if (!rawClusters) {
    throw fail('模型未返回有效的 JSON 聚拢结果，请重试。', 502)
  }

  const clusters = []
  for (const item of rawClusters) {
    if (!item || typeof item !== 'object') continue
    const rawIds = Array.isArray(item.noteIds) ? item.noteIds : []
    const validNoteIds = []
    const seen = new Set()
    for (const id of rawIds) {
      if (typeof id !== 'string' || !allowedIds.has(id) || seen.has(id)) continue
      seen.add(id)
      validNoteIds.push(id)
    }
    if (validNoteIds.length < 2) continue

    const firstNote = noteById.get(validNoteIds[0])
    const fallbackTitle = (firstNote?.text || firstNote?.image?.name || '未命名选题')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 24) || '未命名选题'
    const title = (typeof item.title === 'string' && item.title.trim())
      ? item.title.trim().slice(0, PREP_LIMITS.maxBagTitle)
      : fallbackTitle
    const angle = typeof item.angle === 'string' ? item.angle.trim().slice(0, 240) : ''

    clusters.push({ title, angle, noteIds: validNoteIds })
    if (clusters.length >= MAX_CLUSTERS) break
  }

  return clusters
}

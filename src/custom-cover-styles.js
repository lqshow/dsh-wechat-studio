// 本地自定义封面风格模块：独立风格包存储、两阶段原子落盘、路径/软链/魔数安全预览 IO 与草稿清理。
import { randomBytes, randomUUID } from 'node:crypto'
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { callModel, extractJson, modelVisionSupport } from './ai.js'
import { generateCoverImage } from './cover.js'
import { COVER_PROVIDER_META, COVER_RESOLUTIONS, providerFormats } from './cover-options.js'
import { COVER_STYLES, CUSTOM_COVER_STYLE_LIMITS, extractTemplateSlots, hasPortraitMarkers, isCustomStyleId } from './cover-styles.js'
import { coverPrompt, findBlocked, loadCoverBlocklist } from './cover-prompt.js'
import { parseDataImageUri } from './derive-shared.js'
import { withFileLock } from './store.js'

export const CUSTOM_STYLE_PREVIEW_FILES = new Set(['preview.png', 'preview.jpg', 'preview.jpeg'])
export const CUSTOM_STYLE_REF_FILES = new Set(['style-ref.png', 'style-ref.jpg', 'style-ref.jpeg'])
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PREVIEW_EXTS = ['png', 'jpg', 'jpeg']

function httpError(status, message, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra })
}

function stylesRoot(root) {
  return join(root, 'cover-styles')
}

function draftsRoot(root) {
  return join(root, 'cover-styles', '_drafts')
}

function isInsideDir(parentReal, childReal) {
  const prefix = parentReal.endsWith(sep) ? parentReal : `${parentReal}${sep}`
  return childReal.startsWith(prefix)
}

async function assertRegularNoSymlink(filePath, parentDirReal) {
  const st = await lstat(filePath)
  if (st.isSymbolicLink() || !st.isFile()) {
    throw httpError(400, '非法的文件路径或符号链接。')
  }
  const real = await realpath(filePath)
  if (!isInsideDir(parentDirReal, real)) {
    throw httpError(400, '文件路径超出允许范围。')
  }
  return real
}

async function assertDirNoSymlink(dirPath, parentDirReal) {
  const st = await lstat(dirPath)
  if (st.isSymbolicLink() || !st.isDirectory()) {
    throw httpError(400, '非法的风格目录或符号链接。')
  }
  const real = await realpath(dirPath)
  if (parentDirReal && !isInsideDir(parentDirReal, real)) {
    throw httpError(400, '风格目录超出允许范围。')
  }
  return real
}

export function detectImageContentType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return null
  if (buffer.toString('hex', 0, 8) === '89504e470d0a1a0a') return 'image/png'
  if (buffer.toString('hex', 0, 3) === 'ffd8ff') return 'image/jpeg'
  return null
}

function normalizeMultiline(value) {
  return typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : ''
}

export function validateCustomStyleInput(input, blocklistTerms = []) {
  const name = typeof input?.name === 'string' ? input.name.trim() : ''
  if (!name || name.length > CUSTOM_COVER_STYLE_LIMITS.maxName) {
    throw httpError(400, `风格名称不能为空，且不超过 ${CUSTOM_COVER_STYLE_LIMITS.maxName} 字。`)
  }
  const description = typeof input?.description === 'string' ? input.description.trim() : ''
  if (!description || description.length > CUSTOM_COVER_STYLE_LIMITS.maxDescription) {
    throw httpError(400, `风格简介不能为空，且不超过 ${CUSTOM_COVER_STYLE_LIMITS.maxDescription} 字。`)
  }
  const userRequirement = typeof input?.userRequirement === 'string' ? input.userRequirement.trim() : ''
  if (userRequirement.length > CUSTOM_COVER_STYLE_LIMITS.maxRequirement) {
    throw httpError(400, `风格诉求不能超过 ${CUSTOM_COVER_STYLE_LIMITS.maxRequirement} 字。`)
  }
  const template = normalizeMultiline(input?.template)
  if (!template) {
    throw httpError(400, '提示词模板不能为空。')
  }
  if (template.length > CUSTOM_COVER_STYLE_LIMITS.maxTemplate) {
    throw httpError(400, `提示词模板不能超过 ${CUSTOM_COVER_STYLE_LIMITS.maxTemplate} 字。`)
  }
  const slots = extractTemplateSlots(template)
  if (slots.length < CUSTOM_COVER_STYLE_LIMITS.minSlots) {
    throw httpError(400, `提示词模板至少需要包含 ${CUSTOM_COVER_STYLE_LIMITS.minSlots} 个 {{...}} 占位符（例如标题与视觉核心元素）。`)
  }
  const guidance = normalizeMultiline(input?.guidance)
  if (guidance.length > CUSTOM_COVER_STYLE_LIMITS.maxGuidance) {
    throw httpError(400, `填空指引不能超过 ${CUSTOM_COVER_STYLE_LIMITS.maxGuidance} 字。`)
  }
  const blocked = findBlocked(blocklistTerms, template)
  if (blocked) {
    throw httpError(400, `提示词模板包含封面禁用词「${blocked}」，请换成克制的正面描述后再保存。`)
  }
  const usePortrait = Boolean(input?.usePortrait)
  return {
    name,
    description,
    usePortrait,
    useStyleReference: !usePortrait && Boolean(input?.useStyleReference),
    userRequirement,
    template,
    guidance,
    slots,
  }
}

function safePreviewFileName(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') return null
  if (value.includes('/') || value.includes('\\') || value.includes('..')) return null
  return CUSTOM_STYLE_PREVIEW_FILES.has(value) ? value : null
}

function safeStyleReferenceFileName(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') return null
  if (value.includes('/') || value.includes('\\') || value.includes('..')) return null
  return CUSTOM_STYLE_REF_FILES.has(value) ? value : null
}

async function readStyleDirEntry(stylesDirReal, dirName) {
  if (!isCustomStyleId(dirName)) return { skip: true }
  const styleDir = join(stylesDirReal, dirName)
  let styleDirReal
  try {
    styleDirReal = await assertDirNoSymlink(styleDir, stylesDirReal)
  } catch {
    return { warning: `自定义封面风格 ${dirName} 目录无效或为符号链接，已跳过。` }
  }
  try {
    const metaPath = join(styleDirReal, 'meta.json')
    const templatePath = join(styleDirReal, 'template.txt')
    const guidancePath = join(styleDirReal, 'guidance.txt')
    await assertRegularNoSymlink(metaPath, styleDirReal)
    await assertRegularNoSymlink(templatePath, styleDirReal)
    const [rawMeta, rawTemplate] = await Promise.all([
      readFile(metaPath, 'utf8'),
      readFile(templatePath, 'utf8'),
    ])
    const meta = JSON.parse(rawMeta)
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
      return { warning: `自定义封面风格 ${dirName} 的 meta.json 格式无效，已跳过。` }
    }
    if (meta.id !== dirName || typeof meta.name !== 'string' || !meta.name.trim() || typeof meta.description !== 'string' || !meta.description.trim()) {
      return { warning: `自定义封面风格 ${dirName} 的元数据不完整，已跳过。` }
    }
    const template = normalizeMultiline(rawTemplate)
    if (!template) {
      return { warning: `自定义封面风格 ${dirName} 的模板为空，已跳过。` }
    }
    let guidance = ''
    try {
      await assertRegularNoSymlink(guidancePath, styleDirReal)
      guidance = normalizeMultiline(await readFile(guidancePath, 'utf8'))
    } catch (err) {
      if (err.code !== 'ENOENT') {
        return { warning: `自定义封面风格 ${dirName} 的填空指引读取失败，已跳过。` }
      }
    }
    const previewFile = safePreviewFileName(meta.previewFile)
    const styleReferenceFile = safeStyleReferenceFileName(meta.styleReferenceFile)
    const usePortrait = Boolean(meta.usePortrait)
    const slots = extractTemplateSlots(template)
    return {
      style: {
        version: 1,
        id: dirName,
        source: 'custom',
        name: meta.name.trim(),
        description: meta.description.trim(),
        usePortrait,
        useStyleReference: !usePortrait && Boolean(meta.useStyleReference) && Boolean(styleReferenceFile),
        userRequirement: typeof meta.userRequirement === 'string' ? meta.userRequirement : '',
        previewFile,
        styleReferenceFile,
        hasStyleReference: Boolean(styleReferenceFile),
        createdAt: typeof meta.createdAt === 'string' ? meta.createdAt : '',
        updatedAt: typeof meta.updatedAt === 'string' ? meta.updatedAt : '',
        template,
        guidance,
        slots,
      },
    }
  } catch {
    return { warning: `自定义封面风格 ${dirName} 读取失败或已损坏，已跳过。` }
  }
}

export async function listCoverStyles(root) {
  const builtins = COVER_STYLES.map(item => ({ ...item }))
  const dir = stylesRoot(root)
  let entries
  try {
    const st = await lstat(dir)
    if (st.isSymbolicLink() || !st.isDirectory()) {
      return { styles: builtins, warnings: ['自定义封面风格目录无效，已跳过。'] }
    }
    entries = await readdir(dir, { withFileTypes: true })
  } catch (err) {
    if (err.code === 'ENOENT') return { styles: builtins, warnings: [] }
    return { styles: builtins, warnings: [`自定义封面风格目录读取失败（${err.code ?? '未知错误'}）。`] }
  }

  const dirReal = await realpath(dir)
  const warnings = []
  const custom = []
  for (const entry of entries) {
    const name = entry.name
    if (name === '_drafts' || name.startsWith('.')) continue
    if (!isCustomStyleId(name)) continue
    const res = await readStyleDirEntry(dirReal, name)
    if (res.warning) warnings.push(res.warning)
    else if (res.style) {
      const { template: _t, guidance: _g, slots: _s, ...summary } = res.style
      custom.push(summary)
    }
  }
  custom.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  return { styles: [...builtins, ...custom], warnings }
}

export async function readCustomCoverStyle(root, id) {
  if (!isCustomStyleId(id)) return null
  const dir = stylesRoot(root)
  let dirReal
  try {
    const st = await lstat(dir)
    if (st.isSymbolicLink() || !st.isDirectory()) return null
    dirReal = await realpath(dir)
  } catch {
    return null
  }
  const res = await readStyleDirEntry(dirReal, id)
  return res.style ?? null
}

export async function resolveCoverStyle(root, id) {
  if (typeof id !== 'string' || !id.trim()) return null
  const builtin = COVER_STYLES.find(item => item.id === id)
  if (builtin) return { ...builtin }
  return readCustomCoverStyle(root, id)
}

export async function pruneExpiredDrafts(root, nowMs = Date.now(), ttlMs = DRAFT_TTL_MS) {
  const dir = draftsRoot(root)
  let entries
  try {
    const st = await lstat(dir)
    if (st.isSymbolicLink() || !st.isDirectory()) return 0
    entries = await readdir(dir, { withFileTypes: true })
  } catch (err) {
    if (err.code === 'ENOENT') return 0
    return 0
  }
  let removed = 0
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const filePath = join(dir, entry.name)
    try {
      const st = await lstat(filePath)
      if (!st.isSymbolicLink() && nowMs - st.mtimeMs > ttlMs) {
        await unlink(filePath)
        removed++
      }
    } catch {
      // 忽略并发已被删的文件
    }
  }
  return removed
}

export async function saveDraftPreview(root, imageBuffer, format = 'png') {
  const detected = detectImageContentType(imageBuffer)
  if (!detected) throw httpError(400, '试生成样图不是有效的 PNG 或 JPEG 图片。')
  const actualFormat = detected === 'image/jpeg' ? 'jpeg' : 'png'
  const ext = actualFormat === 'jpeg' ? 'jpg' : 'png'
  const dir = draftsRoot(root)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const dirReal = await assertDirNoSymlink(dir, null)
  const draftToken = randomUUID()
  await writeFile(join(dirReal, `${draftToken}.${ext}`), imageBuffer, { mode: 0o600 })
  await pruneExpiredDrafts(root).catch(() => {})
  return { draftToken, format: actualFormat }
}

async function resolveDraftPath(root, token) {
  if (typeof token !== 'string' || !UUID_RE.test(token)) {
    throw httpError(400, '无效的试生成样图标识。')
  }
  const dir = draftsRoot(root)
  let dirReal
  try {
    dirReal = await assertDirNoSymlink(dir, null)
  } catch {
    throw httpError(404, '试生成样图不存在或已过期。')
  }
  for (const ext of PREVIEW_EXTS) {
    const candidate = join(dirReal, `${token}.${ext}`)
    try {
      const real = await assertRegularNoSymlink(candidate, dirReal)
      return { path: real, ext }
    } catch (err) {
      if (err.code === 'ENOENT') continue
      throw err
    }
  }
  throw httpError(404, '试生成样图不存在或已过期。')
}

export async function readDraftPreview(root, token) {
  const { path } = await resolveDraftPath(root, token)
  const buffer = await readFile(path)
  const contentType = detectImageContentType(buffer)
  if (!contentType) throw httpError(415, '试生成样图文件格式无效。')
  return {
    buffer,
    contentType,
    format: contentType === 'image/jpeg' ? 'jpeg' : 'png',
    path,
  }
}

export async function readCustomStylePreview(root, id) {
  if (!isCustomStyleId(id)) throw httpError(400, '无效的自定义封面风格 ID。')
  const stylesDir = stylesRoot(root)
  let stylesDirReal
  try {
    stylesDirReal = await assertDirNoSymlink(stylesDir, null)
  } catch {
    throw httpError(404, '封面风格预览图不存在。')
  }
  const styleDir = join(stylesDirReal, id)
  let styleDirReal
  try {
    styleDirReal = await assertDirNoSymlink(styleDir, stylesDirReal)
  } catch (err) {
    if (err.code === 'ENOENT') throw httpError(404, '自定义封面风格不存在。')
    throw err
  }
  const metaPath = join(styleDirReal, 'meta.json')
  let meta
  try {
    await assertRegularNoSymlink(metaPath, styleDirReal)
    meta = JSON.parse(await readFile(metaPath, 'utf8'))
  } catch (err) {
    if (err.status) throw err
    if (err.code === 'ENOENT') throw httpError(404, '自定义封面风格元数据不存在。')
    throw httpError(404, '自定义封面风格元数据已损坏。')
  }
  const previewName = meta?.previewFile
  if (typeof previewName !== 'string' || !previewName) {
    throw httpError(404, '该自定义风格暂无预览图。')
  }
  if (previewName.includes('/') || previewName.includes('\\') || previewName.includes('..') || !CUSTOM_STYLE_PREVIEW_FILES.has(previewName)) {
    throw httpError(400, '非法的预览图文件名。')
  }
  const previewPath = join(styleDirReal, previewName)
  let previewReal
  try {
    previewReal = await assertRegularNoSymlink(previewPath, styleDirReal)
  } catch (err) {
    if (err.code === 'ENOENT') throw httpError(404, '封面风格预览图文件不存在。')
    throw err
  }
  const buffer = await readFile(previewReal)
  const contentType = detectImageContentType(buffer)
  if (!contentType) throw httpError(415, '预览图文件格式无效。')
  return { buffer, contentType }
}

export async function readCustomStyleReferenceDataUrl(root, id) {
  if (!isCustomStyleId(id)) return null
  const dir = stylesRoot(root)
  let styleDirReal
  try {
    const dirReal = await assertDirNoSymlink(dir, null)
    styleDirReal = await assertDirNoSymlink(join(dirReal, id), dirReal)
  } catch {
    return null
  }
  let meta
  try {
    const metaPath = join(styleDirReal, 'meta.json')
    await assertRegularNoSymlink(metaPath, styleDirReal)
    meta = JSON.parse(await readFile(metaPath, 'utf8'))
  } catch {
    return null
  }
  const refFile = safeStyleReferenceFileName(meta?.styleReferenceFile)
  if (!refFile) return null
  try {
    const refPath = join(styleDirReal, refFile)
    const refReal = await assertRegularNoSymlink(refPath, styleDirReal)
    const buffer = await readFile(refReal)
    const contentType = detectImageContentType(buffer)
    if (!contentType) return null
    return `data:${contentType};base64,${buffer.toString('base64')}`
  } catch {
    return null
  }
}

export async function resolveCoverReferenceImage(root, resolvedStyle, settings) {
  if (!resolvedStyle) return { referenceImage: null, referenceKind: null }
  if (resolvedStyle.usePortrait) {
    const portrait = settings?.portraitUrl || null
    return { referenceImage: portrait, referenceKind: portrait ? 'portrait' : null }
  }
  if (resolvedStyle.source === 'custom' && resolvedStyle.useStyleReference) {
    const dataUrl = await readCustomStyleReferenceDataUrl(root, resolvedStyle.id)
    if (dataUrl) return { referenceImage: dataUrl, referenceKind: 'style' }
  }
  return { referenceImage: null, referenceKind: null }
}

function prepareStyleReferenceImage(dataUrl) {
  const parsed = parseDataImageUri(dataUrl)
  if (!parsed) throw httpError(400, '风格参考图不是有效的图片 Data URL。')
  const raw = Buffer.from(parsed.data, 'base64')
  if (!raw.length || raw.length > CUSTOM_COVER_STYLE_LIMITS.maxReferenceBytes) {
    throw httpError(400, '风格参考图体积超过 2 MB 上限。')
  }
  const detected = detectImageContentType(raw)
  if (!detected) {
    throw httpError(400, '风格参考图仅支持 PNG 或 JPEG 图片。')
  }
  return {
    buffer: raw,
    styleReferenceFile: detected === 'image/jpeg' ? 'style-ref.jpg' : 'style-ref.png',
    contentType: detected,
    dataUrl: `data:${detected};base64,${raw.toString('base64')}`,
  }
}

async function prepareFallbackPreview(dataUrl) {
  const parsed = parseDataImageUri(dataUrl)
  if (!parsed) throw httpError(400, '参考图不是有效的图片 Data URL。')
  const raw = Buffer.from(parsed.data, 'base64')
  if (raw.length > CUSTOM_COVER_STYLE_LIMITS.maxReferenceBytes) {
    throw httpError(400, '参考图体积超过 2 MB 上限。')
  }
  const detected = detectImageContentType(raw)
  if (!detected) return null
  const format = detected === 'image/jpeg' ? 'jpeg' : 'png'
  try {
    const { cropCover } = await import('../dist/image-crop.mjs')
    const cropped = cropCover(raw, format)
    return { buffer: cropped, previewFile: format === 'jpeg' ? 'preview.jpg' : 'preview.png' }
  } catch {
    // 极端尺寸无法按 47:20 裁切时降级为无预览图，不阻断保存
    return null
  }
}

async function countCustomStyles(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries.filter(e => e.isDirectory() && isCustomStyleId(e.name)).length
  } catch (err) {
    if (err.code === 'ENOENT') return 0
    throw err
  }
}

async function generateUniqueId(dir) {
  for (let attempt = 0; attempt < 16; attempt++) {
    const id = `custom-${randomBytes(4).toString('hex')}`
    try {
      await lstat(join(dir, id))
    } catch (err) {
      if (err.code === 'ENOENT') return id
    }
  }
  throw httpError(500, '无法生成唯一的自定义风格 ID，请重试。')
}

export async function saveCustomCoverStyle(root, input, opts = {}) {
  const terms = await loadCoverBlocklist()
  const validated = validateCustomStyleInput(input, terms)
  const isUpdate = input?.id !== undefined && input?.id !== null && input?.id !== ''
  if (isUpdate && !isCustomStyleId(input.id)) {
    throw httpError(400, '只能编辑自定义封面风格，不能修改系统内置风格或非法 ID。')
  }

  // 解析预览图与可选风格参考图输入（在锁外先读草稿或校验图片，失败不持锁）
  let newPreview = null
  let consumedDraftPath = null
  if (input?.previewDraftToken) {
    const draft = await readDraftPreview(root, input.previewDraftToken)
    newPreview = {
      buffer: draft.buffer,
      previewFile: draft.format === 'jpeg' ? 'preview.jpg' : 'preview.png',
    }
    consumedDraftPath = draft.path
  } else if (input?.fallbackReferenceImage) {
    newPreview = await prepareFallbackPreview(input.fallbackReferenceImage)
  }
  let newStyleRef = null
  if (input?.styleReferenceImage) {
    newStyleRef = prepareStyleReferenceImage(input.styleReferenceImage)
  }

  const dir = stylesRoot(root)
  await mkdir(dir, { recursive: true, mode: 0o700 })

  const savedStyle = await withFileLock(join(dir, '.lock'), async () => {
    const dirReal = await assertDirNoSymlink(dir, null)
    const now = new Date().toISOString()

    if (!isUpdate) {
      const existingCount = await countCustomStyles(dirReal)
      if (existingCount >= CUSTOM_COVER_STYLE_LIMITS.maxStyles) {
        throw httpError(400, `本地自定义封面风格已达上限（${CUSTOM_COVER_STYLE_LIMITS.maxStyles} 套），请先删除不需要的风格再新建。`)
      }
      const id = await generateUniqueId(dirReal)
      const styleReferenceFile = newStyleRef ? newStyleRef.styleReferenceFile : null
      const meta = {
        version: 1,
        id,
        name: validated.name,
        description: validated.description,
        usePortrait: validated.usePortrait,
        useStyleReference: validated.useStyleReference && Boolean(styleReferenceFile),
        userRequirement: validated.userRequirement,
        previewFile: newPreview ? newPreview.previewFile : null,
        styleReferenceFile,
        createdAt: now,
        updatedAt: now,
      }
      const stagingDir = join(dirReal, `.staging-${randomUUID()}`)
      const targetDir = join(dirReal, id)
      try {
        await mkdir(stagingDir, { mode: 0o700 })
        await writeFile(join(stagingDir, 'template.txt'), validated.template, { mode: 0o600 })
        await writeFile(join(stagingDir, 'guidance.txt'), validated.guidance, { mode: 0o600 })
        if (newPreview) {
          await writeFile(join(stagingDir, newPreview.previewFile), newPreview.buffer, { mode: 0o600 })
        }
        if (newStyleRef) {
          await writeFile(join(stagingDir, newStyleRef.styleReferenceFile), newStyleRef.buffer, { mode: 0o600 })
        }
        await writeFile(join(stagingDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n', { mode: 0o600 })
        if (opts._testFailBeforeCommit) throw new Error('simulated failure before create commit')
        await rename(stagingDir, targetDir)
      } catch (err) {
        await rm(stagingDir, { recursive: true, force: true }).catch(() => {})
        throw err
      }
      return {
        ...meta,
        source: 'custom',
        hasStyleReference: Boolean(styleReferenceFile),
        template: validated.template,
        guidance: validated.guidance,
        slots: validated.slots,
      }
    }

    // 更新已有风格：同目录临时文件准备 -> 顺序替换 -> meta 提交
    const id = input.id
    const targetDir = join(dirReal, id)
    let targetDirReal
    try {
      targetDirReal = await assertDirNoSymlink(targetDir, dirReal)
    } catch (err) {
      if (err.code === 'ENOENT') throw httpError(404, '要编辑的自定义封面风格不存在。')
      throw err
    }

    const metaPath = join(targetDirReal, 'meta.json')
    const templatePath = join(targetDirReal, 'template.txt')
    const guidancePath = join(targetDirReal, 'guidance.txt')
    let oldMetaRaw
    let oldTemplateRaw
    let prevMeta
    try {
      await assertRegularNoSymlink(metaPath, targetDirReal)
      await assertRegularNoSymlink(templatePath, targetDirReal)
      oldMetaRaw = await readFile(metaPath, 'utf8')
      oldTemplateRaw = await readFile(templatePath, 'utf8')
      prevMeta = JSON.parse(oldMetaRaw)
      if (!prevMeta || typeof prevMeta !== 'object' || Array.isArray(prevMeta)) {
        throw httpError(400, '自定义封面风格元数据已损坏。')
      }
    } catch (err) {
      if (err.status) throw err
      if (err.code === 'ENOENT') throw httpError(404, '要编辑的自定义封面风格文件缺失。')
      throw httpError(400, '要编辑的自定义封面风格元数据已损坏。')
    }
    let oldGuidanceRaw = null
    try {
      await assertRegularNoSymlink(guidancePath, targetDirReal)
      oldGuidanceRaw = await readFile(guidancePath, 'utf8')
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
    }
    const oldPreviewFile = safePreviewFileName(prevMeta?.previewFile)
    let oldPreviewBuf = null
    if (newPreview && oldPreviewFile === newPreview.previewFile) {
      const oldPreviewPath = join(targetDirReal, oldPreviewFile)
      try {
        await assertRegularNoSymlink(oldPreviewPath, targetDirReal)
        oldPreviewBuf = await readFile(oldPreviewPath)
      } catch (err) {
        if (err.code !== 'ENOENT') throw err
      }
    }
    const oldStyleRefFile = safeStyleReferenceFileName(prevMeta?.styleReferenceFile)
    let oldStyleRefBuf = null
    if (newStyleRef && oldStyleRefFile === newStyleRef.styleReferenceFile) {
      const oldStyleRefPath = join(targetDirReal, oldStyleRefFile)
      try {
        await assertRegularNoSymlink(oldStyleRefPath, targetDirReal)
        oldStyleRefBuf = await readFile(oldStyleRefPath)
      } catch (err) {
        if (err.code !== 'ENOENT') throw err
      }
    }

    const nextPreviewFile = newPreview ? newPreview.previewFile : oldPreviewFile
    const nextStyleRefFile = input?.clearStyleReference ? null : (newStyleRef ? newStyleRef.styleReferenceFile : oldStyleRefFile)
    const meta = {
      version: 1,
      id,
      name: validated.name,
      description: validated.description,
      usePortrait: validated.usePortrait,
      useStyleReference: validated.useStyleReference && Boolean(nextStyleRefFile),
      userRequirement: validated.userRequirement,
      previewFile: nextPreviewFile,
      styleReferenceFile: nextStyleRefFile,
      createdAt: typeof prevMeta?.createdAt === 'string' && prevMeta.createdAt ? prevMeta.createdAt : now,
      updatedAt: now,
    }

    const token = randomUUID()
    const tmpFiles = []
    const tmpTemplate = join(targetDirReal, `.template.${token}.tmp`)
    const tmpGuidance = join(targetDirReal, `.guidance.${token}.tmp`)
    const tmpMeta = join(targetDirReal, `.meta.${token}.tmp`)
    const tmpPreview = newPreview ? join(targetDirReal, `.preview.${token}.tmp`) : null
    const tmpStyleRef = (!input?.clearStyleReference && newStyleRef) ? join(targetDirReal, `.style-ref.${token}.tmp`) : null

    let previewReplaced = false
    let styleRefReplaced = false
    let templateReplaced = false
    let guidanceReplaced = false
    let metaReplaced = false
    try {
      if (tmpPreview) {
        await writeFile(tmpPreview, newPreview.buffer, { mode: 0o600 })
        tmpFiles.push(tmpPreview)
      }
      if (tmpStyleRef) {
        await writeFile(tmpStyleRef, newStyleRef.buffer, { mode: 0o600 })
        tmpFiles.push(tmpStyleRef)
      }
      await writeFile(tmpTemplate, validated.template, { mode: 0o600 })
      tmpFiles.push(tmpTemplate)
      await writeFile(tmpGuidance, validated.guidance, { mode: 0o600 })
      tmpFiles.push(tmpGuidance)
      await writeFile(tmpMeta, JSON.stringify(meta, null, 2) + '\n', { mode: 0o600 })
      tmpFiles.push(tmpMeta)

      if (opts._testFailBeforeCommit) throw new Error('simulated failure before update commit')

      if (tmpPreview) {
        await rename(tmpPreview, join(targetDirReal, newPreview.previewFile))
        previewReplaced = true
      }
      if (tmpStyleRef) {
        await rename(tmpStyleRef, join(targetDirReal, newStyleRef.styleReferenceFile))
        styleRefReplaced = true
      }
      await rename(tmpTemplate, templatePath)
      templateReplaced = true
      await rename(tmpGuidance, guidancePath)
      guidanceReplaced = true
      await rename(tmpMeta, metaPath)
      metaReplaced = true

      if (newPreview && oldPreviewFile && oldPreviewFile !== newPreview.previewFile) {
        await unlink(join(targetDirReal, oldPreviewFile)).catch(() => {})
      }
      if (oldStyleRefFile && oldStyleRefFile !== nextStyleRefFile) {
        await unlink(join(targetDirReal, oldStyleRefFile)).catch(() => {})
      }
    } catch (err) {
      for (const tmp of tmpFiles) await unlink(tmp).catch(() => {})
      if (!metaReplaced) {
        if (previewReplaced && newPreview) {
          if (oldPreviewBuf !== null) await writeFile(join(targetDirReal, newPreview.previewFile), oldPreviewBuf, { mode: 0o600 }).catch(() => {})
          else if (oldPreviewFile !== newPreview.previewFile) await unlink(join(targetDirReal, newPreview.previewFile)).catch(() => {})
        }
        if (styleRefReplaced && newStyleRef) {
          if (oldStyleRefBuf !== null) await writeFile(join(targetDirReal, newStyleRef.styleReferenceFile), oldStyleRefBuf, { mode: 0o600 }).catch(() => {})
          else if (oldStyleRefFile !== newStyleRef.styleReferenceFile) await unlink(join(targetDirReal, newStyleRef.styleReferenceFile)).catch(() => {})
        }
        if (templateReplaced) await writeFile(templatePath, oldTemplateRaw, { mode: 0o600 }).catch(() => {})
        if (guidanceReplaced) {
          if (oldGuidanceRaw !== null) await writeFile(guidancePath, oldGuidanceRaw, { mode: 0o600 }).catch(() => {})
          else await unlink(guidancePath).catch(() => {})
        }
      }
      throw err
    }
    return {
      ...meta,
      source: 'custom',
      hasStyleReference: Boolean(nextStyleRefFile),
      template: validated.template,
      guidance: validated.guidance,
      slots: validated.slots,
    }
  })

  if (consumedDraftPath) {
    await unlink(consumedDraftPath).catch(() => {})
  }
  await pruneExpiredDrafts(root).catch(() => {})

  const { styles, warnings } = await listCoverStyles(root)
  return { style: savedStyle, styles, warnings }
}

export async function deleteCustomCoverStyle(root, id) {
  if (!isCustomStyleId(id)) {
    throw httpError(400, '只能删除自定义封面风格，不能删除系统内置风格或非法 ID。')
  }
  const dir = stylesRoot(root)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await withFileLock(join(dir, '.lock'), async () => {
    const dirReal = await assertDirNoSymlink(dir, null)
    const targetDir = join(dirReal, id)
    try {
      await assertDirNoSymlink(targetDir, dirReal)
    } catch (err) {
      if (err.code === 'ENOENT') throw httpError(404, '要删除的自定义封面风格不存在。')
      throw err
    }
    await rm(targetDir, { recursive: true, force: true })
  })
  return listCoverStyles(root)
}

const DEFAULT_TEST_TITLE = '我用 AI 搭了一套自动化写作流'
const ANY_PERSONA_MARKER_RE = /\[\[(?:SUBJECT|OUTFIT|人物|服装|玩偶)\]\]/

const ALLOWED_REF_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

function validateReferenceImages(rawList) {
  if (rawList === undefined || rawList === null) return []
  if (!Array.isArray(rawList)) throw httpError(400, '参考图列表格式无效。')
  if (rawList.length > CUSTOM_COVER_STYLE_LIMITS.maxReferenceImages) {
    throw httpError(400, `最多上传 ${CUSTOM_COVER_STYLE_LIMITS.maxReferenceImages} 张参考封面图。`)
  }
  const out = []
  for (let i = 0; i < rawList.length; i++) {
    const dataUrl = typeof rawList[i] === 'string' ? rawList[i] : ''
    const parsed = parseDataImageUri(dataUrl)
    if (!parsed || !ALLOWED_REF_MEDIA_TYPES.has(parsed.mediaType)) {
      throw httpError(400, `第 ${i + 1} 张参考图不是有效的 PNG/JPEG/WebP 图片。`)
    }
    const bytes = Buffer.from(parsed.data, 'base64')
    if (!bytes.length || bytes.length > CUSTOM_COVER_STYLE_LIMITS.maxReferenceBytes) {
      throw httpError(400, `第 ${i + 1} 张参考图体积超过 2 MB 上限。`)
    }
    out.push({ id: `ref-${i + 1}`, dataUrl })
  }
  return out
}

function buildAnalyzeSystemPrompt(blocklistTerms, isRefine, imageCount = 0) {
  const isMultiImage = imageCount > 1
  return [
    '你是一位资深视觉设计师兼生图提示词架构师，负责把用户提供的封面参考图和/或文字诉求拆解成一套工程级、可长期复用的 21:9 公众号宽幅封面提示词模板。',
    isRefine
      ? '当前处于「自然语言微调模式」：请以用户提供的最新草稿（可能已被用户手动编辑过）为基线，只根据用户的微调指令做针对性调整，保留用户满意的其他设定，不要推倒重来；同时保持分块结构化写法。'
      : '当前处于「新建拆解模式」：请像视觉艺术总监一样精确反推参考图（如有）与用户诉求的可迁移视觉语言——底色与材质颗粒、精确 HEX 色值与禁止漂移色、版面分区百分比与留白边距、字体字重/倾斜/描边/底块、核心视觉主体的媒介形态与光影关系、以及必须禁止的干扰元素。严禁把参考图里的原文章标题、原品牌名、原具体道具名称、原陌生人的相貌和衣服，以及仅属于原参考图那一篇文章的具体场景、地貌、天体、建筑、动物或特定符号（如月球、山脉、特定剪影、特定撕裂卡片等）写死进模板。',
    ...(isMultiImage
      ? [[
          `【多张参考图综合分析规则（当前共 ${imageCount} 张：ref-1 ～ ref-${imageCount}）】`,
          `1. 必须逐张审视全部 ${imageCount} 张参考图，综合提炼整套视觉方案；严禁只照搬第一张图（ref-1）而忽略其余参考图。`,
          '2. 若用户的文字诉求明确指定了各图分工（例如“图 1 的字体 + 图 2 的构图 + 图 3 的配色”），严格按指定维度融合；否则将多张图视为同一系列的多个样张，明确区分「跨图共性」与「图间差异」：',
          '   - 跨图共性（如共同的整体调性、是否真人出镜、大标题体量与可读性、明暗光影基调、留白规范）→ 固定写进 template，作为整套风格的统一基因。',
          '   - 图间差异（如不同样张采用了不同配色方案、不同标题文字颜色、不同人物站位/版式构图、或不同视觉媒介如 3D 道具 / 实景互动 / 扁平 UI 卡片）→ 严禁强行锁死成单一样张的做法，应把这些可变维度抽成清晰的 {{...}} 槽位（例如当各参考图标题颜色不同时，明确拆出 {{标题主色}} / {{标题高亮色}} 等显式槽位，不要只写模糊的 "scheme color"），并在 guidance 中给出各参考图对应的色板/构图/媒介示例以及「按文章主题与核心道具动态选色」的原则（不要强制限定只能从 2-3 个打包套餐里死选，避免同类文章反复撞色）。',
          '   - 固定文本不要与多图变体自相矛盾（例如若参考图同时包含明亮浅底与深色底，就不要在固定描述里写死 high-key/bright base）。',
          '3. NEGATIVES / NOT 排除项只能排除所有参考图共同回避的干扰，严禁禁用任意一张参考图中合法出现的视觉元素或媒介。',
          '4. name 与 description 必须概括整套多图系列的共同风格定位，不得只描述单张样张的局部特征。',
        ].join('\n')]
      : []),
    '输出必须是严格合法的单个 JSON 对象，不得包含多余说明：',
    JSON.stringify({
      name: '简短中文风格名（1-16字）',
      description: '一句话视觉语言与适用场景简介（1-80字）',
      usePortrait: false,
      template: '按下方分块规范编写的 21:9 生图提示词模板，包含固定视觉规范与至少 2 个 {{占位符}}',
      guidance: '给后续文章填词 LLM 看的选词规则、字数上限与具象视觉隐喻举例（只放这里，绝不放进 template）',
    }, null, 2),
    '【template 必须采用的工程级分块结构（优先英文结构标签 + 简洁精确的视觉指令，中文文字槽位放在引号内）】',
    [
      '1. 开篇 1-2 句：A wide-format 21:9 article cover banner... 精准定义媒介与审美气质（如 flat risograph/screen-print poster / dark cinematic movie poster / clean editorial paper collage）；若多图包含多种媒介变体，开篇定义共同审美基调，由槽位承接具体媒介。',
      '2. COLOR SYSTEM (fixed): 列出 Background、Primary type、Accent 的精确 HEX 色值，并写明 NOT ... 排除容易漂移的颜色（如 NOT navy, NOT purple, NOT neon）；若多张参考图本身采用多套色系，则固定共性明暗基调与禁用色，把可变配色抽成槽位并在 guidance 中列出各套精确 HEX 方案。',
      '3. LAYOUT: 用精确百分比描述左右或上下分区、层级与视觉重心，并强制保留上下左右安全留白（keep all text and focal elements well inside the central safe area with breathing room from top and bottom edges），避免大字贴边被裁切；若多图存在多种版式构图，则固定标题安全区与留白，将构图变体抽成槽位并在 guidance 中说明。',
      '4. TYPOGRAPHY: 写清字重、是否斜体、字距、描边/阴影/高亮底块/双色拆分方式；若标题中有强调色词，必须拆成明确的两个槽位（例如 "{{主标题普通部分}}" in white + "{{主标题高亮词}}" in #FF5A3C），不要只写模糊的"可搭配强调色"。',
      '5. VISUAL SUBJECT: 写清主视觉的呈现媒介（平涂矢量/粗颗粒版画/电影级暗调写实/微缩手作等）、尺寸占比、空间前后层次、构图手法（如巨物尺度反差、局部特写等）与打光方式，并用 {{...}} 承接整块动态场景与核心主体；严禁把参考图原文章的具体景物/地貌/天体/建筑写死为固定背景，确保不同主题文章能按内容生成完全贴合的新场景；若多图跨媒介表现，则固定统一质感底线（如真人写实度、主体清晰度），由槽位与 guidance 分支承接具体媒介形态。',
      '6. TEXT IN THE IMAGE (render exactly these texts, each only once, and no other text): 逐行编号列出画面里唯一允许出现的全部文字槽位（含颜色与底块），并在末尾写明：Do not render any hex codes, color names, layout labels, or extra unreadable UI text.',
      '7. STYLE & NEGATIVES: 写清核心材质与光影，以及与参考图匹配的负向排除项（例如扁平风必须写 no 3D, no gradients, no photorealism；无 UI 截图风写 no tiny gibberish screen text, no cluttered icons；固定写 no author watermark or signature text；多图场景下不得禁用任意一张参考图的合法元素）。',
      '8. 结尾固定：ASPECT RATIO: 21:9 (wide cinematic banner format)',
    ].join('\n'),
    '硬性质量与隔离要求：',
    `1. template 必须包含至少 ${CUSTOM_COVER_STYLE_LIMITS.minSlots} 个 {{...}} 动态占位符（至少覆盖主标题和画面核心视觉元素），建议控制在 ${isMultiImage ? '3～7' : '3～6'} 个核心槽位，克制极小字装饰，确保手机卡片缩略图下依然清晰易读。`,
    '2. 【严格隔离 template 与 guidance】template 在替换 {{...}} 后会原文直接发给生图模型，因此 template 中严禁出现任何括号举例（如"例如..."、"比如 Kimi 对应月球"）、元说明（如"根据文章主题选择"）、或"可选/建议/可以"这类不确定措辞！所有字数建议、选材规则、具体联想案例（如 Kimi→月球）以及多图变体分支清单必须全部写进 guidance 字段。',
    '3. 【风格骨架与题材场景解耦】参考图里的具体世界观与景物（例如某张图里的月球、荒原山脉、太空舱、办公室桌椅或某个动物/建筑）往往只是原图针对特定文章设计的视觉隐喻，而不是固定背景布。template 只应固定可迁移的视觉风格骨架（媒介、光影、配色、排版、尺度张力），必须把具体场景与中心意象抽成 {{...}} 槽位，让后续填词模型根据每篇文章内容自由生成不同的对应场景；原图的隐喻思路仅可作为示例写进 guidance。',
    '4. 当 usePortrait 为 true 时，template 必须在人物描述处使用 [[SUBJECT]] 与 [[OUTFIT]]（英文模板）或 [[人物]] 与 [[服装]]（中文模板），由宿主按用户设置填入博主本人与服装，绝不能写死固定性别、长相或服装。',
    '5. 当 usePortrait 为 false 时，template 中不得包含 [[SUBJECT]]、[[OUTFIT]]、[[人物]]、[[服装]]、[[玩偶]] 或真人肖像参考图描述。',
    `6. template 中严禁出现以下封面禁用词（含否定写法）：${blocklistTerms.join(', ')}`,
  ].join('\n\n')
}

export async function analyzeCustomCoverStyle(ctx, { referenceImages = [], requirement = '', draft = null, adjustment = '', signal } = {}) {
  const images = validateReferenceImages(referenceImages)
  const cleanRequirement = typeof requirement === 'string' ? requirement.trim() : ''
  const cleanAdjustment = typeof adjustment === 'string' ? adjustment.trim() : ''
  const isRefine = Boolean(draft && typeof draft === 'object' && !Array.isArray(draft))

  if (cleanRequirement.length > CUSTOM_COVER_STYLE_LIMITS.maxRequirement) {
    throw httpError(400, `风格诉求不能超过 ${CUSTOM_COVER_STYLE_LIMITS.maxRequirement} 字。`)
  }
  if (cleanAdjustment.length > CUSTOM_COVER_STYLE_LIMITS.maxRequirement) {
    throw httpError(400, `微调要求不能超过 ${CUSTOM_COVER_STYLE_LIMITS.maxRequirement} 字。`)
  }
  if (isRefine) {
    if (!cleanAdjustment) throw httpError(400, '请填写想要调整的具体要求。')
  } else if (!images.length && !cleanRequirement) {
    throw httpError(400, '请至少上传 1 张参考封面图，或填写风格诉求。')
  }

  if (images.length > 0) {
    const vision = await modelVisionSupport(ctx)
    if (vision === false) {
      throw httpError(400, '当前所选模型不支持识图，请先切换到支持视觉的多模态模型，或移除参考图后仅用文字诉求创建。', { code: 'VISION_UNSUPPORTED' })
    }
  }

  const terms = await loadCoverBlocklist()
  const system = buildAnalyzeSystemPrompt(terms, isRefine, images.length)
  const multiImageFields = images.length > 1
    ? { referenceImageCount: images.length, multiImagePolicy: 'synthesize-all' }
    : {}
  const baseUser = isRefine
    ? JSON.stringify({
      mode: 'refine',
      currentDraft: {
        name: typeof draft.name === 'string' ? draft.name.trim() : '',
        description: typeof draft.description === 'string' ? draft.description.trim() : '',
        usePortrait: Boolean(draft.usePortrait),
        template: normalizeMultiline(draft.template),
        guidance: normalizeMultiline(draft.guidance),
      },
      adjustment: cleanAdjustment,
      originalRequirement: cleanRequirement,
      referenceImageIds: images.map(item => item.id),
      ...multiImageFields,
    })
    : JSON.stringify({
      mode: 'create',
      requirement: cleanRequirement,
      referenceImageIds: images.map(item => item.id),
      ...multiImageFields,
    })

  let issue = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await callModel(ctx, {
      system,
      user: issue ? `${baseUser}\n\n上次输出未通过质检，请修正后重新只输出 JSON：${issue}` : baseUser,
      images,
      strictImages: images.length > 0,
      task: 'cover-style-analyze',
      maxTokens: 4000,
      signal: signal ?? AbortSignal.timeout(90_000),
    })
    const parsed = extractJson(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      issue = '未能解析出有效的 JSON 对象。'
      continue
    }
    try {
      const candidate = validateCustomStyleInput({
        name: typeof parsed.name === 'string' ? parsed.name.trim().slice(0, CUSTOM_COVER_STYLE_LIMITS.maxName) : '',
        description: typeof parsed.description === 'string' ? parsed.description.trim().slice(0, CUSTOM_COVER_STYLE_LIMITS.maxDescription) : '',
        usePortrait: Boolean(parsed.usePortrait),
        userRequirement: cleanRequirement,
        template: parsed.template,
        guidance: typeof parsed.guidance === 'string' ? parsed.guidance : '',
      }, terms)
      if (candidate.usePortrait && !hasPortraitMarkers(candidate.template)) {
        issue = 'usePortrait 为 true 时，template 必须包含 [[SUBJECT]]（或 [[人物]]）人物占位符。'
        continue
      }
      if (!candidate.usePortrait && ANY_PERSONA_MARKER_RE.test(candidate.template)) {
        issue = 'usePortrait 为 false 时，template 不能包含 [[SUBJECT]] / [[OUTFIT]] / [[人物]] / [[服装]] / [[玩偶]] 占位符。'
        continue
      }
      return {
        draft: {
          name: candidate.name,
          description: candidate.description,
          usePortrait: candidate.usePortrait,
          template: candidate.template,
          guidance: candidate.guidance,
          slots: candidate.slots,
        },
      }
    } catch (err) {
      issue = err.message || '风格模板格式不合法。'
    }
  }
  throw httpError(502, `模型未生成合格的风格模板：${issue}`)
}

export async function previewCustomCoverStyle(ctx, root, settings, { draft, testTitle, testMarkdown = '', resolution = '1K', styleReferenceImage = null, onStage } = {}, fetchImpl = fetch) {
  if (!COVER_RESOLUTIONS.includes(resolution)) {
    throw httpError(400, '请选择有效的试生成分辨率（1K、1.5K 或 2K）。')
  }
  const terms = await loadCoverBlocklist()
  const template = normalizeMultiline(draft?.template)
  if (!template || template.length > CUSTOM_COVER_STYLE_LIMITS.maxTemplate) {
    throw httpError(400, `提示词模板不能为空，且不超过 ${CUSTOM_COVER_STYLE_LIMITS.maxTemplate} 字。`)
  }
  const slots = extractTemplateSlots(template)
  if (slots.length < CUSTOM_COVER_STYLE_LIMITS.minSlots) {
    throw httpError(400, `提示词模板至少需要包含 ${CUSTOM_COVER_STYLE_LIMITS.minSlots} 个 {{...}} 占位符。`)
  }
  const blocked = findBlocked(terms, template)
  if (blocked) {
    throw httpError(400, `提示词模板包含封面禁用词「${blocked}」，请修改后再试生成。`)
  }
  const guidance = normalizeMultiline(draft?.guidance)
  if (guidance.length > CUSTOM_COVER_STYLE_LIMITS.maxGuidance) {
    throw httpError(400, `填空指引不能超过 ${CUSTOM_COVER_STYLE_LIMITS.maxGuidance} 字。`)
  }

  const provider = settings?.coverProvider || 'ark'
  const meta = Object.hasOwn(COVER_PROVIDER_META, provider) ? COVER_PROVIDER_META[provider] : null
  if (!meta) throw httpError(400, '请选择有效的生图提供方。')
  const apiKey = settings?.[meta.keyField]
  const model = settings?.[meta.modelField]
  const baseUrl = meta.baseUrlField ? settings?.[meta.baseUrlField] : ''
  const format = providerFormats(provider)[0] || 'png'
  if (!apiKey) throw httpError(400, meta.missingKeyError)

  const usePortrait = Boolean(draft?.usePortrait)
  const useStyleReference = !usePortrait && Boolean(draft?.useStyleReference)
  let referenceImage = null
  let referenceKind = null
  if (usePortrait) {
    referenceImage = settings?.portraitUrl || null
    referenceKind = referenceImage ? 'portrait' : null
  } else if (useStyleReference) {
    if (styleReferenceImage) {
      referenceImage = prepareStyleReferenceImage(styleReferenceImage).dataUrl
    } else if (isCustomStyleId(draft?.id)) {
      referenceImage = await readCustomStyleReferenceDataUrl(root, draft.id)
    }
    referenceKind = referenceImage ? 'style' : null
  }
  const title = (typeof testTitle === 'string' ? testTitle.trim().slice(0, 120) : '') || DEFAULT_TEST_TITLE
  const markdown = (typeof testMarkdown === 'string' ? testMarkdown.trim().slice(0, 1200) : '') || `# ${title}\n\n${title}`

  onStage?.('prompt')
  const prompt = await coverPrompt(ctx, title, markdown, 'custom-preview', settings?.persona ?? {}, {
    hasReference: referenceKind === 'portrait',
    referenceKind,
    customStyle: {
      id: 'custom-preview',
      name: typeof draft?.name === 'string' ? draft.name.trim() : '自定义风格',
      template,
      guidance,
      usePortrait,
    },
  })

  onStage?.('generating')
  const rawImage = await generateCoverImage(provider, prompt, {
    apiKey, model, resolution, format, referenceImage, baseUrl, subject: '样例封面',
  }, fetchImpl)

  onStage?.('saving')
  const { cropCover } = await import('../dist/image-crop.mjs')
  const cropped = cropCover(rawImage, format)
  const saved = await saveDraftPreview(root, cropped, format)
  return {
    draftToken: saved.draftToken,
    format: saved.format,
    prompt,
    provider,
    model,
  }
}

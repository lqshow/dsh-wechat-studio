// 调模型和读 skill。写作、标题、去 AI 味都由 skills/ 里的 Markdown 驱动，
// 用户可以在 <DSH_HOME>/wechat-studio/skills/ 放同名文件覆盖。
import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractBalancedJsonSlice, parseDataImageUri, repairLooseJson } from './derive-shared.js'

const BUNDLED = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills')
const SESSION_ID = `dsh-wechat-studio-${randomUUID()}`
export const SKILL_NAMES = ['writer', 'headline', 'humanizer', 'zhuque', 'banner', 'repurpose-thread', 'repurpose-xhs']
export const COVER_SKILL_DIR = join(BUNDLED, 'linyuebanzi-cover-banner')
export const INLINE_DIAGRAM_SKILL_DIR = join(BUNDLED, 'linyuebanzi-inline-diagram')
export const SVG_CARDS_SKILL_DIR = join(BUNDLED, 'wechat-svg-cards')

/** 最近一次模型调用的结果。选了模型不等于能用，比如还没配密钥。 */
export const modelStatus = { ok: null, error: null }

export async function loadSkill(name, overrideDir) {
  if (!SKILL_NAMES.includes(name)) throw new Error(`未知的 skill：${name}`)
  for (const dir of [overrideDir, BUNDLED]) {
    if (!dir) continue
    try {
      const raw = await readFile(join(dir, `${name}.md`), 'utf8')
      return raw.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').trim()
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
    }
  }
  throw new Error(`找不到 skill 文件：${name}.md`)
}

/**
 * 每份 skill 当前用的是哪一份：用户在覆盖目录放了同名文件就用它，否则用插件内置的。
 * @param {string} overrideDir - 覆盖目录。
 * @returns {Promise<Array<{name: string, source: 'user'|'bundled', path: string, chars: number}>>} 列表。
 */
export async function skillSources(overrideDir) {
  const entries = SKILL_NAMES.map(name => ({
    name, file: `${name}.md`, sources: [[overrideDir, 'user'], [BUNDLED, 'bundled']],
  }))
  entries.push({ name: 'cover', file: 'SKILL.md', sources: [[COVER_SKILL_DIR, 'bundled']] })
  entries.push({
    name: 'inline-diagram', file: 'SKILL.md',
    sources: [[overrideDir ? join(overrideDir, 'linyuebanzi-inline-diagram') : null, 'user'], [INLINE_DIAGRAM_SKILL_DIR, 'bundled']],
  })
  entries.push({
    name: 'wechat-svg-cards', file: 'SKILL.md',
    sources: [[overrideDir ? join(overrideDir, 'wechat-svg-cards') : null, 'user'], [SVG_CARDS_SKILL_DIR, 'bundled']],
  })
  return Promise.all(entries.map(async ({ name, file, sources }) => {
    const displayPath = name === 'cover' ? `linyuebanzi-cover-banner/${file}` : name === 'inline-diagram' ? `linyuebanzi-inline-diagram/${file}` : name === 'wechat-svg-cards' ? `wechat-svg-cards/${file}` : file
    for (const [dir, source] of sources) {
      if (!dir) continue
      const path = join(dir, file)
      try {
        const info = await stat(path)
        if (info.isFile()) return { name, source, path, displayPath, chars: info.size }
      } catch {
        // 没有就看下一个
      }
    }
    return { name, source: 'missing', path: '', displayPath, chars: 0 }
  }))
}

// 用户在插件里指定的模型；null 表示跟随 DeepSeek Harness 的默认模型
let override = null

export function setModelOverride(selection) {
  override = selection?.provider && selection?.model ? { provider: selection.provider, model: selection.model } : null
}

export function modelOverride() {
  return override
}

export function defaultSelection(ctx) {
  try {
    const selection = ctx.get('agentDefaultModel')?.currentSelection()
    return selection?.provider && selection?.model ? { provider: selection.provider, model: selection.model } : null
  } catch {
    return null
  }
}

/** 实际要用的模型：指定了就用指定的，否则跟随 DSH 默认。 */
export function modelInfo(ctx) {
  if (!ctx.get('llm')) return null
  return override ?? defaultSelection(ctx)
}

/** Configured output budget, when the host exposes exact model metadata. */
export async function configuredModelMaxTokens(ctx) {
  try {
    const info = modelInfo(ctx)
    if (!info) return null
    const resolved = await ctx.get('llm').resolveModelInfo?.(info.provider, info.model)
    const maxTokens = resolved?.defaultMaxTokens
    return Number.isSafeInteger(maxTokens) && maxTokens > 0 ? maxTokens : null
  } catch {
    return null
  }
}

function extractModelModalities(model) {
  if (!model || typeof model !== 'object') return null
  const list = Array.isArray(model.inputModalities)
    ? model.inputModalities
    : Array.isArray(model.input)
      ? model.input
      : Array.isArray(model.modalities)
        ? model.modalities
        : null
  return list ? list.map(v => String(v).toLowerCase()) : null
}

/**
 * 列出 DSH 里已接入的提供方和它们公布的模型，给模型选择器用。某个提供方读失败就跳过，不影响其他的。
 * @param {object} ctx - Cordis 上下文。
 */
export async function listModels(ctx) {
  const llm = ctx.get('llm')
  const providers = llm ? await llm.listProviders() : []
  const settled = await Promise.allSettled(providers.map(async p => ({
    provider: p.id, name: p.name || p.id,
    models: (await llm.listModels(p.id)).map(m => {
      const modalities = extractModelModalities(m)
      return {
        id: m.id,
        name: m.name || m.id,
        ...(modalities ? { inputModalities: modalities, supportsImages: modalities.includes('image') } : {}),
      }
    }),
  })))
  return settled.filter(r => r.status === 'fulfilled').map(r => r.value).filter(p => p.models.length)
}

/** 查询当前激活模型是否声明支持识图：true 支持 / false 明确不支持 / null 未声明（运行时自适应）。 */
export async function modelVisionSupport(ctx) {
  const info = modelInfo(ctx)
  if (!info) return null
  const llm = ctx.get('llm')
  if (typeof llm?.listModels !== 'function') return null
  try {
    const models = await llm.listModels(info.provider)
    const hit = (Array.isArray(models) ? models : []).find(m => m?.id === info.model)
    const modalities = extractModelModalities(hit)
    if (!modalities) return null
    return modalities.includes('image')
  } catch {
    return null
  }
}

function isImageUnsupportedError(err) {
  const msg = String(err?.message ?? err ?? '')
  return /unsupported_content|does_not_support_images|does not support image|inputmodalit|image.*not.*support|vision.*not.*support|multimodal.*not.*support|unknown content type.*image|不支持.*图|不支持识图|不支持视觉/i.test(msg)
}

async function buildUserContent(ctx, user, images) {
  const parts = [{ type: 'text', text: user }]
  const attachments = ctx.get('attachments')
  for (const image of Array.isArray(images) ? images : []) {
    const dataUrl = typeof image === 'string' ? image : image?.dataUrl
    const id = typeof image?.id === 'string' && /^ref-(?:[1-9]|10)$/.test(image.id)
      ? image.id
      : ''
    const parsed = parseDataImageUri(dataUrl)
    if (!parsed) continue
    if (id) parts.push({ type: 'text', text: `[参考图 ${id}]` })
    if (attachments?.saveImage) {
      const attachment = await attachments.saveImage({
        data: Buffer.from(parsed.data, 'base64'),
        mediaType: parsed.mediaType,
      })
      parts.push({ type: 'image', attachment })
    } else {
      parts.push({
        type: 'image',
        mediaType: parsed.mediaType,
        mimeType: parsed.mediaType,
        data: parsed.data,
      })
    }
  }
  return parts
}

/**
 * 调一次模型并流式回传文本。插件在会话之外调模型，所以自己带一个会话标识。
 * 支持可选传入 images（data:image/...;base64,...）：若当前模型不支持识图，自动优雅降级为纯文本重试并触发 onImageFallback。
 * @param {object} ctx - Cordis 上下文。
 * @param {{system: string, user: string, images?: Array<string | {id: string, dataUrl: string}>, task: string, maxTokens?: number, signal?: AbortSignal, onText?: (delta: string) => void, onFinish?: (kind: string | undefined) => void, onImageFallback?: (reason: string) => void}} request - 请求。
 * @returns {Promise<string>} 完整文本。
 */
export async function callModel(ctx, { system, user, images = [], strictImages = false, task, maxTokens = 8000, signal, onText, onFinish, onImageFallback }) {
  const info = modelInfo(ctx)
  if (!info) throw new Error('当前没有可用模型，请先在 DeepSeek Harness 里配置好模型')
  const llm = ctx.get('llm')
  const validImages = (Array.isArray(images) ? images : []).filter(image => {
    const dataUrl = typeof image === 'string' ? image : image?.dataUrl
    return Boolean(parseDataImageUri(dataUrl))
  })

  const runOnce = async useImages => {
    const call = await llm.prepareCall({ provider: info.provider, model: info.model, maxTokens }, signal, controls => controls)
    let text = ''
    let finishKind
    const content = await buildUserContent(ctx, user, useImages ? validImages : [])
    for await (const chunk of call.stream({
      ...call.config,
      system,
      messages: [{ role: 'user', content, source: { kind: 'dsh-wechat-studio', task } }],
      sessionId: SESSION_ID,
      signal,
    })) {
      if (chunk.type === 'text-delta') {
        text += chunk.text
        onText?.(chunk.text)
      } else if (chunk.type === 'finish') {
        finishKind = chunk.reason?.kind
        if (finishKind === 'error' || finishKind === 'aborted') {
          throw new Error(chunk.reason.failure?.message || '模型调用失败')
        }
      }
    }
    onFinish?.(finishKind)
    return text
  }

  try {
    let shouldSendImages = validImages.length > 0
    if (shouldSendImages) {
      const vision = await modelVisionSupport(ctx)
      if (vision === false) {
        if (strictImages) {
          throw Object.assign(
            new Error('当前所选模型不支持识图，请先切换到支持视觉的多模态模型，或移除参考图后仅用文字诉求创建。'),
            { status: 400, code: 'VISION_UNSUPPORTED' },
          )
        }
        shouldSendImages = false
        onImageFallback?.('当前所选模型未声明支持识图，已自动降级为纯文字设计（如需模仿参考图风格，请切换支持视觉的多模态模型）。')
      }
    }
    let text
    try {
      text = await runOnce(shouldSendImages)
    } catch (err) {
      if (shouldSendImages && isImageUnsupportedError(err)) {
        if (strictImages) {
          throw Object.assign(
            new Error('当前模型暂不支持图片输入，无法分析参考图；请切换到支持视觉的多模态模型，或移除参考图后仅用文字诉求创建。'),
            { status: 400, code: 'VISION_UNSUPPORTED', cause: err },
          )
        }
        onImageFallback?.('当前模型暂不支持图片输入，已自动忽略参考图并按文字继续生成（切换支持识图的模型即可参考配图风格）。')
        text = await runOnce(false)
      } else {
        throw err
      }
    }
    modelStatus.ok = true
    modelStatus.error = null
    return text
  } catch (err) {
    modelStatus.ok = false
    modelStatus.error = err.message
    throw err
  }
}

/** 从模型输出里取出 JSON，容忍外面包了代码块、思考标签、尾随逗号、字符串内裸换行或紧随其后的 CSS 块。 */
export function extractJson(text) {
  const source = String(text ?? '')
    .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '')
    .replace(/<xhs[-_](?:style|page[-_]style)\b[^>]*>[\s\S]*?(?:<\/xhs[-_](?:style|page[-_]style)>|$)/gi, '')
    .trim()
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(source)
  const candidates = [fenced?.[1], source]
  for (const candidate of candidates) {
    if (!candidate) continue
    const balanced = extractBalancedJsonSlice(candidate)
    const start = candidate.search(/[{[]/)
    const lastSlice = start === -1
      ? ''
      : (() => {
        const open = candidate[start]
        const end = candidate.lastIndexOf(open === '{' ? '}' : ']')
        return end > start ? candidate.slice(start, end + 1) : ''
      })()
    for (const slice of [balanced, lastSlice]) {
      if (!slice) continue
      try {
        return JSON.parse(slice)
      } catch {
        try {
          return JSON.parse(repairLooseJson(slice))
        } catch {
          // 换下一个候选
        }
      }
    }
  }
  return null
}

/** 模型常把整篇包在 ```markdown 里，或者在前面加一句「好的，以下是……」。 */
export function cleanMarkdown(text) {
  let out = String(text ?? '').trim()
  const fenced = /^```(?:markdown|md)?\n([\s\S]*?)\n```$/.exec(out)
  if (fenced) out = fenced[1].trim()
  return out
}

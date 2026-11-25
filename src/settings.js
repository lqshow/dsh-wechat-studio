import { COVER_PROVIDERS, modelsFor } from './cover-options.js'
import { normalizeGeminiBaseUrl, normalizeOpenAIBaseUrl } from './cover.js'
import { DEFAULT_PERSONA, normalizePersona, PERSONA_GENDERS, PERSONA_OUTFITS } from './cover-persona.js'
import { findBlocked, loadCoverBlocklist } from './cover-prompt.js'
import { writeJsonAtomic } from './fs-json.js'
import { STYLES, THEMES } from './layout.js'
import { withFileLock } from './store.js'
// 设置：存在 <DSH_HOME>/wechat-studio/settings.json（权限 600）。
// 朱雀 API Key 只留在本机，接口从不把明文返回给页面，只说「有没有」和末四位。
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { checkEndpoint, DEFAULT_ENDPOINT } from './zhuque.js'

// 公众号 API 凭证：名称/AppID/AppSecret 与独立缓存头像，用来推送草稿箱与信息流预览。AppSecret 只留在本机。
const DEFAULT_MP = { name: '', appId: '', appSecret: '', headImg: '' }

function safeAvatarUrl(value) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim().slice(0, 2000)
  if (!trimmed || !URL.canParse(trimmed)) return ''
  const parsed = new URL(trimmed)
  if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || parsed.username || parsed.password) return ''
  return trimmed
}

// 每篇都一样的固定句：检测时整行去掉，避免和正文混进同一个片段把分数拉高
const DEFAULTS = { fixedLines: ['设为「星标」', '教你用AI干掉90%的重复劳动'], preflightWords: [], style: null, theme: null, zhuqueKey: '', zhuqueEndpoint: DEFAULT_ENDPOINT, model: { provider: '', model: '' } }

const DEFAULT_BRAND = {
  author: '林月半子的AI笔记',
  slogan: '我是林月半子，教你用AI干掉90%的重复劳动',
}

// 旧版的默认参考图（插件作者本人）。旧版每次保存设置都会把它写进 settings.json，
// 所以不能只删默认值：保留它，但在页面上提醒不是作者本人的用户换掉。
export const AUTHOR_SAMPLE_PORTRAIT = 'https://r2.cloudnative101.net/assets/images/portrait.png'

const brandField = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : ''

const lines = value => (Array.isArray(value) ? value.filter(v => typeof v === 'string').map(v => v.trim()).filter(Boolean).slice(0, 20) : null)

const cleanPreflightWords = value => {
  if (!Array.isArray(value)) return null
  const out = []
  const seen = new Set()
  for (const item of value) {
    if (typeof item !== 'string') continue
    const word = item.trim().slice(0, 60)
    if (!word || seen.has(word)) continue
    seen.add(word)
    out.push(word)
    if (out.length >= 100) break
  }
  return out
}

async function parseSettingsFile(file) {
  let raw
  try {
    raw = await readFile(file, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') return { status: 'missing' }
    throw err
  }
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { status: 'corrupt' }
    return { status: 'ok', value: parsed }
  } catch {
    return { status: 'corrupt' }
  }
}

export async function readSettings(root) {
  const file = join(root, 'settings.json')
  let saved = {}
  const main = await parseSettingsFile(file)
  if (main.status === 'ok') {
    saved = main.value
  } else {
    const backup = await parseSettingsFile(`${file}.bak`)
    if (backup.status === 'ok') {
      saved = backup.value
    } else if (main.status === 'corrupt') {
      throw Object.assign(
        new Error('settings.json 已损坏，无法解析；为避免覆盖原有配置与凭证，已中止操作，请检查或修复该文件。'),
        { status: 500, code: 'SETTINGS_CORRUPT' },
      )
    }
  }
  return {
    ...DEFAULTS, ...saved,
    style: STYLES.includes(saved.style) ? saved.style : null,
    theme: THEMES.includes(saved.theme) ? saved.theme : null,
    brand: {
      author: brandField(saved.brand?.author, 32) || DEFAULT_BRAND.author,
      slogan: brandField(saved.brand?.slogan, 80) || DEFAULT_BRAND.slogan,
    },
    arkModel: modelsFor('ark').find(model => model.id === saved.arkModel)?.id ?? modelsFor('ark')[0].id,
    arkKey: typeof saved.arkKey === 'string' ? saved.arkKey : '',
    coverProvider: COVER_PROVIDERS.some(provider => provider.id === saved.coverProvider) ? saved.coverProvider : 'ark',
    bailianModel: modelsFor('bailian').find(model => model.id === saved.bailianModel)?.id ?? modelsFor('bailian')[0].id,
    bailianKey: typeof saved.bailianKey === 'string' ? saved.bailianKey : '',
    minimaxModel: modelsFor('minimax').find(model => model.id === saved.minimaxModel)?.id ?? modelsFor('minimax')[0].id,
    minimaxKey: typeof saved.minimaxKey === 'string' ? saved.minimaxKey : '',
    geminiModel: modelsFor('gemini').find(model => model.id === saved.geminiModel)?.id ?? modelsFor('gemini')[0].id,
    geminiKey: typeof saved.geminiKey === 'string' ? saved.geminiKey : '',
    geminiBaseUrl: (() => {
      if (typeof saved.geminiBaseUrl !== 'string' || !saved.geminiBaseUrl.trim()) return ''
      try { return normalizeGeminiBaseUrl(saved.geminiBaseUrl) } catch { return '' }
    })(),
    openaiModel: modelsFor('openai').find(model => model.id === saved.openaiModel)?.id ?? modelsFor('openai')[0].id,
    openaiKey: typeof saved.openaiKey === 'string' ? saved.openaiKey : '',
    openaiBaseUrl: (() => {
      if (typeof saved.openaiBaseUrl !== 'string' || !saved.openaiBaseUrl.trim()) return ''
      try { return normalizeOpenAIBaseUrl(saved.openaiBaseUrl) } catch { return '' }
    })(),
    portraitUrl: typeof saved.portraitUrl === 'string' ? saved.portraitUrl : '',
    persona: normalizePersona(saved.persona),
    cloudinary: {
      cloudName: typeof saved.cloudinary?.cloudName === 'string' ? saved.cloudinary.cloudName : '',
      apiKey: typeof saved.cloudinary?.apiKey === 'string' ? saved.cloudinary.apiKey : '',
      apiSecret: typeof saved.cloudinary?.apiSecret === 'string' ? saved.cloudinary.apiSecret : '',
    },
    fixedLines: lines(saved.fixedLines) ?? DEFAULTS.fixedLines,
    preflightWords: cleanPreflightWords(saved.preflightWords) ?? DEFAULTS.preflightWords,
    zhuqueKey: typeof saved.zhuqueKey === 'string' ? saved.zhuqueKey : '',
    zhuqueEndpoint: typeof saved.zhuqueEndpoint === 'string' && saved.zhuqueEndpoint ? saved.zhuqueEndpoint : DEFAULT_ENDPOINT,
    mp: {
      name: typeof saved.mp?.name === 'string' ? saved.mp.name : '',
      appId: typeof saved.mp?.appId === 'string' ? saved.mp.appId : '',
      appSecret: typeof saved.mp?.appSecret === 'string' ? saved.mp.appSecret : '',
      headImg: safeAvatarUrl(saved.mp?.headImg),
    },
    model: saved.model?.provider && saved.model?.model ? { provider: String(saved.model.provider), model: String(saved.model.model) } : { provider: '', model: '' },
  }
}

/**
 * 按白名单更新设置。zhuqueKey 传空字符串表示清除；zhuqueEndpoint 传空字符串表示恢复默认。
 * @param {string} root - 数据目录。
 * @param {object} body - 页面发来的修改。
 */
export async function updateSettings(root, body) {
  const file = join(root, 'settings.json')
  return withFileLock(`${file}.lock`, async () => {
    const next = await readSettings(root)
    if (body.style !== undefined) {
      if (body.style === null || body.style === '') next.style = null
      else if (typeof body.style === 'string' && STYLES.includes(body.style)) next.style = body.style
      else throw Object.assign(new Error(`不支持的排版风格：${body.style}（可选：${STYLES.join(', ')}）`), { status: 400 })
    }
    if (body.theme !== undefined) {
      if (body.theme === null || body.theme === '') next.theme = null
      else if (typeof body.theme === 'string' && THEMES.includes(body.theme)) next.theme = body.theme
      else throw Object.assign(new Error(`不支持的配色主题：${body.theme}（可选：${THEMES.join(', ')}）`), { status: 400 })
    }
  if (lines(body.fixedLines)) next.fixedLines = lines(body.fixedLines)
  if (cleanPreflightWords(body.preflightWords) !== null) next.preflightWords = cleanPreflightWords(body.preflightWords)
  if (typeof body.zhuqueKey === 'string') next.zhuqueKey = body.zhuqueKey.trim().slice(0, 400)
  if (typeof body.zhuqueEndpoint === 'string') next.zhuqueEndpoint = body.zhuqueEndpoint.trim() ? checkEndpoint(body.zhuqueEndpoint.trim()) : DEFAULT_ENDPOINT
  if (body.brand && typeof body.brand === 'object') {
    if (typeof body.brand.author === 'string') next.brand.author = brandField(body.brand.author, 32) || DEFAULT_BRAND.author
    if (typeof body.brand.slogan === 'string') next.brand.slogan = brandField(body.brand.slogan, 80) || DEFAULT_BRAND.slogan
  }
  if (body.arkModel !== undefined) {
    if (!modelsFor('ark').some(model => model.id === body.arkModel)) {
      throw Object.assign(new Error('请选择支持的封面模型。'), { status: 400 })
    }
    next.arkModel = body.arkModel
  }
  if (typeof body.arkKey === 'string') next.arkKey = body.arkKey.trim().slice(0, 400)
  if (body.coverProvider !== undefined) {
    if (!COVER_PROVIDERS.some(provider => provider.id === body.coverProvider)) {
      throw Object.assign(new Error('请选择支持的封面提供方。'), { status: 400 })
    }
    next.coverProvider = body.coverProvider
  }
  if (body.bailianModel !== undefined) {
    if (!modelsFor('bailian').some(model => model.id === body.bailianModel)) {
      throw Object.assign(new Error('请选择支持的百炼封面模型。'), { status: 400 })
    }
    next.bailianModel = body.bailianModel
  }
  if (typeof body.bailianKey === 'string') next.bailianKey = body.bailianKey.trim().slice(0, 400)
  if (body.minimaxModel !== undefined) {
    if (!modelsFor('minimax').some(model => model.id === body.minimaxModel)) {
      throw Object.assign(new Error('请选择支持的 MiniMax 封面模型。'), { status: 400 })
    }
    next.minimaxModel = body.minimaxModel
  }
  if (typeof body.minimaxKey === 'string') next.minimaxKey = body.minimaxKey.trim().slice(0, 400)
  if (body.geminiModel !== undefined) {
    if (!modelsFor('gemini').some(model => model.id === body.geminiModel)) {
      throw Object.assign(new Error('请选择支持的 Google Gemini 封面模型。'), { status: 400 })
    }
    next.geminiModel = body.geminiModel
  }
  if (typeof body.geminiKey === 'string') next.geminiKey = body.geminiKey.trim().slice(0, 400)
  if (typeof body.geminiBaseUrl === 'string') {
    next.geminiBaseUrl = body.geminiBaseUrl.trim() ? normalizeGeminiBaseUrl(body.geminiBaseUrl) : ''
  }
  if (body.openaiModel !== undefined) {
    if (!modelsFor('openai').some(model => model.id === body.openaiModel)) {
      throw Object.assign(new Error('请选择支持的 OpenAI 封面模型。'), { status: 400 })
    }
    next.openaiModel = body.openaiModel
  }
  if (typeof body.openaiKey === 'string') next.openaiKey = body.openaiKey.trim().slice(0, 400)
  if (typeof body.openaiBaseUrl === 'string') {
    next.openaiBaseUrl = body.openaiBaseUrl.trim() ? normalizeOpenAIBaseUrl(body.openaiBaseUrl) : ''
  }
  if (typeof body.portraitUrl === 'string') {
    const value = body.portraitUrl.trim().slice(0, 2000)
    const url = value ? (URL.canParse(value) ? new URL(value) : null) : null
    if (value && (url?.protocol !== 'https:' || url.username || url.password)) {
      throw Object.assign(new Error('IP 人物参考图需要是不带账号密码的 https 图片地址。'), { status: 400 })
    }
    next.portraitUrl = value
  }
  if (body.persona && typeof body.persona === 'object') {
    const merged = { ...next.persona, ...body.persona }
    if (!PERSONA_GENDERS.includes(merged.gender)) throw Object.assign(new Error('请选择有效的人物性别。'), { status: 400 })
    if (!PERSONA_OUTFITS.includes(merged.outfit)) throw Object.assign(new Error('请选择有效的服装来源。'), { status: 400 })
    const persona = normalizePersona(merged)
    if (persona.outfit === 'custom' && !persona.outfitText) throw Object.assign(new Error('选了自定义服装时，请填写服装描述。'), { status: 400 })
    const terms = await loadCoverBlocklist()
    const fields = persona.outfit === 'custom' ? [['outfitText', '服装描述'], ['appearance', '外貌补充']] : [['appearance', '外貌补充']]
    for (const [field, label] of fields) {
      const blocked = findBlocked(terms, persona[field])
      if (blocked) throw Object.assign(new Error(`${label}里有封面禁用词「${blocked}」，请换成克制的说法。`), { status: 400 })
    }
    next.persona = persona
  }
  if (body.cloudinary && typeof body.cloudinary === 'object') {
    for (const field of ['cloudName', 'apiKey', 'apiSecret']) {
      if (typeof body.cloudinary[field] === 'string') next.cloudinary[field] = body.cloudinary[field].trim().slice(0, 400)
    }
    if (next.cloudinary.cloudName && !/^[a-zA-Z0-9_-]+$/.test(next.cloudinary.cloudName)) {
      throw Object.assign(new Error('Cloudinary Cloud Name 只能包含字母、数字、下划线和短横线。'), { status: 400 })
    }
  }
  if (body.model && typeof body.model === 'object') {
    const provider = typeof body.model.provider === 'string' ? body.model.provider.trim().slice(0, 200) : ''
    const model = typeof body.model.model === 'string' ? body.model.model.trim().slice(0, 200) : ''
    // 要么都填（指定模型），要么都空（跟随 DSH 默认）
    if (Boolean(provider) !== Boolean(model)) throw Object.assign(new Error('模型的提供方和名称要一起填'), { status: 400 })
    next.model = { provider, model }
  }
  if (body.mp && typeof body.mp === 'object') {
    const prevAppId = next.mp.appId
    // appSecret 传空字符串表示清除；不传（undefined）表示保持不变
    for (const field of ['name', 'appId', 'appSecret']) {
      if (typeof body.mp[field] === 'string') next.mp[field] = body.mp[field].trim().slice(0, 400)
    }
    if (typeof body.mp.headImg === 'string') {
      next.mp.headImg = safeAvatarUrl(body.mp.headImg)
    } else if (next.mp.appId !== prevAppId) {
      next.mp.headImg = ''
    }
    if (next.mp.appSecret && !/^[a-f0-9]{32}$/i.test(next.mp.appSecret)) {
      throw Object.assign(new Error('AppSecret 是 32 位十六进制字符串，请到微信开发者平台「我的业务 → 公众号/服务号 → 基础信息 → 开发密钥」复制完整的一串。'), { status: 400 })
    }
  }
    await mkdir(root, { recursive: true })
    await writeJsonAtomic(file, next)
    return next
  })
}

/**
 * 在文件锁内按期望 appId 条件缓存公众号头像，避免并发切换账号时延迟返回的验证结果覆盖新账号。
 * @param {string} root
 * @param {string} expectedAppId
 * @param {string} headImg
 */
export async function cacheMpHeadImg(root, expectedAppId, headImg) {
  const cleanId = typeof expectedAppId === 'string' ? expectedAppId.trim() : ''
  const cleanUrl = safeAvatarUrl(headImg)
  if (!cleanId || !cleanUrl) return null
  const file = join(root, 'settings.json')
  return withFileLock(`${file}.lock`, async () => {
    const next = await readSettings(root)
    if (next.mp.appId !== cleanId) return next
    if (next.mp.headImg === cleanUrl) return next
    next.mp.headImg = cleanUrl
    await mkdir(root, { recursive: true })
    await writeJsonAtomic(file, next)
    return next
  })
}

/** 给页面看的设置：不含密钥明文。 */
export function publicSettings(settings) {
  const key = settings.zhuqueKey
  return {
    style: settings.style ?? null,
    theme: settings.theme ?? null,
    fixedLines: settings.fixedLines,
    preflightWords: settings.preflightWords ?? [],
    brand: settings.brand,
    arkModel: settings.arkModel,
    arkKeySet: Boolean(settings.arkKey),
    coverProvider: settings.coverProvider,
    bailianModel: settings.bailianModel,
    bailianKeySet: Boolean(settings.bailianKey),
    minimaxModel: settings.minimaxModel,
    minimaxKeySet: Boolean(settings.minimaxKey),
    geminiModel: settings.geminiModel,
    geminiKeySet: Boolean(settings.geminiKey),
    geminiBaseUrl: settings.geminiBaseUrl,
    openaiModel: settings.openaiModel,
    openaiKeySet: Boolean(settings.openaiKey),
    openaiBaseUrl: settings.openaiBaseUrl,
    portraitUrl: settings.portraitUrl,
    persona: settings.persona ?? DEFAULT_PERSONA,
    portraitIsAuthorSample: settings.portraitUrl === AUTHOR_SAMPLE_PORTRAIT,
    cloudinary: {
      cloudName: settings.cloudinary?.cloudName ?? '',
      apiKey: settings.cloudinary?.apiKey ?? '',
      apiSecretSet: Boolean(settings.cloudinary?.apiSecret),
    },
    mp: {
      name: settings.mp?.name ?? DEFAULT_MP.name,
      appId: settings.mp?.appId ?? DEFAULT_MP.appId,
      appSecretSet: Boolean(settings.mp?.appSecret),
      headImg: settings.mp?.headImg ?? DEFAULT_MP.headImg,
    },
    zhuqueKeySet: Boolean(key),
    zhuqueKeyTail: key ? key.slice(-4) : '',
    zhuqueEndpoint: settings.zhuqueEndpoint,
    zhuqueEndpointDefault: settings.zhuqueEndpoint === DEFAULT_ENDPOINT,
    model: settings.model,
  }
}

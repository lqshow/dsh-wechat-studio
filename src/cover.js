import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BAILIAN_SIZES, GEMINI_DEFAULT_BASE_URL, MINIMAX_SIZES, OPENAI_DEFAULT_BASE_URL, OPENAI_LEGACY_LANDSCAPE_SIZE, OPENAI_SIZES } from './cover-options.js'
import { resolveCoverStyleName } from './cover-styles.js'
export { coverPrompt } from './cover-prompt.js'

const MAX_IMAGE = 24 * 1024 * 1024
const MAX_B64_CHARS = Math.ceil(MAX_IMAGE * 4 / 3) + 16
const MINIMAX_GENERATIONS = 'https://api.minimax.cn/v1/images/generations'
const MINIMAX_EDITS = 'https://api.minimax.cn/v1/images/edits'
const MINIMAX_TIMEOUT_MS = 600_000

function providerDetail(value, limit, apiKey) {
  if (typeof value !== 'string') return ''
  let text = value.replace(/\s+/g, ' ').trim()
  if (apiKey) text = text.split(apiKey).join('[已隐藏]')
  return text
    .replace(/Bearer\s+\S+/gi, 'Bearer [已隐藏]')
    .replace(/x-goog-api-key[:=\s]+\S+/gi, 'x-goog-api-key [已隐藏]')
    .slice(0, limit)
}

function decodeBase64Image(encoded, format, providerLabel, subject, requestSuffix = '') {
  if (typeof encoded !== 'string') throw new Error(`${providerLabel}未返回可保存的${subject}。${requestSuffix}`)
  const normalized = encoded.trim()
  if (!normalized) throw new Error(`${providerLabel}未返回可保存的${subject}。${requestSuffix}`)
  if (normalized.length > MAX_B64_CHARS) {
    throw new Error(`${providerLabel}${subject}超过 24 MB，试试降低分辨率。${requestSuffix}`)
  }
  const image = Buffer.from(normalized, 'base64')
  if (!image.length) throw new Error(`${providerLabel}未返回可保存的${subject}。${requestSuffix}`)
  if (image.length > MAX_IMAGE) {
    throw new Error(`${providerLabel}${subject}超过 24 MB，试试降低分辨率。${requestSuffix}`)
  }
  const valid = format === 'jpeg'
    ? image.toString('hex', 0, 3) === 'ffd8ff'
    : image.toString('hex', 0, 8) === '89504e470d0a1a0a'
  if (!valid) throw new Error(`生成结果与所选图片格式不符。${requestSuffix}`)
  return image
}

export async function generateArkCover(prompt, { apiKey, model, resolution, format, referenceImage = null, subject = '封面' }, fetchImpl = fetch) {
  const res = await fetchImpl('https://ark.cn-beijing.volces.com/api/v3/images/generations', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(180_000),
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model, prompt, ...(referenceImage ? { image: referenceImage } : {}), size: resolution,
      response_format: 'b64_json', output_format: format, background: 'opaque', watermark: false,
    }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const code = providerDetail(body?.error?.code, 120, apiKey)
    const message = providerDetail(body?.error?.message, 400, apiKey)
    const requestId = [
      body?.request_id, body?.error?.request_id,
      res.headers?.get?.('x-request-id'), res.headers?.get?.('x-tt-logid'),
    ].map(value => providerDetail(value, 120, apiKey)).find(Boolean) ?? ''
    const requestSuffix = requestId ? ` 请求 ID：${requestId}` : ''
    if (code === 'ModelNotOpen') throw new Error('当前火山方舟账号尚未开通 Doubao Seedream 5.5，请在方舟控制台的「开通管理」中开通。' + requestSuffix)
    if (code === 'InvalidEndpointOrModel.NotFound') throw new Error('火山方舟找不到 Seedream 5.5 或当前 API Key 无权调用，请检查项目和模型权限。' + requestSuffix)
    if (code === 'InvalidEndpointOrModel.ModelIDAccessDisabled') throw new Error('当前火山方舟账号不允许通过模型 ID 调用，需要使用有权限的推理接入点。' + requestSuffix)
    if (res.status === 401 || res.status === 403) throw new Error('火山方舟鉴权失败，请检查 API Key 和模型权限。' + requestSuffix)
    const details = [code && `错误码：${code}`, message && `原因：${message}`, requestId && `请求 ID：${requestId}`].filter(Boolean).join('；')
    throw new Error(`火山方舟生成失败（HTTP ${res.status}）${details ? `：${details}` : '，请重试。'}`)
  }
  const { data } = await res.json()
  return decodeBase64Image(data?.[0]?.b64_json, format, '火山方舟', subject)
}

function minimaxRequestId(body, res, apiKey) {
  return [
    body?.request_id,
    body?.error?.request_id,
    res?.headers?.get?.('trace_id'),
    res?.headers?.get?.('x-request-id'),
  ].map(value => providerDetail(value, 120, apiKey)).find(Boolean) ?? ''
}

function minimaxErrorCode(body, itemError) {
  const direct = itemError?.code ?? body?.error?.code
  if (direct !== undefined && direct !== null && String(direct).trim()) return String(direct).trim()
  const message = typeof itemError?.message === 'string' ? itemError.message
    : typeof body?.error?.message === 'string' ? body.error.message : ''
  return message.match(/\((\d+)\)\s*$/)?.[1] ?? ''
}

function minimaxErrorMessage({ status, body, requestId, apiKey, itemError = null, subject = '封面' }) {
  const code = minimaxErrorCode(body, itemError)
  const type = providerDetail(body?.error?.type, 120, apiKey)
  const message = providerDetail(itemError?.message ?? body?.error?.message, 400, apiKey)
  const requestSuffix = requestId ? ` 请求 ID：${requestId}` : ''
  if (status === 401 || code === '1004' || code === '2049') {
    return 'MiniMax 鉴权失败或 API Key 无效，请检查是否使用国内平台（platform.minimax.cn）的有效密钥。' + requestSuffix
  }
  if (code === '2022') return 'MiniMax 模型不存在或当前账号无权使用，请检查模型配置。' + requestSuffix
  if (code === '2069') return '当前所选 MiniMax 模型已下线，请切换其他可用模型。' + requestSuffix
  if (code === '2068' || code === '2061') return '当前 MiniMax 套餐等级不支持该模型，请升级套餐或切换模型。' + requestSuffix
  if (code === '1008' || code === '2053' || code === '2067' || status === 402) {
    return 'MiniMax 余额、积分或套餐额度不足，请充值或检查额度后再试。' + requestSuffix
  }
  if (status === 422 || code === '1026' || code === '1027') {
    return '提示词或生成结果未通过 MiniMax 内容安全审核，请调整后重试。' + requestSuffix
  }
  if (status === 429 || code === '1002' || code === '2056' || code === '2062') {
    return 'MiniMax 触发速率限制或套餐用量达到上限，请稍后再试。' + requestSuffix
  }
  if (code === '1001') return 'MiniMax 服务端等待超时，请稍后再试。' + requestSuffix
  const details = [
    code && `错误码：${code}`,
    type && `类型：${type}`,
    message && `原因：${message}`,
    requestId && `请求 ID：${requestId}`,
  ].filter(Boolean).join('；')
  return `MiniMax ${subject}生成失败（HTTP ${status}）${details ? `：${details}` : '。'}`
}

export async function generateMinimaxCover(prompt, { apiKey, model, resolution, format = 'png', referenceImage = null, size: explicitSize, subject = '封面' }, fetchImpl = fetch) {
  const hasRef = Boolean(referenceImage)
  const endpoint = hasRef ? MINIMAX_EDITS : MINIMAX_GENERATIONS
  // 文生图关闭服务端 Prompt 增强，避免改写模板排版或引入禁用词；图片编辑官方固定开启增强，不传该字段。
  const payload = {
    model,
    prompt,
    size: explicitSize ?? MINIMAX_SIZES[resolution],
    n: 1,
    output_format: format,
    response_format: 'b64_json',
    aigc_watermark: false,
    ...(hasRef ? { images: [{ image_url: referenceImage }] } : { disable_prompt_enhanced: true }),
  }
  let res
  try {
    // MiniMax H3 服务端最长等待 600 秒且非幂等；绝不自动重试，超时后提示避免立即重复提交。
    res = await fetchImpl(endpoint, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(MINIMAX_TIMEOUT_MS),
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    if (err?.name === 'TimeoutError') {
      throw Object.assign(
        new Error(`MiniMax ${subject}生成已等待 600 秒并断开，服务端仍可能完成并计费；请避免立即重复提交。`),
        { code: 'MINIMAX_TIMEOUT', nonRetryable: true, cause: err },
      )
    }
    throw err
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const requestId = minimaxRequestId(body, res, apiKey)
    throw new Error(minimaxErrorMessage({ status: res.status, body, requestId, apiKey, subject }))
  }
  const body = await res.json().catch(() => null)
  const requestId = minimaxRequestId(body, res, apiKey)
  const requestSuffix = requestId ? ` 请求 ID：${requestId}` : ''
  if (!body || typeof body !== 'object') {
    throw new Error(`MiniMax 返回了无效响应，无法保存${subject}。${requestSuffix}`)
  }
  const first = body.data?.[0]
  if (first?.error) {
    throw new Error(minimaxErrorMessage({ status: res.status, body, requestId, apiKey, itemError: first.error, subject }))
  }
  return decodeBase64Image(first?.b64_json, format, 'MiniMax', subject, requestSuffix)
}

const GEMINI_TIMEOUT_MS = 180_000
const GEMINI_SAFETY_REASONS = new Set(['SAFETY', 'IMAGE_SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'IMAGE_PROHIBITED_CONTENT'])

export function normalizeGeminiBaseUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return GEMINI_DEFAULT_BASE_URL
  const trimmed = value.trim().slice(0, 500)
  const parsed = URL.canParse(trimmed) ? new URL(trimmed) : null
  if (!parsed || parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw Object.assign(new Error('Google Gemini API 地址需要是不带账号密码的 https:// 地址。'), { status: 400 })
  }
  let pathname = parsed.pathname.replace(/\/+$/, '')
  pathname = pathname.replace(/\/v1beta$/i, '').replace(/\/+$/, '')
  return `${parsed.origin}${pathname}`
}

function detectReferenceMimeType(image, contentType = '') {
  if (image.length >= 8 && image.toString('hex', 0, 8) === '89504e470d0a1a0a') return 'image/png'
  if (image.length >= 3 && image.toString('hex', 0, 3) === 'ffd8ff') return 'image/jpeg'
  if (image.length >= 12 && image.toString('ascii', 0, 4) === 'RIFF' && image.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  const normalized = String(contentType).split(';')[0].trim().toLowerCase()
  if (normalized === 'image/png' || normalized === 'image/jpeg' || normalized === 'image/webp') return normalized
  return ''
}

async function loadReferenceImage(referenceImage, fetchImpl) {
  const dataMatch = typeof referenceImage === 'string'
    ? referenceImage.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/i)
    : null
  if (dataMatch) {
    const mimeType = dataMatch[1].toLowerCase()
    const cleaned = dataMatch[2].replace(/\s+/g, '')
    if (!cleaned || cleaned.length > MAX_B64_CHARS) throw new Error('参考图无效或超过 24 MB。')
    const decoded = Buffer.from(cleaned, 'base64')
    if (!decoded.length || decoded.length > MAX_IMAGE) throw new Error('参考图无效或超过 24 MB。')
    const detected = detectReferenceMimeType(decoded, mimeType)
    if (!detected) throw new Error('参考图仅支持 PNG、JPEG 或 WebP 格式。')
    return { mimeType: detected, data: cleaned, buffer: decoded }
  }
  const refUrl = typeof referenceImage === 'string' && URL.canParse(referenceImage) ? new URL(referenceImage) : null
  if (!refUrl || refUrl.protocol !== 'https:' || refUrl.username || refUrl.password) {
    throw new Error('参考图需要是有效的 https 图片地址。')
  }
  const refRes = await fetchImpl(referenceImage, { redirect: 'error', signal: AbortSignal.timeout(60_000) })
  if (!refRes.ok || !refRes.body) {
    await refRes.body?.cancel().catch(() => {})
    throw new Error('参考图下载失败，请检查地址是否可访问。')
  }
  if (Number(refRes.headers?.get?.('content-length')) > MAX_IMAGE) {
    await refRes.body.cancel().catch(() => {})
    throw new Error('参考图超过 24 MB，请换一张较小的图片。')
  }
  const chunks = []
  let size = 0
  for await (const chunk of refRes.body) {
    size += chunk.byteLength
    if (size > MAX_IMAGE) throw new Error('参考图超过 24 MB，请换一张较小的图片。')
    chunks.push(chunk)
  }
  const image = Buffer.concat(chunks, size)
  const mimeType = detectReferenceMimeType(image, refRes.headers?.get?.('content-type') ?? '')
  if (!mimeType) throw new Error('参考图仅支持 PNG、JPEG 或 WebP 格式。')
  return { mimeType, data: image.toString('base64'), buffer: image }
}

async function loadGeminiReferenceImage(referenceImage, fetchImpl) {
  const { mimeType, data } = await loadReferenceImage(referenceImage, fetchImpl)
  return { mimeType, data }
}

export async function generateGeminiCover(
  prompt,
  { apiKey, model, resolution = '2K', format = 'png', referenceImage = null, baseUrl = '', aspectRatio = '21:9', subject = '封面' },
  fetchImpl = fetch,
) {
  const endpoint = `${normalizeGeminiBaseUrl(baseUrl)}/v1beta/models/${encodeURIComponent(model)}:generateContent`
  const parts = []
  if (referenceImage) {
    const inlineData = await loadGeminiReferenceImage(referenceImage, fetchImpl)
    parts.push({ inlineData })
  }
  parts.push({ text: prompt })

  const imageSize = resolution === '1K' ? '1K' : '2K'
  const res = await fetchImpl(endpoint, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: { aspectRatio, imageSize },
      },
    }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const statusText = providerDetail(body?.error?.status, 120, apiKey)
    const message = providerDetail(body?.error?.message, 400, apiKey)
    if (res.status === 401 || res.status === 403 || (res.status === 400 && /api key not valid|api_key_invalid/i.test(`${statusText} ${message}`))) {
      throw new Error('Google Gemini 鉴权失败或 API Key 无权调用该模型，请检查密钥与项目权限。')
    }
    if (res.status === 404) {
      throw new Error(`Google Gemini 模型 ${model} 不存在或暂不可用，请切换其他模型。`)
    }
    if (res.status === 429) {
      throw new Error('Google Gemini 触发限流或配额不足；Nano Banana 生图需使用付费层级（Tier 1+）API Key，请检查结算与额度后再试。')
    }
    if (res.status === 400 && /location|region|country/i.test(message)) {
      throw new Error('当前网络出口地区不支持调用 Google Gemini，请切换代理或在设置中填写自定义 API 地址。')
    }
    const details = [statusText && `状态：${statusText}`, message && `原因：${message}`].filter(Boolean).join('；')
    throw new Error(`Google Gemini ${subject}生成失败（HTTP ${res.status}）${details ? `：${details}` : '，请重试。'}`)
  }

  const body = await res.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    throw new Error(`Google Gemini 返回了无效响应，无法保存${subject}。`)
  }
  if (body.promptFeedback?.blockReason) {
    throw new Error('提示词未通过 Google Gemini 内容安全审核，请调整后重试。')
  }
  const candidate = body.candidates?.[0]
  if (GEMINI_SAFETY_REASONS.has(candidate?.finishReason)) {
    throw new Error('提示词或生成结果未通过 Google Gemini 内容安全审核，请调整后重试。')
  }
  const imagePart = candidate?.content?.parts?.find(part => {
    const raw = part?.inlineData?.data ?? part?.inline_data?.data
    return typeof raw === 'string' && raw.trim().length > 0
  })
  const encoded = imagePart?.inlineData?.data ?? imagePart?.inline_data?.data
  if (typeof encoded !== 'string' || !encoded.trim()) {
    throw new Error(`Google Gemini 未返回可保存的${subject}。`)
  }
  const normalized = encoded.trim()
  if (normalized.length > MAX_B64_CHARS) {
    throw new Error(`Google Gemini ${subject}超过 24 MB，试试降低分辨率。`)
  }
  const raw = Buffer.from(normalized, 'base64')
  if (!raw.length) throw new Error(`Google Gemini 未返回可保存的${subject}。`)
  if (raw.length > MAX_IMAGE) {
    throw new Error(`Google Gemini ${subject}超过 24 MB，试试降低分辨率。`)
  }
  try {
    const { normalizeImageFormat } = await import('../dist/image-crop.mjs')
    return normalizeImageFormat(raw, format)
  } catch {
    throw new Error(`Google Gemini 返回了无法解析的${subject}格式。`)
  }
}

const OPENAI_TIMEOUT_MS = 180_000
const OPENAI_FIXED_SIZE_MODELS = new Set(['gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini'])
const OPENAI_MODERATION_CODES = new Set(['moderation_blocked', 'content_policy_violation', 'safety_system'])

export function normalizeOpenAIBaseUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return OPENAI_DEFAULT_BASE_URL
  const trimmed = value.trim().slice(0, 500)
  const parsed = URL.canParse(trimmed) ? new URL(trimmed) : null
  if (!parsed || parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw Object.assign(new Error('OpenAI API 地址需要是不带账号密码的 https:// 地址。'), { status: 400 })
  }
  let pathname = parsed.pathname.replace(/\/+$/, '')
  pathname = pathname.replace(/\/images\/(?:generations|edits)$/i, '').replace(/\/+$/, '')
  if (!pathname) pathname = '/v1'
  return `${parsed.origin}${pathname}`
}

function openaiRequestId(body, res, apiKey) {
  return [
    body?.request_id,
    body?.error?.request_id,
    res?.headers?.get?.('x-request-id'),
  ].map(value => providerDetail(value, 120, apiKey)).find(Boolean) ?? ''
}

function openaiErrorMessage({ status, body, model, requestId, apiKey, subject = '封面' }) {
  const code = providerDetail(body?.error?.code, 120, apiKey)
  const type = providerDetail(body?.error?.type, 120, apiKey)
  const message = providerDetail(body?.error?.message, 400, apiKey)
  const requestSuffix = requestId ? ` 请求 ID：${requestId}` : ''
  if (status === 401 || code === 'invalid_api_key') {
    return 'OpenAI 鉴权失败或 API Key 无效，请检查密钥配置。' + requestSuffix
  }
  if (status === 403) {
    if (/organization|verified|verify/i.test(message)) {
      return 'OpenAI 当前账号或组织无权调用该生图模型（部分 GPT Image 模型需在 OpenAI 控制台完成组织验证）。' + requestSuffix
    }
    return 'OpenAI 鉴权失败或无权调用该模型，请检查密钥与组织权限。' + requestSuffix
  }
  if (status === 404 || code === 'model_not_found') {
    return `OpenAI 模型 ${model} 不存在或当前账号暂不可用，请切换其他模型。` + requestSuffix
  }
  if (code === 'insufficient_quota' || code === 'billing_hard_limit_reached') {
    return 'OpenAI 账号余额或配额不足，请检查结算与额度后再试。' + requestSuffix
  }
  if (status === 429 || code === 'rate_limit_exceeded') {
    return 'OpenAI 触发速率限制或配额不足，请稍后再试。' + requestSuffix
  }
  if (OPENAI_MODERATION_CODES.has(code)) {
    return '提示词或生成结果未通过 OpenAI 内容安全审核，请调整后重试。' + requestSuffix
  }
  if (status === 400 && /country|region|territory|unsupported_country/i.test(message)) {
    return '当前网络出口地区不支持调用 OpenAI，请切换代理或在设置中填写自定义 API 地址。' + requestSuffix
  }
  const details = [
    code && `错误码：${code}`,
    type && `类型：${type}`,
    message && `原因：${message}`,
    requestId && `请求 ID：${requestId}`,
  ].filter(Boolean).join('；')
  return `OpenAI ${subject}生成失败（HTTP ${status}）${details ? `：${details}` : '，请重试。'}`
}

async function downloadOpenAIImageUrl(url, subject, requestSuffix, fetchImpl) {
  const imageUrl = URL.canParse(url) ? new URL(url) : null
  if (imageUrl?.protocol !== 'https:' || imageUrl.username || imageUrl.password) {
    throw new Error(`OpenAI 返回了无效的 HTTPS ${subject}地址。${requestSuffix}`)
  }
  const imageRes = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(60_000) })
  if (!imageRes.ok || !imageRes.body) {
    await imageRes.body?.cancel().catch(() => {})
    throw new Error(`OpenAI ${subject}下载失败，请重试。${requestSuffix}`)
  }
  const tooLarge = () => new Error(`OpenAI ${subject}超过 24 MB，试试降低分辨率。${requestSuffix}`)
  if (Number(imageRes.headers?.get?.('content-length')) > MAX_IMAGE) {
    await imageRes.body.cancel().catch(() => {})
    throw tooLarge()
  }
  const chunks = []
  let size = 0
  for await (const chunk of imageRes.body) {
    size += chunk.byteLength
    if (size > MAX_IMAGE) throw tooLarge()
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, size)
}

export async function generateOpenAICover(
  prompt,
  { apiKey, model, resolution = '2K', format = 'png', referenceImage = null, baseUrl = '', size: explicitSize, subject = '封面' },
  fetchImpl = fetch,
) {
  const base = normalizeOpenAIBaseUrl(baseUrl)
  const hasRef = Boolean(referenceImage)
  const endpoint = `${base}/images/${hasRef ? 'edits' : 'generations'}`
  const size = OPENAI_FIXED_SIZE_MODELS.has(model)
    ? OPENAI_LEGACY_LANDSCAPE_SIZE
    : (explicitSize ?? OPENAI_SIZES[resolution] ?? OPENAI_SIZES['2K'])

  let init
  if (hasRef) {
    const ref = await loadReferenceImage(referenceImage, fetchImpl)
    const ext = ref.mimeType === 'image/jpeg' ? 'jpg' : ref.mimeType === 'image/webp' ? 'webp' : 'png'
    const form = new FormData()
    form.set('model', model)
    form.set('prompt', prompt)
    form.set('n', '1')
    form.set('size', size)
    form.set('output_format', format)
    form.set('background', 'opaque')
    form.append('image', new Blob([ref.buffer], { type: ref.mimeType }), `reference.${ext}`)
    init = {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
    }
  } else {
    init = {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        n: 1,
        size,
        output_format: format,
        background: 'opaque',
      }),
    }
  }

  const res = await fetchImpl(endpoint, init)
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const requestId = openaiRequestId(body, res, apiKey)
    throw new Error(openaiErrorMessage({ status: res.status, body, model, requestId, apiKey, subject }))
  }
  const body = await res.json().catch(() => null)
  const requestId = openaiRequestId(body, res, apiKey)
  const requestSuffix = requestId ? ` 请求 ID：${requestId}` : ''
  if (!body || typeof body !== 'object') {
    throw new Error(`OpenAI 返回了无效响应，无法保存${subject}。${requestSuffix}`)
  }
  const first = body.data?.[0]
  let raw
  if (typeof first?.b64_json === 'string' && first.b64_json.trim()) {
    const normalized = first.b64_json.trim()
    if (normalized.length > MAX_B64_CHARS) {
      throw new Error(`OpenAI ${subject}超过 24 MB，试试降低分辨率。${requestSuffix}`)
    }
    raw = Buffer.from(normalized, 'base64')
    if (!raw.length) throw new Error(`OpenAI 未返回可保存的${subject}。${requestSuffix}`)
    if (raw.length > MAX_IMAGE) {
      throw new Error(`OpenAI ${subject}超过 24 MB，试试降低分辨率。${requestSuffix}`)
    }
  } else if (typeof first?.url === 'string' && first.url.trim()) {
    raw = await downloadOpenAIImageUrl(first.url.trim(), subject, requestSuffix, fetchImpl)
  } else {
    throw new Error(`OpenAI 未返回可保存的${subject}。${requestSuffix}`)
  }
  try {
    const { normalizeImageFormat } = await import('../dist/image-crop.mjs')
    return normalizeImageFormat(raw, format)
  } catch {
    throw new Error(`OpenAI 返回了无法解析的${subject}格式。${requestSuffix}`)
  }
}

export async function generateCoverImage(provider, prompt, options, fetchImpl = fetch) {
  if (provider === 'ark') return generateArkCover(prompt, options, fetchImpl)
  if (provider === 'bailian') return generateBailianCover(prompt, options, fetchImpl)
  if (provider === 'minimax') return generateMinimaxCover(prompt, options, fetchImpl)
  if (provider === 'gemini') return generateGeminiCover(prompt, options, fetchImpl)
  if (provider === 'openai') return generateOpenAICover(prompt, options, fetchImpl)
  throw Object.assign(new Error('请选择有效的生图提供方。'), { status: 400 })
}

export async function generateBailianCover(prompt, { apiKey, model, resolution, referenceImage = null, size: explicitSize, subject = '封面' }, fetchImpl = fetch) {
  // 万相和千问图像共用同一个多模态同步接口，换 model 即可；万相不支持 prompt_extend，只给千问关掉自动扩写。
  const parameters = { size: explicitSize ?? BAILIAN_SIZES[resolution], n: 1, watermark: false }
  if (model.startsWith('qwen-image')) parameters.prompt_extend = false
  const content = [...(referenceImage ? [{ image: referenceImage }] : []), { text: prompt }]
  const res = await fetchImpl('https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(180_000),
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      input: { messages: [{ role: 'user', content }] },
      parameters,
    }),
  })
  if (!res.ok) {
    const code = (await res.json().catch(() => null))?.code
    if (code === 'InvalidApiKey' || res.status === 401 || res.status === 403) throw new Error('百炼鉴权失败，请检查 API Key 是否属于中国内地（北京）及是否有模型权限。')
    if (code === 'Throttling' || res.status === 429) throw new Error('百炼限流，请稍后重试。')
    if (code === 'DataInspectionFailed') throw new Error('提示词未通过百炼内容审核，请调整后重试。')
    throw new Error(`百炼生成失败（HTTP ${res.status}），请重试。`)
  }
  const data = await res.json()
  // 百炼回的是 24 小时有效的 PNG 链接，要再下载成字节才能落盘裁切。
  const url = data?.output?.choices?.[0]?.message?.content?.find(part => typeof part?.image === 'string')?.image
  if (typeof url !== 'string') throw new Error(`百炼未返回可保存的${subject}。`)
  const imageUrl = URL.canParse(url) ? new URL(url) : null
  if (imageUrl?.protocol !== 'https:' || imageUrl.username || imageUrl.password) throw new Error(`百炼返回了无效的 HTTPS ${subject}地址。`)
  const imageRes = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(60_000) })
  if (!imageRes.ok || !imageRes.body) {
    await imageRes.body?.cancel().catch(() => {})
    throw new Error(`百炼${subject}下载失败，请重试。`)
  }
  const tooLarge = () => new Error(`百炼${subject}超过 24 MB，试试降低分辨率。`)
  if (Number(imageRes.headers.get('content-length')) > MAX_IMAGE) {
    await imageRes.body.cancel().catch(() => {})
    throw tooLarge()
  }
  const chunks = []
  let size = 0
  // 提前退出迭代会取消下载；即使服务端没提供 Content-Length 也能限制大小。
  for await (const chunk of imageRes.body) {
    size += chunk.byteLength
    if (size > MAX_IMAGE) throw tooLarge()
    chunks.push(chunk)
  }
  const image = Buffer.concat(chunks, size)
  if (image.toString('hex', 0, 8) !== '89504e470d0a1a0a') throw new Error(`百炼未返回有效的 PNG ${subject}。`)
  return image
}

export async function saveCover(root, image, format) {
  const dir = join(root, 'covers')
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const id = randomUUID()
  try {
    const { cropCover } = await import('../dist/image-crop.mjs')
    const cropped = cropCover(image, format)
    await writeFile(join(dir, `${id}.${format}`), cropped, { mode: 0o600 })
    return id
  } catch {
    throw new Error('封面裁切或保存失败，请重试。')
  }
}

export function readCover(root, id, format = 'png') {
  if (!/^[a-f0-9-]{36}$/.test(id ?? '')) throw new Error('无效的封面 ID。')
  return readFile(join(root, 'covers', `${id}.${format}`))
}

export function coverDownloadName(article, run, imageId, styleNameOverride = '') {
  const clean = value => String(value ?? '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[. ]+|[. ]+$/g, '')
  const title = clean(article.title).slice(0, 48) || '未命名文章'
  const style = clean(resolveCoverStyleName(run.style, null, styleNameOverride || run.styleName)) || '封面'
  const createdAt = new Date(run.createdAt)
  const date = Number.isNaN(createdAt.getTime()) ? '' : [
    [createdAt.getFullYear(), String(createdAt.getMonth() + 1).padStart(2, '0'), String(createdAt.getDate()).padStart(2, '0')].join('-'),
    [createdAt.getHours(), createdAt.getMinutes(), createdAt.getSeconds()].map(value => String(value).padStart(2, '0')).join(''),
  ].join('-')
  const index = Math.max(0, run.images.findIndex(image => image.id === imageId)) + 1
  return `${[title, style, date].filter(Boolean).join('-')}-${String(index).padStart(2, '0')}.${run.format ?? 'png'}`
}

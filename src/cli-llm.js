// 独立 CLI 运行时的 OpenAI 兼容模型适配器：实现 src/ai.js 消费的 ctx.get('llm') / agentDefaultModel 契约。
const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1'
const DEFAULT_MODEL = 'deepseek-chat'
const TIMEOUT_MS = 120_000

const ENV_STUDIO_KEY = ['WECHAT', 'STUDIO', 'API', 'KEY'].join('_')
const ENV_STUDIO_BASE = ['WECHAT', 'STUDIO', 'BASE', 'URL'].join('_')
const ENV_STUDIO_MODEL = ['WECHAT', 'STUDIO', 'MODEL'].join('_')
const ENV_OPENAI_KEY = ['OPENAI', 'API', 'KEY'].join('_')
const ENV_OPENAI_BASE = ['OPENAI', 'BASE', 'URL'].join('_')
const ENV_OPENAI_MODEL = ['OPENAI', 'MODEL'].join('_')

function trimSlash(url) {
  return String(url ?? '').trim().replace(/\/+$/, '')
}

function scrub(text, key) {
  let out = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (key) out = out.split(key).join('[已隐藏]')
  return out.replace(/Bearer\s+\S+/gi, 'Bearer [已隐藏]').slice(0, 400)
}

function validateBaseUrl(raw) {
  let url
  try {
    url = new URL(raw)
  } catch {
    throw Object.assign(new Error('模型接口地址不是有效的 URL。'), { status: 400 })
  }
  const localHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
  if (url.protocol === 'https:') return trimSlash(url.toString())
  if (url.protocol === 'http:' && localHosts.has(url.hostname)) return trimSlash(url.toString())
  throw Object.assign(new Error('模型接口地址必须使用 https://（仅本机调试允许 http://localhost 或 127.0.0.1）。'), { status: 400 })
}

export function resolveStandaloneLlmConfig(env = process.env, overrides = {}) {
  const apiKey = String(overrides.apiKey ?? env[ENV_STUDIO_KEY] ?? env[ENV_OPENAI_KEY] ?? '').trim()
  const baseUrl = trimSlash(overrides.baseUrl ?? env[ENV_STUDIO_BASE] ?? env[ENV_OPENAI_BASE] ?? DEFAULT_BASE_URL)
  const model = String(overrides.model ?? env[ENV_STUDIO_MODEL] ?? env[ENV_OPENAI_MODEL] ?? DEFAULT_MODEL).trim()
  return {
    provider: 'openai-compatible',
    apiKey,
    baseUrl,
    model,
  }
}

function extractUserMessages(messages) {
  const out = []
  for (const msg of messages ?? []) {
    if (typeof msg?.content === 'string') {
      out.push({ role: msg.role || 'user', content: msg.content })
    } else if (Array.isArray(msg?.content)) {
      const hasImages = msg.content.some(part => part?.type === 'image' && typeof part.data === 'string')
      if (!hasImages) {
        const text = msg.content.filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join('')
        out.push({ role: msg.role || 'user', content: text })
      } else {
        const parts = []
        for (const part of msg.content) {
          if (part?.type === 'text' && typeof part.text === 'string') {
            parts.push({ type: 'text', text: part.text })
          } else if (part?.type === 'image' && typeof part.data === 'string') {
            const mime = part.mediaType || part.mimeType || 'image/jpeg'
            parts.push({
              type: 'image_url',
              image_url: { url: `data:${mime};base64,${part.data}` },
            })
          }
        }
        out.push({ role: msg.role || 'user', content: parts })
      }
    }
  }
  return out
}

function parseSseData(line) {
  if (!line.startsWith('data:')) return null
  const payload = line.slice(5).trim()
  if (!payload || payload === '[DONE]') return { done: true }
  try {
    const parsed = JSON.parse(payload)
    const choice = parsed?.choices?.[0]
    if (!choice) return null
    const delta = choice.delta?.content
    return { text: typeof delta === 'string' ? delta : '', truncated: choice.finish_reason === 'length' }
  } catch {
    return null
  }
}

export function createStandaloneCtx({ apiKey = '', baseUrl = DEFAULT_BASE_URL, model = DEFAULT_MODEL, fetchImpl = fetch } = {}) {
  const cleanKey = String(apiKey ?? '').trim()
  const cleanModel = String(model ?? '').trim() || DEFAULT_MODEL
  const selection = { provider: 'openai-compatible', model: cleanModel }

  const llm = {
    async listProviders() {
      return [{ id: 'openai-compatible', name: 'OpenAI Compatible' }]
    },
    async listModels() {
      return [{ id: cleanModel, name: cleanModel }]
    },
    async prepareCall({ model: reqModel, maxTokens = 8000 } = {}, _signal, cb) {
      if (!cleanKey) {
        throw Object.assign(new Error(`缺少模型 API Key，请设置环境变量 ${ENV_STUDIO_KEY}（或 ${ENV_OPENAI_KEY}），或改用 --prompt-only 模式。`), { status: 400 })
      }
      const normalizedBase = validateBaseUrl(baseUrl)
      const endpoint = normalizedBase.endsWith('/chat/completions') ? normalizedBase : `${normalizedBase}/chat/completions`
      const targetModel = String(reqModel ?? '').trim() || cleanModel
      const controls = {
        config: { model: targetModel, maxTokens },
        async *stream(req) {
          const messages = []
          if (req.system) messages.push({ role: 'system', content: String(req.system) })
          messages.push(...extractUserMessages(req.messages))

          const signal = req.signal ?? AbortSignal.timeout(TIMEOUT_MS)
          let res
          try {
            res = await fetchImpl(endpoint, {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${cleanKey}`,
              },
              body: JSON.stringify({
                model: targetModel,
                max_tokens: req.maxTokens ?? maxTokens,
                stream: true,
                messages,
              }),
              signal,
            })
          } catch (err) {
            if (err?.name === 'AbortError') throw err
            throw new Error(`连不上模型接口：${scrub(err?.message ?? err, cleanKey)}`)
          }

          if (!res.ok) {
            const raw = await res.text().catch(() => '')
            let detail = ''
            try {
              const parsed = JSON.parse(raw)
              detail = parsed?.error?.message || parsed?.message || raw
            } catch {
              detail = raw
            }
            const cleanDetail = scrub(detail, cleanKey)
            if (res.status === 401 || res.status === 403) {
              throw new Error(`模型鉴权失败（HTTP ${res.status}）${cleanDetail ? `：${cleanDetail}` : ''}`)
            }
            throw new Error(`模型接口报错（HTTP ${res.status}）${cleanDetail ? `：${cleanDetail}` : ''}`)
          }

          const contentType = (res.headers?.get?.('content-type') ?? '').toLowerCase()
          if (contentType.includes('application/json') || !res.body) {
            const data = await res.json()
            const content = data?.choices?.[0]?.message?.content
            if (typeof content === 'string' && content) {
              yield { type: 'text-delta', text: content }
            }
            yield { type: 'finish', reason: { kind: data?.choices?.[0]?.finish_reason === 'length' ? 'max-tokens' : 'stop' } }
            return
          }

          const decoder = new TextDecoder()
          let buffer = ''
          let finishKind = 'stop'
          for await (const chunk of res.body) {
            buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })
            const lines = buffer.split(/\r?\n/)
            buffer = lines.pop() ?? ''
            for (const line of lines) {
              const parsed = parseSseData(line.trim())
              if (!parsed) continue
              if (parsed.done) {
                yield { type: 'finish', reason: { kind: finishKind } }
                return
              }
              if (parsed.truncated) finishKind = 'max-tokens'
              if (parsed.text) yield { type: 'text-delta', text: parsed.text }
            }
          }
          buffer += decoder.decode()
          for (const line of buffer.split(/\r?\n/)) {
            const parsed = parseSseData(line.trim())
            if (parsed?.truncated) finishKind = 'max-tokens'
            if (parsed?.text) yield { type: 'text-delta', text: parsed.text }
          }
          yield { type: 'finish', reason: { kind: finishKind } }
        },
      }
      return typeof cb === 'function' ? cb(controls) : controls
    },
  }

  const agentDefaultModel = {
    currentSelection: () => selection,
  }

  return {
    get(name) {
      if (name === 'llm') return llm
      if (name === 'agentDefaultModel') return agentDefaultModel
      return null
    },
  }
}

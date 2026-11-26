import { createHash } from 'node:crypto'

export const MAX_LOCAL_IMAGE = 10 * 1024 * 1024

const fail = (message, status = 502) => Object.assign(new Error(message), { status })

async function upload(url, { cloudName, apiKey, apiSecret }, fetchImpl) {
  const timestamp = String(Math.floor(Date.now() / 1000))
  const publicId = 'dsh-wechat-studio/feishu-' + createHash('sha256').update(url).digest('hex')
  const signature = createHash('sha256').update(`overwrite=false&public_id=${publicId}&timestamp=${timestamp}${apiSecret}`).digest('hex')
  const form = new FormData()
  for (const [key, value] of Object.entries({ file: url, api_key: apiKey, timestamp, signature, public_id: publicId, overwrite: 'false' })) {
    form.set(key, value)
  }
  const res = await fetchImpl(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: 'POST', body: form, signal: AbortSignal.timeout(20_000), redirect: 'error',
  })
  if (!res.ok) {
    await res.body?.cancel()
    if (res.status === 401 || res.status === 403) throw fail('Cloudinary 拒绝了上传，请检查设置中的 API Key 和 API Secret。')
    throw fail(`Cloudinary 未能转存图片（HTTP ${res.status}）。请从飞书重新复制 Markdown 后再试。`)
  }
  const { secure_url: result } = await res.json()
  if (typeof result !== 'string' || !/^https:\/\/res\.cloudinary\.com\/[a-zA-Z0-9_.~%/,-]+$/.test(result)) {
    throw fail('Cloudinary 没有返回可用的图片地址。')
  }
  return result
}

export async function uploadInlineImage(image, config, { articleId, assetId }, fetchImpl = fetch) {
  if (!config?.cloudName || !config.apiKey || !config.apiSecret) {
    throw fail('请先在设置中配置 Cloudinary，再插入正文插图。', 400)
  }
  if (!Buffer.isBuffer(image) || image.toString('hex', 0, 8) !== '89504e470d0a1a0a') {
    throw fail('本机插图文件无效，请重新生成后再试。', 400)
  }
  const { cloudName, apiKey, apiSecret } = config
  const timestamp = String(Math.floor(Date.now() / 1000))
  const suffix = createHash('sha256').update(`${articleId}:${assetId}`).digest('hex')
  const publicId = `dsh-wechat-studio/inline-${suffix}`
  const signature = createHash('sha256').update(`overwrite=true&public_id=${publicId}&timestamp=${timestamp}${apiSecret}`).digest('hex')
  const form = new FormData()
  for (const [key, value] of Object.entries({ api_key: apiKey, timestamp, signature, public_id: publicId, overwrite: 'true' })) {
    form.set(key, value)
  }
  form.set('file', new Blob([image], { type: 'image/png' }), `${assetId}.png`)
  const res = await fetchImpl(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: 'POST', body: form, signal: AbortSignal.timeout(30_000), redirect: 'error',
  })
  if (!res.ok) {
    await res.body?.cancel().catch(() => {})
    if (res.status === 401 || res.status === 403) throw fail('Cloudinary 鉴权失败，请检查 API Key 和 API Secret。')
    throw fail(`Cloudinary 上传插图失败（HTTP ${res.status}），请重试；同一插图重传会覆盖同一图床资源。`)
  }
  const { secure_url: result } = await res.json()
  if (typeof result !== 'string' || !/^https:\/\/res\.cloudinary\.com\/[a-zA-Z0-9_.~%/,-]+$/.test(result)) {
    throw fail('Cloudinary 没有返回可验证的 HTTPS 插图地址，请重试。')
  }
  return result
}

/**
 * 按文件头魔数识别图片格式（PNG / JPEG / GIF / WebP），不信任扩展名或 MIME。
 * @param {Buffer} image - 原始图片字节。
 * @returns {{ ext: 'png'|'jpg'|'gif'|'webp', mimeType: string } | null} 识别结果。
 */
export function detectImageFormat(image) {
  if (!Buffer.isBuffer(image)) return null
  if (image.length >= 8 && image.toString('hex', 0, 8) === '89504e470d0a1a0a') {
    return { ext: 'png', mimeType: 'image/png' }
  }
  if (image.length >= 3 && image.toString('hex', 0, 3) === 'ffd8ff') {
    return { ext: 'jpg', mimeType: 'image/jpeg' }
  }
  if (image.length >= 6 && ['GIF87a', 'GIF89a'].includes(image.toString('ascii', 0, 6))) {
    return { ext: 'gif', mimeType: 'image/gif' }
  }
  if (image.length >= 12 && image.toString('ascii', 0, 4) === 'RIFF' && image.toString('ascii', 8, 12) === 'WEBP') {
    return { ext: 'webp', mimeType: 'image/webp' }
  }
  return null
}

export async function uploadLocalImage(image, config, fetchImpl = fetch) {
  if (!config?.cloudName || !config.apiKey || !config.apiSecret) {
    throw fail('请先在设置中配置 Cloudinary，再上传本地图片。', 400)
  }
  if (!Buffer.isBuffer(image) || image.length > MAX_LOCAL_IMAGE) {
    throw fail('本地图片不能超过 10 MB。', 400)
  }
  const format = detectImageFormat(image)
  if (!format) throw fail('请选择 PNG、JPEG、GIF 或 WebP 图片。', 400)
  const { ext: extension, mimeType: type } = format
  const { cloudName, apiKey, apiSecret } = config
  const timestamp = String(Math.floor(Date.now() / 1000))
  const publicId = `dsh-wechat-studio/local-${createHash('sha256').update(image).digest('hex')}`
  const signature = createHash('sha256').update(`overwrite=false&public_id=${publicId}&timestamp=${timestamp}${apiSecret}`).digest('hex')
  const form = new FormData()
  for (const [key, value] of Object.entries({ api_key: apiKey, timestamp, signature, public_id: publicId, overwrite: 'false' })) {
    form.set(key, value)
  }
  form.set('file', new Blob([image], { type }), `local.${extension}`)
  const res = await fetchImpl(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: 'POST', body: form, signal: AbortSignal.timeout(30_000), redirect: 'error',
  })
  if (!res.ok) {
    await res.body?.cancel().catch(() => {})
    if (res.status === 401 || res.status === 403) throw fail('Cloudinary 鉴权失败，请检查 API Key 和 API Secret。')
    throw fail(`Cloudinary 上传本地图片失败（HTTP ${res.status}），请重试。`)
  }
  const { secure_url: result } = await res.json()
  if (typeof result !== 'string' || !/^https:\/\/res\.cloudinary\.com\/[a-zA-Z0-9_.~%/,-]+$/.test(result)) {
    throw fail('Cloudinary 没有返回可验证的 HTTPS 图片地址，请重试。')
  }
  return result
}

export async function transferFeishuImages(urls, config, progress, fetchImpl = fetch) {
  if (!config?.cloudName || !config.apiKey || !config.apiSecret) {
    throw fail('请先在设置中配置 Cloudinary，再重试图片转存。', 400)
  }
  let next = 0
  const failures = []
  async function worker() {
    while (next < urls.length) {
      const index = next++
      const url = urls[index]
      let result
      try {
        result = await upload(url, config, fetchImpl)
      } catch (error) {
        const detail = error.status === 502 ? error.message : '连接 Cloudinary 失败或超时，请重试。'
        failures.push({ index, detail })
      }
      progress(url, result)
    }
  }
  await Promise.all(Array.from({ length: Math.min(urls.length, 4) }, worker))
  const first = failures.sort((a, b) => a.index - b.index)[0]
  return first ? `第 ${first.index + 1} 张飞书图片转存失败：${first.detail}` : null
}

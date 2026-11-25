import * as gifenc from 'gifenc'

const { GIFEncoder, quantize, applyPalette } = gifenc.GIFEncoder ? gifenc : gifenc.default

const MAX_GIF_BYTES = 10_000_000
const GIF_PROFILES = [
  { width: 1080, maxFrames: 72 },
  { width: 1080, maxFrames: 36 },
  { width: 900, maxFrames: 30 },
  { width: 720, maxFrames: 16 },
  { width: 540, maxFrames: 8 },
  { width: 540, maxFrames: 2 },
]

export async function openCardAnimation(src) {
  if (!src || /^data:image\/jpe?g[;,]/i.test(src)) return null
  const gifHint = /^data:image\/gif[;,]/i.test(src) || /\.gif(?:[?#]|$)/i.test(src)
  let blob
  try {
    const response = await fetch(src, { signal: AbortSignal.timeout(10_000) })
    if (!response.ok) throw new Error('Image request failed')
    blob = await response.blob()
  } catch {
    if (gifHint) throw new Error('无法读取 GIF 原图，请重新上传该动图后再导出。')
    return null
  }

  const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer())
  const signature = String.fromCharCode(...header)
  const type = /^GIF8[79]a/.test(signature) ? 'image/gif'
    : signature.slice(8) === 'WEBP' ? 'image/webp'
      : signature.slice(1, 4) === 'PNG' ? 'image/png' : ''
  if (!type) return null
  if (typeof ImageDecoder === 'undefined' || !await ImageDecoder.isTypeSupported(type)) {
    if (type === 'image/gif') throw new Error('当前环境无法解码 GIF，请使用支持动图导出的桌面端或浏览器。')
    return null
  }

  const decoder = new ImageDecoder({ data: await blob.arrayBuffer(), type, preferAnimation: true })
  try {
    await decoder.tracks.ready
    const frameCount = decoder.tracks.selectedTrack?.frameCount ?? 0
    if (frameCount < 2) {
      decoder.close()
      return null
    }
    const starts = []
    let duration = 0
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
      const { image } = await decoder.decode({ frameIndex })
      starts.push(duration)
      duration += Math.max(20, Math.round((image.duration || 100_000) / 10_000) * 10)
      image.close()
    }
    return { decoder, starts, duration }
  } catch (error) {
    decoder.close()
    throw error
  }
}

export async function setCardAnimationFrame(animation, time, maxWidth = 1080) {
  const { element, decoder, starts, duration } = animation
  const timestamp = time % duration
  let index = starts.length - 1
  while (starts[index] > timestamp) index--
  if (animation.currentIndex === index && animation.currentMaxWidth === maxWidth) return

  const { image } = await decoder.decode({ frameIndex: index })
  try {
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, maxWidth / Math.max(image.displayWidth, image.displayHeight))
    canvas.width = Math.max(1, Math.round(image.displayWidth * scale))
    canvas.height = Math.max(1, Math.round(image.displayHeight * scale))
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
    element.src = canvas.toDataURL('image/png')
    animation.currentIndex = index
    animation.currentMaxWidth = maxWidth
  } finally {
    image.close()
  }
}

function animationTimeline(animations, duration, maxFrames) {
  const starts = new Set([0])
  // Preserve all source frame changes when they fit the export frame budget.
  for (const animation of animations) {
    for (let offset = 0; offset < duration; offset += animation.duration) {
      for (const start of animation.starts) {
        if (offset + start >= duration) break
        starts.add(offset + start)
        if (starts.size > maxFrames) {
          const sampled = Array.from({ length: maxFrames }, (_, index) => Math.floor(index * duration / maxFrames / 10) * 10)
          // Keep the final change visible even when the last source frame is short.
          sampled[maxFrames - 1] = Math.max(sampled[maxFrames - 1], ...animations.map(item => item.starts.at(-1)))
          return sampled
        }
      }
    }
  }
  return [...starts].sort((a, b) => a - b)
}

export async function renderCardGif(canvas, animations, paint, { byteLimit = MAX_GIF_BYTES } = {}) {
  const duration = Math.max(...animations.map(animation => animation.duration))
  let previousAttempt = ''
  for (const { width, maxFrames } of GIF_PROFILES) {
    const times = animationTimeline(animations, duration, maxFrames)
    const attempt = `${width}:${times.length}`
    if (attempt === previousAttempt) continue
    previousAttempt = attempt
    canvas.width = width
    canvas.height = width * 4 / 3
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const encoder = GIFEncoder()
    for (const [index, time] of times.entries()) {
      await Promise.all(animations.map(animation => setCardAnimationFrame(animation, time, width)))
      if (!await paint()) throw new Error('动图卡片渲染失败，请重试。')
      const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      const palette = quantize(rgba, 256)
      const pixels = applyPalette(rgba, palette)
      let delay = (times[index + 1] ?? duration) - time
      do {
        const frameDelay = Math.min(delay, 655_350)
        encoder.writeFrame(pixels, canvas.width, canvas.height, { palette, delay: frameDelay })
        delay -= frameDelay
      } while (delay > 0 && encoder.bytesView().length < byteLimit)
      if (encoder.bytesView().length >= byteLimit) break
      // Yield between frames so long exports do not freeze the editor.
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    encoder.finish()
    if (encoder.bytesView().length <= byteLimit) {
      return new Blob([encoder.bytes()], { type: 'image/gif' })
    }
  }
  throw new Error('这张动图卡片压缩后仍超过 10 MB，请缩短原动图后重试。')
}

import { balanceXhsArtboard } from './xhs-card-balance.js'
import { renderCardAmbientDecor } from './xhs-card-decor.js'
import { openCardAnimation, renderCardGif, setCardAnimationFrame } from './xhs-card-gif.js'
// 在 1080×1440 逻辑画布上排版，以 2 倍像素密度导出 PNG。
// 优先使用 SVG <foreignObject> 将 HTML/CSS 画布直接光栅化，
// 自动将外部图片内联为 DataURL 以避免 Canvas 污染；若极端环境不支持 foreignObject，则无缝回退到 Canvas 2D 指令渲染。

import { CARD_SIZE, FONT_STACK, layoutCard } from './xhs-card-layout.js'
import {
  buildCardStyleText,
  ensureCardHtml,
  resolveArtboardClassName,
  resolveXhsThemeVars,
  themeVarsToCssText,
} from './xhs-card-html.js'

const imageCache = new Map()
const inlinedUrlCache = new Map()
const EXPORT_SCALE = 2
export const CARD_EXPORT_SIZE = {
  width: CARD_SIZE.width * EXPORT_SCALE,
  height: CARD_SIZE.height * EXPORT_SCALE,
}

function loadExternalImage(url, timeoutMs = 2500, cache = true) {
  if (!url) return Promise.resolve(null)
  if (cache && imageCache.has(url)) return imageCache.get(url)

  const promise = new Promise(resolve => {
    const img = new Image()
    let settled = false
    const finish = result => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (cache && !result) imageCache.delete(url)
      resolve(result)
    }
    const timer = setTimeout(() => finish(null), timeoutMs)
    if (/^https?:\/\//i.test(url)) {
      img.crossOrigin = 'anonymous'
    }
    img.onload = () => finish(img)
    img.onerror = () => finish(null)
    img.src = url
  })

  if (cache) imageCache.set(url, promise)
  return promise
}

async function inlineImageUrl(url) {
  if (!url) return ''
  if (url.startsWith('data:')) return url
  if (inlinedUrlCache.has(url)) return inlinedUrlCache.get(url)

  const img = await loadExternalImage(url)
  if (!img) return ''
  try {
    const sourceWidth = img.naturalWidth || img.width || 800
    const sourceHeight = img.naturalHeight || img.height || 600
    const scale = Math.min(1, CARD_EXPORT_SIZE.width / sourceWidth, CARD_EXPORT_SIZE.height / sourceHeight)
    const w = Math.max(1, Math.round(sourceWidth * scale))
    const h = Math.max(1, Math.round(sourceHeight * scale))
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0, w, h)
    const dataUrl = c.toDataURL('image/png')
    inlinedUrlCache.set(url, dataUrl)
    return dataUrl
  } catch {
    return ''
  }
}

async function prepareHtmlArtboard(card, opts, animations) {
  if (typeof document === 'undefined' || (!animations && typeof XMLSerializer === 'undefined')) {
    return null
  }
  const themeVars = resolveXhsThemeVars({
    deckStyle: opts.deckStyle,
    palette: opts.palette,
    tweaks: opts.tweaks,
  })
  const html = ensureCardHtml(card, opts)
  const host = document.createElement('div')
  host.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml')
  host.style.cssText = `width:${CARD_SIZE.width}px;height:${CARD_SIZE.height}px;overflow:hidden;margin:0;padding:0;`

  const styleEl = document.createElement('style')
  styleEl.textContent = buildCardStyleText({
    customCss: opts.customCss || '',
    pageCss: card?.pageCss || '',
  })
  host.appendChild(styleEl)

  const artboard = document.createElement('div')
  artboard.className = resolveArtboardClassName(card, opts)
  artboard.style.cssText = themeVarsToCssText(themeVars)
  const decorSvg = renderCardAmbientDecor({
    preset: opts.tweaks?.decor ?? 'auto',
    scope: opts.tweaks?.decorScope ?? 'smart',
    cardKind: card?.kind || 'list',
    deckStyle: opts.deckStyle,
    designPrompt: opts.designPrompt || '',
    artDirection: opts.artDirection || null,
  })
  artboard.innerHTML = decorSvg ? `${decorSvg}${html}` : html
  host.appendChild(artboard)

  // 将所有 <img> 的外部 URL 内联为 DataURL，防止 foreignObject 污染或无法加载外部资源
  const imgs = Array.from(artboard.querySelectorAll('img'))
  const imageResults = await Promise.allSettled(
    imgs.map(async imgEl => {
      const src = imgEl.getAttribute('src') || ''
      if (animations) {
        const animation = await openCardAnimation(src)
        if (animation) {
          animation.element = imgEl
          animation.source = src
          animations.push(animation)
          await setCardAnimationFrame(animation, 0)
          return
        }
      }
      const inlined = await inlineImageUrl(src)
      if (inlined) {
        imgEl.setAttribute('src', inlined)
      } else {
        const placeholder = document.createElement('div')
        placeholder.className = 'cd-slot'
        const titleEl = document.createElement('div')
        titleEl.className = 'cd-slot-title'
        titleEl.textContent = imgEl.getAttribute('alt') || '配图预览'
        placeholder.appendChild(titleEl)
        imgEl.replaceWith(placeholder)
      }
    }),
  )
  const failedImage = imageResults.find(result => result.status === 'rejected')
  if (failedImage) throw failedImage.reason

  const measurementHost = document.createElement('div')
  measurementHost.style.cssText = 'position:fixed;left:-20000px;top:0;visibility:hidden'
  const shadow = measurementHost.attachShadow({ mode: 'open' })
  shadow.appendChild(host)
  document.body.appendChild(measurementHost)
  try {
    await Promise.all([...artboard.querySelectorAll('img')].map(img => img.decode().catch(() => {})))
    const balanceSheet = document.createElement('style')
    host.appendChild(balanceSheet)
    balanceXhsArtboard(artboard, balanceSheet)
  } finally {
    measurementHost.remove()
  }

  return host
}

async function drawHtmlArtboard(canvas, host) {
  if (!host || typeof XMLSerializer === 'undefined') return null
  const serializer = new XMLSerializer()
  const xhtml = serializer.serializeToString(host)
  const svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${CARD_SIZE.width} ${CARD_SIZE.height}"><foreignObject x="0" y="0" width="${CARD_SIZE.width}" height="${CARD_SIZE.height}">${xhtml}</foreignObject></svg>`
  const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`

  const svgImg = await loadExternalImage(svgUrl, 5000, false)
  if (!svgImg) return null

  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(svgImg, 0, 0)
  return { overflow: false }
}

function roundedRectPath(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r || 0, Math.min(w, h) / 2))
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, radius)
    return
  }
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

function drawCoverImage(ctx, img, x, y, w, h, radius = 0) {
  const iw = img.naturalWidth || img.width || w
  const ih = img.naturalHeight || img.height || h
  const scale = Math.max(w / iw, h / ih)
  const sw = w / scale
  const sh = h / scale
  const sx = Math.max(0, (iw - sw) / 2)
  const sy = Math.max(0, (ih - sh) / 2)

  ctx.save()
  roundedRectPath(ctx, x, y, w, h, radius)
  ctx.clip()
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h)
  ctx.restore()
}

export async function drawCardFallbackToCanvas(canvas, card, opts, animationFrames = new Map()) {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('浏览器不支持 Canvas 2D 渲染')

  if (typeof document !== 'undefined' && document.fonts?.ready) {
    try { await document.fonts.ready } catch {}
  }

  const measure = (text, fontPx, weight = 500, family = FONT_STACK) => {
    ctx.font = `${weight} ${fontPx}px ${family}`
    return ctx.measureText(text).width
  }

  const plan = layoutCard(card, opts, measure)
  const imageSources = new Set(plan.ops.filter(op => op.type === 'image').map(op => op.src))
  for (const source of animationFrames.keys()) {
    if (!imageSources.has(source)) return null
  }
  const loadedImages = new Map()
  await Promise.all([...imageSources].map(async source => {
    const frame = animationFrames.get(source)
    const img = await loadExternalImage(frame || source, 2500, !frame)
    if (frame && !img) throw new Error('无法读取当前动图帧。')
    if (img) loadedImages.set(source, img)
  }))

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.setTransform(canvas.width / CARD_SIZE.width, 0, 0, canvas.height / CARD_SIZE.height, 0, 0)
  for (const item of plan.ops) {
    if (item.type === 'rect') {
      ctx.save()
      roundedRectPath(ctx, item.x, item.y, item.w, item.h, item.radius || 0)
      if (item.fill) {
        ctx.fillStyle = item.fill
        ctx.fill()
      }
      if (item.stroke) {
        ctx.strokeStyle = item.stroke
        ctx.lineWidth = item.lineWidth || 1
        ctx.stroke()
      }
      ctx.restore()
    } else if (item.type === 'line') {
      ctx.save()
      ctx.beginPath()
      ctx.moveTo(item.x1, item.y1)
      ctx.lineTo(item.x2, item.y2)
      ctx.strokeStyle = item.stroke || '#000'
      ctx.lineWidth = item.lineWidth || 1
      ctx.stroke()
      ctx.restore()
    } else if (item.type === 'text') {
      ctx.save()
      ctx.font = `${item.weight || 400} ${item.fontPx}px ${item.family || FONT_STACK}`
      ctx.fillStyle = item.color || '#18181B'
      ctx.textAlign = item.align || 'left'
      ctx.textBaseline = 'alphabetic'
      ctx.fillText(item.text, item.x, item.y)
      ctx.restore()
    } else if (item.type === 'image') {
      const img = loadedImages.get(item.src)
      if (img) drawCoverImage(ctx, img, item.x, item.y, item.w, item.h, item.radius || 0)
    }
  }

  return plan
}

async function renderCardPng(card, opts, host) {
  const canvas = document.createElement('canvas')
  canvas.width = CARD_EXPORT_SIZE.width
  canvas.height = CARD_EXPORT_SIZE.height
  let plan = await drawHtmlArtboard(canvas, host)
  if (!plan) {
    plan = await drawCardFallbackToCanvas(canvas, card, opts)
  }
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(result => {
      if (result) resolve(result)
      else reject(new Error('卡片导出 PNG 失败'))
    }, 'image/png')
  })
  return { blob, overflow: Boolean(plan.overflow) }
}

export async function renderCardToBlob(card, opts = {}) {
  return renderCardPng(card, opts, await prepareHtmlArtboard(card, opts))
}

export async function renderCardDownload(card, opts = {}) {
  const animations = []
  try {
    const host = await prepareHtmlArtboard(card, opts, animations)
    if (!animations.length) {
      const { blob } = await renderCardPng(card, opts, host)
      return { blob, extension: 'png' }
    }
    const canvas = document.createElement('canvas')
    const blob = await renderCardGif(canvas, animations, async () => {
      const rendered = await drawHtmlArtboard(canvas, host)
      if (rendered) return rendered
      const frames = new Map(animations.map(({ source, element }) => [source, element.src]))
      return drawCardFallbackToCanvas(canvas, card, opts, frames)
    })
    return { blob, extension: 'gif' }
  } finally {
    for (const { decoder } of animations) decoder.close()
  }
}

export async function renderCardToDataUrl(card, opts = {}) {
  const { blob, overflow } = await renderCardToBlob(card, opts)
  const url = URL.createObjectURL(blob)
  return { url, blob, overflow }
}

// 小红书卡片无头导出引擎（Node CLI 专用）：
// 1. 直接复用 client/xhs-card-html.js 与 client/xhs-card-decor.js，确保 CLI 导出与插件画布 100% 一致；
// 2. 生成离线可预览画廊 preview.html、可直接复制发布的 post.txt 与完整 deck.json；
// 3. 若本机存在 Chrome / Chromium / Edge，则自动用 Headless 模式渲染 2× 高清 1080×1440 PNG 卡片。
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import {
  DEFAULT_XHS_TWEAKS,
  buildCardStyleText,
  ensureCardHtml,
  resolveArtboardClassName,
  resolveXhsThemeVars,
  themeVarsToCssText,
} from '../client/xhs-card-html.js'
import { renderCardAmbientDecor } from '../client/xhs-card-decor.js'
import { xhsClipboardText } from './derive-shared.js'

const BALANCE_SCRIPT_SRC = readFileSync(new URL('../client/xhs-card-balance.js', import.meta.url), 'utf8')
  .replace(/\bexport\s+function\s+balanceXhsArtboard/, 'function balanceXhsArtboard')
  .replace(/<\/script>/gi, '<\\/script>')

const execFileAsync = promisify(execFile)

const BROWSER_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
]

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

async function isExecutable(filePath) {
  if (!filePath) return false
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

const FFMPEG_CANDIDATES = [
  '/opt/homebrew/bin/ffmpeg',
  '/usr/local/bin/ffmpeg',
  '/usr/bin/ffmpeg',
]

const MAX_GIF_BYTES = 10_000_000

export async function findFfmpeg(env = process.env) {
  const explicit = String(env?.FFMPEG_PATH || '').trim()
  if (explicit && await isExecutable(explicit)) return explicit
  for (const candidate of FFMPEG_CANDIDATES) {
    if (await isExecutable(candidate)) return candidate
  }
  return null
}

export function cardHasGif(html = '') {
  return /<img\b[^>]*\bsrc=["'](?:data:image\/gif[;,][^"']*|[^"']*\.gif(?:[?#][^"']*)?)["']/i.test(String(html))
}

export async function findHeadlessBrowser(env = process.env) {
  const explicit = String(env?.WECHAT_STUDIO_CHROME || env?.CHROME_PATH || '').trim()
  if (explicit && await isExecutable(explicit)) return explicit
  for (const candidate of BROWSER_CANDIDATES) {
    if (await isExecutable(candidate)) return candidate
  }
  return null
}

function buildCardDocumentHtml(card, {
  index = 0,
  total = 1,
  author = '',
  palette = {},
  deckStyle = 'tech',
  tweaks = {},
  customCss = '',
  designPrompt = '',
  artDirection = null,
} = {}) {
  const mergedTweaks = { ...DEFAULT_XHS_TWEAKS, ...(tweaks || {}) }
  const themeVars = resolveXhsThemeVars({ deckStyle, palette, tweaks: mergedTweaks })
  const styleText = buildCardStyleText({
    customCss,
    pageCss: card?.pageCss || '',
  })
  const cardHtml = ensureCardHtml(card, {
    index,
    total,
    author,
    palette,
    deckStyle,
    tweaks: mergedTweaks,
  })
  const decorSvg = renderCardAmbientDecor({
    preset: mergedTweaks.decor || 'auto',
    scope: mergedTweaks.decorScope || 'smart',
    cardKind: card?.kind || 'list',
    deckStyle,
    designPrompt,
    artDirection,
  })
  const className = resolveArtboardClassName(card)
  const cssVars = themeVarsToCssText(themeVars)
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=1080, initial-scale=1" />
<style>
html, body {
  margin: 0;
  padding: 0;
  width: 1080px;
  height: 1440px;
  overflow: hidden;
  background: transparent;
}
${styleText}
</style>
<style data-balance="1"></style>
</head>
<body>
<div class="${escapeHtml(className)}" style="${escapeHtml(cssVars)}">${decorSvg}${cardHtml}</div>
<script>
${BALANCE_SCRIPT_SRC}
;(function () {
  var root = document.querySelector('.xhs-artboard')
  var sheet = document.querySelector('style[data-balance="1"]')
  if (!root || !sheet) return
  var run = function () {
    try { balanceXhsArtboard(root, sheet) } catch (_) {}
    try {
      var board = root.getBoundingClientRect()
      var scale = board.height ? (1440 / board.height) : 1
      var slots = []
      root.querySelectorAll('img').forEach(function (img) {
        var src = img.getAttribute('src') || ''
        var lowerSrc = src.toLowerCase()
        if (lowerSrc.indexOf('data:image/gif') !== 0 && !/\\.gif(?:[?#]|$)/i.test(lowerSrc)) return
        var rect = img.getBoundingClientRect()
        if (rect.width < 16 || rect.height < 16) return
        slots.push({
          src: src,
          x: Math.max(0, Math.round((rect.left - board.left) * scale)),
          y: Math.max(0, Math.round((rect.top - board.top) * scale)),
          width: Math.max(2, Math.round(rect.width * scale)),
          height: Math.max(2, Math.round(rect.height * scale)),
          objectFit: getComputedStyle(img).objectFit || 'cover',
        })
      })
      var slotEl = document.getElementById('xhs-gif-slots')
      if (!slotEl) {
        slotEl = document.createElement('script')
        slotEl.id = 'xhs-gif-slots'
        slotEl.type = 'application/json'
        document.head.appendChild(slotEl)
      }
      slotEl.textContent = JSON.stringify(slots)
    } catch (_) {}
  }
  run()
  window.addEventListener('load', run)
  root.addEventListener('load', run, true)
})()
</script>
</body>
</html>`
}

export function buildXhsDeckPreviewHtml(payload, {
  author = '',
  palette = {},
  tweaks = {},
} = {}) {
  const cards = Array.isArray(payload?.cards) ? payload.cards : []
  const deckStyle = payload?.deckStyle || 'tech'
  const mergedTweaks = { ...DEFAULT_XHS_TWEAKS, ...(payload?.tweaks || {}), ...(tweaks || {}) }
  const postText = xhsClipboardText(payload)
  const frames = cards.map((card, index) => {
    const doc = buildCardDocumentHtml(card, {
      index,
      total: cards.length,
      author,
      palette,
      deckStyle,
      tweaks: mergedTweaks,
      customCss: payload?.customCss || '',
      designPrompt: payload?.designPrompt || '',
      artDirection: payload?.artDirection || null,
    })
    const num = String(index + 1).padStart(2, '0')
    return `
      <figure class="card-slot">
        <figcaption>${num} · ${escapeHtml(card.kind || 'card')} · ${escapeHtml(card.heading || '')}</figcaption>
        <div class="frame-wrap">
          <iframe class="card-frame" srcdoc="${escapeHtml(doc)}" sandbox="allow-same-origin allow-scripts" loading="lazy"></iframe>
        </div>
      </figure>`
  }).join('\n')

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(payload?.title || '小红书图文预览')}</title>
<style>
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 32px 24px 64px;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Noto Sans SC", sans-serif;
  background: #f5f5f7;
  color: #18181b;
}
header {
  max-width: 1320px;
  margin: 0 auto 28px;
  background: #fff;
  border: 1px solid #e4e4e7;
  border-radius: 16px;
  padding: 20px 24px;
}
h1 { margin: 0 0 12px; font-size: 20px; }
pre.post {
  margin: 0;
  white-space: pre-wrap;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.7;
  color: #3f3f46;
}
main.grid {
  max-width: 1320px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 24px;
}
.card-slot {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.card-slot figcaption {
  font-size: 13px;
  font-weight: 600;
  color: #52525b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.frame-wrap {
  width: 360px;
  height: 480px;
  overflow: hidden;
  border-radius: 14px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.08);
  background: #fff;
}
.card-frame {
  width: 1080px;
  height: 1440px;
  border: 0;
  transform: scale(0.3333333);
  transform-origin: 0 0;
  display: block;
}
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(payload?.title || '小红书图文预览')}（共 ${cards.length} 页）</h1>
  <pre class="post">${escapeHtml(postText)}</pre>
</header>
<main class="grid">
${frames}
</main>
</body>
</html>`
}

async function captureSingleCardPng(browserPath, htmlPath, pngPath, scaleFactor = 2) {
  const fileUrl = pathToFileURL(htmlPath).href
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    '--disable-extensions',
    '--disable-background-networking',
    '--window-size=1080,1440',
    `--force-device-scale-factor=${scaleFactor}`,
    '--virtual-time-budget=2500',
    `--screenshot=${pngPath}`,
    fileUrl,
  ]
  await execFileAsync(browserPath, args, { timeout: 30_000 })
}

async function extractGifSlotsFromDom(browserPath, htmlPath) {
  const fileUrl = pathToFileURL(htmlPath).href
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-extensions',
    '--disable-background-networking',
    '--window-size=1080,1440',
    '--virtual-time-budget=2500',
    '--dump-dom',
    fileUrl,
  ]
  const { stdout } = await execFileAsync(browserPath, args, { timeout: 30_000, maxBuffer: 16 * 1024 * 1024 })
  const match = stdout.match(/<script[^>]*id="xhs-gif-slots"[^>]*>([\s\S]*?)<\/script>/i)
  if (!match) return []
  try {
    const parsed = JSON.parse(match[1].trim())
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function materializeGifSource(src, workTmp, index) {
  const targetPath = join(workTmp, `src-gif-${index}.gif`)
  let buf = null
  if (/^data:image\/gif;base64,/i.test(src)) {
    buf = Buffer.from(src.replace(/^data:image\/gif;base64,/i, ''), 'base64')
  } else if (/^file:\/\//i.test(src)) {
    buf = await readFile(fileURLToPath(src))
  } else if (/^https?:\/\//i.test(src)) {
    const res = await fetch(src, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return null
    buf = Buffer.from(await res.arrayBuffer())
  } else {
    buf = await readFile(src)
  }
  if (!buf || buf.length < 6) return null
  const sig = buf.subarray(0, 6).toString('ascii')
  if (sig !== 'GIF87a' && sig !== 'GIF89a') return null
  await writeFile(targetPath, buf)
  return targetPath
}

async function captureAnimatedCardGif({ browserPath, ffmpegPath, htmlPath, gifPath, workTmp, cardNum }) {
  const slots = await extractGifSlotsFromDom(browserPath, htmlPath)
  const resolvedSlots = []
  for (let i = 0; i < slots.length; i++) {
    try {
      const localGif = await materializeGifSource(slots[i].src, workTmp, `${cardNum}-${i}`)
      if (localGif) resolvedSlots.push({ ...slots[i], localGif })
    } catch {
      // Skip unreadable GIF source
    }
  }
  if (!resolvedSlots.length) return false

  const basePng = join(workTmp, `base-${cardNum}.png`)
  await captureSingleCardPng(browserPath, htmlPath, basePng, 1)

  const encodeWithScale = async (scaleW, scaleH) => {
    const inputs = ['-i', basePng]
    const filterSteps = []
    let prevLabel = '0:v'
    resolvedSlots.forEach((slot, idx) => {
      inputs.push('-ignore_loop', '0', '-i', slot.localGif)
      const inIdx = idx + 1
      const w = Math.max(2, Math.round(slot.width))
      const h = Math.max(2, Math.round(slot.height))
      const fitExpr = slot.objectFit === 'contain'
        ? `scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`
        : `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h}`
      filterSteps.push(`[${inIdx}:v]${fitExpr}[g${idx}]`)
      const outLabel = `ov${idx}`
      const shortest = idx === 0 ? ':shortest=1' : ''
      filterSteps.push(`[${prevLabel}][g${idx}]overlay=${slot.x}:${slot.y}${shortest}[${outLabel}]`)
      prevLabel = outLabel
    })
    const postScale = scaleW < 1080 ? `scale=${scaleW}:${scaleH}:flags=lanczos,` : ''
    filterSteps.push(`[${prevLabel}]${postScale}split[s0][s1]`)
    filterSteps.push('[s0]palettegen=stats_mode=diff[p]')
    filterSteps.push('[s1][p]paletteuse=dither=bayer:bayer_scale=3')

    const args = [
      '-y',
      ...inputs,
      '-filter_complex', filterSteps.join(';'),
      '-loop', '0',
      gifPath,
    ]
    await execFileAsync(ffmpegPath, args, { timeout: 60_000 })
  }

  await encodeWithScale(1080, 1440)
  const info = await stat(gifPath)
  if (info.size > MAX_GIF_BYTES) {
    await encodeWithScale(720, 960)
  }
  return true
}

export async function exportXhsDeckToDir({
  payload,
  author = '',
  palette = {},
  tweaks = {},
  outDir,
  renderPng = true,
  browserPath = null,
  env = process.env,
} = {}) {
  if (!payload || !Array.isArray(payload.cards) || !payload.cards.length) {
    throw new Error('没有可导出的小红书卡片。')
  }
  const absDir = resolve(outDir)
  await mkdir(absDir, { recursive: true })

  const deckStyle = payload.deckStyle || 'tech'
  const mergedTweaks = { ...DEFAULT_XHS_TWEAKS, ...(payload.tweaks || {}), ...(tweaks || {}) }
  const postText = xhsClipboardText(payload)
  const postPath = join(absDir, 'post.txt')
  const jsonPath = join(absDir, 'deck.json')
  const previewPath = join(absDir, 'preview.html')

  await Promise.all([
    writeFile(postPath, `${postText}\n`, 'utf8'),
    writeFile(jsonPath, `${JSON.stringify({ ...payload, tweaks: mergedTweaks }, null, 2)}\n`, 'utf8'),
    writeFile(previewPath, buildXhsDeckPreviewHtml(payload, { author, palette, tweaks: mergedTweaks }), 'utf8'),
  ])

  const mediaFiles = []
  const pngFiles = []
  const gifFiles = []
  const warnings = []
  let resolvedBrowser = null
  let pngSkippedReason = null

  if (!renderPng) {
    pngSkippedReason = '已指定 --no-png，仅导出文案、JSON 与 HTML 预览。'
  } else {
    resolvedBrowser = browserPath || await findHeadlessBrowser(env)
    if (!resolvedBrowser) {
      pngSkippedReason = '未检测到本机 Chrome / Chromium / Edge，已导出 preview.html（可浏览器打开查看，或设置 CHROME_PATH 后重试）。'
    } else {
      const ffmpegPath = await findFfmpeg(env)
      const workTmp = await mkdtemp(join(tmpdir(), 'wechat-studio-xhs-'))
      try {
        const tasks = payload.cards.map((card, index) => {
          const num = String(index + 1).padStart(2, '0')
          const htmlDoc = buildCardDocumentHtml(card, {
            index,
            total: payload.cards.length,
            author,
            palette,
            deckStyle,
            tweaks: mergedTweaks,
            customCss: payload.customCss || '',
            designPrompt: payload.designPrompt || '',
            artDirection: payload.artDirection || null,
          })
          return {
            index,
            num,
            hasGif: cardHasGif(htmlDoc),
            htmlPath: join(workTmp, `${num}.html`),
            pngPath: join(absDir, `${num}.png`),
            gifPath: join(absDir, `${num}.gif`),
            htmlDoc,
          }
        })
        await Promise.all(tasks.map(t => writeFile(t.htmlPath, t.htmlDoc, 'utf8')))
        // 控制 3 路并发，兼顾出图速度与低内存占用
        const concurrency = Math.min(3, tasks.length)
        let cursor = 0
        await Promise.all(Array.from({ length: concurrency }, async () => {
          while (cursor < tasks.length) {
            const task = tasks[cursor++]
            if (task.hasGif && ffmpegPath) {
              try {
                const renderedGif = await captureAnimatedCardGif({
                  browserPath: resolvedBrowser,
                  ffmpegPath,
                  htmlPath: task.htmlPath,
                  gifPath: task.gifPath,
                  workTmp,
                  cardNum: task.num,
                })
                if (renderedGif) {
                  mediaFiles[task.index] = task.gifPath
                  gifFiles.push(task.gifPath)
                  continue
                }
              } catch (err) {
                warnings.push(`第 ${task.index + 1} 页 GIF 动图合成失败（${err.message}），已降级导出静态 PNG。`)
              }
            } else if (task.hasGif && !ffmpegPath) {
              warnings.push(`第 ${task.index + 1} 页含 GIF 动图，但未检测到 ffmpeg，已降级导出静态 PNG。`)
            }
            await captureSingleCardPng(resolvedBrowser, task.htmlPath, task.pngPath)
            mediaFiles[task.index] = task.pngPath
            pngFiles.push(task.pngPath)
          }
        }))
        pngFiles.sort()
        gifFiles.sort()
      } finally {
        await rm(workTmp, { recursive: true, force: true }).catch(() => {})
      }
    }
  }

  return {
    outDir: absDir,
    postPath,
    jsonPath,
    previewPath,
    mediaFiles,
    pngFiles,
    gifFiles,
    warnings,
    browser: resolvedBrowser,
    pngSkippedReason,
  }
}

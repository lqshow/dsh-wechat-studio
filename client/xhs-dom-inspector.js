// Claude Design / OpenDesign 风格的 DOM 图层树、元素拾取与属性实时编辑引擎。
// 为每张 1080×1440 HTML 卡片提供：
// 1. 稳定 data-cd-id 标注与层级树提取（Column / Row / Text / Table / Image / 截图位）
// 2. 选中元素的计算样式读取（Text / Size / Layout / Appearance）与 1080×1440 坐标框
// 3. 实时样式/文本/配图修改并反序列化回干净的 card.html

import { sanitizeCardImageUrl, sanitizeXhsCardHtml } from '../src/derive-shared.js'

const SKIP_TAGS = new Set(['STYLE', 'SCRIPT', 'DEFS', 'LINEARGRADIENT', 'RADIALGRADIENT', 'STOP', 'CLIPPATH', 'PATH', 'CIRCLE', 'RECT', 'LINE', 'POLYLINE', 'POLYGON', 'G'])

export function annotateArtboardDom(rootEl) {
  if (!rootEl) return
  let walk = (el, path) => {
    el.setAttribute('data-cd-id', path)
    let childIdx = 0
    for (const child of Array.from(el.children || [])) {
      if (SKIP_TAGS.has(child.tagName) || child.getAttribute?.('data-xhs-decor') === '1') continue
      walk(child, path ? `${path}.${childIdx}` : String(childIdx))
      childIdx += 1
    }
  }
  walk(rootEl, 'root')
}

export function classifyDomElement(el) {
  if (!el || !el.tagName) return 'container'
  if (el.getAttribute('data-xhs-slot') === 'image' || el.classList?.contains('cd-slot')) return 'slot'
  const tag = el.tagName.toUpperCase()
  if (tag === 'IMG') return 'image'
  if (tag === 'TABLE') return 'table'
  const children = Array.from(el.children || []).filter(c => !SKIP_TAGS.has(c.tagName))
  const text = (el.textContent || '').trim()
  if (children.length === 0 && text.length > 0) return 'text'
  // 仅包含内联高亮 span (.cd-hl) 的标题/段落视为可直接改字的 text 节点；多胶囊行 (.cd-eyebrow-row 等) 保持为 container 以展开子项
  if (
    children.length > 0 &&
    children.every(c => c.tagName === 'SPAN' && c.classList?.contains('cd-hl') && c.children.length === 0) &&
    /^(H[1-6]|P|SPAN|STRONG|EM|TD|TH|LI|DIV)$/.test(tag)
  ) {
    return 'text'
  }
  return 'container'
}

export function friendlyElementLabel(el) {
  if (!el || !el.tagName) return 'Element'
  if (el.getAttribute('data-cd-id') === 'root') return 'Artboard (1080×1440)'
  const kind = classifyDomElement(el)
  const text = (el.textContent || '').replace(/\s+/g, ' ').trim()
  const shortText = text.length > 14 ? `${text.slice(0, 14)}…` : text

  if (kind === 'slot') return `截图位 ${shortText ? `“${shortText}”` : ''}`.trim()
  if (kind === 'image') return `Image “${el.getAttribute('alt') || '配图'}”`
  if (kind === 'table') return 'Table “数据表”'
  if (kind === 'text') return `Text “${shortText || el.tagName.toLowerCase()}”`

  const tag = el.tagName.toUpperCase()
  if (tag === 'TR') return `Row “${shortText || '表格行'}”`
  const cs = typeof window !== 'undefined' && window.getComputedStyle ? window.getComputedStyle(el) : null
  const display = cs?.display || ''
  const flexDir = cs?.flexDirection || ''
  let boxType = 'Box'
  if (display.includes('grid')) boxType = 'Grid'
  else if (display.includes('flex')) boxType = flexDir.startsWith('row') ? 'Row' : 'Column'
  return shortText ? `${boxType} “${shortText}”` : boxType
}

export function buildLayerTree(rootEl, maxDepth = 8) {
  if (!rootEl) return null
  annotateArtboardDom(rootEl)

  function buildNode(el, depth) {
    const id = el.getAttribute('data-cd-id') || ''
    const kind = classifyDomElement(el)
    const label = friendlyElementLabel(el)
    const children = []
    if (depth < maxDepth && kind !== 'text') {
      for (const child of Array.from(el.children || [])) {
        if (SKIP_TAGS.has(child.tagName)) continue
        if (!child.getAttribute('data-cd-id')) continue
        children.push(buildNode(child, depth + 1))
      }
    }
    return {
      id,
      tagName: el.tagName.toLowerCase(),
      kind,
      label,
      children,
    }
  }

  return buildNode(rootEl, 0)
}

export function rgbToHex(colorStr) {
  if (!colorStr || typeof colorStr !== 'string') return ''
  const s = colorStr.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toUpperCase()
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toUpperCase()
  }
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([0-9.]+))?\s*\)$/i.exec(s)
  if (!m) return ''
  if (m[4] !== undefined && Number(m[4]) === 0) return ''
  const toHex = n => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, '0').toUpperCase()
  return `#${toHex(m[1])}${toHex(m[2])}${toHex(m[3])}`
}

function parsePxNumber(val, fallback = 0) {
  const n = Number.parseFloat(String(val ?? ''))
  return Number.isFinite(n) ? Math.round(n) : fallback
}

export function readDomImageFraming(imgEl) {
  if (!imgEl) return null
  const cs = typeof window !== 'undefined' && window.getComputedStyle ? window.getComputedStyle(imgEl) : {}
  const fit = imgEl.getAttribute('data-img-fit') || imgEl.style?.objectFit || cs.objectFit || 'cover'
  const rawPos = imgEl.style?.objectPosition || cs.objectPosition || '50% 50%'
  const posTokens = String(rawPos).trim().split(/\s+/)

  const attrX = Number(imgEl.getAttribute('data-img-pos-x'))
  const attrY = Number(imgEl.getAttribute('data-img-pos-y'))
  const posX = Number.isFinite(attrX) && imgEl.hasAttribute('data-img-pos-x')
    ? attrX
    : Math.max(0, Math.min(100, parsePxNumber(posTokens[0], 50)))
  const posY = Number.isFinite(attrY) && imgEl.hasAttribute('data-img-pos-y')
    ? attrY
    : Math.max(0, Math.min(100, parsePxNumber(posTokens[1] ?? posTokens[0], 50)))

  const attrZoom = Number(imgEl.getAttribute('data-img-zoom'))
  const zoom = Number.isFinite(attrZoom) && imgEl.hasAttribute('data-img-zoom') ? attrZoom : 100
  const attrPanX = Number(imgEl.getAttribute('data-img-pan-x'))
  const panX = Number.isFinite(attrPanX) && imgEl.hasAttribute('data-img-pan-x') ? attrPanX : 0
  const attrPanY = Number(imgEl.getAttribute('data-img-pan-y'))
  const panY = Number.isFinite(attrPanY) && imgEl.hasAttribute('data-img-pan-y') ? attrPanY : 0

  return {
    fit: ['cover', 'contain', 'fill'].includes(fit) ? fit : 'cover',
    posX,
    posY,
    zoom,
    panX,
    panY,
  }
}

export function applyDomImageFraming(imgEl, framing = {}) {
  if (!imgEl) return null
  const current = readDomImageFraming(imgEl) || { fit: 'cover', posX: 50, posY: 50, zoom: 100, panX: 0, panY: 0 }
  const next = {
    fit: ['cover', 'contain', 'fill'].includes(framing.fit) ? framing.fit : current.fit,
    posX: typeof framing.posX === 'number' && Number.isFinite(framing.posX) ? Math.max(0, Math.min(100, Math.round(framing.posX))) : current.posX,
    posY: typeof framing.posY === 'number' && Number.isFinite(framing.posY) ? Math.max(0, Math.min(100, Math.round(framing.posY))) : current.posY,
    zoom: typeof framing.zoom === 'number' && Number.isFinite(framing.zoom) ? Math.max(50, Math.min(250, Math.round(framing.zoom))) : current.zoom,
    panX: typeof framing.panX === 'number' && Number.isFinite(framing.panX) ? Math.max(-400, Math.min(400, Math.round(framing.panX))) : current.panX,
    panY: typeof framing.panY === 'number' && Number.isFinite(framing.panY) ? Math.max(-400, Math.min(400, Math.round(framing.panY))) : current.panY,
  }
  imgEl.setAttribute('data-img-fit', next.fit)
  imgEl.setAttribute('data-img-pos-x', String(next.posX))
  imgEl.setAttribute('data-img-pos-y', String(next.posY))
  imgEl.setAttribute('data-img-zoom', String(next.zoom))
  imgEl.setAttribute('data-img-pan-x', String(next.panX))
  imgEl.setAttribute('data-img-pan-y', String(next.panY))
  imgEl.style.objectFit = next.fit
  imgEl.style.objectPosition = `${next.posX}% ${next.posY}%`
  if (next.zoom !== 100 || next.panX !== 0 || next.panY !== 0) {
    imgEl.style.transformOrigin = `${next.posX}% ${next.posY}%`
    imgEl.style.transform = `translate(${next.panX}px, ${next.panY}px) scale(${(next.zoom / 100).toFixed(2)})`
  } else {
    imgEl.style.removeProperty('transform-origin')
    imgEl.style.removeProperty('transform')
  }
  return next
}

export function computeArtboardRelativeRect(el, rootEl) {
  if (!el || !rootEl || !el.getBoundingClientRect) {
    return { x: 0, y: 0, width: 1080, height: 1440 }
  }
  const rootRect = rootEl.getBoundingClientRect()
  const elRect = el.getBoundingClientRect()
  const scaleX = rootRect.width > 0 ? rootRect.width / 1080 : 1
  const scaleY = rootRect.height > 0 ? rootRect.height / 1440 : 1
  return {
    x: Math.round((elRect.left - rootRect.left) / scaleX),
    y: Math.round((elRect.top - rootRect.top) / scaleY),
    width: Math.max(4, Math.round(elRect.width / scaleX)),
    height: Math.max(4, Math.round(elRect.height / scaleY)),
  }
}

export function findElementByCdId(rootEl, targetId) {
  if (!rootEl || !targetId) return null
  if (targetId === 'root' || rootEl.getAttribute('data-cd-id') === targetId) return rootEl
  return rootEl.querySelector(`[data-cd-id="${targetId}"]`)
}

export function readElementInspectorState(rootEl, targetId) {
  const el = findElementByCdId(rootEl, targetId) || rootEl
  if (!el) return null
  const id = el.getAttribute('data-cd-id') || 'root'
  const kind = classifyDomElement(el)
  const rect = computeArtboardRelativeRect(el, rootEl)
  const cs = typeof window !== 'undefined' && window.getComputedStyle ? window.getComputedStyle(el) : {}
  const inline = el.style || {}

  const rawWidth = inline.width || ''
  const widthMode = rawWidth === '100%' ? 'fill' : rawWidth === 'fit-content' || rawWidth === 'auto' || !rawWidth ? 'hug' : 'fixed'
  const rawHeight = inline.height || ''
  const heightMode = rawHeight === '100%' ? 'fill' : rawHeight === 'fit-content' || rawHeight === 'auto' || !rawHeight ? 'hug' : 'fixed'

  const imgEl = (kind === 'image' ? el : el.querySelector?.('img')) || rootEl.querySelector?.('img')
  const imageSrc = imgEl ? imgEl.getAttribute('src') || '' : ''
  const imageFraming = imgEl ? readDomImageFraming(imgEl) : null

  return {
    id,
    tagName: el.tagName.toLowerCase(),
    kind,
    label: friendlyElementLabel(el),
    rect,
    text: kind === 'text' ? (el.textContent || '').trim() : '',
    imageSrc,
    imageFraming,
    styles: {
      fontFamily: inline.fontFamily || cs.fontFamily || 'Noto Sans SC',
      fontSize: parsePxNumber(inline.fontSize || cs.fontSize, 24),
      fontWeight: String(inline.fontWeight || cs.fontWeight || '500'),
      lineHeight: inline.lineHeight || cs.lineHeight || 'normal',
      letterSpacing: inline.letterSpacing || cs.letterSpacing || 'normal',
      color: rgbToHex(inline.color || cs.color) || '#0A0A0A',
      textAlign: inline.textAlign || cs.textAlign || 'left',
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      widthMode,
      heightMode,
      position: inline.position || cs.position || 'static',
      flexGrow: inline.flexGrow || cs.flexGrow || '0',
      flexDirection: inline.flexDirection || cs.flexDirection || 'column',
      justifyContent: inline.justifyContent || cs.justifyContent || 'flex-start',
      alignItems: inline.alignItems || cs.alignItems || 'stretch',
      gap: `${parsePxNumber(inline.gap || cs.gap, 0)}px`,
      padding: inline.padding || cs.padding || '0px',
      backgroundColor: rgbToHex(inline.backgroundColor || cs.backgroundColor) || '',
      opacity: Math.round(Number.parseFloat(inline.opacity || cs.opacity || '1') * 100),
      borderRadius: parsePxNumber(inline.borderRadius || cs.borderRadius, 0),
      borderWidth: parsePxNumber(inline.borderWidth || cs.borderTopWidth, 0),
      borderStyle: inline.borderStyle || cs.borderTopStyle || 'none',
      borderColor: rgbToHex(inline.borderColor || cs.borderTopColor) || '#E4E4EE',
    },
  }
}

export function serializeArtboardHtml(rootEl) {
  if (!rootEl) return ''
  const clone = rootEl.cloneNode(true)
  for (const decorNode of Array.from(clone.querySelectorAll?.('[data-xhs-decor="1"]') || [])) {
    decorNode.remove()
  }
  const stripAttrs = node => {
    if (node.removeAttribute) {
      node.removeAttribute('data-cd-id')
      node.removeAttribute('contenteditable')
    }
    for (const child of Array.from(node.children || [])) {
      stripAttrs(child)
    }
  }
  stripAttrs(clone)
  return sanitizeXhsCardHtml(clone.innerHTML)
}

export function applyElementMutation(rootEl, targetId, mutation) {
  if (!rootEl || !mutation) return ''
  const el = findElementByCdId(rootEl, targetId) || rootEl

  if (mutation.type === 'text') {
    el.textContent = String(mutation.value ?? '')
  } else if (mutation.type === 'style' && mutation.styles) {
    for (const [k, v] of Object.entries(mutation.styles)) {
      if (v === '' || v == null) {
        el.style.removeProperty(k.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`))
      } else {
        el.style[k] = String(v)
      }
    }
  } else if (mutation.type === 'size-mode') {
    const prop = mutation.axis === 'height' ? 'height' : 'width'
    if (mutation.mode === 'fill') {
      el.style[prop] = '100%'
    } else if (mutation.mode === 'hug') {
      el.style[prop] = 'fit-content'
    } else if (mutation.value) {
      el.style[prop] = mutation.value
    }
  } else if (mutation.type === 'set-image') {
    const cleanUrl = sanitizeCardImageUrl(mutation.src)
    if (!cleanUrl) {
      if (el.tagName === 'IMG') {
        const slot = document.createElement('div')
        slot.className = 'cd-slot'
        slot.setAttribute('data-xhs-slot', 'image')
        slot.innerHTML = '<div class="cd-slot-title">截图位：已移除配图</div><div class="cd-slot-sub">点击右侧配图面板可重新选择</div>'
        el.replaceWith(slot)
      } else if (el.getAttribute('data-xhs-slot') === 'image' || el.classList?.contains('cd-shot-window')) {
        el.className = 'cd-slot'
        el.setAttribute('data-xhs-slot', 'image')
        el.innerHTML = '<div class="cd-slot-title">截图位：点击右侧选图嵌入</div><div class="cd-slot-sub">支持母稿插图或本地上传截图</div>'
      }
    } else if (el.tagName === 'IMG') {
      el.setAttribute('src', cleanUrl)
      if (mutation.caption) el.setAttribute('alt', mutation.caption)
      if (mutation.framing) applyDomImageFraming(el, mutation.framing)
    } else {
      const targetSlot = (el.getAttribute('data-xhs-slot') === 'image' || el.classList?.contains('cd-slot') || el.classList?.contains('cd-shot-window'))
        ? el
        : el.querySelector?.('[data-xhs-slot="image"], .cd-slot, .cd-shot-window')
      if (targetSlot) {
        targetSlot.className = 'cd-shot-window'
        targetSlot.setAttribute('data-xhs-slot', 'image')
        targetSlot.innerHTML = `
          <div class="cd-shot-bar">
            <span class="cd-shot-dot" style="background:#FF5F56"></span>
            <span class="cd-shot-dot" style="background:#FFBD2E"></span>
            <span class="cd-shot-dot" style="background:#27C93F"></span>
            <span class="cd-shot-label">${mutation.caption ? mutation.caption.slice(0, 12) : '实拍截图'}</span>
          </div>
          <div class="cd-shot-frame">
            <img class="cd-shot-img" src="${cleanUrl}" alt="${mutation.caption || '实拍配图'}" />
          </div>
        `
        if (mutation.framing) {
          applyDomImageFraming(targetSlot.querySelector('img'), mutation.framing)
        }
      } else {
        const wrapper = document.createElement('div')
        wrapper.className = 'cd-shot-window'
        wrapper.setAttribute('data-xhs-slot', 'image')
        wrapper.innerHTML = `
          <div class="cd-shot-bar">
            <span class="cd-shot-dot" style="background:#FF5F56"></span>
            <span class="cd-shot-dot" style="background:#FFBD2E"></span>
            <span class="cd-shot-dot" style="background:#27C93F"></span>
            <span class="cd-shot-label">实拍截图</span>
          </div>
          <div class="cd-shot-frame">
            <img class="cd-shot-img" src="${cleanUrl}" alt="${mutation.caption || '实拍配图'}" />
          </div>
        `
        if (mutation.framing) {
          applyDomImageFraming(wrapper.querySelector('img'), mutation.framing)
        }
        const mainArea = rootEl.querySelector('.cd-main') || rootEl
        mainArea.insertBefore(wrapper, mainArea.firstChild)
      }
    }
  } else if (mutation.type === 'replace-image-src') {
    const cleanUrl = sanitizeCardImageUrl(mutation.src)
    const imgEl = (el.tagName === 'IMG' ? el : el.querySelector?.('img')) || rootEl.querySelector?.('img')
    if (cleanUrl && imgEl) {
      imgEl.setAttribute('src', cleanUrl)
      if (mutation.framing) applyDomImageFraming(imgEl, mutation.framing)
    }
  } else if (mutation.type === 'image-framing') {
    const imgEl = (el.tagName === 'IMG' ? el : el.querySelector?.('img')) || rootEl.querySelector?.('img')
    if (imgEl && mutation.framing) {
      applyDomImageFraming(imgEl, mutation.framing)
    }
  } else if (mutation.type === 'insert-element') {
    const container = (el === rootEl ? rootEl.querySelector('.cd-main') : el) || rootEl
    const node = document.createElement('div')
    if (mutation.preset === 'pill') {
      node.className = 'cd-status-pill'
      node.textContent = '新增亮点标签'
    } else if (mutation.preset === 'slot') {
      node.className = 'cd-slot'
      node.setAttribute('data-xhs-slot', 'image')
      node.innerHTML = '<div class="cd-slot-title">截图位：点击在右侧绑定图片</div><div class="cd-slot-sub">支持选择文章配图或上传本地截图</div>'
    } else if (mutation.preset === 'callout') {
      node.className = 'cd-callout'
      node.innerHTML = '<div class="cd-callout-line">· 在这里补充关键结论或避坑提醒</div>'
    } else {
      node.className = 'cd-sub'
      node.textContent = '双击或通过右侧属性面板修改这段文字'
    }
    container.appendChild(node)
  } else if (mutation.type === 'delete-element') {
    if (el !== rootEl && el.parentElement) {
      el.remove()
    }
  }

  annotateArtboardDom(rootEl)
  return serializeArtboardHtml(rootEl)
}

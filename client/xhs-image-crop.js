// 小红书画布图片剪裁纯几何计算（无 DOM / Node 依赖，便于单测复用）。
// 剪裁框使用归一化坐标 { x, y, w, h }，范围 [0, 1]。

export const MIN_CROP_FRACTION = 0.08

export const DEFAULT_CROP_RECT = Object.freeze({ x: 0.05, y: 0.05, w: 0.9, h: 0.9 })

export const CROP_ASPECT_PRESETS = Object.freeze([
  { id: 'free', label: '自由比例', ratio: null },
  { id: '16:9', label: '16:9 横图', ratio: 16 / 9 },
  { id: '4:3', label: '4:3 截图', ratio: 4 / 3 },
  { id: '1:1', label: '1:1 方形', ratio: 1 },
  { id: '3:4', label: '3:4 竖图', ratio: 3 / 4 },
])

const clamp = (v, min, max) => Math.max(min, Math.min(max, v))

export function clampCropRect(rect, minSize = MIN_CROP_FRACTION) {
  const min = clamp(Number(minSize) || MIN_CROP_FRACTION, 0.02, 0.5)
  const w = clamp(Number(rect?.w) || 1, min, 1)
  const h = clamp(Number(rect?.h) || 1, min, 1)
  const x = clamp(Number(rect?.x) || 0, 0, 1 - w)
  const y = clamp(Number(rect?.y) || 0, 0, 1 - h)
  return { x, y, w, h }
}

/**
 * 将剪裁框按目标宽高比（目标像素宽 / 目标像素高）居中适配到图片归一化坐标系内。
 * @param {{x:number,y:number,w:number,h:number}} rect
 * @param {number|null} targetRatio - 物理宽高比（如 16/9），null 表示自由比例
 * @param {number} naturalWidth
 * @param {number} naturalHeight
 */
export function fitCropToAspect(rect, targetRatio, naturalWidth, naturalHeight) {
  const cur = clampCropRect(rect)
  if (!targetRatio || !naturalWidth || !naturalHeight) return cur
  const imgRatio = naturalWidth / naturalHeight
  // 归一化坐标系下的 w / h = targetRatio / imgRatio
  const normRatio = targetRatio / imgRatio
  const cx = cur.x + cur.w / 2
  const cy = cur.y + cur.h / 2

  let w = cur.w
  let h = w / normRatio
  if (h > 1) {
    h = 1
    w = h * normRatio
  }
  if (w > 1) {
    w = 1
    h = w / normRatio
  }
  return clampCropRect({ x: cx - w / 2, y: cy - h / 2, w, h })
}

export function moveCropRect(rect, dx, dy) {
  const cur = clampCropRect(rect)
  return {
    x: clamp(cur.x + dx, 0, 1 - cur.w),
    y: clamp(cur.y + dy, 0, 1 - cur.h),
    w: cur.w,
    h: cur.h,
  }
}

/**
 * 按 8 个手柄（n/s/e/w/nw/ne/sw/se）调整剪裁框，支持可选锁定宽高比。
 */
export function resizeCropRect(startRect, handle, dx, dy, { aspectRatio = null, naturalWidth = 1, naturalHeight = 1, minSize = MIN_CROP_FRACTION } = {}) {
  const start = clampCropRect(startRect, minSize)
  const left0 = start.x
  const right0 = start.x + start.w
  const top0 = start.y
  const bottom0 = start.y + start.h

  let left = left0
  let right = right0
  let top = top0
  let bottom = bottom0

  if (handle.includes('w')) left = clamp(left0 + dx, 0, right0 - minSize)
  if (handle.includes('e')) right = clamp(right0 + dx, left0 + minSize, 1)
  if (handle.includes('n')) top = clamp(top0 + dy, 0, bottom0 - minSize)
  if (handle.includes('s')) bottom = clamp(bottom0 + dy, top0 + minSize, 1)

  let w = right - left
  let h = bottom - top

  if (aspectRatio && naturalWidth > 0 && naturalHeight > 0) {
    const normRatio = aspectRatio / (naturalWidth / naturalHeight)
    const verticalOnly = handle === 'n' || handle === 's'
    if (verticalOnly) {
      w = h * normRatio
      const cx = (left0 + right0) / 2
      left = cx - w / 2
      right = cx + w / 2
      if (left < 0) {
        left = 0
        right = Math.min(1, w)
      } else if (right > 1) {
        right = 1
        left = Math.max(0, 1 - w)
      }
      w = right - left
      h = w / normRatio
      if (handle === 'n') top = bottom0 - h
      else bottom = top0 + h
    } else {
      h = w / normRatio
      if (handle.includes('n')) {
        if (bottom0 - h < 0) {
          h = bottom0
          w = h * normRatio
        }
        top = bottom0 - h
        if (handle.includes('w')) left = right0 - w
        else right = left0 + w
      } else if (handle.includes('s')) {
        if (top0 + h > 1) {
          h = 1 - top0
          w = h * normRatio
        }
        bottom = top0 + h
        if (handle.includes('w')) left = right0 - w
        else right = left0 + w
      } else {
        // e / w 水平边拖动时垂直居中缩放
        const cy = (top0 + bottom0) / 2
        if (h > 1) {
          h = 1
          w = h * normRatio
        }
        top = clamp(cy - h / 2, 0, 1 - h)
        bottom = top + h
        if (handle === 'w') left = right0 - w
        else right = left0 + w
      }
    }
  }

  return clampCropRect({ x: left, y: top, w: right - left, h: bottom - top }, minSize)
}

export function cropRectToPixels(rect, naturalWidth, naturalHeight) {
  const cur = clampCropRect(rect)
  const nw = Math.max(1, Math.round(naturalWidth || 1))
  const nh = Math.max(1, Math.round(naturalHeight || 1))
  const sx = clamp(Math.round(cur.x * nw), 0, nw - 1)
  const sy = clamp(Math.round(cur.y * nh), 0, nh - 1)
  const sw = clamp(Math.round(cur.w * nw), 1, nw - sx)
  const sh = clamp(Math.round(cur.h * nh), 1, nh - sy)
  return { sx, sy, sw, sh }
}

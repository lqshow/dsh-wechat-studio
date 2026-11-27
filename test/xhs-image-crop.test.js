import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import {
  CROP_ASPECT_PRESETS,
  DEFAULT_CROP_RECT,
  clampCropRect,
  cropRectToPixels,
  fitCropToAspect,
  moveCropRect,
  resizeCropRect,
} from '../client/xhs-image-crop.js'

test('xhs-image-crop.js 纯函数且不依赖 node:* 或 DOM 全局对象', async () => {
  const src = await readFile(new URL('../client/xhs-image-crop.js', import.meta.url), 'utf8')
  assert.doesNotMatch(src, /from\s+['"]node:/)
  assert.doesNotMatch(src, /\b(?:document|window)\./)
  assert.ok(CROP_ASPECT_PRESETS.some(p => p.id === 'free' && p.ratio === null))
  assert.ok(CROP_ASPECT_PRESETS.some(p => p.id === '16:9'))
})

test('clampCropRect、moveCropRect 与 cropRectToPixels 边界收敛正确', () => {
  assert.deepEqual(clampCropRect({ x: -0.5, y: 0.9, w: 0.4, h: 0.4 }), { x: 0, y: 0.6, w: 0.4, h: 0.4 })
  assert.deepEqual(moveCropRect({ x: 0.2, y: 0.2, w: 0.5, h: 0.5 }, 0.8, -0.5), { x: 0.5, y: 0, w: 0.5, h: 0.5 })

  const px = cropRectToPixels({ x: 0.1, y: 0.25, w: 0.5, h: 0.5 }, 1000, 2000)
  assert.deepEqual(px, { sx: 100, sy: 500, sw: 500, sh: 1000 })
})

test('fitCropToAspect 与 resizeCropRect 支持自由拉伸与锁定宽高比', () => {
  // 对 1000x2000 竖图套用 16:9 横图比例，剪裁后像素宽高比应贴近 16:9
  const fitted = fitCropToAspect(DEFAULT_CROP_RECT, 16 / 9, 1000, 2000)
  const px = cropRectToPixels(fitted, 1000, 2000)
  assert.ok(Math.abs(px.sw / px.sh - 16 / 9) < 0.02, `实际比例 ${px.sw / px.sh}`)

  // 自由模式下拖东南角向内收缩
  const shrunk = resizeCropRect({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, 'se', -0.2, -0.3)
  assert.ok(Math.abs(shrunk.w - 0.6) < 1e-6)
  assert.ok(Math.abs(shrunk.h - 0.5) < 1e-6)

  // 锁定 1:1 比例拖动东南角时，像素宽高保持 1:1
  const squareStart = fitCropToAspect({ x: 0.1, y: 0.1, w: 0.6, h: 0.6 }, 1, 1000, 2000)
  const resized = resizeCropRect(squareStart, 'se', 0.1, 0.2, {
    aspectRatio: 1,
    naturalWidth: 1000,
    naturalHeight: 2000,
  })
  const sqPx = cropRectToPixels(resized, 1000, 2000)
  assert.ok(Math.abs(sqPx.sw - sqPx.sh) <= 2, `1:1 剪裁宽高应一致：${sqPx.sw}x${sqPx.sh}`)
})

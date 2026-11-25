import assert from 'node:assert/strict'
import { test } from 'node:test'
import { drawCardFallbackToCanvas } from '../client/xhs-card-render.js'

test('Canvas 2D 连续回退帧独立缩放并在绘制前清除上一帧', async () => {
  for (const [width, height, scale] of [[2160, 2880, 2], [540, 720, 0.5]]) {
    let transform = [1, 1]
    const drawnText = new Map()
    const clears = []
    const ctx = {
      setTransform(x, _b, _c, y) { transform = [x, y] },
      scale(x, y) { transform = [transform[0] * x, transform[1] * y] },
      clearRect(...rect) {
        clears.push({ rect, transform })
        drawnText.clear()
      },
      measureText(text) { return { width: text.length * 24 } },
      fillText(text) { drawnText.set(text, transform) },
      save() {},
      restore() {},
      beginPath() {},
      roundRect() {},
      fill() {},
      stroke() {},
      moveTo() {},
      lineTo() {},
    }
    const canvas = { width, height, getContext: () => ctx }

    await drawCardFallbackToCanvas(canvas, { kind: 'list', heading: '第一帧', lines: ['原先的条目'] }, {})
    assert.deepEqual(drawnText.get('第一帧'), [scale, scale])
    await drawCardFallbackToCanvas(canvas, { kind: 'list', heading: '第二帧', lines: ['替换的条目'] }, {})
    assert.deepEqual(drawnText.get('第二帧'), [scale, scale])
    assert.equal(drawnText.has('第一帧'), false)
    assert.deepEqual(clears, Array.from({ length: 2 }, () => ({
      rect: [0, 0, width, height], transform: [1, 1],
    })))
  }
})

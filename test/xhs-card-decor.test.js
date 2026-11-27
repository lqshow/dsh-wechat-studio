import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  XHS_DECOR_PRESETS,
  XHS_DECOR_SCOPES,
  renderCardAmbientDecor,
  resolveAutoDecorPreset,
} from '../client/xhs-card-decor.js'
import { normalizeXhsTweaks } from '../src/derive-shared.js'

test('client/xhs-card-decor.js stays browser-safe and pure', () => {
  const source = fs.readFileSync(new URL('../client/xhs-card-decor.js', import.meta.url), 'utf8')
  assert.equal(/\bnode:/.test(source), false)
  assert.equal(/\bdocument\./.test(source), false)
  assert.equal(/\bwindow\./.test(source), false)
})

test('all 6 decorative presets emit theme-aware ambient SVG layers', () => {
  const concretePresets = XHS_DECOR_PRESETS
    .map(item => item.id)
    .filter(id => id !== 'auto' && id !== 'none')
  assert.equal(concretePresets.length, 6)
  assert.equal(XHS_DECOR_SCOPES.length, 4)

  for (const preset of concretePresets) {
    const svg = renderCardAmbientDecor({ preset, scope: 'all', cardKind: 'cover' })
    assert.match(svg, /^<svg class="xhs-ambient-decor" data-xhs-decor="1"/)
    assert.match(svg, new RegExp(`data-decor-preset="${preset}"`))
    assert.match(svg, /viewBox="0 0 1080 1440"/)
    assert.match(svg, /var\(--xhs-/)
    assert.match(svg, /<\/svg>$/)
  }
})

test('smart scope distinguishes hero pages from inner content pages', () => {
  const coverSvg = renderCardAmbientDecor({ preset: 'silk-dots', scope: 'smart', cardKind: 'cover' })
  const quoteSvg = renderCardAmbientDecor({ preset: 'silk-dots', scope: 'smart', cardKind: 'quote' })
  const endSvg = renderCardAmbientDecor({ preset: 'silk-dots', scope: 'smart', cardKind: 'end' })
  const innerSvg = renderCardAmbientDecor({ preset: 'silk-dots', scope: 'smart', cardKind: 'list' })

  assert.equal(coverSvg, quoteSvg)
  assert.equal(coverSvg, endSvg)
  assert.ok(innerSvg.length > 0)
  assert.ok(innerSvg.length < coverSvg.length, 'inner pages should omit secondary glow/corner matrix for breathing room')
})

test('cover-only and none scopes suppress decoration as configured', () => {
  assert.equal(renderCardAmbientDecor({ preset: 'silk-dots', scope: 'cover', cardKind: 'list' }), '')
  assert.ok(renderCardAmbientDecor({ preset: 'silk-dots', scope: 'cover', cardKind: 'cover' }).includes('xhs-ambient-decor'))
  assert.equal(renderCardAmbientDecor({ preset: 'none', scope: 'all', cardKind: 'cover' }), '')
  assert.equal(renderCardAmbientDecor({ preset: 'silk-dots', scope: 'none', cardKind: 'cover' }), '')
})

test('resolveAutoDecorPreset picks complementary decor for each design kit and deck style', () => {
  assert.equal(resolveAutoDecorPreset({ designPrompt: '复古科技报纸 / 纽约客专栏' }), 'editorial-frame')
  assert.equal(resolveAutoDecorPreset({ designPrompt: '瑞士大字报 + 荧光笔批注' }), 'swiss-grid')
  assert.equal(resolveAutoDecorPreset({ designPrompt: '红笔手账备课本' }), 'none')
  assert.equal(resolveAutoDecorPreset({ designPrompt: '工业工具说明书' }), 'blueprint-tech')
  assert.equal(resolveAutoDecorPreset({ designPrompt: 'Monocle 日系杂志' }), 'ink-wash')
  assert.equal(resolveAutoDecorPreset({ designPrompt: '黑胶唱片 × 潮流 Zine' }), 'orbital-arc')
  assert.equal(resolveAutoDecorPreset({ deckStyle: 'bold' }), 'orbital-arc')
  assert.equal(resolveAutoDecorPreset({ deckStyle: 'editorial' }), 'ink-wash')
  assert.equal(resolveAutoDecorPreset({ deckStyle: 'tech' }), 'silk-dots')
})

test('normalizeXhsTweaks persists valid decor and decorScope and drops invalid values', () => {
  const valid = normalizeXhsTweaks({ decor: 'orbital-arc', decorScope: 'cover' })
  assert.equal(valid.decor, 'orbital-arc')
  assert.equal(valid.decorScope, 'cover')

  assert.equal(normalizeXhsTweaks({ decor: 'unknown-style', decorScope: 'invalid' }), null)
})

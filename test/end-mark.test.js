import test from 'node:test'
import assert from 'node:assert/strict'
import { END_MARK_STYLE_IDS, normalizeEndMark, renderEndMarkHtml } from '../src/end-mark.js'
import { renderFragment, renderPage, STYLES, THEMES } from '../vendor/layout/layout.js'

test('end-mark 样式归一化与关闭状态返回空字符串', () => {
  assert.equal(normalizeEndMark('horizon'), 'horizon')
  assert.equal(normalizeEndMark('COLOPHON'), 'colophon')
  assert.equal(normalizeEndMark('signal'), 'signal')
  assert.equal(normalizeEndMark('unknown', 'none'), 'none')
  assert.equal(renderEndMarkHtml('none'), '')
})

test('end-mark 三款标识在全部 10 套风格与 15 套配色下均输出公众号合规内联 SVG（无渐变/无 clipPath/无脚本）', () => {
  const activeStyles = END_MARK_STYLE_IDS.filter(id => id !== 'none')
  assert.deepEqual(activeStyles, ['horizon', 'colophon', 'signal'])

  for (const styleId of activeStyles) {
    for (const [themeKey, palette] of Object.entries(THEMES)) {
      const html = renderEndMarkHtml(styleId, { st: 'std', ...palette })
      assert.match(html, new RegExp(`data-end-mark="${styleId}"`), `${styleId}/${themeKey} 应包含 data-end-mark`)
      assert.ok(html.includes(palette.main), `${styleId}/${themeKey} 应联动文章主题色`)
      assert.doesNotMatch(html, /<script|<defs|<clipPath|Gradient|\son\w+=/i, `${styleId}/${themeKey} 不应包含公众号禁用的 SVG 特性或脚本`)
    }
    for (const layoutStyle of Object.keys(STYLES)) {
      const { html } = renderFragment('# 测试标题\n\n这是最后一段正文。', {
        style: layoutStyle,
        theme: 'orange',
        outro: 'false',
        endMark: styleId,
      })
      assert.match(html, new RegExp(`data-end-mark="${styleId}"`), `${styleId}/${layoutStyle} 应渲染进正文片段`)
    }
  }
})

test('renderPage 仅在显式开启 endMark 时输出文末标识，默认关闭不影响既有黄金输出', () => {
  const plain = renderPage('# 标题\n\n正文。', { outro: 'false' })
  assert.doesNotMatch(plain.html, /data-end-mark=/)

  const withHorizon = renderPage('# 标题\n\n正文。', { outro: 'false', endMark: 'horizon' })
  assert.match(withHorizon.html, /data-end-mark=\\"horizon\\"/)
})

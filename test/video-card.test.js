import test from 'node:test'
import assert from 'node:assert/strict'
import {
  formatTimecode,
  formatVideoCardMarkdown,
  isVideoCardText,
  parseVideoCardBlock,
  renderVideoCardHtml,
  VIDEO_CARD_STYLE_IDS,
} from '../src/video-card.js'
import { plainMd, renderFragment, renderPage, STYLES } from '../vendor/layout/layout.js'
import { toPortableMarkdown } from '../src/derive-markdown.js'

test('video-card 解析、序列化与时间码格式化', () => {
  const md = formatVideoCardMarkdown({
    style: 'cinema',
    index: 'CASE 02',
    title: '《热气球》',
    model: 'SEEDANCE 2.5 · 1080P',
    duration: '00:29',
    spec: 'REC.709',
    note: '清晨六点升空实拍',
    poster: 'https://example.com/balloon.jpg',
  })
  assert.equal(isVideoCardText(md), true)
  const parsed = parseVideoCardBlock(md)
  assert.deepEqual(parsed, {
    style: 'cinema',
    index: 'CASE 02',
    title: '《热气球》',
    model: 'SEEDANCE 2.5 · 1080P',
    duration: '00:29',
    spec: 'REC.709',
    note: '清晨六点升空实拍',
    poster: 'https://example.com/balloon.jpg',
  })
  assert.equal(formatTimecode('00:29'), 'TC 00:00:29')
  assert.equal(formatTimecode('1:05'), 'TC 00:01:05')
  assert.equal(formatTimecode('01:02:03'), 'TC 01:02:03')
})

test('video-card 拒绝非 HTTP(S) 或带凭证的 poster 并转义 HTML', () => {
  const parsed = parseVideoCardBlock([
    '```video cinema',
    'title: <script>alert(1)</script>',
    'poster: javascript:alert(1)',
    '```',
  ].join('\n'))
  assert.equal(parsed.poster, '')
  const html = renderVideoCardHtml(parsed)
  assert.doesNotMatch(html, /<script/i)
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
})

test('video-card 三种风格在全部 10 套排版皮肤下输出公众号合规 HTML 且含 data-video-slot', () => {
  for (const style of VIDEO_CARD_STYLE_IDS) {
    const md = `# 标题\n\n${formatVideoCardMarkdown({
      style,
      index: 'CASE 02',
      title: '《热气球》',
      model: 'SEEDANCE 2.5 · 1080P',
      duration: '00:29',
      spec: 'REC.709',
      note: '实拍测试',
    })}\n`
    const page = renderPage(md, { style: 'std', theme: 'orange', outro: 'false' })
    assert.match(page.report, /视频占位 1/)
    for (const layoutStyle of Object.keys(STYLES)) {
      const { html } = renderFragment(md, { style: layoutStyle, theme: 'orange', outro: 'false' })
      assert.match(html, /data-video-slot="《热气球》"/, `${style}/${layoutStyle} 应包含 data-video-slot`)
      assert.doesNotMatch(html, /<script|<iframe|on\w+=/i, `${style}/${layoutStyle} 不应包含脚本或事件属性`)
      const slotMatch = /data-video-slot="[^"]*"[^>]*>([\s\S]*?)<\/section>/.exec(html)
      assert.ok(slotMatch, `${style}/${layoutStyle} 应闭合 data-video-slot 容器`)
      assert.doesNotMatch(slotMatch[1], /<svg/i, `${style}/${layoutStyle} 的视频槽内部不应放 SVG，避免公众号插入视频时劈裂占位`)
    }
  }
})

test('video-card 在朱雀纯文本中剔除并在通用 Markdown 导出中优雅降级', () => {
  const blockText = formatVideoCardMarkdown({
    style: 'editorial',
    index: 'CASE 02',
    title: '《热气球》',
    duration: '00:29',
    note: '日出航拍片段',
  })
  const plain = plainMd(`# 标题\n\n正文第一段。\n\n${blockText}\n\n正文第二段。`)
  assert.doesNotMatch(plain, /CASE 02|REC\.709|《热气球》/)
  assert.match(plain, /正文第一段/)

  const exported = toPortableMarkdown({
    title: '标题',
    blocks: [{ id: 'b1', text: blockText }],
  })
  assert.match(exported.markdown, /> 视频：CASE 02 《热气球》（00:29）/)
  assert.match(exported.markdown, /> 日出航拍片段/)
  assert.equal(exported.warnings.length, 1)
})

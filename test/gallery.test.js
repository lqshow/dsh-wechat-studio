import assert from 'node:assert/strict'
import { test } from 'node:test'
import { blockKind, createArticle, isCheckable, parseMarkdownGallery, plainOf } from '../src/article.js'
import { toPortableMarkdown } from '../src/derive-markdown.js'
import { feishuImageUrls, replaceFeishuImages } from '../src/markdown-images.js'
import { cardMarkdown, formatSelection, insertFormats } from '../client/editor-format.js'
import { galleryColors, parseGalleryBlock } from '../src/gallery.js'
import { plainMd, renderFragment, renderPage, STYLES, THEMES } from '../vendor/layout/layout.js'

const IMG1 = 'https://mmbiz.qpic.cn/example/1.jpg'
const IMG2 = 'https://mmbiz.qpic.cn/example/2.jpg'
const IMG3 = 'https://mmbiz.qpic.cn/example/3.jpg'

test('parseMarkdownGallery 支持单行 mdnice 语法和多行尖括号语法，并拒绝普通 HTML', () => {
  const single = `<![蓝1](${IMG1}),![绿2](${IMG2}),![红3](${IMG3})>`
  assert.deepEqual(parseMarkdownGallery(single), [
    { caption: '蓝1', src: IMG1, title: '' },
    { caption: '绿2', src: IMG2, title: '' },
    { caption: '红3', src: IMG3, title: '' },
  ])

  const multi = `<\n![正面](<${IMG1}>),\n![背面](<${IMG2}>)\n>`
  assert.deepEqual(parseMarkdownGallery(multi), [
    { caption: '正面', src: IMG1, title: '' },
    { caption: '背面', src: IMG2, title: '' },
  ])

  assert.equal(parseMarkdownGallery('<!-- comment -->'), null)
  assert.equal(parseMarkdownGallery('<div>hello</div>'), null)
  assert.equal(parseMarkdownGallery(`![单图](${IMG1})`), null)
  assert.equal(blockKind(single), 'media')
  assert.equal(blockKind(multi), 'media')
  assert.equal(plainOf(multi), '')
  assert.equal(isCheckable(multi), false)
})

test('editor-format：插入菜单包含横滑图集，cardMarkdown 生成可往返解析的语法', () => {
  const mediaGroup = insertFormats.find(g => g.label === '媒体与分隔')
  assert.ok(mediaGroup.items.some(([id, label]) => id === 'gallery' && label === '横滑图集'))

  assert.throws(() => cardMarkdown('gallery', '', [{ src: IMG1, caption: '' }]), /至少需要 2 张图片/)
  assert.throws(() => cardMarkdown('gallery', '', [{ src: IMG1, caption: '' }, { src: 'ftp://bad/a.png', caption: '' }]), /HTTP 或 HTTPS/)

  const md = cardMarkdown('gallery', '', [
    { src: IMG1, caption: '开箱正面' },
    { src: IMG2, caption: '' },
  ])
  assert.deepEqual(parseMarkdownGallery(md), [
    { caption: '开箱正面', src: IMG1, title: '' },
    { caption: '', src: IMG2, title: '' },
  ])

  const formatted = formatSelection('前一段', 3, 3, 'gallery')
  assert.match(formatted.text, /<\n!\[图1\]/)
})

test('排版引擎：横滑图集渲染 图集徽章、左右滑动提示、总张数与图注，且所有风格均可用', () => {
  const md = `# 测试文章\n\n<![](${IMG1}),![外观细节](${IMG2})>\n\n后一段正文。\n`
  for (const style of Object.keys(STYLES)) {
    const { html } = renderFragment(md, { style, theme: 'orange', outro: 'false' })
    assert.match(html, />图集</, `${style} 风格缺少 图集徽章`)
    assert.match(html, />2 张 · 左右滑动 →</, `${style} 风格缺少左右滑动提示`)
    assert.match(html, /overflow-x:auto;white-space:nowrap;/, `${style} 风格缺少横滑容器样式`)
    const colors = galleryColors(style, THEMES.orange)
    assert.ok(html.includes(`background:${colors.badgeBg};color:${colors.badgeText};`))
    assert.ok(html.includes(`color:${colors.countColor};letter-spacing:0.5px;">2 张 · 左右滑动 →`))
    assert.match(html, /scroll-snap-type:x mandatory/)
    assert.match(html, /scroll-snap-align:start/)
    assert.match(html, /margin-right:0;[^"]*scroll-snap-align:end;/)
    assert.doesNotMatch(html, /display:inline-block;width:14%;/)
    assert.match(html, /1\.jpg"[^>]+\/><\/section>/)
    assert.match(html, /2\.jpg"[^>]+\/><p style="[^"]*text-align:left;[^"]*">外观细节<\/p>/)
    assert.doesNotMatch(html, /[12]<\/strong>\/2/)
    assert.ok(html.includes(IMG1) && html.includes(IMG2), `${style} 风格缺少图片地址`)
  }

  const page = renderPage(md, { style: 'std', theme: 'orange', outro: 'false' })
  assert.match(page.report, /统计：图片 2，图注 0，视频占位 0，动画卡 0，滑动卡 1/)
})

test('自定义标签可往返编辑，导出时转义并跟随主题，清空后恢复默认', () => {
  const items = [{ src: IMG1 }, { src: IMG2 }]
  const label = '封面对比 [A & B] <实拍>'
  const md = cardMarkdown('gallery', '  ' + label + '  ', items)
  assert.equal(parseGalleryBlock(md)?.label, label)
  assert.equal(blockKind(md), 'media')
  assert.equal(plainMd(md), '')
  const { html } = renderFragment(md, { style: 'std', theme: 'blue', outro: 'false' })
  assert.match(html, /background:#2952B6;color:#FFFFFF;[^"]+">封面对比 \[A &amp; B\] &lt;实拍&gt;</)
  assert.match(html, /color:#64748B;letter-spacing:0.5px;">2 张/)
  const cleared = cardMarkdown('gallery', ' ', parseMarkdownGallery(md))
  assert.equal(parseGalleryBlock(cleared)?.label, '')
  assert.match(renderFragment(cleared, { theme: 'ink', outro: 'false' }).html, />图集</)
})

test('plainMd 跳过单行和多行横滑图集，不污染纯文本检测', () => {
  const md = `# 标题\n\n第一段。\n\n<![图1](${IMG1}),![图2](${IMG2})>\n\n<\n![图3](<${IMG3}>),\n![图4](<${IMG1}>)\n>\n\n第二段。\n`
  const plain = plainMd(md)
  assert.equal(plain, '# 标题\n\n第一段。\n\n第二段。')
})

test('外发通用 Markdown 与飞书图片转存兼容横滑图集', () => {
  const feishu = 'https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/authcode/?code=abc123'
  const galleryText = `<\n![图一](<${feishu}>),\n![图二](<${IMG2}>)\n>`
  const article = createArticle({ markdown: `# 标题\n\n${galleryText}\n` })

  assert.deepEqual(feishuImageUrls(article.blocks), [feishu])
  const replaced = replaceFeishuImages(galleryText, new Map([[feishu, IMG1]]))
  assert.deepEqual(parseMarkdownGallery(replaced), [
    { caption: '图一', src: IMG1, title: '' },
    { caption: '图二', src: IMG2, title: '' },
  ])

  const portable = toPortableMarkdown(createArticle({ markdown: `# 标题\n\n${replaced}\n` }), { target: 'blog' })
  assert.equal(portable.markdown, `# 标题\n\n![图一](${IMG1})\n\n![图二](${IMG2})\n`)
})

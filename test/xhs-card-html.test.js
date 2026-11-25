import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import {
  XHS_CARD_KINDS,
  computeDomTopologySignature,
  normalizeCardImageFraming,
  normalizeXhs,
} from '../src/derive-shared.js'
import {
  DEFAULT_XHS_TWEAKS,
  XHS_ARTBOARD_CSS,
  XHS_STYLE_PRESETS,
  buildCardStyleText,
  buildImageFramingStyle,
  ensureCardHtml,
  resolveXhsThemeVars,
  synthesizeCardHtml,
} from '../client/xhs-card-html.js'

test('数据卡按实际指标数撑满每行，四项排成 2×2', () => {
  for (const [count, expectedSpans] of [
    [1, [6]], [2, [3, 3]], [3, [2, 2, 2]], [4, [3, 3, 3, 3]], [5, [2, 2, 2, 3, 3]],
  ]) {
    const html = ensureCardHtml({
      kind: 'metrics',
      lines: Array.from({ length: count }, (_, index) => `${index + 1} 秒 | 响应时间`),
    })
    assert.match(html, /class="cd-col-grid cd-metrics-grid"/)
    assert.deepEqual(
      Array.from(html.matchAll(/grid-column:span (\d+)/g), match => Number(match[1])),
      expectedSpans,
    )
  }
})

test('xhs-card-html.js 纯函数且不依赖 node:* 或 DOM 全局对象', async () => {
  const src = await readFile(new URL('../client/xhs-card-html.js', import.meta.url), 'utf8')
  assert.doesNotMatch(src, /from\s+['"]node:/)
  assert.doesNotMatch(src, /\b(?:document|window)\./)
  assert.ok(XHS_STYLE_PRESETS.some(p => p.id === 'claude'))
  assert.ok(XHS_ARTBOARD_CSS.includes('.xhs-artboard'))
  assert.ok(XHS_ARTBOARD_CSS.includes('.cd-table-card'))
})

test('resolveXhsThemeVars 支持预设切换与自定义 tweaks 覆盖', () => {
  const claudeVars = resolveXhsThemeVars({ tweaks: { preset: 'claude', scale: 1.1, density: 0.95, radius: 24 } })
  assert.equal(claudeVars['--xhs-accent'], '#6D3BF2')
  assert.equal(claudeVars['--xhs-scale'], '1.1')
  assert.equal(claudeVars['--xhs-density'], '0.95')
  assert.equal(claudeVars['--xhs-radius'], '24px')

  const customVars = resolveXhsThemeVars({
    tweaks: { ...DEFAULT_XHS_TWEAKS, accent: '#123456', surface: '#FAFAFA' },
  })
  assert.equal(customVars['--xhs-accent'], '#123456')
  assert.equal(customVars['--xhs-bg'], '#FAFAFA')
})

test('synthesizeCardHtml 为全部 8 种版式生成纵向自适应、高密度的 Claude Design HTML', () => {
  const samples = {
    cover: {
      kind: 'cover',
      badge: '实测复盘',
      heading: '中国版 OpenRouter 火了',
      accent: '1个入口，统一调度',
      lines: ['我拿它管了 N 个 AI 项目 | 零复制粘贴'],
      tags: ['自定义路由', '自带 Key', '按项目预算'],
    },
    compare: {
      kind: 'compare',
      badge: '痛点对比',
      heading: '你是在写代码还是当翻译',
      lines: [
        '以前 | 复制对话摘要，手动整理文件，再用人话解释一遍',
        '以前 | review 完再切回来，把意见复制过去再解释',
        '现在 | 在对话框输入 @，直接引用对方的历史对话',
        '现在 | 换个 Agent，前面的上下文一点没丢',
      ],
      callout: '中间真的没有一次复制粘贴',
    },
    steps: {
      kind: 'steps',
      badge: '原始记录',
      heading: '每一条请求，都有记录',
      lines: [
        '一个入口，调好几家模型 | DeepSeek、MiniMax、Kimi 共用一个 Key',
        '同一个模型，路由到不同服务商 | 自动分配高可用节点',
        '结果、花费、速度逐条可查 | 后台日志一目了然',
      ],
    },
    metrics: {
      kind: 'metrics',
      badge: '先看稳不稳',
      heading: '首字快不快，吐字快不快',
      lines: [
        '1.1 s | 首 Token 延迟 | 约 1 秒出第一个字',
        '141.6 tok/s | 生成速度 | 每秒吐的 Token 数',
        '0 次 | 重试次数 | 一次就成功',
      ],
    },
    grid: {
      kind: 'grid',
      badge: '按项目管钱',
      heading: '一个项目，一份预算',
      lines: [
        '配图工具 | 独立限额与密钥隔离',
        '写作插件 | 自动统计本周消耗',
        '客服项目 | 达到上限自动预警',
        '默认项目 | 兜底路由不中断',
      ],
    },
    list: {
      kind: 'list',
      badge: '钱花在哪',
      heading: '按项目、按 Key，一眼看清',
      lines: [
        '价格公开 | 路由策略可以自己选',
        '明细可查 | 每个项目的花费拆得明明白白',
      ],
    },
    quote: {
      kind: 'quote',
      badge: '真实痛点',
      heading: '说到心坎里的一句',
      lines: ['你写代码的时间，可能还没给 Agent 当翻译的时间多。'],
    },
    end: {
      kind: 'end',
      badge: '抄作业清单',
      heading: '四句话直接拿走用',
      lines: ['先收藏 | 用得上再回来翻这套流程'],
    },
  }

  for (const kind of XHS_CARD_KINDS) {
    const html = synthesizeCardHtml(samples[kind], { index: 0, total: 8, author: '懒人笔记' })
    assert.ok(html.includes('cd-header'), `${kind} 应包含 cd-header`)
    assert.ok(html.includes('cd-main'), `${kind} 应包含 cd-main 纵向自适应主区`)
    assert.doesNotMatch(html, /<script/i)
  }

  // 6 套纯配色主题（与版式正交：切换配色仅改 CSS 变量，不改变卡片 DOM 结构）
  assert.deepEqual(
    XHS_STYLE_PRESETS.map(p => p.id),
    ['claude', 'editorial', 'tech', 'emerald', 'bold', 'theme'],
  )
  const coverClaude = synthesizeCardHtml(samples.cover, { index: 0, total: 7, tweaks: { preset: 'claude' } })
  const coverEditorial = synthesizeCardHtml(samples.cover, { index: 0, total: 7, tweaks: { preset: 'editorial' } })
  const coverBold = synthesizeCardHtml(samples.cover, { index: 0, total: 7, tweaks: { preset: 'bold' } })
  assert.equal(coverClaude, coverEditorial)
  assert.equal(coverClaude, coverBold)

  // 8 种卡型的兜底合成具备互不相同的 DOM 拓扑结构
  const innerKinds = ['compare', 'steps', 'metrics', 'grid', 'list', 'quote']
  const innerSigs = new Set(innerKinds.map((kind, i) => computeDomTopologySignature(
    synthesizeCardHtml(samples[kind], { index: i + 1, total: 8, author: '懒人笔记' }),
  )))
  assert.ok(innerSigs.size >= 5, `不同卡型应产出多样化拓扑结构，实际仅 ${innerSigs.size} 种`)

  // buildCardStyleText 合并基础样式 + 经过作用域隔离的 customCss 与 pageCss
  const mergedCss = buildCardStyleText({
    customCss: 'body { display: none !important; } .hero-card { border: 2px solid var(--xhs-accent); } @import url("https://evil.test/x.css");',
    pageCss: '.page-badge { background: var(--xhs-tint); }',
  })
  assert.ok(mergedCss.includes('.xhs-artboard .hero-card'))
  assert.ok(mergedCss.includes('.xhs-artboard .page-badge'))
  assert.doesNotMatch(mergedCss, /(?:^|[}\n;]\s*)body\s*\{|@import|evil\.test/i)

  // compare 应包含「以前」对比表与「现在」深色横幅 + Bento 网格
  const compareHtml = synthesizeCardHtml(samples.compare, { index: 1, total: 7 })
  assert.ok(compareHtml.includes('cd-table'))
  assert.ok(compareHtml.includes('cd-dark-panel'))
  assert.ok(compareHtml.includes('cd-bento'))

  // ensureCardHtml 优先保留合法的自定义 html，并过滤危险脚本
  const custom = ensureCardHtml({
    ...samples.cover,
    html: '<div class="cd-header"><h1 onclick="alert(1)">自定义画布</h1><script>evil()</script></div>',
  })
  assert.ok(custom.includes('自定义画布'))
  assert.doesNotMatch(custom, /onclick|<script/i)

  // 插图构图与位置微调（往左拉露右侧人物 posX=85、缩放、平移、完整不裁切 contain）
  const framing = normalizeCardImageFraming({ fit: 'cover', posX: 85, posY: 40, zoom: 115, panX: -36, panY: 12 })
  assert.deepEqual(framing, { fit: 'cover', posX: 85, posY: 40, zoom: 115, panX: -36, panY: 12 })
  const styleStr = buildImageFramingStyle(framing)
  assert.ok(styleStr.includes('object-fit:cover'))
  assert.ok(styleStr.includes('object-position:85% 40%'))
  assert.ok(styleStr.includes('translate(-36px, 12px) scale(1.15)'))

  const coverWithFramedImg = synthesizeCardHtml({
    ...samples.cover,
    imageUrl: 'https://cdn.example.com/hero.png',
    imageFraming: framing,
  }, { index: 0, total: 6 })
  assert.ok(coverWithFramedImg.includes('data-img-pos-x="85"'))
  assert.ok(coverWithFramedImg.includes('object-position:85% 40%'))

  // normalizeXhs 保留卡片的 imageFraming 与 html
  const normalized = normalizeXhs({
    title: '插图位置微调测试',
    body: '这是一段满一百字的小红书正文测试内容，用于验证卡片插图的左右构图焦点偏移、缩放与平移参数在保存时能够完整保留。'.repeat(2),
    tags: ['插图微调', '构图控制', '小红书'],
    cards: [
      { ...samples.cover, imageUrl: 'https://cdn.example.com/hero.png', imageFraming: framing },
      samples.compare,
      samples.steps,
      samples.metrics,
      samples.end,
    ],
  }, { strictCardLength: false })
  assert.deepEqual(normalized.cards[0].imageFraming, framing)
})

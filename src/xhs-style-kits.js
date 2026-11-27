// 基于实测高水准样例提炼的 5 套小红书内置视觉 Design Kit：
// 将强模型的高级排版原语沉淀为内置 CSS 类（定义在 client/xhs-card-html.js）+ 精简结构范例，
// 让弱模型也能稳定复现出版级排版质感，同时大幅减少单页 CSS 体积、避免超预算回退。

export const XHS_STYLE_KITS = [
  {
    id: 'newyorker',
    name: '复古科技报纸 / 纽约客专栏',
    pattern: /纽约客|复古.*报纸|苹果印刷|特稿|专栏/i,
    guidance: [
      '# 内置风格原语包（复古科技报纸 / 纽约客专栏，优先复用以减少 CSS 体积）',
      '- 可直接使用的内置类：.ny-masthead（顶部粗+细双线刊头，放 3 段等宽元信息）、.ny-kicker（强调色眉标）、.ny-serif-title（衬线大标题）、.ny-pullquote（底边强调线拉出引言）、.ny-dropcap（首字下沉，用于正文首字）、.ny-cols（竖线不对称分栏，子列用 .ny-col）、.ny-fig（带 FIG 1.0 图注的截图框）、.ny-ledger（横向比例对比条）、.ny-endmark（杂志结语方块 ■）。',
      '- 结构范例（每页请变换分栏比例与组件组合，避免雷同）：',
      '  <div class="cd-header"><div class="ny-masthead"><span>FIELD DISPATCH</span><span>SEC 01</span><span>PAGE 01 / 07</span></div></div>',
      '  <div class="cd-main"><div class="ny-kicker">FEATURE ESSAY</div><h1 class="ny-serif-title">核心标题</h1><div class="ny-cols"><div class="ny-col"><span class="ny-dropcap">首</span><p>正文展开…</p></div><div class="ny-col"><blockquote class="ny-pullquote">核心金句</blockquote></div></div></div>',
      '  <div class="cd-footer"><span>专栏实测</span><span class="ny-endmark">■</span></div>',
      '- 防溢出红线：单页正文总字数克制精炼，预留底部 ≥ 64px 安全区，严禁底部文字与 .cd-footer 重叠。',
    ].join('\n'),
  },
  {
    id: 'swiss',
    name: '瑞士大字报 + 荧光笔批注',
    pattern: /瑞士.*荧光笔|瑞士海报|大字报|荧光笔批注/i,
    guidance: [
      '# 内置风格原语包（瑞士大字报 + 荧光笔批注，优先复用以减少 CSS 体积）',
      '- 可直接使用的内置类：.sw-heavy-rule（3px 粗黑分割线）、.sw-rule（1px 细分割线）、.sw-anchor（巨型数字/比例视觉锚点，如 03 / 20s→14s / 8:2）、.hl-mark（荧光笔涂抹高亮底色，包住关键短词）、.sw-grid（开放式无边框双栏，子项用 .sw-cell）、.sw-note（底部浅色便签批注条，带左侧强调色竖线）。',
      '- 视觉要求：每页只保留 1 个超大 .sw-anchor 或巨型标题作为第一视觉焦点，其余条目用开放式细线排版，配合 1–2 处 .hl-mark 荧光笔高亮或内联 SVG 椭圆圈画；绝不堆砌圆角白卡片。',
      '- 结构范例：<div class="cd-main"><div class="sw-anchor">03</div><h2 class="cd-title">只填 <span class="hl-mark">3 项</span> 就能跑</h2><hr class="sw-heavy-rule" /><div class="sw-grid"><div class="sw-cell">...</div></div><div class="sw-note">实测批注…</div></div>',
      '- 防溢出红线：保持大幅呼吸留白，底部预留 ≥ 64px 安全区，严禁正文压住页脚。',
    ].join('\n'),
  },
  {
    id: 'monocle',
    name: 'Monocle 日系深度杂志',
    pattern: /monocle|知日|日系.*杂志|暖纸/i,
    guidance: [
      '# 内置风格原语包（Monocle 日系深度杂志，优先复用以减少 CSS 体积）',
      '- 可直接使用的内置类：.mo-issue-bar（极细等宽刊号顶栏）、.mo-giant-num（右上角超大淡色衬线页码，如 01–07）、.mo-body-with-rail（左侧竖排眉批 .mo-rail + 右侧主内容区）、.mo-split（不对称 1:2 编辑部双栏）、.mo-hairline-item（无边框上下细线条目）、.mo-letter-end（浅暖纸编者按/书信尾页容器）。',
      '- 视觉要求：大面积暖纸留白、粗细反差强烈的衬线标题 + 清爽无衬线正文，用 1px 细分割线和 .mo-giant-num 取代方框；尾页用 .mo-letter-end 浅色收尾，绝不用黑底。',
      '- 防溢出红线：单页留白占比 ≥ 30%，底部预留 ≥ 64px 安全区，严禁文字贴边或重叠页脚。',
    ].join('\n'),
  },
  {
    id: 'manual',
    name: '工业工具说明书',
    pattern: /工业.*说明书|工具说明书|规格参数/i,
    guidance: [
      '# 内置风格原语包（工业工具说明书，优先复用以减少 CSS 体积）',
      '- 可直接使用的内置类：.ind-tag（深色规格标签如 UNIT 01）、.ind-tag-accent（主色标签）、.ind-tag-tint（浅底标签）、.ind-giant-num（巨型工业编号如 01 / 01.B / 2.0 / 80%）、.ind-io-bar（深色三栏 INPUT / PROCESS / OUTPUT 规格条）、.ind-spec-row（细线规格参数行）、.ind-tear-note（底部虚线撕纸备忘条）。',
      '- 视觉要求：顶部用 .ind-tag + 等宽编号拉齐说明书秩序感，中部用 .ind-giant-num + .ind-io-bar 建立工程可读性，信息精简避免小字拥挤。',
      '- 防溢出红线：正文清晰易读（≥ 22px），底部预留 ≥ 64px 安全区，严禁内容溢出页脚。',
    ].join('\n'),
  },
  {
    id: 'notebook',
    name: '红笔手账备课本',
    pattern: /手账|备课本|红笔.*批注|笔记线条/i,
    guidance: [
      '# 内置风格原语包（红笔手账备课本，优先复用以减少 CSS 体积）',
      '- 可直接使用的内置类：.nb-paper（横线笔记本底纹 + 左侧装订竖线，套在主容器上）、.nb-margin-tag（笔记本页眉小标签）、.nb-stamp（双线印章角标）、.nb-tape-note（微倾提醒便签贴纸）、.nb-highlight（手账荧光笔底纹）、.nb-check-item（☑ 勾选清单行）。',
      '- 视觉要求：以开放式横线纸面排版为主，用 .nb-tape-note 微倾便签与 1–2 处内联 SVG 手绘圈画制造重点批注感，绝不用死板四宫格方框；尾页用浅色手账归档 + 勾选清单收尾。',
      '- 防溢出红线：预留左侧装订边距与底部 ≥ 64px 安全区，严禁便签遮挡正文或页脚。',
    ].join('\n'),
  },
]

export function resolveXhsStyleKit(designPrompt = '', artDirection = null) {
  const haystack = [
    String(designPrompt || ''),
    String(artDirection?.genre || ''),
    String(artDirection?.visualLanguage || ''),
  ].filter(Boolean).join(' ')
  if (!haystack) return null
  return XHS_STYLE_KITS.find(kit => kit.pattern.test(haystack)) ?? null
}

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runPreflight } from '../src/preflight.js'

const PROMO_URL = ['https:/', 'promo.example', 'pro'].join('/')
const COMP_URL = ['https:/', 'competitor-x.example', 'compare'].join('/')

test('商单必带文本：可见段落命中则通过，仅出现在围栏代码块或行内代码中仍报缺失', () => {
  const brief = {
    partner: 'Cursor',
    mustInclude: ['14天Pro兑换码'],
    taboo: [],
  }

  // 可见段落中出现（含大小写不敏感匹配）→ 通过
  const passRes = runPreflight(
    {
      title: 'Cursor 实测体验',
      blocks: [
        { id: 'b1', text: '文末领取 14天pro兑换码 即可开启体验。' },
      ],
    },
    { sponsoredBrief: brief },
  )
  assert.equal(passRes.ok, true)
  assert.equal(passRes.items.filter(i => i.id === 'sponsored-must-include').length, 0)

  // 仅出现在标题中 → 也算可见正文，通过
  const titlePass = runPreflight(
    {
      title: '实测分享：附 14天Pro兑换码',
      blocks: [{ id: 'b1', text: '正文简短清晰。' }],
    },
    { sponsoredBrief: brief },
  )
  assert.equal(titlePass.ok, true)
  assert.equal(titlePass.items.filter(i => i.id === 'sponsored-must-include').length, 0)

  // 仅出现在围栏代码块中 → 报缺失
  const fenceMiss = runPreflight(
    {
      title: 'Cursor 实测体验',
      blocks: [
        { id: 'b1', text: '```txt\n14天Pro兑换码\n```' },
        { id: 'b2', text: '正文里其实忘了写兑换码。' },
      ],
    },
    { sponsoredBrief: brief },
  )
  assert.equal(fenceMiss.ok, true, '商单提醒永远不把 preflight.ok 置为 false')
  const fenceItems = fenceMiss.items.filter(i => i.id === 'sponsored-must-include')
  assert.equal(fenceItems.length, 1)
  assert.equal(fenceItems[0].severity, 'warn')
  assert.equal(fenceItems[0].category, 'sponsored')
  assert.deepEqual(fenceItems[0].matches, ['14天Pro兑换码'])

  // 仅出现在行内代码中 → 报缺失
  const inlineMiss = runPreflight(
    {
      title: 'Cursor 实测体验',
      blocks: [
        { id: 'b1', text: '示例代码里写了 `14天Pro兑换码`，但正文没有说明。' },
      ],
    },
    { sponsoredBrief: brief },
  )
  assert.equal(inlineMiss.ok, true)
  const inlineItems = inlineMiss.items.filter(i => i.id === 'sponsored-must-include')
  assert.equal(inlineItems.length, 1)
  assert.equal(inlineItems[0].severity, 'warn')
  assert.equal(inlineItems[0].category, 'sponsored')
})

test('商单必带链接：Markdown 链接经 extractLinks 命中，域名路径片段可命中，图片 URL 不算命中', () => {
  const briefUrl = {
    partner: 'Cursor',
    mustInclude: [PROMO_URL],
    taboo: [],
  }

  // Markdown 链接 [立即试用](https://promo.example/pro) 命中（即使 plainOf 会剥离 URL）
  const mdLinkPass = runPreflight(
    {
      title: '工具评测',
      blocks: [
        { id: 'b1', text: `点击 [立即试用](${PROMO_URL}) 获取限时权益。` },
      ],
    },
    { sponsoredBrief: briefUrl },
  )
  assert.equal(mdLinkPass.ok, true)
  assert.equal(mdLinkPass.items.filter(i => i.id === 'sponsored-must-include').length, 0)

  // 域名路径片段（不带协议）也能匹配真实链接
  const domainPass = runPreflight(
    {
      title: '工具评测',
      blocks: [
        { id: 'b1', text: `点击 [立即试用](${PROMO_URL}?ref=wechat) 体验。` },
      ],
    },
    { sponsoredBrief: { partner: 'Cursor', mustInclude: ['promo.example/pro'], taboo: [] } },
  )
  assert.equal(domainPass.ok, true)
  assert.equal(domainPass.items.filter(i => i.id === 'sponsored-must-include').length, 0)

  // 仅出现在图片 URL 中 → 不算命中，报缺失
  const imgMiss = runPreflight(
    {
      title: '工具评测',
      blocks: [
        { id: 'b1', text: `![活动海报](${PROMO_URL}.png)` },
      ],
    },
    { sponsoredBrief: briefUrl },
  )
  assert.equal(imgMiss.ok, true)
  const imgItems = imgMiss.items.filter(i => i.id === 'sponsored-must-include')
  assert.equal(imgItems.length, 1)
  assert.equal(imgItems[0].severity, 'warn')
  assert.equal(imgItems[0].category, 'sponsored')
  assert.deepEqual(imgItems[0].matches, [PROMO_URL])
})

test('商单禁忌词：命中可见正文或真实链接 URL 时报 sponsored-taboo 并附带精确 blockId/blockNumber；代码块/行内代码/图片 URL 不误报', () => {
  const brief = {
    partner: 'Cursor',
    mustInclude: [],
    taboo: ['全网最强', '竞品X', 'competitor-x.example'],
  }

  const res = runPreflight(
    {
      title: '客观体验报告',
      blocks: [
        { id: 'b1', text: '第一段完全合规。' },
        { id: 'b2', text: '第二段不小心写了全网最强，还提到了竞品x。' },
        { id: 'b3', text: `第三段带了禁忌外链 [参考对比](${COMP_URL})。` },
        { id: 'b4', text: '```md\n全网最强 竞品X\nhttps://competitor-x.example/code\n```' },
        { id: 'b5', text: '第五段在行内代码里写 `全网最强` 和 `竞品X`，不应误报。' },
        { id: 'b6', text: `![对比图](${COMP_URL}.png)` },
      ],
    },
    { sponsoredBrief: brief },
  )

  assert.equal(res.ok, true, '商单禁忌只报 warn，不阻断发布')
  assert.equal(res.counts.blocking, 0)

  const tabooItems = res.items.filter(i => i.id === 'sponsored-taboo')
  assert.equal(tabooItems.length, 2)

  assert.equal(tabooItems[0].severity, 'warn')
  assert.equal(tabooItems[0].category, 'sponsored')
  assert.equal(tabooItems[0].blockId, 'b2')
  assert.equal(tabooItems[0].blockNumber, 2)
  assert.deepEqual(tabooItems[0].matches, ['全网最强', '竞品X'])

  assert.equal(tabooItems[1].severity, 'warn')
  assert.equal(tabooItems[1].category, 'sponsored')
  assert.equal(tabooItems[1].blockId, 'b3')
  assert.equal(tabooItems[1].blockNumber, 3)
  assert.deepEqual(tabooItems[1].matches, ['competitor-x.example'])
})

test('商单禁忌词命中标题时也产出 warn 且不阻断；sponsoredBrief 为 null 时零额外提醒', () => {
  const titleHit = runPreflight(
    {
      title: '全网最强编辑器横评',
      blocks: [{ id: 'b1', text: '正文平和客观。' }],
    },
    { sponsoredBrief: { partner: 'Cursor', mustInclude: [], taboo: ['全网最强'] } },
  )
  assert.equal(titleHit.ok, true)
  const tabooItems = titleHit.items.filter(i => i.id === 'sponsored-taboo')
  assert.equal(tabooItems.length, 1)
  assert.equal(tabooItems[0].severity, 'warn')
  assert.equal(tabooItems[0].category, 'sponsored')
  assert.equal(tabooItems[0].blockId, null)
  assert.equal(tabooItems[0].blockNumber, null)
  assert.deepEqual(tabooItems[0].matches, ['全网最强'])

  const noBrief = runPreflight(
    {
      title: '全网最强编辑器横评',
      blocks: [{ id: 'b1', text: '正文平和客观。' }],
    },
    { sponsoredBrief: null },
  )
  assert.equal(noBrief.ok, true)
  assert.equal(noBrief.items.filter(i => i.category === 'sponsored').length, 0)
})

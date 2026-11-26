import assert from 'node:assert/strict'
import { test } from 'node:test'
import { diffInline, tokenizeForDiff } from '../client/text-diff.js'

test('tokenizeForDiff：中文按单字、英文/数字按词切分', () => {
  assert.deepEqual(tokenizeForDiff('用 Claude 3.5 写稿'), ['用', ' ', 'Claude', ' ', '3', '.', '5', ' ', '写', '稿'])
  assert.deepEqual(tokenizeForDiff(''), [])
})

test('diffInline：完全相同文本不标记增删', () => {
  const res = diffInline('这段文字没变', '这段文字没变')
  assert.equal(res.added, 0)
  assert.equal(res.removed, 0)
  assert.deepEqual(res.before, [{ kind: 'same', text: '这段文字没变' }])
  assert.deepEqual(res.after, [{ kind: 'same', text: '这段文字没变' }])
})

test('diffInline：精准标出中文局部改写与英文整词替换', () => {
  const res = diffInline('我们用 GPT4 写了一篇很长的文章。', '我们用 Claude 写了一篇精炼的文章。')
  assert.equal(res.before.map(p => p.text).join(''), '我们用 GPT4 写了一篇很长的文章。')
  assert.equal(res.after.map(p => p.text).join(''), '我们用 Claude 写了一篇精炼的文章。')
  assert.deepEqual(
    res.before.filter(p => p.kind === 'del').map(p => p.text),
    ['GPT4', '很长'],
  )
  assert.deepEqual(
    res.after.filter(p => p.kind === 'ins').map(p => p.text),
    ['Claude', '精炼'],
  )
  assert.equal(res.removed, 6)
  assert.equal(res.added, 8)
})

test('diffInline：纯新增或纯删除正常工作', () => {
  const ins = diffInline('', '新加内容')
  assert.equal(ins.added, 4)
  assert.equal(ins.removed, 0)
  assert.deepEqual(ins.before, [])
  assert.deepEqual(ins.after, [{ kind: 'ins', text: '新加内容' }])

  const del = diffInline('旧内容', '')
  assert.equal(del.added, 0)
  assert.equal(del.removed, 3)
  assert.deepEqual(del.before, [{ kind: 'del', text: '旧内容' }])
  assert.deepEqual(del.after, [])
})

test('diffInline：超长文本超过 LCS 阈值时平滑退化并保持文本完整', () => {
  const longA = '甲'.repeat(500) + '旧尾'
  const longB = '乙'.repeat(500) + '新尾'
  const res = diffInline(longA, longB)
  assert.equal(res.before.map(p => p.text).join(''), longA)
  assert.equal(res.after.map(p => p.text).join(''), longB)
  assert.equal(res.removed, 501)
  assert.equal(res.added, 501)
})

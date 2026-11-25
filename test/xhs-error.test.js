import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  dismissXhsError,
  getState,
  resetXhsErrorDismissal,
  setState,
  visibleXhsError,
} from '../client/state.js'

test('小红书错误关闭或离开面板后保持隐藏，重新生成可恢复提示', () => {
  const article = { id: 'article-1', xhsError: '模型没有返回可解析的 JSON。' }
  setState({ data: { current: article, articles: [article] }, dismissedXhsErrors: {} })

  assert.equal(visibleXhsError(article, getState().dismissedXhsErrors), article.xhsError)

  dismissXhsError(article.id, article.xhsError)
  assert.equal(visibleXhsError({ ...article }, getState().dismissedXhsErrors), null)

  const nextError = { ...article, xhsError: '网络请求失败' }
  assert.equal(visibleXhsError(nextError, getState().dismissedXhsErrors), nextError.xhsError)

  resetXhsErrorDismissal(article.id)
  assert.equal(visibleXhsError(article, getState().dismissedXhsErrors), article.xhsError)
})

test('关闭一篇稿件的小红书错误不影响其他稿件', () => {
  const first = { id: 'article-1', xhsError: '第一篇失败' }
  const second = { id: 'article-2', xhsError: '第二篇失败' }
  setState({ data: { current: first, articles: [first, second] }, dismissedXhsErrors: {} })

  dismissXhsError(first.id, first.xhsError)

  assert.equal(visibleXhsError(first, getState().dismissedXhsErrors), null)
  assert.equal(visibleXhsError(second, getState().dismissedXhsErrors), second.xhsError)
})

test('切到另一篇后，旧文章 cleanup 可用退出前的错误文本关闭提示', () => {
  const first = { id: 'article-1', xhsError: '第一篇退出前的错误' }
  const second = { id: 'article-2', xhsError: '第二篇错误' }
  const articles = [{ id: first.id }, { id: second.id }]
  setState({ data: { current: first, articles }, dismissedXhsErrors: {} })

  const cleanup = () => dismissXhsError(first.id, first.xhsError)
  setState({ data: { current: second, articles } })
  cleanup()
  assert.equal(visibleXhsError(second, getState().dismissedXhsErrors), second.xhsError)

  setState({ data: { current: { ...first }, articles } })
  assert.equal(visibleXhsError(getState().data.current, getState().dismissedXhsErrors), null)
  assert.equal(visibleXhsError({ ...first, xhsError: '后来发生的新错误' }, getState().dismissedXhsErrors), '后来发生的新错误')
})

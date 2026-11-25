import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('motion CSS 定义统一曲线节奏令牌与全局 prefers-reduced-motion 降级', async () => {
  const css = await readFile(new URL('../client/styles.css', import.meta.url), 'utf8')
  for (const token of ['--ease-out:', '--ease-in-out:', '--ease-exit:', '--ease-spring:', '--ease-press:', '--dur-instant:', '--dur-fast:', '--dur-base:', '--dur-slow:', '--dur-exit:']) {
    assert.ok(css.includes(token), `styles.css 应定义动效令牌 ${token}`)
  }
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*animation-duration:\s*\.01ms\s*!important/)
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*transition-duration:\s*\.01ms\s*!important/)
  assert.doesNotMatch(css, /background-position:\s*100%\s*50%/, '骨架屏不应通过 background-position 触发每帧重绘')
})

test('client/motion.jsx 纯函数与缓动边界正确且不依赖宿主外运行时', async () => {
  const src = await readFile(new URL('../client/motion.jsx', import.meta.url), 'utf8')
  assert.ok(src.includes('prefers-reduced-motion: reduce'))
  assert.ok(src.includes('usePresence'))
  assert.ok(src.includes('useDialogClose'))
  assert.ok(src.includes('useSlidingIndicator'))
  assert.ok(src.includes('SlidingTabs'))
  assert.ok(src.includes('AnimatedNumber'))
  assert.ok(src.includes('animateValues'))
  assert.ok(src.includes('cancelAnimationFrame'))
})

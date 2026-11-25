// 统一动效基元：一套节奏与物理语言，全部可打断、尊重 prefers-reduced-motion、无额外运行时依赖。
import React from 'react'

export const MOTION_EXIT_MS = 160
export const MOTION_CANVAS_MS = 240

export function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function scrollBehavior() {
  return prefersReducedMotion() ? 'auto' : 'smooth'
}

export function easeOutCubic(t) {
  const inv = 1 - Math.max(0, Math.min(1, t))
  return 1 - inv * inv * inv
}

export function easeOutQuart(t) {
  const inv = 1 - Math.max(0, Math.min(1, t))
  return 1 - inv * inv * inv * inv
}

/**
 * 可打断的出现/消失生命周期。
 * 重新打开时立即取消正在进行的退场计时，从当前状态自然接上。
 */
export function usePresence(open, exitMs = MOTION_EXIT_MS) {
  const [mounted, setMounted] = React.useState(Boolean(open))
  const [closing, setClosing] = React.useState(false)
  const timerRef = React.useRef(null)

  React.useEffect(() => {
    clearTimeout(timerRef.current)
    timerRef.current = null
    if (open) {
      setMounted(true)
      setClosing(false)
      return undefined
    }
    if (!mounted) return undefined
    if (prefersReducedMotion() || exitMs <= 0) {
      setMounted(false)
      setClosing(false)
      return undefined
    }
    setClosing(true)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      setMounted(false)
      setClosing(false)
    }, exitMs)
    return () => {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [open, exitMs, mounted])

  return { mounted, closing }
}

/**
 * 保留上一次非空值直至退场动画结束，避免 Toast / 弹层 / 弹窗消失前内容瞬间清空。
 */
export function usePresenceValue(value, exitMs = MOTION_EXIT_MS) {
  const present = value !== null && value !== undefined && value !== false
  const { mounted, closing } = usePresence(present, exitMs)
  const latestRef = React.useRef(value)
  if (present) latestRef.current = value
  return {
    mounted,
    closing,
    value: present ? value : (mounted ? latestRef.current : null),
  }
}

/**
 * 原生 <dialog> 的统一关闭退场：添加 is-closing 类，动画结束后再真正调用 onClose。
 */
export function useDialogClose(onClose, exitMs = MOTION_EXIT_MS) {
  const [closing, setClosing] = React.useState(false)
  const onCloseRef = React.useRef(onClose)
  const timerRef = React.useRef(null)
  onCloseRef.current = onClose

  React.useEffect(() => () => {
    clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const requestClose = React.useCallback(() => {
    if (timerRef.current) return
    if (prefersReducedMotion() || exitMs <= 0) {
      onCloseRef.current?.()
      return
    }
    setClosing(true)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      onCloseRef.current?.()
    }, exitMs)
  }, [exitMs])

  return { closing, requestClose }
}

/**
 * 追踪顺序型切换的方向（前进一步 +1，后退一步 -1），用于步骤、周历、灯箱、标签页的方向感转场。
 */
export function useDirection(value) {
  const prevRef = React.useRef(value)
  const dirRef = React.useRef(0)
  if (prevRef.current !== value) {
    if (typeof value === 'number' && typeof prevRef.current === 'number') {
      dirRef.current = value > prevRef.current ? 1 : -1
    } else {
      dirRef.current = String(value) > String(prevRef.current) ? 1 : -1
    }
    prevRef.current = value
  }
  return dirRef.current
}

const DEFAULT_ACTIVE_SELECTOR = '.is-on, [aria-selected="true"], [aria-checked="true"], [aria-current="page"], [aria-current="true"], [aria-pressed="true"], label:has(> input:checked)'

/**
 * 苹果式滑动选中指示器：测量当前激活项位置并驱动单个 GPU 合成滑块。
 * 首次挂载同步落位（无飞入闪烁），后续切换丝滑跟随且可随时打断。
 */
export function useSlidingIndicator(activeKey, { selector = DEFAULT_ACTIVE_SELECTOR, mode = 'pill', underlineOffset = 0 } = {}) {
  const containerRef = React.useRef(null)
  const hasMeasuredRef = React.useRef(false)
  const [rect, setRect] = React.useState(null)
  const [animate, setAnimate] = React.useState(false)

  const measure = React.useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const target = container.querySelector(selector)
    if (!target) {
      setRect(null)
      return
    }
    const next = mode === 'underline'
      ? {
        x: target.offsetLeft,
        y: target.offsetTop + target.offsetHeight + underlineOffset,
        w: target.offsetWidth,
        h: 2,
      }
      : {
        x: target.offsetLeft,
        y: target.offsetTop,
        w: target.offsetWidth,
        h: target.offsetHeight,
      }
    if (next.w <= 0 || next.h <= 0) return
    setRect(prev => {
      if (prev && prev.x === next.x && prev.y === next.y && prev.w === next.w && prev.h === next.h) {
        return prev
      }
      return next
    })
    if (hasMeasuredRef.current) {
      setAnimate(true)
    } else {
      hasMeasuredRef.current = true
      requestAnimationFrame(() => setAnimate(true))
    }
  }, [selector, mode, underlineOffset])

  React.useLayoutEffect(() => {
    measure()
    const container = containerRef.current
    if (!container || typeof ResizeObserver !== 'function') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    for (const child of container.children) {
      if (!child.dataset?.wsThumb) observer.observe(child)
    }
    let cancelled = false
    document.fonts?.ready?.then(() => {
      if (!cancelled) measure()
    }).catch(() => {})
    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [activeKey, measure])

  const style = rect
    ? {
      width: `${rect.w}px`,
      height: `${rect.h}px`,
      transform: `translate3d(${rect.x}px, ${rect.y}px, 0)`,
      opacity: 1,
    }
    : { opacity: 0 }

  return {
    containerRef,
    hasThumb: Boolean(rect),
    thumbProps: {
      'aria-hidden': 'true',
      'data-ws-thumb': '1',
      className: `ws-seg-thumb${animate ? ' is-ready' : ''}`,
      style,
    },
  }
}

/**
 * 通用滑动胶囊/下划线容器，可直接包住现有 .ws-tabs / .ws-dh-tabs / .ws-cover-segments / .ws-cd-tabs / .ws-cd-seg。
 */
export function SlidingTabs({
  as: Tag = 'div',
  activeKey,
  className = '',
  thumbClassName = '',
  selector,
  mode = 'pill',
  underlineOffset = 0,
  children,
  ...rest
}) {
  const { containerRef, hasThumb, thumbProps } = useSlidingIndicator(activeKey, { selector, mode, underlineOffset })
  return (
    <Tag
      ref={containerRef}
      className={`ws-seg-host${hasThumb ? ' has-thumb' : ''}${className ? ` ${className}` : ''}`}
      {...rest}
    >
      <span
        {...thumbProps}
        className={`${thumbProps.className}${thumbClassName ? ` ${thumbClassName}` : ''}`}
      />
      {children}
    </Tag>
  )
}

/**
 * 数值平滑滚动：仅在挂载后数值真正变化时触发，240ms 快速减速收尾，可随时打断。
 * 自动使用 tabular-nums 防横向抖动，reduced-motion 下直接显示目标值。
 */
export function AnimatedNumber({ value, format, duration = 260, className }) {
  const numeric = typeof value === 'number' && Number.isFinite(value)
  const [display, setDisplay] = React.useState(value)
  const currentRef = React.useRef(numeric ? value : 0)
  const mountedRef = React.useRef(false)
  const rafRef = React.useRef(0)

  React.useEffect(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = 0
    if (!numeric) {
      setDisplay(value)
      return undefined
    }
    if (!mountedRef.current || prefersReducedMotion() || duration <= 0) {
      mountedRef.current = true
      currentRef.current = value
      setDisplay(value)
      return undefined
    }
    const from = currentRef.current
    const to = value
    if (from === to) return undefined
    const isInt = Number.isInteger(from) && Number.isInteger(to)
    const start = performance.now()
    const step = now => {
      const progress = Math.min(1, (now - start) / duration)
      const eased = easeOutCubic(progress)
      const next = from + (to - from) * eased
      const snapped = progress >= 1 ? to : (isInt ? Math.round(next) : next)
      currentRef.current = snapped
      setDisplay(snapped)
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step)
      } else {
        rafRef.current = 0
      }
    }
    rafRef.current = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
  }, [value, numeric, duration])

  const formatted = format ? format(display) : String(display ?? '')
  return className ? <span className={className}>{formatted}</span> : formatted
}

/**
 * 通用可打断 rAF 数值插值器（供无限画布缩放/适配使用）。
 * 返回 cancel()，任意手势操作可即刻中断。
 */
export function animateValues({ from, to, duration = MOTION_CANVAS_MS, onUpdate, onComplete }) {
  if (prefersReducedMotion() || duration <= 0) {
    onUpdate(to, 1)
    onComplete?.(to)
    return () => {}
  }
  let rafId = 0
  let cancelled = false
  const keys = Object.keys(to)
  const start = performance.now()

  const tick = now => {
    if (cancelled) return
    const t = Math.min(1, (now - start) / duration)
    const eased = easeOutQuart(t)
    const frame = {}
    for (const key of keys) {
      const a = from[key]
      const b = to[key]
      frame[key] = a + (b - a) * eased
    }
    onUpdate(frame, t)
    if (t < 1) {
      rafId = requestAnimationFrame(tick)
    } else {
      rafId = 0
      onComplete?.(to)
    }
  }
  rafId = requestAnimationFrame(tick)
  return () => {
    cancelled = true
    if (rafId) {
      cancelAnimationFrame(rafId)
      rafId = 0
    }
  }
}

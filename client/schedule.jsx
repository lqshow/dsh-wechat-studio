// 排期页：左边待排坞，右边周历，拖拽即排期。公众号发布是手动的，这里只管排哪天、够不够格发、发完标记。
import React from 'react'
import { act, setState, toast, useStudio } from './state.js'
import { addDays, atOn, dayKey, isOverdue, mondayOf, parseDay } from '../src/schedule-time.js'
import { AnimatedNumber, scrollBehavior, SlidingTabs, useDialogClose, useDirection, usePresence } from './motion.jsx'
import { ScheduleAgenda } from './schedule-agenda.jsx'
import { CoverThumb, dateLabel, Icon, inputTime, openDraft, pad, pubSlot, ReadinessRing, timeLabel, weekdayName } from './schedule-shared.jsx'

const SLOTS = [
  { id: 'morning', label: '早 8 点', hour: 8 },
  { id: 'noon', label: '午 12 点', hour: 12 },
  { id: 'evening', label: '晚 8 点', hour: 20 },
  { id: 'custom', label: '自定义', hour: null },
]
const zoneLabel = date => {
  const offset = -date.getTimezoneOffset()
  const sign = offset < 0 ? '-' : '+'
  const minutes = Math.abs(offset)
  return `${Intl.DateTimeFormat().resolvedOptions().timeZone}（UTC${sign}${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}）`
}
const slotOf = iso => { const d = new Date(iso); return SLOTS.find(s => s.hour === d.getHours() && d.getMinutes() === 0) ?? SLOTS[3] }
function DockCard({ draft, dragging, onPick, onDragStart, onDragEnd }) {
  const missing = draft.readiness.total - draft.readiness.done
  return (
    <article className={`ws-sched-card${dragging ? ' is-dragging' : ''}`} draggable onDragStart={e => onDragStart(e, draft)} onDragEnd={onDragEnd}>
      <div className="ws-sched-card-top">
        <CoverThumb draft={draft} />
        <div className="ws-sched-card-copy">
          <button type="button" className="ws-sched-card-title" onClick={() => openDraft(draft)}>{draft.title}</button>
          <span className="ws-muted ws-small">{draft.chars} 字</span>
        </div>
        <ReadinessRing readiness={draft.readiness} />
      </div>
      <div className="ws-sched-card-foot">
        <span className="ws-muted ws-small">{missing ? `还差 ${missing} 项` : '就绪'}</span>
        <button type="button" className="ws-link" onClick={() => onPick(draft)}>排期</button>
      </div>
    </article>
  )
}

function ReadinessDetails({ readiness }) {
  return (
    <details className="ws-sched-readiness">
      <summary aria-label={`查看就绪项目，已完成 ${readiness.done}/${readiness.total}`}><ReadinessRing readiness={readiness} size={18} /></summary>
      <div className="ws-sched-readiness-list">
        <strong>就绪 {readiness.done}/{readiness.total}</strong>
        {readiness.items.map(item => <span key={item.id} className={item.done ? '' : 'is-missing'}>{item.label} · {item.done ? '已完成' : '未完成'}</span>)}
      </div>
    </details>
  )
}

function CardMenu({ children }) {
  return <details className="ws-sched-card-menu"><summary>更多</summary><div>{children}</div></details>
}

function ScheduledCard({ draft, now, dragging, located, onPick, onUnschedule, onPublish, onDragStart, onDragEnd }) {
  const missing = draft.readiness.items.filter(i => !i.done)
  const overdue = isOverdue(draft.scheduledFor, now)
  return (
    <article id={`ws-sched-entry-${draft.id}`} tabIndex={-1} className={`ws-sched-entry ${overdue ? 'is-overdue' : ''} ${missing.length ? 'is-notready' : ''} ${dragging ? 'is-dragging' : ''} ${located ? 'is-locate-pulse' : ''}`} draggable onDragStart={e => onDragStart(e, draft)} onDragEnd={onDragEnd}>
      <div className="ws-sched-entry-head">
        <span className="ws-sched-time">{timeLabel(draft.scheduledFor)}</span>
        <div className="ws-sched-entry-status">{overdue ? <span className="ws-sched-overdue">过点</span> : null}<ReadinessDetails readiness={draft.readiness} /></div>
      </div>
      <button type="button" className="ws-sched-entry-title" onClick={() => openDraft(draft)}>{draft.title}</button>
      <div className="ws-sched-entry-actions">
        <button type="button" className="ws-link" onClick={() => onPublish(draft)}>标记已发</button>
        <CardMenu><button type="button" className="ws-link" onClick={() => onPick(draft)}>改期</button><button type="button" className="ws-link" onClick={() => onUnschedule(draft)}>取消排期</button></CardMenu>
      </div>
    </article>
  )
}

function PublishedCard({ draft, located, onCorrect, onUnpublish }) {
  const planned = draft.scheduledFor
  const actual = draft.publishedAt
  const crossDay = planned && dayKey(new Date(planned)) !== dayKey(new Date(actual))
  return (
    <article id={`ws-sched-entry-${draft.id}`} tabIndex={-1} className={`ws-sched-entry is-published${located ? ' is-locate-pulse' : ''}`}>
      <div className="ws-sched-entry-head">
        <span className="ws-sched-time">{planned ? `${crossDay ? `${dateLabel(planned)} ` : ''}${timeLabel(planned)}` : timeLabel(actual)}</span>
        <span className="ws-sched-published-tag" role="img" aria-label="已发" title="已发"><Icon name="check" size={11} /></span>
      </div>
      <button type="button" className="ws-sched-entry-title" onClick={() => openDraft(draft)}>{draft.title}</button>
      {draft.publishMarkedAt ? <>
        <span className="ws-sched-published-at">实际发表 {crossDay || !planned ? `${dateLabel(actual)} ` : ''}{timeLabel(actual)}</span>
        <span className="ws-sched-marked-at">记录于 {dateLabel(draft.publishMarkedAt)} {timeLabel(draft.publishMarkedAt)}</span>
      </> : <span className="ws-sched-marked-at">实际发表时间未确认 · 标记于 {dateLabel(actual)} {timeLabel(actual)}</span>}
      <div className="ws-sched-entry-actions">
        <button type="button" className="ws-link" onClick={() => onCorrect(draft)}>更正发表时间</button>
        <CardMenu><button type="button" className="ws-link" onClick={() => onUnpublish(draft)}>撤销标记</button></CardMenu>
      </div>
    </article>
  )
}

function ScheduleModal({ label, onClose, onSubmit, returnFocusId, children }) {
  const modal = React.useRef(null)
  const returnFocusRef = React.useRef(returnFocusId)
  returnFocusRef.current = returnFocusId
  const { closing, requestClose } = useDialogClose(onClose)
  React.useEffect(() => {
    const previous = document.activeElement
    const dialog = modal.current
    dialog.showModal()
    dialog.querySelector('[data-autofocus]')?.focus()
    return () => {
      if (dialog.open) dialog.close()
      if (previous?.isConnected) previous.focus({ preventScroll: true })
      else (document.getElementById(`ws-sched-entry-${returnFocusRef.current}`) ?? document.querySelector('.ws-sched-notice button'))?.focus({ preventScroll: true })
    }
  }, [])
  return <dialog ref={modal} className={`ws-dialog ws-sched-picker${closing ? ' is-closing' : ''}`} aria-label={label}
    onCancel={event => { event.preventDefault(); requestClose() }}
    onClick={event => {
      if (event.target !== event.currentTarget) return
      const bounds = event.currentTarget.getBoundingClientRect()
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) requestClose()
    }}>
    <form onSubmit={onSubmit}>{typeof children === 'function' ? children(requestClose) : children}</form>
  </dialog>
}

function DraftSelect({ dock, id, onChange }) {
  const listId = React.useId()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [active, setActive] = React.useState(0)
  const rootRef = React.useRef(null)
  const listRef = React.useRef(null)
  const chosen = dock.find(a => a.id === id)
  const normalized = query.trim().toLocaleLowerCase()
  const results = dock.filter(a => !normalized || a.title.toLocaleLowerCase().includes(normalized))
  const resultKey = results.map(a => a.id).join('\u0001')
  React.useEffect(() => { setActive(0) }, [query, resultKey])
  React.useEffect(() => {
    if (!open) return
    const onDown = event => { if (!rootRef.current?.contains(event.target)) setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])
  React.useEffect(() => {
    if (open) listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [open, active, resultKey])
  const pick = draft => { onChange(draft.id); setQuery(''); setOpen(false) }
  const { mounted: listMounted, closing: listClosing } = usePresence(open)
  const onKeyDown = event => {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      if (!open) setOpen(true)
      if (event.key === 'Home') setActive(0)
      else if (event.key === 'End') setActive(Math.max(0, results.length - 1))
      else setActive(index => Math.min(Math.max(0, results.length - 1), Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1))))
    } else if (event.key === 'Enter') {
      if (open && results[active]) { event.preventDefault(); pick(results[active]) }
      else if (!open) { event.preventDefault(); setOpen(true) }
    } else if (event.key === 'Tab') setOpen(false)
  }
  return (
    <div className="ws-sched-choose" ref={rootRef}>
      <input className="ws-sched-choose-input" role="combobox" aria-label="搜索并选择待排稿件" aria-autocomplete="list"
        aria-expanded={open} aria-controls={listId} aria-activedescendant={open && results[active] ? `${listId}-${results[active].id}` : undefined}
        value={open ? query : chosen?.title ?? ''} placeholder={dock.length ? '输入标题搜索' : '没有待排稿件'} disabled={!dock.length} data-autofocus
        onFocus={() => { setQuery(''); setOpen(true) }} onClick={() => { if (!open) { setQuery(''); setOpen(true) } }}
        onChange={event => { onChange(''); setQuery(event.target.value); setOpen(true) }} onKeyDown={onKeyDown} />
      <Icon name="chevron" size={14} />
      {listMounted ? (
        <ul className={`ws-sched-choose-list${listClosing ? ' is-closing' : ''}`} id={listId} role="listbox" aria-label="稿件搜索结果" ref={listRef}>
          {results.map((draft, index) => (
            <li key={draft.id} id={`${listId}-${draft.id}`} role="option" aria-selected={draft.id === id} data-active={index === active}
              className={`ws-sched-choose-opt ${draft.id === id ? 'is-on' : ''}`} title={draft.title}
              onPointerDown={event => event.preventDefault()} onPointerMove={() => setActive(index)} onClick={() => pick(draft)}>
              <span className="ws-sched-choose-mark">{draft.id === id ? <Icon name="check" size={13} /> : null}</span>
              <span className="ws-sched-choose-text">{draft.title}</span>
            </li>
          ))}
          {!results.length ? <li className="ws-sched-choose-empty">没有匹配的待排稿件</li> : null}
        </ul>
      ) : null}
    </div>
  )
}

function SchedulePicker({ data, picker, onClose, onSave, onSaved }) {
  const dock = data.articles.filter(a => !a.archivedAt && !a.publishedAt && !a.scheduledFor)
  const [id, setId] = React.useState(picker.id ?? dock[0]?.id ?? '')
  const [day, setDay] = React.useState(picker.day)
  const [selectionMessage, setSelectionMessage] = React.useState('')
  const chosen = data.articles.find(a => a.id === id)
  const dockKey = dock.map(a => a.id).join('\u0001')
  React.useEffect(() => {
    if (picker.id && (!chosen || chosen.archivedAt || chosen.publishedAt)) {
      setSelectionMessage('这篇稿件已归档或已发，不能继续改期。')
    } else if (!picker.id && id && !dock.some(a => a.id === id)) {
      setId('')
      setSelectionMessage('所选稿件已归档或已排期，请重新选择。')
    }
  }, [id, picker.id, chosen, dockKey, dock])
  const existing = chosen?.scheduledFor ? new Date(chosen.scheduledFor) : null
  const [slot, setSlot] = React.useState(existing ? slotOf(chosen.scheduledFor).id : 'evening')
  const [time, setTime] = React.useState(existing ? timeLabel(chosen.scheduledFor) : '20:00')
  const pending = useStudio(s => s.pending)
  let previewAt = null
  try {
    const hour = slot === 'custom' ? Number(time.split(':')[0]) : SLOTS.find(s => s.id === slot).hour
    const minute = slot === 'custom' ? Number(time.split(':')[1]) : 0
    previewAt = atOn(day, hour, minute)
  } catch {}
  const collision = previewAt && data.articles.some(a => a.id !== id && !a.archivedAt && !a.publishedAt && a.scheduledFor === previewAt)
  const submit = async event => {
    event.preventDefault()
    if (!id || !day || selectionMessage) return
    const hour = slot === 'custom' ? Number(time.split(':')[0]) : SLOTS.find(s => s.id === slot).hour
    const minute = slot === 'custom' ? Number(time.split(':')[1]) : 0
    let at
    try {
      at = atOn(day, hour, minute)
    } catch {
      return toast('请填写有效的本地时间，并避开夏令时切换时不存在的时刻', true)
    }
    if (await onSave(id, at)) {
      onSaved(id, at)
      onClose()
    }
  }
  return (
    <ScheduleModal label="安排发布时间" onClose={onClose} onSubmit={submit} returnFocusId={id}>
      {requestClose => <>
      <div className="ws-sched-picker-head">
        <h2>{chosen?.scheduledFor ? '改期' : '排一篇'}</h2>
        <button type="button" className="ws-icon-btn" aria-label="关闭" onClick={requestClose}><Icon name="close" /></button>
      </div>
      {picker.id ? <p className="ws-sched-picker-title">{chosen?.title}</p> : (
        <div className="ws-sched-field">选稿件
          <DraftSelect dock={dock} id={id} onChange={value => { setId(value); if (value) setSelectionMessage('') }} />
        </div>
      )}
      {selectionMessage ? <p className="ws-warn ws-small" role="alert">{selectionMessage}</p> : null}
      <label className="ws-sched-field">日期
        <input type="date" value={day} min="2000-01-01" max="2100-12-31" required data-autofocus={picker.id ? true : undefined} onChange={e => setDay(e.target.value)} />
      </label>
      <div className="ws-sched-slots" role="radiogroup" aria-label="时段">
        {SLOTS.map(s => <button key={s.id} type="button" role="radio" aria-checked={slot === s.id} className={slot === s.id ? 'is-on' : ''} onClick={() => setSlot(s.id)}>{s.label}</button>)}
      </div>
      {slot === 'custom' ? <label className="ws-sched-field">时间<input type="time" value={time} required onChange={e => setTime(e.target.value)} /></label> : null}
      {previewAt ? <p className="ws-sched-selection">已选时段：{dateLabel(previewAt)} {weekdayName(new Date(previewAt))} {timeLabel(previewAt)}</p> : null}
      {collision ? <p className="ws-warn ws-small">此时段已有安排，仍可继续排入。</p> : null}
      <div className="ws-sched-picker-actions">
        <button type="button" className="ws-btn" onClick={requestClose}>取消</button>
        <button type="submit" className="ws-btn is-primary" disabled={!id || !day || Boolean(pending) || Boolean(selectionMessage)}>排上日历</button>
      </div>
      </>}
    </ScheduleModal>
  )
}

function PublishDialog({ draft, now, onClose, onSave }) {
  const correcting = Boolean(draft.publishedAt)
  const legacy = correcting && !draft.publishMarkedAt
  const [value, setValue] = React.useState(() => inputTime(new Date(correcting ? draft.publishedAt : now)))
  const pending = useStudio(s => s.pending)
  const submit = async event => {
    event.preventDefault()
    const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(value)
    if (!match) return toast('请填写实际发表时间', true)
    let at
    try {
      at = atOn(match[1], Number(match[2]), Number(match[3]))
    } catch {
      return toast('请填写有效的本地发表时间', true)
    }
    if (new Date(at).getTime() > Date.now()) return toast('实际发表时间不能晚于现在', true)
    if (await onSave(draft, at)) onClose()
  }
  return (
    <ScheduleModal label={correcting ? '更正发表时间' : '标记已发'} onClose={onClose} onSubmit={submit} returnFocusId={draft.id}>
      {requestClose => <>
      <div className="ws-sched-picker-head">
        <h2>{correcting ? '更正发表时间' : '标记已发'}</h2>
        <button type="button" className="ws-icon-btn" aria-label="关闭" onClick={requestClose}><Icon name="close" /></button>
      </div>
      <p className="ws-sched-picker-title">{draft.title}</p>
      <label className="ws-sched-field">实际发表时间
        <input type="datetime-local" value={value} max={inputTime(new Date(now))} required data-autofocus onChange={e => setValue(e.target.value)} />
      </label>
      <p className="ws-muted ws-small">{legacy ? '旧记录只能确认标记时间，请填写这篇稿件的真实发表时间。' : '可补记过去的时间；这里记录的是实际发表时间，不是点击标记的时间。'}</p>
      <div className="ws-sched-picker-actions">
        <button type="button" className="ws-btn" onClick={requestClose}>取消</button>
        <button type="submit" className="ws-btn is-primary" disabled={Boolean(pending)}>{correcting ? '保存更正' : '记录已发'}</button>
      </div>
      </>}
    </ScheduleModal>
  )
}

export function ScheduleView({ data }) {
  const [now, setNow] = React.useState(() => Date.now())
  const [weekKey, setWeekKey] = React.useState(() => dayKey(mondayOf(new Date())))
  const [picker, setPicker] = React.useState(null)
  const [publishDraft, setPublishDraft] = React.useState(null)
  const [overDay, setOverDay] = React.useState(null)
  const [dockOver, setDockOver] = React.useState(false)
  const [draggingId, setDraggingId] = React.useState(null)
  const [dockExpanded, setDockExpanded] = React.useState(false)
  const [dockQuery, setDockQuery] = React.useState('')
  const [dockFilter, setDockFilter] = React.useState('all')
  const [scheduleNotice, setScheduleNotice] = React.useState(null)
  const [locateId, setLocateId] = React.useState(null)
  const [pulseId, setPulseId] = React.useState(null)
  const weekDir = useDirection(weekKey)
  const weekSlideClass = weekDir > 0 ? 'ws-slide-next' : weekDir < 0 ? 'ws-slide-prev' : ''
  const cardLocks = React.useRef(new Set())
  const pending = useStudio(s => s.pending)
  React.useEffect(() => {
    const update = () => setNow(Date.now())
    const visible = () => { if (document.visibilityState === 'visible') update() }
    const timer = setInterval(update, 30000)
    document.addEventListener('visibilitychange', visible)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', visible) }
  }, [])
  React.useEffect(() => {
    if (!locateId) return
    const card = document.getElementById(`ws-sched-entry-${locateId}`)
    if (!card) return
    card.scrollIntoView({ block: 'center', behavior: scrollBehavior() })
    card.focus({ preventScroll: true })
    setPulseId(locateId)
    setLocateId(null)
  }, [locateId, weekKey, data.articles])
  React.useEffect(() => {
    if (!pulseId) return undefined
    const timer = setTimeout(() => setPulseId(null), 950)
    return () => clearTimeout(timer)
  }, [pulseId])
  const today = new Date(now)
  const currentWeekKey = dayKey(mondayOf(today))
  const monday = parseDay(weekKey)
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i))
  const active = data.articles.filter(a => !a.archivedAt)
  const dock = active.filter(a => !a.scheduledFor && !a.publishedAt)
  const readyDock = dock.filter(a => a.readiness.done === a.readiness.total)
  const normalizedDockQuery = dockQuery.trim().toLocaleLowerCase()
  const visibleDock = dock.filter(a => (dockFilter === 'all' || a.readiness.done === a.readiness.total) && (!normalizedDockQuery || a.title.toLocaleLowerCase().includes(normalizedDockQuery)))
  const scheduled = active.filter(a => a.scheduledFor && !a.publishedAt)
  const published = active.filter(a => a.publishedAt)
  const weekStart = dayKey(days[0])
  const weekEnd = dayKey(days[6])
  const weekPublished = published.filter(a => { const k = dayKey(new Date(pubSlot(a))); return k >= weekStart && k <= weekEnd }).length
  const byDay = key => [...scheduled, ...published]
    .filter(a => dayKey(new Date(pubSlot(a))) === key)
    .sort((a, b) => new Date(pubSlot(a)) - new Date(pubSlot(b)) || a.id.localeCompare(b.id))
  const withCardLock = async (id, action) => {
    if (cardLocks.current.has(id)) return false
    cardLocks.current.add(id)
    try { return await action() } finally { cardLocks.current.delete(id) }
  }
  const saveSchedule = (id, at) => withCardLock(id, () => act('schedule/set', { id, at }))
  const notifySchedule = (id, at) => {
    const collision = scheduled.some(a => a.id !== id && a.scheduledFor === at)
    const text = `已排到 ${dateLabel(at)} ${weekdayName(new Date(at))} ${timeLabel(at)}${collision ? '；此时段已有安排，仍已保留' : ''}`
    const targetWeek = dayKey(mondayOf(new Date(at)))
    if (targetWeek === weekKey) { setScheduleNotice(null); toast(text) }
    else setScheduleNotice({ text, targetWeek })
  }
  const locate = draft => {
    setScheduleNotice(null)
    setWeekKey(dayKey(mondayOf(new Date(pubSlot(draft)))))
    setLocateId(draft.id)
  }
  const savePublication = (draft, at) => withCardLock(draft.id, async () => {
    const path = draft.publishedAt ? 'articles/correct-publish' : 'articles/publish'
    if (!await act(path, { id: draft.id, at })) return false
    toast('已记录发表时间')
    return true
  })
  const dragStart = (e, draft) => {
    e.dataTransfer.setData('text/plain', draft.id)
    e.dataTransfer.effectAllowed = 'move'
    setDraggingId(draft.id)
  }
  const dragEnd = () => { setOverDay(null); setDockOver(false); setDraggingId(null) }
  const dropOnDay = async (id, key) => {
    setOverDay(null)
    setDockOver(false)
    setDraggingId(null)
    const draft = active.find(a => a.id === id)
    if (!draft || draft.publishedAt || pending) return
    if (draft.scheduledFor && dayKey(new Date(draft.scheduledFor)) === key) return
    const old = draft.scheduledFor ? new Date(draft.scheduledFor) : null
    let at
    try {
      at = atOn(key, old ? old.getHours() : 20, old ? old.getMinutes() : 0)
    } catch {
      return toast('这个本地时刻不存在，请通过「改期」另选时间', true)
    }
    if (await saveSchedule(id, at)) notifySchedule(id, at)
  }
  const dropOnDock = async id => {
    setOverDay(null)
    setDockOver(false)
    setDraggingId(null)
    const draft = active.find(a => a.id === id)
    if (!draft?.scheduledFor || pending) return
    if (await withCardLock(id, () => act('schedule/clear', { id }))) toast('已移回待排')
  }
  const unschedule = draft => withCardLock(draft.id, async () => { if (await act('schedule/clear', { id: draft.id })) toast('已取消排期，回到待排') })
  const unpublishDraft = draft => withCardLock(draft.id, async () => { if (await act('articles/unpublish', { id: draft.id })) toast('已撤销发布标记') })
  const pickFor = draft => setPicker({ id: draft.id, day: draft.scheduledFor ? dayKey(new Date(draft.scheduledFor)) : dayKey(today) })
  const publish = draft => setPublishDraft(draft)
  return (
    <main className="ws-sched">
      <div className="ws-dh-shell">
        <header className="ws-dh-masthead">
          <div className="ws-dh-masthead-left">
            <span className="ws-dh-kicker">PUBLISH SCHEDULE · 发布日历</span>
            <div className="ws-dh-title-row">
              <h1>排期</h1>
              <p className="ws-dh-dateline">
                <span><b><AnimatedNumber value={dock.length} /></b> 篇待排</span>
                <span aria-hidden="true">·</span>
                <span>所选周已发 <b><AnimatedNumber value={weekPublished} /></b> 篇</span>
                <span aria-hidden="true">·</span>
                <span>{zoneLabel(today)}</span>
              </p>
            </div>
          </div>
          <div className="ws-sched-weeknav">
            <button type="button" className="ws-btn" onClick={() => setWeekKey(dayKey(addDays(monday, -7)))}>上一周</button>
            <button type="button" className="ws-btn" disabled={weekKey === currentWeekKey} onClick={() => setWeekKey(dayKey(mondayOf(new Date(now))))}>回到本周</button>
            <button type="button" className="ws-btn" onClick={() => setWeekKey(dayKey(addDays(monday, 7)))}>下一周</button>
            <span className="ws-muted ws-small">{days[0].getMonth() + 1} 月 {days[0].getDate()} 日 – {days[6].getMonth() + 1} 月 {days[6].getDate()} 日</span>
          </div>
        </header>
        <div className="ws-sched-body">
          <aside className={`ws-sched-dock ${dockExpanded ? 'is-expanded' : ''} ${dockOver ? 'is-over' : ''}`} aria-label="待排稿件"
            onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDockOver(true) }}
            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDockOver(false) }}
            onDrop={e => { e.preventDefault(); dropOnDock(e.dataTransfer.getData('text/plain')) }}>
            <h2 className="ws-pane-title">待排 <span><AnimatedNumber value={dock.length} /></span><small>就绪 {readyDock.length}</small></h2>
            <button type="button" className="ws-sched-dock-toggle" aria-expanded={dockExpanded} aria-controls="ws-sched-dock-content" onClick={() => setDockExpanded(value => !value)}>待排 {dock.length} 篇 · 就绪 {readyDock.length} 篇<Icon name="chevron" size={14} /></button>
            <div className="ws-sched-dock-collapse">
              <div className="ws-sched-dock-content" id="ws-sched-dock-content">
                {dock.length ? <div className="ws-sched-dock-tools">
                  <input type="search" aria-label="搜索待排稿件" placeholder="搜索稿件" value={dockQuery} onChange={event => setDockQuery(event.target.value)} />
                  <SlidingTabs activeKey={dockFilter} className="ws-sched-dock-filters" role="group" aria-label="待排就绪筛选">
                    <button type="button" aria-pressed={dockFilter === 'all'} className={dockFilter === 'all' ? 'is-on' : ''} onClick={() => setDockFilter('all')}>全部</button>
                    <button type="button" aria-pressed={dockFilter === 'ready'} className={dockFilter === 'ready' ? 'is-on' : ''} onClick={() => setDockFilter('ready')}>就绪</button>
                  </SlidingTabs>
                  <span className="ws-muted ws-small" role="status">显示 {visibleDock.length} / {dock.length} 篇</span>
                </div> : null}
                {visibleDock.map(d => <DockCard key={d.id} draft={d} dragging={draggingId === d.id} onPick={pickFor} onDragStart={dragStart} onDragEnd={dragEnd} />)}
                {dock.length && !visibleDock.length ? <div className="ws-muted ws-small"><p>没有匹配的待排稿件。</p><button type="button" className="ws-link" onClick={() => { setDockQuery(''); setDockFilter('all') }}>清空搜索与筛选</button></div> : null}
                {!dock.length ? <div className="ws-muted ws-small">
                  <p>{!active.length ? '还没有稿件，先写一篇再来排期。' : scheduled.length ? '没有待排稿件，可从日历改期或取消。' : '当前没有待排稿件。'}</p>
                  {!active.length ? <button type="button" className="ws-link" onClick={() => setState({ module: 'paper', paperHome: true })}>去写第一篇</button> : null}
                </div> : null}
                <p className="ws-muted ws-small ws-sched-dock-hint">拖到某天默认排到晚 20:00；已排稿件改期保留原时分。</p>
              </div>
            </div>
          </aside>
          <section className="ws-sched-main" aria-label="排期议程与周日历">
            <ScheduleAgenda scheduled={scheduled} now={now} onPublish={publish} onReschedule={pickFor} onUnschedule={unschedule} onLocate={locate} />
            {scheduleNotice ? <div className="ws-sched-notice" role="status">{scheduleNotice.text}<button type="button" className="ws-link" onClick={() => { setWeekKey(scheduleNotice.targetWeek); setScheduleNotice(null) }}>查看当周</button></div> : null}
            {!scheduled.length && !published.length ? <p className="ws-muted ws-small">还没有排期，从待排稿件选一篇，或点某日的「＋」。</p> : null}
            <div key={weekKey} className={`ws-sched-week ${weekSlideClass}`}>
              {days.map(date => {
                const key = dayKey(date)
                const rows = byDay(key)
                return (
                  <div key={key} className={`ws-sched-day ${key === dayKey(today) ? 'is-today' : ''} ${overDay === key ? 'is-over' : ''}`}
                    onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOverDay(key) }}
                    onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOverDay(current => current === key ? null : current) }}
                    onDrop={e => { e.preventDefault(); dropOnDay(e.dataTransfer.getData('text/plain'), key) }}>
                    <header className="ws-sched-day-head"><span>{weekdayName(date)} <b>{date.getMonth() + 1}/{date.getDate()}</b></span><button type="button" className="ws-icon-btn" aria-label={`在 ${key} 排一篇`} title="排一篇" onClick={() => setPicker({ id: null, day: key })}><Icon name="plus" size={14} /></button></header>
                    <div className="ws-sched-day-list">
                      {rows.map(d => d.publishedAt
                        ? <PublishedCard key={d.id} draft={d} located={pulseId === d.id} onCorrect={publish} onUnpublish={unpublishDraft} />
                        : <ScheduledCard key={d.id} draft={d} now={now} dragging={draggingId === d.id} located={pulseId === d.id} onPick={pickFor} onUnschedule={unschedule} onPublish={publish} onDragStart={dragStart} onDragEnd={dragEnd} />)}
                      {!rows.length ? <span className="ws-sched-empty">暂无安排</span> : null}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        </div>
      </div>
      {picker ? <SchedulePicker data={data} picker={picker} onClose={() => setPicker(null)} onSave={saveSchedule} onSaved={notifySchedule} /> : null}
      {publishDraft ? <PublishDialog draft={publishDraft} now={now} onClose={() => setPublishDraft(null)} onSave={savePublication} /> : null}
    </main>
  )
}
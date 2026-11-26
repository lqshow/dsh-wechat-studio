import React from 'react'
import { dayKey, isOverdue } from '../src/schedule-time.js'
import { coverUrl, dateLabel, Icon, openDraft, ReadinessRing, timeLabel, weekdayName } from './schedule-shared.jsx'

function countdown(at, now) {
  const diff = new Date(at).getTime() - now
  if (diff <= 0) return '现在'
  if (diff < 3600000) return `还有 ${Math.max(1, Math.round(diff / 60000))} 分钟`
  if (diff < 86400000) return `还有 ${Math.floor(diff / 3600000)} 小时 ${Math.floor(diff % 3600000 / 60000)} 分`
  return `还有 ${Math.floor(diff / 86400000)} 天 ${Math.floor(diff % 86400000 / 3600000)} 小时`
}

function AgendaTask({ draft, overdue, onPublish, onReschedule, onUnschedule, onLocate }) {
  return (
    <article className="ws-sched-task">
      <span className="ws-sched-time">{timeLabel(draft.scheduledFor)}</span>
      <button type="button" className="ws-sched-task-title" onClick={() => openDraft(draft)}>{draft.title}</button>
      <ReadinessRing readiness={draft.readiness} size={18} />
      <div className="ws-sched-task-actions">
        <button type="button" className="ws-btn" onClick={() => openDraft(draft, 'layout')}>去排版复制</button>
        {draft.coverId ? <a className="ws-btn" href={`${coverUrl(draft)}&download=1`} download>下载封面</a> : null}
        <button type="button" className="ws-btn is-primary" onClick={() => onPublish(draft)}><Icon name="check" size={13} />标记已发</button>
        {overdue ? <>
          <button type="button" className="ws-btn" onClick={() => onReschedule(draft)}>改期</button>
          <button type="button" className="ws-btn" onClick={() => onUnschedule(draft)}>取消</button>
          <button type="button" className="ws-btn" onClick={() => onLocate(draft)}>定位</button>
        </> : null}
      </div>
    </article>
  )
}

function AgendaPlaceholder({ placeholder, overdue, pending, onOpen, onReschedule, onClear }) {
  const isSponsored = placeholder.type === 'sponsored'
  return (
    <article
      className={`ws-sched-task ws-sched-agenda-placeholder ${isSponsored ? 'is-sponsored' : 'is-topic'}`}
      onClick={event => {
        if (event.target.closest('button')) return
        onOpen(placeholder.id)
      }}
    >
      <span className={`ws-sched-placeholder-tag ${isSponsored ? 'is-sponsored' : 'is-topic'}`}>
        {isSponsored ? '商单占位 · 待开写' : '选题占位 · 待开写'}
      </span>
      <button type="button" className="ws-sched-task-title" onClick={() => onOpen(placeholder.id)}>
        {placeholder.title}
      </button>
      <span className="ws-sched-placeholder-meta">
        {isSponsored && placeholder.partner ? `${placeholder.partner} · ` : ''}已攒 {placeholder.noteCount} 条想法
      </span>
      <div className="ws-sched-task-actions">
        <button type="button" className="ws-btn" onClick={() => onOpen(placeholder.id)}>去备稿</button>
        <button type="button" className="ws-btn" disabled={Boolean(pending)} onClick={() => onReschedule(placeholder)}>改期</button>
        <button type="button" className="ws-btn" disabled={Boolean(pending)} onClick={() => onClear(placeholder)}>
          {overdue ? '取消占位' : '移除占位'}
        </button>
      </div>
    </article>
  )
}

export function ScheduleAgenda({
  scheduled,
  placeholders = [],
  now,
  pending,
  onPublish,
  onReschedule,
  onUnschedule,
  onLocate,
  onOpenPlaceholder,
  onReschedulePlaceholder,
  onClearPlaceholder,
}) {
  const [showAllToday, setShowAllToday] = React.useState(false)
  const today = dayKey(new Date(now))
  const sorted = [...scheduled].sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor))
  const future = sorted.filter(a => !isOverdue(a.scheduledFor, now))
  const todayItems = future.filter(a => dayKey(new Date(a.scheduledFor)) === today)
  const todayPlaceholders = placeholders.filter(p => p.targetDate === today)
  const overduePlaceholders = placeholders.filter(p => p.targetDate && p.targetDate < today)
  const next = future[0] ?? null
  const overdue = sorted.filter(a => isOverdue(a.scheduledFor, now))
  const groups = []
  for (const draft of overdue) {
    const key = dayKey(new Date(draft.scheduledFor))
    const group = groups.find(item => item.key === key)
    if (group) group.items.push(draft)
    else groups.push({ key, items: [draft] })
  }
  const visibleToday = showAllToday ? todayItems : todayItems.slice(0, 2)
  const totalToday = todayItems.length + todayPlaceholders.length
  return (
    <section className="ws-sched-agenda" aria-label="今日待办">
      <header className="ws-sched-agenda-head">
        <div>
          <h2>
            今天 <span>{todayItems.length} 篇{todayPlaceholders.length ? ` · ${todayPlaceholders.length} 个占位` : ''}</span>
          </h2>
          <span className="ws-muted ws-small">{dateLabel(new Date(now).toISOString())} {weekdayName(new Date(now))}</span>
        </div>
        <strong>待确认 {overdue.length} 篇{overduePlaceholders.length ? ` · ${overduePlaceholders.length} 过期占位` : ''}</strong>
      </header>
      {next ? <div className="ws-sched-next-line">
        <span>下一篇 · {dateLabel(next.scheduledFor)} {weekdayName(new Date(next.scheduledFor))} {timeLabel(next.scheduledFor)}</span>
        <button type="button" onClick={() => openDraft(next)}>{next.title}</button>
        <span className="ws-sched-count">{countdown(next.scheduledFor, now)}</span>
        <button type="button" className="ws-link" onClick={() => onLocate(next)}>定位</button>
      </div> : null}
      <div className="ws-sched-today-list">
        {visibleToday.map(draft => <AgendaTask key={draft.id} draft={draft} onPublish={onPublish} />)}
        {todayPlaceholders.map(item => (
          <AgendaPlaceholder
            key={item.id}
            placeholder={item}
            pending={pending}
            onOpen={onOpenPlaceholder}
            onReschedule={onReschedulePlaceholder}
            onClear={onClearPlaceholder}
          />
        ))}
        {!totalToday ? <p className="ws-muted ws-small">今天没有待发稿件。</p> : null}
        {todayItems.length > 2 ? <button type="button" className="ws-link ws-sched-more" onClick={() => setShowAllToday(value => !value)}>{showAllToday ? '收起' : `展开其余 ${todayItems.length - 2} 篇`}</button> : null}
      </div>
      <section className="ws-sched-overdue-queue" aria-label="过点待确认">
        <h3>过点待确认</h3>
        {groups.map((group, index) => <details key={group.key} open={index === 0}>
          <summary>{dateLabel(group.items[0].scheduledFor)} {weekdayName(new Date(group.items[0].scheduledFor))}<span>{group.items.length} 篇</span></summary>
          <div>{group.items.map(draft => <AgendaTask key={draft.id} draft={draft} overdue onPublish={onPublish} onReschedule={onReschedule} onUnschedule={onUnschedule} onLocate={onLocate} />)}</div>
        </details>)}
        {overduePlaceholders.length ? (
          <details open={groups.length === 0}>
            <summary>已过目标日的备稿占位<span>{overduePlaceholders.length} 个</span></summary>
            <div>
              {overduePlaceholders.map(item => (
                <AgendaPlaceholder
                  key={item.id}
                  placeholder={item}
                  overdue
                  pending={pending}
                  onOpen={onOpenPlaceholder}
                  onReschedule={onReschedulePlaceholder}
                  onClear={onClearPlaceholder}
                />
              ))}
            </div>
          </details>
        ) : null}
        {!overdue.length && !overduePlaceholders.length ? <p className="ws-muted ws-small">没有过点待确认稿件。</p> : null}
      </section>
    </section>
  )
}

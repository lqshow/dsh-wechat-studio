// 复盘页：导入公众号后台导出 → 数字卡 / 趋势 / 写法对比 / 星期热力 / 规则 / 文章卡。
// 只渲染导出里真有的指标；单篇阅读是导出窗口内的合计。显示名都由数据层算好，这里不引服务端模块。
import React from 'react'
import { articleWindow, compareArticle, diagnoseArticle, reviewHighlights } from './article-score.js'
import { HOOKS, HOOK_IDS } from '../src/article.js'
import { applyInsightRule, closeInsightRule, importInsights, loadInsights, matchInsight, matchInsightDetail, previewInsightRule, saveInsightExperiment, setInsightDetailTopic, setInsightHook, useStudio } from './state.js'
import { AnimatedNumber, SlidingTabs, useDialogClose } from './motion.jsx'

const ICONS = {
  upload: 'M8 11V3M4.5 6.5L8 3l3.5 3.5M3 13h10',
  close: 'M4 4l8 8M12 4l-8 8',
  check: 'M3 8.5l3.2 3.2L13 5',
  insights: 'M2.5 13.5h11M3.5 10.5l3-3.5 2.5 2 4-5',
}
function Icon({ name, size = 16 }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={ICONS[name]} /></svg>
}

const fmt = n => Number(n ?? 0).toLocaleString('zh-CN')
const formatShare = value => new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 2 }).format(value)
const shortDate = d => (d ? d.slice(5).replace('-', '/') : '')
const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const weekdayIndex = date => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7
const stamp = iso => (iso ? new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')

// ---------- 图表（手写 SVG，不引图表库） ----------

const PLOT = { w: 720, h: 200, l: 46, r: 12, t: 14, b: 30 }
const plotW = PLOT.w - PLOT.l - PLOT.r
const plotH = PLOT.h - PLOT.t - PLOT.b
const yOf = (value, max) => PLOT.t + plotH * (1 - (max ? value / max : 0))

function Grid({ max }) {
  return [0, 0.5, 1].map(f => {
    const y = yOf(max * f, max)
    return <g key={f}>
      <line x1={PLOT.l} x2={PLOT.w - PLOT.r} y1={y} y2={y} className="ws-ins-grid" />
      <text x={PLOT.l - 6} y={y + 3} textAnchor="end" className="ws-ins-axis">{fmt(Math.round(max * f))}</text>
    </g>
  })
}

function ArticleBars({ rows }) {
  const [activeKey, setActiveKey] = React.useState(null)
  if (!rows.length) return <p className="ws-muted ws-small">这个范围里没有文章。</p>
  const max = Math.max(1, ...rows.map(r => r.reads))
  const step = plotW / rows.length
  const barW = Math.min(34, step * 0.62)
  const labelEvery = Math.ceil(rows.length / 8)
  const activeIndex = rows.findIndex(row => row.key === activeKey)
  const active = rows[activeIndex]
  const topChannel = active && Object.entries(active.channels ?? {}).sort((a, b) => b[1] - a[1])[0]
  return (
    <div className="ws-ins-trend-interactive" onPointerLeave={() => setActiveKey(null)}>
    <svg viewBox={`0 0 ${PLOT.w} ${PLOT.h}`} className={`ws-ins-svg${active ? ' has-active' : ''}`} role="img" aria-label="每篇文章的阅读柱状图">
      <Grid max={max} />
      {rows.map((r, i) => {
        const x = PLOT.l + step * (i + 0.5)
        const y = yOf(r.reads, max)
        return <g key={r.key}>
          <rect x={x - barW / 2} y={y} width={barW} height={PLOT.t + plotH - y} rx="2"
            className={`ws-ins-bar${r.matched ? '' : ' is-unmatched'}${r.key === activeKey ? ' is-active' : ''}`} />
          {i % labelEvery === 0 ? <text x={x} y={PLOT.h - 8} textAnchor="middle" className="ws-ins-axis">{shortDate(r.publishedAt)}</text> : null}
          <rect x={x - step / 2} y={PLOT.t} width={step} height={plotH} fill="transparent"
            onPointerEnter={() => setActiveKey(r.key)} onClick={() => setActiveKey(r.key)} />
        </g>
      })}
    </svg>
    {active ? <div className="ws-ins-trend-tooltip ws-ins-article-tooltip" style={{ '--trend-x': `${(PLOT.l + step * (activeIndex + .5)) / PLOT.w * 100}%` }}>
      <strong>{active.title}</strong>
      <dl>
        <div><dt>发表日期</dt><dd>{active.publishedAt}</dd></div>
        <div><dt>{active.hasTotal ? '阅读人数' : '渠道阅读合计'}</dt><dd>{fmt(active.reads)}</dd></div>
        {active.share != null ? <div><dt>阅读人数占比</dt><dd>{formatShare(active.share)}</dd></div> : null}
        {topChannel ? <div><dt>{topChannel[0]}渠道阅读</dt><dd>{fmt(topChannel[1])}</dd></div> : null}
      </dl>
    </div> : null}
    </div>
  )
}

function TrafficSources({ daily }) {
  const counts = new Map()
  for (const day of daily) {
    for (const [channel, reads] of Object.entries(day.channels ?? {})) {
      if (channel !== '全部') counts.set(channel, (counts.get(channel) ?? 0) + reads)
    }
  }
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0)
  if (!total) return null
  const channels = [...counts].sort((a, b) => b[1] - a[1])
  return <section className="ws-ins-block">
    <div className="ws-ins-block-head"><h3>流量来源</h3><span className="ws-muted ws-small">各渠道阅读日累计及占比</span></div>
    <div className="ws-ins-source-list">{channels.map(([name, reads]) => <div key={name}>
      <span>{name}</span>
      <span className="ws-ins-row-bar" aria-hidden="true"><i style={{ width: formatShare(reads / total) }} /></span>
      <span className="ws-muted">{fmt(reads)}</span>
      <strong>{formatShare(reads / total)}</strong>
    </div>)}</div>
  </section>
}

function DailyTrend({ daily, label = '每日阅读趋势' }) {
  const [activeIndex, setActiveIndex] = React.useState(null)
  const [keyboard, setKeyboard] = React.useState(false)
  if (!daily.length) return <p className="ws-muted ws-small">这个范围里没有每日数据。</p>
  const hasShares = daily.some(d => d.shares != null)
  const max = Math.max(1, ...daily.map(d => Math.max(d.reads ?? 0, hasShares ? d.shares ?? 0 : 0)))
  const n = daily.length
  const xOf = i => PLOT.l + plotW * (n > 1 ? i / (n - 1) : 0.5)
  const line = field => daily.map((d, i) => `${xOf(i)},${yOf(d[field] ?? 0, max)}`).join(' ')
  const area = `${PLOT.l},${PLOT.t + plotH} ${line('reads')} ${xOf(n - 1)},${PLOT.t + plotH}`
  const ticks = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i)
  const active = activeIndex == null ? null : daily[activeIndex]
  const fields = active ? [
    ['阅读人数', active.reads], ['分享人数', active.shares], ['收藏人数', active.favorites],
    ['跳转阅读原文人数', active.readOriginal], ['发表篇数', active.published],
  ].filter(([, value]) => value != null) : []
  const topChannels = Object.entries(active?.channels ?? {})
    .filter(([name, value]) => name !== '全部' && value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
  const activeX = active ? xOf(activeIndex) : null
  return (
    <div>
      <div className="ws-ins-trend-interactive" role="group" tabIndex={0} aria-label={`${label}，用左右方向键查看每日数据`}
        onBlur={() => { setActiveIndex(null); setKeyboard(false) }}
        onPointerLeave={() => { if (!keyboard) setActiveIndex(null) }}
        onKeyDown={event => {
          if (event.key === 'Escape') { setActiveIndex(null); return }
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          setKeyboard(true)
          setActiveIndex(index => {
            if (event.key === 'Home') return 0
            if (event.key === 'End') return n - 1
            if (index == null) return event.key === 'ArrowLeft' ? n - 1 : 0
            return Math.max(0, Math.min(n - 1, index + (event.key === 'ArrowLeft' ? -1 : 1)))
          })
        }}>
      <svg viewBox={`0 0 ${PLOT.w} ${PLOT.h}`} className="ws-ins-svg" aria-hidden="true">
        <Grid max={max} />
        <polygon points={area} className="ws-ins-area" />
        <polyline points={line('reads')} className="ws-ins-line" />
        {hasShares ? <polyline points={line('shares')} className="ws-ins-line is-dash" /> : null}
        {daily.map((d, i) => d.reads == null ? null : <circle key={d.date} cx={xOf(i)} cy={yOf(d.reads, max)} r="2.6" className="ws-ins-dot" />)}
        {ticks.map(i => <text key={i} x={xOf(i)} y={PLOT.h - 8} textAnchor="middle" className="ws-ins-axis">{shortDate(daily[i].date)}</text>)}
        {active ? <g className="ws-ins-trend-crosshair">
          <line x1={activeX} x2={activeX} y1={PLOT.t} y2={PLOT.t + plotH} />
          {active.reads != null ? <circle cx={activeX} cy={yOf(active.reads, max)} r="5" /> : null}
        </g> : null}
        {daily.map((day, i) => {
          const left = i === 0 ? PLOT.l : (xOf(i - 1) + xOf(i)) / 2
          const right = i === n - 1 ? PLOT.w - PLOT.r : (xOf(i) + xOf(i + 1)) / 2
          const selectDay = () => { setKeyboard(false); setActiveIndex(i) }
          return <rect key={day.date} x={left} y={PLOT.t} width={right - left} height={plotH} fill="transparent"
            onPointerEnter={selectDay} onClick={selectDay} />
        })}
      </svg>
      {active ? <div className="ws-ins-trend-tooltip" role="status" aria-live={keyboard ? 'polite' : 'off'}
        style={{ '--trend-x': `${activeX / PLOT.w * 100}%` }}>
        <strong>{active.date}</strong>
        <dl>{fields.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{fmt(value)}</dd></div>)}</dl>
        {topChannels.length ? <div className="ws-ins-trend-sources">
          <strong>当日主要阅读来源</strong>
          <dl>{topChannels.map(([name, reads]) => <div key={name}><dt>{name}</dt><dd>{fmt(reads)}</dd></div>)}</dl>
        </div> : null}
      </div> : null}
      </div>
      <div className="ws-ins-legend">
        <span><i className="ws-ins-key" />阅读</span>
        {hasShares ? <span><i className="ws-ins-key is-dash" />分享</span> : null}
      </div>
    </div>
  )
}

// ---------- 写法对比 ----------

function CompareBlock({ title, hint, groups, dimension, filter, onPick }) {
  const recorded = groups.filter(g => g.recorded)
  const max = Math.max(1, ...recorded.map(g => g.avgReads))
  return (
    <section className="ws-ins-block">
      <div className="ws-ins-block-head"><h3>{title}</h3><span className="ws-muted ws-small">{hint}</span></div>
      {groups.length ? groups.map(g => {
        const active = filter && filter.dimension === dimension && filter.id === g.id
        const clickable = g.recorded
        return (
          <button type="button" key={g.id ?? 'none'} disabled={!clickable}
            className={`ws-ins-row${active ? ' is-active' : ''}${g.recorded ? '' : ' is-none'}`}
            onClick={() => clickable && onPick(dimension, g.id)} aria-pressed={active}>
            <span className="ws-ins-row-name">
              <span>{g.name}</span>
              <small>{g.count} 篇</small>
              {g.recorded && !g.enough ? <em className="ws-ins-flag">样本不足</em> : null}
            </span>
            <span className="ws-ins-row-bar"><i style={{ width: `${g.recorded ? (g.avgReads / max) * 100 : 0}%` }} /></span>
            <span className="ws-ins-row-val">{g.recorded ? fmt(g.avgReads) : '—'}</span>
          </button>
        )
      }) : <p className="ws-muted ws-small">还没有数据。</p>}
    </section>
  )
}

function WeekdayHeat({ rows }) {
  const cells = WEEKDAYS.map((label, i) => {
    const list = rows.filter(r => weekdayIndex(r.publishedAt) === i)
    const avg = list.length ? Math.round(list.reduce((s, r) => s + r.reads, 0) / list.length) : 0
    return { label, count: list.length, avg, titles: list.map(r => r.title) }
  })
  const max = Math.max(1, ...cells.map(c => c.avg))
  return (
    <section className="ws-ins-block">
      <div className="ws-ins-block-head"><h3>各星期的发文表现</h3><span className="ws-muted ws-small">按发表日统计 · 篇均阅读</span></div>
      <div className="ws-ins-heat">
        {cells.map(c => (
          <div key={c.label} className={`ws-ins-heat-cell${c.avg === max ? ' is-peak' : ''}`} style={{ '--heat': `${c.avg / max * 100}%` }}
            title={c.count ? `${c.label} · ${c.count} 篇 · 平均 ${fmt(c.avg)}\n${c.titles.join('、')}` : `${c.label} · 没有发文`}>
            <strong>{c.label}</strong>
            <span>{c.count ? fmt(c.avg) : '—'}</span>
            <small>{c.count ? `${c.count} 篇` : '无发文'}</small>
            <div className="ws-ins-heat-track" aria-hidden="true" />
          </div>
        ))}
      </div>
    </section>
  )
}

// ---------- 文章卡 / 未匹配 ----------

function HookSelect({ row }) {
  return (
    <label className="ws-ins-hook" title={row.hookSource === 'draft' ? '钩子来自稿件，改这里会覆盖' : '手动标注钩子'}>
      <select value={row.hook ?? ''} onChange={e => setInsightHook(row.key, e.target.value || null)} aria-label={`给《${row.title}》标钩子`}>
        <option value="">未记录</option>
        {HOOK_IDS.map(id => <option key={id} value={id}>{id} · {HOOKS[id]}</option>)}
      </select>
    </label>
  )
}

function ArticleCard({ row, drafts, details, onDetail }) {
  const [failed, setFailed] = React.useState(false)
  const cover = row.coverId && row.articleId && !failed
    ? `wechat-studio/cover/image?${new URLSearchParams({ id: row.articleId, asset: row.coverId })}` : null
  return (
    <article className={`ws-ins-card${row.matched ? '' : ' is-unmatched'}`}>
      <div className="ws-ins-card-art">
        {cover ? <img src={cover} alt="" loading="lazy" onError={() => setFailed(true)} /> : <span aria-hidden="true">{row.title}</span>}
      </div>
      <div className="ws-ins-card-body">
        <strong className="ws-ins-card-title">{row.title}</strong>
        <span className="ws-muted ws-small">{row.publishedAt}{row.matched ? '' : ' · 未匹配'}</span>
        <div className="ws-ins-card-metrics">
          <div className="ws-ins-card-reads"><b>{fmt(row.reads)}</b><span>{row.hasTotal ? '窗口内阅读人数' : '窗口内渠道阅读合计'}</span></div>
          {row.share != null ? <div className="ws-ins-card-reads"><b>{formatShare(row.share)}</b><span>阅读人数占比</span></div> : null}
        </div>
        {details.map(detail => <button type="button" className="ws-btn" key={detail.key} onClick={() => onDetail(detail.key)}>查看数据明细{details.length > 1 ? ` · ${detail.window?.from ?? detail.fileName}` : ''}</button>)}
        <div className="ws-ins-tags">
          <HookSelect row={row} />
          <span className={`ws-ins-tag${row.banner ? '' : ' is-none'}`}>{row.bannerName ?? '横幅未记录'}</span>
          <span className={`ws-ins-tag${row.skin ? '' : ' is-none'}`}>{row.skinName ?? '皮肤未记录'}</span>
        </div>
        {!row.matched ? (
          <label className="ws-ins-match">
            <span className="ws-muted ws-small">对应稿件</span>
            <select value="" onChange={e => e.target.value && matchInsight(row.key, e.target.value)} aria-label={`给《${row.title}》选对应稿件`}>
              <option value="">手动选一篇…</option>
              {drafts.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
            </select>
          </label>
        ) : null}
      </div>
    </article>
  )
}

function UnmatchedList({ rows, drafts }) {
  if (!rows.length) return null
  return (
    <section className="ws-ins-block ws-ins-unmatched">
      <details>
      <summary>关联稿件 <span className="ws-muted ws-small">{rows.length} 篇待匹配</span></summary>
      <p className="ws-muted ws-small ws-ins-match-note">关联后可带入稿件的封面、标题套路、横幅和正文风格，用于复盘对比。只看阅读数据可跳过。</p>
      <div className="ws-ins-unmatched-list">
        {rows.map(r => (
          <div className="ws-ins-unmatched-row" key={r.key}>
            <div className="ws-ins-unmatched-copy">
              <strong>{r.title}</strong>
              <span className="ws-muted ws-small">{r.publishedAt} · {fmt(r.reads)} 阅读</span>
            </div>
            <select value="" onChange={e => e.target.value && matchInsight(r.key, e.target.value)} aria-label={`给《${r.title}》选对应稿件`}>
              <option value="">选对应稿件…</option>
              {drafts.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
            </select>
            <button type="button" className="ws-link" onClick={() => matchInsight(r.key, 'auto')}>重新自动匹配</button>
          </div>
        ))}
      </div>
      </details>
    </section>
  )
}

// ---------- 规则 ----------

function Evidence({ group }) {
  return <p className="ws-ins-evidence">{group.articles.map(a => `《${a.title}》${fmt(a.reads)}`).join('；')}</p>
}

function RulesPanel({ rules, insufficient, minSample, onPreview, pending }) {
  return (
    <section className="ws-ins-block ws-ins-rules">
      <div className="ws-ins-block-head"><h3>写作规则</h3><span className="ws-muted ws-small">每种写法至少 {minSample} 篇、至少两种够样本才出规则</span></div>
      {insufficient ? (
        <p className="ws-ins-empty-rule">暂时看不出规律。可以先给文章标钩子、多导入几期数据，等每种写法攒够 {minSample} 篇再来。</p>
      ) : rules.map(rule => (
        <div className="ws-ins-rule" key={rule.id}>
          <div className="ws-ins-rule-head">
            <span className="ws-ins-rule-dim">{rule.dimensionLabel}</span>
            <p>{rule.text}</p>
          </div>
          <div className="ws-ins-rule-evidence">
            <div><span className="ws-muted ws-small">高的那组</span><Evidence group={rule.top} /></div>
            <div><span className="ws-muted ws-small">低的那组</span><Evidence group={rule.bottom} /></div>
          </div>
          {rule.target ? (
            <button type="button" className="ws-btn" disabled={pending === 'insights/rule-preview'} onClick={() => onPreview(rule.id)}>写进写作 skill</button>
          ) : <span className="ws-muted ws-small">皮肤对比只作参考，不写进 skill。</span>}
        </div>
      ))}
    </section>
  )
}

function RuleDialog({ preview, pending }) {
  const modal = React.useRef(null)
  const headingId = React.useId()
  const { closing, requestClose } = useDialogClose(closeInsightRule)
  React.useEffect(() => {
    const dialog = modal.current
    dialog.showModal()
    return () => { if (dialog.open) dialog.close() }
  }, [])
  return (
    <dialog ref={modal} className={`ws-dialog ws-ins-rule-dialog${closing ? ' is-closing' : ''}`} aria-labelledby={headingId}
      onCancel={e => { e.preventDefault(); requestClose() }}
      onClick={e => { if (e.target === e.currentTarget) requestClose() }}>
      <div className="ws-dialog-head">
        <div>
          <h2 id={headingId} className="ws-dialog-title">写进 {preview.skill}.md</h2>
          <p className="ws-muted ws-small">{preview.isCopy ? '会在覆盖目录新建一份副本，内置 skill 不动。' : '会改你覆盖目录里的这份 skill。'}{preview.replaces ? '替换已有的「数据复盘规则」一节。' : '在末尾新增「数据复盘规则」一节。'}</p>
        </div>
        <button type="button" className="ws-icon-btn" aria-label="关闭" onClick={requestClose}><Icon name="close" /></button>
      </div>
      <code className="ws-ins-rule-path">{preview.path}</code>
      <pre className="ws-ins-rule-pre">{preview.section}</pre>
      <div className="ws-dialog-foot">
        <button type="button" className="ws-btn" onClick={requestClose}>取消</button>
        <button type="button" className="ws-btn is-primary" disabled={pending === 'insights/rule-apply'} onClick={() => applyInsightRule(preview.ruleId)}>
          {pending === 'insights/rule-apply' ? '写入中…' : '确认写入'}
        </button>
      </div>
    </dialog>
  )
}

// ---------- 主视图 ----------

const RANGES = [['7', '近 7 天'], ['30', '近 30 天'], ['all', '全部']]

const REVIEW_LABELS = {
  followup: '值得写续篇', angle: '值得换个切口', opening: '优先检查开头', review: '回看选题和正文',
}

function ReviewHighlights({ details, rows, range, onOpen, onImport }) {
  const highlights = reviewHighlights(details, range)
  const scopedDetails = details.filter(detail => !range || !detail.publishedAt ||
    (detail.publishedAt >= range.from && detail.publishedAt <= range.to))
  const linked = new Set(details.map(detail => detail.articleKey))
  const missing = rows.filter(row => !linked.has(row.key))
  const untagged = scopedDetails.filter(detail => !detail.topic)
  const unlinked = scopedDetails.filter(detail => !detail.articleKey)
  return <section className="ws-ins-block ws-ins-highlights">
    <div className="ws-ins-block-head"><h3>本期值得看的文章</h3><span className="ws-muted ws-small">发表后 7 天 · 与同题材历史稿比较</span></div>
    {highlights.length ? <div className="ws-ins-highlight-grid">
      {highlights.map(({ kind, detail, peerKey, reads, shares, count }) => <article key={kind}>
        <span className="ws-ins-highlight-label">{REVIEW_LABELS[kind]}</span>
        <strong>{detail.title}</strong>
        <p className="ws-muted ws-small">比同类中位数{reads > 0 ? '多' : '少'} {fmt(Math.abs(reads))} 阅读日累计，分享比例{shares > 0 ? '高' : '低'} {Math.abs(shares) < 0.0001 ? '不到 0.01' : (Math.abs(shares) * 100).toFixed(2)} 个百分点（{count} 篇分享样本）。</p>
        <button type="button" className="ws-btn" onClick={() => onOpen(detail.key, 'score', peerKey)}>看对照</button>
      </article>)}
    </div> : <p className="ws-muted ws-small">本期暂无推荐。同题材至少需要 4 篇具备完整前 7 天阅读与分享数据的文章。每篇使用其余文章作为参照。</p>}
    {missing.length || untagged.length || unlinked.length ? <details>
      <summary>补齐复盘资料 <span className="ws-muted ws-small">{missing.length} 篇缺已关联明细 · {untagged.length} 份待标题材 · {unlinked.length} 份待关联</span></summary>
      <div className="ws-ins-highlight-gaps">
        {missing.length ? <div><strong>缺已关联的单篇明细</strong><ul>{missing.map(row => <li key={row.key}>{row.title}</li>)}</ul>
          <button type="button" className="ws-btn" onClick={onImport}>导入单篇明细</button></div> : null}
        {untagged.length ? <div><strong>待标题材</strong>{untagged.map(detail => <button type="button" key={detail.key} className="ws-link" onClick={() => onOpen(detail.key, 'score')}>{detail.title}</button>)}</div> : null}
        {unlinked.length ? <div><strong>待关联趋势卡片</strong>{unlinked.map(detail => <button type="button" key={detail.key} className="ws-link" onClick={() => onOpen(detail.key, 'link')}>{detail.title}</button>)}</div> : null}
      </div>
    </details> : null}
  </section>
}

const EXPERIMENT_RESULTS = { repeat: '值得再试', observe: '继续观察', stop: '到此为止' }

function ExperimentCard({ experiment, source, details, drafts, pending, onSaved, reveal }) {
  const [action, setAction] = React.useState(experiment?.action ?? '')
  const [draftId, setDraftId] = React.useState(experiment?.draftId ?? '')
  const [saved, setSaved] = React.useState(false)
  const cardRef = React.useRef(null)
  const actionRef = React.useRef(null)
  React.useEffect(() => {
    if (experiment && !reveal) return
    const frame = requestAnimationFrame(() => {
      cardRef.current?.scrollIntoView({ block: 'nearest' })
      if (!experiment) actionRef.current?.focus({ preventScroll: true })
      else cardRef.current?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [experiment?.id, reveal])
  const savedDraft = drafts.find(draft => draft.id === draftId)
  const sourceWindow = source && articleWindow(source, 7)
  const nextDetails = details.filter(detail => savedDraft && detail.draftId === draftId && detail.key !== source?.key &&
    (!source?.publishedAt || detail.publishedAt >= source.publishedAt))
    .sort((a, b) => b.importedAt.localeCompare(a.importedAt))
  const next = nextDetails.map(detail => ({ detail, score: articleWindow(detail, 7) })).find(row => row.score)
  const clean = action.trim()
  const dirty = clean !== experiment?.action || draftId !== (experiment?.draftId ?? '')
  const save = async result => {
    if (await saveInsightExperiment({ id: experiment?.id, sourceKey: source?.key, action: clean, draftId: draftId || null, result })) {
      setSaved(true)
      onSaved?.()
    }
  }
  const ratio = value => value == null ? '—' : `${(value * 100).toFixed(2)}%`
  const signed = value => `${value > 0 ? '+' : value < 0 ? '−' : ''}${fmt(Math.abs(value))}`
  const status = experiment?.result ? EXPERIMENT_RESULTS[experiment.result]
    : !experiment?.draftId ? '待关联新稿' : sourceWindow && next ? '可以复盘' : '待补齐前 7 天数据'
  return <div className="ws-ins-experiment" ref={cardRef} tabIndex={-1}>
    {experiment ? <div className="ws-ins-block-head"><strong>已记录的尝试</strong><span className="ws-ins-highlight-label">{status}</span></div>
      : <p className="ws-muted ws-small">先记下一个具体改法。关联新稿并导入明细后，这里会对比两篇发表后 7 天的阅读与分享。</p>}
    <form onSubmit={event => { event.preventDefault(); void save(null) }}>
      <label>下一篇试什么 <textarea ref={actionRef} rows={2} maxLength={300} required value={action}
        placeholder="例如：同类实测的首屏先放结果截图，把背景放到后面" onChange={event => setAction(event.target.value)} /></label>
      <label>关联下一篇稿件 <select value={draftId} onChange={event => setDraftId(event.target.value)}>
        <option value="">稍后关联</option>
        {draftId && !savedDraft ? <option value={draftId} disabled>稿件已不可用</option> : null}
        {drafts.filter(draft => draft.id !== source?.draftId).map(draft => <option key={draft.id} value={draft.id}>{draft.title}</option>)}
      </select></label>
      <button className="ws-btn" type="submit" disabled={Boolean(pending) || !clean || !dirty || Boolean(draftId && !savedDraft)}>{experiment ? '保存修改' : '保存这条尝试'}</button>
    </form>
    {saved && !dirty ? <p className="ws-muted ws-small" role="status">已保存到复盘首页的「写作尝试」。</p> : null}
    {experiment && !dirty ? <>
      {sourceWindow && next ? <>
        <p className="ws-muted ws-small">两篇都按发表后 7 天比较（含发表当天）。分享比例为分享日累计 ÷ 阅读日累计。</p>
        <table><thead><tr><th scope="col">指标</th><th scope="col">原稿</th><th scope="col">新稿</th><th scope="col">变化</th></tr></thead>
          <tbody>
            <tr><th scope="row">阅读日累计</th><td>{fmt(sourceWindow.reads)}</td><td>{fmt(next.score.reads)}</td><td>{signed(next.score.reads - sourceWindow.reads)}</td></tr>
            <tr><th scope="row">分享比例</th><td>{ratio(sourceWindow.shareRate)}</td><td>{ratio(next.score.shareRate)}</td>
              <td>{sourceWindow.shareRate == null || next.score.shareRate == null ? '—' : `${signed(Number(((next.score.shareRate - sourceWindow.shareRate) * 100).toFixed(2)))} 个百分点`}</td></tr>
          </tbody></table>
        <label>你的结论 <select disabled={Boolean(pending)} value={experiment.result ?? ''} onChange={event => void save(event.target.value || null)}>
          <option value="">待记录</option>
          {Object.entries(EXPERIMENT_RESULTS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select></label>
      </> : <p className="ws-muted ws-small">{!savedDraft ? '等待关联下一篇稿件。' : !sourceWindow ? '原稿还缺完整的前 7 天阅读数据。' : '等待新稿发布并导入单篇明细。明细需关联趋势卡片，趋势卡片需关联对应稿件。'}</p>}
    </> : null}
  </div>
}

function Scorecard({ detail, details, drafts, experiments, pending, initialPeer, initialExperiment }) {
  const [days, setDays] = React.useState(7)
  const [topic, setTopic] = React.useState(detail.topic ?? '')
  const [peerKey, setPeerKey] = React.useState(initialPeer ?? '')
  const [recording, setRecording] = React.useState(false)
  const [justSaved, setJustSaved] = React.useState(false)
  const savedExperiments = experiments.filter(item => item.sourceKey === detail.key)
  const { current, peers, readsMedian, shareMedian, shareCount } = compareArticle(detail, details, days)
  const peer = peers.find(row => row.item.key === peerKey)
  const percent = value => value == null ? '—' : `${(value * 100).toFixed(2)}%`
  const aboveReads = readsMedian != null && current?.reads > readsMedian
  const belowReads = readsMedian != null && current?.reads < readsMedian
  const aboveShare = shareMedian != null && current?.shareRate != null && current.shareRate > shareMedian
  const belowShare = shareMedian != null && current?.shareRate != null && current.shareRate < shareMedian
  let feedback = '对照同类稿的标题和开头，挑一个差异留到下一篇验证。'
  if (aboveReads && aboveShare) feedback = '阅读和分享比例均高于同类中位数。可以从这篇的读者需求出发，试写一篇续篇。'
  else if (belowReads && aboveShare) feedback = '阅读低于同类中位数，分享比例高于中位数。下一篇可保留核心内容，试一个更具体的标题切口。'
  else if (aboveReads && belowShare) feedback = '阅读高于同类中位数，分享比例偏低。对照开头兑现标题承诺的速度，以及正文有没有读者愿意转给别人的结果。'
  else if (belowReads && belowShare) feedback = '阅读和分享比例都低于同类中位数。先和一篇表现较好的同类稿比选题切口，再决定是否继续写这个题。'
  const column = (item, score) => <>
    <strong>{item.title}</strong>
    <p>阅读日累计 {fmt(score.reads)} · 分享比例 {percent(score.shareRate)}</p>
    {item.draftContext ? <p className="ws-muted ws-small">{[item.draftContext.hook, item.draftContext.banner, item.draftContext.skin].filter(Boolean).join(' · ')}</p> : null}
    {item.draftContext?.opening ? <blockquote>{item.draftContext.opening}</blockquote> : <p className="ws-muted ws-small">关联稿件后可查看开头。</p>}
  </>
  return <div className="ws-ins-score">
    <form onSubmit={event => { event.preventDefault(); void setInsightDetailTopic(detail.key, topic) }}>
      <label>题材 <input value={topic} maxLength={40} placeholder="例如：微信聊天记录实测" onChange={event => setTopic(event.target.value)} /></label>
      <button type="submit" className="ws-btn" disabled={Boolean(pending) || topic.trim() === (detail.topic ?? '')}>保存题材</button>
    </form>
    <p className="ws-muted ws-small">给同类文章填同一个题材。首日按发表当天计算，7 天含发表当天。阅读日累计可能重复计入跨天读者。</p>
    <SlidingTabs activeKey={days} className="ws-tabs" role="group" aria-label="发表后观察窗">
      {[[1, '发表首日'], [7, '发表后 7 天']].map(([value, label]) =>
        <button type="button" key={value} aria-pressed={days === value} className={days === value ? 'is-on' : ''} onClick={() => setDays(value)}>{label}</button>)}
    </SlidingTabs>
    {!current ? <p className="ws-muted">{detail.publishedAt ? '这份明细缺少观察窗内完整的「全部」渠道阅读数据。' : '请先关联趋势卡片，获取发表日期。'}</p> : <>
      <table>
        <thead><tr><th scope="col">指标</th><th scope="col">本篇</th><th scope="col">同类中位数</th></tr></thead>
        <tbody>
          <tr><th scope="row">阅读日累计</th><td>{fmt(current.reads)}</td><td>{readsMedian == null ? '—' : fmt(readsMedian)}</td></tr>
          <tr><th scope="row">分享日累计 ÷ 阅读日累计</th><td>{percent(current.shareRate)}</td><td>{percent(shareMedian)}</td></tr>
        </tbody>
      </table>
      <p className="ws-muted ws-small">同类有效样本 {peers.length} 篇（分享比例 {shareCount} 篇），每项至少 3 篇才显示中位数。</p>
      {readsMedian != null ? <p className="ws-ins-score-feedback"><strong>下一篇可以试</strong> {feedback}</p> : null}
      {peers.length ? <label>对照同类文章 <select value={peerKey} onChange={event => setPeerKey(event.target.value)}>
        <option value="">选择一篇</option>
        {peers.map(row => <option key={row.item.key} value={row.item.key}>{row.item.title} · {fmt(row.score.reads)} 阅读日累计</option>)}
      </select></label> : null}
      {peer ? <><p className="ws-muted ws-small">开头和写法标签来自当前稿件记录。</p>
        <div className="ws-ins-score-compare"><div>{column(detail, current)}</div><div>{column(peer.item, peer.score)}</div></div></> : null}
    </>}
    <button type="button" className="ws-btn ws-ins-record-experiment" aria-expanded={recording} onClick={() => setRecording(!recording)}>
      {recording ? '收起记录表单' : '记录下次尝试'}
    </button>
    {recording ? <ExperimentCard source={detail} details={details} drafts={drafts} pending={pending} onSaved={() => {
      setRecording(false)
      setJustSaved(true)
    }} /> : null}
    {justSaved ? <p className="ws-muted ws-small" role="status">已记录。下次可从复盘首页「写作尝试」打开。</p> : null}
    {savedExperiments.map((experiment, index) => (
      <ExperimentCard key={experiment.id} experiment={experiment} source={detail} details={details} drafts={drafts} pending={pending}
        reveal={justSaved ? index === 0 : initialExperiment === experiment.id} />
    ))}
  </div>
}

function ArticleDiagnosis({ detail }) {
  const data = diagnoseArticle(detail)
  const stages = [
    {
      title: '触达与打开', source: '单篇明细 · 阅读转化',
      metrics: [
        ['公众号消息打开比例', data.openRate == null ? null : formatShare(data.openRate)],
        ['公众号消息阅读人数', data.opened], ['送达人数', data.delivered],
      ],
      note: data.openRate == null ? '有效的送达人数和消息阅读人数齐全时可计算打开比例。' : '计算口径为公众号消息阅读人数 ÷ 送达人数。',
      action: data.openRate == null ? null : '下一篇同题材稿可以只改标题的具体承诺，再观察公众号消息打开比例。',
    },
    {
      title: '读下去', source: '单篇明细 · 数据概况',
      metrics: [['完读率', data.completion == null ? null : formatShare(data.completion)],
        ['平均停留时长', data.duration == null ? null : `${fmt(data.duration)} 秒`]],
      action: '回看首屏在哪一段交付标题承诺的结果。下一篇可以把结果提前，再结合篇幅看完读与停留。',
    },
    {
      title: '分享与关注', source: '单篇明细 · 数据概况',
      metrics: [['阅读人数', data.reads], ['分享人数', data.shares], ['新增关注人数', data.follows]],
      action: '先选一个目标验证。想提高分享，可以试一张可转发的步骤图。想增加关注，可以在文末说清系列下一篇会解决什么问题。',
    },
  ]
  return <div className="ws-ins-diagnosis">
    <p className="ws-muted ws-small">以下指标按单篇导出表各区块的汇总口径展示。表内未单独标明汇总日期。</p>
    {stages.map(stage => {
      const available = stage.metrics.filter(([, value]) => value != null)
      return <section key={stage.title}>
        <div className="ws-ins-block-head"><h3>{stage.title}</h3><span className="ws-muted ws-small">{stage.source}</span></div>
        {available.length ? <dl className="ws-ins-detail-metrics">{available.map(([name, value]) =>
          <div key={name}><dt>{name}</dt><dd>{typeof value === 'number' ? fmt(value) : value}</dd></div>)}</dl>
          : <p className="ws-muted ws-small">这份明细缺少该环节的数据。</p>}
        {stage.note ? <p className="ws-muted ws-small">{stage.note}</p> : null}
        {stage.title === '触达与打开' && data.topChannel && detail.window ? <p className="ws-muted ws-small">
          趋势明细 {detail.window.from} 至 {detail.window.to}，阅读日累计最多的渠道是「{data.topChannel[0]}」（{fmt(data.topChannel[1])}）。
        </p> : null}
        {available.length && stage.action ? <p className="ws-ins-diagnosis-action">{stage.action}</p> : null}
      </section>
    })}
  </div>
}

function DetailDialog({ detail, details, drafts, experiments, targets, pending, initialSection, initialPeer, initialExperiment, onClose }) {
  const modal = React.useRef(null)
  const heading = React.useId()
  const [channel, setChannel] = React.useState(null)
  const [section, setSection] = React.useState(initialSection === 'score' ? 'score' : 'overview')
  const [audienceIndex, setAudienceIndex] = React.useState(0)
  const [showLink, setShowLink] = React.useState(initialSection === 'link')
  const sections = [
    ['overview', '概况'],
    ['score', '成绩单'],
    ['diagnosis', '诊断'],
    ...(detail.window ? [['trend', '阅读趋势']] : []),
    ...(detail.conversion.length ? [['conversion', '阅读转化']] : []),
    ...(detail.audience.length ? [['audience', '受众分布']] : []),
  ]
  const audience = detail.audience[audienceIndex]
  const channels = [...new Set(detail.daily.map(row => row.channel))]
  const selected = channel ?? (channels.includes('全部') ? '全部' : channels[0])
  const { closing, requestClose } = useDialogClose(onClose)
  React.useEffect(() => {
    const dialog = modal.current
    dialog.showModal()
    return () => { if (dialog.open) dialog.close() }
  }, [])
  const metrics = items => <dl className="ws-ins-detail-metrics">{items.map(({ label, value }) =>
    <div key={label}><dt>{label}</dt><dd>{label === '完读率' ? (value * 100).toFixed(2) + '%' : fmt(value)}</dd></div>)}</dl>
  return <dialog ref={modal} className={`ws-dialog ws-ins-rule-dialog ws-ins-detail${closing ? ' is-closing' : ''}`} aria-labelledby={heading}
    onCancel={event => { event.preventDefault(); requestClose() }}
    onClick={event => { if (event.target === event.currentTarget) requestClose() }}>
    <div className="ws-dialog-head">
      <h2 className="ws-dialog-title" id={heading}>{detail.title}</h2>
      <button type="button" className="ws-icon-btn" aria-label="关闭" onClick={requestClose}><Icon name="close" /></button>
    </div>
    <div className="ws-ins-detail-meta">
      <span className="ws-muted ws-small" title={detail.fileName}>{detail.window ? `趋势日期 ${detail.window.from} 至 ${detail.window.to}` : '单篇明细'}</span>
      {targets.length ? <button type="button" className="ws-link" aria-expanded={showLink} onClick={() => setShowLink(!showLink)}>{detail.articleKey ? '已关联趋势卡片' : '关联趋势卡片'}</button> : null}
    </div>
    {showLink ? <label className="ws-ins-detail-link-field">关联后可从趋势卡片打开这份报告。
      <select aria-label="对应趋势卡片" disabled={Boolean(pending)} value={detail.manual ? detail.articleKey ?? '' : 'auto'}
      onChange={event => matchInsightDetail(detail.key, event.target.value || null)}>
      <option value="auto">{detail.articleKey && !detail.manual ? '自动匹配 · 已匹配' : '按标题自动匹配'}</option>
      <option value="">单独查看</option>
      {targets.map(row => <option value={row.key} key={row.key}>{row.publishedAt} · {row.title}</option>)}
    </select></label> : null}
    <SlidingTabs activeKey={section} className="ws-tabs ws-ins-detail-tabs" role="group" aria-label="明细栏目">
      {sections.map(([id, label]) => <button type="button" key={id} className={section === id ? 'is-on' : ''} aria-pressed={section === id} onClick={() => setSection(id)}>{label}</button>)}
    </SlidingTabs>
    <div className="ws-ins-detail-body ws-view-enter" key={section}>
    {section === 'overview' ? metrics(detail.metrics) : null}
    {section === 'diagnosis' ? <ArticleDiagnosis detail={detail} /> : null}
    {section === 'score' ? <Scorecard detail={detail} details={details} drafts={drafts} experiments={experiments} pending={pending} initialPeer={initialPeer} initialExperiment={initialExperiment} /> : null}
    {section === 'trend' ? <>
      <div className="ws-ins-block-head"><h3>每日阅读与分享</h3><label>渠道 <select value={selected} onChange={event => setChannel(event.target.value)}>
        {channels.map(name => <option key={name}>{name}</option>)}</select></label></div>
      <DailyTrend key={selected} label="单篇每日阅读与分享趋势" daily={detail.daily.filter(row => row.channel === selected)} />
    </> : null}
    {section === 'conversion' ? metrics(detail.conversion) : null}
    {section === 'audience' && audience ? <>
      <label>受众维度 <select value={audienceIndex} onChange={event => setAudienceIndex(Number(event.target.value))}>
        {detail.audience.map((table, i) => <option value={i} key={table.name}>{table.name}</option>)}
      </select></label>
      <table><thead><tr>{audience.headings.map((label, i) => <th key={i} scope="col">{label}</th>)}</tr></thead>
        <tbody>{audience.rows.map((row, i) => <tr key={i}>{audience.headings.map((_, j) => <td key={j}>{row[j]}</td>)}</tr>)}</tbody>
      </table>
    </> : null}
    </div>
  </dialog>
}

export function InsightsView() {
  const insights = useStudio(s => s.insights)
  const insightsError = useStudio(s => s.insightsError)
  const range = useStudio(s => s.insightsRange)
  const pending = useStudio(s => s.pending)
  const preview = useStudio(s => s.insightsRulePreview)
  const [sort, setSort] = React.useState('reads')
  const [filter, setFilter] = React.useState(null)
  const [detailView, setDetailView] = React.useState(null)
  const openDetail = (key, section, peer, experiment) => setDetailView({ key, section, peer, experiment })
  const fileRef = React.useRef(null)
  React.useEffect(() => { loadInsights() }, [])

  const pick = (dimension, id) => setFilter(cur => (cur && cur.dimension === dimension && cur.id === id ? null : { dimension, id }))
  const onFile = e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) importInsights(file) }

  const head = (
    <header className="ws-dh-masthead">
      <div className="ws-dh-masthead-left">
        <span className="ws-dh-kicker">ANALYTICS &amp; REVIEW · 数据复盘</span>
        <div className="ws-dh-title-row">
          <h1>复盘</h1>
          <p className="ws-dh-dateline"><span>单篇阅读为导出窗口内合计，非历史总阅读</span></p>
        </div>
      </div>
      <div className="ws-ins-tools">
        <button type="button" className="ws-btn is-primary" disabled={pending === 'insights/import'} onClick={() => fileRef.current?.click()}>
          <Icon name="upload" size={15} />{pending === 'insights/import' ? '导入中…' : '导入数据'}
        </button>
        <input ref={fileRef} type="file" accept=".xls" hidden onChange={onFile} />
      </div>
    </header>
  )

  if (!insights && !insightsError) return <main className="ws-page"><div className="ws-dh-shell ws-ins">{head}<div className="ws-center"><span className="ws-shimmer">正在读取复盘数据…</span></div></div></main>
  if (!insights) return <main className="ws-page"><div className="ws-dh-shell ws-ins">{head}<div className="ws-center"><p className="ws-muted">读取失败：{insightsError}</p><button type="button" className="ws-btn" onClick={() => loadInsights()}>重试</button></div></div></main>

  if (!insights.hasData) {
    return (
      <main className="ws-page">
        <div className="ws-dh-shell ws-ins">
          {head}
          <div className="ws-ins-onboard">
            <Icon name="insights" size={28} />
            <h2>先导入一份后台导出</h2>
            <p>在公众号后台导出「数据趋势」「用户增长」或某篇文章的「数据明细」，再选择对应的 .xls 文件。</p>
          </div>
        </div>
      </main>
    )
  }

  const { cards, tendency, growth } = insights
  const details = insights.details ?? []
  const experiments = insights.experiments ?? []
  const selectedDetail = details.find(detail => detail.key === detailView?.key)
  const filterGroup = filter ? insights.compare[filter.dimension].find(g => g.id === filter.id) : null
  let rows = insights.articles
  if (filter) rows = rows.filter(r => (filter.dimension === 'skin' ? (r.skin ? `${r.skin.style}/${r.skin.theme}` : null) : r[filter.dimension]) === filter.id)
  rows = [...rows].sort(sort === 'reads' ? (a, b) => b.reads - a.reads : (a, b) => a.publishedAt.localeCompare(b.publishedAt) || b.reads - a.reads)

  const numCards = [
    ['已发篇数', cards.published, '窗口内账号发表'],
    ['总阅读', cards.reads, '窗口内每日合计'],
    ['分享', cards.shares, '账号每日合计'],
    ['收藏', cards.favorites, '账号每日合计'],
    ...(growth ? [['净增关注', cards.netFollows, `${growth.window.from} 至 ${growth.window.to}`], ['期末累计关注', cards.totalFollows, growth.window.to]] : []),
  ].filter(([, value]) => value != null)

  return (
    <main className="ws-page">
      <div className="ws-dh-shell ws-ins">
        {head}
      <ReviewHighlights details={details} rows={insights.articles} range={range === 'all' ? null : insights.articleRange}
        onOpen={openDetail} onImport={() => fileRef.current?.click()} />
      {experiments.length ? <section className="ws-ins-block ws-ins-experiments">
        <details open><summary>写作尝试 <span className="ws-muted ws-small">{experiments.length} 条</span></summary>
          <div className="ws-ins-experiment-list">{experiments.map(item => {
            const source = details.find(detail => detail.key === item.sourceKey)
            const draft = insights.drafts.find(row => row.id === item.draftId)
            return <div key={item.id}>
              <strong>{item.action}</strong>
              <span className="ws-muted ws-small">{draft?.title ?? '待关联稿件'} · {EXPERIMENT_RESULTS[item.result] ?? '待复盘'}</span>
              {source ? <button className="ws-link" type="button" onClick={() => openDetail(source.key, 'score', null, item.id)}>查看尝试</button> : null}
            </div>
          })}</div>
        </details>
      </section> : null}
      <div className="ws-ins-meta">
        {tendency ? <span>账号统计 · {tendency.window.from} 至 {tendency.window.to} · {tendency.fileName} · 导入于 {stamp(tendency.importedAt)}</span> : null}
        {growth ? <span>用户增长 · {growth.fileName}（{growth.window.from} 至 {growth.window.to}）</span> : null}
      </div>

      <div className="ws-ins-cards">
        {numCards.map(([label, value, note]) => (
          <div className="ws-ins-num" key={label}><span>{label}</span><b><AnimatedNumber value={Number(value)} format={fmt} /></b><small>{note}</small></div>
        ))}
      </div>
      {tendency ? <section className="ws-ins-block">
        <div className="ws-ins-block-head"><h3>账号每日趋势</h3><span className="ws-muted ws-small">{tendency.window.from} 至 {tendency.window.to}</span></div>
        <DailyTrend daily={insights.daily} label="账号每日阅读与分享趋势" />
      </section> : null}
      {tendency ? <TrafficSources daily={insights.daily} /> : null}
      {growth ? <section className="ws-ins-block"><details><summary>用户增长每日数据</summary>
        <div className="ws-ins-detail-table"><table><thead><tr><th>日期</th><th>新关注</th><th>取消关注</th><th>净增</th></tr></thead>
          <tbody>{insights.growthDaily.map(day => <tr key={day.date}><td>{day.date}</td><td>{fmt(day.newFollows)}</td><td>{fmt(day.unfollows)}</td><td>{fmt(day.net)}</td></tr>)}</tbody>
        </table></div>
      </details></section> : null}
      {details.length ? <section className="ws-ins-block"><details open={!tendency}><summary>已导入的单篇明细（{details.length} 份）</summary>
        <div className="ws-ins-detail-links">{details.map(detail => <button className="ws-btn" type="button" key={detail.key} onClick={() => openDetail(detail.key)}>
          {detail.title}{detail.articleKey ? '' : ' · 待匹配'}
        </button>)}</div>
      </details></section> : null}

      {tendency ? <>
      <div className="ws-ins-block-head">
        <h3>文章发表范围</h3>
        <SlidingTabs activeKey={range} className="ws-tabs" role="group" aria-label="文章发表范围">
          {RANGES.map(([id, label]) => <button type="button" key={id} className={range === id ? 'is-on' : ''} aria-pressed={range === id} onClick={() => { setFilter(null); loadInsights(id) }}>{label}</button>)}
        </SlidingTabs>
      </div>
      <p className="ws-muted ws-small">{range === 'all' ? '趋势表内全部文章' : `${insights.articleRange.from} 至 ${insights.articleRange.to} 发表`} · 阅读统计 {tendency.window.from} 至 {tendency.window.to}</p>
      <section className="ws-ins-block">
        <div className="ws-ins-block-head"><h3>单篇阅读</h3><span className="ws-muted ws-small">
          {cards.withReads ? `${cards.withReads} 篇 · 平均阅读 ${fmt(cards.avgReads)} · ` : ''}按发表日期排 · 浅色为未匹配
        </span></div>
        <ArticleBars rows={insights.articles} />
      </section>

      <div className="ws-ins-compares">
        <CompareBlock title="标题套路" hint="点一条可筛选下方文章" groups={insights.compare.hook} dimension="hook" filter={filter} onPick={pick} />
        <CompareBlock title="开头横幅" hint="来自稿面记录" groups={insights.compare.banner} dimension="banner" filter={filter} onPick={pick} />
        <CompareBlock title="正文皮肤" hint="来自稿面记录" groups={insights.compare.skin} dimension="skin" filter={filter} onPick={pick} />
      </div>

      <WeekdayHeat rows={insights.articles} />

      <RulesPanel rules={insights.rules} insufficient={insights.rulesInsufficient} minSample={insights.minSample} onPreview={previewInsightRule} pending={pending} />

      <UnmatchedList rows={insights.unmatched} drafts={insights.drafts} />

      <section className="ws-ins-block">
        <div className="ws-ins-block-head ws-ins-articles-head">
          <h3>文章 <small>{rows.length}</small></h3>
          <div className="ws-ins-articles-tools">
            {filterGroup ? <button type="button" className="ws-ins-filter-chip" onClick={() => setFilter(null)}>{filterGroup.name} ✕</button> : null}
            <SlidingTabs activeKey={sort} className="ws-tabs" role="group" aria-label="排序">
              <button type="button" className={sort === 'reads' ? 'is-on' : ''} aria-pressed={sort === 'reads'} onClick={() => setSort('reads')}>按阅读</button>
              <button type="button" className={sort === 'date' ? 'is-on' : ''} aria-pressed={sort === 'date'} onClick={() => setSort('date')}>按日期</button>
            </SlidingTabs>
          </div>
        </div>
        {rows.length ? (
          <div className="ws-ins-grid">
              {rows.map(row => <ArticleCard key={row.key} row={row} drafts={insights.drafts} details={details.filter(detail => detail.articleKey === row.key)} onDetail={openDetail} />)}
          </div>
        ) : <p className="ws-muted ws-small">没有符合筛选的文章。</p>}
      </section>
      </> : null}

      {selectedDetail ? <DetailDialog key={selectedDetail.key} detail={selectedDetail} details={details} drafts={insights.drafts} experiments={experiments} targets={insights.detailTargets} pending={pending} initialSection={detailView.section} initialPeer={detailView.peer} initialExperiment={detailView.experiment} onClose={() => setDetailView(null)} /> : null}
      {preview ? <RuleDialog preview={preview} pending={pending} /> : null}
      </div>
    </main>
  )
}

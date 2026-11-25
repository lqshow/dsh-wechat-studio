import React from 'react'
import { act, copyRichText, getState, postJson, setState, toast, useStudio } from './state.js'
import { useDialogClose } from './motion.jsx'
import conceptPreview from './assets/svg-card-types/concept.webp'
import stepsPreview from './assets/svg-card-types/steps.webp'
import breakdownPreview from './assets/svg-card-types/breakdown.webp'
import comparePreview from './assets/svg-card-types/compare.webp'
import tablePreview from './assets/svg-card-types/table.webp'
import barsPreview from './assets/svg-card-types/bars.webp'
import timelinePreview from './assets/svg-card-types/timeline.webp'
import phonePreview from './assets/svg-card-types/phone.webp'

export const SVG_CARD_KINDS = ['svg-concept', 'svg-steps', 'svg-breakdown', 'svg-compare', 'svg-table', 'svg-bars', 'svg-timeline', 'svg-phone']
export const SVG_CARD_NAMES = {
  'svg-concept': '概念关系', 'svg-steps': '步骤流程', 'svg-breakdown': '句子拆解', 'svg-compare': '前后对比',
  'svg-table': '信息表格', 'svg-bars': '数值柱状图', 'svg-timeline': '时间线', 'svg-phone': '手机演示',
}
const SVG_CARD_PREVIEWS = {
  'svg-concept': conceptPreview, 'svg-steps': stepsPreview, 'svg-breakdown': breakdownPreview, 'svg-compare': comparePreview,
  'svg-table': tablePreview, 'svg-bars': barsPreview, 'svg-timeline': timelinePreview, 'svg-phone': phonePreview,
}
const SVG_CARD_DESCRIPTIONS = {
  'svg-concept': '看清新旧概念和节点关系',
  'svg-steps': '把流程拆成 3–5 个步骤',
  'svg-breakdown': '逐项拆解提示词或句子',
  'svg-compare': '左右对照以前与现在',
  'svg-table': '整理多行多列的信息',
  'svg-bars': '呈现原文已有的数值对比',
  'svg-timeline': '按时间串起关键节点',
  'svg-phone': '演示随时间变化的流程',
}

export function isSvgCardText(text) {
  return /^```(?:svg-concept|svg-steps|svg-breakdown|svg-compare|svg-table|svg-bars|svg-timeline|svg-phone)(?:\s|$)/.test(String(text ?? '').trim())
}

function previewDocument(html) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; connect-src 'none'; img-src 'none'; font-src 'none'; style-src 'unsafe-inline'"><style>html,body{margin:0;padding:0;background:transparent}section{margin:0!important}</style></head><body>${html}</body></html>`
}

export function SvgCardFrame({ html, title = '动画卡片预览', replay = 0 }) {
  const height = /viewBox="0 0 750 ([\d.]+)"/.exec(html)?.[1] ?? '500'
  return <iframe key={replay} className="ws-svg-card-frame" style={{ aspectRatio: `750 / ${height}` }} title={title}
    sandbox="" referrerPolicy="no-referrer" srcDoc={previewDocument(html)} />
}

export function SvgCardBlock({ articleId, block, layoutPreferences }) {
  const [expanded, setExpanded] = React.useState(false)
  const [html, setHtml] = React.useState(null)
  const [error, setError] = React.useState(null)
  const [loading, setLoading] = React.useState(false)
  const [retry, setRetry] = React.useState(0)
  const [replay, setReplay] = React.useState(0)
  const requestVersion = React.useRef(0)
  const cacheKey = JSON.stringify([articleId, block.id, block.text, layoutPreferences?.style, layoutPreferences?.theme])
  const title = /^```\S+\s+([^\n]+)/.exec(block.text)?.[1] ?? '动画卡片'
  React.useEffect(() => {
    requestVersion.current += 1
    setHtml(null)
    setError(null)
    setReplay(0)
  }, [cacheKey])
  React.useEffect(() => {
    if (!expanded || html || !articleId) return
    const version = ++requestVersion.current
    setLoading(true)
    setError(null)
    postJson('svg-cards/preview', { id: articleId, cardBlockId: block.id })
      .then(result => { if (requestVersion.current === version) setHtml(result.html) })
      .catch(reason => { if (requestVersion.current === version) setError(reason.message) })
      .finally(() => { if (requestVersion.current === version) setLoading(false) })
  }, [expanded, html, cacheKey, retry, articleId, block.id])
  const ensurePreview = async () => {
    if (html) return html
    const result = await postJson('svg-cards/preview', { id: articleId, cardBlockId: block.id })
    setHtml(result.html)
    return result.html
  }
  const copy = async () => {
    if (loading) return
    setLoading(true)
    setError(null)
    try {
      if (html) await copyRichText(html)
      else {
        await ensurePreview()
        toast('预览已准备好，再点一次「复制这张卡」')
      }
    } catch (reason) { setError(reason.message) }
    finally { setLoading(false) }
  }
  return <section className="ws-svg-card" aria-label={`动画卡片：${title}`}>
    <div className="ws-svg-card-compact">
      <span className="ws-tag">动画卡</span>
      <strong>{title}</strong>
      <div className="ws-svg-card-actions">
        <button type="button" className="ws-link" aria-expanded={expanded} disabled={!articleId || loading} onClick={() => setExpanded(value => !value)}>{expanded ? '收起' : '播放预览'}</button>
        {expanded && html ? <button type="button" className="ws-link" onClick={() => setReplay(value => value + 1)}>重播</button> : null}
        <button type="button" className="ws-link" disabled={!articleId || loading} onClick={copy}>复制这张卡</button>
      </div>
    </div>
    {!articleId ? <p className="ws-muted ws-small">保存后可播放和复制这张卡。</p> : null}
    {expanded && html ? <SvgCardFrame html={html} title={`动画卡片：${title}`} replay={replay} /> : null}
    {expanded && loading ? <p className="ws-shimmer" role="status">正在渲染动画卡片…</p> : null}
    {error ? <p className="ws-warn" role="status">{error}{expanded ? <button type="button" className="ws-link" onClick={() => { setError(null); setHtml(null); setRetry(value => value + 1) }}>重试</button> : null}</p> : null}
  </section>
}

function SvgCardTypeDialog({ value, onChange, onClose }) {
  const modal = React.useRef(null)
  const { closing, requestClose } = useDialogClose(onClose)
  React.useEffect(() => {
    const previous = document.activeElement
    const dialog = modal.current
    dialog.showModal()
    dialog.querySelector('[aria-checked="true"]')?.focus()
    return () => {
      if (dialog.open) dialog.close()
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [])
  const choose = kind => { onChange(kind); requestClose() }
  const navigate = event => {
    if (['Enter', ' '].includes(event.key)) {
      const kind = document.activeElement?.dataset.kind
      if (kind) { event.preventDefault(); choose(kind) }
      return
    }
    const columns = matchMedia('(max-width: 560px)').matches ? 1 : 2
    const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }
    if (!(event.key in offsets) && !['Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const focusedKind = document.activeElement?.dataset.kind
    const current = SVG_CARD_KINDS.indexOf(focusedKind ?? value)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? SVG_CARD_KINDS.length - 1 : Math.min(SVG_CARD_KINDS.length - 1, Math.max(0, current + offsets[event.key]))
    modal.current.querySelector(`[data-kind="${SVG_CARD_KINDS[next]}"]`)?.focus()
  }
  return <dialog ref={modal} className={`ws-dialog ws-svg-type-dialog${closing ? ' is-closing' : ''}`} aria-label="选择动画卡类型"
    onCancel={event => { event.preventDefault(); requestClose() }}
    onClick={event => {
      if (event.target !== event.currentTarget) return
      const bounds = event.currentTarget.getBoundingClientRect()
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) requestClose()
    }}>
    <div className="ws-dialog-head"><div><h2 className="ws-dialog-title">选择动画卡类型</h2><p className="ws-muted ws-small">示意图只展示版式，实际内容根据所选段落生成。</p></div><button type="button" className="ws-icon-btn" aria-label="关闭" onClick={requestClose}>×</button></div>
    <div className="ws-svg-type-grid" role="radiogroup" aria-label="动画卡类型" onKeyDown={navigate}>
      {SVG_CARD_KINDS.map(kind => <button type="button" key={kind} data-kind={kind} role="radio" aria-checked={value === kind} tabIndex={value === kind ? 0 : -1}
        className={`ws-svg-type-option ${value === kind ? 'is-on' : ''}`} onClick={() => choose(kind)}>
        <img src={SVG_CARD_PREVIEWS[kind]} alt={`${SVG_CARD_NAMES[kind]}版式预览`} loading="lazy" />
        <span className="ws-svg-type-name"><strong>{SVG_CARD_NAMES[kind]}</strong>{value === kind ? <span aria-hidden="true">✓</span> : null}</span>
        <span className="ws-muted ws-small">{SVG_CARD_DESCRIPTIONS[kind]}</span>
      </button>)}
    </div>
  </dialog>
}

function targetSectionCardCount(article, blockId) {
  const index = article.blocks.findIndex(block => block.id === blockId)
  if (index < 0 || !article.blocks.some(block => block.kind === 'heading')) return 0
  let start = index
  while (start > 0 && article.blocks[start].kind !== 'heading') start -= 1
  let end = index + 1
  while (end < article.blocks.length && article.blocks[end].kind !== 'heading') end += 1
  return article.blocks.slice(start, end).filter(block => isSvgCardText(block.text)).length
}

export function SvgCardsPane({ article, reviewTarget, unsavedCount, onReviewJump }) {
  const editing = useStudio(s => s.editing)
  const pending = useStudio(s => s.pending)
  const candidate = useStudio(s => s.svgCardCandidate?.articleId === article.id ? s.svgCardCandidate : null)
  const targets = article.blocks.filter(block => !isSvgCardText(block.text))
  const preferred = reviewTarget ?? editing
  const [blockId, setBlockId] = React.useState(targets.some(block => block.id === preferred) ? preferred : targets[0]?.id ?? '')
  const [kind, setKind] = React.useState('svg-steps')
  const [typeOpen, setTypeOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(null)
  const [error, setError] = React.useState(null)
  const [insertedBlockId, setInsertedBlockId] = React.useState(null)
  const [preview, setPreview] = React.useState(null)
  const [replay, setReplay] = React.useState(0)
  const previewVersion = React.useRef(0)
  const card = candidate?.card
  const cardCount = article.blocks.filter(block => isSvgCardText(block.text)).length
  const sectionCount = targetSectionCardCount(article, blockId)
  const candidateIndex = candidate ? article.blocks.findIndex(block => block.id === candidate.blockId) : -1
  const candidateTarget = candidateIndex >= 0 ? article.blocks[candidateIndex] : null
  const currentIndex = article.blocks.findIndex(block => block.id === blockId)
  const selectionChanged = Boolean(candidate && (candidate.blockId !== blockId || candidate.card.kind !== kind))
  const targetKey = targets.map(block => block.id).join('\u0001')
  React.useEffect(() => {
    if (!targets.some(block => block.id === blockId)) setBlockId(targets[0]?.id ?? '')
  }, [targetKey, blockId])
  const previewKey = JSON.stringify([card, article.effectiveLayoutPreferences?.style, article.effectiveLayoutPreferences?.theme])
  React.useEffect(() => { previewVersion.current += 1; setPreview(null); setReplay(0) }, [previewKey])
  const generate = async () => {
    if (!blockId || busy) return
    setBusy('draft')
    setError(null)
    try {
      const result = await postJson('svg-cards/draft', { id: article.id, blockId, kind })
      setState({ svgCardCandidate: { ...result, operationId: crypto.randomUUID() } })
      setPreview(null)
    } catch (reason) { setError(reason.message) }
    finally { setBusy(null) }
  }
  const updateCard = patch => {
    setError(null)
    setState(s => ({ svgCardCandidate: { ...s.svgCardCandidate, card: { ...s.svgCardCandidate.card, ...patch } } }))
  }
  const renderPreview = async () => {
    if (!card || busy) return null
    setBusy('preview')
    setError(null)
    const version = ++previewVersion.current
    const key = previewKey
    try {
      const result = await postJson('svg-cards/preview', { ...candidate, card })
      if (previewVersion.current !== version || previewKey !== key) return null
      setPreview({ html: result.html, key })
      return result.html
    } catch (reason) { setError(reason.message); return null }
    finally { setBusy(null) }
  }
  const copy = async () => {
    if (preview?.key === previewKey) return copyRichText(preview.html)
    const html = await renderPreview()
    if (html) toast('预览已准备好，再点一次「复制这张卡」')
  }
  const insert = async () => {
    if (!candidate || !card || busy || selectionChanged || !candidateTarget) return
    setBusy('insert')
    setError(null)
    const targetId = candidate.blockId
    const ok = await act('svg-cards/insert', { ...candidate, card, operationId: candidate.operationId })
    if (ok) {
      const blocks = getState().data.current?.blocks ?? []
      const targetIndex = blocks.findIndex(block => block.id === targetId)
      const inserted = blocks[targetIndex + 1]
      setInsertedBlockId(inserted && isSvgCardText(inserted.text) ? inserted.id : null)
      setState({ svgCardCandidate: null })
      setPreview(null)
      toast('已插入动画卡片，可在正文播放预览')
    }
    setBusy(null)
  }
  return <section className="ws-sec ws-svg-pane">
    <div className="ws-sec-head"><h2 className="ws-pane-title">动画卡片</h2><span className="ws-muted ws-small">{cardCount}/3 张</span></div>
    <p className="ws-muted ws-small">选段与卡型 → 生成 → 预览 → 插入正文。只保存 Markdown 卡片，不调用生图接口。</p>
    {unsavedCount ? <p className="ws-warn">有 {unsavedCount} 段未保存修改，生成只读取已保存正文。</p> : null}
    {cardCount >= 3 ? <p className="ws-warn">这篇已有 {cardCount} 张动画卡，超过一篇最多 3 张的节奏建议，仍可由你决定是否继续。</p> : null}
    {sectionCount ? <p className="ws-warn">这一节已有动画卡，建议同一节最多一张；继续生成不会自动插入。</p> : null}
    <label className="ws-field">插入到段落后
      <select aria-label="动画卡目标段落" value={blockId} disabled={Boolean(busy)} onChange={event => setBlockId(event.target.value)}>
        {targets.map(block => {
          const index = article.blocks.indexOf(block)
          return <option key={block.id} value={block.id}>第 {index + 1} 段 · {block.text.replace(/\s+/g, ' ').slice(0, 42)}</option>
        })}
      </select>
    </label>
    <div className="ws-field">卡片类型
      <button type="button" className="ws-svg-type-current" disabled={Boolean(busy)} onClick={() => setTypeOpen(true)}>
        <img src={SVG_CARD_PREVIEWS[kind]} alt="" />
        <span><strong>{SVG_CARD_NAMES[kind]}</strong><small>{SVG_CARD_DESCRIPTIONS[kind]}</small><code>{kind}</code></span>
        <span className="ws-link">更改卡型</span>
      </button>
    </div>
    {typeOpen ? <SvgCardTypeDialog value={kind} onChange={setKind} onClose={() => setTypeOpen(false)} /> : null}
    <button type="button" className="ws-btn is-primary" disabled={!blockId || Boolean(busy) || Boolean(pending)} onClick={generate}>{busy === 'draft' ? '正在生成…' : card ? '重新生成候选' : '生成一张卡片'}</button>
    {error ? <p className="ws-warn" role="status">{error}</p> : null}
    {insertedBlockId ? <div className="ws-svg-inserted" role="status">
      <span>动画卡已插入，当前位置保持不变。</span>
      <button type="button" className="ws-link" onClick={() => { onReviewJump(insertedBlockId); setInsertedBlockId(null) }}>定位到动画卡</button>
      <button type="button" className="ws-icon-btn" aria-label="关闭插入提示" onClick={() => setInsertedBlockId(null)}>×</button>
    </div> : null}
    {card ? <div className="ws-svg-candidate">
      <div className="ws-svg-candidate-head"><strong>候选 · {SVG_CARD_NAMES[card.kind]}</strong><span className="ws-muted ws-small">确认插入前不会改正文</span></div>
      <div className="ws-svg-candidate-target">
        <div><strong>{candidateTarget ? `实际插入：第 ${candidateIndex + 1} 段后` : '原目标段落已删除'}</strong><span className={preview?.key === previewKey ? 'ws-svg-preview-ready' : 'ws-muted'}>{preview?.key === previewKey ? '已预览当前版本' : '未预览当前版本'}</span></div>
        {candidateTarget ? <p>{candidateTarget.text.replace(/\s+/g, ' ').slice(0, 140)}</p> : null}
      </div>
      {selectionChanged || !candidateTarget ? <div className="ws-svg-candidate-mismatch" role="alert">
        <p>{!candidateTarget ? '候选仍保留，但原目标已不存在，不能插入。' : `当前选择是第 ${currentIndex + 1} 段＋${SVG_CARD_NAMES[kind]}，与候选绑定不同。候选编辑已保留，恢复或重新生成后才能插入。`}</p>
        <div>
          <button type="button" className="ws-btn" disabled={!candidateTarget || Boolean(busy)} onClick={() => { setBlockId(candidate.blockId); setKind(card.kind) }}>恢复原选择</button>
          <button type="button" className="ws-btn" disabled={!blockId || Boolean(busy)} onClick={generate}>按当前选择重新生成</button>
        </div>
      </div> : null}
      <label className="ws-field">卡片标题<input aria-label="动画卡标题" value={card.title} disabled={Boolean(busy)} onChange={event => updateCard({ title: event.target.value })} /></label>
      <div className="ws-svg-line-editor">
        {card.lines.map((line, index) => <label key={index}>条目 {index + 1}<input aria-label={`动画卡条目 ${index + 1}`} value={line} disabled={Boolean(busy)} onChange={event => updateCard({ lines: card.lines.map((item, itemIndex) => itemIndex === index ? event.target.value : item) })} /></label>)}
      </div>
      {card.kind === 'svg-bars' ? <p className="ws-svg-numeric-note">第 2 列控制柱长，第 3 列是显示文案；两者数值必须一致。系统无法判断指标之间的业务关系，请作者核对。</p> : null}
      <div className="ws-svg-candidate-actions">
        <button type="button" className="ws-btn" disabled={Boolean(busy)} onClick={renderPreview}>{busy === 'preview' ? '正在渲染…' : '预览更新'}</button>
        <button type="button" className="ws-btn" disabled={Boolean(busy)} onClick={copy}>复制这张卡</button>
        <button type="button" className="ws-btn is-primary" disabled={Boolean(busy) || Boolean(pending) || selectionChanged || !candidateTarget} onClick={insert}>{busy === 'insert' ? '正在插入…' : '插入正文'}</button>
      </div>
      {preview?.key === previewKey ? <>
        <SvgCardFrame html={preview.html} title={`候选动画卡：${card.title}`} replay={replay} />
        <button type="button" className="ws-link" onClick={() => setReplay(value => value + 1)}>重播</button>
      </> : <p className="ws-muted ws-small">修改候选后点击「预览更新」，确认实际标题、条目和配色。</p>}
    </div> : null}
  </section>
}

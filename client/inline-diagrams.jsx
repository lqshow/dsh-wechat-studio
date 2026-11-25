import React from 'react'
import { COVER_PROVIDERS, modelsFor, providerMeta } from '../src/cover-options.js'
import notebookPreview from './assets/inline-styles/notebook.webp'
import infographicPreview from './assets/inline-styles/infographic.webp'
import whiteboardPreview from './assets/inline-styles/whiteboard-sketch.webp'
import cozyPreview from './assets/inline-styles/cozy-handdrawn.webp'
import doodlePreview from './assets/inline-styles/tech-doodle.webp'
import cartoonPreview from './assets/inline-styles/cartoon-infographic.webp'
import saasPreview from './assets/inline-styles/saas-flat.webp'
import { act, loadSettings, setState, useStudio } from './state.js'
import { useDialogClose } from './motion.jsx'

const INLINE_STYLE_PREVIEWS = {
  notebook: notebookPreview,
  infographic: infographicPreview,
  'whiteboard-sketch': whiteboardPreview,
  'cozy-handdrawn': cozyPreview,
  'tech-doodle': doodlePreview,
  'cartoon-infographic': cartoonPreview,
  'saas-flat': saasPreview,
}

const KIND_NAMES = { concept: '概念图', flow: '流程图', comparison: '对比图', architecture: '架构图' }
const STATUS_NAMES = { suggested: '待生成', generating: '生成中', generated: '待插入', failed: '生成失败', interrupted: '已中断', inserted: '已插入' }
const IMAGE_PROVIDERS = Object.fromEntries(COVER_PROVIDERS.map(item => [item.id, item.name]))

function imageUrl(article, diagram, download = false) {
  return `wechat-studio/inline-diagrams/image?${new URLSearchParams({ id: article.id, asset: diagram.assetId, diagram: diagram.id, ...(download ? { download: '1' } : {}) })}`
}

function openDialog(mode, diagramId) {
  setState({ dialog: { type: 'inline-diagram', mode, diagramId } })
}

function openSettings(page) {
  setState({ dialog: 'settings', settingsPage: page })
}

function InlineModal({ label, children, onClose, className = '' }) {
  const modal = React.useRef(null)
  const { closing, requestClose } = useDialogClose(onClose)
  React.useEffect(() => {
    const previous = document.activeElement
    const dialog = modal.current
    dialog.showModal()
    return () => {
      if (dialog.open) dialog.close()
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [])
  return <dialog ref={modal} className={`ws-dialog ws-inline-dialog ${className}${closing ? ' is-closing' : ''}`} aria-label={label}
    onCancel={event => { event.preventDefault(); requestClose() }}
    onClick={event => {
      if (event.target !== event.currentTarget) return
      const bounds = event.currentTarget.getBoundingClientRect()
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) requestClose()
    }}>
    {typeof children === 'function' ? children(requestClose) : children}
  </dialog>
}

function CloseButton({ onClose }) {
  return <button type="button" className="ws-icon-btn" aria-label="关闭" onClick={onClose}>×</button>
}

function DiagramCard({ article, diagram, onReviewJump }) {
  const pending = useStudio(s => s.pending)
  const busy = Boolean(article.inlineDiagramJob)
  const analyzable = ['suggested', 'failed', 'interrupted'].includes(diagram.status)
  const canGenerate = analyzable && !diagram.pendingAnalysis
  const hasImage = Boolean(diagram.assetId)
  const styleName = article.inlineDiagramStyles?.find(style => style.id === diagram.style)?.name
  return <article className={`ws-inline-card is-${diagram.status}`}>
    <div className="ws-inline-card-head">
      <strong>{diagram.anchorNumber ? `第 ${diagram.anchorNumber} 段后` : '原段落已删除'} · {KIND_NAMES[diagram.kind] ?? diagram.kind}</strong>
      <span>{diagram.pendingAnalysis ? '待分析' : STATUS_NAMES[diagram.status] ?? diagram.status}</span>
    </div>
    <h3>{diagram.title}</h3>
    <p>{diagram.reason}</p>
    {diagram.anchorExcerpt ? <p className="ws-inline-excerpt">{diagram.anchorExcerpt}</p> : null}
    {diagram.pendingAnalysis ? <p className="ws-warn">位置已更换，请按新段落刷新建议后再生图。</p>
      : diagram.stale && diagram.status !== 'inserted' ? <p className="ws-warn">段落已改动{hasImage ? '，插入时需要确认是否继续使用这张旧图。' : '，请刷新这条建议。'}</p> : null}
    {diagram.error ? <p className="ws-warn" role="status">{diagram.error}</p> : null}
    {hasImage ? <button type="button" className="ws-inline-thumb" onClick={() => openDialog('preview', diagram.id)} aria-label={`预览大图：${diagram.title}`}>
      <img src={imageUrl(article, diagram)} alt={diagram.title} loading="lazy" decoding="async" />
    </button> : null}
    {styleName || diagram.provider ? <p className="ws-muted ws-small">{[styleName, IMAGE_PROVIDERS[diagram.provider], diagram.model].filter(Boolean).join(' · ')}</p> : null}
    <div className="ws-inline-actions">
      {diagram.status === 'inserted' && diagram.insertedBlockExists ? <button type="button" className="ws-link" onClick={() => onReviewJump(diagram.insertedBlockId)}>定位到图片</button>
        : diagram.anchorNumber ? <button type="button" className="ws-link" onClick={() => onReviewJump(diagram.anchorId)}>定位到正文</button> : null}
      {!diagram.anchorNumber && diagram.status !== 'inserted' ? <button type="button" className="ws-link" disabled={busy || Boolean(pending)} onClick={() => openDialog('reanchor', diagram.id)}>重新选位置</button> : null}
      {canGenerate && diagram.anchorNumber ? <button type="button" className="ws-link" disabled={busy || pending === 'inline-diagrams/generate'} onClick={() => openDialog('generate', diagram.id)}>
        {diagram.status === 'suggested' ? '生成插图' : '重试生成'}
      </button> : null}
      {analyzable && (diagram.pendingAnalysis || diagram.stale) && diagram.anchorNumber ? <button type="button" className="ws-link" disabled={busy || Boolean(pending)} onClick={() => act('inline-diagrams/analyze', { id: article.id, blockId: diagram.anchorId })}>刷新建议</button> : null}
      {diagram.status === 'generated' && diagram.anchorNumber ? <button type="button" className="ws-link" disabled={busy || pending === 'inline-diagrams/insert'} onClick={() => openDialog('insert', diagram.id)}>插入正文</button> : null}
      {hasImage ? <a className="ws-link" href={imageUrl(article, diagram, true)} download={`${diagram.title || '正文插图'}.png`}>下载</a> : null}
      {!['inserted', 'generating'].includes(diagram.status) ? <>
        <button type="button" className="ws-link" disabled={busy || Boolean(pending)} onClick={() => act('inline-diagrams/ignore', { id: article.id, diagramId: diagram.id })}>忽略</button>
        <button type="button" className="ws-link" disabled={busy || Boolean(pending)} onClick={() => act('inline-diagrams/delete', { id: article.id, diagramId: diagram.id })}>删除</button>
      </> : null}
    </div>
    {diagram.status === 'generating' ? <p className="ws-shimmer" role="status">正在按所选风格生成一张插图，正文可以继续编辑…</p> : null}
  </article>
}

export function InlineDiagramPane({ article, cloudinaryReady, onReviewJump, unsavedCount }) {
  const pending = useStudio(s => s.pending)
  const diagrams = article.inlineDiagrams ?? []
  const active = diagrams.filter(item => item.status !== 'ignored')
  const ignored = diagrams.filter(item => item.status === 'ignored')
  const busy = Boolean(article.inlineDiagramJob)
  return <section className="ws-sec ws-inline-pane">
    <div className="ws-sec-head">
      <h2 className="ws-pane-title">正文插图</h2>
      <div className="ws-cover-actions">
        <button type="button" className="ws-link" disabled={busy || Boolean(pending) || unsavedCount > 0 || !article.blocks.length} onClick={() => act('inline-diagrams/analyze', { id: article.id })}>分析正文</button>
        <button type="button" className="ws-link" disabled={busy || Boolean(pending) || unsavedCount > 0 || !article.blocks.length} onClick={() => setState({ dialog: { type: 'inline-diagram', mode: 'blocks' } })}>指定段落</button>
      </div>
    </div>
    <p className="ws-muted ws-small">先建议，再由你决定生成和插入。插入正文时会上传到已配置的图床。</p>
    {unsavedCount ? <p className="ws-warn">有 {unsavedCount} 段未保存修改。分析只读取已保存正文，请先保存。</p> : null}
    {article.inlineDiagramJob?.kind === 'analyze' ? <p className="ws-shimmer" role="status">正在分析已保存正文，不会生成图片或修改稿件…</p> : null}
    {article.inlineDiagramJob?.kind === 'insert' ? <p className="ws-shimmer" role="status">{article.inlineDiagramJob.stage === 'inserting' ? '正在确认锚点并插入…' : '正在上传图床并核对段落…'}</p> : null}
    {article.inlineDiagramMessage ? <p className={article.inlineDiagramMessage.error ? 'ws-warn' : 'ws-muted ws-small'} role="status">{article.inlineDiagramMessage.text}</p> : null}
    {article.inlineDiagramStyleWarnings?.map((warning, index) => <p className="ws-warn" role="status" key={index}>{warning}</p>)}
    {!cloudinaryReady && active.some(item => item.assetId && !item.publicUrl) ? <p className="ws-hint">图床尚未配置，未上传的生成图仍保留在本机。<button type="button" className="ws-link" onClick={() => openSettings('storage')}>去设置</button></p> : null}
    <div className="ws-inline-list">
      {active.map(diagram => <DiagramCard key={diagram.id} article={article} diagram={diagram} onReviewJump={onReviewJump} />)}
    </div>
    {!active.length && !busy ? <p className="ws-muted ws-small">还没有插图建议。短稿没有值得配图的位置时，不会强行凑图。</p> : null}
    {ignored.length ? <details className="ws-manual ws-inline-ignored">
      <summary>已忽略（{ignored.length}）</summary>
      {ignored.map(diagram => <div className="ws-inline-ignored-row" key={diagram.id}>
        <span>{diagram.title} · {KIND_NAMES[diagram.kind] ?? diagram.kind}</span>
        <span>
          <button type="button" className="ws-link" disabled={busy || Boolean(pending)} onClick={() => act('inline-diagrams/restore', { id: article.id, diagramId: diagram.id })}>恢复</button>
          <button type="button" className="ws-link" disabled={busy || Boolean(pending)} onClick={() => act('inline-diagrams/delete', { id: article.id, diagramId: diagram.id })}>删除</button>
        </span>
      </div>)}
    </details> : null}
  </section>
}

function GenerateDialog({ article, diagram, onClose }) {
  const settings = useStudio(s => s.settings)
  const styles = article.inlineDiagramStyles ?? []
  const [style, setStyle] = React.useState(styles.some(item => item.id === diagram.style) ? diagram.style : styles[0]?.id)
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => { loadSettings() }, [])
  const provider = settings?.coverProvider
  const meta = provider ? providerMeta(provider) : null
  const keyReady = meta ? settings?.[meta.keySetField] : false
  const model = meta ? settings?.[meta.modelField] : null
  const modelName = modelsFor(provider).find(item => item.id === model)?.name ?? model
  const submit = async event => {
    event.preventDefault()
    if (!style || !keyReady || busy) return
    setBusy(true)
    const ok = await act('inline-diagrams/generate', { id: article.id, diagramId: diagram.id, style })
    setBusy(false)
    if (ok) onClose()
  }
  return <InlineModal label="生成正文插图" onClose={onClose} className="ws-inline-generate-dialog">
    {requestClose => <form onSubmit={submit}>
      <div className="ws-dialog-head"><h2 className="ws-dialog-title">生成插图</h2><CloseButton onClose={requestClose} /></div>
      <p>{diagram.title}</p>
      <fieldset className="ws-inline-style-gallery" disabled={busy}>
        <legend>插图风格</legend>
        <div className="ws-inline-style-grid">
          {styles.map(item => <label key={item.id} className={`ws-inline-style-choice ${style === item.id ? 'is-on' : ''}`}>
            <input type="radio" name="inline-diagram-style" value={item.id} checked={style === item.id} onChange={() => setStyle(item.id)} />
            <span className="ws-inline-style-body">
              {INLINE_STYLE_PREVIEWS[item.id] ? <img src={INLINE_STYLE_PREVIEWS[item.id]} alt={`${item.name}预览`} loading="lazy" />
                : <span className="ws-inline-style-fallback"><strong>{item.name}</strong><small>扩展风格 · 无预览图</small></span>}
              <strong>{item.name}</strong>
            </span>
          </label>)}
        </div>
      </fieldset>
      {settings ? <p className="ws-muted ws-small">本次提供方：{IMAGE_PROVIDERS[provider]} · {modelName} · 16:9 PNG</p> : <p className="ws-shimmer">正在读取生图设置…</p>}
      {settings && !keyReady ? <p className="ws-warn">当前提供方还没有 API Key。<button type="button" className="ws-link" onClick={() => openSettings('cover')}>去设置</button></p> : null}
      <p className="ws-muted ws-small">点击生成才会调用生图接口；只生成一张，不上传图床，也不修改正文。</p>
      <div className="ws-dialog-foot"><button type="button" className="ws-btn" disabled={busy} onClick={requestClose}>取消</button><button type="submit" className="ws-btn is-primary" disabled={!style || !keyReady || busy}>{busy ? '正在提交…' : '生成插图'}</button></div>
    </form>}
  </InlineModal>
}

function BlockDialog({ article, diagram, onClose }) {
  const [blockId, setBlockId] = React.useState(article.blocks.some(block => block.id === diagram?.anchorId) ? diagram.anchorId : article.blocks[0]?.id)
  const [busy, setBusy] = React.useState(false)
  const submit = async event => {
    event.preventDefault()
    if (!blockId || busy) return
    setBusy(true)
    const ok = await act(diagram ? 'inline-diagrams/reanchor' : 'inline-diagrams/analyze', { id: article.id, blockId, ...(diagram ? { diagramId: diagram.id } : {}) })
    setBusy(false)
    if (ok) onClose()
  }
  return <InlineModal label={diagram ? '重新选择插图位置' : '指定段落分析'} onClose={onClose}>
    {requestClose => <form onSubmit={submit}>
      <div className="ws-dialog-head"><h2 className="ws-dialog-title">{diagram ? '重新选位置' : '指定段落'}</h2><CloseButton onClose={requestClose} /></div>
      {diagram?.assetId ? <p className="ws-warn">只改变插入位置，旧图不会根据新段落重新生成。</p> : <p className="ws-muted ws-small">只分析所选段落的已保存内容，最多补充一条建议。</p>}
      <div className="ws-inline-block-picker">
        {article.blocks.map((block, index) => <label key={block.id} className={blockId === block.id ? 'is-on' : ''}>
          <input type="radio" name="inline-block" value={block.id} checked={blockId === block.id} onChange={() => setBlockId(block.id)} />
          <strong>第 {index + 1} 段</strong><span>{block.text.replace(/\s+/g, ' ').slice(0, 140)}</span>
        </label>)}
      </div>
      <div className="ws-dialog-foot"><button type="button" className="ws-btn" disabled={busy} onClick={requestClose}>取消</button><button type="submit" className="ws-btn is-primary" disabled={!blockId || busy}>{busy ? '正在提交…' : diagram ? '保存位置' : '分析这一段'}</button></div>
    </form>}
  </InlineModal>
}

function InsertDialog({ article, diagram, cloudinaryReady, onClose }) {
  const [acceptStale, setAcceptStale] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const canInsert = cloudinaryReady || Boolean(diagram.publicUrl)
  const submit = async event => {
    event.preventDefault()
    if (!canInsert || !diagram.currentAnchorHash || (diagram.stale && !acceptStale) || busy) return
    setBusy(true)
    const ok = await act('inline-diagrams/insert', { id: article.id, diagramId: diagram.id, expectedAnchorHash: diagram.currentAnchorHash, acceptStale })
    setBusy(false)
    if (ok) onClose()
  }
  return <InlineModal label="确认插入正文插图" onClose={onClose}>
    {requestClose => <form onSubmit={submit}>
      <div className="ws-dialog-head"><h2 className="ws-dialog-title">确认插入正文</h2><CloseButton onClose={requestClose} /></div>
      <img className="ws-inline-confirm-image" src={imageUrl(article, diagram)} alt={diagram.title} />
      <div className="ws-inline-target"><strong>插入到第 {diagram.anchorNumber} 段后</strong><p>{diagram.anchorExcerpt}</p></div>
      <p className="ws-muted ws-small">{diagram.publicUrl ? '这张图片已有可发表的 Cloudinary 地址，本次直接复用，不会重复上传。' : '图床去向：已配置的 Cloudinary。取得可发表的 HTTPS 地址后，才会在正文中插入普通 Markdown 图片。'}</p>
      {diagram.stale ? <label className="ws-inline-stale"><input type="checkbox" checked={acceptStale} onChange={event => setAcceptStale(event.target.checked)} />段落已改动，我确认继续使用这张按原文生成的旧图</label> : null}
      {!canInsert ? <p className="ws-warn">尚未配置图床。图片已保留，配置后可以直接插入。<button type="button" className="ws-link" onClick={() => openSettings('storage')}>去设置</button></p> : null}
      <div className="ws-dialog-foot">
        <a className="ws-btn" href={imageUrl(article, diagram, true)} download={`${diagram.title || '正文插图'}.png`}>下载生成图</a>
        <button type="button" className="ws-btn" disabled={busy} onClick={requestClose}>取消</button>
        <button type="submit" className="ws-btn is-primary" disabled={!canInsert || (diagram.stale && !acceptStale) || busy}>{busy ? '正在上传并核对…' : '确认插入'}</button>
      </div>
    </form>}
  </InlineModal>
}

export function InlineDiagramDialog({ article, cloudinaryReady }) {
  const dialog = useStudio(s => s.dialog)
  const onClose = () => setState({ dialog: null })
  const diagram = dialog.diagramId ? article.inlineDiagrams?.find(item => item.id === dialog.diagramId) : null
  if (dialog.mode === 'blocks') return <BlockDialog article={article} onClose={onClose} />
  if (!diagram) return null
  if (dialog.mode === 'reanchor') return <BlockDialog article={article} diagram={diagram} onClose={onClose} />
  if (dialog.mode === 'generate') return <GenerateDialog article={article} diagram={diagram} onClose={onClose} />
  if (dialog.mode === 'insert') return <InsertDialog article={article} diagram={diagram} cloudinaryReady={cloudinaryReady} onClose={onClose} />
  return <InlineModal label={`预览插图：${diagram.title}`} onClose={onClose} className="ws-inline-preview-dialog">
    {requestClose => <>
      <div className="ws-dialog-head"><h2 className="ws-dialog-title">{diagram.title}</h2><CloseButton onClose={requestClose} /></div>
      <img className="ws-inline-full-image" src={imageUrl(article, diagram)} alt={diagram.title} />
      <div className="ws-dialog-foot"><a className="ws-btn" href={imageUrl(article, diagram, true)} download={`${diagram.title || '正文插图'}.png`}>下载 PNG</a><button type="button" className="ws-btn" onClick={requestClose}>关闭</button></div>
    </>}
  </InlineModal>
}

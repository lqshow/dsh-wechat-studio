import { blockKind, parseMarkdownImage, plainOf, splitMarkdown } from '../src/article.js'
import { DEFAULT_GALLERY_LABEL, galleryColors, parseGalleryBlock } from '../src/gallery.js'
import magentaPreview from './assets/cover-styles/magenta.webp'
import { COVER_PROVIDERS, modelsFor, providerFormats, providerMeta, COVER_RESOLUTIONS, MAX_COVER_COUNT } from '../src/cover-options.js'
import classicPreview from './assets/cover-styles/classic.webp'
import editorialPreview from './assets/cover-styles/editorial.webp'
import campaignPreview from './assets/cover-styles/campaign.webp'
import kineticPreview from './assets/cover-styles/kinetic.webp'
import grungePreview from './assets/cover-styles/grunge.webp'
import feltPreview from './assets/cover-styles/felt.webp'
import { COVER_STYLES, CUSTOM_COVER_STYLE_LIMITS, resolveCoverStyleName } from '../src/cover-styles.js'
// 稿面：左边对话改稿，中间是稿子和纸边批注，右边是标题、朱雀质检和导出。
import React from 'react'
import { cardMarkdown, emphasisFormats, formatSelection, insertFormats } from './editor-format.js'
import { act, copyDetectionText, copyMarkdown, copyText, countCurrentParagraphDrafts, deleteCustomCoverStyle, getState, loadCoverStyles, loadLayout, loadModels, loadRevisions, loadSettings, loadSkills, loadStyleProfile, loadVersion, openCustomCoverStyleWizard, openStyleWizard, previewMarkdownReimport, reimportMarkdown, rememberArticleView, saveSettings, setState, testWechat, testZhuque, toast, uploadImage, uploadPortrait, uploadReport, useStudio } from './state.js'
import { CustomCoverStyleCard, CustomCoverStyleWizard, CustomCoverTestBanner } from './custom-cover-style.jsx'
import { hasUnsavedDeriveDrafts } from './derive-draft-model.js'
import { DeriveView } from './derive.jsx'
import { isDraftReady, readMinutes, summarizeDraftHome } from './draft-home-model.js'
import { FeedCardPreview } from './feed-preview.jsx'
import { InsightsView } from './insights.jsx'
import { InlineDiagramDialog, InlineDiagramPane } from './inline-diagrams.jsx'
import { MarkdownImportFields } from './markdown-import.jsx'
import { ScheduleView } from './schedule.jsx'
import { isSvgCardText, SvgCardBlock, SvgCardsPane } from './svg-cards.jsx'
import { WritingStyleCard, WritingStyleWizard } from './writing-style.jsx'

const ICONS = {
  check: 'M3 8.5l3.2 3.2L13 5',
  send: 'M8 13V3M3.5 7.5L8 3l4.5 4.5',
  plus: 'M8 3v10M3 8h10',
  undo: 'M6 4L2.5 7.5 6 11M3 7.5h6.5a3.5 3.5 0 010 7H8',
  chat: 'M2.5 3.5h11v7.5h-6L4.5 13.5v-2.5h-2z',
  down: 'M4 6l4 4 4-4',
  close: 'M4 4l8 8M12 4l-8 8',
  doc: 'M4 2h5.5L12.5 5v9H4zM6.5 8h4M6.5 10.5h4',
  upload: 'M8 11V3M4.5 6.5L8 3l3.5 3.5M3 13h10',
  materials: 'M2.5 2.5h4.5v4.5h-4.5zM9 3.5h4.5v4.5H9zM3.5 9H8v4.5H3.5z',
  schedule: 'M2.5 3.5h11v10h-11zM2.5 6.5h11M5.5 2v3M10.5 2v3',
  insights: 'M2.5 13.5h11M3.5 10.5l3-3.5 2.5 2 4-5',
  skills: 'M8 2l5.5 3v6L8 14l-5.5-3V5zM2.5 5L8 8l5.5-3M8 8v6',
  gear: 'M8 5.6a2.4 2.4 0 100 4.8 2.4 2.4 0 000-4.8zM8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M12.4 3.6l-1.2 1.2M4.8 11.2l-1.2 1.2',
  scan: 'M2.5 5.5v-3h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3M5 8h6',
  key: 'M5.5 5a3 3 0 100 6 3 3 0 000-6zM8.5 8h5.5M11.5 8v2.2M14 8v2.2',
  search: 'M7 2.5a4.5 4.5 0 100 9 4.5 4.5 0 000-9zM10.4 10.4L13.5 13.5',
  spark: 'M7 2l1.3 3.7L12 7l-3.7 1.3L7 12l-1.3-3.7L2 7l3.7-1.3zM12.5 10.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z',
  user: 'M8 8.2a2.8 2.8 0 100-5.6 2.8 2.8 0 000 5.6zM3.2 13.5a4.8 4.8 0 019.6 0',
}

export function Icon({ name, size = 16 }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={ICONS[name]} /></svg>
}

/** 行内 Markdown：加粗、色块强调、行内代码，以及 [可补：…] [截图：…] 这类待办占位。 */
function inline(text) {
  const parts = []
  const pattern = /(\*\*[^*\n]+\*\*|==[^=\n]+==|\+\+[^+\n]+\+\+|`[^`\n]+`|\[(?:可补|截图|可选)[：:][^\]\n]*\])/g
  let last = 0
  let match
  while ((match = pattern.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    const token = match[0]
    const key = parts.length
    if (token.startsWith('**')) parts.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    else if (token.startsWith('==')) parts.push(<mark key={key}>{token.slice(2, -2)}</mark>)
    else if (token.startsWith('++')) parts.push(<u key={key}>{token.slice(2, -2)}</u>)
    else if (token.startsWith('`')) parts.push(<code key={key}>{token.slice(1, -1)}</code>)
    else parts.push(<span key={key} className="ws-todo">{token}</span>)
    last = match.index + token.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

function PaperImage({ src, caption, long }) {
  const [failed, setFailed] = React.useState(false)
  const description = caption && !/^image$/i.test(caption.trim()) ? caption : ''
  let usable = false
  try {
    const url = new URL(src)
    usable = ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
  } catch {
    // A local path or unfilled template has no browser-accessible source.
  }
  if (!usable || failed) {
    return <div className="ws-media">
      <span className="ws-tag">{long ? '长图卡' : '图片'}</span> {description || (failed ? '图片加载失败' : '图片地址不可预览')}
      {description ? <span className="ws-media-hint">{failed ? '图片加载失败' : '图片地址不可预览'}</span> : null}
    </div>
  }
  return <div className={`ws-paper-image${long ? ' is-long' : ''}`}>
    <img src={src} alt={description || (long ? '正文长图' : '正文图片')} loading="lazy" decoding="async"
      referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    {description ? <span className="ws-paper-caption">{description}</span> : null}
  </div>
}

function PaperGallerySlide({ item, index, total }) {
  const [failed, setFailed] = React.useState(false)
  const caption = item.caption.trim()
  const description = /^(image|img|图片)$/i.test(caption) ? '' : caption
  let usable = false
  try {
    const url = new URL(item.src)
    usable = ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
  } catch {
    // Unpreviewable URL falls back to placeholder card.
  }
  return <div className={`ws-paper-gallery-item${total === 1 ? ' is-single' : ''}`}>
    {usable && !failed ? (
      <img src={item.src} alt={description || `图集第 ${index + 1} 张`} loading="lazy" decoding="async"
        referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    ) : (
      <div className="ws-media ws-paper-gallery-fallback">
        <span className="ws-tag">图集</span> {description || (failed ? '图片加载失败' : '图片地址不可预览')}
      </div>
    )}
    {description ? <span className="ws-paper-gallery-caption">{description}</span> : null}
  </div>
}

function PaperGallery({ gallery, layoutStyle, palette }) {
  const { label, items } = gallery
  const { badgeBg, badgeText, countColor } = galleryColors(layoutStyle, palette)
  return <div className={`ws-paper-gallery${layoutStyle === 'dark' ? ' is-dark' : ''}`}
    style={{ '--gallery-badge-bg': badgeBg, '--gallery-badge-text': badgeText, '--gallery-count': countColor }}>
    <div className="ws-paper-gallery-head">
      <span className={`ws-paper-gallery-badge${layoutStyle === 'zen' ? ' is-zen' : ''}`}>{label || DEFAULT_GALLERY_LABEL}</span>
      <span className="ws-paper-gallery-hint">{items.length} 张{items.length > 1 ? ' · 左右滑动 →' : ''}</span>
    </div>
    <div className="ws-paper-gallery-track">
      {items.map((item, index) => <PaperGallerySlide key={`${item.src}-${index}`} item={item} index={index} total={items.length} />)}
    </div>
  </div>
}

function BlockBody({ block, sectionNumber, articleId, layoutPreferences, palette }) {
  const { kind, text } = block
  if (kind === 'code' && isSvgCardText(text)) return <SvgCardBlock articleId={articleId} block={block} layoutPreferences={layoutPreferences} />
  if (kind === 'heading') {
    const level = /^#+/.exec(text)[0].length
    const heading = text.replace(/^#+\s+/, '')
    if (level === 2 && sectionNumber) {
      const number = String(sectionNumber).padStart(2, '0')
      const [title, ...subtitle] = heading.split('|')
      return <div className="ws-h ws-h2 ws-neo-heading">
        <span className="ws-neo-heading-meta" aria-hidden="true"><b>{number}</b> {subtitle.join('|').trim() || `PART ${number}`}</span>
        <span>{inline(title.trim().replace(/^(?:\d+[、.．]|\d+\s+|PART\s*\d+\s*[:：]?)\s*/i, '') || title)}</span>
      </div>
    }
    return <div className={`ws-h ws-h${Math.min(level, 3)}`}>{inline(heading)}</div>
  }
  if (kind === 'code') {
    const lines = text.split('\n')
    const info = /^\s*(?:`{3,}|~{3,})\s*(bash|text|promptbox|prompt)(?:\s+(.*))?\s*$/.exec(lines[0])
    if (info && lines.length > 1 && /^\s*(?:`{3,}|~{3,})\s*$/.test(lines.at(-1))) {
      const [, lang, title] = info
      return <div className={`ws-code-card is-${lang}`}>
        <span className="ws-tag">{lang === 'prompt' ? 'PROMPT' : lang === 'promptbox' ? '长提示词' : '终端'}</span>
        {title ? <span> {title}</span> : null}
        <pre className="ws-pre">{lines.slice(1, -1).join('\n')}</pre>
      </div>
    }
  }
  if (kind === 'code' || kind === 'table') return <pre className="ws-pre">{text}</pre>
  if (kind === 'quote') {
    const tag = /^\s*>\s?\[!([A-Z]+)\]/.exec(text)?.[1]
    const names = { QUOTE: '金句', TIP: '小技巧', NOTE: '说明', WARN: '注意', TLDR: '省流版' }
    return (
      <blockquote className={`ws-quote${tag === 'QUOTE' ? ' is-golden' : tag ? ' is-callout' : ''}`}>
        {tag ? <span className="ws-tag">{names[tag] ?? tag}</span> : null}
        {text.split('\n').map((line, i) => <div key={i}>{inline(line.replace(/^\s*>\s?(\[![A-Z]+\]\s*)?/, ''))}</div>)}
      </blockquote>
    )
  }
  if (kind === 'list') return <div className="ws-list">{text.split('\n').map((line, i) => <div key={i}>{inline(line)}</div>)}</div>
  if (kind === 'media') {
    const gallery = parseGalleryBlock(text)
    if (gallery) return <PaperGallery gallery={gallery} layoutStyle={layoutPreferences?.style} palette={palette} />
    const image = parseMarkdownImage(text)
    if (image) return <PaperImage key={image.src} src={image.src} caption={image.caption} long={image.title.toLowerCase() === 'long'} />
    return <div className="ws-media">{text}</div>
  }
  if (kind === 'rule') return <hr className="ws-rule" />
  return <p className="ws-p">{text.split('\n').map((line, i) => <React.Fragment key={i}>{i ? <br /> : null}{inline(line)}</React.Fragment>)}</p>
}

// Keep unfinished edits separate from the saved article.
const paragraphDrafts = new Map()

function draftsFor(articleId) {
  if (!paragraphDrafts.has(articleId)) {
    let entries = []
    try {
      const stored = JSON.parse(localStorage.getItem(`wechat-studio:paragraph-drafts:v1:${articleId}`) ?? '[]')
      if (Array.isArray(stored)) entries = stored.filter(entry =>
        Array.isArray(entry) && typeof entry[0] === 'string' &&
        typeof entry[1]?.text === 'string' && typeof entry[1]?.original === 'string')
    } catch {
      // Editing remains available if local storage is unavailable.
    }
    paragraphDrafts.set(articleId, new Map(entries))
  }
  return paragraphDrafts.get(articleId)
}

function unsavedParagraphCount(article) {
  return countCurrentParagraphDrafts(article.blocks, draftsFor(article.id))
}

function trackParagraphDraft(articleId, id, draft) {
  const drafts = draftsFor(articleId)
  const hadDraft = drafts.has(id)
  if (draft) drafts.set(id, draft)
  else drafts.delete(id)
  if (!draft && !hadDraft) return
  const key = `wechat-studio:paragraph-drafts:v1:${articleId}`
  try {
    if (drafts.size) localStorage.setItem(key, JSON.stringify([...drafts]))
    else localStorage.removeItem(key)
    if (getState().draftStorageFailed) setState({ draftStorageFailed: false })
  } catch {
    if (!getState().draftStorageFailed) setState({ draftStorageFailed: true })
  }
  if (hadDraft !== Boolean(draft)) setState(s => ({ draftVersion: (s.draftVersion ?? 0) + 1 }))
}

function openParagraph(articleId, blockId) {
  setState({ editing: blockId })
  try { localStorage.setItem(`wechat-studio:last-paragraph:${articleId}`, blockId) } catch {}
  requestAnimationFrame(() => document.getElementById(`ws-review-${articleId}-${blockId}`)?.scrollIntoView({ block: 'nearest' }))
}

function lastParagraph(articleId) {
  try { return localStorage.getItem(`wechat-studio:last-paragraph:${articleId}`) } catch { return null }
}

function PaperNavigation({ article, target, onJump }) {
  const editing = useStudio(s => s.editing)
  const pending = useStudio(s => s.pending)
  const details = React.useRef(null)
  const lastId = lastParagraph(article.id)
  const blocks = article.blocks.map((block, index) => ({ ...block, number: index + 1 }))
  const headings = blocks.filter(block => block.kind === 'heading')
  const waiting = blocks.filter(block => block.check?.status === 'flag')
  const position = blocks.findIndex(block => block.id === (target ?? editing ?? lastId)) + 1
  const resume = blocks.find(block => block.id === lastId)
  const next = waiting.find(block => block.number > position) ?? waiting[0]
  React.useEffect(() => {
    const dismiss = event => {
      if (details.current?.open && !details.current.contains(event.target)) details.current.open = false
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [])
  return <div className="ws-paper-nav">
    <details ref={details} className="ws-unsaved-menu" onKeyDown={event => {
      if (event.key === 'Escape') {
        details.current.open = false
        details.current.querySelector('summary')?.focus()
      }
    }}>
      <summary className="ws-btn">正文目录</summary>
      <nav className="ws-unsaved-list" aria-label="正文小标题">
        {headings.length ? headings.map(block => <button type="button" key={block.id} onClick={() => {
          details.current.open = false
          onJump(block.id, true)
        }}><b>{block.number}</b><span>{plainOf(block.text)}</span></button>) : <p className="ws-muted ws-small">这篇文章还没有小标题。</p>}
      </nav>
    </details>
    {next ? <button type="button" className="ws-btn" onClick={() => onJump(next.id, true)}>下一处待处理 <span className="ws-muted">· {waiting.length}</span></button> : null}
    {resume ? <button type="button" className="ws-btn" disabled={Boolean(article.job || pending)} onClick={() => {
      onJump(resume.id)
      openParagraph(article.id, resume.id)
    }}>接着改第 {resume.number} 段</button> : null}
  </div>
}

function UnsavedParagraphs({ article }) {
  useStudio(s => s.draftVersion)
  const storageFailed = useStudio(s => s.draftStorageFailed)
  const pending = useStudio(s => s.pending)
  const [open, setOpen] = React.useState(false)
  const root = React.useRef(null)
  const stored = draftsFor(article.id)
  const drafts = article.blocks.flatMap((block, index) => stored.has(block.id) ? [{ block, number: index + 1 }] : [])
  React.useEffect(() => {
    if (!open) return
    const dismiss = event => { if (!root.current?.contains(event.target)) setOpen(false) }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])
  if (!drafts.length) return null
  return <div ref={root} className="ws-unsaved-menu" onKeyDown={event => {
    if (open && event.key === 'Escape') {
      setOpen(false)
      root.current?.querySelector('button')?.focus()
    }
  }}>
    <button type="button" className="ws-btn" aria-expanded={open} disabled={Boolean(article.job || pending)} onClick={() => setOpen(!open)}
      title={storageFailed ? '本地暂存失败，退出前请保存正文' : '未保存修改已在本机暂存'}>
      {drafts.length} 段未保存
    </button>
    {open ? <div className="ws-unsaved-list" aria-label="未保存段落">
      {drafts.map(({ block, number }) => <button key={block.id} type="button" disabled={Boolean(article.job || pending)} onClick={() => {
        setOpen(false)
        if (getState().view !== 'paper') openArticleView(article, 'paper')
        openParagraph(article.id, block.id)
      }}><b>第 {number} 段</b> <span>{plainOf(stored.get(block.id).text) || '已清空'}</span></button>)}
    </div> : null}
  </div>
}

function CardInsert({ card, onInsert, onClose, onUpload }) {
  const ref = React.useRef(null)
  const fileInput = React.useRef(null)
  const heading = React.useId()
  const image = card.id === 'image' || card.id === 'long'
  const selectedUrl = image && /^https?:\/\/\S+$/i.test(card.selection)
  const [title, setTitle] = React.useState(image && !selectedUrl ? card.selection.replace(/\s+/g, ' ') : '')
  const [value, setValue] = React.useState(!image || selectedUrl ? card.selection : '')
  const [file, setFile] = React.useState(card.file ?? null)
  const [preview, setPreview] = React.useState('')
  const [uploading, setUploading] = React.useState(false)
  const [error, setError] = React.useState('')
  React.useEffect(() => {
    const dialog = ref.current
    dialog.showModal()
    return () => { if (dialog.open) dialog.close() }
  }, [])
  React.useEffect(() => {
    if (!file) { setPreview(''); return }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  const label = insertFormats.flatMap(group => group.items).find(([id]) => id === card.id)?.[1]
  const close = () => { if (!uploading) onClose() }
  const chooseFile = next => {
    if (!next) return
    if (next.size > 10 * 1024 * 1024) { setError('本地图片不能超过 10 MB。'); return }
    setFile(next)
    setError('')
  }
  const submit = async event => {
    event.preventDefault()
    if (uploading) return
    setError('')
    try {
      let next = value
      if (image && file) {
        setUploading(true)
        next = await onUpload(file)
        setValue(next)
        setFile(null)
      }
      onInsert(cardMarkdown(card.id, title, next))
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }
  return <dialog ref={ref} className="ws-dialog ws-card-insert" aria-labelledby={heading}
    onCancel={e => { e.preventDefault(); close() }} onClick={e => { if (e.target === e.currentTarget) close() }}>
    <form onSubmit={submit}>
      <div className="ws-dialog-head"><h2 id={heading} className="ws-dialog-title">插入{label}</h2>
        <button type="button" className="ws-icon-btn" aria-label="关闭" disabled={uploading} onClick={close}><Icon name="close" /></button>
      </div>
      {image ? <>
        <div className="ws-local-image">
          {preview ? <img src={preview} alt="待上传图片预览" /> : null}
          <div className="ws-local-image-actions">
            <button type="button" className="ws-btn" disabled={uploading} onClick={() => fileInput.current?.click()}><Icon name="upload" />{file ? '更换本地图片' : '选择本地图片'}</button>
            {file ? <button type="button" className="ws-link" disabled={uploading} onClick={() => setFile(null)}>移除</button> : null}
            <span className="ws-muted ws-small">{file ? file.name : 'PNG、JPEG、GIF 或 WebP，不超过 10 MB；也可在正文里直接粘贴。'}</span>
          </div>
          <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp,.png,.jpg,.jpeg,.gif,.webp" hidden onChange={event => {
            chooseFile(event.target.files?.[0])
            event.target.value = ''
          }} />
        </div>
        <label>或填写图片地址<input value={value} onChange={e => setValue(e.target.value)} placeholder={file ? '上传后自动填入图床地址' : 'https://…'} required={!file} readOnly={Boolean(file) || uploading} /></label>
      </> : null}
      <label>{image ? '图注（选填）' : card.id === 'prompt' ? '文件名（选填）' : '标题（选填）'}
        <input value={title} onChange={e => setTitle(e.target.value)} maxLength={120}
          placeholder={image ? '描述这张图' : card.id === 'prompt' ? '提示词.txt' : '提示词'} />
      </label>
      {!image ? <label>提示词内容<textarea value={value} onChange={e => setValue(e.target.value)} rows={6} required /></label> : null}
      {error ? <p className="ws-warn" role="alert">{error}</p> : null}
      <div className="ws-dialog-foot">
        <button type="button" className="ws-btn" disabled={uploading} onClick={close}>取消</button>
        <button type="submit" className="ws-btn is-primary" disabled={uploading}>{uploading ? '正在上传图床…' : '插入卡片'}</button>
      </div>
    </form>
  </dialog>
}

function GalleryInsert({ card, onInsert, onClose, onUpload }) {
  const ref = React.useRef(null)
  const fileInput = React.useRef(null)
  const objectUrls = React.useRef(new Set())
  const seq = React.useRef(0)
  const heading = React.useId()
  const existingGallery = parseGalleryBlock(card.selection)
  const [label, setLabel] = React.useState(existingGallery?.label ?? '')
  const [items, setItems] = React.useState(() => {
    if (existingGallery) return existingGallery.items.map(item => ({ key: ++seq.current, file: null, previewUrl: '', src: item.src, caption: item.caption }))
    const urls = String(card.selection ?? '').split(/\r?\n/).map(line => line.trim()).filter(line => /^https?:\/\/\S+$/i.test(line))
    return urls.map(src => ({ key: ++seq.current, file: null, previewUrl: '', src, caption: '' }))
  })
  const [urlInput, setUrlInput] = React.useState('')
  const [uploading, setUploading] = React.useState(null)
  const [error, setError] = React.useState('')
  React.useEffect(() => {
    const dialog = ref.current
    dialog.showModal()
    return () => { if (dialog.open) dialog.close() }
  }, [])
  React.useEffect(() => () => {
    for (const url of objectUrls.current) URL.revokeObjectURL(url)
    objectUrls.current.clear()
  }, [])
  const close = () => { if (!uploading) onClose() }
  const parseUrlLines = raw => {
    const lines = String(raw ?? '').split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    const added = []
    for (const line of lines) {
      let parsed
      try { parsed = new URL(line) } catch { throw new Error(`图片地址无效：${line}`) }
      if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) {
        throw new Error(`请输入有效的 HTTP 或 HTTPS 图片地址：${line}`)
      }
      added.push({ key: ++seq.current, file: null, previewUrl: '', src: parsed.href, caption: '' })
    }
    return added
  }
  const chooseFiles = fileList => {
    const files = [...(fileList ?? [])]
    if (!files.length) return
    const next = []
    for (const file of files) {
      if (file.size > 10 * 1024 * 1024) { setError(`「${file.name}」超过 10 MB，请压缩后再选。`); return }
      const previewUrl = URL.createObjectURL(file)
      objectUrls.current.add(previewUrl)
      next.push({ key: ++seq.current, file, previewUrl, src: '', caption: '' })
    }
    setItems(prev => [...prev, ...next])
    setError('')
  }
  const addUrls = () => {
    if (!urlInput.trim()) return
    try {
      const added = parseUrlLines(urlInput)
      setItems(prev => [...prev, ...added])
      setUrlInput('')
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }
  const moveItem = (index, delta) => {
    setItems(prev => {
      const target = index + delta
      if (target < 0 || target >= prev.length) return prev
      const copy = [...prev]
      const [moved] = copy.splice(index, 1)
      copy.splice(target, 0, moved)
      return copy
    })
  }
  const removeItem = index => {
    setItems(prev => {
      const target = prev[index]
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl)
        objectUrls.current.delete(target.previewUrl)
      }
      return prev.filter((_, i) => i !== index)
    })
  }
  const updateCaption = (index, caption) => {
    setItems(prev => prev.map((item, i) => i === index ? { ...item, caption } : item))
  }
  const submit = async event => {
    event.preventDefault()
    if (uploading) return
    setError('')
    let working = items
    try {
      if (urlInput.trim()) {
        const added = parseUrlLines(urlInput)
        working = [...working, ...added]
        setItems(working)
        setUrlInput('')
      }
      if (working.length < 2) { setError('横滑图集至少需要 2 张图片。'); return }
      const pending = working.filter(item => item.file && !item.src)
      let done = 0
      const resolved = []
      for (const item of working) {
        if (item.file && !item.src) {
          done += 1
          setUploading({ current: done, total: pending.length })
          const uploadedUrl = await onUpload(item.file)
          const updated = { ...item, src: uploadedUrl, file: null }
          resolved.push(updated)
          setItems(prev => prev.map(entry => entry.key === item.key ? updated : entry))
        } else {
          resolved.push(item)
        }
      }
      onInsert(cardMarkdown('gallery', label, resolved))
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(null)
    }
  }
  return <dialog ref={ref} className="ws-dialog ws-card-insert ws-gallery-insert" aria-labelledby={heading}
    onCancel={e => { e.preventDefault(); close() }} onClick={e => { if (e.target === e.currentTarget) close() }}>
    <form onSubmit={submit}>
      <div className="ws-dialog-head"><h2 id={heading} className="ws-dialog-title">{existingGallery ? '编辑横滑图集' : '插入横滑图集'}</h2>
        <button type="button" className="ws-icon-btn" aria-label="关闭" disabled={Boolean(uploading)} onClick={close}><Icon name="close" /></button>
      </div>
      <label>标签文字（选填）
        <input value={label} onChange={e => setLabel(e.target.value)} disabled={Boolean(uploading)} placeholder={DEFAULT_GALLERY_LABEL} />
      </label>
      <div className="ws-local-image">
        <div className="ws-local-image-actions">
          <button type="button" className="ws-btn" disabled={Boolean(uploading)} onClick={() => fileInput.current?.click()}>
            <Icon name="upload" />{items.length ? '继续添加本地图片' : '选择多张本地图片'}
          </button>
          <span className="ws-muted ws-small">支持多选 PNG、JPEG、GIF 或 WebP（单张不超过 10 MB），将按顺序生成左右滑动图集。</span>
        </div>
        <input ref={fileInput} type="file" multiple accept="image/png,image/jpeg,image/gif,image/webp,.png,.jpg,.jpeg,.gif,.webp" hidden onChange={event => {
          chooseFiles(event.target.files)
          event.target.value = ''
        }} />
      </div>
      <div className="ws-gallery-url-row">
        <label>或添加图片地址（可多行粘贴）
          <textarea value={urlInput} onChange={e => setUrlInput(e.target.value)} rows={2} disabled={Boolean(uploading)} placeholder={'https://…\nhttps://…'} />
        </label>
        <button type="button" className="ws-btn" disabled={Boolean(uploading) || !urlInput.trim()} onClick={addUrls}>添加链接</button>
      </div>
      {items.length ? <div className="ws-gallery-list" aria-label="已选图片">
        {items.map((item, index) => <div key={item.key} className="ws-gallery-row">
          <span className="ws-gallery-index">{index + 1}/{items.length}</span>
          <img className="ws-gallery-thumb" src={item.previewUrl || item.src} alt={`第 ${index + 1} 张预览`} referrerPolicy="no-referrer" />
          <input value={item.caption} onChange={e => updateCaption(index, e.target.value)} maxLength={120} disabled={Boolean(uploading)} placeholder="图注（选填）" />
          <div className="ws-gallery-row-actions">
            <button type="button" className="ws-icon-btn" aria-label="上移" disabled={Boolean(uploading) || index === 0} onClick={() => moveItem(index, -1)}>↑</button>
            <button type="button" className="ws-icon-btn" aria-label="下移" disabled={Boolean(uploading) || index === items.length - 1} onClick={() => moveItem(index, 1)}>↓</button>
            <button type="button" className="ws-icon-btn" aria-label="移除" disabled={Boolean(uploading)} onClick={() => removeItem(index)}><Icon name="close" /></button>
          </div>
        </div>)}
      </div> : <p className="ws-muted ws-small">还没有图片，请至少选择或添加 2 张图片。</p>}
      {error ? <p className="ws-warn" role="alert">{error}</p> : null}
      <div className="ws-dialog-foot">
        <button type="button" className="ws-btn" disabled={Boolean(uploading)} onClick={close}>取消</button>
        <button type="submit" className="ws-btn is-primary" disabled={Boolean(uploading)}>
          {uploading ? `正在上传第 ${uploading.current}/${uploading.total} 张…` : `插入横滑图集${items.length ? `（${items.length} 张）` : ''}`}
        </button>
      </div>
    </form>
  </dialog>
}

function Editor({ articleId, block, number, sectionNumber, busy, nextId, onDone }) {
  const [draft, setDraft] = React.useState(() => draftsFor(articleId).get(block.id) ?? { text: block.text, original: block.text })
  const storageFailed = useStudio(s => s.draftStorageFailed)
  const [preview, setPreview] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [card, setCard] = React.useState(null)
  const ref = React.useRef(null)
  const menu = React.useRef(null)
  const lock = React.useRef(false)
  const changed = draft.text.trim() !== draft.original
  const conflict = block.text !== draft.original
  const empty = !draft.text.trim()
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = () => {
      el.style.height = '0px'
      el.style.height = `${el.scrollHeight}px`
    }
    fit()
    const observer = new ResizeObserver(entries => {
      const width = entries[0].contentRect.width
      if (width !== lastWidth) { lastWidth = width; fit() }
    })
    let lastWidth
    observer.observe(el)
    return () => observer.disconnect()
  }, [draft.text, preview])
  React.useEffect(() => {
    if (!preview) ref.current?.focus({ preventScroll: true })
  }, [preview])
  const edit = text => {
    const next = { ...draft, text }
    trackParagraphDraft(articleId, block.id, text.trim() === draft.original ? null : next)
    setDraft(next)
  }
  const cancel = () => {
    if (lock.current) return
    trackParagraphDraft(articleId, block.id, null)
    onDone()
  }
  const save = async (remove = false, advance = false) => {
    if (lock.current || busy || (!changed && !remove) || conflict || (empty && !remove)) return
    lock.current = true
    setSaving(true)
    const ok = await act('block/update', { id: articleId, blockId: block.id, text: remove ? '' : draft.text, expectedText: draft.original })
    lock.current = false
    if (ok) {
      trackParagraphDraft(articleId, block.id, null)
      onDone(advance ? nextId : null)
    } else setSaving(false)
  }
  const format = id => {
    const el = ref.current
    if (!el) return
    const { selectionStart: start, selectionEnd: end } = el
    if (['image', 'long', 'gallery', 'prompt', 'promptbox'].includes(id)) {
      if (menu.current) menu.current.open = false
      if (id === 'gallery' && start === end && parseGalleryBlock(draft.text)) {
        setCard({ id, start: 0, end: draft.text.length, selection: draft.text })
      } else {
        setCard({ id, start, end, selection: draft.text.slice(start, end) })
      }
      return
    }
    applyFormat(formatSelection(draft.text, start, end, id))
  }
  const focusRange = (start, end) => {
    requestAnimationFrame(() => {
      ref.current?.focus({ preventScroll: true })
      ref.current?.setSelectionRange(start, end)
    })
  }
  const applyFormat = next => {
    if (next.text.length > 20000) { toast('这一段最多可编辑 20000 个字符。', true); return }
    if (menu.current) menu.current.open = false
    edit(next.text)
    focusRange(next.start, next.end)
  }
  React.useEffect(() => {
    const dismiss = event => {
      if (menu.current?.open && !menu.current.contains(event.target)) menu.current.open = false
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [])
  const pasteImage = event => {
    if (saving) return
    const data = event.clipboardData
    const item = [...(data?.items ?? [])].find(item => item.kind === 'file' && item.type.startsWith('image/'))
    const file = item?.getAsFile() ?? [...(data?.files ?? [])].find(file => file.type.startsWith('image/'))
    if (!file) return
    event.preventDefault()
    if (menu.current) menu.current.open = false
    const el = ref.current
    const start = el.selectionStart
    const end = el.selectionEnd
    setCard({ id: 'image', start, end, selection: draft.text.slice(start, end), file })
  }
  return (
    <div className="ws-editor" onKeyDown={event => {
      if (card) return
      if (event.nativeEvent.isComposing || event.keyCode === 229) return
      if (event.key === 'Escape') {
        event.preventDefault()
        if (menu.current?.open) { menu.current.open = false; ref.current?.focus() }
        else cancel()
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        if (!event.shiftKey || nextId) void save(false, event.shiftKey)
      }
    }}>
      <div className="ws-editor-tools">
        <span>编辑第 {number} 段</span>
        <div>
          {!preview && !saving ? <>
            <div className="ws-format-group" role="group" aria-label="文字强调">
              {emphasisFormats.map(item => <button key={item.id} type="button" className={`ws-btn ws-format-${item.id}`}
                title={item.label} aria-label={item.label} onMouseDown={e => e.preventDefault()} onClick={() => format(item.id)}>{item.symbol}</button>)}
            </div>
            <details className="ws-format-insert" ref={menu}>
              <summary className="ws-btn">插入</summary>
              <div className="ws-format-panel">
                {insertFormats.map(group => <div className="ws-format-section" key={group.label} role="group" aria-label={group.label}>
                  <span>{group.label}</span>
                  {group.items.map(([id, label]) => <button type="button" key={id} onClick={() => format(id)}>{label}</button>)}
                </div>)}
              </div>
            </details>
          </> : null}
          <button type="button" className="ws-btn" aria-pressed={preview} disabled={saving} onClick={() => setPreview(!preview)}>{preview ? '继续编辑' : '预览'}</button>
        </div>
      </div>
      {preview ? <div className="ws-editor-preview">{splitMarkdown(draft.text, { bodyOnly: true }).blocks.map((text, index) =>
        <BlockBody key={index} sectionNumber={sectionNumber} block={{ kind: blockKind(text), text }} />)}</div> : (
        <textarea ref={ref} className="ws-edit" value={draft.text} aria-label={`编辑第 ${number} 段`} readOnly={saving}
          maxLength={20000} onChange={event => edit(event.target.value)} onPaste={pasteImage} />
      )}
      <div className="ws-editor-footer">
        <span role="status">{saving ? '正在保存…' : storageFailed ? '本地暂存失败，退出前请保存正文' : conflict ? '正文已有新版本，当前修改仍保留。' : empty ? '清空后可手动删除这段' : changed ? '已在本机暂存，尚未写入正文' : '⌘ / Ctrl + Enter 保存'}</span>
        <div>
          {conflict ? <button type="button" className="ws-btn" onClick={() => copyText(draft.text, '已复制未保存的修改')}>复制修改</button> : null}
          {!empty ? <button type="button" className="ws-btn ws-delete-block" title="删除当前段落，可通过顶部撤销恢复" disabled={saving || busy || conflict} onClick={() => void save(true)}>删除</button> : null}
          <button type="button" className="ws-btn" disabled={saving} onClick={cancel}>取消</button>
          {nextId && !empty ? <button type="button" className="ws-btn" title="⌘ / Ctrl + Shift + Enter" disabled={saving || busy || !changed || conflict}
            onClick={() => void save(false, true)}>保存并改下一段</button> : null}
          <button type="button" className="ws-btn is-primary" disabled={saving || busy || !changed || conflict} onClick={() => void save(empty)}>{empty ? '删除段落' : '保存'}</button>
        </div>
      </div>
      {card?.id === 'gallery' ? <GalleryInsert card={card} onClose={() => { setCard(null); focusRange(card.start, card.end) }}
        onUpload={file => uploadImage(file, articleId)}
        onInsert={markdown => {
          const next = formatSelection(draft.text, card.start, card.end, card.id, markdown)
          if (next.text.length > 20000) throw new Error('插入后会超过这一段的 20000 字符上限。')
          setCard(null)
          applyFormat(next)
        }} /> : card ? <CardInsert card={card} onClose={() => { setCard(null); focusRange(card.start, card.end) }}
        onUpload={file => uploadImage(file, articleId)}
        onInsert={markdown => {
          const next = formatSelection(draft.text, card.start, card.end, card.id, markdown)
          if (next.text.length > 20000) throw new Error('插入后会超过这一段的 20000 字符上限。')
          setCard(null)
          applyFormat(next)
        }} /> : null}
    </div>
  )
}

function Annotation({ block, job }) {
  const check = block.check
  const compare = block.previousText != null ? <button type="button" className="ws-btn" onClick={() => setState({ dialog: 'block-revision', revisionBlockId: block.id })}>看改动</button> : null
  if ((job?.kind === 'fix' && job.target === block.id) || (job?.kind === 'fixall' && job.targets.includes(block.id))) return <div className="ws-note is-busy"><span className="ws-shimmer">正在改写这一段…</span></div>
  if (!check) return compare ? <div className="ws-note-actions">{compare}</div> : null
  if (check.status === 'pass') return <div className="ws-mark is-pass"><Icon name="check" size={14} />已通过 {compare}</div>
  if (check.status === 'kept') return <div className="ws-mark">保留原样 {compare}</div>
  if (check.status === 'fixed') {
    return (
      <div className="ws-note">
        <p className="ws-note-title">已改写，等下一轮检测</p>
        {compare || block.hasPrev ? <div className="ws-note-actions">{compare}{block.hasPrev ? <button type="button" className="ws-btn" onClick={() => act('block/revert', { blockId: block.id })}>退回上一版</button> : null}</div> : null}
      </div>
    )
  }
  if (check.status !== 'flag') return compare
  const label = check.level === 'ai' ? 'AI 特征' : '疑似 AI'
  const source = check.source === 'api' ? 'API' : 'PDF'
  const score = check.source === 'api'
    ? `分类置信度 ${Math.round(check.score * 100)}%`
    : `报告得分 ${check.score}`
  return (
    <div className="ws-note is-flag">
      <p className="ws-note-title">朱雀 {source}：{label}<span className="ws-score">{score}</span></p>
      {check.worse ? <p className="ws-note-text">改完分数反而升了，建议退回上一版的写法。</p>
        : check.fixes >= 2 ? <p className="ws-note-text">这一段已经改过两轮。建议你用自己平时说话的方式重说一遍，点正文就能直接改。</p>
        : check.source !== 'api' && check.score < 0.6 ? <p className="ws-note-text">0.5–0.6 是噪声带，每次重测都会浮动，可以不改。</p> : null}
      <div className="ws-note-actions">
        {compare}
        {check.worse && block.hasPrev ? <button type="button" className="ws-btn is-primary" onClick={() => act('block/revert', { blockId: block.id })}>退回上一版</button>
          : <button type="button" className="ws-btn is-primary" disabled={Boolean(job)} onClick={() => act('block/fix', { blockId: block.id })}>改这段</button>}
        <button type="button" className="ws-btn" onClick={() => act('block/keep', { blockId: block.id })}>保留</button>
      </div>
    </div>
  )
}

function PaperTitle({ article, busy }) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(article.title)
  const [saving, setSaving] = React.useState(false)
  const ref = React.useRef(null)
  const lock = React.useRef(false)
  const value = draft.trim()
  const changed = value !== article.title
  React.useLayoutEffect(() => {
    if (!editing) return
    const el = ref.current
    if (!el) return
    const fit = () => {
      el.style.height = '0px'
      el.style.height = `${el.scrollHeight}px`
    }
    fit()
    const observer = new ResizeObserver(entries => {
      const width = entries[0].contentRect.width
      if (width !== lastWidth) { lastWidth = width; fit() }
    })
    let lastWidth
    observer.observe(el)
    return () => observer.disconnect()
  }, [draft, editing])
  React.useEffect(() => {
    if (editing) ref.current?.focus({ preventScroll: true })
  }, [editing])
  const start = () => {
    setDraft(article.title)
    setEditing(true)
  }
  const cancel = () => {
    if (lock.current) return
    setDraft(article.title)
    setEditing(false)
  }
  const save = async () => {
    if (lock.current || busy || !value || !changed) return
    lock.current = true
    setSaving(true)
    const ok = await act('title/pick', { text: value })
    lock.current = false
    setSaving(false)
    if (ok) setEditing(false)
  }
  if (editing) return (
    <div className="ws-editor ws-title-editor" onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return
      if (event.key === 'Escape') { event.preventDefault(); cancel() }
      if (event.key === 'Enter') { event.preventDefault(); void save() }
    }}>
      <textarea ref={ref} className="ws-title-input" aria-label="编辑文章标题" rows={2} maxLength={80}
        value={draft} readOnly={saving} onChange={event => setDraft(event.target.value.replace(/\s*\r?\n\s*/g, ' '))} />
      <div className="ws-editor-footer">
        <span role="status">{saving ? '正在保存…' : !value ? '标题不能为空' : `${value.length} / 80 字 · Enter 保存，Esc 取消`}</span>
        <div>
          <button type="button" className="ws-btn" disabled={saving} onClick={cancel}>取消</button>
          <button type="button" className="ws-btn is-primary" disabled={saving || busy || !value || !changed} onClick={() => void save()}>保存标题</button>
        </div>
      </div>
    </div>
  )
  return <h1 className="ws-title"><button type="button" className="ws-title-button" disabled={busy}
    title="点击编辑标题" onClick={start}>{article.title || '还没有标题'}</button></h1>
}

function Paper({ article, reviewTarget }) {
  const editing = useStudio(s => s.editing)
  const job = article.job
  const pending = useStudio(s => s.pending)
  if (job?.kind === 'draft') {
    return (
      <div className="ws-sheet-wrap">
        <div className="ws-row"><div className="ws-sheet is-first is-last"><p className="ws-live">{job.text || <span className="ws-shimmer">正在写正文…</span>}</p></div><div className="ws-margin" /></div>
      </div>
    )
  }
  if (!article.blocks.length) {
    return <div className="ws-sheet-wrap"><div className="ws-row"><div className="ws-sheet is-first is-last"><p className="ws-muted">这篇文章还没有正文。在左边说一句想写什么，或者新建一篇把写好的文章贴进来。</p></div><div className="ws-margin" /></div></div>
  }
  let sectionNumber = 0
  return (
    <div className="ws-sheet-wrap is-neo">
      <div className="ws-row">
        <div className="ws-sheet is-first"><PaperTitle key={article.id} article={article} busy={Boolean(job || pending)} /></div>
        <div className="ws-margin" />
      </div>
      {article.blocks.map((block, index) => {
        const headingNumber = block.kind === 'heading' && /^##\s/.test(block.text) ? ++sectionNumber : undefined
        const flagged = block.check?.status === 'flag'
        const last = index === article.blocks.length - 1
        return (
          <div className={`ws-row ${reviewTarget === block.id ? 'is-review-target' : ''}`} id={`ws-review-${article.id}-${block.id}`} key={block.id}>
            <div className={`ws-sheet ${flagged ? 'is-flag' : ''} ${last ? 'is-last' : ''}`}>
              {editing === block.id ? <span className="ws-no" aria-hidden="true">{index + 1}</span> :
                <button type="button" className="ws-no ws-edge-edit" aria-label={`编辑第 ${index + 1} 段`} disabled={Boolean(job || pending)}
                  onClick={() => openParagraph(article.id, block.id)}><span>{index + 1}</span><span aria-hidden="true">✎</span></button>}
              {editing === block.id ? <Editor key={block.id} articleId={article.id} block={block} number={index + 1} sectionNumber={headingNumber} busy={Boolean(job || pending)}
                nextId={article.blocks[index + 1]?.id} onDone={nextId => {
                const state = getState()
                if (state.editing !== block.id) return
                if (nextId && state.data?.current?.blocks.some(item => item.id === nextId)) {
                  openParagraph(article.id, nextId)
                  return
                }
                setState({ editing: null })
                requestAnimationFrame(() => document.getElementById(`ws-review-${article.id}-${block.id}`)?.querySelector('.ws-block')?.focus({ preventScroll: true }))
              }} />
                : isSvgCardText(block.text) ? <div className="ws-block ws-svg-block">
                  <BlockBody block={block} sectionNumber={headingNumber} articleId={article.id} layoutPreferences={article.effectiveLayoutPreferences} />
                </div> : <button type="button" className="ws-block" disabled={Boolean(job || pending)} title="点一下直接改这一段" onClick={() => openParagraph(article.id, block.id)}>
                  <BlockBody block={block} sectionNumber={headingNumber} layoutPreferences={article.effectiveLayoutPreferences} palette={article.xhsPalette} />
                  {draftsFor(article.id).has(block.id) ? <span className="ws-unsaved">有未保存的修改</span> : null}
                </button>}
            </div>
            <div className="ws-margin"><Annotation block={block} job={job} /></div>
          </div>
        )
      })}
    </div>
  )
}

function BannerBar({ article }) {
  const banner = article.banner
  const job = article.job
  const making = job?.kind === 'banner'
  const failed = !making && !banner.ready && article.notice?.error && article.notice.text.startsWith('做开头横幅')
  return (
    <div className="ws-bannerbar">
      <span className="ws-pane-title">开头横幅</span>
      <div className="ws-tabs" role="radiogroup" aria-label="开头横幅风格">
        {banner.choices.map(choice => (
          <button type="button" role="radio" key={choice.id} aria-checked={banner.style === choice.id} className={banner.style === choice.id ? 'is-on' : ''} disabled={Boolean(job)}
            onClick={() => { if (choice.id !== banner.style) act('banner/style', { style: choice.id }) }}>{choice.name}</button>
        ))}
      </div>
      <span className="ws-bannerbar-status">
        {making ? <span className="ws-shimmer">正在按文章做横幅…</span>
          : failed ? <span className="ws-warn">横幅没做出来</span>
          : banner.style !== 'none' && banner.ready ? (banner.warnings.length ? <span className="ws-warn" title={banner.warnings.join('\n')}>有 {banner.warnings.length} 处超字数，可能挤在一起</span> : <span className="ws-ok"><Icon name="check" size={13} />已生成</span>) : null}
      </span>
      <span className="ws-grow" />
      {banner.style !== 'none' ? <button type="button" className="ws-link" disabled={Boolean(job)} onClick={() => act('banner/generate')}>{banner.ready || failed ? '重新生成' : '生成'}</button> : null}
    </div>
  )
}

function LayoutView({ article, brand, mp }) {
  const pending = useStudio(s => s.pending)
  const layout = useStudio(s => s.layout)
  const tried = useStudio(s => s.bannerTried)
  const [previewMode, setPreviewMode] = React.useState('article')
  const frame = React.useRef(null)
  React.useEffect(() => { setPreviewMode('article') }, [article.id])
  React.useEffect(() => {
    const dismiss = () => frame.current?.contentWindow?.dismissLayoutPopovers?.()
    const onKeyDown = event => { if (event.key === 'Escape') dismiss() }
    document.addEventListener('pointerdown', dismiss, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', dismiss, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])
  const enhanced = layout?.html?.includes('window.setStudioOptions=')
  const syncOptions = () => {
    const banner = article.banner
    try {
      frame.current?.contentWindow?.setStudioOptions?.({
        banner, busy: Boolean(article.job) || Boolean(pending),
        status: article.job?.kind === 'banner' ? '正在生成横幅…'
          : banner.style === 'none' ? ''
          : banner.warnings.length ? `有 ${banner.warnings.length} 处字数提醒`
          : banner.ready ? '已生成' : '待生成',
        layoutPreferences: article.layoutPreferences,
        followCard: article.followCard, followPending: pending === 'layout/follow-card',
      }, (path, body) => act(path, { ...body, id: article.id }))
    } catch {
      // The frame is replaced when a new preview arrives.
    }
  }
  React.useLayoutEffect(() => {
    syncOptions()
    const iframe = frame.current
    iframe?.addEventListener('studio-options-ready', syncOptions)
    return () => iframe?.removeEventListener('studio-options-ready', syncOptions)
  }, [article, layout, pending])
  const banner = article.banner
  const tryKey = `${article.id}:${banner.style}`
  // 第一次打开排版、当前风格还没有横幅时，自动做一次；失败了不再自动重试
  React.useEffect(() => {
    if (banner.ready || article.job || tried[tryKey] || !article.blocks.length) return
    setState(s => ({ bannerTried: { ...s.bannerTried, [tryKey]: true } }))
    act('banner/generate', {}, { quiet: true })
  }, [banner.ready, article.job, tryKey])
  React.useEffect(() => { if (!layout && article.job?.kind !== 'banner') loadLayout() }, [layout, article.id, article.job?.kind])
  let content
  if (article.job?.kind === 'banner' && !layout?.html) content = <div className="ws-center"><span className="ws-shimmer">先按文章做开头横幅，做好就排版…</span></div>
  else if (!layout || layout.loading) content = <div className="ws-center"><span className="ws-shimmer">正在排版…</span></div>
  else if (layout.error) content = <div className="ws-center"><p className="ws-muted">排版失败：{layout.error}</p><button type="button" className="ws-btn" onClick={loadLayout}>重试</button></div>
  else {
    content = (
      <>
        {!layout.html.includes('id="review-panel"') ? (
          <details className="ws-layout-report"><summary>自查报告</summary><pre>{layout.report}</pre></details>
        ) : null}
        <iframe key={layout.key} ref={frame} onLoad={syncOptions} className="ws-frame" title="公众号排版预览" srcDoc={layout.html} allow="clipboard-write" />
      </>
    )
  }
  return (
    <div className="ws-layout">
      <div className="ws-layout-modebar">
        <div className="ws-tabs" role="tablist" aria-label="排版预览模式">
          <button type="button" role="tab" aria-selected={previewMode === 'article'} className={previewMode === 'article' ? 'is-on' : ''} onClick={() => setPreviewMode('article')}>正文预览</button>
          <button type="button" role="tab" aria-selected={previewMode === 'feed'} className={previewMode === 'feed' ? 'is-on' : ''} onClick={() => setPreviewMode('feed')}>信息流卡片</button>
        </div>
      </div>
      <div className="ws-layout-article" hidden={previewMode !== 'article'}>
        {!enhanced ? <>
        <BannerBar article={article} />
        <div className="ws-bannerbar">
          {typeof article.followCard === 'boolean' ? (
            <label className="ws-follow-toggle">
              <span>文末关注卡</span>
              <input type="checkbox" role="switch" checked={article.followCard} disabled={pending === 'layout/follow-card'}
                onChange={e => act('layout/follow-card', { id: article.id, enabled: e.target.checked })} />
              <span className="ws-follow-track" aria-hidden="true" />
            </label>
          ) : (
            <span className="ws-muted">文末关注卡 · 完全退出 DSH（⌘Q）并重新打开后可设置</span>
          )}
        </div>
        </> : null}
        {content}
      </div>
      {previewMode === 'feed' ? <FeedCardPreview article={article} brand={brand} mp={mp} /> : null}
    </div>
  )
}

function FixAll({ article }) {
  const job = article.job
  if (job?.kind === 'fixall') {
    const { done, total } = job.progress ?? { done: 0, total: 0 }
    return (
      <div className="ws-batch">
        <div className="ws-batch-head">
          <span>{job.stopping ? '正在停下…' : `正在处理 ${done}/${total} 段`}</span>
          <button type="button" className="ws-link" disabled={job.stopping} onClick={() => act('job/stop')}>停止</button>
        </div>
        <div className="ws-meter" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}><span style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></div>
        <p className="ws-muted ws-small">相邻的标红段一组一起改，同时改三组。改完可以撤销一次全部退回。</p>
      </div>
    )
  }
  const plan = article.fixPlan
  if (!plan?.count) return null
  const skipped = plan.skipped.twice + plan.skipped.worse + plan.skipped.noise
  return (
    <div className="ws-batch">
      <button type="button" className="ws-btn is-wide" disabled={Boolean(job)} onClick={() => act('block/fix-all')}>一键处理 {plan.count} 段</button>
      <p className="ws-muted ws-small">AI 特征先改，疑似 AI 后改{skipped ? `；${skipped} 段不在其中（改过两轮、该退回上一版或在噪声带）` : ''}。</p>
    </div>
  )
}

function ChatPane({ article }) {
  const [text, setText] = React.useState('')
  const listRef = React.useRef(null)
  const busy = Boolean(article.job)
  React.useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }) }, [article.chat.length, busy])
  const send = async event => {
    event.preventDefault()
    const message = text.trim()
    if (!message || busy) return
    setText('')
    if (!(await act('chat', { message }))) setText(message)
  }
  const lastUndoable = article.canUndo ? article.chat.findLastIndex(turn => turn.undoable) : -1
  return (
    <section className="ws-chat" aria-label="改稿对话">
      <h2 className="ws-pane-title">改稿</h2>
      <div className="ws-chat-list" ref={listRef}>
        {article.chat.length ? null : <p className="ws-muted">说一句，改一段。比如「第 3 段太啰嗦，砍一半」「开头直接一点」「标题别超过 20 个字」。</p>}
        {article.chat.map((turn, index) => turn.role === 'user' ? <p className="ws-bubble" key={index}>{turn.text}</p> : (
          <div className={`ws-reply ${turn.error ? 'is-error' : ''}`} key={index}>
            <p>{turn.text}</p>
            {turn.receipts?.length ? (
              <div className="ws-receipts">
                <span>{turn.receipts.join('，')}</span>
                {index === lastUndoable && index === article.chat.length - 1 ? <button type="button" className="ws-link" disabled={busy} onClick={() => act('undo')}>撤销</button> : null}
              </div>
            ) : null}
          </div>
        ))}
        {article.job?.kind === 'chat' ? <div className="ws-reply"><span className="ws-shimmer">正在改…</span></div> : null}
      </div>
      <form className="ws-composer" onSubmit={send}>
        <label className="ws-sr" htmlFor="ws-chat-input">改稿指令</label>
        <input id="ws-chat-input" type="text" value={text} placeholder="说一句，改一段" autoComplete="off" onChange={e => setText(e.target.value)} />
        <button type="submit" className="ws-send" aria-label="发送" disabled={busy || !text.trim()}><Icon name="send" size={17} /></button>
      </form>
    </section>
  )
}

const coverStylePreviews = { classic: classicPreview, editorial: editorialPreview, campaign: campaignPreview, kinetic: kineticPreview, grunge: grungePreview, magenta: magentaPreview, felt: feltPreview }

function CoverZoom({ scrim, target, src, maxWidth = 860 }) {
  if (!scrim || !target || !src) return null
  const box = scrim.getBoundingClientRect()
  const anchor = target.getBoundingClientRect()
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(value, hi))
  const width = Math.min(maxWidth, box.width - 32)
  const height = width / 2.35 + 14
  const left = clamp(anchor.left - box.left + anchor.width / 2 - width / 2, 12, box.width - width - 12)
  let top = anchor.top - box.top - height - 10
  if (top < 12) top = anchor.bottom - box.top + 10
  top = clamp(top, 12, Math.max(12, box.height - height - 12))
  return <div className="ws-cover-zoom" style={{ left, top, width }} aria-hidden="true"><img src={src} alt="" /></div>
}

function CoverOptionGroup({ label, name, options, value, onChange, disabled }) {
  return (
    <fieldset className="ws-cover-option" disabled={disabled}>
      <legend>{label}</legend>
      <div className="ws-cover-segments">
        {options.map(option => (
          <label key={option}>
            <input type="radio" name={name} value={option} checked={value === option} onChange={() => onChange(option)} />
            <span>{String(option).toUpperCase()}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function CoverStyleDialog({ article }) {
  const settings = useStudio(s => s.settings)
  const coverStylesState = useStudio(s => s.coverStyles)
  const selectedCoverStyleId = useStudio(s => s.selectedCoverStyleId)
  const [settingsStatus, setSettingsStatus] = React.useState('loading')
  const readCoverSettings = React.useCallback(async () => {
    setSettingsStatus('loading')
    const [ok] = await Promise.all([loadSettings(), loadCoverStyles()])
    setSettingsStatus(ok ? 'ready' : 'failed')
  }, [])
  React.useEffect(() => { void readCoverSettings() }, [readCoverSettings])
  const stylesList = coverStylesState?.styles?.length ? coverStylesState.styles : COVER_STYLES
  const customCount = stylesList.filter(item => item.source === 'custom').length
  const atLimit = customCount >= CUSTOM_COVER_STYLE_LIMITS.maxStyles
  const provider = settingsStatus === 'ready' ? settings?.coverProvider : null
  const formats = providerFormats(provider)
  const [style, setStyle] = React.useState(selectedCoverStyleId ?? article.cover?.style ?? 'classic')
  const [resolution, setResolution] = React.useState(article.cover?.resolution ?? '2K')
  const [count, setCount] = React.useState(article.cover?.count ?? 1)
  const [format, setFormat] = React.useState(article.cover?.format ?? 'png')
  const [busy, setBusy] = React.useState(false)
  const [deletingId, setDeletingId] = React.useState(null)
  const scrimRef = React.useRef(null)
  const [zoom, setZoom] = React.useState(null)
  const effectiveFormat = formats.includes(format) ? format : 'png'

  React.useEffect(() => {
    if (selectedCoverStyleId && stylesList.some(item => item.id === selectedCoverStyleId)) {
      setStyle(selectedCoverStyleId)
      setState({ selectedCoverStyleId: null })
    }
  }, [selectedCoverStyleId, stylesList])

  React.useEffect(() => {
    if (coverStylesState && !coverStylesState.loading && !stylesList.some(item => item.id === style)) {
      setStyle('classic')
    }
  }, [coverStylesState, stylesList, style])

  const close = () => { if (!busy) setState({ dialog: null }) }
  const submit = async event => {
    event.preventDefault()
    if (busy || !provider) return
    setBusy(true)
    const ok = await act('cover/generate', { id: article.id, style, resolution, count, format: effectiveFormat })
    setBusy(false)
    if (ok) setState({ dialog: null })
  }
  const onDeleteCustom = async (event, item) => {
    event.preventDefault()
    event.stopPropagation()
    if (busy || deletingId) return
    if (!window.confirm(`确定删除自定义封面风格「${item.name}」吗？\n删除后不影响已生成的文章封面，但后续无法再用此风格。`)) return
    setDeletingId(item.id)
    setZoom(null)
    try {
      await deleteCustomCoverStyle(item.id)
      if (style === item.id) setStyle('classic')
      toast(`已删除「${item.name}」`)
    } catch (err) {
      toast(err.message, true)
    } finally {
      setDeletingId(null)
    }
  }
  const previewSrcOf = item => (item.source === 'custom' ? item.previewUrl : coverStylePreviews[item.id])
  return (
    <div className="ws-scrim" ref={scrimRef} onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
      <form className="ws-dialog ws-cover-dialog" role="dialog" aria-modal="true" aria-label="选择封面风格" onSubmit={submit}>
        <div className="ws-dialog-head">
          <h2 className="ws-dialog-title">选择封面风格</h2>
          <button type="button" className="ws-icon-btn" disabled={busy} aria-label="关闭" onClick={close}><Icon name="close" /></button>
        </div>
        <CustomCoverTestBanner returnTo="cover" />
        <div className="ws-cover-dialog-body">
          <fieldset className="ws-cover-gallery" disabled={busy}>
            <legend>风格</legend>
            {coverStylesState?.error ? (
              <p className="ws-warn ws-small" role="status">读取自定义封面风格失败：{coverStylesState.error}</p>
            ) : null}
            {coverStylesState?.warnings?.length ? (
              <p className="ws-warn ws-small" role="status">{coverStylesState.warnings.join(' ')}</p>
            ) : null}
            <div className="ws-cover-style-grid">
              {stylesList.map(item => {
                const isCustom = item.source === 'custom'
                const src = previewSrcOf(item)
                return (
                  <label className={`ws-choice ws-cover-style ${style === item.id ? 'is-on' : ''} ${isCustom ? 'is-custom' : ''}`} key={item.id}
                    onMouseEnter={event => { if (src) setZoom({ el: event.currentTarget, src }) }} onMouseLeave={() => setZoom(null)}>
                    <input type="radio" aria-label={item.name} name="cover-style" value={item.id} checked={style === item.id} onChange={() => setStyle(item.id)} />
                    <span className="ws-cover-style-body">
                      <span className="ws-cover-style-media">
                        {src ? <img src={src} alt="" /> : <span className="ws-cover-placeholder-art"><span>{item.name}</span></span>}
                        {isCustom ? <span className="ws-cover-badge">自定义</span> : null}
                      </span>
                      <span className="ws-cover-style-foot">
                        <strong>{item.name}</strong>
                        {isCustom ? (
                          <span className="ws-cover-style-actions">
                            <button
                              type="button"
                              className="ws-link"
                              disabled={busy || Boolean(deletingId)}
                              onClick={event => {
                                event.preventDefault()
                                event.stopPropagation()
                                setZoom(null)
                                openCustomCoverStyleWizard({ mode: 'edit', styleId: item.id, returnTo: 'cover' })
                              }}
                            >编辑</button>
                            <button
                              type="button"
                              className="ws-link is-danger"
                              disabled={busy || deletingId === item.id}
                              onClick={event => void onDeleteCustom(event, item)}
                            >{deletingId === item.id ? '删除中' : '删除'}</button>
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </label>
                )
              })}
              <button
                type="button"
                className="ws-cover-style-add"
                disabled={busy || atLimit}
                title={atLimit ? `已达 ${CUSTOM_COVER_STYLE_LIMITS.maxStyles} 套自定义风格上限` : '上传参考图或写诉求，新建自定义封面风格'}
                onClick={() => {
                  setZoom(null)
                  openCustomCoverStyleWizard({ mode: 'create', returnTo: 'cover' })
                }}
              >
                <span className="ws-cover-style-add-plus">+</span>
                <strong>{atLimit ? `已达 ${CUSTOM_COVER_STYLE_LIMITS.maxStyles} 套上限` : '自定义风格'}</strong>
              </button>
            </div>
            <p className="ws-cover-style-description">{stylesList.find(item => item.id === style)?.description}</p>
          </fieldset>
          <div className="ws-cover-options">
            <CoverOptionGroup label="选择分辨率" name="cover-resolution" options={COVER_RESOLUTIONS}
              value={resolution} onChange={setResolution} disabled={busy} />
            <CoverOptionGroup label="生成张数" name="cover-count" options={Array.from({ length: MAX_COVER_COUNT }, (_, i) => i + 1)}
              value={count} onChange={setCount} disabled={busy} />
            {provider ? <>
              <CoverOptionGroup label="图片格式" name="cover-format" options={formats}
                value={effectiveFormat} onChange={setFormat} disabled={busy} />
              <p className="ws-muted ws-small">当前提供方：{COVER_PROVIDERS.find(item => item.id === provider)?.name}，在「设置 · 封面生成」里切换。</p>
              {settings?.portraitIsAuthorSample ? <p className="ws-warn ws-small" role="status">当前参考图是插件作者的示例照片，生成的封面会是作者的脸。请到「设置 · 封面生成」换成自己的照片。</p> : null}
            </> : settingsStatus === 'failed' ? <p className="ws-warn ws-small" role="status">无法读取封面设置。<button type="button" className="ws-link" onClick={readCoverSettings}>重试</button></p>
              : <p className="ws-muted ws-small" role="status">正在读取封面设置…</p>}
          </div>
        </div>
        <div className="ws-dialog-foot">
          <button type="button" className="ws-btn" disabled={busy} onClick={close}>取消</button>
          <button type="submit" className="ws-btn is-primary" disabled={busy || !provider}>{busy ? '正在提交…' : '生成封面'}</button>
        </div>
      </form>
      <CoverZoom scrim={scrimRef.current} target={zoom?.el} src={zoom?.src} maxWidth={560} />
    </div>
  )
}

const coverRunStatus = { running: '进行中', succeeded: '完成', partial: '部分完成', failed: '失败', interrupted: '已中断' }

function CoverJobProgress({ job }) {
  if (!job) return null
  const stage = { prompt: '正在分析文章…', generating: '正在生成封面…', saving: '正在裁切并保存…' }
  return <p className="ws-shimmer" role="status">{stage[job.stage]}{job.stage !== 'prompt' ? `（${job.index}/${job.count}）` : ''}</p>
}

function CoverHistoryDialog({ article }) {
  const pending = useStudio(s => s.pending)
  const coverStyles = useStudio(s => s.coverStyles)
  React.useEffect(() => {
    if (!coverStyles) void loadCoverStyles()
  }, [])
  const runs = article.coverRuns ?? []
  const historyAvailable = Array.isArray(article.coverRuns)
  const [selectedId, setSelectedId] = React.useState(null)
  const scrimRef = React.useRef(null)
  const [zoom, setZoom] = React.useState(null)
  const run = runs.find(item => item.id === selectedId) ?? runs.at(-1)
  const styleName = item => resolveCoverStyleName(item.style, coverStyles?.styles, item.styleName)
  const dateLabel = value => new Date(value).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const close = () => setState({ dialog: null })
  const imageUrl = id => `wechat-studio/cover/image?${new URLSearchParams({ id: article.id, asset: id })}`
  return (
    <div className="ws-scrim" ref={scrimRef} onMouseDown={event => { if (event.target === event.currentTarget) close() }}
      onKeyDown={event => { if (event.key === 'Escape') close() }}>
      <section className="ws-dialog ws-cover-history" role="dialog" aria-modal="true" aria-label="封面生成记录">
        <div className="ws-dialog-head">
          <h2 className="ws-dialog-title">封面生成记录{historyAvailable ? `（${runs.length} 次）` : ''}</h2>
          <button type="button" className="ws-icon-btn" aria-label="关闭" onClick={close}><Icon name="close" /></button>
        </div>
        {!run ? <p className="ws-history-empty ws-muted">{historyAvailable ? '还没有生成记录。' : '请完全退出 DSH（⌘Q）后重新打开，以加载封面记录。'}</p> : (
          <div className="ws-history-body">
            <nav className="ws-history-list" aria-label="生成批次">
              {[...runs].reverse().map((item, index) => (
                <button type="button" className={`ws-history-run ${run.id === item.id ? 'is-on' : ''}`}
                  key={item.id} aria-pressed={run.id === item.id} onClick={() => { setZoom(null); setSelectedId(item.id) }}>
                  <strong>第 {runs.length - index} 次 · {styleName(item)}</strong>
                  <small>{dateLabel(item.createdAt)} · {item.images.length}/{item.count} 张</small>
                </button>
              ))}
            </nav>
            <div className="ws-history-detail" key={run.id}>
              <div className="ws-history-heading">
                <h3>{styleName(run)}</h3>
                <span className={`ws-history-status is-${run.status}`}>{coverRunStatus[run.status]}</span>
              </div>
              <p className="ws-history-meta">{[new Date(run.createdAt).toLocaleString('zh-CN'), run.model, run.resolution, run.format?.toUpperCase()].filter(Boolean).join(' · ')}</p>
              <CoverJobProgress job={article.coverJob?.id === run.id ? article.coverJob : null} />
              <div className={`ws-history-images ${run.images.length > 1 ? 'is-grid' : ''}`}>
                {run.images.map((image, index) => (
                  <figure key={image.id}>
                    <img src={imageUrl(image.id)} alt={`封面 ${index + 1}`} loading="lazy"
                      onMouseEnter={event => setZoom({ el: event.currentTarget, src: imageUrl(image.id) })} onMouseLeave={() => setZoom(null)} />
                    <figcaption>
                      <span>封面 {index + 1}</span>
                      <div className="ws-history-image-actions">
                        {article.cover?.id === image.id ? <span className="ws-ok"><Icon name="check" size={13} />当前封面</span> : (
                          <button type="button" className="ws-link" disabled={Boolean(article.coverJob) || pending === 'cover/select'}
                            onClick={async () => {
                              setSelectedId(run.id)
                              if (await act('cover/select', { id: article.id, asset: image.id })) toast('已设为当前封面')
                            }}>设为当前封面</button>
                        )}
                        <a className="ws-link" href={imageUrl(image.id) + '&download=1'} download>下载</a>
                      </div>
                    </figcaption>
                  </figure>
                ))}
              </div>
              {run.prompt ? (
                <section className="ws-history-prompt" aria-label="生成提示词">
                  <div className="ws-history-heading">
                    <h4>提示词</h4>
                    <button type="button" className="ws-btn" onClick={() => copyText(run.prompt, '已复制提示词')}>复制提示词</button>
                  </div>
                  <pre tabIndex={0} aria-label="提示词正文">{run.prompt}</pre>
                </section>
              ) : null}
              {run.errors?.map((error, i) => <p className="ws-warn" key={i}>{error}</p>)}
            </div>
          </div>
        )}
      </section>
      <CoverZoom scrim={scrimRef.current} target={zoom?.el} src={zoom?.src} />
    </div>
  )
}

function CoverPane({ article }) {
  const pending = useStudio(s => s.pending)
  const { cover, coverJob, coverError } = article
  const imageUrl = id => `wechat-studio/cover/image?${new URLSearchParams({ id: article.id, asset: id })}`
  const src = cover && imageUrl(cover.id)
  return (
    <section className="ws-sec">
      <div className="ws-sec-head">
        <h2 className="ws-pane-title">封面</h2>
        <div className="ws-cover-actions">
          <button type="button" className="ws-link" onClick={() => setState({ dialog: 'cover-history' })}>
            生成记录{Array.isArray(article.coverRuns) ? `（${article.coverRuns.length} 次）` : ''}
          </button>
          <button type="button" className="ws-link" disabled={Boolean(coverJob) || pending === 'cover/generate' || !article.title || !article.blocks.length}
            onClick={() => setState({ dialog: 'cover' })}>{cover ? '重新生成' : '生成封面'}</button>
        </div>
      </div>
      <div className="ws-cover-preview">
        {cover ? <img src={src} alt={cover.title} /> : <span>封面图 · 2.35:1</span>}
      </div>
      <CoverJobProgress job={coverJob} />
      {!coverJob && coverError ? <p className="ws-warn" role="status">{coverError}</p> : null}
      {cover ? <>
        <a className="ws-link" href={src + '&download=1'} download>下载封面</a>
        <details className="ws-manual"><summary>查看提示词</summary><p>{cover.prompt}</p></details>
      </> : null}
    </section>
  )
}

function ReviewQueue({ article, target, onJump }) {
  const rows = article.blocks.map((block, index) => ({ block, number: index + 1 }))
    .filter(({ block }) => ['flag', 'fixed'].includes(block.check?.status))
  if (!rows.length) return null
  const current = rows.findIndex(({ block }) => block.id === target)
  return (
    <section className="ws-review-queue" aria-label="待处理段落">
      <div className="ws-sec-head">
        <h3>待处理段落 <span>{rows.length}</span></h3>
        <div className="ws-review-nav">
          <button type="button" className="ws-btn" disabled={current <= 0} onClick={() => onJump(rows[current - 1].block.id)}>上一处</button>
          <button type="button" className="ws-btn" disabled={current >= rows.length - 1} onClick={() => onJump(rows[current + 1].block.id)}>下一处</button>
        </div>
      </div>
      <div className="ws-review-list">
        {rows.map(({ block, number }) => {
          const check = block.check
          const status = check.status === 'fixed' ? '待复测' : check.worse ? '建议退回' : check.level === 'ai' ? 'AI 特征' : '疑似 AI'
          const excerpt = block.text.replace(/\s+/g, ' ').trim()
          return (
            <button type="button" key={block.id} className="ws-review-item" aria-current={target === block.id ? 'true' : undefined}
              onClick={() => onJump(block.id)}>
              <span className="ws-review-item-head"><strong>第 {number} 段</strong><span className={check.status === 'fixed' ? 'ws-muted' : 'ws-warn'}>{status}</span></span>
              <span className="ws-review-excerpt">{excerpt}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function openArticleView(article, view) {
  setState({ view, editing: null })
  void rememberArticleView(article.id, view)
}

function ArticleInfoPane({ article }) {
  const busy = Boolean(article.job)
  const generating = article.job?.kind === 'titles'
  const [showTitles, setShowTitles] = React.useState(false)
  const reimportReason = article.publishedAt ? '已发布稿件不能覆盖正文。'
    : article.job || article.coverJob || article.inlineDiagramJob || article.imageImport?.total
      ? '请等当前任务完成后再重新导入。' : ''
  const openReimport = () => {
    if (unsavedParagraphCount(article)) {
      toast('请先保存或丢弃未保存的段落，再重新导入。', true)
      return
    }
    setState({ dialog: 'reimport', reimportArticleId: article.id })
  }
  return <section className="ws-sec">
    <div className="ws-sec-head">
      <h2 className="ws-pane-title">当前标题</h2>
      {article.title ? <button type="button" className="ws-link" aria-expanded={showTitles} onClick={() => setShowTitles(open => !open)}>
        {showTitles ? '收起候选' : '换标题'}
      </button> : null}
    </div>
    <p className="ws-side-title">{article.title || '还没有标题'}</p>
    {article.summary ? <p className="ws-summary"><span>摘要</span>{article.summary}</p> : null}
    {showTitles || !article.title ? <div className="ws-sec ws-side-candidates">
      <div className="ws-sec-head">
        <h3 className="ws-pane-title">标题候选</h3>
        <button type="button" className="ws-link" disabled={busy || !article.blocks.length} onClick={() => act('titles/regen')}>
          {article.titles.length ? '重新出' : '出标题'}
        </button>
      </div>
      {generating ? <p className="ws-shimmer">正在出标题…</p> : null}
      {article.titles.map(item => (
        <button type="button" key={item.text} className={`ws-choice ws-title-choice ${item.recommended ? 'is-recommended' : ''} ${item.text === article.title ? 'is-on' : ''}`}
          aria-pressed={item.text === article.title} disabled={busy} onClick={async () => { if (await act('title/pick', { text: item.text })) setShowTitles(false) }}>
          {item.recommended ? <span className="ws-title-recommendation"><Icon name="spark" size={13} />主推</span> : null}
          <span>{item.text}</span>
          {item.recommended && item.reason ? <small>{item.reason}</small> : null}
        </button>
      ))}
    </div> : null}
    <details className="ws-manual">
      <summary>更多操作</summary>
      <button type="button" className="ws-btn" disabled={!article.blocks.length} onClick={copyMarkdown}>复制 Markdown</button>
      <button type="button" className="ws-btn" disabled={!article.blocks.length || Boolean(reimportReason)} title={reimportReason || undefined} onClick={openReimport}>重新导入 Markdown</button>
    </details>
  </section>
}

const PREFLIGHT_SEV_LABELS = { blocking: '阻断', warn: '提醒', info: '提示' }

function PreflightPane({ preflight, unsavedCount, onReviewJump }) {
  if (!preflight) return null
  const { counts, stats, items, ok } = preflight
  const clean = ok && counts.warn === 0 && counts.info === 0
  return (
    <section className="ws-sec ws-preflight" aria-label="发布防踩坑体检">
      <div className="ws-sec-head">
        <h2 className="ws-pane-title">发布防踩坑体检</h2>
        <span className="ws-preflight-badge">本地即时 · 零成本</span>
      </div>
      {unsavedCount > 0 ? (
        <p className="ws-preflight-unsaved ws-small" role="status">有 {unsavedCount} 段未保存，保存后更新体检结果。</p>
      ) : null}
      {clean ? (
        <p className="ws-preflight-pass"><Icon name="check" size={14} />未发现明显发布风险（标题 {stats.titleChars} 字 · 正文 {stats.chars} 字）</p>
      ) : (
        <div className="ws-preflight-summary">
          {counts.blocking > 0 ? <span className="ws-preflight-pill is-blocking">阻断 {counts.blocking}</span> : null}
          {counts.warn > 0 ? <span className="ws-preflight-pill is-warn">提醒 {counts.warn}</span> : null}
          {counts.info > 0 ? <span className="ws-preflight-pill is-info">提示 {counts.info}</span> : null}
          <span className="ws-muted ws-small">标题 {stats.titleChars} 字 · 正文 {stats.chars} 字</span>
        </div>
      )}
      {items.length ? (
        <div className="ws-preflight-list">
          {items.map((item, idx) => {
            const key = `${item.id}-${item.blockId ?? 'title'}-${idx}`
            const body = <>
              <span className="ws-preflight-item-head">
                <span className={`ws-preflight-sev is-${item.severity}`}>{PREFLIGHT_SEV_LABELS[item.severity] ?? item.severity}</span>
                <strong>{item.title}</strong>
                {item.blockNumber != null ? <span className="ws-muted">第 {item.blockNumber} 段</span> : null}
              </span>
              <span className="ws-preflight-detail">{item.detail}</span>
            </>
            return item.blockId ? (
              <button key={key} type="button" className={`ws-preflight-item is-${item.severity}`} onClick={() => onReviewJump(item.blockId, true)}>{body}</button>
            ) : (
              <div key={key} className={`ws-preflight-item is-static is-${item.severity}`}>{body}</div>
            )
          })}
        </div>
      ) : null}
      <div className="ws-preflight-foot">
        <button type="button" className="ws-link" onClick={() => setState({ dialog: 'settings', settingsPage: 'preflight' })}>自定义提醒词</button>
        <p className="ws-muted ws-small">风险词检查仅供人工复核，不代表微信官方审核结论。</p>
      </div>
    </section>
  )
}

function QualityPane({ article, ready, reviewTarget, onReviewJump, unsavedCount }) {
  const fileRef = React.useRef(null)
  const [over, setOver] = React.useState(false)
  const busy = Boolean(article.job)
  const zhuque = article.zhuque ?? { round: 0 }
  const overall = zhuque.overall && [['人工', zhuque.overall.human], ['疑似', zhuque.overall.suspect], ['AI', zhuque.overall.ai]].filter(([, value]) => value !== null && value !== undefined)
  const metricNote = zhuque.source === 'api'
    ? 'API 分类置信度与 PDF 报告得分含义不同，不直接比较。'
    : `${zhuque.overallDerived ? '总体占比按 PDF 片段计算；' : ''}报告得分是所属片段的分数，不与 API 分类置信度直接比较。`
  const drop = event => {
    event.preventDefault()
    setOver(false)
    if (!busy) uploadReport(event.dataTransfer.files?.[0])
  }
  return (
    <>
      <PreflightPane preflight={article.preflight} unsavedCount={unsavedCount} onReviewJump={onReviewJump} />
      <section className="ws-sec ws-quality-ai">
        <h2 className="ws-pane-title">AI 味检测（朱雀）{zhuque.round ? <span className="ws-round">第 {zhuque.round} 轮</span> : null}</h2>
        {ready ? (
          <button type="button" className="ws-btn is-primary is-wide" disabled={busy || !article.blocks.length} onClick={() => act('zhuque/detect')}>
            <Icon name="scan" />{article.job?.kind === 'report' ? '正在检测…' : zhuque.round ? '再检测一轮' : '一键检测'}
          </button>
        ) : (
          <p className="ws-hint">设置朱雀 API Key 后可以一键检测，不用来回复制和下载。<button type="button" className="ws-link" onClick={() => setState({ dialog: 'settings', settingsPage: 'quality' })}>去设置</button></p>
        )}
        {overall?.length ? <p className="ws-overall">{overall.map(([name, value]) => <span key={name}>{name} {value}%</span>)}</p> : null}
        {zhuque.round ? <p className="ws-muted ws-small">{metricNote}</p> : null}
        <FixAll article={article} />
        <ReviewQueue article={article} target={reviewTarget} onJump={id => onReviewJump(id, true)} />
        <details className="ws-manual" open={!ready}>
          <summary>{ready ? '更多检测方式 · 上传 PDF' : '手动上传报告'}</summary>
          <ol className="ws-steps">
            <li><button type="button" className="ws-btn is-wide" disabled={!article.blocks.length} onClick={copyDetectionText}><Icon name="doc" />复制检测文本</button></li>
            <li className="ws-muted">到朱雀贴进去检测，下载报告 PDF</li>
            <li>
              <button type="button" className={`ws-drop ${over ? 'is-over' : ''}`} disabled={busy || !article.blocks.length}
                onClick={() => fileRef.current?.click()} onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={drop}>
                <Icon name="upload" />把报告 PDF 拖到这里，或点击选择
              </button>
              <input ref={fileRef} type="file" accept="application/pdf,.pdf" hidden onChange={e => { uploadReport(e.target.files?.[0]); e.target.value = '' }} />
            </li>
          </ol>
        </details>
        <p className="ws-muted ws-small">不保证具体分数，结果以朱雀为准。</p>
      </section>
    </>
  )
}

const SIDE_TABS = [['article', '文章'], ['images', '配图'], ['quality', '质检']]

function SidePane({ article, tab, onTab, tabId, flagged, retest, ready, reviewTarget, onReviewJump, cloudinaryReady, unsavedCount }) {
  const pendingCount = flagged + retest + (article.preflight?.counts?.blocking ?? 0)
  return <aside className="ws-side" aria-label="稿面工具">
    <div className="ws-side-tabs">
      <div className="ws-tabs" role="tablist" aria-label="稿面工具">
        {SIDE_TABS.map(([id, label], index) => <button key={id} type="button" role="tab" id={tabId + '-' + id}
          aria-controls={tabId + '-panel-' + id} aria-selected={tab === id} tabIndex={tab === id ? 0 : -1}
          className={tab === id ? 'is-on' : ''} onClick={() => onTab(id)} onKeyDown={event => {
            const count = SIDE_TABS.length
            const next = { ArrowLeft: (index + count - 1) % count, ArrowRight: (index + 1) % count, Home: 0, End: count - 1 }[event.key]
            if (next == null) return
            event.preventDefault()
            const nextId = SIDE_TABS[next][0]
            onTab(nextId)
            document.getElementById(tabId + '-' + nextId)?.focus()
          }}>
          {label}{id === 'quality' && pendingCount ? <span className="ws-side-count">{pendingCount}</span> : null}
        </button>)}
      </div>
    </div>
    {SIDE_TABS.map(([id]) => <div key={id} role="tabpanel" id={tabId + '-panel-' + id}
      aria-labelledby={tabId + '-' + id} className={`ws-side-content ${id === 'images' ? 'ws-images-panel' : ''}`} hidden={tab !== id} tabIndex={0}>
      {id === 'article' ? <ArticleInfoPane article={article} /> : id === 'images' ? <>
        <CoverPane article={article} />
        <InlineDiagramPane article={article} cloudinaryReady={cloudinaryReady} onReviewJump={onReviewJump} unsavedCount={unsavedCount} />
        <SvgCardsPane article={article} reviewTarget={reviewTarget} unsavedCount={unsavedCount} onReviewJump={onReviewJump} />
      </> : <QualityPane article={article} ready={ready} reviewTarget={reviewTarget} onReviewJump={onReviewJump} unsavedCount={unsavedCount} />}
    </div>)}
  </aside>
}

const draftDate = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
})

function Switcher({ data }) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const root = React.useRef(null)
  const trigger = React.useRef(null)
  const panelId = React.useId()
  const current = data.current
  const terms = query.normalize('NFKC').trim().toLowerCase().split(/\s+/).filter(Boolean)
  const results = data.articles.filter(item => {
    if (item.archivedAt) return false
    const title = item.title.normalize('NFKC').toLowerCase()
    return terms.every(term => title.includes(term))
  })
  const close = () => { setOpen(false); setQuery('') }
  React.useEffect(() => {
    if (!open) return
    const dismiss = event => { if (!root.current?.contains(event.target)) close() }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])
  const pick = async item => {
    close()
    trigger.current?.focus()
    if (item.id === current?.id) return
    if (await act('articles/select', { id: item.id })) {
      setState({ view: item.lastView === 'layout' ? 'layout' : 'paper', editing: null })
    }
  }
  return (
    <div className="ws-switch" ref={root} onKeyDown={event => {
      if (open && event.key === 'Escape') {
        event.stopPropagation()
        close()
        trigger.current?.focus()
      }
    }}>
      <button type="button" className="ws-switch-btn" ref={trigger} aria-expanded={open} aria-controls={open ? panelId : undefined}
        onClick={() => open ? close() : setOpen(true)}>
        <span>{current?.title || current?.topic || '未命名文章'}</span><Icon name="down" size={14} />
      </button>
      {open ? (
        <div className="ws-menu ws-draft-picker" id={panelId} role="region" aria-label="查找文章">
          <div className="ws-draft-search">
            <input autoFocus type="search" aria-label="搜索文章标题" placeholder="搜索文章标题…" value={query}
              onChange={event => setQuery(event.target.value)} onKeyDown={event => {
                if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || !results.length) return
                event.preventDefault()
                pick(results[0])
              }} />
          </div>
          <div className="ws-draft-list-label" role="status">{terms.length ? `找到 ${results.length} 篇` : '最近编辑'}</div>
          <div className="ws-draft-results">
            {results.map(item => {
              const date = new Date(item.updatedAt)
              const edited = Number.isNaN(date.getTime()) ? '' : draftDate.format(date)
              return (
                <button type="button" key={item.id} className={item.id === current?.id ? 'is-on' : ''} aria-current={item.id === current?.id ? 'true' : undefined} onClick={() => pick(item)}>
                  <div className="ws-draft-result"><span title={item.title}>{item.title}</span><small>{[edited, `${item.chars} 字`].filter(Boolean).join(' · ')}</small></div>
                  {item.id === current?.id ? <Icon name="check" size={14} /> : null}
                </button>
              )
            })}
            {!results.length ? <p className="ws-draft-empty">没有找到匹配的文章。</p> : null}
          </div>
          <button type="button" className="ws-menu-new" onClick={() => { close(); setState({ dialog: 'new' }) }}><Icon name="plus" size={14} />新建文章</button>
        </div>
      ) : null}
    </div>
  )
}

function Steps({ article, flagged, retest, onQuality }) {
  const round = article.zhuque?.round ?? 0
  const steps = [
    { label: '正文', state: article.blocks.length ? 'done' : article.job?.kind === 'draft' ? 'now' : 'todo' },
    { label: '标题', state: article.title ? 'done' : 'todo' },
    { label: '质检', state: !round ? 'todo' : flagged || retest ? 'now' : 'done', extra: !round ? '未检测' : flagged ? `剩 ${flagged} 段` : retest ? `${retest} 段待复测` : null },
  ]
  return (
    <ol className="ws-stepper">
      {steps.map(step => {
        const content = <>{step.state === 'done' ? <Icon name="check" size={13} /> : null}{step.label}{step.extra ? <small>{step.extra}</small> : null}</>
        return <li key={step.label} className={`is-${step.state}`}>
          {step.label === '质检' ? <button type="button" onClick={onQuality}>{content}</button> : content}
        </li>
      })}
    </ol>
  )
}

export function NewDialog() {
  const hasPersonalWriterStyle = useStudio(s => s.data?.personalStyleScopes?.writer ?? s.data?.hasPersonalStyle)
  const savedDraft = React.useMemo(() => getState().newDialogDraft, [])
  const [tab, setTab] = React.useState(savedDraft?.tab ?? 'paste')
  const [topic, setTopic] = React.useState(savedDraft?.topic ?? '')
  const [material, setMaterial] = React.useState(savedDraft?.material ?? '')
  const [markdown, setMarkdown] = React.useState(savedDraft?.markdown ?? '')
  const [busy, setBusy] = React.useState(false)
  const [reading, setReading] = React.useState(false)
  const readingRef = React.useRef(false)
  const handleReadingChange = value => { readingRef.current = value; setReading(value) }
  const locked = busy || reading
  const close = () => { if (!locked) setState({ dialog: null, newDialogDraft: null }) }
  const openStyleFromNew = () => {
    setState({ newDialogDraft: { tab, topic, material, markdown } })
    openStyleWizard(1, { returnTo: 'new' })
  }
  const submit = async event => {
    event.preventDefault()
    if (busy || readingRef.current) return
    setBusy(true)
    const ok = await act('articles/new', tab === 'paste' ? { markdown } : { topic, material })
    setBusy(false)
    if (ok) setState({ dialog: null, newDialogDraft: null, module: 'paper', paperHome: false, view: 'paper', editing: null })
  }
  return (
    <div className="ws-scrim" onMouseDown={e => { if (e.target === e.currentTarget) close() }}>
      <form className={`ws-dialog ${tab === 'paste' ? 'ws-import-dialog' : ''}`} role="dialog" aria-modal="true" aria-label="新建文章" onSubmit={submit}>
        <div className="ws-dialog-head">
          <div className="ws-tabs" role="tablist">
            <button type="button" role="tab" disabled={locked} aria-selected={tab === 'paste'} className={tab === 'paste' ? 'is-on' : ''} onClick={() => setTab('paste')}>贴入已有文章</button>
            <button type="button" role="tab" disabled={locked} aria-selected={tab === 'write'} className={tab === 'write' ? 'is-on' : ''} onClick={() => setTab('write')}>从选题写</button>
          </div>
          <button type="button" className="ws-icon-btn" aria-label="关闭" onClick={close}><Icon name="close" /></button>
        </div>
        {tab === 'paste' ? (
          <MarkdownImportFields Icon={Icon} value={markdown} onChange={setMarkdown} locked={locked} reading={reading} onReadingChange={handleReadingChange} />
        ) : (
          <>
            <label className="ws-field"><span>选题</span>
              <input type="text" required value={topic} placeholder="一句话说清这篇要写什么" onChange={e => setTopic(e.target.value)} />
            </label>
            <label className="ws-field"><span>素材（可选）</span>
              <textarea rows={8} value={material} placeholder="聊天记录、笔记、数据、你的原话。正文只会用这里出现过的事实，缺的地方会留 [可补] 占位。" onChange={e => setMaterial(e.target.value)} />
            </label>
            {!hasPersonalWriterStyle ? (
              <p className="ws-muted ws-small ws-style-inline-hint">
                当前按内置默认风格写作 · <button type="button" className="ws-link" disabled={locked} onClick={openStyleFromNew}>生成我的风格</button>
              </p>
            ) : null}
          </>
        )}
        <div className="ws-dialog-foot">
          <button type="button" className="ws-btn" onClick={close}>取消</button>
          <button type="submit" className="ws-btn is-primary" disabled={locked || (tab === 'paste' && !markdown.trim())}>{busy ? (tab === 'paste' ? '正在导入…' : '正在创建…') : (tab === 'paste' ? '放上稿面' : '开始写')}</button>
        </div>
      </form>
    </div>
  )
}

const MAX_REIMPORT_JSON = 2_000_000

function ReimportDialog({ article }) {
  const [markdown, setMarkdown] = React.useState('')
  const [updateTitle, setUpdateTitle] = React.useState(false)
  const [plan, setPlan] = React.useState(null)
  const [acknowledgeRemovedMedia, setAcknowledgeRemovedMedia] = React.useState(false)
  const [busy, setBusy] = React.useState('')
  const [reading, setReading] = React.useState(false)
  const readingRef = React.useRef(false)
  const [error, setError] = React.useState('')
  const sequence = React.useRef(0)
  const taskReason = article.publishedAt ? '已发布稿件不能覆盖正文。'
    : article.job || article.coverJob || article.inlineDiagramJob || article.imageImport?.total
      ? '请等当前任务完成后再重新导入。' : ''
  const handleReadingChange = value => { readingRef.current = value; setReading(value) }
  const locked = Boolean(busy || reading || taskReason)
  const incomingTitle = React.useMemo(() => markdown.trim() ? splitMarkdown(markdown).title : '', [markdown])
  React.useEffect(() => () => { sequence.current++ }, [])
  const close = () => {
    if (busy) return
    setState({ dialog: null, reimportArticleId: null })
  }
  const invalidate = () => {
    sequence.current++
    setPlan(null)
    setAcknowledgeRemovedMedia(false)
    setError('')
  }
  const changeMarkdown = value => {
    invalidate()
    setUpdateTitle(false)
    setMarkdown(value)
  }
  const changeUpdateTitle = value => { invalidate(); setUpdateTitle(value) }
  const checkReady = () => {
    if (readingRef.current) { setError('正在读取文件，请稍候。'); return false }
    if (taskReason) { setError(taskReason); return false }
    if (unsavedParagraphCount(article)) {
      setError('请先保存或丢弃未保存的段落，再重新导入。')
      return false
    }
    if (!markdown.trim()) { setError('请先粘贴或选择一个 Markdown 文件。'); return false }
    return true
  }
  const checkSize = payload => {
    if (new TextEncoder().encode(JSON.stringify(payload)).length <= MAX_REIMPORT_JSON) return true
    setError('序列化后的导入内容超过 2 MB，请拆分或减少正文后再试。')
    return false
  }
  const runPreview = async () => {
    if (!checkReady()) return
    const payload = { id: article.id, markdown, updateTitle }
    if (!checkSize(payload)) return
    const requestId = ++sequence.current
    setBusy('preview')
    setError('')
    try {
      const result = await previewMarkdownReimport(payload)
      if (requestId !== sequence.current) return
      setPlan(result)
      setAcknowledgeRemovedMedia(false)
    } catch (err) {
      if (requestId !== sequence.current) return
      setPlan(null)
      setError(err.message)
    } finally {
      if (requestId === sequence.current) setBusy('')
    }
  }
  const submit = async event => {
    event.preventDefault()
    if (busy || readingRef.current) return
    if (!plan) { await runPreview(); return }
    if (!plan.changed || !checkReady()) return
    if (plan.removedMedia.length && !acknowledgeRemovedMedia) {
      setError('请先确认将移出的图片和动画卡。')
      return
    }
    const payload = { id: article.id, markdown, updateTitle, token: plan.token, acknowledgeRemovedMedia }
    if (!checkSize(payload)) return
    const requestId = ++sequence.current
    setBusy('submit')
    setError('')
    try {
      const result = await reimportMarkdown(payload)
      if (requestId !== sequence.current) return
      const editing = getState().editing
      const keepEditing = editing && result.current?.blocks.some(block => block.id === editing)
      setState({
        dialog: null, reimportArticleId: null, module: 'paper', paperHome: false,
        view: 'layout', layout: null, svgCardCandidate: null,
        editing: keepEditing ? editing : null, paperSession: Date.now(),
      })
      void rememberArticleView(article.id, 'layout')
    } catch (err) {
      if (requestId !== sequence.current) return
      if (err.status === 409) {
        setPlan(null)
        setAcknowledgeRemovedMedia(false)
      }
      setError(err.message)
    } finally {
      if (requestId === sequence.current) setBusy('')
    }
  }
  return (
    <div className="ws-scrim" onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
      <form className="ws-dialog ws-import-dialog ws-reimport-dialog" role="dialog" aria-modal="true" aria-label="重新导入 Markdown" onSubmit={submit}>
        <div className="ws-dialog-head">
          <div>
            <h2 className="ws-dialog-title">重新导入 Markdown</h2>
            <p className="ws-muted ws-small">覆盖到「{article.title || '未命名文章'}」</p>
          </div>
          <button type="button" className="ws-icon-btn" aria-label="关闭" disabled={Boolean(busy)} onClick={close}><Icon name="close" /></button>
        </div>
        <MarkdownImportFields Icon={Icon} value={markdown} onChange={changeMarkdown} locked={locked} reading={reading} onReadingChange={handleReadingChange} />
        <div className="ws-reimport-options">
          <p className="ws-muted ws-small">默认只替换正文；新文件的 front matter 不会写入稿件配置。文章 ID、封面、排期、排版配置和改稿聊天保留。</p>
          {incomingTitle && incomingTitle !== article.title ? (
            <label className="ws-reimport-title-option">
              <input type="checkbox" checked={updateTitle} disabled={locked} onChange={event => changeUpdateTitle(event.target.checked)} />
              <span><b>同时更新标题</b><small>{article.title || '无标题'} → {incomingTitle}</small></span>
            </label>
          ) : null}
        </div>
        {taskReason ? <p className="ws-warn" role="alert">{taskReason}</p> : null}
        {plan ? (
          <section className="ws-reimport-impact" aria-label="覆盖影响">
            <h3>覆盖影响</h3>
            <dl className="ws-import-metrics ws-reimport-metrics">
              <div><dt>保留</dt><dd>{plan.kept} 块</dd></div>
              <div><dt>移出</dt><dd>{plan.removed} 块</dd></div>
              <div><dt>新增</dt><dd>{plan.added} 块</dd></div>
            </dl>
            <p className="ws-muted ws-small">没有可安全复用 ID 的内容按移出＋新增计算。旧摘要、标题候选和朱雀检查结果会在正文变化后清空。</p>
            {plan.transfers ? <p className="ws-import-transfer"><Icon name="upload" />{plan.transfers} 张飞书图片将在覆盖后后台转存</p> : null}
            {plan.bannerReview ? <p className="ws-warn">原有横幅样式和内容会保留，请复查旧横幅文案。</p> : null}
            {plan.removedMedia.length ? (
              <div className="ws-reimport-media">
                <b>以下内容将从正文移出：</b>
                <ul>{plan.removedMedia.map(item => <li key={`${item.blockId}:${item.occurrence ?? 0}`}>{item.kind === 'image' ? `图片：${item.caption || '无图注'}` : `动画卡：${item.title}`}（旧第 {item.number} 块）</li>)}</ul>
                <label className="ws-reimport-acknowledge">
                  <input type="checkbox" checked={acknowledgeRemovedMedia} disabled={locked} onChange={event => setAcknowledgeRemovedMedia(event.target.checked)} />
                  <span>我确认这些图片和动画卡将从正文移出，可撤销</span>
                </label>
              </div>
            ) : null}
            {!plan.changed ? <p className="ws-warn">与当前稿件一致，无需覆盖。</p> : null}
          </section>
        ) : null}
        {error ? <p className="ws-warn" role="alert">{error}</p> : null}
        <div className="ws-dialog-foot">
          <button type="button" className="ws-btn" disabled={Boolean(busy)} onClick={close}>取消</button>
          <button type="submit" className="ws-btn is-primary" disabled={locked || !markdown.trim() || Boolean(plan && (!plan.changed || (plan.removedMedia.length && !acknowledgeRemovedMedia)))}>
            {busy === 'preview' ? '正在预检…' : busy === 'submit' ? '正在覆盖…' : plan ? '确认覆盖' : '查看覆盖影响'}
          </button>
        </div>
      </form>
    </div>
  )
}

function ModelButton({ data }) {
  const title = data.modelError ? `上次调用失败：${data.modelError}` : data.modelPinned ? '插件指定的模型，点击切换' : '跟随 DeepSeek Harness 默认模型，点击切换'
  return (
    <button type="button" className={`ws-model ${data.model ? '' : 'is-off'} ${data.modelOk === false ? 'is-warn' : ''}`} title={title} onClick={() => setState({ dialog: 'model' })}>
      <Icon name="spark" size={13} />{data.model || '选择模型'}
    </button>
  )
}

function ModelDialog() {
  const [list, setList] = React.useState(null)
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => {
    loadModels().then(setList).catch(err => setList({ providers: [], default: null, current: null, error: err.message }))
  }, [])
  const close = () => setState({ dialog: null })
  const pick = async (provider, model) => {
    setBusy(true)
    const ok = await saveSettings({ model: { provider, model } })
    setBusy(false)
    if (ok) close()
  }
  const current = list?.current
  const isOn = (provider, model) => current?.provider === provider && current?.model === model
  return (
    <div className="ws-scrim" onMouseDown={e => { if (e.target === e.currentTarget) close() }}>
      <div className="ws-dialog" role="dialog" aria-modal="true" aria-label="模型">
        <div className="ws-dialog-head">
          <h2 className="ws-dialog-title">模型</h2>
          <button type="button" className="ws-icon-btn" aria-label="关闭" onClick={close}><Icon name="close" /></button>
        </div>
        <div className="ws-model-group">
          <div className="ws-chips">
            <button type="button" disabled={busy} className={list && !current ? 'is-on' : ''} aria-pressed={Boolean(list && !current)} onClick={() => pick('', '')}>
              跟随默认{list?.default?.model ? `（${list.default.model}）` : ''}
            </button>
          </div>
          <p className="ws-muted ws-small">不指定时，写稿、改稿、出标题、做横幅都用 DeepSeek Harness 的默认模型，在那边换了这里跟着换。</p>
        </div>
        {!list ? <p className="ws-shimmer">正在读取可用模型…</p> : null}
        {list?.error ? <p className="ws-warn">读取模型列表失败：{list.error}</p> : null}
        {(list?.providers ?? []).map(p => (
          <div className="ws-model-group" key={p.provider}>
            <h3>{p.name}</h3>
            <div className="ws-chips">
              {p.models.map(m => (
                <button type="button" key={m.id} disabled={busy} className={isOn(p.provider, m.id) ? 'is-on' : ''} aria-pressed={isOn(p.provider, m.id)} onClick={() => pick(p.provider, m.id)}>{m.name}</button>
              ))}
            </div>
          </div>
        ))}
        {list && !list.error && !list.providers.length ? <p className="ws-muted">DeepSeek Harness 里还没有接入模型提供方，先到那边的设置里接一个。</p> : null}
      </div>
    </div>
  )
}

function SettingsDialog({ onOpenPlugin }) {
  const settings = useStudio(s => s.settings)
  const update = useStudio(s => s.update)
  const settingsPage = useStudio(s => s.settingsPage)
  const [page, setPage] = React.useState(settingsPage ?? 'brand')
  const [cloudinary, setCloudinary] = React.useState({})
  const [brand, setBrand] = React.useState({})
  const [coverProvider, setCoverProvider] = React.useState(null)
  const [coverModels, setCoverModels] = React.useState({})
  const [coverKeys, setCoverKeys] = React.useState({})
  const [coverBaseUrls, setCoverBaseUrls] = React.useState({})
  const [portraitUrl, setPortraitUrl] = React.useState(null)
  const [persona, setPersona] = React.useState({})
  const [portraitBusy, setPortraitBusy] = React.useState(false)
  // 预览只在上传成功或输入框失焦时更新，避免手输地址时每敲一个字就请求一次图片
  const [portraitPreview, setPortraitPreview] = React.useState(null)
  const [portraitPreviewFailed, setPortraitPreviewFailed] = React.useState(false)
  const portraitInput = React.useRef(null)
  const [key, setKey] = React.useState('')
  const [endpoint, setEndpoint] = React.useState(null)
  const [fixed, setFixed] = React.useState(null)
  const [preflightWords, setPreflightWords] = React.useState(null)
  const [test, setTest] = React.useState(null)
  const [mp, setMp] = React.useState(null)
  const [mpTest, setMpTest] = React.useState(null)
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => { loadSettings() }, [])
  const close = () => setState({ dialog: null, settingsPage: null })
  if (!settings) return <div className="ws-scrim"><div className="ws-dialog"><span className="ws-shimmer">正在读取设置…</span></div></div>
  const providerValue = coverProvider ?? settings.coverProvider
  const pMeta = providerMeta(providerValue)
  const portraitConfigured = Boolean((portraitUrl ?? settings.portraitUrl ?? '').trim())
  const pages = [
    { id: 'brand', group: '账号与形象', title: '公众号品牌', icon: 'doc', description: '设置开头横幅和文末关注卡的品牌文案。' },
    { id: 'persona', group: '账号与形象', title: 'IP 人物形象', icon: 'user', description: '设置封面中出现的人物参考图、性别、服装与外貌补充。', ready: portraitConfigured, readyLabel: portraitConfigured ? '已设参考图' : '随机人物' },
    { id: 'cover', group: '视觉与媒体', title: '生图模型', icon: 'spark', description: pMeta.description, ready: settings[pMeta.keySetField], link: pMeta.link, linkLabel: pMeta.linkLabel },
    { id: 'storage', group: '视觉与媒体', title: '图片图床', icon: 'upload', description: '将飞书图片自动转存到 Cloudinary，供排版预览使用。', ready: Boolean(settings.cloudinary?.cloudName && settings.cloudinary?.apiKey && settings.cloudinary?.apiSecretSet), link: 'https://console.cloudinary.com/settings/api-keys', linkLabel: 'Cloudinary API Keys' },
    { id: 'quality', group: '质检与发布', title: '朱雀质检', icon: 'scan', description: '管理检测凭证和需要排除的固定文案。', ready: settings.zhuqueKeySet, link: 'https://console.cloud.tencent.com/edgeone', linkLabel: 'EdgeOne 控制台' },
    { id: 'preflight', group: '质检与发布', title: '发布体检', icon: 'check', description: '配置本地发布防踩坑体检的自定义提醒词（仅提醒，不阻断发布）。' },
    { id: 'mp', group: '质检与发布', title: '公众号凭证', icon: 'key', description: '配置公众号的 AppID 和 AppSecret，用于一键推送排版好的内容到草稿箱。', ready: settings.mp?.appSecretSet, link: 'https://developers.weixin.qq.com/platform', linkLabel: '微信开发者平台' },
  ]
  const selected = pages.find(item => item.id === page)
  const endpointValue = endpoint ?? (settings.zhuqueEndpointDefault ? '' : settings.zhuqueEndpoint)
  const fixedValue = fixed ?? settings.fixedLines.join('\n')
  const preflightWordsValue = preflightWords ?? (settings.preflightWords ?? []).join('\n')
  const patch = () => {
    const out = { zhuqueEndpoint: endpointValue, fixedLines: fixedValue.split('\n') }
    if (preflightWords !== null) out.preflightWords = preflightWords.split('\n')
    out.brand = brand
    out.coverProvider = providerValue
    for (const item of COVER_PROVIDERS) {
      const meta = providerMeta(item.id)
      out[meta.modelField] = coverModels[item.id] ?? settings[meta.modelField]
      const trimmedKey = (coverKeys[item.id] ?? '').trim()
      if (trimmedKey) out[meta.keyField] = trimmedKey
      if (meta.baseUrlField && coverBaseUrls[item.id] !== undefined) {
        out[meta.baseUrlField] = coverBaseUrls[item.id].trim()
      }
    }
    out.persona = { ...settings.persona, ...persona }
    // 只有改过才提交，避免把读到的旧值（可能是作者示例照片）再写一遍
    if (portraitUrl !== null) out.portraitUrl = portraitUrl
    if (key.trim()) out.zhuqueKey = key.trim()
    out.cloudinary = { ...cloudinary }
    if (out.cloudinary.apiSecret === '') delete out.cloudinary.apiSecret
    out.mp = { ...(mp ?? {}) }
    if (out.mp.appSecret === '') delete out.mp.appSecret
    return out
  }
  const runTest = async () => {
    setTest({ running: true })
    setTest(await testZhuque({ zhuqueKey: key.trim(), zhuqueEndpoint: endpointValue }))
  }
  const runMpTest = async () => {
    setMpTest({ running: true })
    const patch = mp ?? {}
    // 没填的项用已保存的值：和后端「填了就试新的，没填就试已保存的」约定对齐
    setMpTest(await testWechat({ mpAppId: patch.appId?.trim() || undefined, mpAppSecret: patch.appSecret?.trim() || undefined }))
  }
  const submit = async event => {
    event.preventDefault()
    setBusy(true)
    const ok = await saveSettings(patch())
    setBusy(false)
    if (ok) close()
  }
  const clearKey = async () => {
    if (await saveSettings({ zhuqueKey: '' })) { setKey(''); setTest(null) }
  }
  return (
    <div className="ws-scrim" onMouseDown={e => { if (e.target === e.currentTarget) close() }}>
      <form className="ws-dialog ws-settings-dialog" role="dialog" aria-modal="true" aria-label="设置" onSubmit={submit}>
        <div className="ws-dialog-head">
          <h2 className="ws-dialog-title">设置</h2>
          <button type="button" className="ws-icon-btn" aria-label="关闭" onClick={close}><Icon name="close" /></button>
        </div>

        <div className="ws-settings-body">
          <nav className="ws-settings-nav" aria-label="设置分类">
            {pages.map((item, index) => (
              <React.Fragment key={item.id}>
                {index === 0 || pages[index - 1].group !== item.group
                  ? <span className="ws-settings-nav-group">{item.group}</span> : null}
                <button type="button" aria-current={page === item.id ? 'page' : undefined}
                  onClick={() => setPage(item.id)}><Icon name={item.icon} /><span>{item.title}</span></button>
              </React.Fragment>
            ))}
            {settings.version ? <div className="ws-settings-version">
              <span>v{settings.version}</span>
              {update ? <a className="ws-settings-update" href="https://github.com/lqshow/dsh-wechat-studio/releases/latest" target="_blank" rel="noreferrer"
                aria-label={`新版本 v${update.latest}，前往更新`}
                onClick={event => { if (onOpenPlugin?.()) { event.preventDefault(); close() } }}>新版本 <strong>↑ v{update.latest}</strong></a> : null}
            </div> : null}
          </nav>
          <div className="ws-settings-content">
            <div className="ws-settings-section-head">
              <h3>{selected.title}</h3>
              {selected.ready !== undefined ? <span className={`ws-settings-status ${selected.ready ? 'ws-ok' : 'ws-muted'}`}>{selected.readyLabel ?? (selected.ready ? '已配置' : '未配置')}</span> : null}
            </div>
            <p className="ws-settings-description ws-muted">{selected.description}</p>
            {selected.link ? <a className="ws-link ws-settings-provider" href={selected.link} target="_blank" rel="noreferrer">{selected.linkLabel} ↗</a> : null}

            <fieldset className="ws-group ws-settings-fields" hidden={page !== 'brand'}>
              <label className="ws-field"><span>账号名称</span>
                <input value={brand.author ?? settings.brand?.author ?? ''} maxLength={32}
                  onChange={e => setBrand({ ...brand, author: e.target.value })} />
              </label>
              <label className="ws-field"><span>Slogan</span>
                <input value={brand.slogan ?? settings.brand?.slogan ?? ''} maxLength={80}
                  onChange={e => setBrand({ ...brand, slogan: e.target.value })} />
              </label>
              <p className="ws-muted ws-small">用于开头横幅和文末关注卡。清空并保存可恢复默认文案。</p>
            </fieldset>
            <fieldset className="ws-group ws-settings-fields" hidden={page !== 'cover'}>
              <div className="ws-field"><span>生图提供方</span>
                <div className="ws-provider-cards" role="radiogroup" aria-label="生图提供方">
                  {COVER_PROVIDERS.map(item => {
                    const meta = providerMeta(item.id)
                    const ready = Boolean(settings[meta.keySetField])
                    return <label key={item.id} className="ws-provider-card">
                      <input type="radio" name="cover-provider" value={item.id}
                        checked={providerValue === item.id} onChange={() => setCoverProvider(item.id)} />
                      <span className="ws-provider-card-body">
                        <span className="ws-provider-card-head">
                          <strong>{item.name}</strong>
                          {ready ? <span className="ws-provider-dot" title="已配置 API Key" aria-label="已配置" /> : null}
                        </span>
                        {meta.subtitle ? <small>{meta.subtitle}</small> : null}
                      </span>
                    </label>
                  })}
                </div>
              </div>
              <label className="ws-field"><span>图片模型</span>
                <select value={coverModels[providerValue] ?? settings[pMeta.modelField]}
                  onChange={e => setCoverModels(prev => ({ ...prev, [providerValue]: e.target.value }))}>
                  {modelsFor(providerValue).map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
                </select>
              </label>
              <label className="ws-field"><span>API Key</span>
                <input type="password" autoComplete="off" value={coverKeys[providerValue] ?? ''}
                  onChange={e => setCoverKeys(prev => ({ ...prev, [providerValue]: e.target.value }))}
                  placeholder={settings[pMeta.keySetField] ? '已保存，留空表示不改' : pMeta.keyPlaceholder} />
              </label>
              {pMeta.baseUrlField ? <label className="ws-field"><span>API 地址（选填）</span>
                <input type="url" spellCheck={false}
                  value={coverBaseUrls[providerValue] ?? settings[pMeta.baseUrlField] ?? ''}
                  onChange={e => setCoverBaseUrls(prev => ({ ...prev, [providerValue]: e.target.value }))}
                  placeholder={`${pMeta.defaultBaseUrl}，留空使用官方地址`} />
              </label> : null}
              {pMeta.hint ? <p className="ws-muted ws-small">{pMeta.hint}</p> : null}
            </fieldset>
            <fieldset className="ws-group ws-settings-fields" hidden={page !== 'persona'}>
              {(() => {
                const portraitValue = portraitUrl ?? settings.portraitUrl ?? ''
                const previewUrl = portraitPreview ?? settings.portraitUrl ?? ''
                const showPreview = /^https:\/\//.test(previewUrl) && !portraitPreviewFailed
                const updatePreview = value => { setPortraitPreview(value); setPortraitPreviewFailed(false) }
                const personaValue = { ...settings.persona, ...persona }
                const cloudReady = Boolean(settings.cloudinary?.cloudName && settings.cloudinary?.apiKey && settings.cloudinary?.apiSecretSet)
                const pick = async file => {
                  if (!file) return
                  if (file.size > 10 * 1024 * 1024) { toast('照片不能超过 10 MB。', true); return }
                  if (file.type === 'image/gif') { toast('参考照片请用 PNG、JPEG 或 WebP。', true); return }
                  setPortraitBusy(true)
                  try {
                    const url = await uploadPortrait(file)
                    setPortraitUrl(url)
                    updatePreview(url)
                  } catch (err) { toast(err.message, true) } finally { setPortraitBusy(false) }
                }
                return <>
                  <label className="ws-field"><span>IP 人物参考图</span>
                    <input type="url" spellCheck={false} value={portraitValue}
                      placeholder="https://…/portrait.png，留空则不带参考图" onChange={e => setPortraitUrl(e.target.value)}
                      onBlur={e => updatePreview(e.target.value.trim())} />
                  </label>
                  {portraitUrl === null && settings.portraitIsAuthorSample ? <p className="ws-warn ws-small" role="status">当前参考图是插件作者的示例照片。如果你不是作者本人，请换成自己的照片，或者清空。</p> : null}
                  <div className="ws-local-image-actions">
                    <button type="button" className="ws-btn" disabled={!cloudReady || portraitBusy} onClick={() => portraitInput.current?.click()}>
                      <Icon name="upload" />{portraitBusy ? '正在上传…' : '上传本地照片'}
                    </button>
                    <input ref={portraitInput} type="file" accept="image/png,image/jpeg,image/webp" hidden
                      onChange={e => { pick(e.target.files?.[0]); e.target.value = '' }} />
                    {showPreview ? <img className="ws-portrait-thumb" src={previewUrl} alt="参考图预览"
                      referrerPolicy="no-referrer" onError={() => setPortraitPreviewFailed(true)} /> : null}
                    {portraitPreviewFailed ? <span className="ws-warn ws-small">这张图打不开，请检查地址是否公网可访问。</span> : null}
                    <span className="ws-muted ws-small">{cloudReady ? '上传后会转存到你的 Cloudinary，再点保存生效。' : '上传本地照片需要先在「图片图床」配置 Cloudinary；也可以直接粘贴图片地址。'}</span>
                  </div>
                  <p className="ws-muted ws-small">建议用清晰的正脸半身照（能看到上衣），选「沿用参考图衣服」即可保留原穿搭；如果只传了头像，下面服装改选「简约纯色上衣」。留空则每次随机生成人物。</p>
                  <label className="ws-field"><span>人物性别</span>
                    <select value={personaValue.gender} onChange={e => setPersona({ ...persona, gender: e.target.value })}>
                      <option value="auto">自动（按参考图）</option><option value="male">男</option><option value="female">女</option>
                    </select>
                  </label>
                  <label className="ws-field"><span>服装</span>
                    <select value={personaValue.outfit} onChange={e => setPersona({ ...persona, outfit: e.target.value })}>
                      <option value="photo">沿用参考图衣服（适合半身照）</option>
                      <option value="simple">简约纯色上衣（适合只有头像）</option>
                      <option value="custom">自定义描述</option>
                    </select>
                  </label>
                  {personaValue.outfit === 'custom' ? <label className="ws-field"><span>服装描述</span>
                    <textarea rows={3} maxLength={300} value={personaValue.outfitText}
                      placeholder="例如：午夜绿（#004953）宽松华夫格短袖 Polo，落肩，领口敞开"
                      onChange={e => setPersona({ ...persona, outfitText: e.target.value })} />
                  </label> : null}
                  <label className="ws-field"><span>外貌补充</span>
                    <input maxLength={120} value={personaValue.appearance} placeholder="例如：短黑发，戴细黑框眼镜（没有参考图或羊毛毡风格时使用）"
                      onChange={e => setPersona({ ...persona, appearance: e.target.value })} />
                  </label>
                </>
              })()}
            </fieldset>
            <fieldset className="ws-group ws-settings-fields" hidden={page !== 'storage'}>
              {['cloudName', 'apiKey', 'apiSecret'].map((field, index) => (
                <label className="ws-field" key={field}><span>{['Cloud Name', 'API Key', 'API Secret'][index]}</span>
                  <input type={field === 'apiSecret' ? 'password' : 'text'} autoComplete="off" spellCheck={false}
                    value={cloudinary[field] ?? settings.cloudinary?.[field] ?? ''}
                    placeholder={field === 'apiSecret' && settings.cloudinary?.apiSecretSet ? '已保存，留空表示不改' : ''}
                    onChange={e => setCloudinary({ ...cloudinary, [field]: e.target.value })} />
                </label>
              ))}
            </fieldset>

            <fieldset className="ws-group ws-settings-fields" hidden={page !== 'quality'}>
              <label className="ws-field"><span>API Key{settings.zhuqueKeySet ? <em className="ws-ok">已保存，末四位 {settings.zhuqueKeyTail}</em> : null}</span>
                <input type="password" value={key} autoComplete="off" spellCheck={false} placeholder={settings.zhuqueKeySet ? '留空表示不改' : '粘贴 EdgeOne Makers 的 API Key'} onChange={e => { setKey(e.target.value); setTest(null) }} />
              </label>
              <p className="ws-muted ws-small">在腾讯云 EdgeOne 控制台的 Makers → Models → API Key 里创建。密钥只存在这台电脑上，检测时直接发给腾讯云的接口。</p>
              <div className="ws-row-actions">
                <button type="button" className="ws-btn" disabled={test?.running || (!key.trim() && !settings.zhuqueKeySet)} onClick={runTest}>{test?.running ? '正在测试…' : '测试连接'}</button>
                {settings.zhuqueKeySet ? <button type="button" className="ws-link" onClick={clearKey}>清除已保存的 Key</button> : null}
                {test?.ok ? <span className="ws-ok"><Icon name="check" size={13} />能用{test.tokens !== null && test.tokens !== undefined ? `，这次测试用了 ${test.tokens} token` : ''}</span> : null}
              </div>
              {test?.error ? <p className="ws-warn">{test.error}</p> : null}
              <details className="ws-manual">
                <summary>高级</summary>
                <label className="ws-field"><span>接口地址</span>
                  <input type="url" value={endpointValue} spellCheck={false} placeholder="留空用默认的 EdgeOne 网关" onChange={e => { setEndpoint(e.target.value); setTest(null) }} />
                </label>
              </details>
            </fieldset>

            <fieldset className="ws-group ws-settings-fields" hidden={page !== 'quality'}>
              <legend>检测时去掉的固定句</legend>
              <label className="ws-field"><span>每行一句。检测文本里含有这些文字的行会整行去掉</span>
                <textarea rows={3} value={fixedValue} onChange={e => setFixed(e.target.value)} />
              </label>
              <p className="ws-muted ws-small">每篇都一样的开头语、结尾引导会和正文混进同一个片段，把分数拉高。</p>
            </fieldset>

            <fieldset className="ws-group ws-settings-fields" hidden={page !== 'preflight'}>
              <label className="ws-field"><span>自定义提醒词（每行一个，最多 100 个）</span>
                <textarea rows={6} value={preflightWordsValue}
                  placeholder="例如：竞品名、客户禁用词、内部项目代号"
                  onChange={e => setPreflightWords(e.target.value)} />
              </label>
              <p className="ws-muted ws-small">正文命中这些词时会在「发布防踩坑体检」中标出（跳过代码块与固定句），仅提醒不阻断发布。风险词检查仅供人工复核，不代表微信官方审核结论。</p>
            </fieldset>

            <fieldset className="ws-group ws-settings-fields" hidden={page !== 'mp'}>
              <label className="ws-field"><span>公众号名称</span>
                <input value={mp?.name ?? settings.mp?.name ?? ''} maxLength={100}
                  onChange={e => setMp({ ...mp, name: e.target.value })} />
              </label>
              <label className="ws-field"><span>AppID</span>
                <input spellCheck={false} autoComplete="off" value={mp?.appId ?? settings.mp?.appId ?? ''}
                  placeholder="例如 wx1234567890abcdef"
                  onChange={e => { setMp({ ...mp, appId: e.target.value }); setMpTest(null) }} />
              </label>
              <label className="ws-field"><span>AppSecret</span>
                <input type="password" autoComplete="off" spellCheck={false} value={mp?.appSecret ?? ''}
                  placeholder={settings.mp?.appSecretSet ? '已保存，留空表示不改' : '粘贴 AppSecret'}
                  onChange={e => { setMp({ ...mp, appSecret: e.target.value }); setMpTest(null) }} />
              </label>
              <p className="ws-muted ws-small">在微信开发者平台「我的业务 → 公众号/服务号 → 基础信息 → 开发密钥」里查看 AppID、AppSecret 和配置 IP 白名单（需管理员或开发者微信扫码登录）。凭证只存在这台电脑上，推送草稿箱时直接发给微信的接口。如果验证或推送提示 IP 不在白名单，把提示里的 IP 加进「开发密钥 → IP 白名单」再试。</p>
              <div className="ws-row-actions">
                <button type="button" className="ws-btn" disabled={mpTest?.running
                  || (!mp?.appSecret?.trim() && !settings.mp?.appSecretSet)
                  || (!mp?.appId?.trim() && !settings.mp?.appId)}
                  onClick={runMpTest}>{mpTest?.running ? '正在验证…' : '验证凭证'}</button>
                {mpTest?.ok ? <span className="ws-ok"><Icon name="check" size={13} />凭证有效{mpTest.nickname ? `，公众号：${mpTest.nickname}` : ''}</span> : null}
              </div>
              {mpTest?.error ? <p className="ws-warn">{mpTest.error}</p> : null}
            </fieldset>

          </div>
        </div>
        <div className="ws-dialog-foot">
          <button type="button" className="ws-btn" onClick={close}>取消</button>
          <button type="submit" className="ws-btn is-primary" disabled={busy}>{busy ? '正在保存…' : '保存设置'}</button>
        </div>
      </form>
    </div>
  )
}

function Empty({ model }) {
  return (
    <div className="ws-empty">
      <h1>把写好的文章放上来，<span>改到能发为止。</span></h1>
      <p>按段改稿、朱雀报告质检、公众号排版和一键复制，都在这一页。</p>
      <div className="ws-empty-actions">
        <button type="button" className="ws-btn is-primary is-big" onClick={() => setState({ dialog: 'new' })}><Icon name="plus" />新建文章</button>
      </div>
      {model ? null : <p className="ws-warn">还没有可用的模型。先在 DeepSeek Harness 里配置好模型，写稿和改稿才能用。</p>}
    </div>
  )
}

const MODULES = [
  { id: 'materials', label: '素材', icon: 'materials', soon: true, title: '素材', lead: '把零散的灵感、链接、聊天记录先放这里，攒够了挑几条一起成稿。', points: ['一句话、一个链接、一段聊天记录，贴进来就是一张卡片', '挑几张卡片一起成稿，稿子会记住用了哪些素材', '素材里出现过的事实和原话，写稿时优先用'] },
  { id: 'paper', label: '稿面', icon: 'doc' },
  { id: 'schedule', label: '排期', icon: 'schedule' },
  { id: 'insights', label: '复盘', icon: 'insights', title: '复盘', lead: '导入公众号后台导出的数据，看哪种写法读的人更多。', points: ['单篇阅读、账号每日趋势按篇对比', '成稿时记下的标题套路、横幅和皮肤，可以拿来比较', '从数据里提炼出的规则，确认后写进写作 skill'] },
  { id: 'skills', label: '技能', icon: 'skills' },
]

const SKILL_INFO = {
  writer: { name: '写作', use: '写正文、对话改稿' },
  headline: { name: '标题', use: '出标题候选和摘要' },
  humanizer: { name: '去 AI 味', use: '改写朱雀标红的段落' },
  zhuque: { name: '朱雀流程', use: '按报告逐段改，什么时候停手' },
  banner: { name: '开头横幅', use: '按文章写横幅规格' },
  cover: { name: '封面生成', use: '按文章和所选风格填写封面提示词。内置 7 套风格模板与禁用词表在内置技能目录；自定义封面风格可在上方卡片或封面选择弹窗中新建管理。' },
  'inline-diagram': { name: '正文插图', use: '识别插图位置，从技能目录动态读取全部风格。可在覆盖目录中增加或覆盖风格文件。' },
  'wechat-svg-cards': { name: '公众号动画卡片', use: '按段落生成概念、步骤、对比、数据与演示卡，使用同一排版引擎导出 SMIL 动画。' },
  'repurpose-thread': { name: '一稿多发 · 串推', use: '从母稿挑选并压缩核心观点，生成即刻动态串或 X 串推。' },
  'repurpose-xhs': { name: '一稿多发 · 小红书', use: '把母稿拆解为 5～8 页高密度小红书卡片及标题、正文与标签。' },
}

function Rail({ module }) {
  const update = useStudio(s => s.update)
  return (
    <nav className="ws-rail" aria-label="模块">
      {MODULES.filter(item => item.id !== 'materials').map(item => (
        <button type="button" key={item.id} className={module === item.id ? 'is-on' : ''} aria-current={module === item.id ? 'page' : undefined} onClick={() => setState({ module: item.id, ...(item.id === 'paper' ? { paperHome: true } : {}) })}>
          <Icon name={item.icon} size={20} />
          <span>{item.label}</span>
          {item.soon ? <small>即将</small> : null}
        </button>
      ))}
      <span className="ws-grow" />
      <button type="button" title={update ? `发现新版本 v${update.latest}` : '设置'} onClick={() => setState({ dialog: 'settings' })}>
        <Icon name="gear" size={20} /><span>设置</span>{update ? <i className="ws-update-dot" aria-hidden="true" /> : null}
      </button>
    </nav>
  )
}

function SoonView({ item }) {
  return (
    <div className="ws-soon">
      <p className="ws-soon-tag">还在做</p>
      <h1>{item.title}</h1>
      <p className="ws-soon-lead">{item.lead}</p>
      <ul>{item.points.map(point => <li key={point}>{point}</li>)}</ul>
      <button type="button" className="ws-btn" onClick={() => setState({ module: 'paper' })}>回到稿面</button>
    </div>
  )
}

function SkillsView() {
  const skills = useStudio(s => s.skills)
  React.useEffect(() => { loadSkills(); void loadStyleProfile() }, [])
  if (!skills) return <div className="ws-center"><span className="ws-shimmer">正在读取…</span></div>
  if (skills.error) return <div className="ws-center"><p className="ws-muted">读取失败：{skills.error}</p></div>
  return (
    <main className="ws-page">
      <div className="ws-dh-shell ws-skills">
        <header className="ws-dh-masthead">
          <div className="ws-dh-masthead-left">
            <span className="ws-dh-kicker">WRITING SKILLS · 技能与风格</span>
            <div className="ws-dh-title-row">
              <h1>技能</h1>
              <p className="ws-dh-dateline"><span><b>{skills.skills.length}</b> 项技能</span></p>
            </div>
          </div>
        </header>
        <WritingStyleCard />
        <CustomCoverStyleCard />
        <p className="ws-page-lead">这里显示插件当前使用的技能。写作、标题、去 AI 味、朱雀流程、开头横幅和一稿多发可以通过下方目录覆盖。封面和正文插图使用目录式技能；正文插图支持在覆盖目录中增加或覆盖风格。</p>
        <div className="ws-skill-list">
          {skills.skills.map(item => (
            <div className="ws-skill" key={item.name}>
              <div className="ws-skill-head">
                <strong>{SKILL_INFO[item.name]?.name ?? item.name}</strong>
                <span className={`ws-skill-src ${item.source === 'user' ? 'is-user' : ''}`}>{item.source === 'user' ? '你的版本' : item.source === 'missing' ? '缺失' : '内置'}</span>
              </div>
              <p className="ws-muted">{SKILL_INFO[item.name]?.use}</p>
              <code>{item.displayPath ?? `${item.name}.md`}{item.chars ? ` · ${Math.round(item.chars / 1000)}K` : ''}</code>
            </div>
          ))}
        </div>
        <div className="ws-skill-dir">
          <span>覆盖目录</span>
          <code>{skills.dir}</code>
          <button type="button" className="ws-link" onClick={() => navigator.clipboard?.writeText(skills.dir)}>复制路径</button>
        </div>
      </div>
    </main>
  )
}

const revisionKinds = { title: '标题', rewrite: '改写', insert: '新增', delete: '删除', move: '调整顺序' }

function RevisionDialog({ article, blockId }) {
  const pending = useStudio(s => s.pending)
  const modal = React.useRef(null)
  const [result, setResult] = React.useState(null)
  const [selected, setSelected] = React.useState(null)
  const headingId = React.useId()
  const close = () => setState({ dialog: null })
  React.useEffect(() => {
    const dialog = modal.current
    dialog.showModal()
    return () => { if (dialog.open) dialog.close() }
  }, [])
  React.useEffect(() => {
    if (blockId) return
    const controller = new AbortController()
    loadRevisions(article.id, controller.signal).then(data => {
      if (!controller.signal.aborted) setResult(data)
    }).catch(error => {
      if (!controller.signal.aborted) setResult({ error: error.message })
    })
    return () => controller.abort()
  }, [article.id, blockId])
  const index = blockId ? article.blocks.findIndex(block => block.id === blockId) : -1
  const block = article.blocks[index]
  const restored = block?.lastChangeWasRestore
  const revision = blockId ? block?.previousText != null ? { index, rows: [{
    kind: 'rewrite', before: { text: block.previousText, number: index + 1 }, after: { text: block.text, number: index + 1 },
  }] } : null : result?.revisions?.find(item => item.index === selected) ?? result?.revisions?.[0]
  const renderCell = (entry, empty, side, kind) => (
    <div className={`ws-revision-cell is-${side}${entry ? '' : ' is-empty'}`}>
      <span className="ws-revision-cell-label">{blockId ? side === 'before' ? (restored ? '恢复前的版本' : '上一个版本') : '当前正文' : side === 'before' ? '改稿前' : '改稿后'}{entry?.number ? ` · 第 ${entry.number} 段` : kind === 'title' ? ' · 标题' : ''}</span>
      {entry ? <p>{entry.text}</p> : <p className="ws-muted">{empty}</p>}
    </div>
  )
  return (
    <dialog ref={modal} className="ws-dialog ws-revision-dialog" aria-labelledby={headingId}
      onCancel={event => { event.preventDefault(); close() }}
      onClick={event => { if (event.target === event.currentTarget) close() }}>
      <div className="ws-dialog-head">
        <div><h2 id={headingId} className="ws-dialog-title">{block ? `第 ${index + 1} 段 · 看改动` : '改稿对比'}</h2><p className="ws-muted ws-small">{blockId ? (restored ? '这一段已恢复，右侧是当前正文。' : '对照上一个版本和当前正文') : '逐次查看标题和正文的改动'}</p></div>
        <button type="button" className="ws-icon-btn" aria-label="关闭" onClick={close}><Icon name="close" /></button>
      </div>
      {revision ? (
        <>
          {!blockId ? <div className="ws-revision-tools">
            <label>改稿记录
              <select value={revision.index} onChange={event => setSelected(Number(event.target.value))}>
                {result.revisions.map((item, i) => (
                  <option key={item.index} value={item.index}>{i === 0 ? '最近一次 · ' : ''}{item.label} · {draftDate.format(new Date(item.at))}</option>
                ))}
              </select>
            </label>
            <span className="ws-muted ws-small">{revision.rows.length} 处改动</span>
          </div> : null}
          <div className="ws-revision-rows" key={revision.index} tabIndex={0} aria-label="改稿差异">
            {revision.rows.map((row, i) => (
              <section className={`ws-revision-row is-${row.kind}`} key={i}>
                <div className="ws-revision-kind">{restored ? '已恢复' : revisionKinds[row.kind]}</div>
                {renderCell(row.before, row.kind === 'title' ? '原来没有标题' : '原来没有这段', 'before', row.kind)}
                {renderCell(row.after, row.kind === 'title' ? '标题已移除' : '这段已删除', 'after', row.kind)}
              </section>
            ))}
          </div>
          {blockId ? <div className="ws-revision-tools">
            <span className="ws-muted ws-small">只恢复这一段，恢复后可以撤销。</span>
            <button type="button" className="ws-btn is-primary" disabled={Boolean(pending || article.job || draftsFor(article.id).has(blockId))}
              title={draftsFor(article.id).has(blockId) ? '请先保存或取消这一段的未保存修改' : undefined}
              onClick={async () => {
                if (await act('block/restore-revision', { id: article.id, blockId, expectedText: block.text, previousText: block.previousText })) {
                  close()
                  toast(restored ? '已切回恢复前的版本，可撤销' : '已恢复左侧版本，可撤销')
                }
              }}>{restored ? '切回恢复前的版本' : '恢复左侧版本'}</button>
          </div> : null}
        </>
      ) : <p className="ws-revision-message ws-muted" role="status">{blockId ? '这一段已没有可对比的上一版。' : result?.error ? `加载失败：${result.error}` : result ? '还没有可对比的标题或正文改动。' : '正在读取改稿记录…'}</p>}
    </dialog>
  )
}

function PaperModule({ data }) {
  const view = useStudio(s => s.view)
  const chatOpen = useStudio(s => s.chatOpen)
  const deriveDrafts = useStudio(s => s.deriveDrafts)
  useStudio(s => s.draftVersion)
  const [review, setReview] = React.useState(null)
  const [side, setSide] = React.useState(null)
  const sideTabId = React.useId()
  const article = data.current
  if (!article) return <Empty model={data.model} />
  const sideTab = side?.articleId === article.id ? side.tab : 'article'
  const selectSideTab = tab => setSide({ articleId: article.id, tab })
  const openQuality = () => {
    if (view !== 'paper') openArticleView(article, 'paper')
    selectSideTab('quality')
    requestAnimationFrame(() => document.getElementById(sideTabId + '-quality')?.focus())
  }
  const reviewTarget = review?.articleId === article.id ? review.blockId : null
  const jumpToReview = (blockId, focus = false) => {
    setReview({ articleId: article.id, blockId })
    const row = document.getElementById(`ws-review-${article.id}-${blockId}`)
    if (focus) row?.querySelector('.ws-block, .ws-edit')?.focus({ preventScroll: true })
    row?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }
  const flagged = article.blocks.filter(b => b.check?.status === 'flag').length
  const retest = article.blocks.filter(b => b.check?.status === 'fixed').length
  return (
    <>
      <header className="ws-top" data-window-drag="">
        <nav className="ws-crumb" aria-label="当前位置"><button type="button" className="ws-link" onClick={() => setState({ paperHome: true })}>稿面</button><span aria-hidden="true">/</span><Switcher data={data} /></nav>
        <Steps article={article} flagged={flagged} retest={retest} onQuality={openQuality} />
        {view === 'paper' && article.blocks.length ? <PaperNavigation key={`navigation:${article.id}`} article={article} target={reviewTarget} onJump={jumpToReview} /> : null}
        <UnsavedParagraphs key={`unsaved:${article.id}`} article={article} />
        <span className="ws-grow" />
        <div className="ws-tabs" role="tablist" aria-label="视图">
          <button type="button" role="tab" aria-selected={view === 'paper'} className={view === 'paper' ? 'is-on' : ''} onClick={() => openArticleView(article, 'paper')}>稿面</button>
          <button type="button" role="tab" aria-selected={view === 'layout'} className={view === 'layout' ? 'is-on' : ''} onClick={() => openArticleView(article, 'layout')}>排版预览</button>
          <button type="button" role="tab" aria-selected={view === 'derive'} className={view === 'derive' ? 'is-on' : ''} onClick={() => setState({ view: 'derive', editing: null })}>一稿多发{hasUnsavedDeriveDrafts(article.id, deriveDrafts) ? <i className="ws-derive-tab-dot" aria-label="有未保存修改" /> : null}</button>
        </div>
        {article.canUndo ? <button type="button" className="ws-btn" disabled={Boolean(article.job)} onClick={() => setState({ dialog: 'revisions' })}>改稿对比</button> : null}
        {article.canUndo ? <button type="button" className="ws-icon-btn" aria-label="撤销上一步" title="撤销上一步" disabled={Boolean(article.job)} onClick={() => act('undo')}><Icon name="undo" /></button> : null}
        <button type="button" className="ws-icon-btn" aria-label={chatOpen ? '收起改稿对话' : '打开改稿对话'} aria-pressed={chatOpen} onClick={() => setState({ chatOpen: !chatOpen })}><Icon name="chat" /></button>
        <ModelButton data={data} />
        <button type="button" className="ws-icon-btn" aria-label="设置" title="设置" onClick={() => setState({ dialog: 'settings' })}><Icon name="gear" /></button>
      </header>
      {article.imageImport?.error ? (
        <div className="ws-banner is-error" role="status">
          <span>飞书图片转存未完成。{article.imageImport.error}</span>
          <button type="button" className="ws-btn" onClick={() => act('images/retry')}>重试转存</button>
        </div>
      ) : article.imageImport?.total ? (
        <div className="ws-transfer-banner">
          <span className="ws-transfer-icon"><Icon name="upload" size={18} /></span>
          <div className="ws-transfer-content">
            <div className="ws-transfer-heading">
              <strong>正在后台转存飞书图片</strong>
              <span>{article.imageImport.done} / {article.imageImport.total} 张</span>
            </div>
            <progress aria-label="飞书图片转存进度" value={article.imageImport.done} max={article.imageImport.total} />
            <p className="ws-muted ws-small">正文已导入，可以继续编辑。</p>
          </div>
        </div>
      ) : null}
      {article.notice ? (
        <div className={`ws-banner ${article.notice.error ? 'is-error' : ''}`} role="status">
          <span>{article.notice.text}</span>
          <button type="button" className="ws-icon-btn" aria-label="关闭提示" onClick={() => act('notice/clear', {}, { quiet: true })}><Icon name="close" size={14} /></button>
        </div>
      ) : null}
      <div className={`ws-body ${chatOpen && view === 'paper' ? '' : 'no-chat'}`}>
        {chatOpen && view === 'paper' ? <ChatPane article={article} /> : null}
        <main className="ws-main">{view === 'layout' ? <LayoutView article={article} brand={data.brand} mp={data.mp} /> : view === 'derive' ? <DeriveView article={article} brand={data.brand} /> : <Paper article={article} reviewTarget={reviewTarget} />}</main>
        {view === 'paper' ? <SidePane key={article.id} article={article} tab={sideTab} onTab={selectSideTab} tabId={sideTabId} flagged={flagged} retest={retest} ready={data.zhuqueReady} reviewTarget={reviewTarget} onReviewJump={jumpToReview} cloudinaryReady={data.cloudinaryReady} unsavedCount={unsavedParagraphCount(article)} /> : null}
      </div>
    </>
  )
}

const shortScheduleDate = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
})

const mastheadWeekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'short' })

function formatShortDate(value) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : shortScheduleDate.format(date)
}

function formatMastheadDateline(now = new Date()) {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}.${m}.${d} · ${mastheadWeekday.format(now)}`
}

function DraftArtwork({ draft }) {
  const [failed, setFailed] = React.useState(false)
  const issueNo = draft.issueNo ?? '01'
  const stamp = draft.archivedAt ? '已归档'
    : draft.publishedAt ? '已发表'
      : (draft.review ?? 0) > 0 ? '改稿打磨中'
        : '待配封面'
  const tone = draft.archivedAt ? 'is-archived'
    : (draft.review ?? 0) > 0 ? 'is-review'
      : 'is-pending'
  return (
    <div className="ws-draft-art">
      {draft.coverId && !failed ? (
        <img src={`wechat-studio/cover/image?${new URLSearchParams({ id: draft.id, asset: draft.coverId })}`}
          alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <div className={`ws-draft-typo ${tone}`} aria-hidden="true">
          <div className="ws-draft-typo-top">
            <span>{draft.archivedAt ? 'ARCHIVED' : 'DRAFT'} · NO.{issueNo}</span>
            <span>约 {readMinutes(draft.chars)} MIN</span>
          </div>
          <div className="ws-draft-typo-mid">
            <span className="ws-draft-typo-num">{issueNo}</span>
            <span className="ws-draft-typo-stamp">{stamp}</span>
          </div>
        </div>
      )}
    </div>
  )
}

function DraftStatusBadge({ draft }) {
  if (draft.archivedAt) return <span className="ws-dh-badge is-muted">已归档</span>
  if (draft.publishedAt) return <span className="ws-dh-badge is-ready">已发表</span>
  if ((draft.review ?? 0) > 0) return <span className="ws-dh-badge is-review">{draft.review} 段待检查</span>
  if (draft.scheduledFor) return <span className="ws-dh-badge is-sched">排期 · {formatShortDate(draft.scheduledFor)}</span>
  if (isDraftReady(draft)) return <span className="ws-dh-badge is-ready">已就绪</span>
  const items = draft.readiness?.items
  if (!items?.length) return null
  return (
    <span className="ws-dh-dots" title={`发车就绪度 ${draft.readiness.done}/${draft.readiness.total}`}>
      {items.map(item => <i key={item.id} className={`ws-dh-dot ${item.done ? 'is-done' : ''}`} title={item.label} />)}
    </span>
  )
}

const DRAFT_HOME_TABS = [
  ['all', '全部稿件'],
  ['review', '待质检'],
  ['ready', '已就绪'],
  ['archived', '已归档'],
]

function DraftHome({ data }) {
  const [query, setQuery] = React.useState('')
  const [filter, setFilter] = React.useState('all')
  const pending = useStudio(s => s.pending)
  const { stats, filterCounts, nextScheduled, featured, items: matches, hasQuery } = React.useMemo(
    () => summarizeDraftHome(data.articles, { currentId: data.current?.id, filter, query }),
    [data.articles, data.current?.id, filter, query],
  )
  const showArchived = filter === 'archived'
  const open = async (draft, targetView = null) => {
    if (pending) return
    if (draft.id !== data.current?.id && !await act('articles/select', { id: draft.id })) return
    const nextView = targetView ?? (draft.lastView === 'layout' ? 'layout' : 'paper')
    setState({ paperHome: false, view: nextView, editing: null })
  }
  const move = async draft => {
    if (pending) return
    const restore = Boolean(draft.archivedAt)
    if (await act(restore ? 'articles/restore' : 'articles/archive', { id: draft.id })) {
      toast(restore ? '已恢复到全部稿件' : '已归档，可在「已归档」中恢复')
    }
  }
  const duplicate = async draft => {
    if (pending) return
    const hasUnsaved = draftsFor(draft.id).size > 0
    if (await act('articles/duplicate', { id: draft.id })) {
      setState({ paperHome: false, view: 'paper', editing: null })
      toast(hasUnsaved ? '已创建副本（原稿有未保存的段落修改，未包含在副本中）' : '已创建副本')
    }
  }
  const edited = draft => {
    const date = new Date(draft.updatedAt)
    return Number.isNaN(date.getTime()) ? '' : draftDate.format(date)
  }
  const emptyText = hasQuery
    ? '没有找到匹配的稿件。'
    : filter === 'archived'
      ? '还没有归档稿件。'
      : filter === 'review'
        ? '目前没有待质检处理的稿件。'
        : filter === 'ready'
          ? '还没有 5 项全就绪的待发稿件。'
          : '还没有在写的稿件。可以新建文章，或从「已归档」恢复旧稿。'
  return (
    <main className="ws-draft-home">
      <div className="ws-dh-shell">
        <header className="ws-dh-masthead">
          <div className="ws-dh-masthead-left">
            <span className="ws-dh-kicker">EDITORIAL DESK · 公众号成稿台</span>
            <div className="ws-dh-title-row">
              <h1>稿面</h1>
              <p className="ws-dh-dateline">
                <b>VOL.{String(stats.activeCount).padStart(2, '0')}</b>
                <span aria-hidden="true">/</span>
                <span>{formatMastheadDateline()}</span>
              </p>
            </div>
          </div>
          <div className="ws-draft-home-tools">
            <label className="ws-dh-search">
              <Icon name="search" size={14} />
              <input type="search" aria-label="搜索稿件标题" placeholder="搜索稿件标题…" value={query} onChange={e => setQuery(e.target.value)} />
            </label>
            <button type="button" className="ws-btn is-primary" onClick={() => setState({ dialog: 'new' })}><Icon name="plus" />新建文章</button>
          </div>
        </header>

        {filter === 'all' && !hasQuery && featured ? (
          <section className="ws-dh-top" aria-label="头版稿件与创作概览">
            <article className="ws-dh-hero">
              <div className="ws-dh-hero-copy">
                <div className="ws-dh-hero-eyebrow">
                  <span className="ws-dh-issue-tag">ISSUE NO.{featured.issueNo}</span>
                  <span>{featured.id === data.current?.id ? '上次打开' : '最近编辑'} · {featured.lastView === 'layout' ? '停在排版预览' : '停在稿面改稿'}</span>
                  {featured.scheduledFor && !featured.publishedAt ? <span>· 排期 {formatShortDate(featured.scheduledFor)}</span> : null}
                </div>
                <h2>{featured.title}</h2>
                <p className="ws-dh-hero-meta">
                  {[edited(featured), `${featured.chars.toLocaleString()} 字（约 ${readMinutes(featured.chars)} 分钟阅读）`].filter(Boolean).join(' · ')}
                </p>
                {featured.readiness?.items?.length ? (
                  <div className="ws-dh-ready-pills" aria-label={`发车就绪度 ${featured.readiness.done}/${featured.readiness.total}`}>
                    {featured.readiness.items.map(step => (
                      <span key={step.id} className={`ws-dh-ready-pill ${step.done ? 'is-done' : ''}`}>
                        <i aria-hidden="true" />{step.label}
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="ws-dh-hero-actions">
                  <button type="button" className="ws-btn is-primary" disabled={Boolean(pending)} onClick={() => open(featured)}>
                    {featured.lastView === 'layout' ? '继续排版' : '继续改稿'} <span aria-hidden="true">→</span>
                  </button>
                  <button type="button" className="ws-btn" disabled={Boolean(pending)}
                    onClick={() => open(featured, featured.lastView === 'layout' ? 'paper' : 'layout')}>
                    {featured.lastView === 'layout' ? '回到稿面改稿' : '打开排版预览'}
                  </button>
                </div>
              </div>
              <div className="ws-dh-hero-art">
                <DraftArtwork key={featured.coverId || featured.id} draft={featured} />
              </div>
            </article>

            <aside className="ws-dh-stats" aria-label="创作概览">
              <div className="ws-dh-stats-head">
                <span>创作概览</span>
                <span className={`ws-dh-stats-note ${stats.readyCount > 0 ? 'is-ok' : ''}`}>
                  {stats.readyCount > 0 ? `${stats.readyCount} 篇可发车` : '打磨中'}
                </span>
              </div>
              <div className="ws-dh-kpi-grid">
                <button type="button" className="ws-dh-kpi" onClick={() => setFilter('all')}>
                  <b>{stats.activeCount}</b>
                  <span>在写稿件</span>
                </button>
                <button type="button" className="ws-dh-kpi is-ok" onClick={() => setFilter('ready')}>
                  <b>{stats.readyCount}</b>
                  <span>已就绪可发</span>
                </button>
                <button type="button" className="ws-dh-kpi is-warn" onClick={() => setFilter('review')}>
                  <b>{stats.reviewCount}</b>
                  <span>待处理质检</span>
                </button>
                <button type="button" className="ws-dh-kpi is-accent" onClick={() => setState({ module: 'schedule' })}>
                  <b>{stats.scheduledCount}</b>
                  <span>已排期</span>
                </button>
              </div>
              <div className="ws-dh-upnext">
                <div className="ws-dh-upnext-head">
                  <small className={nextScheduled?.overdue ? 'is-overdue' : ''}>
                    {nextScheduled
                      ? `${nextScheduled.overdue ? '已过点待确认' : '下一班排期'} · ${formatShortDate(nextScheduled.draft.scheduledFor)}`
                      : '下一班排期发车'}
                  </small>
                  {nextScheduled ? (
                    <button type="button" className="ws-dh-upnext-link" disabled={Boolean(pending)} onClick={() => open(nextScheduled.draft)}>
                      打开 →
                    </button>
                  ) : (
                    <button type="button" className="ws-dh-upnext-link" onClick={() => setState({ module: 'schedule' })}>
                      去排期 →
                    </button>
                  )}
                </div>
                {nextScheduled ? (
                  <button type="button" className="ws-dh-upnext-title" title={nextScheduled.draft.title} disabled={Boolean(pending)} onClick={() => open(nextScheduled.draft)}>
                    {nextScheduled.draft.title}
                  </button>
                ) : (
                  <p className="ws-dh-upnext-empty ws-muted">暂无排期稿件</p>
                )}
              </div>
            </aside>
          </section>
        ) : null}

        <section className="ws-draft-shelf" aria-label={DRAFT_HOME_TABS.find(([id]) => id === filter)?.[1] ?? '全部稿件'}>
          <div className="ws-dh-shelf-head">
            <div className="ws-dh-tabs" role="tablist" aria-label="稿件分类">
              {DRAFT_HOME_TABS.map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={filter === id} className={`ws-dh-tab ${filter === id ? 'is-on' : ''}`}
                  onClick={() => setFilter(id)}>
                  {label}<span>{filterCounts[id]}</span>
                </button>
              ))}
            </div>
            <span className="ws-muted ws-small">
              {hasQuery ? `找到 ${matches.length} 篇` : showArchived ? '按归档时间排序' : '按最近编辑排序 · 悬浮卡片可复制或归档'}
            </span>
          </div>
          {matches.length ? (
            <div className="ws-draft-grid">
              {matches.map(draft => (
                <article className="ws-draft-card" key={draft.id}>
                  <div className="ws-draft-card-actions">
                    <button type="button" className="ws-dh-action-chip" disabled={Boolean(pending)} onClick={() => duplicate(draft)}
                      aria-label={`创建副本：${draft.title}`}>创建副本</button>
                    <button type="button" className="ws-dh-action-chip" disabled={Boolean(pending)} onClick={() => move(draft)}
                      aria-label={`${showArchived ? '恢复' : '归档'}：${draft.title}`}>{showArchived ? '恢复稿件' : '归档'}</button>
                  </div>
                  <div className="ws-draft-card-main">
                    <DraftArtwork key={draft.coverId || draft.id} draft={draft} />
                    <div className="ws-draft-card-copy">
                      {showArchived ? <strong className="ws-draft-card-title">{draft.title}</strong> : (
                        <button type="button" className="ws-draft-open" disabled={Boolean(pending)} onClick={() => open(draft)}>{draft.title}</button>
                      )}
                      <div className="ws-draft-card-foot">
                        <span className="ws-muted ws-small">{[formatShortDate(draft.updatedAt), `${draft.chars} 字`].filter(Boolean).join(' · ')}</span>
                        <DraftStatusBadge draft={draft} />
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : <p className="ws-draft-home-empty ws-muted">{emptyText}</p>}
        </section>
      </div>
    </main>
  )
}

export function Studio({ onOpenPlugin }) {
  const data = useStudio(s => s.data)
  const error = useStudio(s => s.error)
  const module = useStudio(s => s.module)
  const paperHome = useStudio(s => s.paperHome)
  const dialog = useStudio(s => s.dialog)
  const customCoverWizard = useStudio(s => s.customCoverWizard)
  const revisionBlockId = useStudio(s => s.revisionBlockId)
  const reimportArticleId = useStudio(s => s.reimportArticleId)
  const paperSession = useStudio(s => s.paperSession)
  const note = useStudio(s => s.toast)
  const item = MODULES.find(m => m.id === module) ?? MODULES[1]
  React.useEffect(() => { loadVersion() }, [])
  React.useEffect(() => {
    if (dialog === 'reimport' && data?.current?.id !== reimportArticleId) {
      setState({ dialog: null, reimportArticleId: null })
    }
  }, [dialog, data?.current?.id, reimportArticleId])
  let content
  if (!data) content = <div className="ws-center">{error ? <p className="ws-muted">加载失败：{error}</p> : <span className="ws-shimmer">正在打开稿面…</span>}</div>
  else if (item.id === 'paper') content = paperHome ? <DraftHome data={data} /> : <PaperModule key={`${data.current?.id ?? 'empty'}:${paperSession ?? 0}`} data={data} />
  else if (item.id === 'insights') content = <InsightsView />
  else if (item.id === 'schedule') content = <ScheduleView data={data} />
  else if (item.id === 'skills') content = <SkillsView />
  else content = <SoonView item={item} />
  return (
    <>
      <Rail module={item.id} />
      <div className="ws-col">{content}</div>
      {dialog === 'revisions' && data?.current ? <RevisionDialog key={data.current.id} article={data.current} /> : null}
      {dialog === 'block-revision' && data?.current ? <RevisionDialog key={revisionBlockId} article={data.current} blockId={revisionBlockId} /> : null}
      {dialog === 'cover-history' && data?.current ? <CoverHistoryDialog key={data.current.id} article={data.current} /> : null}
      {dialog === 'cover' && data?.current ? <CoverStyleDialog key={data.current.id} article={data.current} /> : null}
      {dialog?.type === 'inline-diagram' && data?.current ? <InlineDiagramDialog key={`${data.current.id}:${dialog.mode}:${dialog.diagramId ?? 'blocks'}`} article={data.current} cloudinaryReady={data.cloudinaryReady} /> : null}
      {dialog === 'reimport' && data?.current?.id === reimportArticleId ? <ReimportDialog key={reimportArticleId} article={data.current} /> : null}
      {dialog === 'new' ? <NewDialog /> : null}
      {dialog === 'style-wizard' ? <WritingStyleWizard /> : null}
      {customCoverWizard?.open ? <CustomCoverStyleWizard /> : null}
      {dialog === 'settings' ? <SettingsDialog onOpenPlugin={onOpenPlugin} /> : null}
      {dialog === 'model' ? <ModelDialog /> : null}
      {note ? <div className={`ws-toast ${note.error ? 'is-error' : ''}`} role="status">{note.text}</div> : null}
    </>
  )
}

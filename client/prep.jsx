// 备稿模块（纸条 × 选题袋）：0.5 秒捕获、正在攒料剪报袋、自由纸条流、剪报袋抽屉与全站速记浮窗。
import React from 'react'
import { formatSellingPoints, MAX_SELLING_POINTS } from '../src/prep-brief-text.js'
import { parseDay } from '../src/schedule-time.js'
import { AnimatedNumber, SlidingTabs, useDialogClose, usePresence } from './motion.jsx'
import { formatDueCountdown, isEditableTarget, summarizePrep } from './prep-model.js'
import { act, copyText, getState, importPrepBriefFile, loadPrep, openPrepBag, prepAct, refresh, setQuickCaptureOpen, setState, toast, uploadPrepAsset, useStudio } from './state.js'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_MD_BYTES = 2 * 1024 * 1024
const MAX_BRIEF_LIST_ITEMS = 20
const MAX_BRIEF_LIST_ITEM_LEN = 120
const MAX_RAW_BRIEF_CHARS = 20000
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

const NOTE_FILTER_TABS = [
  ['all', '全部'],
  ['link', '链接'],
  ['image', '截图'],
]

const shortDateFmt = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
})

const PREP_ICONS = {
  plus: 'M8 3v10M3 8h10',
  close: 'M4 4l8 8M12 4l-8 8',
  search: 'M7 2.5a4.5 4.5 0 100 9 4.5 4.5 0 000-9zM10.4 10.4L13.5 13.5',
  spark: 'M7 2l1.3 3.7L12 7l-3.7 1.3L7 12l-1.3-3.7L2 7l3.7-1.3zM12.5 10.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z',
  image: 'M2.5 3.5h11v9h-11zM5.2 6.8a1 1 0 100-2 1 1 0 000 2zM3.5 11.5l3.2-3.2 2.2 2.2 1.8-1.8 2.3 2.8',
  link: 'M6.8 9.2l2.4-2.4M5.4 10.6a2.5 2.5 0 010-3.5l1.4-1.4a2.5 2.5 0 013.5 0M10.6 5.4a2.5 2.5 0 010 3.5l-1.4 1.4a2.5 2.5 0 01-3.5 0',
  pin: 'M8 2.5l1.6 3.3 3.6.5-2.6 2.5.6 3.6L8 10.7l-3.2 1.7.6-3.6-2.6-2.5 3.6-.5z',
  trash: 'M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5',
  copy: 'M5.5 5.5h7v7h-7zM3.5 10.5v-7h7',
  upload: 'M8 11V3M4.5 6.5L8 3l3.5 3.5M3 13h10',
  archive: 'M2.5 3.5h11v2.5h-11zM3.5 6v6.5h9V6M6.5 8.5h3',
  folder: 'M2.5 4h4l1.2 1.5h5.8v7h-11z',
  check: 'M3 8.5l3.2 3.2L13 5',
  down: 'M4 6l4 4 4-4',
  arrow: 'M3.5 8h9M8.5 4l4 4-4 4',
  send: 'M8 13V3M3.5 7.5L8 3l4.5 4.5',
  edit: 'M10.8 2.8l2.4 2.4-7.4 7.4-2.8.4.4-2.8z',
  out: 'M9 3h4v4M13 3L7.5 8.5M12 9.5V13H3V4h3.5',
}

function PrepIcon({ name, size = 15, filled = false }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PREP_ICONS[name]} />
    </svg>
  )
}

function isMacPlatform() {
  if (typeof navigator === 'undefined') return false
  const raw = navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || ''
  return /mac|iphone|ipad|ipod|darwin/i.test(String(raw))
}

function quickShortcutLabel() {
  return isMacPlatform() ? '⌘J' : 'Alt+Shift+J'
}

function prepAssetUrl(image) {
  if (!image?.assetId || !image?.ext) return ''
  return `wechat-studio/prep/assets?${new URLSearchParams({ id: image.assetId, ext: image.ext })}`
}

const PROMOTION_STORAGE_KEY = 'wechat-studio.pending-promotion'
let promotionInFlight = false

function readPendingPromotion() {
  try {
    const payload = JSON.parse(sessionStorage.getItem(PROMOTION_STORAGE_KEY))
    return typeof payload?.operationId === 'string' ? payload : null
  } catch {
    return null
  }
}

let pendingPromotion = readPendingPromotion()

function savePendingPromotion(payload) {
  pendingPromotion = payload
  try {
    if (payload) sessionStorage.setItem(PROMOTION_STORAGE_KEY, JSON.stringify(payload))
    else sessionStorage.removeItem(PROMOTION_STORAGE_KEY)
  } catch {
    // 操作仍可在当前页面重试。
  }
  setState({ pendingPromotion: payload })
}

async function submitPromotion(payload = null) {
  if (promotionInFlight) return null
  if (pendingPromotion) {
    const { operationId, ...previous } = pendingPromotion
    if (payload && JSON.stringify(previous) !== JSON.stringify(payload)) {
      toast('请先重试或关闭备稿首页上一次未确认的建稿操作。', true)
      return null
    }
  } else {
    if (!payload) return null
    const operationId = globalThis.crypto?.randomUUID?.() ?? `op_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    savePendingPromotion({ ...payload, operationId })
  }
  promotionInFlight = true
  setState({ promotionInFlight: true })
  try {
    const result = await prepAct('prep/bags/promote', pendingPromotion)
    if (!result?.articleId || !await openArticleInPaper(result.articleId)) return null
    savePendingPromotion(null)
    return result
  } finally {
    promotionInFlight = false
    setState({ promotionInFlight: false })
  }
}

function formatRelativeTime(iso) {
  if (!iso) return ''
  const ts = Date.parse(iso)
  if (!Number.isFinite(ts)) return ''
  const diffSec = Math.floor((Date.now() - ts) / 1000)
  if (diffSec < 60) return '刚刚'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin} 分钟前`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour} 小时前`
  const diffDay = Math.floor(diffHour / 24)
  if (diffDay === 1) return '昨天'
  if (diffDay < 7) return `${diffDay} 天前`
  const d = new Date(ts)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  if (d.getFullYear() === new Date().getFullYear()) return `${mm}-${dd}`
  return `${d.getFullYear()}-${mm}-${dd}`
}

function formatDueBadge(targetDate, isSponsored) {
  if (!targetDate) return null
  const countdown = formatDueCountdown(targetDate)
  if (!countdown.label) return null
  let weekday = ''
  let md = ''
  try {
    const day = parseDay(targetDate)
    weekday = WEEKDAYS[day.getDay()] ?? ''
    md = `${String(day.getMonth() + 1).padStart(2, '0')}/${String(day.getDate()).padStart(2, '0')}`
  } catch {
    // fallback to raw countdown
  }
  if (countdown.overdue) {
    return { text: md ? `${md} · ${countdown.label}` : countdown.label, urgent: true, overdue: true }
  }
  if (countdown.label === '今天到期') {
    return { text: isSponsored ? '今天交稿' : '今天到期', urgent: true, overdue: false }
  }
  const prefix = isSponsored
    ? (weekday ? `${weekday}交稿` : md)
    : (md || weekday)
  return {
    text: prefix ? `${prefix} · ${countdown.label}` : countdown.label,
    urgent: countdown.urgent,
    overdue: false,
  }
}

function formatArticleSchedule(article) {
  if (!article) return ''
  if (article.publishedAt) {
    const d = new Date(article.publishedAt)
    return Number.isNaN(d.getTime()) ? '已发表' : `已发表 · ${shortDateFmt.format(d)}`
  }
  if (article.scheduledFor) {
    const d = new Date(article.scheduledFor)
    return Number.isNaN(d.getTime()) ? '已排期' : `已排期 · ${shortDateFmt.format(d)}`
  }
  return '未排期'
}

function extractImageFromTransfer(dataTransfer) {
  if (!dataTransfer) return null
  const item = [...(dataTransfer.items ?? [])].find(i => i.kind === 'file' && i.type.startsWith('image/'))
  const file = item?.getAsFile() ?? [...(dataTransfer.files ?? [])].find(f => f.type.startsWith('image/'))
  return file ?? null
}

function validateImageFile(file) {
  if (!file) return '未选择图片。'
  if (file.size > MAX_IMAGE_BYTES) return '本地图片不能超过 10 MB。'
  return ''
}

function parseListTokens(raw) {
  return String(raw ?? '')
    .split(/[\r\n,，]+/)
    .map(s => s.trim())
    .filter(Boolean)
}

function deriveNoteTitle(notes) {
  const first = notes?.[0]
  if (!first) return ''
  const raw = (first.text || first.image?.name || '').replace(/\s+/g, ' ').trim()
  return raw.slice(0, 24)
}

async function openArticleInPaper(articleId, { restore = false } = {}) {
  if (!articleId) return false
  if (restore) {
    const restored = await act('articles/restore', { id: articleId })
    if (!restored) return false
  }
  if (getState().data?.current?.id !== articleId) {
    const selected = await act('articles/select', { id: articleId })
    if (!selected) return false
  }
  setState({ module: 'paper', paperHome: false, view: 'paper', editing: null, activeBagId: null })
  return true
}

function useFilePreview(file) {
  const [url, setUrl] = React.useState('')
  React.useEffect(() => {
    if (!file) { setUrl(''); return undefined }
    const next = URL.createObjectURL(file)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [file])
  return url
}

function ImageLightbox({ src, alt, onClose }) {
  const { closing, requestClose } = useDialogClose(onClose)
  React.useEffect(() => {
    const onKey = event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        requestClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [requestClose])
  return (
    <div
      className={`ws-scrim ws-prep-lightbox-scrim${closing ? ' is-closing' : ''}`}
      onClick={e => { if (e.target === e.currentTarget) requestClose() }}
    >
      <div className="ws-dialog ws-prep-lightbox" role="dialog" aria-modal="true" aria-label="图片预览">
        <div className="ws-dialog-head">
          <span className="ws-muted ws-small">{alt || '截图预览'}</span>
          <button type="button" className="ws-icon-btn" aria-label="关闭预览" onClick={requestClose}>
            <PrepIcon name="close" />
          </button>
        </div>
        <div className="ws-prep-lightbox-stage">
          <img src={src} alt={alt || '截图预览'} />
        </div>
      </div>
    </div>
  )
}

function CreateBagDialog({ initialTitle = '', noteIds = null, onCreated, onClose }) {
  const { closing, requestClose } = useDialogClose(onClose)
  const [type, setType] = React.useState('topic')
  const [title, setTitle] = React.useState(initialTitle)
  const [targetDate, setTargetDate] = React.useState('')
  const [partner, setPartner] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const titleRef = React.useRef(null)
  const headingId = React.useId()

  React.useEffect(() => {
    requestAnimationFrame(() => titleRef.current?.focus())
  }, [])

  React.useEffect(() => {
    const onKey = event => {
      if (event.key === 'Escape' && !submitting) {
        event.preventDefault()
        event.stopPropagation()
        requestClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [requestClose, submitting])

  const submit = async event => {
    event.preventDefault()
    if (submitting) return
    const trimmed = title.trim()
    if (!trimmed) {
      toast('请填写选题方向标题', true)
      titleRef.current?.focus()
      return
    }
    setSubmitting(true)
    try {
      const brief = type === 'sponsored' && partner.trim()
        ? { partner: partner.trim(), sellingPoints: '', mustInclude: [], taboo: [], rawText: '' }
        : undefined
      let res
      if (Array.isArray(noteIds) && noteIds.length > 0) {
        res = await prepAct('prep/notes/batch', {
          action: 'create-bag',
          noteIds,
          title: trimmed,
          type,
          targetDate: targetDate || null,
          ...(brief ? { brief } : {}),
          onlyFree: true,
        })
      } else {
        res = await prepAct('prep/bags', {
          title: trimmed,
          type,
          targetDate: targetDate || null,
          ...(brief ? { brief } : {}),
        })
      }
      if (res?.bag) {
        if (res.skippedIds?.length) {
          toast(`已建袋，跳过 ${res.skippedIds.length} 条已移动或不存在的纸条`)
        } else {
          toast(type === 'sponsored' ? '已新建商单袋' : '已新建选题袋')
        }
        onCreated?.(res.bag)
        onClose()
      } else if (res && Array.isArray(noteIds) && !res.bag) {
        toast('选中的纸条已归入其他袋子或不存在', true)
        onClose()
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className={`ws-scrim${closing ? ' is-closing' : ''}`}
      onClick={e => { if (e.target === e.currentTarget && !submitting) requestClose() }}
    >
      <form className="ws-dialog ws-prep-modal" role="dialog" aria-modal="true" aria-labelledby={headingId} onSubmit={submit}>
        <div className="ws-dialog-head">
          <h2 id={headingId} className="ws-dialog-title">
            {noteIds?.length ? `合成新选题袋（${noteIds.length} 条纸条）` : '新建选题袋'}
          </h2>
          <button type="button" className="ws-icon-btn" aria-label="关闭" disabled={submitting} onClick={requestClose}>
            <PrepIcon name="close" />
          </button>
        </div>

        <div className="ws-prep-type-row">
          <SlidingTabs activeKey={type} className="ws-tabs" role="tablist" aria-label="袋子类型">
            <button type="button" role="tab" aria-selected={type === 'topic'} className={type === 'topic' ? 'is-on' : ''} onClick={() => setType('topic')}>
              普通选题
            </button>
            <button type="button" role="tab" aria-selected={type === 'sponsored'} className={type === 'sponsored' ? 'is-on' : ''} onClick={() => setType('sponsored')}>
              商单
            </button>
          </SlidingTabs>
          <span className="ws-muted ws-small">
            {type === 'sponsored' ? '自带甲方要点卡，成稿后自动对接商单防踩坑体检' : '随时可一键切换为商单'}
          </span>
        </div>

        <label className="ws-field">
          <span>选题方向</span>
          <input
            ref={titleRef}
            value={title}
            maxLength={120}
            required
            placeholder={type === 'sponsored' ? '例如：Cursor 2.0 重构实战：真实提效还是营销话术？' : '写一句方向或暂定标题…'}
            onChange={e => setTitle(e.target.value)}
          />
        </label>

        {type === 'sponsored' ? (
          <label className="ws-field">
            <span>合作方 / 产品名（选填，可在抽屉继续完善要点卡）</span>
            <input
              value={partner}
              maxLength={60}
              placeholder="例如：Cursor / 飞书 / 某产品"
              onChange={e => setPartner(e.target.value)}
            />
          </label>
        ) : null}

        <label className="ws-field">
          <span>
            目标交稿 / 发稿日（选填）
            {targetDate ? <em className="ws-prep-sched-dot">● 将在排期占位</em> : null}
          </span>
          <div className="ws-prep-date-inline">
            <input type="date" value={targetDate} min="2000-01-01" max="2100-12-31" onChange={e => setTargetDate(e.target.value)} />
            {targetDate ? (
              <button type="button" className="ws-link" onClick={() => setTargetDate('')}>清除日期</button>
            ) : null}
          </div>
        </label>

        <div className="ws-dialog-foot">
          <button type="button" className="ws-btn" disabled={submitting} onClick={requestClose}>取消</button>
          <button type="submit" className="ws-btn is-primary" disabled={submitting || !title.trim()}>
            {submitting ? '正在创建…' : '创建并打开'}
          </button>
        </div>
      </form>
    </div>
  )
}

function ExtractBriefDialog({ bag, onApplied, onClose }) {
  const { closing, requestClose } = useDialogClose(onClose)
  const [rawText, setRawText] = React.useState(bag.brief?.rawText ?? '')
  const [importing, setImporting] = React.useState(false)
  const [importFeedback, setImportFeedback] = React.useState(null)
  const fileRef = React.useRef(null)
  const [extracting, setExtracting] = React.useState(false)
  const [applying, setApplying] = React.useState(false)
  const [preview, setPreview] = React.useState(null)
  const [applyDate, setApplyDate] = React.useState(true)
  const headingId = React.useId()
  const textareaRef = React.useRef(null)

  React.useEffect(() => {
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [])

  React.useEffect(() => {
    const onKey = event => {
      if (event.key === 'Escape' && !importing && !extracting && !applying) {
        event.preventDefault()
        event.stopPropagation()
        requestClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [requestClose, importing, extracting, applying])

  const importFile = async event => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file || importing) return
    setImportFeedback(null)
    if (!/\.(pdf|docx)$/i.test(file.name) || file.size > 10 * 1024 * 1024) {
      setImportFeedback({ error: '请选择不超过 10 MB 的 PDF 或 Word（.docx）文件。' })
      return
    }
    setImporting(true)
    try {
      const { text, warning } = await importPrepBriefFile(file)
      const combined = [rawText.trimEnd(), text].filter(Boolean).join('\n\n')
      if (combined.length > MAX_RAW_BRIEF_CHARS) {
        setImportFeedback({ error: '原文与导入内容合计超过 20,000 字。请缩短原文后再导入。' })
        return
      }
      setRawText(combined)
      setImportFeedback({ message: warning || `已导入 ${file.name}，核对原文后可开始提炼。` })
    } catch (err) {
      setImportFeedback({ error: err.message })
    } finally {
      setImporting(false)
    }
  }

  const runExtract = async event => {
    event?.preventDefault()
    if (importing || extracting) return
    const trimmed = rawText.trim()
    if (!trimmed) {
      toast('请先粘贴甲方聊天记录或 Brief 原文', true)
      return
    }
    setExtracting(true)
    try {
      const result = await prepAct('prep/ai/extract-brief', { rawText: trimmed.slice(0, MAX_RAW_BRIEF_CHARS) }, { refreshState: false })
      if (result) {
        setPreview(result)
        setApplyDate(Boolean(result.targetDate && !bag.articleId))
      }
    } finally {
      setExtracting(false)
    }
  }

  const confirmApply = async () => {
    if (!preview || applying) return
    setApplying(true)
    try {
      const patch = {
        id: bag.id,
        brief: {
          partner: preview.partner ?? '',
          sellingPoints: preview.sellingPoints ?? '',
          mustInclude: Array.isArray(preview.mustInclude) ? preview.mustInclude : [],
          taboo: Array.isArray(preview.taboo) ? preview.taboo : [],
          rawText: rawText.trim().slice(0, MAX_RAW_BRIEF_CHARS),
        },
      }
      if (applyDate && preview.targetDate && !bag.articleId) {
        patch.targetDate = preview.targetDate
      }
      const res = await prepAct('prep/bags/update', patch)
      if (res?.bag) {
        toast('已回填甲方要点卡')
        onApplied?.(res.bag)
        onClose()
      }
    } finally {
      setApplying(false)
    }
  }

  return (
    <div
      className={`ws-scrim${closing ? ' is-closing' : ''}`}
      onClick={e => { if (e.target === e.currentTarget && !importing && !extracting && !applying) requestClose() }}
    >
      <div className="ws-dialog ws-prep-modal ws-prep-extract-modal" role="dialog" aria-modal="true" aria-labelledby={headingId}>
        <div className="ws-dialog-head">
          <div>
            <h2 id={headingId} className="ws-dialog-title">✦ 贴甲方原文提炼</h2>
            <p className="ws-muted ws-small">粘贴原文或导入文件。预览提炼结果后，确认回填要点卡。</p>
          </div>
          <button type="button" className="ws-icon-btn" aria-label="关闭" disabled={importing || extracting || applying} onClick={requestClose}>
            <PrepIcon name="close" />
          </button>
        </div>

        {!preview ? (
          <form className="ws-prep-extract-form" onSubmit={runExtract}>
            <label className="ws-field">
              <span>甲方原文（最多 {MAX_RAW_BRIEF_CHARS.toLocaleString()} 字）</span>
              <textarea
                ref={textareaRef}
                rows={9}
                maxLength={MAX_RAW_BRIEF_CHARS}
                value={rawText}
                disabled={importing || extracting}
                placeholder="直接粘贴甲方发来的合作说明、群聊要点、必带链接与禁用词…"
                onChange={e => setRawText(e.target.value)}
              />
            </label>
            <div>
              <input ref={fileRef} type="file" accept=".pdf,.docx" hidden onChange={importFile} />
              <button type="button" className="ws-btn" disabled={importing || extracting} onClick={() => fileRef.current?.click()}>
                {importing ? '正在读取文件…' : '上传 PDF / Word'}
              </button>
              {importFeedback?.error ? <p className="ws-banner is-error" role="alert">{importFeedback.error}</p> : null}
              {importFeedback?.message ? <p className="ws-small ws-muted" role="status">{importFeedback.message}</p> : null}
            </div>
            <div className="ws-dialog-foot">
              <button type="button" className="ws-btn" disabled={importing || extracting} onClick={requestClose}>取消</button>
              <button type="submit" className="ws-btn is-primary" disabled={importing || extracting || !rawText.trim()}>
                {extracting ? '正在提炼要点…' : '✦ 开始提炼'}
              </button>
            </div>
          </form>
        ) : (
          <div className="ws-prep-extract-preview">
            <div className="ws-prep-extract-card">
              <div className="ws-prep-extract-row">
                <span>合作方 / 产品</span>
                <strong>{preview.partner || '（未提及）'}</strong>
              </div>
              <div className="ws-prep-extract-row">
                <span>核心卖点</span>
                <p className="ws-prep-selling-points-preview">{preview.sellingPoints || '（未提及）'}</p>
              </div>
              <div className="ws-prep-extract-row">
                <span>必带信息</span>
                {preview.mustInclude?.length ? (
                  <div className="ws-prep-pill-list">
                    {preview.mustInclude.map((item, idx) => <span key={idx} className="ws-prep-brief-pill">{item}</span>)}
                  </div>
                ) : <p className="ws-muted">（未提及）</p>}
              </div>
              <div className="ws-prep-extract-row">
                <span>禁忌红线</span>
                {preview.taboo?.length ? (
                  <div className="ws-prep-pill-list">
                    {preview.taboo.map((item, idx) => <span key={idx} className="ws-prep-brief-pill is-taboo">{item}</span>)}
                  </div>
                ) : <p className="ws-muted">（未提及）</p>}
              </div>
              {preview.targetDate ? (
                <label className="ws-prep-extract-date">
                  <input
                    type="checkbox"
                    checked={applyDate}
                    disabled={Boolean(bag.articleId)}
                    onChange={e => setApplyDate(e.target.checked)}
                  />
                  <span>
                    同步更新目标日期为 <b>{preview.targetDate}</b>
                    {bag.articleId ? '（已成稿袋子请去排期修改文章排期）' : ''}
                  </span>
                </label>
              ) : null}
            </div>
            <div className="ws-dialog-foot">
              <button type="button" className="ws-btn" disabled={applying} onClick={() => setPreview(null)}>返回修改原文</button>
              <button type="button" className="ws-btn" disabled={applying} onClick={requestClose}>取消</button>
              <button type="button" className="ws-btn is-primary" disabled={applying} onClick={confirmApply}>
                {applying ? '正在回填…' : '确认回填要点卡'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ClusterNotesDialog({ notes, onCreated, onClose }) {
  const { closing, requestClose } = useDialogClose(onClose)
  const [loading, setLoading] = React.useState(true)
  const [clusters, setClusters] = React.useState([])
  const [error, setError] = React.useState('')
  const [creating, setCreating] = React.useState(false)
  const headingId = React.useId()

  const noteById = React.useMemo(() => new Map((notes ?? []).map(n => [n.id, n])), [notes])

  React.useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    prepAct('prep/ai/cluster-notes', {}, { refreshState: false, quiet: true })
      .then(res => {
        if (!active) return
        if (!res) {
          setError('聚拢选题角度失败，请检查模型配置后重试。')
          setClusters([])
          return
        }
        const list = Array.isArray(res.clusters) ? res.clusters : []
        setClusters(list.map((c, idx) => ({
          key: idx,
          selected: true,
          title: c.title,
          angle: c.angle,
          noteIds: c.noteIds,
        })))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [])

  React.useEffect(() => {
    const onKey = event => {
      if (event.key === 'Escape' && !creating) {
        event.preventDefault()
        event.stopPropagation()
        requestClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [requestClose, creating])

  const selectedClusters = clusters.filter(c => c.selected && c.title.trim())

  const confirmCreate = async () => {
    if (!selectedClusters.length || creating) return
    setCreating(true)
    let createdCount = 0
    let skippedCount = 0
    let lastBagId = null
    try {
      for (const item of selectedClusters) {
        const res = await prepAct('prep/notes/batch', {
          action: 'create-bag',
          noteIds: item.noteIds,
          title: item.title.trim(),
          type: 'topic',
          onlyFree: true,
        })
        if (res?.bag) {
          createdCount += 1
          lastBagId = res.bag.id
        }
        if (res?.skippedIds?.length) {
          skippedCount += res.skippedIds.length
        }
      }
      if (createdCount > 0) {
        toast(skippedCount > 0
          ? `已生成 ${createdCount} 个选题袋（跳过 ${skippedCount} 条已移动或已删除的纸条）`
          : `已生成 ${createdCount} 个选题袋`)
        onCreated?.(lastBagId)
        onClose()
      } else {
        toast('选中的纸条已均归入其他袋子或不存在，未生成新袋', true)
        onClose()
      }
    } finally {
      setCreating(false)
    }
  }

  return (
    <div
      className={`ws-scrim${closing ? ' is-closing' : ''}`}
      onClick={e => { if (e.target === e.currentTarget && !creating) requestClose() }}
    >
      <div className="ws-dialog ws-prep-modal ws-prep-cluster-modal" role="dialog" aria-modal="true" aria-labelledby={headingId}>
        <div className="ws-dialog-head">
          <div>
            <h2 id={headingId} className="ws-dialog-title">✦ 理出可写角度</h2>
            <p className="ws-muted ws-small">仅给出聚类建议，勾选确认后才会把对应自由纸条收进新选题袋。</p>
          </div>
          <button type="button" className="ws-icon-btn" aria-label="关闭" disabled={creating} onClick={requestClose}>
            <PrepIcon name="close" />
          </button>
        </div>

        {loading ? (
          <div className="ws-prep-cluster-state">
            <span className="ws-shimmer">正在翻看你的自由纸条，寻找可写角度…</span>
          </div>
        ) : error ? (
          <div className="ws-prep-cluster-state">
            <p className="ws-warn">{error}</p>
          </div>
        ) : clusters.length === 0 ? (
          <div className="ws-prep-cluster-state">
            <p className="ws-muted">暂未聚拢出明显相关的选题组合，可以再攒几条纸条试试。</p>
          </div>
        ) : (
          <div className="ws-prep-cluster-list">
            {clusters.map((cluster, idx) => (
              <div key={cluster.key} className={`ws-prep-cluster-card${cluster.selected ? ' is-selected' : ''}`}>
                <div className="ws-prep-cluster-head">
                  <input
                    type="checkbox"
                    aria-label={`选择建议 ${idx + 1}`}
                    checked={cluster.selected}
                    disabled={creating}
                    onChange={e => setClusters(prev => prev.map(item =>
                      item.key === cluster.key ? { ...item, selected: e.target.checked } : item))}
                  />
                  <input
                    className="ws-prep-cluster-title"
                    value={cluster.title}
                    maxLength={120}
                    disabled={creating}
                    aria-label="建议选题标题"
                    onChange={e => setClusters(prev => prev.map(item =>
                      item.key === cluster.key ? { ...item, title: e.target.value } : item))}
                  />
                  <span className="ws-prep-cluster-count">{cluster.noteIds.length} 条纸条</span>
                </div>
                {cluster.angle ? <p className="ws-prep-cluster-angle">{cluster.angle}</p> : null}
                <ul className="ws-prep-cluster-notes">
                  {cluster.noteIds.map(id => {
                    const n = noteById.get(id)
                    if (!n) return null
                    const label = n.kind === 'image' ? `[截图] ${n.text || n.image?.name || '图片'}` : n.text
                    return <li key={id}>{label}</li>
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}

        <div className="ws-dialog-foot">
          <button type="button" className="ws-btn" disabled={creating} onClick={requestClose}>关闭</button>
          {clusters.length > 0 ? (
            <button
              type="button"
              className="ws-btn is-primary"
              disabled={creating || selectedClusters.length === 0}
              onClick={confirmCreate}
            >
              {creating ? '正在建袋…' : `确认生成选题袋（${selectedClusters.length} 个）`}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function BriefTokenField({ label, placeholder, items, onChange, tone = 'normal', disabled = false }) {
  const [draft, setDraft] = React.useState('')

  const commitTokens = raw => {
    const tokens = parseListTokens(raw)
    if (!tokens.length) return
    const next = [...items]
    for (const token of tokens) {
      if (next.length >= MAX_BRIEF_LIST_ITEMS) {
        toast(`${label}最多只能填写 ${MAX_BRIEF_LIST_ITEMS} 条`, true)
        break
      }
      const trimmed = token.slice(0, MAX_BRIEF_LIST_ITEM_LEN)
      if (!next.includes(trimmed)) next.push(trimmed)
    }
    setDraft('')
    onChange(next)
  }

  const removeAt = index => {
    onChange(items.filter((_, i) => i !== index))
  }

  return (
    <div className="ws-prep-token-field">
      <span className="ws-prep-token-label">
        {label}
        <small className="ws-muted">{items.length}/{MAX_BRIEF_LIST_ITEMS}</small>
      </span>
      <div className={`ws-prep-token-box${tone === 'taboo' ? ' is-taboo' : ''}`}>
        {items.map((item, idx) => (
          <span key={`${item}-${idx}`} className={`ws-prep-brief-pill${tone === 'taboo' ? ' is-taboo' : ''}`}>
            <span>{item}</span>
            <button
              type="button"
              aria-label={`移除${item}`}
              disabled={disabled}
              onClick={() => removeAt(idx)}
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={draft}
          disabled={disabled || items.length >= MAX_BRIEF_LIST_ITEMS}
          maxLength={MAX_BRIEF_LIST_ITEM_LEN}
          placeholder={items.length >= MAX_BRIEF_LIST_ITEMS ? '已达条数上限' : placeholder}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return
            if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
              e.preventDefault()
              commitTokens(draft)
            } else if (e.key === 'Backspace' && !draft && items.length > 0) {
              removeAt(items.length - 1)
            }
          }}
          onBlur={() => { if (draft.trim()) commitTokens(draft) }}
          onPaste={e => {
            const pasted = e.clipboardData?.getData('text') || ''
            if (/[\r\n,，]/.test(pasted)) {
              e.preventDefault()
              commitTokens(draft ? `${draft}\n${pasted}` : pasted)
            }
          }}
        />
      </div>
    </div>
  )
}

function BagDrawerContent({ bag, hasModel, extractOpen, onOpenExtract, onClose, onPreviewImage }) {
  const pending = useStudio(s => s.pending)
  const [title, setTitle] = React.useState(bag.title)
  const [briefOpen, setBriefOpen] = React.useState(true)
  const [partner, setPartner] = React.useState(bag.brief?.partner ?? '')
  const savedSellingPoints = bag.brief?.sellingPoints ?? ''
  const displaySellingPoints = formatSellingPoints(savedSellingPoints)
  const [sellingPoints, setSellingPoints] = React.useState(displaySellingPoints)
  const sellingPointsToSave = value => value === displaySellingPoints ? savedSellingPoints : value
  const [mustInclude, setMustInclude] = React.useState(bag.brief?.mustInclude ?? [])
  const [taboo, setTaboo] = React.useState(bag.brief?.taboo ?? [])

  const [noteText, setNoteText] = React.useState('')
  const [pendingFile, setPendingFile] = React.useState(null)
  const [noteDragOver, setNoteDragOver] = React.useState(false)
  const [addingNote, setAddingNote] = React.useState(false)
  const [editingNoteId, setEditingNoteId] = React.useState(null)
  const [editingNoteText, setEditingNoteText] = React.useState('')

  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const [deleteNotesToo, setDeleteNotesToo] = React.useState(false)
  const [promoting, setPromoting] = React.useState('')
  const [mdDragOver, setMdDragOver] = React.useState(false)

  const fileInputRef = React.useRef(null)
  const mdInputRef = React.useRef(null)
  const previewUrl = useFilePreview(pendingFile)

  // Sync external updates (e.g. from extract-brief or window focus refresh) when values change from server
  const serverBriefKey = JSON.stringify({
    partner: bag.brief?.partner ?? '',
    sellingPoints: bag.brief?.sellingPoints ?? '',
    mustInclude: bag.brief?.mustInclude ?? [],
    taboo: bag.brief?.taboo ?? [],
  })
  React.useEffect(() => {
    setTitle(bag.title)
  }, [bag.title])
  React.useEffect(() => {
    setPartner(bag.brief?.partner ?? '')
    setSellingPoints(displaySellingPoints)
    setMustInclude(bag.brief?.mustInclude ?? [])
    setTaboo(bag.brief?.taboo ?? [])
  }, [serverBriefKey])

  React.useEffect(() => {
    const onKey = event => {
      if (event.key === 'Escape' && !extractOpen) {
        event.preventDefault()
        void flushPendingEdits().finally(onClose)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, extractOpen, title, partner, sellingPoints, mustInclude, taboo])

  const isSponsored = bag.type === 'sponsored'
  const isPromoted = Boolean(bag.articleId)
  const isArchived = Boolean(bag.archivedAt)
  const linkedStatus = bag.linkedArticleStatus
  const dueBadge = !isPromoted ? formatDueBadge(bag.targetDate, isSponsored) : null

  const saveTitle = async () => {
    const trimmed = title.trim()
    if (!trimmed) {
      setTitle(bag.title)
      return
    }
    if (trimmed === bag.title) return
    await prepAct('prep/bags/update', { id: bag.id, title: trimmed })
  }

  const switchType = async nextType => {
    if (nextType === bag.type) return
    const res = await prepAct('prep/bags/update', { id: bag.id, type: nextType })
    if (res?.bag && nextType === 'sponsored') setBriefOpen(true)
  }

  const updateDate = async nextDate => {
    if (isPromoted) return
    const normalized = nextDate || null
    if (normalized === (bag.targetDate || null)) return
    const res = await prepAct('prep/bags/update', { id: bag.id, targetDate: normalized })
    if (res?.bag) {
      toast(normalized ? `已占排期：${normalized}` : '已清除目标日期')
    }
  }

  const saveBriefPatch = async patch => {
    const nextBrief = {
      partner: patch.partner !== undefined ? patch.partner : partner,
      sellingPoints: sellingPointsToSave(patch.sellingPoints ?? sellingPoints),
      mustInclude: patch.mustInclude !== undefined ? patch.mustInclude : mustInclude,
      taboo: patch.taboo !== undefined ? patch.taboo : taboo,
      rawText: bag.brief?.rawText ?? '',
    }
    const prevBrief = {
      partner: bag.brief?.partner ?? '',
      sellingPoints: bag.brief?.sellingPoints ?? '',
      mustInclude: bag.brief?.mustInclude ?? [],
      taboo: bag.brief?.taboo ?? [],
      rawText: bag.brief?.rawText ?? '',
    }
    if (JSON.stringify(nextBrief) === JSON.stringify(prevBrief)) return
    await prepAct('prep/bags/update', { id: bag.id, brief: nextBrief })
  }

  const pickPendingImage = file => {
    const err = validateImageFile(file)
    if (err) { toast(err, true); return }
    setPendingFile(file)
  }

  const submitInBagNote = async () => {
    if (addingNote) return
    const trimmed = noteText.trim()
    if (!trimmed && !pendingFile) return
    setAddingNote(true)
    try {
      let image = null
      if (pendingFile) {
        try {
          const uploaded = await uploadPrepAsset(pendingFile)
          if (!uploaded) return
          image = {
            assetId: uploaded.assetId,
            ext: uploaded.ext,
            mimeType: uploaded.mimeType,
            bytes: uploaded.bytes,
            ...(uploaded.name ? { name: uploaded.name } : {}),
          }
        } catch (err) {
          toast(err?.message || '图片上传失败', true)
          return
        }
      }
      const res = await prepAct('prep/notes', {
        text: trimmed,
        bagId: bag.id,
        ...(image ? { image } : {}),
      })
      if (res?.note) {
        setNoteText('')
        setPendingFile(null)
      }
    } finally {
      setAddingNote(false)
    }
  }

  const saveEditedNote = async noteId => {
    const trimmed = editingNoteText.trim()
    const target = bag.notes.find(n => n.id === noteId)
    if (!target) { setEditingNoteId(null); return }
    if (!trimmed && !target.image) {
      toast('纸条内容不能为空', true)
      return
    }
    if (trimmed !== target.text) {
      await prepAct('prep/notes/update', { id: noteId, text: trimmed })
    }
    setEditingNoteId(null)
  }

  const flushPendingEdits = async () => {
    const patch = {}
    const trimmedTitle = title.trim()
    if (trimmedTitle && trimmedTitle !== bag.title) {
      patch.title = trimmedTitle
    }
    if (isSponsored) {
      const nextBrief = {
        partner,
        sellingPoints: sellingPointsToSave(sellingPoints),
        mustInclude,
        taboo,
        rawText: bag.brief?.rawText ?? '',
      }
      const prevBrief = {
        partner: bag.brief?.partner ?? '',
        sellingPoints: bag.brief?.sellingPoints ?? '',
        mustInclude: bag.brief?.mustInclude ?? [],
        taboo: bag.brief?.taboo ?? [],
        rawText: bag.brief?.rawText ?? '',
      }
      if (JSON.stringify(nextBrief) !== JSON.stringify(prevBrief)) {
        patch.brief = nextBrief
      }
    }
    if (Object.keys(patch).length > 0) {
      const updated = await prepAct('prep/bags/update', { id: bag.id, ...patch })
      return Boolean(updated)
    }
    return true
  }

  const handleCopyBriefMarkdown = async () => {
    if (!await flushPendingEdits()) return
    const res = await prepAct('prep/bags/brief-markdown', { id: bag.id }, { refreshState: false })
    if (res?.markdown) {
      await copyText(res.markdown, '已复制结构化备料单 Markdown')
    }
  }

  const handlePromote = async (mode, markdown = '') => {
    if (promoting) return
    setPromoting(mode)
    try {
      if (!await flushPendingEdits()) return
      const res = await submitPromotion({
        bagId: bag.id,
        mode,
        ...(mode === 'import' ? { markdown } : {}),
      })
      if (res?.articleId) {
        if (!res.warnings?.length) {
          if (mode === 'ai') toast('已放上稿面，正在带料起草初稿')
          else if (mode === 'blank') toast('已开空白稿面并挂接原备料袋')
          else toast('已原地导入 Markdown 并成稿')
        }
      }
    } finally {
      setPromoting('')
    }
  }

  const importMarkdownFiles = async files => {
    if (!files?.length || promoting) return
    if (files.length !== 1 || !/\.(md|markdown)$/i.test(files[0].name)) {
      toast('请选择单个 .md 或 .markdown 文件', true)
      return
    }
    const file = files[0]
    if (file.size >= MAX_MD_BYTES) {
      toast('Markdown 文件过大（需小于 2 MB）', true)
      return
    }
    try {
      const text = await file.text()
      if (!text.trim()) {
        toast('这个 Markdown 文件没有内容', true)
        return
      }
      await handlePromote('import', text)
    } catch {
      toast('读取 Markdown 文件失败，请重试', true)
    }
  }

  const handleDeleteBag = async () => {
    const res = await prepAct('prep/bags/delete', { id: bag.id, keepNotes: !deleteNotesToo })
    if (res?.deletedBagId) {
      toast(deleteNotesToo
        ? '已删除选题袋及袋内想法'
        : res.releasedNoteIds?.length
          ? `已删除选题袋，${res.releasedNoteIds.length} 条想法已退回自由纸条`
          : '已删除选题袋')
      setState({ activeBagId: null })
    }
  }

  const handleToggleArchive = async () => {
    const nextArchived = !isArchived
    const res = await prepAct('prep/bags/update', { id: bag.id, archived: nextArchived })
    if (res?.bag) {
      toast(nextArchived ? '已归档此袋' : '已恢复此袋')
    }
  }

  const handleResetLink = async () => {
    const res = await prepAct('prep/bags/reset-link', { id: bag.id })
    if (res?.bag) {
      toast('已重置关联，可重新升格成稿')
    }
  }

  return (
    <div className="ws-prep-drawer-inner">
      <header className={`ws-prep-drawer-head${isSponsored ? ' is-sponsored' : ''}`}>
        <div className="ws-prep-drawer-topbar">
          <SlidingTabs activeKey={bag.type} className="ws-tabs ws-prep-drawer-type" role="tablist" aria-label="选题袋类型">
            <button type="button" role="tab" aria-selected={!isSponsored} className={!isSponsored ? 'is-on' : ''} onClick={() => switchType('topic')}>
              普通选题
            </button>
            <button type="button" role="tab" aria-selected={isSponsored} className={isSponsored ? 'is-on' : ''} onClick={() => switchType('sponsored')}>
              商单
            </button>
          </SlidingTabs>
          <div className="ws-prep-drawer-top-actions">
            <button type="button" className="ws-btn ws-prep-mini-btn" disabled={Boolean(pending)} onClick={handleToggleArchive}>
              <PrepIcon name="archive" size={13} />{isArchived ? '恢复' : '归档'}
            </button>
            {!isPromoted && !bag.pendingPromotion ? (
              <button
                type="button"
                className="ws-btn ws-prep-mini-btn is-danger"
                disabled={Boolean(pending)}
                onClick={() => setConfirmDelete(v => !v)}
              >
                <PrepIcon name="trash" size={13} />删除
              </button>
            ) : null}
            <button type="button" className="ws-icon-btn" aria-label="关闭抽屉" onClick={onClose}>
              <PrepIcon name="close" />
            </button>
          </div>
        </div>

        {confirmDelete && !isPromoted ? (
          <div className="ws-prep-delete-confirm">
            <p>确认删除「{bag.title}」？{bag.notes.length > 0 ? '袋内想法默认退回自由纸条。' : ''}</p>
            {bag.notes.length > 0 ? (
              <label className="ws-prep-delete-check">
                <input type="checkbox" checked={deleteNotesToo} onChange={e => setDeleteNotesToo(e.target.checked)} />
                <span>同时物理删除袋内 {bag.notes.length} 条想法</span>
              </label>
            ) : null}
            <div className="ws-prep-delete-actions">
              <button type="button" className="ws-btn ws-prep-mini-btn" onClick={() => { setConfirmDelete(false); setDeleteNotesToo(false) }}>取消</button>
              <button type="button" className="ws-btn ws-prep-mini-btn is-danger-solid" disabled={Boolean(pending)} onClick={handleDeleteBag}>确认删除</button>
            </div>
          </div>
        ) : null}

        <input
          className="ws-prep-drawer-title"
          aria-label="选题方向标题"
          value={title}
          maxLength={120}
          placeholder="输入选题方向…"
          onChange={e => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={e => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return
            if (e.key === 'Enter') {
              e.preventDefault()
              e.currentTarget.blur()
            }
          }}
        />

        <div className="ws-prep-drawer-date-row">
          {!isPromoted ? (
            <>
              <label className="ws-prep-date-picker">
                <span>目标日</span>
                <input
                  type="date"
                  value={bag.targetDate ?? ''}
                  min="2000-01-01"
                  max="2100-12-31"
                  onChange={e => void updateDate(e.target.value)}
                />
              </label>
              {bag.targetDate ? (
                <>
                  <span className="ws-prep-sched-badge">● 已占排期</span>
                  {dueBadge ? (
                    <span className={`ws-prep-due-chip${dueBadge.overdue ? ' is-overdue' : dueBadge.urgent ? ' is-urgent' : ''}`}>
                      {dueBadge.text}
                    </span>
                  ) : null}
                  <button type="button" className="ws-link ws-prep-clear-date" onClick={() => void updateDate('')}>清除</button>
                </>
              ) : (
                <span className="ws-muted ws-small">选定日期后自动在排期虚线占位</span>
              )}
            </>
          ) : (
            <div className="ws-prep-promoted-schedule">
              {bag.targetDate ? <span className="ws-muted ws-small">原目标日 {bag.targetDate}</span> : null}
              {bag.linkedArticle ? (
                <span className="ws-prep-sched-live">{formatArticleSchedule(bag.linkedArticle)}</span>
              ) : null}
              {linkedStatus === 'active' ? (
                <button type="button" className="ws-link" onClick={() => setState({ module: 'schedule', activeBagId: null })}>
                  去排期 →
                </button>
              ) : null}
            </div>
          )}
        </div>
      </header>

      <div className="ws-prep-drawer-body">
        {isPromoted ? (
          <section className={`ws-prep-linked-banner is-${linkedStatus || 'active'}`} aria-label="关联稿件状态">
            {linkedStatus === 'active' ? (
              <>
                <div className="ws-prep-linked-copy">
                  <span className="ws-prep-linked-tag">已成稿</span>
                  <strong>{bag.linkedArticle?.title || '对应稿面文章'}</strong>
                </div>
                <button
                  type="button"
                  className="ws-btn is-primary ws-prep-mini-btn"
                  disabled={Boolean(pending)}
                  onClick={() => void openArticleInPaper(bag.articleId)}
                >
                  打开稿面 →
                </button>
              </>
            ) : linkedStatus === 'archived' ? (
              <>
                <div className="ws-prep-linked-copy">
                  <span className="ws-prep-linked-tag is-muted">对应稿件已归档</span>
                  <strong>{bag.linkedArticle?.title || '已归档稿件'}</strong>
                  <p className="ws-muted ws-small">恢复后可继续在稿面编辑或排版。</p>
                </div>
                <div className="ws-prep-linked-actions">
                  <button
                    type="button"
                    className="ws-btn is-primary ws-prep-mini-btn"
                    disabled={Boolean(pending)}
                    onClick={() => void openArticleInPaper(bag.articleId, { restore: true })}
                  >
                    恢复并打开稿件
                  </button>
                  <button
                    type="button"
                    className="ws-link"
                    onClick={() => setState({ module: 'paper', paperHome: true, activeBagId: null })}
                  >
                    去稿面查看已归档
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="ws-prep-linked-copy">
                  <span className="ws-prep-linked-tag is-warn">原稿已删除</span>
                  <p className="ws-muted ws-small">原关联稿件已从稿面删除，袋内想法与商单要点仍完整保留。</p>
                </div>
                <div className="ws-prep-linked-actions">
                  <button
                    type="button"
                    className="ws-btn is-primary ws-prep-mini-btn"
                    disabled={Boolean(pending)}
                    onClick={handleResetLink}
                  >
                    重新升格成稿
                  </button>
                  {!isArchived ? (
                    <button
                      type="button"
                      className="ws-btn ws-prep-mini-btn"
                      disabled={Boolean(pending)}
                      onClick={handleToggleArchive}
                    >
                      归档此袋
                    </button>
                  ) : null}
                </div>
              </>
            )}
          </section>
        ) : null}

        {isSponsored ? (
          <section className="ws-prep-brief-card" aria-label="甲方要点卡">
            <div className="ws-prep-brief-head">
              <button
                type="button"
                className="ws-prep-brief-toggle"
                aria-expanded={briefOpen}
                onClick={() => setBriefOpen(v => !v)}
              >
                <span className="ws-prep-stamp">商单</span>
                <strong>甲方要点卡</strong>
                {isPromoted ? <small className="ws-muted">修订后实时同步稿面与体检</small> : null}
                <PrepIcon name="down" size={14} />
              </button>
              <button
                type="button"
                className="ws-btn ws-prep-ai-btn ws-prep-mini-btn"
                disabled={!hasModel}
                title={hasModel ? '粘贴微信聊天记录或 Brief 原文，自动提炼结构化字段' : '未配置可用模型，请先在 DeepSeek Harness 配置模型后再使用 AI 提炼'}
                onClick={onOpenExtract}
              >
                <PrepIcon name="spark" size={13} />贴甲方原文提炼
              </button>
            </div>
            {briefOpen ? (
              <div className="ws-prep-brief-fields">
                <label className="ws-field">
                  <span>合作方 / 产品名</span>
                  <input
                    value={partner}
                    maxLength={60}
                    placeholder="例如：Cursor"
                    onChange={e => setPartner(e.target.value)}
                    onBlur={() => void saveBriefPatch({ partner })}
                  />
                </label>
                <label className="ws-field">
                  <span>核心卖点</span>
                  <textarea
                    className="ws-prep-selling-points"
                    rows={4}
                    value={sellingPoints}
                    maxLength={MAX_SELLING_POINTS}
                    placeholder="记下产品亮点和核心场景，可以分行填写…"
                    onChange={e => setSellingPoints(e.target.value)}
                    onBlur={() => void saveBriefPatch({ sellingPoints })}
                  />
                </label>
                <BriefTokenField
                  label="必带信息"
                  placeholder="输入链接、口令或引导语，回车添加（支持逗号分隔）"
                  items={mustInclude}
                  onChange={next => {
                    setMustInclude(next)
                    void saveBriefPatch({ mustInclude: next })
                  }}
                />
                <BriefTokenField
                  label="禁忌红线"
                  tone="taboo"
                  placeholder="输入禁用词或避雷表述，回车添加（发布体检将自动核对）"
                  items={taboo}
                  onChange={next => {
                    setTaboo(next)
                    void saveBriefPatch({ taboo: next })
                  }}
                />
              </div>
            ) : null}
          </section>
        ) : null}

        <section className="ws-prep-drawer-ideas" aria-label="袋内想法">
          <div className="ws-prep-drawer-ideas-head">
            <h3>备料想法</h3>
            <span className="ws-muted ws-small">
              共 {bag.notes.length} 条 · 已纳入 {bag.includedCount} 条
            </span>
          </div>

          <div
            className={`ws-prep-inbag-input${noteDragOver ? ' is-drag-over' : ''}`}
            onDragOver={e => {
              if (!e.dataTransfer.types.includes('Files')) return
              e.preventDefault()
              setNoteDragOver(true)
            }}
            onDragLeave={e => {
              if (!e.currentTarget.contains(e.relatedTarget)) setNoteDragOver(false)
            }}
            onDrop={e => {
              if (!e.dataTransfer.types.includes('Files')) return
              e.preventDefault()
              setNoteDragOver(false)
              const file = extractImageFromTransfer(e.dataTransfer)
              if (file) pickPendingImage(file)
            }}
          >
            <textarea
              rows={2}
              value={noteText}
              maxLength={4000}
              disabled={addingNote}
              placeholder="向本袋追加想法、链接，或 ⌘V 粘贴/拖入截图…（Enter 追加，Shift+Enter 换行）"
              onChange={e => setNoteText(e.target.value)}
              onPaste={e => {
                const file = extractImageFromTransfer(e.clipboardData)
                if (file) {
                  e.preventDefault()
                  pickPendingImage(file)
                }
              }}
              onKeyDown={e => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void submitInBagNote()
                }
              }}
            />
            {pendingFile && previewUrl ? (
              <div className="ws-prep-pending-img">
                <img src={previewUrl} alt="待附截图" />
                <span>{pendingFile.name || '剪贴板截图'}</span>
                <button type="button" className="ws-icon-btn" aria-label="移除截图" onClick={() => setPendingFile(null)}>
                  <PrepIcon name="close" size={13} />
                </button>
              </div>
            ) : null}
            <div className="ws-prep-inbag-tools">
              <button type="button" className="ws-btn ws-prep-mini-btn" disabled={addingNote} onClick={() => fileInputRef.current?.click()}>
                <PrepIcon name="image" size={13} />附截图
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp,.png,.jpg,.jpeg,.gif,.webp"
                hidden
                onChange={e => {
                  const file = e.target.files?.[0]
                  if (file) pickPendingImage(file)
                  e.target.value = ''
                }}
              />
              <span className="ws-grow" />
              <button
                type="button"
                className="ws-btn is-primary ws-prep-mini-btn"
                disabled={addingNote || (!noteText.trim() && !pendingFile)}
                onClick={() => void submitInBagNote()}
              >
                {addingNote ? '正在写入…' : '追加想法'}
              </button>
            </div>
          </div>

          {bag.notes.length === 0 ? (
            <p className="ws-prep-drawer-empty ws-muted">
              袋子里还没有想法。在上方直接记几条，或者从主界面把自由纸条拖进来。
            </p>
          ) : (
            <ul className="ws-prep-idea-list">
              {bag.notes.map(note => {
                const isEditing = editingNoteId === note.id
                const excluded = note.included === false
                return (
                  <li key={note.id} className={`ws-prep-idea-item${note.pinned ? ' is-pinned' : ''}${excluded ? ' is-excluded' : ''}`}>
                    <label className="ws-prep-idea-check" title={excluded ? '本次写作暂不纳入' : '本次写作纳入此条'}>
                      <input
                        type="checkbox"
                        checked={!excluded}
                        onChange={() => void prepAct('prep/notes/update', { id: note.id, included: excluded })}
                      />
                    </label>
                    <div className="ws-prep-idea-content">
                      {note.kind === 'image' && note.image ? (
                        <button
                          type="button"
                          className="ws-prep-idea-thumb"
                          onClick={() => onPreviewImage?.({ src: prepAssetUrl(note.image), alt: note.text || note.image.name || '截图' })}
                        >
                          <img src={prepAssetUrl(note.image)} alt={note.text || note.image.name || '备稿截图'} loading="lazy" />
                        </button>
                      ) : null}
                      {note.kind === 'link' && note.link ? (
                        <a className="ws-prep-link-pill" href={note.link.url} target="_blank" rel="noopener noreferrer">
                          <PrepIcon name="link" size={12} />{note.link.host}
                        </a>
                      ) : null}
                      {isEditing ? (
                        <div className="ws-prep-inline-edit">
                          <textarea
                            rows={3}
                            maxLength={4000}
                            value={editingNoteText}
                            autoFocus
                            onChange={e => setEditingNoteText(e.target.value)}
                            onKeyDown={e => {
                              if (e.nativeEvent.isComposing || e.keyCode === 229) return
                              if (e.key === 'Escape') { e.stopPropagation(); setEditingNoteId(null) }
                              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                                e.preventDefault()
                                void saveEditedNote(note.id)
                              }
                            }}
                          />
                          <div className="ws-prep-inline-edit-foot">
                            <button type="button" className="ws-btn ws-prep-mini-btn" onClick={() => setEditingNoteId(null)}>取消</button>
                            <button type="button" className="ws-btn is-primary ws-prep-mini-btn" onClick={() => void saveEditedNote(note.id)}>保存</button>
                          </div>
                        </div>
                      ) : note.text ? (
                        <p className="ws-prep-idea-text">{note.text}</p>
                      ) : note.image?.name ? (
                        <p className="ws-prep-idea-text ws-muted">{note.image.name}</p>
                      ) : null}
                      <div className="ws-prep-idea-meta">
                        <span>{formatRelativeTime(note.createdAt)}</span>
                        {note.pinned ? <span className="ws-prep-pin-label">★ 核心切入点</span> : null}
                        {excluded ? <span className="ws-muted">已排除</span> : null}
                      </div>
                    </div>
                    <div className="ws-prep-idea-actions">
                      <button
                        type="button"
                        className={`ws-icon-btn${note.pinned ? ' is-pinned' : ''}`}
                        title={note.pinned ? '取消置顶' : '标为核心切入点'}
                        aria-label={note.pinned ? '取消置顶' : '标为核心切入点'}
                        aria-pressed={Boolean(note.pinned)}
                        onClick={() => void prepAct('prep/notes/update', { id: note.id, pinned: !note.pinned })}
                      >
                        <PrepIcon name="pin" size={14} filled={Boolean(note.pinned)} />
                      </button>
                      <button
                        type="button"
                        className="ws-icon-btn"
                        title="编辑内容"
                        aria-label="编辑内容"
                        onClick={() => { setEditingNoteId(note.id); setEditingNoteText(note.text ?? '') }}
                      >
                        <PrepIcon name="edit" size={14} />
                      </button>
                      <button
                        type="button"
                        className="ws-icon-btn"
                        title="移回自由纸条"
                        aria-label="移回自由纸条"
                        onClick={async () => {
                          const res = await prepAct('prep/notes/update', { id: note.id, bagId: null })
                          if (res?.note) toast('已移回自由纸条')
                        }}
                      >
                        <PrepIcon name="out" size={14} />
                      </button>
                      <button
                        type="button"
                        className="ws-icon-btn"
                        title="删除纸条"
                        aria-label="删除纸条"
                        onClick={() => void prepAct('prep/notes/delete', { ids: [note.id] })}
                      >
                        <PrepIcon name="trash" size={14} />
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>

      <footer
        className={`ws-prep-drawer-foot${mdDragOver ? ' is-drag-over' : ''}`}
        onDragOver={e => {
          if (isPromoted || isArchived || !e.dataTransfer.types.includes('Files')) return
          e.preventDefault()
          setMdDragOver(true)
        }}
        onDragLeave={e => {
          if (!e.currentTarget.contains(e.relatedTarget)) setMdDragOver(false)
        }}
        onDrop={e => {
          if (isPromoted || isArchived || !e.dataTransfer.types.includes('Files')) return
          e.preventDefault()
          setMdDragOver(false)
          void importMarkdownFiles(e.dataTransfer.files)
        }}
      >
        {!isPromoted && !isArchived ? (
          <>
            <div className="ws-prep-foot-primary">
              <button
                type="button"
                className="ws-btn is-primary"
                disabled={!hasModel || Boolean(promoting || pending)}
                title={hasModel ? '把商单要点与已纳入想法整理后交给 AI 起草初稿' : '未配置可用模型，请改用「开空白稿面」或「拖入 .md 原地成稿」'}
                onClick={() => void handlePromote('ai')}
              >
                <PrepIcon name="spark" size={14} />
                {promoting === 'ai' ? '正在放上稿面…' : 'AI 带料放上稿面'}
              </button>
              <button
                type="button"
                className="ws-btn"
                disabled={Boolean(promoting || pending)}
                title="不调用 AI，直接创建空白稿件并在侧栏挂接此备料袋"
                onClick={() => void handlePromote('blank')}
              >
                {promoting === 'blank' ? '正在创建…' : '开空白稿面'}
              </button>
            </div>
            <div className="ws-prep-foot-secondary">
              <button
                type="button"
                className="ws-btn ws-prep-mini-btn"
                disabled={Boolean(promoting || pending)}
                onClick={handleCopyBriefMarkdown}
              >
                <PrepIcon name="copy" size={13} />复制备料单
              </button>
              <button
                type="button"
                className="ws-btn ws-prep-mini-btn ws-prep-md-drop-btn"
                disabled={Boolean(promoting || pending)}
                onClick={() => mdInputRef.current?.click()}
              >
                <PrepIcon name="upload" size={13} />
                {mdDragOver ? '松手原地成稿' : promoting === 'import' ? '正在导入…' : '拖入 .md 原地成稿'}
              </button>
              <input
                ref={mdInputRef}
                type="file"
                accept=".md,.markdown"
                hidden
                onChange={e => {
                  void importMarkdownFiles(e.target.files)
                  e.target.value = ''
                }}
              />
            </div>
          </>
        ) : isPromoted ? (
          <div className="ws-prep-foot-promoted">
            <button type="button" className="ws-btn" disabled={Boolean(pending)} onClick={handleCopyBriefMarkdown}>
              <PrepIcon name="copy" size={13} />复制备料单
            </button>
            {linkedStatus === 'active' ? (
              <button type="button" className="ws-btn is-primary" disabled={Boolean(pending)} onClick={() => void openArticleInPaper(bag.articleId)}>
                打开对应稿面文章 →
              </button>
            ) : linkedStatus === 'archived' ? (
              <button type="button" className="ws-btn is-primary" disabled={Boolean(pending)} onClick={() => void openArticleInPaper(bag.articleId, { restore: true })}>
                恢复并打开稿件
              </button>
            ) : (
              <button type="button" className="ws-btn is-primary" disabled={Boolean(pending)} onClick={handleResetLink}>
                重新升格成稿
              </button>
            )}
          </div>
        ) : (
          <div className="ws-prep-foot-promoted">
            <button type="button" className="ws-btn" disabled={Boolean(pending)} onClick={handleCopyBriefMarkdown}>
              <PrepIcon name="copy" size={13} />复制备料单
            </button>
            <button type="button" className="ws-btn is-primary" disabled={Boolean(pending)} onClick={handleToggleArchive}>
              恢复为活跃选题袋
            </button>
          </div>
        )}
      </footer>
    </div>
  )
}

export function BagDrawer({ bag, hasModel, onClose, onPreviewImage }) {
  const open = Boolean(bag)
  const { mounted, closing } = usePresence(open)
  const [extractOpen, setExtractOpen] = React.useState(false)
  const latestBagRef = React.useRef(bag)
  if (bag) latestBagRef.current = bag
  const shownBag = bag ?? (mounted ? latestBagRef.current : null)
  React.useEffect(() => {
    setExtractOpen(false)
  }, [shownBag?.id, open])
  if (!mounted || !shownBag) return null

  return (
    <>
      <div
        className={`ws-prep-drawer-scrim${closing ? ' is-closing' : ''}`}
        onClick={e => { if (e.target === e.currentTarget && !extractOpen) onClose() }}
      >
        <aside className={`ws-prep-drawer${closing ? ' is-closing' : ''}`} role="dialog" aria-modal="true" aria-label={`选题袋：${shownBag.title}`}>
          <BagDrawerContent
            key={shownBag.id}
            bag={shownBag}
            hasModel={hasModel}
            extractOpen={extractOpen}
            onOpenExtract={() => setExtractOpen(true)}
            onClose={onClose}
            onPreviewImage={onPreviewImage}
          />
        </aside>
      </div>
      {extractOpen ? (
        <ExtractBriefDialog
          bag={shownBag}
          onClose={() => setExtractOpen(false)}
        />
      ) : null}
    </>
  )
}

function FreeNoteCard({
  note,
  settled,
  selected,
  selectionMode,
  activeBags,
  onToggleSelect,
  onDragStartNote,
  onDragEndNote,
  onAssignToBag,
  onCreateBagFromNote,
  onPreviewImage,
}) {
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [editing, setEditing] = React.useState(false)
  const [editText, setEditText] = React.useState(note.text ?? '')
  const menuRef = React.useRef(null)

  React.useEffect(() => {
    if (!menuOpen) return undefined
    const dismiss = event => {
      if (!menuRef.current?.contains(event.target)) setMenuOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [menuOpen])

  const saveEdit = async () => {
    const trimmed = editText.trim()
    if (!trimmed && !note.image) {
      toast('纸条内容不能为空', true)
      return
    }
    if (trimmed !== note.text) {
      await prepAct('prep/notes/update', { id: note.id, text: trimmed })
    }
    setEditing(false)
  }

  return (
    <article
      className={`ws-prep-note-card${settled ? ' is-settled' : ''}${selected ? ' is-selected' : ''}${note.kind === 'image' ? ' is-image' : ''}`}
      draggable={!editing}
      onDragStart={e => {
        if (editing) { e.preventDefault(); return }
        e.dataTransfer.setData('application/x-ws-prep-note', note.id)
        e.dataTransfer.setData('text/plain', note.id)
        e.dataTransfer.effectAllowed = 'move'
        onDragStartNote(note.id)
      }}
      onDragEnd={onDragEndNote}
      onClick={e => {
        if (editing || e.target.closest('button, a, input, textarea, .ws-prep-assign-menu')) return
        if (selectionMode || e.metaKey || e.ctrlKey || e.shiftKey) {
          onToggleSelect(note.id)
        }
      }}
    >
      <div className="ws-prep-note-top">
        <label className="ws-prep-note-select" onClick={e => e.stopPropagation()}>
          <input
            type="checkbox"
            aria-label="选择这条纸条"
            checked={selected}
            onChange={() => onToggleSelect(note.id)}
          />
        </label>
        <span className="ws-prep-note-kind">
          {note.kind === 'image' ? '截图' : note.kind === 'link' ? '链接' : '纸条'}
        </span>
        <div className="ws-prep-note-actions">
          <div className="ws-prep-assign-wrap" ref={menuRef}>
            <button
              type="button"
              className="ws-prep-note-action"
              aria-expanded={menuOpen}
              title="归入选题袋"
              onClick={e => { e.stopPropagation(); setMenuOpen(v => !v) }}
            >
              归入袋子 ▾
            </button>
            {menuOpen ? (
              <div className="ws-prep-assign-menu" role="menu" onClick={e => e.stopPropagation()}>
                {activeBags.length ? activeBags.map(bag => (
                  <button
                    key={bag.id}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false)
                      void onAssignToBag(note.id, bag)
                    }}
                  >
                    {bag.type === 'sponsored' ? <span className="ws-prep-mini-dot" /> : null}
                    <span>{bag.title}</span>
                  </button>
                )) : <p className="ws-muted ws-small ws-prep-assign-empty">还没有活跃选题袋</p>}
                <button
                  type="button"
                  role="menuitem"
                  className="ws-prep-assign-new"
                  onClick={() => {
                    setMenuOpen(false)
                    onCreateBagFromNote(note)
                  }}
                >
                  + 新建选题袋并放入
                </button>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="ws-prep-note-icon"
            title="编辑"
            aria-label="编辑纸条"
            onClick={e => {
              e.stopPropagation()
              setEditText(note.text ?? '')
              setEditing(true)
            }}
          >
            <PrepIcon name="edit" size={13} />
          </button>
          <button
            type="button"
            className="ws-prep-note-icon"
            title="删除"
            aria-label="删除纸条"
            onClick={e => {
              e.stopPropagation()
              void prepAct('prep/notes/delete', { ids: [note.id] })
            }}
          >
            <PrepIcon name="trash" size={13} />
          </button>
        </div>
      </div>

      {note.kind === 'image' && note.image ? (
        <button
          type="button"
          className="ws-prep-note-media"
          onClick={e => {
            e.stopPropagation()
            onPreviewImage?.({ src: prepAssetUrl(note.image), alt: note.text || note.image.name || '截图' })
          }}
        >
          <img src={prepAssetUrl(note.image)} alt={note.text || note.image.name || '截图'} loading="lazy" />
        </button>
      ) : null}

      {note.kind === 'link' && note.link ? (
        <a
          className="ws-prep-link-pill"
          href={note.link.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
        >
          <PrepIcon name="link" size={12} />{note.link.host}
        </a>
      ) : null}

      {editing ? (
        <div className="ws-prep-inline-edit" onClick={e => e.stopPropagation()}>
          <textarea
            rows={3}
            maxLength={4000}
            value={editText}
            autoFocus
            onChange={e => setEditText(e.target.value)}
            onKeyDown={e => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return
              if (e.key === 'Escape') { e.stopPropagation(); setEditing(false) }
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                void saveEdit()
              }
            }}
          />
          <div className="ws-prep-inline-edit-foot">
            <button type="button" className="ws-btn ws-prep-mini-btn" onClick={() => setEditing(false)}>取消</button>
            <button type="button" className="ws-btn is-primary ws-prep-mini-btn" onClick={() => void saveEdit()}>保存</button>
          </div>
        </div>
      ) : note.text ? (
        <p className="ws-prep-note-body">{note.text}</p>
      ) : note.image?.name ? (
        <p className="ws-prep-note-body ws-muted">{note.image.name}</p>
      ) : null}

      <div className="ws-prep-note-foot">
        <span className="ws-prep-note-time">{formatRelativeTime(note.updatedAt || note.createdAt)}</span>
        {settled ? <span className="ws-prep-note-settled-tag">沉淀</span> : null}
      </div>
    </article>
  )
}

export function PrepView({ data }) {
  const prep = useStudio(s => s.prep)
  const activeBagId = useStudio(s => s.activeBagId)
  const quickCaptureOpen = useStudio(s => s.quickCaptureOpen)
  const pending = useStudio(s => s.pending)

  const [query, setQuery] = React.useState('')
  const [noteFilter, setNoteFilter] = React.useState('all')
  const [captureText, setCaptureText] = React.useState('')
  const [captureFile, setCaptureFile] = React.useState(null)
  const [captureDragOver, setCaptureDragOver] = React.useState(false)
  const [captureTargetBagId, setCaptureTargetBagId] = React.useState(null)
  const [capturing, setCapturing] = React.useState(false)

  const [historyOpen, setHistoryOpen] = React.useState(false)
  const [settledExpanded, setSettledExpanded] = React.useState(false)
  const [selectedIds, setSelectedIds] = React.useState(() => new Set())
  const [draggingNoteId, setDraggingNoteId] = React.useState(null)
  const [dropBagId, setDropBagId] = React.useState(null)

  const [createBagModal, setCreateBagModal] = React.useState(null) // null | { initialTitle, noteIds }
  const [clusterOpen, setClusterOpen] = React.useState(false)
  const [batchAssignOpen, setBatchAssignOpen] = React.useState(false)
  const [directPromote, setDirectPromote] = React.useState(null) // null | { title, busyMode }
  const [lightbox, setLightbox] = React.useState(null) // null | { src, alt }

  const captureInputRef = React.useRef(null)
  const captureFileRef = React.useRef(null)
  const searchInputRef = React.useRef(null)
  const capturePreviewUrl = useFilePreview(captureFile)

  const retryPromotion = useStudio(s => s.pendingPromotion === undefined ? pendingPromotion : s.pendingPromotion)
  const retryBusy = useStudio(s => Boolean(s.promotionInFlight))
  const dialog = useStudio(s => s.dialog)
  const hasModel = Boolean(data?.model)

  // Initial load + refresh on window focus so CLI-added notes/bags show up automatically
  React.useEffect(() => {
    const syncPrep = () => {
      void loadPrep()
      void refresh()
    }
    syncPrep()
    window.addEventListener('focus', syncPrep)
    return () => window.removeEventListener('focus', syncPrep)
  }, [])

  const summary = React.useMemo(
    () => summarizePrep(prep, { query, noteFilter }),
    [prep, query, noteFilter],
  )

  const fullSummary = React.useMemo(
    () => (prep ? summarizePrep(prep) : null),
    [prep],
  )

  // Also resolve activeBag from unfiltered prep so search never hides the open drawer
  const activeBag = React.useMemo(() => {
    if (!activeBagId || !fullSummary) return null
    return [...fullSummary.activeBags, ...fullSummary.promotedBags, ...fullSummary.archivedBags].find(b => b.id === activeBagId) ?? null
  }, [activeBagId, fullSummary])

  const unfilteredActiveBags = fullSummary?.activeBags ?? []

  // Reset capture target if the targeted bag is no longer active
  React.useEffect(() => {
    if (captureTargetBagId && !unfilteredActiveBags.some(b => b.id === captureTargetBagId)) {
      setCaptureTargetBagId(null)
    }
  }, [captureTargetBagId, unfilteredActiveBags])

  // Prune selected note IDs that are no longer free notes
  React.useEffect(() => {
    if (!selectedIds.size) return
    const freeSet = new Set((prep?.notes ?? []).filter(n => n && !n.bagId).map(n => n.id))
    let changed = false
    const next = new Set()
    for (const id of selectedIds) {
      if (freeSet.has(id)) next.add(id)
      else changed = true
    }
    if (changed) {
      setSelectedIds(next)
      if (next.size === 0) {
        setDirectPromote(null)
        setBatchAssignOpen(false)
      }
    }
  }, [prep?.notes, selectedIds])

  // Single-key shortcuts on prep view: N focuses capture bar, / focuses search (strictly guarded by isEditableTarget)
  React.useEffect(() => {
    const onKeyDown = event => {
      if (dialog || quickCaptureOpen || activeBagId || createBagModal || clusterOpen || lightbox) return
      if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return
      if (isEditableTarget(event.target)) return
      if (event.key === 'n' || event.key === 'N') {
        event.preventDefault()
        captureInputRef.current?.focus()
      } else if (event.key === '/') {
        event.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dialog, quickCaptureOpen, activeBagId, createBagModal, clusterOpen, lightbox])

  const pickCaptureImage = file => {
    const err = validateImageFile(file)
    if (err) { toast(err, true); return }
    setCaptureFile(file)
  }

  const submitCapture = async () => {
    if (capturing) return
    const trimmed = captureText.trim()
    if (!trimmed && !captureFile) return
    setCapturing(true)
    try {
      let image = null
      if (captureFile) {
        try {
          const uploaded = await uploadPrepAsset(captureFile)
          if (!uploaded) return
          image = {
            assetId: uploaded.assetId,
            ext: uploaded.ext,
            mimeType: uploaded.mimeType,
            bytes: uploaded.bytes,
            ...(uploaded.name ? { name: uploaded.name } : {}),
          }
        } catch (err) {
          toast(err?.message || '图片上传失败', true)
          return
        }
      }
      const res = await prepAct('prep/notes', {
        text: trimmed,
        bagId: captureTargetBagId || null,
        ...(image ? { image } : {}),
      })
      if (res?.note) {
        setCaptureText('')
        setCaptureFile(null)
        if (captureTargetBagId) {
          const targetBag = unfilteredActiveBags.find(b => b.id === captureTargetBagId)
          toast(`已投递至「${targetBag?.title || '选题袋'}」`)
        }
      }
    } finally {
      setCapturing(false)
    }
  }

  const toggleSelect = id => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      if (next.size === 0) {
        setDirectPromote(null)
        setBatchAssignOpen(false)
      }
      return next
    })
  }

  const clearSelection = () => {
    setSelectedIds(new Set())
    setDirectPromote(null)
    setBatchAssignOpen(false)
  }

  const selectedNoteObjects = React.useMemo(() => {
    if (!selectedIds.size) return []
    return (prep?.notes ?? []).filter(n => n && !n.bagId && selectedIds.has(n.id))
  }, [selectedIds, prep?.notes])

  const assignNoteToBag = async (noteId, bag) => {
    const res = await prepAct('prep/notes/update', { id: noteId, bagId: bag.id })
    if (res?.note) toast(`已归入「${bag.title}」`)
  }

  const handleBatchAssign = async bag => {
    const ids = [...selectedIds]
    if (!ids.length) return
    const res = await prepAct('prep/notes/batch', {
      action: 'assign',
      noteIds: ids,
      bagId: bag.id,
      onlyFree: true,
    })
    if (res) {
      toast(`已将 ${res.movedIds?.length ?? ids.length} 条纸条归入「${bag.title}」`)
      clearSelection()
    }
  }

  const handleBatchDelete = async () => {
    const ids = [...selectedIds]
    if (!ids.length) return
    const res = await prepAct('prep/notes/delete', { ids })
    if (res) {
      toast(`已删除 ${res.deletedIds?.length ?? ids.length} 条纸条`)
      clearSelection()
    }
  }

  const openDirectPromoteConfirm = () => {
    setBatchAssignOpen(false)
    setDirectPromote(prev => prev
      ? null
      : { title: deriveNoteTitle(selectedNoteObjects), busyMode: '' })
  }

  const runDirectPromote = async mode => {
    if (!directPromote || directPromote.busyMode) return
    const ids = [...selectedIds]
    if (!ids.length) return
    setDirectPromote(prev => (prev ? { ...prev, busyMode: mode } : prev))
    try {
      const res = await submitPromotion({
        noteIds: ids,
        title: directPromote.title.trim() || deriveNoteTitle(selectedNoteObjects) || '未命名选题',
        mode,
      })
      if (res?.articleId) {
        clearSelection()
        if (!res.warnings?.length) toast(mode === 'ai' ? '已合袋并放上稿面，正在带料起草' : '已合袋并开空白稿面')
      } else {
        setDirectPromote(prev => (prev ? { ...prev, busyMode: '' } : prev))
      }
    } catch {
      setDirectPromote(prev => (prev ? { ...prev, busyMode: '' } : prev))
    }
  }

  const targetBag = captureTargetBagId
    ? unfilteredActiveBags.find(b => b.id === captureTargetBagId) ?? null
    : null

  const historyCount = summary.promotedBags.length + summary.archivedBags.length
  const showHistory = historyOpen || (summary.hasQuery && historyCount > 0 && summary.activeBags.length === 0)
  const batchBar = usePresence(selectedIds.size > 0)

  if (!prep) {
    return (
      <main className="ws-page ws-prep">
        <div className="ws-center"><span className="ws-shimmer">正在打开备稿桌…</span></div>
      </main>
    )
  }

  return (
    <main className="ws-page ws-prep">
      <div className="ws-dh-shell ws-prep-shell">
        {/* 1. 刊头 */}
        <header className="ws-dh-masthead">
          <div className="ws-dh-masthead-left">
            <span className="ws-dh-kicker">EDITORIAL DESK · 公众号成稿台</span>
            <div className="ws-dh-title-row">
              <h1>备稿</h1>
              <p className="ws-dh-dateline">
                <span><b><AnimatedNumber value={summary.counts.sponsored} /></b> 商单</span>
                <span aria-hidden="true">·</span>
                <span><b><AnimatedNumber value={summary.counts.topics} /></b> 选题</span>
                <span aria-hidden="true">·</span>
                <span><b><AnimatedNumber value={summary.counts.freeNotes} /></b> 自由纸条</span>
              </p>
            </div>
          </div>
          <div className="ws-draft-home-tools">
            <label className="ws-dh-search">
              <PrepIcon name="search" size={14} />
              <input
                ref={searchInputRef}
                type="search"
                aria-label="搜索选题、甲方、纸条"
                placeholder="搜索选题、甲方、纸条… ( / )"
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="ws-btn is-primary"
              onClick={() => setCreateBagModal({ initialTitle: '', noteIds: null })}
            >
              <PrepIcon name="plus" size={15} />新建选题
            </button>
          </div>
        </header>

        {prep.error ? (
          <div className="ws-banner is-error ws-prep-error-banner" role="alert">
            <span>读取备稿数据失败：{prep.error}</span>
            <button type="button" className="ws-btn ws-prep-mini-btn" onClick={() => void loadPrep()}>重试</button>
          </div>
        ) : null}

        {retryPromotion ? (
          <div className="ws-banner" role="status">
            <span>上一次建稿结果尚未确认。</span>
            <button
              type="button"
              className="ws-btn ws-prep-mini-btn"
              disabled={retryBusy}
              onClick={() => void submitPromotion()}
            >{retryBusy ? '正在确认…' : '重试建稿'}</button>
            <button
              type="button"
              className="ws-btn ws-prep-mini-btn"
              disabled={retryBusy}
              onClick={() => savePendingPromotion(null)}
            >关闭提示</button>
          </div>
        ) : null}

        {/* 2. 0.5 秒速记条 + 定向投递胶囊 */}
        <section
          className={`ws-prep-capture${captureDragOver ? ' is-drag-over' : ''}`}
          aria-label="随手速记"
          onDragOver={e => {
            if (!e.dataTransfer.types.includes('Files')) return
            e.preventDefault()
            setCaptureDragOver(true)
          }}
          onDragLeave={e => {
            if (!e.currentTarget.contains(e.relatedTarget)) setCaptureDragOver(false)
          }}
          onDrop={e => {
            if (!e.dataTransfer.types.includes('Files')) return
            e.preventDefault()
            setCaptureDragOver(false)
            const file = extractImageFromTransfer(e.dataTransfer)
            if (file) pickCaptureImage(file)
          }}
        >
          <div className="ws-prep-capture-main">
            <textarea
              ref={captureInputRef}
              rows={2}
              value={captureText}
              maxLength={4000}
              disabled={capturing}
              aria-label="记一条灵感或贴链接截图"
              placeholder={targetBag
                ? `直接记入「${targetBag.title}」…（Enter 投递，Shift+Enter 换行，支持粘贴/拖入截图）`
                : '随手记一句灵感、贴链接，或 ⌘V 粘贴/拖入截图…（Enter 记下，Shift+Enter 换行，按 N 快速聚焦）'}
              onChange={e => setCaptureText(e.target.value)}
              onPaste={e => {
                const file = extractImageFromTransfer(e.clipboardData)
                if (file) {
                  e.preventDefault()
                  pickCaptureImage(file)
                }
              }}
              onKeyDown={e => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void submitCapture()
                }
              }}
            />
            <div className="ws-prep-capture-actions">
              <button
                type="button"
                className="ws-icon-btn"
                title="附一张截图（PNG / JPEG / GIF / WebP，10 MB 以内）"
                aria-label="附截图"
                disabled={capturing}
                onClick={() => captureFileRef.current?.click()}
              >
                <PrepIcon name="image" size={16} />
              </button>
              <input
                ref={captureFileRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp,.png,.jpg,.jpeg,.gif,.webp"
                hidden
                onChange={e => {
                  const file = e.target.files?.[0]
                  if (file) pickCaptureImage(file)
                  e.target.value = ''
                }}
              />
              <button
                type="button"
                className="ws-btn is-primary ws-prep-submit-btn"
                disabled={capturing || (!captureText.trim() && !captureFile)}
                onClick={() => void submitCapture()}
              >
                <PrepIcon name="send" size={14} />
                {capturing ? '记录中…' : targetBag ? '投递' : '记下'}
              </button>
            </div>
          </div>

          {captureFile && capturePreviewUrl ? (
            <div className="ws-prep-pending-img">
              <img src={capturePreviewUrl} alt="待上传截图预览" />
              <span>{captureFile.name || '剪贴板截图'}</span>
              <button type="button" className="ws-icon-btn" aria-label="移除截图" onClick={() => setCaptureFile(null)}>
                <PrepIcon name="close" size={13} />
              </button>
            </div>
          ) : null}

          <div className="ws-prep-capsules" role="radiogroup" aria-label="投递目标">
            <span className="ws-prep-capsules-label">投递至</span>
            <button
              type="button"
              role="radio"
              aria-checked={captureTargetBagId === null}
              className={`ws-prep-capsule${captureTargetBagId === null ? ' is-on' : ''}`}
              onClick={() => setCaptureTargetBagId(null)}
            >
              自由纸条
            </button>
            {summary.capsules.map(bag => (
              <button
                key={bag.id}
                type="button"
                role="radio"
                aria-checked={captureTargetBagId === bag.id}
                className={`ws-prep-capsule${captureTargetBagId === bag.id ? ' is-on' : ''}${bag.type === 'sponsored' ? ' is-sponsored' : ''}`}
                title={bag.title}
                onClick={() => setCaptureTargetBagId(bag.id)}
              >
                {bag.type === 'sponsored' ? <i className="ws-prep-capsule-dot" aria-hidden="true" /> : null}
                <span>{bag.title}</span>
              </button>
            ))}
            <span className="ws-grow" />
            <span className="ws-prep-shortcut-hint ws-muted ws-small">全站随手记 {quickShortcutLabel()}</span>
          </div>
        </section>

        {/* 3. 上区：正在攒料（选题袋 / 商单袋） */}
        <section className="ws-prep-section" aria-label="正在攒料">
          <div className="ws-prep-sec-head">
            <div className="ws-prep-sec-title">
              <h2>正在攒料</h2>
              <span className="ws-prep-sec-count">{summary.activeBags.length}</span>
              {draggingNoteId ? <span className="ws-prep-drag-tip">拖到任意袋子上松手即可放入</span> : null}
            </div>
            {historyCount > 0 ? (
              <button
                type="button"
                className="ws-prep-history-toggle"
                aria-expanded={showHistory}
                onClick={() => setHistoryOpen(v => !v)}
              >
                已成稿 {summary.promotedBags.length} · 已归档 {summary.archivedBags.length}
                <PrepIcon name="down" size={13} />
              </button>
            ) : null}
          </div>

          {summary.activeBags.length > 0 ? (
            <div className="ws-prep-bag-grid">
              {summary.activeBags.map(bag => {
                const isSponsored = bag.type === 'sponsored'
                const due = formatDueBadge(bag.targetDate, isSponsored)
                const isDropTarget = dropBagId === bag.id
                const brief = bag.brief ?? {}
                const leadNote = bag.notes[0]
                return (
                  <article
                    key={bag.id}
                    className={`ws-prep-bag-card${isSponsored ? ' is-sponsored' : ' is-topic'}${isDropTarget ? ' is-drop-target' : ''}`}
                    onClick={() => setState({ activeBagId: bag.id })}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setState({ activeBagId: bag.id })
                      }
                    }}
                    tabIndex={0}
                    role="button"
                    aria-label={`打开${isSponsored ? '商单袋' : '选题袋'}：${bag.title}`}
                    onDragOver={e => {
                      if (!draggingNoteId && !e.dataTransfer.types.includes('application/x-ws-prep-note')) return
                      e.preventDefault()
                      e.dataTransfer.dropEffect = 'move'
                      if (dropBagId !== bag.id) setDropBagId(bag.id)
                    }}
                    onDragLeave={e => {
                      if (!e.currentTarget.contains(e.relatedTarget) && dropBagId === bag.id) {
                        setDropBagId(null)
                      }
                    }}
                    onDrop={e => {
                      if (!draggingNoteId && !e.dataTransfer.types.includes('application/x-ws-prep-note')) return
                      e.preventDefault()
                      const noteId = e.dataTransfer.getData('application/x-ws-prep-note') || draggingNoteId
                      setDropBagId(null)
                      setDraggingNoteId(null)
                      if (noteId) void assignNoteToBag(noteId, bag)
                    }}
                  >
                    <div className="ws-prep-bag-top">
                      {isSponsored ? (
                        <span className="ws-prep-stamp">
                          商单{brief.partner ? ` · ${brief.partner}` : ''}
                        </span>
                      ) : (
                        <span className="ws-prep-topic-tag">选题</span>
                      )}
                      {due ? (
                        <span className={`ws-prep-due-chip${due.overdue ? ' is-overdue' : due.urgent ? ' is-urgent' : ''}`}>
                          {due.text}
                        </span>
                      ) : null}
                    </div>

                    <h3 className="ws-prep-bag-title">{bag.title}</h3>

                    {isSponsored ? (
                      <div className="ws-prep-bag-brief-summary">
                        {brief.sellingPoints ? (
                          <p className="ws-prep-bag-snippet">{brief.sellingPoints}</p>
                        ) : (
                          <p className="ws-prep-bag-snippet is-placeholder">点击补充甲方卖点、必带信息与禁忌红线…</p>
                        )}
                        {(brief.mustInclude?.length || brief.taboo?.length) ? (
                          <div className="ws-prep-bag-constraints">
                            {brief.mustInclude?.length ? <span>必带 {brief.mustInclude.length} 项</span> : null}
                            {brief.taboo?.length ? <span className="is-taboo">忌 {brief.taboo.length} 项</span> : null}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <p className={`ws-prep-bag-snippet${leadNote ? '' : ' is-placeholder'}`}>
                        {leadNote
                          ? `${leadNote.pinned ? '★ ' : ''}${leadNote.kind === 'image' ? `[截图] ${leadNote.text || leadNote.image?.name || '图片'}` : leadNote.text}`
                          : '还没有想法，点开袋子或把下方纸条拖进来…'}
                      </p>
                    )}

                    <div className="ws-prep-bag-foot">
                      <span>{bag.noteCount} 条想法</span>
                      <span className="ws-prep-bag-time">{formatRelativeTime(bag.updatedAt)}</span>
                    </div>

                    {isDropTarget ? <div className="ws-prep-drop-overlay">松手放入此袋</div> : null}
                  </article>
                )
              })}
            </div>
          ) : (
            <div className="ws-prep-empty-box">
              <p className="ws-muted">
                {summary.hasQuery
                  ? '没有匹配的活跃选题袋。'
                  : '还没有正在攒料的选题袋。点右上角「新建选题」，或在下方多选几条纸条合成一个袋子。'}
              </p>
            </div>
          )}

          {/* 折叠区：已成稿 / 已归档 */}
          {showHistory && historyCount > 0 ? (
            <div className="ws-prep-history-panel ws-view-enter">
              {summary.promotedBags.length > 0 ? (
                <div className="ws-prep-history-group">
                  <h4>已成稿（{summary.promotedBags.length}）</h4>
                  <div className="ws-prep-history-list">
                    {summary.promotedBags.map(bag => (
                      <div key={bag.id} className="ws-prep-history-row" onClick={() => setState({ activeBagId: bag.id })}>
                        <div className="ws-prep-history-info">
                          {bag.type === 'sponsored' ? <span className="ws-prep-stamp is-compact">商单</span> : <span className="ws-prep-topic-tag">选题</span>}
                          <strong className="ws-prep-history-title">{bag.title}</strong>
                          <span className={`ws-prep-linked-tag is-compact${bag.linkedArticleStatus === 'deleted' ? ' is-warn' : bag.linkedArticleStatus === 'archived' ? ' is-muted' : ''}`}>
                            {bag.linkedArticleStatus === 'archived' ? '稿件已归档' : bag.linkedArticleStatus === 'deleted' ? '原稿已删除' : '已成稿'}
                          </span>
                          <span className="ws-muted ws-small">{bag.noteCount} 条备料</span>
                        </div>
                        <div className="ws-prep-history-actions" onClick={e => e.stopPropagation()}>
                          {bag.linkedArticleStatus === 'active' ? (
                            <button
                              type="button"
                              className="ws-btn ws-prep-mini-btn"
                              disabled={Boolean(pending)}
                              onClick={() => void openArticleInPaper(bag.articleId)}
                            >
                              打开稿面 →
                            </button>
                          ) : bag.linkedArticleStatus === 'archived' ? (
                            <button
                              type="button"
                              className="ws-btn ws-prep-mini-btn"
                              disabled={Boolean(pending)}
                              onClick={() => void openArticleInPaper(bag.articleId, { restore: true })}
                            >
                              恢复并打开
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="ws-btn ws-prep-mini-btn"
                              onClick={() => setState({ activeBagId: bag.id })}
                            >
                              查看处理
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {summary.archivedBags.length > 0 ? (
                <div className="ws-prep-history-group">
                  <h4>已归档（{summary.archivedBags.length}）</h4>
                  <div className="ws-prep-history-list">
                    {summary.archivedBags.map(bag => (
                      <div key={bag.id} className="ws-prep-history-row is-archived" onClick={() => setState({ activeBagId: bag.id })}>
                        <div className="ws-prep-history-info">
                          {bag.type === 'sponsored' ? <span className="ws-prep-stamp is-compact">商单</span> : <span className="ws-prep-topic-tag">选题</span>}
                          <strong className="ws-prep-history-title">{bag.title}</strong>
                          <span className="ws-muted ws-small">{bag.noteCount} 条备料</span>
                        </div>
                        <div className="ws-prep-history-actions" onClick={e => e.stopPropagation()}>
                          <button
                            type="button"
                            className="ws-btn ws-prep-mini-btn"
                            disabled={Boolean(pending)}
                            onClick={async () => {
                              const res = await prepAct('prep/bags/update', { id: bag.id, archived: false })
                              if (res?.bag) toast('已恢复选题袋')
                            }}
                          >
                            恢复
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        {/* 4. 下区：自由纸条 */}
        <section className="ws-prep-section ws-prep-notes-section" aria-label="自由纸条">
          <div className="ws-prep-notes-head">
            <div className="ws-prep-sec-title">
              <h2>自由纸条</h2>
              <span className="ws-prep-sec-count">{summary.counts.freeNotes}</span>
              <SlidingTabs activeKey={noteFilter} mode="underline" underlineOffset={6} thumbClassName="ws-dh-tab-ink" className="ws-prep-filter-tabs" role="tablist" aria-label="纸条筛选">
                {NOTE_FILTER_TABS.map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={noteFilter === id}
                    className={`ws-prep-filter-tab${noteFilter === id ? ' is-on' : ''}`}
                    onClick={() => setNoteFilter(id)}
                  >
                    {label}
                  </button>
                ))}
              </SlidingTabs>
            </div>
            <div className="ws-prep-notes-tools">
              {summary.counts.freeNotes >= 5 ? (
                <button
                  type="button"
                  className="ws-btn ws-prep-ai-btn ws-prep-mini-btn"
                  disabled={!hasModel}
                  title={hasModel ? '从当前自由纸条中按需提炼 1～3 组可写选题角度' : '未配置可用模型，请先在 DeepSeek Harness 配置模型'}
                  onClick={() => setClusterOpen(true)}
                >
                  <PrepIcon name="spark" size={13} />理出可写角度
                </button>
              ) : null}
              {selectedIds.size > 0 ? (
                <button type="button" className="ws-link" onClick={clearSelection}>取消已选（{selectedIds.size}）</button>
              ) : null}
            </div>
          </div>

          {summary.freshFreeNotes.length === 0 && summary.settledFreeNotes.length === 0 ? (
            <div className="ws-prep-empty-box">
              <p className="ws-muted">
                {summary.hasQuery || noteFilter !== 'all'
                  ? '没有符合条件的自由纸条。'
                  : '这里放还没归属的零散火苗——想到一句话、刷到一个链接或随手截张图，在顶部敲回车就能落纸。'}
              </p>
            </div>
          ) : (
            <>
              {summary.freshFreeNotes.length > 0 ? (
                <div className="ws-prep-notes-grid">
                  {summary.freshFreeNotes.map(note => (
                    <FreeNoteCard
                      key={note.id}
                      note={note}
                      settled={false}
                      selected={selectedIds.has(note.id)}
                      selectionMode={selectedIds.size > 0}
                      activeBags={unfilteredActiveBags}
                      onToggleSelect={toggleSelect}
                      onDragStartNote={setDraggingNoteId}
                      onDragEndNote={() => { setDraggingNoteId(null); setDropBagId(null) }}
                      onAssignToBag={assignNoteToBag}
                      onCreateBagFromNote={n => setCreateBagModal({ initialTitle: deriveNoteTitle([n]), noteIds: [n.id] })}
                      onPreviewImage={setLightbox}
                    />
                  ))}
                </div>
              ) : null}

              {summary.settledFreeNotes.length > 0 ? (
                <div className="ws-prep-settled-block">
                  {summary.collapseSettled ? (
                    <button
                      type="button"
                      className="ws-prep-settled-toggle"
                      aria-expanded={settledExpanded}
                      onClick={() => setSettledExpanded(v => !v)}
                    >
                      <span>更早的纸条（{summary.settledFreeNotes.length}）</span>
                      <small className="ws-muted">超过 30 天自然沉淀</small>
                      <PrepIcon name="down" size={13} />
                    </button>
                  ) : (
                    <div className="ws-prep-settled-divider">
                      <span>更早的纸条（{summary.settledFreeNotes.length}）</span>
                    </div>
                  )}

                  {(!summary.collapseSettled || settledExpanded) ? (
                    <div className="ws-prep-notes-grid is-settled-grid">
                      {summary.settledFreeNotes.map(note => (
                        <FreeNoteCard
                          key={note.id}
                          note={note}
                          settled
                          selected={selectedIds.has(note.id)}
                          selectionMode={selectedIds.size > 0}
                          activeBags={unfilteredActiveBags}
                          onToggleSelect={toggleSelect}
                          onDragStartNote={setDraggingNoteId}
                          onDragEndNote={() => { setDraggingNoteId(null); setDropBagId(null) }}
                          onAssignToBag={assignNoteToBag}
                          onCreateBagFromNote={n => setCreateBagModal({ initialTitle: deriveNoteTitle([n]), noteIds: [n.id] })}
                          onPreviewImage={setLightbox}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>

      {/* 多选浮动操作条 + 1 步确认条 */}
      {batchBar.mounted ? (
        <div className={`ws-prep-batch-dock${batchBar.closing ? ' is-closing' : ''}`}>
          {directPromote ? (
            <div className="ws-prep-promote-confirm" role="region" aria-label="直接放上稿面确认">
              <div className="ws-prep-promote-confirm-top">
                <label className="ws-prep-promote-title-field">
                  <span>选题方向</span>
                  <input
                    value={directPromote.title}
                    maxLength={120}
                    autoFocus
                    disabled={Boolean(directPromote.busyMode)}
                    placeholder="填一句方向…"
                    onChange={e => setDirectPromote(prev => (prev ? { ...prev, title: e.target.value } : prev))}
                  />
                </label>
                <button
                  type="button"
                  className="ws-icon-btn"
                  aria-label="收起确认条"
                  disabled={Boolean(directPromote.busyMode)}
                  onClick={() => setDirectPromote(null)}
                >
                  <PrepIcon name="close" size={14} />
                </button>
              </div>
              <div className="ws-prep-promote-confirm-actions">
                <span className="ws-muted ws-small">将自动合袋收拢已选 {selectedIds.size} 条纸条并挂接至稿面</span>
                <div className="ws-prep-promote-confirm-btns">
                  <button
                    type="button"
                    className="ws-btn ws-prep-mini-btn"
                    disabled={Boolean(directPromote.busyMode)}
                    onClick={() => void runDirectPromote('blank')}
                  >
                    {directPromote.busyMode === 'blank' ? '正在创建…' : '空白稿面（挂原纸条）'}
                  </button>
                  <button
                    type="button"
                    className="ws-btn is-primary ws-prep-mini-btn"
                    disabled={!hasModel || Boolean(directPromote.busyMode)}
                    title={hasModel ? '由 AI 带这几条纸条起草初稿' : '未配置可用模型，请改用「空白稿面」'}
                    onClick={() => void runDirectPromote('ai')}
                  >
                    <PrepIcon name="spark" size={13} />
                    {directPromote.busyMode === 'ai' ? '正在起草…' : 'AI 带料起草'}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {batchAssignOpen ? (
            <div className="ws-prep-batch-assign-pop" role="menu" aria-label="选择目标袋子">
              <div className="ws-prep-batch-assign-head">
                <span>归入哪个选题袋？</span>
                <button type="button" className="ws-icon-btn" aria-label="关闭" onClick={() => setBatchAssignOpen(false)}>
                  <PrepIcon name="close" size={13} />
                </button>
              </div>
              {unfilteredActiveBags.length > 0 ? (
                <div className="ws-prep-batch-assign-list">
                  {unfilteredActiveBags.map(bag => (
                    <button key={bag.id} type="button" onClick={() => void handleBatchAssign(bag)}>
                      {bag.type === 'sponsored' ? <span className="ws-prep-mini-dot" /> : null}
                      <span>{bag.title}</span>
                      <small>{bag.noteCount} 条</small>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="ws-muted ws-small">还没有活跃选题袋，可以直接点「合成新选题袋」。</p>
              )}
            </div>
          ) : null}

          <div className="ws-prep-batch-bar" role="toolbar" aria-label="批量操作">
            <span className="ws-prep-batch-count">已选 <b>{selectedIds.size}</b> 条</span>
            <button
              type="button"
              className="ws-prep-batch-btn"
              onClick={() => {
                setDirectPromote(null)
                setBatchAssignOpen(false)
                setCreateBagModal({
                  initialTitle: deriveNoteTitle(selectedNoteObjects),
                  noteIds: [...selectedIds],
                })
              }}
            >
              合成新选题袋
            </button>
            <button
              type="button"
              className={`ws-prep-batch-btn${batchAssignOpen ? ' is-on' : ''}`}
              onClick={() => {
                setDirectPromote(null)
                setBatchAssignOpen(v => !v)
              }}
            >
              归入已有袋子
            </button>
            <button
              type="button"
              className={`ws-prep-batch-btn is-accent${directPromote ? ' is-on' : ''}`}
              onClick={openDirectPromoteConfirm}
            >
              直接放上稿面写
            </button>
            <button
              type="button"
              className="ws-prep-batch-btn is-danger"
              disabled={Boolean(pending)}
              onClick={() => void handleBatchDelete()}
            >
              删除
            </button>
            <button
              type="button"
              className="ws-prep-batch-close"
              aria-label="取消选择"
              onClick={clearSelection}
            >
              <PrepIcon name="close" size={14} />
            </button>
          </div>
        </div>
      ) : null}

      {/* 右侧滑出剪报袋抽屉 */}
      <BagDrawer
        bag={activeBag}
        hasModel={hasModel}
        onClose={() => setState({ activeBagId: null })}
        onPreviewImage={setLightbox}
      />

      {/* 新建选题袋弹窗 */}
      {createBagModal ? (
        <CreateBagDialog
          initialTitle={createBagModal.initialTitle}
          noteIds={createBagModal.noteIds}
          onCreated={bag => {
            if (createBagModal.noteIds) clearSelection()
            setState({ activeBagId: bag.id })
          }}
          onClose={() => setCreateBagModal(null)}
        />
      ) : null}

      {/* AI 聚拢选题建议弹窗 */}
      {clusterOpen ? (
        <ClusterNotesDialog
          notes={prep.notes}
          onCreated={bagId => {
            if (bagId) setState({ activeBagId: bagId })
          }}
          onClose={() => setClusterOpen(false)}
        />
      ) : null}

      {/* 截图放大灯箱 */}
      {lightbox ? (
        <ImageLightbox src={lightbox.src} alt={lightbox.alt} onClose={() => setLightbox(null)} />
      ) : null}
    </main>
  )
}

export function QuickCaptureModal() {
  const open = useStudio(s => s.quickCaptureOpen)
  const prep = useStudio(s => s.prep)
  const { mounted, closing } = usePresence(open)

  const [text, setText] = React.useState('')
  const [file, setFile] = React.useState(null)
  const [targetBagId, setTargetBagId] = React.useState(null)
  const [dragOver, setDragOver] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)

  const modalRef = React.useRef(null)
  const inputRef = React.useRef(null)
  const fileRef = React.useRef(null)
  const prevFocusRef = React.useRef(null)
  const previewUrl = useFilePreview(file)
  const headingId = React.useId()

  const capsules = React.useMemo(() => summarizePrep(prep).capsules, [prep])

  // Save prior focus & selection on open, restore on close
  React.useLayoutEffect(() => {
    if (open) {
      const active = document.activeElement
      if (active && active !== document.body && !modalRef.current?.contains(active)) {
        prevFocusRef.current = {
          element: active,
          start: typeof active.selectionStart === 'number' ? active.selectionStart : null,
          end: typeof active.selectionEnd === 'number' ? active.selectionEnd : null,
          direction: active.selectionDirection ?? undefined,
        }
      }
      return undefined
    }
    if (prevFocusRef.current) {
      const saved = prevFocusRef.current
      prevFocusRef.current = null
      requestAnimationFrame(() => {
        if (saved.element?.isConnected && typeof saved.element.focus === 'function') {
          saved.element.focus({ preventScroll: true })
          if (saved.start != null && saved.end != null && typeof saved.element.setSelectionRange === 'function') {
            try {
              saved.element.setSelectionRange(saved.start, saved.end, saved.direction)
            } catch {
              // Some input types (e.g. date/checkbox) disallow setSelectionRange
            }
          }
        }
      })
    }
    return undefined
  }, [open])

  React.useEffect(() => {
    if (!open || !mounted) return undefined
    const raf = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(raf)
  }, [open, mounted])

  // Keep targetBagId valid when capsules refresh asynchronously
  React.useEffect(() => {
    if (targetBagId && prep && !capsules.some(b => b.id === targetBagId)) {
      setTargetBagId(null)
    }
  }, [targetBagId, capsules, prep])

  const close = React.useCallback(() => {
    if (submitting) return
    setQuickCaptureOpen(false)
  }, [submitting])

  React.useEffect(() => {
    if (!open) return undefined
    const onKey = event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        close()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, close])

  const pickFile = next => {
    const err = validateImageFile(next)
    if (err) { toast(err, true); return }
    setFile(next)
  }

  const submit = async () => {
    if (submitting) return
    const trimmed = text.trim()
    if (!trimmed && !file) return
    setSubmitting(true)
    try {
      let image = null
      if (file) {
        try {
          const uploaded = await uploadPrepAsset(file)
          if (!uploaded) return
          image = {
            assetId: uploaded.assetId,
            ext: uploaded.ext,
            mimeType: uploaded.mimeType,
            bytes: uploaded.bytes,
            ...(uploaded.name ? { name: uploaded.name } : {}),
          }
        } catch (err) {
          toast(err?.message || '图片上传失败', true)
          return
        }
      }
      const res = await prepAct('prep/notes', {
        text: trimmed,
        bagId: targetBagId || null,
        ...(image ? { image } : {}),
      }, { refreshState: Boolean(targetBagId) })
      if (res?.note) {
        const bagTitle = targetBagId ? capsules.find(b => b.id === targetBagId)?.title : null
        toast(bagTitle ? `已记入「${bagTitle}」` : '已记入自由纸条')
        setText('')
        setFile(null)
        setTargetBagId(null)
        setQuickCaptureOpen(false)
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (!mounted) return null

  return (
    <div
      className={`ws-scrim ws-prep-qc-scrim${closing ? ' is-closing' : ''}`}
      onClick={e => { if (e.target === e.currentTarget) close() }}
    >
      <div
        ref={modalRef}
        className={`ws-dialog ws-prep-qc-modal${dragOver ? ' is-drag-over' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onDragOver={e => {
          if (!e.dataTransfer.types.includes('Files')) return
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={e => {
          if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false)
        }}
        onDrop={e => {
          if (!e.dataTransfer.types.includes('Files')) return
          e.preventDefault()
          setDragOver(false)
          const dropped = extractImageFromTransfer(e.dataTransfer)
          if (dropped) pickFile(dropped)
        }}
      >
        <div className="ws-dialog-head">
          <div className="ws-prep-qc-title">
            <h2 id={headingId} className="ws-dialog-title">随手记</h2>
            <kbd className="ws-prep-kbd">{quickShortcutLabel()}</kbd>
          </div>
          <button type="button" className="ws-icon-btn" aria-label="关闭随手记" disabled={submitting} onClick={close}>
            <PrepIcon name="close" />
          </button>
        </div>

        <textarea
          ref={inputRef}
          className="ws-prep-qc-textarea"
          rows={3}
          value={text}
          maxLength={4000}
          disabled={submitting}
          aria-label="速记内容"
          placeholder="记一句灵感、贴个链接，或直接 ⌘V 粘贴截图…（Enter 记下，Shift+Enter 换行）"
          onChange={e => setText(e.target.value)}
          onPaste={e => {
            const pastedFile = extractImageFromTransfer(e.clipboardData)
            if (pastedFile) {
              e.preventDefault()
              pickFile(pastedFile)
            }
          }}
          onKeyDown={e => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void submit()
            }
          }}
        />

        {file && previewUrl ? (
          <div className="ws-prep-pending-img">
            <img src={previewUrl} alt="待上传截图" />
            <span>{file.name || '剪贴板截图'}</span>
            <button type="button" className="ws-icon-btn" aria-label="移除截图" onClick={() => setFile(null)}>
              <PrepIcon name="close" size={13} />
            </button>
          </div>
        ) : null}

        <div className="ws-prep-capsules" role="radiogroup" aria-label="投递目标">
          <span className="ws-prep-capsules-label">投递至</span>
          <button
            type="button"
            role="radio"
            aria-checked={targetBagId === null}
            className={`ws-prep-capsule${targetBagId === null ? ' is-on' : ''}`}
            onClick={() => setTargetBagId(null)}
          >
            自由纸条
          </button>
          {capsules.map(bag => (
            <button
              key={bag.id}
              type="button"
              role="radio"
              aria-checked={targetBagId === bag.id}
              className={`ws-prep-capsule${targetBagId === bag.id ? ' is-on' : ''}${bag.type === 'sponsored' ? ' is-sponsored' : ''}`}
              title={bag.title}
              onClick={() => setTargetBagId(bag.id)}
            >
              {bag.type === 'sponsored' ? <i className="ws-prep-capsule-dot" aria-hidden="true" /> : null}
              <span>{bag.title}</span>
            </button>
          ))}
        </div>

        <div className="ws-prep-qc-foot">
          <button type="button" className="ws-btn ws-prep-mini-btn" disabled={submitting} onClick={() => fileRef.current?.click()}>
            <PrepIcon name="image" size={13} />附截图
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,.png,.jpg,.jpeg,.gif,.webp"
            hidden
            onChange={e => {
              const chosen = e.target.files?.[0]
              if (chosen) pickFile(chosen)
              e.target.value = ''
            }}
          />
          <span className="ws-muted ws-small ws-grow">Enter 记下 · Shift+Enter 换行 · Esc 关闭</span>
          <button type="button" className="ws-btn" disabled={submitting} onClick={close}>取消</button>
          <button
            type="button"
            className="ws-btn is-primary"
            disabled={submitting || (!text.trim() && !file)}
            onClick={() => void submit()}
          >
            {submitting ? '正在记下…' : '记下'}
          </button>
        </div>
      </div>
    </div>
  )
}

function safeExternalHref(url) {
  if (!url) return ''
  try {
    const parsed = new URL(url)
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : ''
  } catch {
    return ''
  }
}

function copyTextForSourceNote(note) {
  if (note.kind === 'image' && note.image) {
    const caption = (note.text || note.image.name || '截图').replace(/[\r\n]+/g, ' ').trim()
    if (note.image.cloudinaryUrl) return `![${caption}](${note.image.cloudinaryUrl})`
    return note.text?.trim() || `[截图：${caption}]`
  }
  return (note.text || note.link?.url || '').trim()
}

export function SourceBagCard({ article, cloudinaryReady }) {
  const sourceBag = article?.sourceBag
  const pending = useStudio(s => s.pending)
  const [expanded, setExpanded] = React.useState(() => (article?.blocks?.length ?? 0) === 0)
  const [insertingId, setInsertingId] = React.useState(null)
  const [lightbox, setLightbox] = React.useState(null)

  React.useEffect(() => {
    setExpanded((article?.blocks?.length ?? 0) === 0)
  }, [article?.id])

  if (!sourceBag) return null

  const isSponsored = sourceBag.type === 'sponsored'
  const brief = isSponsored ? (sourceBag.brief ?? null) : null
  const notes = Array.isArray(sourceBag.notes) ? sourceBag.notes : []
  const mustInclude = Array.isArray(brief?.mustInclude) ? brief.mustInclude.filter(Boolean) : []
  const taboo = Array.isArray(brief?.taboo) ? brief.taboo.filter(Boolean) : []
  const hasBriefDetails = Boolean(brief?.partner || brief?.sellingPoints || mustInclude.length || taboo.length)
  const busy = Boolean(article.job || pending || insertingId)

  const summaryParts = []
  if (isSponsored && mustInclude.length) summaryParts.push(`必带 ${mustInclude.length}`)
  if (isSponsored && taboo.length) summaryParts.push(`忌 ${taboo.length}`)
  if (sourceBag.exists || notes.length > 0) summaryParts.push(`${notes.length} 条想法`)

  const handleInsertNote = async note => {
    if (busy) return
    setInsertingId(note.id)
    try {
      const res = await prepAct('prep/notes/insert-to-article', {
        articleId: article.id,
        noteId: note.id,
      })
      if (res && !res.fallback) {
        toast('已插入到正文末尾')
      }
    } finally {
      setInsertingId(null)
    }
  }

  return (
    <section
      className={`ws-source-bag-card${isSponsored ? ' is-sponsored' : ''}${expanded ? ' is-open' : ''}`}
      aria-label="原备料袋参照"
    >
      <div className="ws-source-bag-top">
        {isSponsored ? (
          <span className="ws-prep-stamp is-compact">
            商单{brief?.partner ? ` · ${brief.partner}` : ''}
          </span>
        ) : (
          <span className="ws-prep-topic-tag">原备料袋</span>
        )}
        {sourceBag.exists && sourceBag.id ? (
          <button
            type="button"
            className="ws-link ws-source-bag-jump"
            onClick={() => openPrepBag(sourceBag.id)}
          >
            去备稿修改要点 →
          </button>
        ) : isSponsored ? (
          <span className="ws-source-bag-snapshot">副本快照</span>
        ) : null}
      </div>

      <button
        type="button"
        className="ws-source-bag-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded(v => !v)}
      >
        <div className="ws-source-bag-heading">
          <strong className="ws-source-bag-title">{sourceBag.title || '原备料袋'}</strong>
          {summaryParts.length ? (
            <span className="ws-source-bag-meta">{summaryParts.join(' · ')}</span>
          ) : null}
        </div>
        <span className="ws-source-bag-chevron" aria-hidden="true">
          <PrepIcon name="down" size={14} />
        </span>
      </button>

      {expanded ? (
        <div className="ws-source-bag-body">
          {isSponsored ? (
            hasBriefDetails ? (
              <div className="ws-source-bag-brief">
                {brief?.partner ? (
                  <div className="ws-source-bag-field">
                    <span>合作方</span>
                    <strong>{brief.partner}</strong>
                  </div>
                ) : null}
                {brief?.sellingPoints ? (
                  <div className="ws-source-bag-field">
                    <span>核心卖点</span>
                    <p>{formatSellingPoints(brief.sellingPoints)}</p>
                  </div>
                ) : null}
                {mustInclude.length ? (
                  <div className="ws-source-bag-field">
                    <span>必带信息</span>
                    <div className="ws-prep-pill-list">
                      {mustInclude.map((item, idx) => (
                        <span key={`${item}-${idx}`} className="ws-prep-brief-pill">{item}</span>
                      ))}
                    </div>
                  </div>
                ) : null}
                {taboo.length ? (
                  <div className="ws-source-bag-field">
                    <span>禁忌红线</span>
                    <div className="ws-prep-pill-list">
                      {taboo.map((item, idx) => (
                        <span key={`${item}-${idx}`} className="ws-prep-brief-pill is-taboo">{item}</span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="ws-muted ws-small">
                {sourceBag.exists ? '尚未填写甲方要点，可点右上角前往备稿补充。' : '暂无商单要点记录。'}
              </p>
            )
          ) : null}

          {sourceBag.exists || notes.length > 0 ? (
            <div className="ws-source-bag-notes">
              <div className="ws-source-bag-notes-head">
                <span>备料想法</span>
                <small>{notes.length} 条</small>
              </div>
              {notes.length > 0 ? (
                <div className="ws-source-bag-note-list">
                  {notes.map(note => {
                    const isImage = note.kind === 'image' && Boolean(note.image)
                    const imgSrc = isImage ? prepAssetUrl(note.image) : ''
                    const linkHref = note.kind === 'link' ? safeExternalHref(note.link?.url) : ''
                    const copyPayload = copyTextForSourceNote(note)
                    const insertingThis = insertingId === note.id
                    const needsFallbackHint = isImage && !cloudinaryReady && !note.image?.cloudinaryUrl
                    return (
                      <article key={note.id} className={`ws-source-bag-note${note.included === false ? ' is-excluded' : ''}`}>
                        {(note.pinned || note.included === false) ? (
                          <div className="ws-source-bag-note-badges">
                            {note.pinned ? <span className="ws-source-bag-pin">★ 核心</span> : null}
                            {note.included === false ? <span className="ws-source-bag-excluded">未纳入初稿</span> : null}
                          </div>
                        ) : null}
                        {isImage && imgSrc ? (
                          <button
                            type="button"
                            className="ws-source-bag-thumb"
                            title="点击放大查看截图"
                            onClick={() => setLightbox({ src: imgSrc, alt: note.text || note.image?.name || '截图' })}
                          >
                            <img src={imgSrc} alt={note.text || note.image?.name || '备稿截图'} loading="lazy" />
                          </button>
                        ) : null}
                        {note.text ? (
                          <p className="ws-source-bag-note-text">{note.text}</p>
                        ) : isImage ? (
                          <p className="ws-source-bag-note-text ws-muted">{note.image?.name || '截图素材'}</p>
                        ) : null}
                        {linkHref ? (
                          <a
                            className="ws-source-bag-link"
                            href={linkHref}
                            target="_blank"
                            rel="noreferrer"
                            title={linkHref}
                          >
                            <PrepIcon name="link" size={12} />
                            <span>{note.link?.host || linkHref}</span>
                          </a>
                        ) : null}
                        <div className="ws-source-bag-note-actions">
                          <button
                            type="button"
                            className="ws-link"
                            disabled={!copyPayload}
                            onClick={() => void copyText(copyPayload, '已复制想法')}
                          >
                            复制
                          </button>
                          <button
                            type="button"
                            className="ws-link"
                            disabled={busy}
                            title={needsFallbackHint ? '未配置图床，将插入 [截图：...] 占位' : '追加到当前文章正文末尾'}
                            onClick={() => void handleInsertNote(note)}
                          >
                            {insertingThis ? '正在插入…' : '插入到正文末尾'}
                          </button>
                        </div>
                      </article>
                    )
                  })}
                </div>
              ) : (
                <p className="ws-muted ws-small">这个袋子还没有保存的想法。</p>
              )}
            </div>
          ) : !isSponsored ? (
            <p className="ws-muted ws-small">原选题袋记录已不在备稿中。</p>
          ) : null}
        </div>
      ) : null}

      {lightbox ? (
        <ImageLightbox src={lightbox.src} alt={lightbox.alt} onClose={() => setLightbox(null)} />
      ) : null}
    </section>
  )
}

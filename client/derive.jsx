import { balanceXhsArtboard } from './xhs-card-balance.js'
import React from 'react'
import { compressReferenceImageFile, extractClipboardImageFiles, loadBrowserImage } from './image-input.js'
import { animateValues, SlidingTabs, useDirection, usePresence, usePresenceValue } from './motion.jsx'
import {
  DERIVE_LIMITS,
  XHS_CARD_KINDS,
  XHS_DECK_STYLES,
  cardContentVersion,
  charCount,
  threadClipboardText,
  weightedLength,
  xhsClipboardText,
} from '../src/derive-shared.js'
import {
  buildMarkdownRefreshKey,
  canExportMarkdown,
  deriveDraftKey,
  hasUnsavedXhsCardDraft,
  recordVersion,
  resolveThreadEditorState,
  resolveXhsEditorState,
  shouldConfirmDeriveAction,
  summarizeCardPreviews,
  xhsCardDraftSignature,
} from './derive-draft-model.js'
import {
  clearDeriveDraft,
  copyText,
  deleteDerivative,
  dismissXhsError,
  downloadBlob,
  generateDerivative,
  getState,
  loadPortableMarkdown,
  redesignXhsCard,
  saveDerivative,
  setDeriveDraft,
  toast,
  useStudio,
  visibleXhsError,
} from './state.js'
import { renderCardDownload } from './xhs-card-render.js'
import {
  DEFAULT_XHS_TWEAKS,
  FONT_FAMILIES,
  XHS_STYLE_PRESETS,
  buildCardStyleText,
  ensureCardHtml,
  resolveArtboardClassName,
  resolveXhsThemeVars,
  synthesizeCardHtml,
  themeVarsToCssText,
} from './xhs-card-html.js'
import {
  annotateArtboardDom,
  applyDomImageFraming,
  applyElementMutation,
  buildLayerTree,
  readDomImageFraming,
  readElementInspectorState,
  serializeArtboardHtml,
} from './xhs-dom-inspector.js'
import { createZip } from './zip.js'

const SUB_TABS = [
  { id: 'markdown', label: '通用 Markdown' },
  { id: 'thread', label: '串推（即刻 / X）' },
  { id: 'xhs', label: '小红书图文' },
]

const MD_TARGETS = [
  { id: 'blog', label: '通用博客 / Obsidian' },
  { id: 'zhihu', label: '知乎' },
  { id: 'juejin', label: '掘金' },
]

const THREAD_VARIANTS = [
  { id: 'jike', label: '即刻' },
  { id: 'x', label: 'X (Twitter)' },
]

const CARD_KIND_LABELS = {
  cover: '封面',
  compare: '对比',
  steps: '流程',
  metrics: '数据',
  grid: '矩阵',
  list: '清单',
  quote: '金句',
  end: '尾页',
}

const CARD_LINE_HINTS = {
  cover: '支持用 | 分隔副标题，例如：核心亮点 | 一句话说明',
  compare: '支持用 | 分隔对比项与说明，例如：以前手调 | 耗时半小时以上',
  steps: '支持用 | 分隔步骤名与说明，例如：锁定样式表 | 确定主色与字号',
  metrics: '支持用 2 个 | 分隔数字、指标名与说明，例如：30s | 导出耗时 | 缩短 90%',
  grid: '支持用 | 分隔卡片小标题与详情，例如：主题隔离 | 切换配色不改内容',
  list: '支持用 | 分隔加粗关键词与正文，例如：先定主题 | 再导正文与代码块',
  quote: '提炼有力的核心金句，每行不宜过长',
  end: '支持用 | 分隔指令名称与提示，例如：即刻收藏 | 下次写稿直接套用',
}

const DECK_STYLE_OPTIONS = [
  { id: 'tech', label: '冷白科技风' },
  { id: 'editorial', label: '杂志几何风' },
  { id: 'bold', label: '撞色海报风' },
]

async function compressImageFileToDataUrl(file) {
  if (!file) return ''
  if (file.size > 4 * 1024 * 1024) {
    throw new Error('图片文件超过 4MB，请换一张小一点的截图')
  }
  const rawUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
  const img = await loadBrowserImage(rawUrl)
  if (
    /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,/i.test(rawUrl)
    && rawUrl.length <= 750_000
    && img.width <= 1080
    && img.height <= 1440
  ) {
    return rawUrl
  }
  const scale = Math.min(1, 960 / Math.max(1, img.width), 1280 / Math.max(1, img.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(img.width * scale))
  canvas.height = Math.max(1, Math.round(img.height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('浏览器不支持画布压缩')
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  for (const quality of [0.86, 0.72, 0.56]) {
    const out = canvas.toDataURL('image/jpeg', quality)
    if (out.length <= 920_000) return out
  }
  throw new Error('图片压缩后仍过大，请裁剪后重试')
}

const DEFAULT_PALETTE = {
  main: '#C9643E',
  soft: '#FCF6F2',
  tint: '#F7E3D5',
  line: '#DAB196',
  mark: '#FCE7A6',
}

function safeFileBase(title) {
  return String(title || '未命名').replace(/[\\/:*?"<>|\r\n]+/g, '-').trim().slice(0, 60) || '未命名'
}

function MarkdownPanel({ article }) {
  const settingsFixedLines = useStudio(s => s.settings?.fixedLines)
  const stateFixedLines = useStudio(s => s.data?.fixedLines)
  const fixedLines = settingsFixedLines ?? stateFixedLines ?? []

  const [target, setTarget] = React.useState('blog')
  const [result, setResult] = React.useState(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState(null)
  const [retryNonce, setRetryNonce] = React.useState(0)

  const refreshKey = React.useMemo(
    () => buildMarkdownRefreshKey({ article, target, fixedLines }),
    [article, target, fixedLines],
  )

  React.useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    setResult(null)
    loadPortableMarkdown(article.id, target, controller.signal)
      .then(res => {
        if (cancelled) return
        setResult(res)
        setLoading(false)
      })
      .catch(err => {
        if (cancelled || err.name === 'AbortError') return
        setResult(null)
        setError(err.message || '导出通用 Markdown 失败')
        setLoading(false)
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [article.id, target, refreshKey, retryNonce])

  const exportable = canExportMarkdown({ loading, error, result })

  const exportFile = () => {
    if (!exportable) return
    const blob = new Blob([result.markdown], { type: 'text/markdown;charset=utf-8' })
    downloadBlob(blob, `${safeFileBase(result.title || article.title)}-${target}.md`)
    toast('已开始下载 Markdown')
  }

  return (
    <section className="ws-derive-section" aria-label="通用 Markdown 导出">
      <div className="ws-derive-bar">
        <div className="ws-chips" role="group" aria-label="目标平台">
          {MD_TARGETS.map(item => (
            <button key={item.id} type="button" className={target === item.id ? 'is-on' : ''} onClick={() => setTarget(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
        <span className="ws-grow" />
        <button type="button" className="ws-btn" disabled={!exportable} onClick={() => copyText(result.markdown, '已复制通用 Markdown')}>
          复制 Markdown
        </button>
        <button type="button" className="ws-btn is-primary" disabled={!exportable} onClick={exportFile}>
          下载 .md
        </button>
      </div>

      <p className="ws-muted ws-small">
        确定性实时转换，不调用模型：自动剔除固定引导语、公众号高亮/下划线与动画卡围栏（转为可读清单或表格）。
        {target === 'zhihu' ? ' 知乎模式不在正文重复输出一级标题，请粘贴标题到知乎标题栏。' : ''}
      </p>

      {error ? (
        <div className="ws-banner is-error" role="status">
          <span>{error}</span>
          <button type="button" className="ws-btn" onClick={() => setRetryNonce(n => n + 1)}>重试</button>
        </div>
      ) : null}

      {result?.warnings?.length ? (
        <div className="ws-derive-warnings" role="status">
          <strong>导出提醒</strong>
          <ul>
            {result.warnings.map(w => <li key={w}>{w}</li>)}
          </ul>
        </div>
      ) : null}

      {loading ? (
        <div className="ws-derive-empty"><span className="ws-shimmer">正在转换 Markdown…</span></div>
      ) : error ? null : result?.markdown ? (
        <textarea className="ws-derive-md-preview" readOnly value={result.markdown} aria-label="通用 Markdown 预览" />
      ) : (
        <div className="ws-derive-empty"><p className="ws-muted">正文为空，没有可导出的内容。</p></div>
      )}
    </section>
  )
}

function ThreadPanel({ article, pending, onGenerate, onDelete }) {
  const deriveDrafts = useStudio(s => s.deriveDrafts)
  const record = article.derivatives?.find(item => item.platform === 'thread') ?? null
  const draftEntry = deriveDrafts[deriveDraftKey(article.id, 'thread')] ?? null
  const { variant: draftVariant, posts, dirty, baseChanged } = resolveThreadEditorState(record, draftEntry)

  const [targetVariant, setTargetVariant] = React.useState(record?.variant ?? 'jike')
  const versionKey = `${article.id}:${recordVersion(record)}`
  React.useEffect(() => {
    setTargetVariant(record?.variant ?? 'jike')
  }, [versionKey])

  const busy = pending === 'derive/thread' || pending === 'derive/update' || pending === 'derive/delete'
  const archived = Boolean(article.archivedAt)
  const displayVariant = record?.variant ?? draftVariant ?? targetVariant
  const maxLen = displayVariant === 'x' ? DERIVE_LIMITS.thread.x.maxWeighted : DERIVE_LIMITS.thread.jike.maxChars
  const countFn = displayVariant === 'x' ? weightedLength : charCount
  const unitLabel = displayVariant === 'x' ? '加权字' : '字'

  const writeDraftPosts = nextPosts => {
    setDeriveDraft(article.id, 'thread', {
      baseVersion: recordVersion(record),
      variant: record?.variant ?? 'jike',
      payload: { posts: nextPosts },
    })
  }

  const updatePost = (index, text) => {
    writeDraftPosts(posts.map((item, i) => (i === index ? { ...item, text } : item)))
  }

  const addPostAfter = index => {
    if (posts.length >= DERIVE_LIMITS.thread.maxPosts) return
    const next = posts.map(item => ({ ...item }))
    next.splice(index + 1, 0, { text: '', source: [] })
    writeDraftPosts(next)
  }

  const removePost = index => {
    if (posts.length <= DERIVE_LIMITS.thread.minPosts) return
    writeDraftPosts(posts.filter((_, i) => i !== index))
  }

  const handleSave = async () => {
    const ok = await saveDerivative({ id: article.id, platform: 'thread', payload: { posts } })
    if (ok) toast('已保存串推修改')
  }

  return (
    <section className="ws-derive-section" aria-label="串推派生">
      <div className="ws-derive-bar">
        <div className="ws-chips" role="group" aria-label="串推平台">
          {THREAD_VARIANTS.map(item => (
            <button
              key={item.id}
              type="button"
              className={targetVariant === item.id ? 'is-on' : ''}
              disabled={busy}
              onClick={() => setTargetVariant(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <span className="ws-grow" />
        {record ? (
          <>
            <button type="button" className="ws-btn" disabled={busy || !posts.length} onClick={() => copyText(threadClipboardText(posts), '已复制全部串推（带编号）')}>
              复制全部（带 1/n）
            </button>
            {dirty ? (
              <button type="button" className="ws-btn" disabled={busy} onClick={() => clearDeriveDraft(article.id, 'thread')}>
                放弃修改
              </button>
            ) : null}
            <button type="button" className="ws-btn" disabled={busy || archived || !dirty} onClick={handleSave}>
              保存修改
            </button>
            <button type="button" className="ws-btn is-primary" disabled={busy || archived} onClick={() => onGenerate('thread', targetVariant, { dirty, record })}>
              {pending === 'derive/thread' ? '正在派生…（约 30–90 秒）' : targetVariant !== record.variant ? `按 ${THREAD_VARIANTS.find(v => v.id === targetVariant)?.label} 生成` : '重新生成'}
            </button>
            <button type="button" className="ws-btn" disabled={busy || archived} onClick={() => onDelete('thread', { dirty, record })}>
              删除
            </button>
          </>
        ) : null}
      </div>

      {archived ? <div className="ws-banner is-error"><span>归档稿件不能生成或修改派生，请先恢复。</span></div> : null}

      {dirty && baseChanged ? (
        <div className="ws-banner ws-derive-stale" role="status">
          <span>后台串推版本已更新，当前保留着你的未保存草稿。你可以保存覆盖，或放弃本地修改。</span>
          <button type="button" className="ws-btn" disabled={busy} onClick={() => clearDeriveDraft(article.id, 'thread')}>
            放弃本地修改
          </button>
        </div>
      ) : null}

      {record?.stale ? (
        <div className="ws-banner ws-derive-stale" role="status">
          <span>母稿已修改，这份串推可能已过期。</span>
          <button type="button" className="ws-btn" disabled={busy || archived} onClick={() => onGenerate('thread', targetVariant, { dirty, record })}>
            按最新母稿重新生成
          </button>
        </div>
      ) : null}

      {record?.warnings?.length ? (
        <div className="ws-derive-warnings" role="status">
          <strong>✓ 已生成成功 · 质量与事实提醒（可选微调）</strong>
          <ul>
            {record.warnings.map(w => <li key={w}>{w}</li>)}
          </ul>
        </div>
      ) : null}

      {!record ? (
        <div className="ws-derive-empty">
          <p className="ws-muted">从已打磨好的母稿中挑选核心观点，按 {targetVariant === 'x' ? 'X (Twitter) 270 加权字符' : '即刻短动态'} 拆分为 3–15 条可独立阅读的串推。</p>
          <button type="button" className="ws-btn is-primary" disabled={busy || archived} onClick={() => onGenerate('thread', targetVariant, { dirty: false, record: null })}>
            {pending === 'derive/thread' ? '正在派生…（约 30–90 秒）' : '生成串推'}
          </button>
        </div>
      ) : (
        <div className="ws-derive-thread-list">
          {posts.map((post, index) => {
            const count = countFn(post.text)
            const over = count > maxLen
            return (
              <div className="ws-derive-post" key={`${index}-${post.source?.join(',') ?? ''}`}>
                <div className="ws-derive-post-head">
                  <strong>第 {index + 1} / {posts.length} 条</strong>
                  <span className={`ws-derive-count ${over ? 'is-over' : ''}`}>
                    {count} / {maxLen} {unitLabel}
                  </span>
                  <span className="ws-grow" />
                  <button type="button" className="ws-link" onClick={() => copyText(post.text, `已复制第 ${index + 1} 条`)}>复制本条</button>
                  {posts.length < DERIVE_LIMITS.thread.maxPosts ? (
                    <button type="button" className="ws-link" onClick={() => addPostAfter(index)}>+ 下方加一条</button>
                  ) : null}
                  {posts.length > DERIVE_LIMITS.thread.minPosts ? (
                    <button type="button" className="ws-link" onClick={() => removePost(index)}>删除</button>
                  ) : null}
                </div>
                <textarea
                  rows={3}
                  value={post.text}
                  onChange={event => updatePost(index, event.target.value)}
                  aria-label={`第 ${index + 1} 条串推`}
                />
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

const TEXT_STYLE_PRESETS = [
  { id: 'custom', label: '自定义样式' },
  { id: 'display', label: 'Display XL (70px)', fontSize: '70px', fontWeight: '900', lineHeight: '1.18' },
  { id: 'h1', label: 'Heading 1 (56px)', fontSize: '56px', fontWeight: '900', lineHeight: '1.2' },
  { id: 'h2', label: 'Heading 2 (36px)', fontSize: '36px', fontWeight: '900', lineHeight: '1.3' },
  { id: 'h9', label: 'Heading 9 (30px)', fontSize: '30px', fontWeight: '700', lineHeight: '1.35' },
  { id: 'body', label: 'Body (23px)', fontSize: '23px', fontWeight: '500', lineHeight: '1.48' },
  { id: 'caption', label: 'Caption (19px)', fontSize: '19px', fontWeight: '600', lineHeight: '1.4' },
  { id: 'code', label: 'Code Pill (21px)', fontSize: '21px', fontWeight: '700', fontFamily: FONT_FAMILIES.mono },
]

const QUICK_TEXT_COLORS = ['#0A0A0A', '#525263', '#6D3BF2', '#2563EB', '#15803D', '#E11D48', '#C85A32', '#FFFFFF']
const QUICK_FILL_COLORS = ['#FFFFFF', '#F2EEFF', '#F1F1F6', '#EDF3FF', '#E5F7ED', '#FFF1F0', '#160B38', '#1C1E2A']

function renderLayerTreeNodes(node, selectedElId, onSelect, collapsedIds, onToggleCollapse, depth = 0) {
  if (!node) return null
  const hasChildren = Array.isArray(node.children) && node.children.length > 0
  const isCollapsed = hasChildren && collapsedIds.has(node.id)
  const icon = node.kind === 'text' ? 'T' : node.kind === 'image' || node.kind === 'slot' ? '🖼' : '⊞'
  const isSelected = node.id === selectedElId
  return (
    <React.Fragment key={node.id}>
      <div className="ws-cd-tree-row" style={{ paddingLeft: `${4 + depth * 13}px` }}>
        {hasChildren ? (
          <button
            type="button"
            className={`ws-cd-tree-caret${isCollapsed ? ' is-collapsed' : ''}`}
            aria-label={isCollapsed ? '展开子图层' : '折叠子图层'}
            onClick={e => {
              e.stopPropagation()
              onToggleCollapse(node.id)
            }}
          >
            ▾
          </button>
        ) : (
          <span className="ws-cd-tree-caret" />
        )}
        <button
          type="button"
          data-tree-id={node.id}
          className={`ws-cd-tree-node ${isSelected ? 'is-on' : ''}`}
          onClick={() => onSelect(node.id)}
        >
          <span className="ws-cd-tree-icon">{icon}</span>
          <span>{node.label}</span>
        </button>
      </div>
      {hasChildren && !isCollapsed && node.children.map(child =>
        renderLayerTreeNodes(child, selectedElId, onSelect, collapsedIds, onToggleCollapse, depth + 1),
      )}
    </React.Fragment>
  )
}

const DESIGN_PROMPT_CHIPS = [
  { label: '自由发挥（按内容定制）', value: '' },
  { label: '编辑部杂志画报', value: '杂志画报风：克制留白、衬线大标题、不对称双栏与大号金句页' },
  { label: '工程实测报告', value: '工程实测报告风：对照表、指标仪表盘、代码终端窗与紧凑 Bento 矩阵' },
  { label: '工业工具说明书', value: '工业工具说明书风：巨型步骤编号、醒目标签、输入输出公式与规格参数栏' },
  { label: '红笔手账备课本', value: '手账备课本风：笔记线条质感、圈画重点批注、微倾提醒便签与步骤清单' },
  { label: '极简瑞士海报网格', value: '瑞士海报网格风：粗黑分割线、高对比巨型数字与模块化信息块' },
]

function resolveShadowTarget(event, rootEl) {
  const path = event?.nativeEvent?.composedPath?.() || []
  for (const node of path) {
    if (node === rootEl) return rootEl
    if (node && node.nodeType === 1 && rootEl?.contains(node)) {
      return node
    }
  }
  return event?.target || rootEl
}

function XhsArtboardShadow({ html, className, themeVars, styleText, onArtboardReady }) {
  const hostRef = React.useRef(null)
  const onReadyRef = React.useRef(onArtboardReady)
  onReadyRef.current = onArtboardReady

  React.useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    const shadow = host.shadowRoot || host.attachShadow({ mode: 'open' })
    let styleEl = shadow.querySelector('style[data-cd-style="1"]')
    if (!styleEl) {
      styleEl = document.createElement('style')
      styleEl.setAttribute('data-cd-style', '1')
      shadow.appendChild(styleEl)
    }
    if (styleEl.textContent !== styleText) {
      styleEl.textContent = styleText
    }
    let rootEl = shadow.querySelector('div[data-cd-root="1"]')
    if (!rootEl) {
      rootEl = document.createElement('div')
      rootEl.setAttribute('data-cd-root', '1')
      shadow.appendChild(rootEl)
    }
    if (rootEl.className !== className) {
      rootEl.className = className
    }
    const cssVars = themeVarsToCssText(themeVars)
    if (rootEl.style.cssText !== cssVars) {
      rootEl.style.cssText = cssVars
    }
    if (rootEl.dataset.renderedHtml !== html) {
      rootEl.innerHTML = html
      rootEl.dataset.renderedHtml = html
    }
    let balanceSheet = shadow.querySelector('style[data-balance]')
    if (!balanceSheet) {
      balanceSheet = document.createElement('style')
      balanceSheet.dataset.balance = '1'
      shadow.appendChild(balanceSheet)
    }
    const balance = () => balanceXhsArtboard(rootEl, balanceSheet)
    balance()
    rootEl.addEventListener('load', balance, true)
    onReadyRef.current?.(rootEl)
    return () => rootEl.removeEventListener('load', balance, true)
  }, [html, className, themeVars, styleText])

  React.useLayoutEffect(() => () => {
    onReadyRef.current?.(null)
  }, [])

  return <div ref={hostRef} className="ws-cd-shadow-host" />
}

function XhsPanel({ article, brand, pending, onGenerate, onDelete }) {
  const deriveDrafts = useStudio(s => s.deriveDrafts)
  const dismissedXhsErrors = useStudio(s => s.dismissedXhsErrors)
  const modelSupportsImages = useStudio(s => s.data?.modelSupportsImages ?? null)
  const record = article.derivatives?.find(item => item.platform === 'xhs') ?? null
  const draftEntry = deriveDrafts[deriveDraftKey(article.id, 'xhs')] ?? null
  const { draft, dirty, baseChanged } = resolveXhsEditorState(record, draftEntry)

  const [selectedIndex, setSelectedIndex] = React.useState(0)
  const [selectedElId, setSelectedElId] = React.useState('root')
  const [collapsedTreeIds, setCollapsedTreeIds] = React.useState(() => new Set())
  const [tallTree, setTallTree] = React.useState(false)
  const [inspectorTab, setInspectorTab] = React.useState('properties')
  const [inspectorOpen, setInspectorOpen] = React.useState(true)
  const [stageMode, setStageMode] = React.useState('row')
  const [zoom, setZoom] = React.useState(0.18)
  const [pan, setPan] = React.useState({ x: 40, y: 56 })
  const [canvasTool, setCanvasTool] = React.useState('select')
  const [spacePressed, setSpacePressed] = React.useState(false)
  const [isPanning, setIsPanning] = React.useState(false)
  const [promptPopoverOpen, setPromptPopoverOpen] = React.useState(false)
  const [warningsOpen, setWarningsOpen] = React.useState(false)
  const [layerTree, setLayerTree] = React.useState(null)
  const [inspector, setInspector] = React.useState(null)
  const [tagInput, setTagInput] = React.useState('')
  const [coverTagInput, setCoverTagInput] = React.useState('')
  const [designPrompt, setDesignPrompt] = React.useState(draft?.designPrompt || '')
  const [deckRefImages, setDeckRefImages] = React.useState([])
  const [cardPrompt, setCardPrompt] = React.useState('')
  const [cardRefImages, setCardRefImages] = React.useState([])
  const [redesignConfirm, setRedesignConfirm] = React.useState(null)
  const [pendingRedesignOffer, setPendingRedesignOffer] = React.useState(null)
  const [lightboxIndex, setLightboxIndex] = React.useState(null)
  const errorOnExit = React.useMemo(() => ({ articleId: article.id, text: null }), [article.id])
  React.useLayoutEffect(() => {
    errorOnExit.text = article.xhsError
  }, [errorOnExit, article.xhsError])
  const [packing, setPacking] = React.useState(false)
  const [downloadingCard, setDownloadingCard] = React.useState(null)
  const exportingCards = packing || downloadingCard !== null
  const imageInputRef = React.useRef(null)
  const deckRefInputRef = React.useRef(null)
  const cardRefInputRef = React.useRef(null)
  const canvasRef = React.useRef(null)
  const worldRef = React.useRef(null)
  const panRef = React.useRef(pan)
  const zoomRef = React.useRef(zoom)
  const canvasAnimCancelRef = React.useRef(null)
  const panRafRef = React.useRef(0)
  const wheelCommitTimerRef = React.useRef(null)
  const treeWrapRef = React.useRef(null)
  const artboardRefs = React.useRef({})

  panRef.current = pan
  zoomRef.current = zoom

  const { mounted: promptPopoverMounted, closing: promptPopoverClosing } = usePresence(promptPopoverOpen)
  const { mounted: warningsMounted, closing: warningsClosing } = usePresence(Boolean(warningsOpen && record?.warnings?.length))
  const { mounted: redesignConfirmMounted, closing: redesignConfirmClosing, value: activeRedesignConfirm } = usePresenceValue(redesignConfirm)

  const stopCanvasAnim = React.useCallback(() => {
    canvasAnimCancelRef.current?.()
    canvasAnimCancelRef.current = null
  }, [])

  const applyLivePan = React.useCallback((nextX, nextY) => {
    const x = Math.round(nextX)
    const y = Math.round(nextY)
    panRef.current = { x, y }
    if (!panRafRef.current) {
      panRafRef.current = requestAnimationFrame(() => {
        panRafRef.current = 0
        const node = worldRef.current
        if (node) {
          node.style.transform = `translate3d(${panRef.current.x}px, ${panRef.current.y}px, 0)`
        }
      })
    }
  }, [])

  React.useEffect(() => () => {
    stopCanvasAnim()
    cancelAnimationFrame(panRafRef.current)
    clearTimeout(wheelCommitTimerRef.current)
  }, [stopCanvasAnim])

  React.useEffect(() => {
    setSelectedIndex(0)
    setSelectedElId('root')
    setTagInput('')
    setCoverTagInput('')
    setCardPrompt('')
    setDeckRefImages([])
    setCardRefImages([])
    setPromptPopoverOpen(false)
    setWarningsOpen(false)
    setRedesignConfirm(null)
    setPendingRedesignOffer(null)
    setDesignPrompt(record?.payload?.designPrompt || '')
    setLightboxIndex(null)
  }, [article.id])

  React.useEffect(() => () => dismissXhsError(errorOnExit.articleId, errorOnExit.text), [errorOnExit])

  React.useEffect(() => {
    if (record?.payload?.designPrompt !== undefined) {
      setDesignPrompt(record.payload.designPrompt || '')
    }
  }, [record?.createdAt])

  const palette = article.xhsPalette ?? DEFAULT_PALETTE
  const author = brand?.author || ''
  const deckStyle = XHS_DECK_STYLES.includes(draft?.deckStyle) ? draft.deckStyle : 'tech'
  const tweaks = { ...DEFAULT_XHS_TWEAKS, ...(draft?.tweaks || {}) }
  const themeVars = React.useMemo(
    () => resolveXhsThemeVars({ deckStyle, palette, tweaks }),
    [deckStyle, palette, draft?.tweaks],
  )
  const cards = draft?.cards ?? []
  const safeSelected = Math.min(selectedIndex, Math.max(0, cards.length - 1))
  const safeLightbox = lightboxIndex !== null && lightboxIndex >= 0 && lightboxIndex < cards.length ? lightboxIndex : null
  const { mounted: lightboxMounted, closing: lightboxClosing, value: activeLightbox } = usePresenceValue(safeLightbox)
  const lightboxDir = useDirection(activeLightbox ?? 0)
  const lightboxSlideClass = lightboxDir > 0 ? 'ws-slide-next' : lightboxDir < 0 ? 'ws-slide-prev' : 'ws-view-enter'
  const selectedCard = cards[safeSelected] ?? null
  const articleImages = article.articleImages ?? []

  React.useEffect(() => {
    setCoverTagInput('')
    setCardPrompt('')
    setCardRefImages([])
    setSelectedElId('root')
    setCollapsedTreeIds(new Set())
  }, [safeSelected])

  // 当在画布上点选元素时，自动展开其所有祖先节点并将图层树滚动到该行
  React.useEffect(() => {
    if (!selectedElId || selectedElId === 'root') return
    const parts = selectedElId.split('.')
    if (parts.length > 1) {
      setCollapsedTreeIds(prev => {
        let changed = false
        const next = new Set(prev)
        for (let i = 1; i < parts.length; i++) {
          const ancestorId = parts.slice(0, i).join('.')
          if (next.has(ancestorId)) {
            next.delete(ancestorId)
            changed = true
          }
        }
        return changed ? next : prev
      })
    }
    const wrapEl = treeWrapRef.current
    if (wrapEl) {
      const targetBtn = wrapEl.querySelector(`[data-tree-id="${selectedElId}"]`)
      if (targetBtn && typeof targetBtn.scrollIntoView === 'function') {
        targetBtn.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [selectedElId])

  React.useEffect(() => {
    if (safeLightbox === null) return undefined
    const onKeyDown = event => {
      if (event.key === 'Escape') {
        setLightboxIndex(null)
      } else if (event.key === 'ArrowLeft') {
        setLightboxIndex(i => (i !== null && i > 0 ? i - 1 : i))
      } else if (event.key === 'ArrowRight') {
        setLightboxIndex(i => (i !== null && i < cards.length - 1 ? i + 1 : i))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [safeLightbox, cards.length])

  const selectedCardHtml = React.useMemo(() => {
    if (!selectedCard) return ''
    return ensureCardHtml(selectedCard, {
      index: safeSelected,
      total: cards.length,
      author,
      palette,
      deckStyle,
      tweaks,
    })
  }, [selectedCard, safeSelected, cards.length, author, palette, deckStyle, draft?.tweaks])

  // 当选中卡片、选中元素、HTML 或缩放变化时，标注 DOM 并读取计算样式与坐标框
  React.useLayoutEffect(() => {
    const rootEl = artboardRefs.current[safeSelected]
    if (!rootEl) {
      setLayerTree(null)
      setInspector(null)
      return
    }
    annotateArtboardDom(rootEl)
    setLayerTree(buildLayerTree(rootEl))
    setInspector(readElementInspectorState(rootEl, selectedElId))
  }, [safeSelected, selectedElId, selectedCardHtml, selectedCard?.pageCss, draft?.customCss, zoom, stageMode, themeVars])

  const xhsJob = article.xhsJob ?? null
  const xhsError = visibleXhsError(article, dismissedXhsErrors)
  const busy = pending === 'derive/xhs'
    || Boolean(xhsJob)
    || Boolean(pending?.startsWith('derive/xhs/card/'))
    || pending === 'derive/update'
    || pending === 'derive/delete'
    || packing
  const archived = Boolean(article.archivedAt)

  const updateDraft = updater => {
    if (!draft) return
    const next = updater(draft)
    setDeriveDraft(article.id, 'xhs', {
      baseVersion: recordVersion(record),
      payload: next,
    })
  }

  const updateCard = (idx, patch) => {
    updateDraft(prev => ({
      ...prev,
      cards: prev.cards.map((card, i) => (i === idx ? { ...card, ...patch } : card)),
    }))
  }

  const updateTweaks = patch => {
    updateDraft(prev => ({
      ...prev,
      tweaks: { ...DEFAULT_XHS_TWEAKS, ...(prev.tweaks || {}), ...patch },
    }))
  }

  // 配色主题与版式 HTML 完全正交：切换配色仅更新 --xhs-* CSS 变量，绝不覆盖卡片 HTML
  const switchStylePreset = presetId => {
    updateTweaks({ preset: presetId, accent: '', surface: '' })
  }

  const appendRefImages = async (fileList, { max, currentCount, setter, label }) => {
    const files = [...(fileList || [])].filter(Boolean)
    if (!files.length) return
    const remaining = Math.max(0, max - currentCount)
    if (remaining <= 0) {
      toast(`${label}最多上传 ${max} 张参考图，请先移除已有图片`, true)
      return
    }
    const added = []
    for (const file of files.slice(0, remaining)) {
      try {
        const dataUrl = await compressReferenceImageFile(file)
        if (dataUrl) added.push(dataUrl)
      } catch (err) {
        toast(err.message || '参考图处理失败', true)
      }
    }
    if (added.length) {
      setter(prev => [...prev, ...added].slice(0, max))
      if (modelSupportsImages === false) {
        toast(`已添加 ${added.length} 张参考图（当前模型不支持识图，建议切换支持视觉的模型）`)
      } else {
        toast(`已添加 ${added.length} 张${label}参考图`)
      }
    }
  }

  const executeRedesignCard = async (index, customPrompt = '', { saveFirst = false, referenceImages = [] } = {}) => {
    if (busy || archived) return
    let targetServerCard = record?.payload?.cards?.[index] || cards[index]
    let expectedDraftCardHash = xhsCardDraftSignature(draftEntry?.payload?.cards?.[index])
    if (saveFirst && draft) {
      const saved = await saveDerivative({ id: article.id, platform: 'xhs', payload: draft })
      if (!saved) return
      const freshRecord = getState().data?.current?.derivatives?.find(item => item.platform === 'xhs') ?? null
      targetServerCard = freshRecord?.payload?.cards?.[index] || targetServerCard
      expectedDraftCardHash = ''
    }
    if (!targetServerCard) return
    const res = await redesignXhsCard({
      id: article.id,
      cardIndex: index,
      cardPrompt: customPrompt,
      referenceImages,
      baseCardHash: cardContentVersion(targetServerCard),
      expectedDraftCardHash,
    })
    if (res.ok) {
      setSelectedIndex(index)
      setSelectedElId('root')
      setCardPrompt('')
      setCardRefImages([])
      if (res.localChanged && res.card) {
        setPendingRedesignOffer({ index, card: res.card })
        toast(`第 ${index + 1} 页在等待期间有新修改，已保留你的草稿，可在上方选择采用新版`)
      } else {
        setPendingRedesignOffer(prev => (prev?.index === index ? null : prev))
        toast(`已重设计第 ${index + 1} 页卡片（其余页面保持不变）`)
      }
    }
  }

  const handleRedesignCard = async (index, customPrompt = '', referenceImages = []) => {
    const serverCard = record?.payload?.cards?.[index] || cards[index]
    if (!serverCard || busy || archived) return
    if (hasUnsavedXhsCardDraft(record, draftEntry, index)) {
      setRedesignConfirm({ index, cardPrompt: customPrompt, referenceImages })
      return
    }
    await executeRedesignCard(index, customPrompt, { referenceImages })
  }

  const mutateSelectedElement = mutation => {
    const rootEl = artboardRefs.current[safeSelected]
    if (!rootEl) return
    annotateArtboardDom(rootEl)
    const nextHtml = applyElementMutation(rootEl, selectedElId, mutation)
    if (mutation.type === 'delete-element') {
      setSelectedElId('root')
    }
    updateCard(safeSelected, { html: nextHtml })
  }

  const rebuildCardHtml = (idx, overrideCard = null) => {
    const targetCard = overrideCard || cards[idx]
    if (!targetCard) return
    const freshHtml = synthesizeCardHtml(targetCard, {
      index: idx,
      total: cards.length,
      author,
      palette,
      deckStyle,
      tweaks,
    })
    updateCard(idx, { ...(overrideCard || {}), html: freshHtml })
    setSelectedElId('root')
  }

  const rebuildAllCardsHtml = () => {
    if (!cards.length) return
    updateDraft(prev => ({
      ...prev,
      cards: prev.cards.map((card, idx) => ({
        ...card,
        html: synthesizeCardHtml(card, {
          index: idx,
          total: prev.cards.length,
          author,
          palette,
          deckStyle,
          tweaks,
        }),
      })),
    }))
    setSelectedElId('root')
    toast('已按 Claude Design 布局重排全部卡片')
  }

  const addTagsFromInput = () => {
    const tokens = tagInput.split(/[\s,，、#]+/).map(t => t.trim()).filter(Boolean)
    if (!tokens.length) return
    updateDraft(prev => {
      const next = [...prev.tags]
      for (const t of tokens) {
        if (!next.includes(t) && next.length < DERIVE_LIMITS.xhs.tags[1]) next.push(t)
      }
      return { ...prev, tags: next }
    })
    setTagInput('')
  }

  const removeTag = tag => {
    updateDraft(prev => ({ ...prev, tags: prev.tags.filter(t => t !== tag) }))
  }

  const addCoverTagsFromInput = () => {
    if (!selectedCard) return
    const maxCoverTags = DERIVE_LIMITS.xhs.coverTags ?? 4
    const tokens = coverTagInput.split(/[\s,，、#]+/).map(t => t.trim()).filter(Boolean)
    if (!tokens.length) return
    const next = [...(selectedCard.tags ?? [])]
    for (const t of tokens) {
      if (!next.includes(t) && next.length < maxCoverTags) next.push(t)
    }
    const nextCard = { ...selectedCard, tags: next }
    rebuildCardHtml(safeSelected, nextCard)
    setCoverTagInput('')
  }

  const applyImageToCard = (imageUrl, caption = '') => {
    const rootEl = artboardRefs.current[safeSelected]
    const framing = selectedCard?.imageFraming || inspector?.imageFraming || undefined
    if (rootEl) {
      annotateArtboardDom(rootEl)
      const nextHtml = applyElementMutation(rootEl, selectedElId, {
        type: 'set-image',
        src: imageUrl,
        caption: caption || selectedCard?.heading || '实拍配图',
        framing,
      })
      updateCard(safeSelected, { imageUrl, html: nextHtml })
    } else {
      const nextCard = { ...selectedCard, imageUrl }
      rebuildCardHtml(safeSelected, nextCard)
    }
  }

  const updateCardImageFraming = patch => {
    if (!selectedCard) return
    const baseFraming = inspector?.imageFraming || selectedCard.imageFraming || {
      fit: 'cover',
      posX: 50,
      posY: 50,
      zoom: 100,
      panX: 0,
      panY: 0,
    }
    const nextFraming = { ...baseFraming, ...patch }
    const rootEl = artboardRefs.current[safeSelected]
    if (rootEl) {
      annotateArtboardDom(rootEl)
      const nextHtml = applyElementMutation(rootEl, selectedElId, {
        type: 'image-framing',
        framing: nextFraming,
      })
      updateCard(safeSelected, { imageFraming: nextFraming, html: nextHtml })
    } else {
      rebuildCardHtml(safeSelected, { ...selectedCard, imageFraming: nextFraming })
    }
  }

  const handleViewportMouseDown = (index, event) => {
    if (event.button !== 0 || canvasTool === 'hand' || spacePressed) return
    const rootEl = artboardRefs.current[index]
    if (!rootEl) return
    const realTarget = resolveShadowTarget(event, rootEl)
    const imgEl = realTarget?.tagName === 'IMG' ? realTarget : null
    if (!imgEl) return

    event.preventDefault()
    if (index !== safeSelected) {
      setSelectedIndex(index)
    }
    annotateArtboardDom(rootEl)
    const cdId = imgEl.getAttribute('data-cd-id') || 'root'
    setSelectedElId(cdId)
    if (inspectorTab === 'notes') {
      setInspectorTab('properties')
    }

    const startX = event.clientX
    const startY = event.clientY
    const startFraming = readDomImageFraming(imgEl) || {
      fit: 'cover',
      posX: 50,
      posY: 50,
      zoom: 100,
      panX: 0,
      panY: 0,
    }
    const imgRect = imgEl.getBoundingClientRect()
    let latestFraming = startFraming
    let moved = false

    const onMouseMove = moveEv => {
      const dx = moveEv.clientX - startX
      const dy = moveEv.clientY - startY
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2 && !moved) return
      moved = true

      // 往左拖（dx < 0）时，焦点 X 增大（向 100% 移动），从而把图片往左拉、露出右侧人物
      const pctDeltaX = Math.round((-dx / Math.max(80, imgRect.width)) * 100)
      const pctDeltaY = Math.round((-dy / Math.max(80, imgRect.height)) * 100)
      const rawPosX = startFraming.posX + pctDeltaX
      const rawPosY = startFraming.posY + pctDeltaY

      if (startFraming.fit === 'cover' && startFraming.zoom === 100 && startFraming.panX === 0 && startFraming.panY === 0) {
        latestFraming = {
          ...startFraming,
          posX: Math.max(0, Math.min(100, rawPosX)),
          posY: Math.max(0, Math.min(100, rawPosY)),
        }
      } else {
        const artDx = Math.round(dx / Math.max(0.15, zoom))
        const artDy = Math.round(dy / Math.max(0.15, zoom))
        latestFraming = {
          ...startFraming,
          panX: Math.max(-400, Math.min(400, startFraming.panX + artDx)),
          panY: Math.max(-400, Math.min(400, startFraming.panY + artDy)),
        }
      }
      applyDomImageFraming(imgEl, latestFraming)
    }

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      if (!moved) return
      const nextHtml = serializeArtboardHtml(rootEl)
      updateCard(index, { imageFraming: latestFraming, html: nextHtml })
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  const handleLocalImageSelect = async event => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const dataUrl = await compressImageFileToDataUrl(file)
      if (dataUrl) {
        applyImageToCard(dataUrl, file.name.replace(/\.[^.]+$/, ''))
        toast('已将截图嵌入当前卡片画布')
      }
    } catch (err) {
      toast(err.message || '图片处理失败', true)
    }
  }

  const handleSave = async () => {
    if (!draft) return
    const ok = await saveDerivative({ id: article.id, platform: 'xhs', payload: draft })
    if (ok) toast('已保存小红书修改')
  }

  const downloadOneCard = async index => {
    const card = cards[index]
    if (!card || exportingCards) return
    setDownloadingCard(index)
    try {
      const { blob, extension } = await renderCardDownload(card, {
        index,
        total: cards.length,
        palette,
        author,
        deckStyle,
        tweaks,
        customCss: draft?.customCss || '',
      })
      const num = String(index + 1).padStart(2, '0')
      downloadBlob(blob, `${safeFileBase(draft.title || article.title)}-${num}.${extension}`)
    } catch (err) {
      toast(err.message || '导出图片失败', true)
    } finally {
      setDownloadingCard(null)
    }
  }

  const downloadAllZip = async () => {
    if (!cards.length || exportingCards) return
    setPacking(true)
    try {
      const base = safeFileBase(draft.title || article.title)
      const files = []
      for (let i = 0; i < cards.length; i++) {
        const { blob, extension } = await renderCardDownload(cards[i], {
          index: i,
          total: cards.length,
          palette,
          author,
          deckStyle,
          tweaks,
          customCss: draft?.customCss || '',
        })
        const data = new Uint8Array(await blob.arrayBuffer())
        files.push({ name: `${base}-${String(i + 1).padStart(2, '0')}.${extension}`, data })
      }
      const zipBytes = createZip(files)
      downloadBlob(new Blob([zipBytes], { type: 'application/zip' }), `${base}-小红书卡片.zip`)
      toast(`已打包 ${files.length} 张卡片`)
    } catch (err) {
      toast(err.message || '打包卡片失败', true)
    } finally {
      setPacking(false)
    }
  }

  const titleCount = charCount(draft?.title ?? '')
  const bodyCount = charCount(draft?.body ?? '')
  const baseKinds = safeSelected === 0
    ? ['cover']
    : safeSelected === cards.length - 1
      ? XHS_CARD_KINDS.filter(k => k !== 'cover')
      : XHS_CARD_KINDS.filter(k => k !== 'cover' && k !== 'end')
  const kindOptions = selectedCard && !baseKinds.includes(selectedCard.kind)
    ? [selectedCard.kind, ...baseKinds]
    : baseKinds
  const badgeMax = DERIVE_LIMITS.xhs.badge ?? 20
  const accentMax = DERIVE_LIMITS.xhs.accent ?? 24
  const calloutMax = DERIVE_LIMITS.xhs.callout ?? 48
  const coverTagMax = DERIVE_LIMITS.xhs.coverTags ?? 4
  const isCardPendingAt = (index, card) => Boolean(
    xhsJob
    && xhsJob.stage === 'designing'
    && !card?.html
    && !(xhsJob.completedCards || []).includes(index),
  )
  const lightboxCard = activeLightbox !== null ? cards[activeLightbox] : null
  const lightboxPending = activeLightbox !== null && lightboxCard ? isCardPendingAt(activeLightbox, lightboxCard) : false
  const visibleIndexes = stageMode === 'focus' ? [safeSelected] : cards.map((_, i) => i)
  const gridCols = cards.length <= 3 ? Math.max(1, cards.length) : Math.min(4, cards.length)
  const stageGap = stageMode === 'row' && zoom < 0.2 ? 14 : 18

  const animateCanvasTo = React.useCallback((nextZoom, nextPan, animate = false) => {
    stopCanvasAnim()
    const targetZ = Math.round(nextZoom * 100) / 100
    const targetX = Math.round(nextPan.x)
    const targetY = Math.round(nextPan.y)
    if (!animate) {
      zoomRef.current = targetZ
      panRef.current = { x: targetX, y: targetY }
      setZoom(targetZ)
      setPan({ x: targetX, y: targetY })
      return
    }
    const from = { x: panRef.current.x, y: panRef.current.y, zoom: zoomRef.current }
    const to = { x: targetX, y: targetY, zoom: targetZ }
    if (Math.abs(from.x - to.x) < 1 && Math.abs(from.y - to.y) < 1 && Math.abs(from.zoom - to.zoom) < 0.005) {
      setZoom(targetZ)
      setPan({ x: targetX, y: targetY })
      return
    }
    canvasAnimCancelRef.current = animateValues({
      from,
      to,
      onUpdate: frame => {
        const z = Math.round(frame.zoom * 1000) / 1000
        const x = Math.round(frame.x)
        const y = Math.round(frame.y)
        zoomRef.current = z
        panRef.current = { x, y }
        setZoom(z)
        setPan({ x, y })
      },
      onComplete: () => {
        canvasAnimCancelRef.current = null
        zoomRef.current = targetZ
        panRef.current = { x: targetX, y: targetY }
        setZoom(targetZ)
        setPan({ x: targetX, y: targetY })
      },
    })
  }, [stopCanvasAnim])

  const stageModeRef = React.useRef(stageMode)
  stageModeRef.current = stageMode

  const fitCanvas = React.useCallback((modeOverride = stageModeRef.current, countOverride = null, { animate = true } = {}) => {
    const el = canvasRef.current
    const cw = el?.clientWidth || 960
    const ch = el?.clientHeight || 700
    const padX = 40
    const padTop = 56
    const padBottom = 84
    const availW = Math.max(240, cw - padX * 2)
    const availH = Math.max(220, ch - padTop - padBottom)
    const totalCount = countOverride ?? (modeOverride === 'focus' ? 1 : Math.max(1, cards.length || 3))
    const clampZoom = (v, min, max) => Math.round(Math.max(min, Math.min(max, v)) * 100) / 100

    let nextZoom = 0.22
    let totalW = 0
    let totalH = 0
    if (modeOverride === 'focus') {
      nextZoom = clampZoom(Math.min(availW / 1080, (availH - 64) / 1440, 0.54), 0.22, 0.65)
      totalW = Math.round(1080 * nextZoom)
      totalH = 34 + 26 + Math.round(1440 * nextZoom)
    } else if (modeOverride === 'grid') {
      const cols = totalCount <= 3 ? totalCount : Math.min(4, totalCount)
      const rows = Math.ceil(totalCount / cols)
      const gap = 20
      const zW = (availW - Math.max(0, cols - 1) * gap) / (cols * 1080)
      const zH = (availH - 34 - rows * 26 - Math.max(0, rows - 1) * gap) / (rows * 1440)
      nextZoom = clampZoom(Math.min(zW, zH, 0.3), 0.14, 0.36)
      totalW = cols * Math.round(1080 * nextZoom) + Math.max(0, cols - 1) * gap
      totalH = 34 + rows * (26 + Math.round(1440 * nextZoom)) + Math.max(0, rows - 1) * gap
    } else {
      const gap = totalCount >= 6 ? 14 : 18
      const zW = (availW - Math.max(0, totalCount - 1) * gap) / (totalCount * 1080)
      const zH = (availH - 64) / 1440
      nextZoom = clampZoom(Math.min(zW, zH, 0.34), 0.11, 0.52)
      totalW = totalCount * Math.round(1080 * nextZoom) + Math.max(0, totalCount - 1) * gap
      totalH = 34 + 26 + Math.round(1440 * nextZoom)
    }
    const nextX = Math.max(24, Math.round((cw - totalW) / 2))
    const nextY = Math.max(padTop, Math.round(padTop + (availH - totalH) / 2))
    animateCanvasTo(nextZoom, { x: nextX, y: nextY }, animate)
  }, [cards.length, animateCanvasTo])

  const zoomAroundPoint = React.useCallback((rawNextZoom, clientPoint = null, { animate = false } = {}) => {
    const prevZ = zoomRef.current
    const nextZ = Math.round(Math.max(0.1, Math.min(1.2, rawNextZoom)) * 100) / 100
    if (nextZ === prevZ) return
    const el = canvasRef.current
    const rect = el?.getBoundingClientRect()
    const cx = clientPoint && rect ? clientPoint.x - rect.left : (rect ? rect.width / 2 : 480)
    const cy = clientPoint && rect ? clientPoint.y - rect.top : (rect ? rect.height / 2 : 340)
    const prevPan = panRef.current
    const ratio = nextZ / Math.max(0.05, prevZ)
    animateCanvasTo(nextZ, {
      x: Math.round(cx - (cx - prevPan.x) * ratio),
      y: Math.round(cy - (cy - prevPan.y) * ratio),
    }, animate)
  }, [animateCanvasTo])

  // 首次加载卡片或切换稿件时自动适配画布居中（不打断手动切换单行/网格/单页的丝滑缩放）
  const fitKey = `${article.id}:${cards.length > 0 ? cards.length : (xhsJob ? 'job' : 'empty')}`
  React.useLayoutEffect(() => {
    if (!cards.length && !xhsJob) return
    const raf = window.requestAnimationFrame(() => {
      fitCanvas(stageModeRef.current, cards.length || 3, { animate: false })
    })
    return () => window.cancelAnimationFrame(raf)
  }, [fitKey, fitCanvas])

  // 绑定非 passive 滚轮事件：双指滑动直接 rAF 跟手平移，双指捏合 / Ctrl(Cmd)+滚轮 围绕光标平滑缩放
  React.useEffect(() => {
    const el = canvasRef.current
    if (!el) return undefined
    const onWheel = event => {
      if (event.target?.closest?.('.ws-cd-hud-scrollable')) return
      if (!record && !xhsJob) return
      event.preventDefault()
      stopCanvasAnim()
      if (event.ctrlKey || event.metaKey) {
        const factor = Math.exp(-event.deltaY * 0.008)
        zoomAroundPoint(zoomRef.current * factor, { x: event.clientX, y: event.clientY }, { animate: false })
      } else {
        applyLivePan(panRef.current.x - event.deltaX, panRef.current.y - event.deltaY)
        clearTimeout(wheelCommitTimerRef.current)
        wheelCommitTimerRef.current = setTimeout(() => {
          setPan({ ...panRef.current })
        }, 120)
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [record, xhsJob, zoomAroundPoint, stopCanvasAnim, applyLivePan])

  // 快捷键：按住 Space 临时抓手平移，V 选择，H 抓手，+/- 缩放，0 适配画布
  React.useEffect(() => {
    const isTypingTarget = target => Boolean(
      target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable),
    )
    const onKeyDown = event => {
      if (safeLightbox !== null || isTypingTarget(event.target)) return
      if (event.code === 'Space' && !event.repeat) {
        event.preventDefault()
        setSpacePressed(true)
      } else if (!event.metaKey && !event.ctrlKey && !event.altKey) {
        if (event.key === 'v' || event.key === 'V') setCanvasTool('select')
        else if (event.key === 'h' || event.key === 'H') setCanvasTool('hand')
        else if (event.key === '=' || event.key === '+') {
          event.preventDefault()
          zoomAroundPoint(zoomRef.current + 0.05, null, { animate: true })
        } else if (event.key === '-') {
          event.preventDefault()
          zoomAroundPoint(zoomRef.current - 0.05, null, { animate: true })
        } else if (event.key === '0') {
          event.preventDefault()
          fitCanvas(stageMode, null, { animate: true })
        }
      }
    }
    const onKeyUp = event => {
      if (event.code === 'Space') setSpacePressed(false)
    }
    const onBlur = () => setSpacePressed(false)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [safeLightbox, stageMode, fitCanvas, zoomAroundPoint])

  const handleCanvasMouseDown = event => {
    if (!record && !xhsJob) return
    if (event.target?.closest?.('.ws-cd-hud')) return
    const isHand = canvasTool === 'hand' || spacePressed
    const onEmptyBg = !event.target?.closest?.('.ws-cd-viewport, .ws-cd-card-head, button, input, select, textarea, a')
    const shouldPan = event.button === 1 || (event.button === 0 && (isHand || onEmptyBg))
    if (!shouldPan) return

    event.preventDefault()
    stopCanvasAnim()
    setIsPanning(true)
    const startX = event.clientX
    const startY = event.clientY
    const startPan = { ...panRef.current }

    const onMove = moveEv => {
      applyLivePan(startPan.x + (moveEv.clientX - startX), startPan.y + (moveEv.clientY - startY))
    }
    const onUp = () => {
      setIsPanning(false)
      setPan({ ...panRef.current })
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const switchStageMode = nextMode => {
    setStageMode(nextMode)
    fitCanvas(nextMode, nextMode === 'focus' ? 1 : cards.length, { animate: true })
  }

  const zoomPresets = [0.14, 0.18, 0.22, 0.26, 0.32, 0.45, 0.6, 0.8, 1]
  const roundedZoom = Math.round(zoom * 100) / 100
  const zoomOptions = zoomPresets.some(v => Math.abs(v - roundedZoom) < 0.005)
    ? zoomPresets
    : [...zoomPresets, roundedZoom].sort((a, b) => a - b)

  const renderPromptBar = ({ showRegenerate = false } = {}) => (
    <div className="ws-cd-prompt-bar" aria-label="视觉设计想法">
      <div className="ws-cd-prompt-row">
        <span className="ws-cd-prompt-label">设计想法（可选）</span>
        <input
          type="text"
          className="ws-cd-prompt-input"
          maxLength={DERIVE_LIMITS.xhs.designPrompt}
          placeholder="留空则按文章内容自由定制风格；可输入视觉想法，或直接粘贴/上传参考图…"
          value={designPrompt}
          disabled={busy || archived}
          onChange={e => setDesignPrompt(e.target.value)}
          onPaste={event => {
            const files = extractClipboardImageFiles(event)
            if (files.length) {
              event.preventDefault()
              void appendRefImages(files, { max: DERIVE_LIMITS.xhs.referenceImages, currentCount: deckRefImages.length, setter: setDeckRefImages, label: '整套设计' })
            }
          }}
        />
        <input
          ref={deckRefInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          hidden
          onChange={event => {
            const files = event.target.files
            void appendRefImages(files, { max: DERIVE_LIMITS.xhs.referenceImages, currentCount: deckRefImages.length, setter: setDeckRefImages, label: '整套设计' })
            event.target.value = ''
          }}
        />
        <button
          type="button"
          className="ws-btn"
          style={{ fontSize: '12px', padding: '5px 10px', whiteSpace: 'nowrap' }}
          disabled={busy || archived || deckRefImages.length >= DERIVE_LIMITS.xhs.referenceImages}
          onClick={() => deckRefInputRef.current?.click()}
          title={`上传视觉参考图（最多 ${DERIVE_LIMITS.xhs.referenceImages} 张，也可在输入框内直接粘贴截图）`}
        >
          🖼 参考图 ({deckRefImages.length}/{DERIVE_LIMITS.xhs.referenceImages})
        </button>
        {designPrompt ? (
          <button type="button" className="ws-link" disabled={busy} onClick={() => setDesignPrompt('')}>
            清空
          </button>
        ) : null}
      </div>
      <span className="ws-cd-vision-hint">
        最多上传 {DERIVE_LIMITS.xhs.referenceImages} 张。模型会自动识别封面与内容版式并按页参考；参考图可复用，未分配页面将自由设计。
      </span>
      {deckRefImages.length > 0 ? (
        <div className="ws-cd-ref-strip" aria-label="已上传的整套设计参考图">
          {deckRefImages.map((src, idx) => (
            <div key={`${idx}-${src.slice(-16)}`} className="ws-cd-ref-thumb">
              <img src={src} alt={`参考图 ${idx + 1}`} />
              <button
                type="button"
                className="ws-cd-ref-remove"
                aria-label={`移除第 ${idx + 1} 张参考图`}
                disabled={busy}
                onClick={() => setDeckRefImages(prev => prev.filter((_, i) => i !== idx))}
              >
                ×
              </button>
            </div>
          ))}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 }}>
            <span className={`ws-cd-vision-hint ${modelSupportsImages === false ? 'is-warn' : modelSupportsImages === true ? 'is-ok' : ''}`}>
              {modelSupportsImages === false
                ? '⚠ 当前模型不支持识图，生成时将自动忽略参考图（请切换支持视觉的模型）'
                : modelSupportsImages === true
                  ? '✓ 当前模型支持识图：将模仿参考图的版式构图与视觉气质（保留原文事实与可换肤变量）'
                  : '已附带参考图：支持识图的模型将按此风格设计（若当前模型不支持识图会自动降级为纯文本）'}
            </span>
            <button
              type="button"
              className="ws-link"
              style={{ fontSize: '11.5px', alignSelf: 'flex-start' }}
              disabled={busy}
              onClick={() => setDeckRefImages([])}
            >
              清空参考图
            </button>
          </div>
        </div>
      ) : null}
      <div className="ws-cd-prompt-chips">
        {DESIGN_PROMPT_CHIPS.map(chip => {
          const active = designPrompt.trim() === chip.value
          return (
            <button
              key={chip.label}
              type="button"
              className={`ws-cd-prompt-chip ${active ? 'is-on' : ''}`}
              disabled={busy || archived}
              onClick={() => setDesignPrompt(chip.value)}
            >
              {chip.label}
            </button>
          )
        })}
        {showRegenerate ? (
          <>
            <span className="ws-grow" />
            <button
              type="button"
              className="ws-btn is-primary"
              style={{ fontSize: '12px', padding: '5px 12px' }}
              disabled={busy || archived}
              onClick={() => {
                setPromptPopoverOpen(false)
                onGenerate('xhs', undefined, { dirty, record, designPrompt, referenceImages: deckRefImages })
              }}
            >
              ✨ 按此想法重新生成
            </button>
          </>
        ) : null}
      </div>
    </div>
  )

  return (
    <section className="ws-xhs-studio" aria-label="小红书图文派生">
      <div className="ws-xhs-studio-main">
        {record && draft ? (
          <div className="ws-cd-topbar ws-derive-bar">
            <div className="ws-chips" role="group" aria-label="画布视图模式">
              <button
                type="button"
                className={stageMode === 'row' ? 'is-on' : ''}
                onClick={() => switchStageMode('row')}
              >
                单行 ({cards.length})
              </button>
              <button
                type="button"
                className={stageMode === 'grid' ? 'is-on' : ''}
                onClick={() => switchStageMode('grid')}
              >
                网格
              </button>
              <button
                type="button"
                className={stageMode === 'focus' ? 'is-on' : ''}
                onClick={() => switchStageMode('focus')}
              >
                单页 ({safeSelected + 1})
              </button>
            </div>

            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <span className="ws-muted">配色</span>
              <select
                aria-label="全局配色主题"
                value={tweaks.preset || 'claude'}
                onChange={e => switchStylePreset(e.target.value)}
              >
                {XHS_STYLE_PRESETS.map(p => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </label>

            {record?.warnings?.length ? (
              <button
                type="button"
                className="ws-cd-warn-pill"
                aria-expanded={warningsOpen}
                onClick={() => setWarningsOpen(v => !v)}
              >
                ⚠ 建议 ({record.warnings.length})
              </button>
            ) : null}

            <span className="ws-grow" />

            <button type="button" className="ws-btn" disabled={busy} onClick={() => copyText(xhsClipboardText(draft), '已复制小红书标题、正文与标签')}>
              复制文案
            </button>
            <button type="button" className="ws-btn" aria-label="下载全部卡片（.zip）" disabled={busy || exportingCards} onClick={downloadAllZip}>
              {packing ? '打包中…' : '导出 .zip'}
            </button>
            {dirty ? (
              <button type="button" className="ws-btn" disabled={busy} onClick={() => clearDeriveDraft(article.id, 'xhs')}>
                放弃
              </button>
            ) : null}
            <button type="button" className="ws-btn" disabled={busy || archived || !dirty} onClick={handleSave}>
              保存
            </button>
            <button type="button" className="ws-btn is-primary" disabled={busy || archived} onClick={() => onGenerate('xhs', undefined, { dirty, record, designPrompt, referenceImages: deckRefImages })}>
              {xhsJob || pending === 'derive/xhs'
                ? (xhsJob?.totalCards ? `精绘 ${xhsJob.completedCards?.length || 0}/${xhsJob.totalCards}…` : '设计中…')
                : '重新生成'}
            </button>
            <button type="button" className="ws-btn" disabled={busy || archived} onClick={() => onDelete('xhs', { dirty, record })}>
              删除
            </button>
            {!inspectorOpen ? (
              <button type="button" className="ws-btn" onClick={() => setInspectorOpen(true)}>
                展开属性面板
              </button>
            ) : null}
          </div>
        ) : null}

        <div
          ref={canvasRef}
          className={`ws-cd-canvas ${(canvasTool === 'hand' || spacePressed) ? 'is-hand' : ''} ${isPanning ? 'is-panning' : ''}`}
          aria-label="小红书自由设计画布"
          onMouseDown={handleCanvasMouseDown}
        >
          {/* 悬浮通知栈（进度条、冲突提示、排版建议弹层等，不挤压画布空间） */}
          {(archived || pendingRedesignOffer || (dirty && baseChanged && !pendingRedesignOffer) || record?.stale || (xhsError && !xhsJob) || xhsJob || warningsMounted) ? (
            <div className="ws-cd-canvas-notices ws-cd-hud">
              {archived ? <div className="ws-banner is-error"><span>归档稿件不能生成或修改派生，请先恢复。</span></div> : null}

              {pendingRedesignOffer ? (
                <div className="ws-banner ws-derive-stale" role="status">
                  <span>第 {pendingRedesignOffer.index + 1} 页在重设计期间你继续做了本地编辑，系统已保留你的当前草稿。</span>
                  <div style={{ display: 'inline-flex', gap: '8px', flex: 'none' }}>
                    <button
                      type="button"
                      className="ws-btn is-primary"
                      disabled={busy}
                      onClick={() => {
                        const offer = pendingRedesignOffer
                        setPendingRedesignOffer(null)
                        updateCard(offer.index, offer.card)
                        setSelectedIndex(offer.index)
                        setSelectedElId('root')
                        toast(`已采用第 ${offer.index + 1} 页的新版重设计`)
                      }}
                    >
                      采用新版重设计
                    </button>
                    <button
                      type="button"
                      className="ws-btn"
                      disabled={busy}
                      onClick={() => setPendingRedesignOffer(null)}
                    >
                      保留当前草稿
                    </button>
                  </div>
                </div>
              ) : null}

              {dirty && baseChanged && !pendingRedesignOffer ? (
                <div className="ws-banner ws-derive-stale" role="status">
                  <span>后台小红书内容已更新，当前保留着你的未保存草稿。</span>
                  <button type="button" className="ws-btn" disabled={busy} onClick={() => clearDeriveDraft(article.id, 'xhs')}>
                    放弃本地修改
                  </button>
                </div>
              ) : null}

              {record?.stale ? (
                <div className="ws-banner ws-derive-stale" role="status">
                  <span>母稿已修改，这份小红书笔记可能已过期。</span>
                  <button type="button" className="ws-btn" disabled={busy || archived} onClick={() => onGenerate('xhs', undefined, { dirty, record, designPrompt, referenceImages: deckRefImages })}>
                    按最新母稿重新生成
                  </button>
                </div>
              ) : null}

              {xhsError && !xhsJob ? (
                <div className="ws-banner is-error" role="status">
                  <span>{xhsError}</span>
                  <button type="button" className="ws-cd-icon-btn" aria-label="关闭错误提示" onClick={() => dismissXhsError(article.id, xhsError)}>×</button>
                </div>
              ) : null}

              {xhsJob ? (
                <div className="ws-cd-progress-banner" role="status" aria-live="polite">
                  <div className="ws-cd-progress-head">
                    <strong>✨ {xhsJob.message || '正在设计小红书卡片…'}</strong>
                    <span className="ws-muted">
                      {xhsJob.totalCards > 0
                        ? `${xhsJob.completedCards?.length || 0} / ${xhsJob.totalCards} 页已完成`
                        : '阶段 1 / 2 · 策划版式蓝图'}
                    </span>
                  </div>
                  <div className="ws-cd-progress-track">
                    <div
                      className={`ws-cd-progress-fill ${xhsJob.totalCards > 0 ? '' : 'is-indeterminate'}`}
                      style={xhsJob.totalCards > 0
                        ? { width: `${Math.max(8, Math.round(((xhsJob.completedCards?.length || 0) / xhsJob.totalCards) * 100))}%` }
                        : undefined}
                    />
                  </div>
                </div>
              ) : null}

              {warningsMounted && record?.warnings?.length ? (
                <div className={`ws-cd-warnings-popover ws-cd-hud-scrollable${warningsClosing ? ' is-closing' : ''}`} role="status">
                  <div className="ws-cd-warnings-head">
                    <span>✓ 已生成成功 · 排版微调建议（可选，不影响导出）</span>
                    <button type="button" className="ws-cd-icon-btn" aria-label="关闭建议" onClick={() => setWarningsOpen(false)}>×</button>
                  </div>
                  <ul>
                    {record.warnings.map(w => {
                      const pageMatch = /第\s*(\d+)\s*页/.exec(w)
                      const pageIdx = pageMatch ? Number(pageMatch[1]) - 1 : -1
                      return (
                        <li key={w} style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <span>{w}</span>
                          {pageIdx >= 0 && pageIdx < cards.length ? (
                            <button
                              type="button"
                              className="ws-link"
                              style={{ fontSize: '11.5px' }}
                              onClick={() => {
                                setSelectedIndex(pageIdx)
                                setInspectorTab('properties')
                                setInspectorOpen(true)
                                setWarningsOpen(false)
                              }}
                            >
                              定位到第 {pageIdx + 1} 页 →
                            </button>
                          ) : null}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          {!record || !draft ? (
            xhsJob ? (
              <div
                ref={worldRef}
                className="ws-cd-canvas-world"
                style={{ transform: `translate3d(${pan.x}px, ${pan.y}px, 0)` }}
              >
                <div className="ws-cd-deck-label">
                  <strong>✨ 正在规划整套小红书视觉画布…</strong>
                </div>
                <div className="ws-cd-artboard-stage is-row" aria-label="小红书卡片规划中">
                  {[0, 1, 2].map(idx => {
                    const scaledW = Math.round(1080 * zoom)
                    const scaledH = Math.round(1440 * zoom)
                    return (
                      <div key={idx} className="ws-cd-card-unit" style={{ width: `${scaledW}px` }}>
                        <div className="ws-cd-card-head">
                          <span className="ws-cd-card-title">0{idx + 1} · 规划中</span>
                        </div>
                        <div className="ws-cd-skeleton-card" style={{ width: `${scaledW}px`, height: `${scaledH}px` }}>
                          <div className="ws-cd-skel-line is-short" />
                          <div className="ws-cd-skel-line is-title" />
                          <div className="ws-cd-skel-block" />
                          <div className="ws-cd-skel-status">✨ 正在策划版式蓝图…</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : (
              <div className="ws-cd-empty-canvas">
                <div className="ws-cd-empty-card">
                  <div className="ws-cd-empty-card-head">
                    <h3>小红书自由设计画布（1080×1440）</h3>
                    <p className="ws-muted ws-small">
                      像 Claude Design 一样在无限画布上自由缩放、拖拽浏览整套卡片。按文章内容、设计想法或参考图量身定制每页互不重样的 HTML/CSS 版式。
                    </p>
                  </div>
                  {renderPromptBar({ showRegenerate: false })}
                  <div className="ws-cd-empty-card-foot">
                    <span className="ws-muted ws-small">支持随时换肤、单页重设计与右侧 Properties / Code / Tweaks 精修</span>
                    <button
                      type="button"
                      className="ws-btn is-primary"
                      disabled={busy || archived}
                      onClick={() => onGenerate('xhs', undefined, { dirty: false, record: null, designPrompt, referenceImages: deckRefImages })}
                    >
                      {pending === 'derive/xhs' ? '正在启动设计…' : '✨ 生成小红书图文'}
                    </button>
                  </div>
                </div>
              </div>
            )
          ) : (
            <>
              {/* 右上角悬浮缩放胶囊 */}
              <div className="ws-cd-zoom-pill ws-cd-hud" aria-label="画布缩放控制">
                <button
                  type="button"
                  data-tip="缩小画布 (-)"
                  data-tip-pos="bottom"
                  aria-label="缩小画布"
                  onClick={() => zoomAroundPoint(zoomRef.current - 0.04, null, { animate: true })}
                >
                  −
                </button>
                <select
                  aria-label="画布缩放比例"
                  value={String(Math.round(zoom * 100) / 100)}
                  onChange={e => zoomAroundPoint(Number(e.target.value), null, { animate: true })}
                >
                  {zoomOptions.map(v => (
                    <option key={v} value={String(v)}>{Math.round(v * 100)}%</option>
                  ))}
                </select>
                <button
                  type="button"
                  data-tip="放大画布 (+)"
                  data-tip-pos="bottom"
                  aria-label="放大画布"
                  onClick={() => zoomAroundPoint(zoomRef.current + 0.04, null, { animate: true })}
                >
                  +
                </button>
                <span className="ws-cd-zoom-divider" />
                <button
                  type="button"
                  data-tip="居中适配全览 (0)"
                  data-tip-pos="bottom-end"
                  onClick={() => fitCanvas(stageMode, null, { animate: true })}
                >
                  适配
                </button>
              </div>

              {/* 可自由平移的无限画布世界 */}
              <div
                ref={worldRef}
                className="ws-cd-canvas-world"
                style={{ transform: `translate3d(${pan.x}px, ${pan.y}px, 0)` }}
              >
                <div className="ws-cd-deck-label">
                  <strong>{draft.title || article.title || '小红书画布'}</strong>
                  <span>共 {cards.length} 页 · 1080×1440{designPrompt ? ` · ${designPrompt.slice(0, 24)}${designPrompt.length > 24 ? '…' : ''}` : ''}</span>
                  <button type="button" className="ws-link" style={{ fontSize: '12px' }} onClick={rebuildAllCardsHtml}>
                    按兜底模板重排
                  </button>
                </div>

                <div
                  className={`ws-cd-artboard-stage is-${stageMode}`}
                  style={{
                    gap: `${stageGap}px`,
                    ...(stageMode === 'grid' ? { '--cd-cols': gridCols } : {}),
                  }}
                  role="list"
                  aria-label="小红书卡片画布"
                >
                  {visibleIndexes.map(index => {
                    const card = cards[index]
                    if (!card) return null
                    const isSelected = index === safeSelected
                    const isCardRedesigning = pending === `derive/xhs/card/${index}`
                    const isCardPending = isCardPendingAt(index, card)
                    const isCardActive = isCardPending && xhsJob?.activeCardIndex === index
                    const pageNo = String(index + 1).padStart(2, '0')
                    const cardHtml = isCardPending
                      ? ''
                      : ensureCardHtml(card, {
                        index,
                        total: cards.length,
                        author,
                        palette,
                        deckStyle,
                        tweaks,
                      })
                    const cardStyleText = isCardPending
                      ? ''
                      : buildCardStyleText({
                        customCss: draft?.customCss || '',
                        pageCss: card.pageCss || '',
                      })
                    const scaledW = Math.round(1080 * zoom)
                    const scaledH = Math.round(1440 * zoom)
                    const isCompactHead = scaledW < 235

                    return (
                      <div
                        key={index}
                        role="listitem"
                        className={`ws-cd-card-unit ${isSelected ? 'is-selected' : ''} ${isCompactHead ? 'is-compact' : ''} ${isCardPending ? 'is-pending' : 'ws-cd-card-ready'}`}
                        style={{ width: `${scaledW}px` }}
                      >
                        <div
                          className="ws-cd-card-head"
                          onDoubleClick={() => {
                            if (isCardPending) return
                            setSelectedIndex(index)
                            switchStageMode(stageMode === 'focus' ? 'row' : 'focus')
                          }}
                          title="双击聚焦/恢复全览"
                        >
                          <span className="ws-cd-card-title" title={`${pageNo} ${card.heading || CARD_KIND_LABELS[card.kind] || card.kind}`}>
                            {pageNo} {CARD_KIND_LABELS[card.kind] ?? card.kind}{card.heading ? ` · ${card.heading}` : ''}
                          </span>
                          <div className="ws-cd-card-actions">
                            <button
                              type="button"
                              className="ws-cd-icon-btn"
                              data-tip="AI 重设计此页"
                              aria-label={`重设计第 ${index + 1} 页卡片`}
                              disabled={busy || archived || isCardPending}
                              onClick={() => handleRedesignCard(index, '')}
                            >
                              {isCardRedesigning ? '…' : '✨'}
                            </button>
                            <button
                              type="button"
                              className="ws-cd-icon-btn"
                              data-tip="编辑此页属性"
                              aria-label={`选择第 ${index + 1} 页卡片`}
                              disabled={isCardPending}
                              onClick={() => {
                                setSelectedIndex(index)
                                setSelectedElId('root')
                                setInspectorTab('properties')
                                setInspectorOpen(true)
                              }}
                            >
                              ⚙
                            </button>
                            <button
                              type="button"
                              className="ws-cd-icon-btn"
                              data-tip="放大预览"
                              aria-label={`放大第 ${index + 1} 页卡片`}
                              disabled={isCardPending}
                              onClick={() => setLightboxIndex(index)}
                            >
                              ⤢
                            </button>
                            <button
                              type="button"
                              className="ws-cd-icon-btn"
                              data-tip="下载图片"
                              aria-label={`下载第 ${index + 1} 页卡片`}
                              disabled={isCardPending || exportingCards}
                              onClick={() => downloadOneCard(index)}
                            >
                              ↓
                            </button>
                          </div>
                        </div>

                        {isCardPending ? (
                          <div
                            className={`ws-cd-skeleton-card ${isCardActive ? 'is-active' : ''}`}
                            style={{ width: `${scaledW}px`, height: `${scaledH}px` }}
                            aria-label={`第 ${index + 1} 页正在精绘`}
                          >
                            <span className="ws-cd-skel-badge">{CARD_KIND_LABELS[card.kind] ?? card.kind}</span>
                            <strong className="ws-cd-skel-heading">{card.heading || `第 ${index + 1} 页`}</strong>
                            <div className="ws-cd-skel-line is-short" />
                            <div className="ws-cd-skel-block" />
                            <div className="ws-cd-skel-status">
                              {isCardActive ? `✨ 正在精绘第 ${index + 1} 页…` : `排队等待精绘（第 ${index + 1} 页）…`}
                            </div>
                          </div>
                        ) : (
                          <div
                            className="ws-cd-viewport"
                            style={{ width: `${scaledW}px`, height: `${scaledH}px` }}
                            onMouseDown={event => handleViewportMouseDown(index, event)}
                            onClick={event => {
                              if (canvasTool === 'hand' || spacePressed) return
                              const rootEl = artboardRefs.current[index]
                              if (index !== safeSelected) {
                                setSelectedIndex(index)
                              }
                              if (rootEl) {
                                annotateArtboardDom(rootEl)
                                const realTarget = resolveShadowTarget(event, rootEl)
                                const hit = realTarget?.closest?.('[data-cd-id]') || rootEl
                                const cdId = hit.getAttribute?.('data-cd-id') || 'root'
                                setSelectedElId(cdId)
                              }
                              if (inspectorTab === 'notes') {
                                setInspectorTab('properties')
                              }
                              setInspectorOpen(true)
                            }}
                          >
                            <div
                              className="ws-cd-scale-layer"
                              style={{ transform: `scale(${zoom})` }}
                            >
                              <XhsArtboardShadow
                                html={cardHtml}
                                className={resolveArtboardClassName(card)}
                                themeVars={themeVars}
                                styleText={cardStyleText}
                                onArtboardReady={el => { artboardRefs.current[index] = el }}
                              />
                              {isSelected && inspector?.rect ? (
                                <div
                                  className="ws-cd-selection-box"
                                  style={{
                                    left: `${inspector.rect.x}px`,
                                    top: `${inspector.rect.y}px`,
                                    width: `${inspector.rect.width}px`,
                                    height: `${inspector.rect.height}px`,
                                  }}
                                >
                                  <span className="ws-cd-handle is-tl" />
                                  <span className="ws-cd-handle is-tr" />
                                  <span className="ws-cd-handle is-bl" />
                                  <span className="ws-cd-handle is-br" />
                                </div>
                              ) : null}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* 底部中央悬浮工具坞（对齐 Claude Design：选择 / 抓手 / 适配 / 设计想法与参考图） */}
              <div className="ws-cd-dock-wrap ws-cd-hud">
                {promptPopoverMounted ? (
                  <div className={`ws-cd-floating-popover ws-cd-hud-scrollable${promptPopoverClosing ? ' is-closing' : ''}`} role="dialog" aria-label="设计想法与参考图">
                    <div className="ws-cd-floating-popover-head">
                      <strong>✨ 整套设计想法与参考图</strong>
                      <button
                        type="button"
                        className="ws-cd-icon-btn"
                        aria-label="关闭设计想法面板"
                        onClick={() => setPromptPopoverOpen(false)}
                      >
                        ×
                      </button>
                    </div>
                    {renderPromptBar({ showRegenerate: true })}
                  </div>
                ) : null}

                <div className="ws-cd-dock" role="toolbar" aria-label="画布工具栏">
                  <button
                    type="button"
                    className={`ws-cd-dock-btn ${canvasTool === 'select' && !spacePressed ? 'is-on' : ''}`}
                    title="选择与编辑元素 (V) · 拖动画布空白处也可平移"
                    onClick={() => setCanvasTool('select')}
                  >
                    ↖ 选择
                  </button>
                  <button
                    type="button"
                    className={`ws-cd-dock-btn ${canvasTool === 'hand' || spacePressed ? 'is-on' : ''}`}
                    title="抓手工具：拖动画布任意位置平移 (H 或按住空格)"
                    onClick={() => setCanvasTool('hand')}
                  >
                    ✋ 拖拽画布
                  </button>
                  <span className="ws-cd-zoom-divider" />
                  <button
                    type="button"
                    className="ws-cd-dock-btn"
                    title="居中适配全览 (0)"
                    onClick={() => fitCanvas(stageMode, null, { animate: true })}
                  >
                    ⊡ 适配
                  </button>
                  <span className="ws-cd-zoom-divider" />
                  <button
                    type="button"
                    className={`ws-cd-dock-btn is-ask ${promptPopoverOpen ? 'is-on' : ''}`}
                    aria-expanded={promptPopoverOpen}
                    onClick={() => setPromptPopoverOpen(v => !v)}
                  >
                    ✨ 设计想法 & 参考图
                    {(deckRefImages.length > 0 || designPrompt.trim()) ? (
                      <span className="ws-cd-dock-badge">
                        {deckRefImages.length > 0 ? `图${deckRefImages.length}` : '已设'}
                      </span>
                    ) : null}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {record && draft ? (
        <div className={`ws-cd-inspector-shell${inspectorOpen ? '' : ' is-collapsed'}`} aria-hidden={!inspectorOpen || undefined} inert={!inspectorOpen ? '' : undefined}>
        <aside className="ws-cd-inspector is-docked" aria-label="画布属性与代码检查器">
          <SlidingTabs activeKey={inspectorTab} className="ws-cd-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={inspectorTab === 'properties'}
              className={`ws-cd-tab ${inspectorTab === 'properties' ? 'is-on' : ''}`}
              onClick={() => setInspectorTab('properties')}
            >
              Properties
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={inspectorTab === 'code'}
              className={`ws-cd-tab ${inspectorTab === 'code' ? 'is-on' : ''}`}
              onClick={() => setInspectorTab('code')}
            >
              Code
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={inspectorTab === 'tweaks'}
              className={`ws-cd-tab ${inspectorTab === 'tweaks' ? 'is-on' : ''}`}
              onClick={() => setInspectorTab('tweaks')}
            >
              Tweaks
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={inspectorTab === 'notes'}
              className={`ws-cd-tab ${inspectorTab === 'notes' ? 'is-on' : ''}`}
              onClick={() => setInspectorTab('notes')}
            >
              笔记文案
            </button>
            <span className="ws-grow" />
            <button
              type="button"
              className="ws-cd-icon-btn"
              title="收起右侧检查器"
              aria-label="收起右侧检查器"
              onClick={() => setInspectorOpen(false)}
            >
              ×
            </button>
          </SlidingTabs>

            <div className="ws-cd-inspector-body ws-view-enter" key={inspectorTab}>
              {inspectorTab === 'properties' && selectedCard ? (
                <>
                  <div className="ws-cd-tree-section">
                    <div className="ws-cd-tree-head">
                      <span>图层结构 (Layers)</span>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                        {collapsedTreeIds.size > 0 ? (
                          <button
                            type="button"
                            className="ws-link"
                            style={{ fontSize: '11px' }}
                            onClick={() => setCollapsedTreeIds(new Set())}
                          >
                            展开全部
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="ws-link"
                          style={{ fontSize: '11px' }}
                          onClick={() => setTallTree(v => !v)}
                        >
                          {tallTree ? '收起高度' : '展开大图层'}
                        </button>
                      </div>
                    </div>
                    <div
                      ref={treeWrapRef}
                      className={`ws-cd-tree-wrap ${tallTree ? 'is-tall' : ''}`}
                      aria-label="DOM 图层树"
                    >
                      {renderLayerTreeNodes(
                        layerTree,
                        selectedElId,
                        id => setSelectedElId(id),
                        collapsedTreeIds,
                        id => setCollapsedTreeIds(prev => {
                          const next = new Set(prev)
                          if (next.has(id)) next.delete(id)
                          else next.add(id)
                          return next
                        }),
                      )}
                    </div>
                  </div>

                  <div className="ws-cd-sec">
                    <div className="ws-cd-sec-head">
                      <span>第 {safeSelected + 1} 页版式与组件</span>
                      <button
                        type="button"
                        className="ws-link"
                        onClick={() => rebuildCardHtml(safeSelected)}
                      >
                        按版式重排 HTML
                      </button>
                    </div>
                    <div className="ws-cd-prop-row">
                      <span>页面版式</span>
                      <select
                        aria-label="页面版式"
                        value={selectedCard.kind}
                        disabled={safeSelected === 0}
                        onChange={event => {
                          const nextKind = event.target.value
                          const nextCard = { ...selectedCard, kind: nextKind }
                          rebuildCardHtml(safeSelected, nextCard)
                        }}
                      >
                        {kindOptions.map(k => (
                          <option key={k} value={k}>{CARD_KIND_LABELS[k] ?? k}</option>
                        ))}
                      </select>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      <button type="button" className="ws-btn" style={{ fontSize: '11px', padding: '4px 8px' }} onClick={() => mutateSelectedElement({ type: 'insert-element', preset: 'text' })}>+ 文本</button>
                      <button type="button" className="ws-btn" style={{ fontSize: '11px', padding: '4px 8px' }} onClick={() => mutateSelectedElement({ type: 'insert-element', preset: 'pill' })}>+ 胶囊</button>
                      <button type="button" className="ws-btn" style={{ fontSize: '11px', padding: '4px 8px' }} onClick={() => mutateSelectedElement({ type: 'insert-element', preset: 'slot' })}>+ 截图位</button>
                      <button type="button" className="ws-btn" style={{ fontSize: '11px', padding: '4px 8px' }} onClick={() => mutateSelectedElement({ type: 'insert-element', preset: 'callout' })}>+ 结论框</button>
                      {selectedElId !== 'root' ? (
                        <button
                          type="button"
                          className="ws-btn"
                          style={{ fontSize: '11px', padding: '4px 8px', color: 'var(--bad)' }}
                          onClick={() => mutateSelectedElement({ type: 'delete-element' })}
                        >
                          删除元素
                        </button>
                      ) : null}
                    </div>
                    <div className="ws-cd-redesign-box">
                      <span className="ws-muted" style={{ fontSize: '11px' }}>只重设计第 {safeSelected + 1} 页（其他页的未保存修改不受影响；若本页有未保存修改会先提示确认）</span>
                      <div className="ws-cd-redesign-row">
                        <input
                          type="text"
                          aria-label="单页重设计想法"
                          maxLength={DERIVE_LIMITS.xhs.designPrompt}
                          placeholder="输入想法或直接粘贴参考图，如：改成左右对比表…"
                          value={cardPrompt}
                          disabled={busy || archived}
                          onChange={e => setCardPrompt(e.target.value)}
                          onPaste={event => {
                            const files = extractClipboardImageFiles(event)
                            if (files.length) {
                              event.preventDefault()
                              void appendRefImages(files, { max: 2, currentCount: cardRefImages.length, setter: setCardRefImages, label: '单页重设计' })
                            }
                          }}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              handleRedesignCard(safeSelected, cardPrompt, cardRefImages)
                            }
                          }}
                        />
                        <button
                          type="button"
                          className="ws-btn is-primary"
                          style={{ fontSize: '11px', padding: '5px 10px', whiteSpace: 'nowrap' }}
                          disabled={busy || archived}
                          onClick={() => handleRedesignCard(safeSelected, cardPrompt, cardRefImages)}
                        >
                          {pending === `derive/xhs/card/${safeSelected}` ? '重设计中…' : '✨ 重设计此页'}
                        </button>
                      </div>
                      <div className="ws-cd-redesign-tools">
                        <input
                          ref={cardRefInputRef}
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          multiple
                          hidden
                          onChange={event => {
                            const files = event.target.files
                            void appendRefImages(files, { max: 2, currentCount: cardRefImages.length, setter: setCardRefImages, label: '单页重设计' })
                            event.target.value = ''
                          }}
                        />
                        <button
                          type="button"
                          className="ws-btn"
                          style={{ fontSize: '11px', padding: '3px 8px' }}
                          disabled={busy || archived || cardRefImages.length >= 2}
                          onClick={() => cardRefInputRef.current?.click()}
                          title="上传本页参考图（最多 2 张，也可在上方输入框直接粘贴截图）"
                        >
                          🖼 传参考图{cardRefImages.length > 0 ? ` (${cardRefImages.length}/2)` : ''}
                        </button>
                        {cardRefImages.length > 0 ? (
                          <button
                            type="button"
                            className="ws-link"
                            style={{ fontSize: '11px' }}
                            disabled={busy}
                            onClick={() => setCardRefImages([])}
                          >
                            清空
                          </button>
                        ) : (
                          <span className="ws-muted" style={{ fontSize: '11px' }}>支持上传或粘贴截图模仿版式</span>
                        )}
                      </div>
                      {cardRefImages.length > 0 ? (
                        <>
                          <div className="ws-cd-ref-strip is-compact" aria-label="已上传的单页重设计参考图">
                            {cardRefImages.map((src, idx) => (
                              <div key={`${idx}-${src.slice(-16)}`} className="ws-cd-ref-thumb">
                                <img src={src} alt={`单页参考图 ${idx + 1}`} />
                                <button
                                  type="button"
                                  className="ws-cd-ref-remove"
                                  aria-label={`移除第 ${idx + 1} 张单页参考图`}
                                  disabled={busy}
                                  onClick={() => setCardRefImages(prev => prev.filter((_, i) => i !== idx))}
                                >
                                  ×
                                </button>
                              </div>
                            ))}
                          </div>
                          {modelSupportsImages === false ? (
                            <span className="ws-cd-vision-hint is-warn">
                              ⚠ 当前模型不支持识图，重设计时将忽略参考图（请切换多模态模型）
                            </span>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  </div>

                  {inspector ? (
                    <>
                      <div className="ws-cd-sec">
                        <div className="ws-cd-sec-head">
                          <span>Text</span>
                          <span className="ws-muted" style={{ fontWeight: 400 }}>{inspector.tagName}</span>
                        </div>

                        {inspector.kind === 'text' ? (
                          <div className="ws-cd-prop-row">
                            <span>Content</span>
                            <textarea
                              rows={2}
                              aria-label="选中元素文本内容"
                              value={inspector.text}
                              onChange={e => mutateSelectedElement({ type: 'text', value: e.target.value })}
                            />
                          </div>
                        ) : null}

                        <div className="ws-cd-prop-row">
                          <span>Text style</span>
                          <select
                            defaultValue="custom"
                            onChange={e => {
                              const preset = TEXT_STYLE_PRESETS.find(p => p.id === e.target.value)
                              if (preset && preset.id !== 'custom') {
                                const patch = {
                                  fontSize: preset.fontSize,
                                  fontWeight: preset.fontWeight,
                                  lineHeight: preset.lineHeight,
                                }
                                if (preset.fontFamily) patch.fontFamily = preset.fontFamily
                                mutateSelectedElement({ type: 'style', styles: patch })
                              }
                            }}
                          >
                            {TEXT_STYLE_PRESETS.map(p => (
                              <option key={p.id} value={p.id}>{p.label}</option>
                            ))}
                          </select>
                        </div>

                        <div className="ws-cd-prop-row">
                          <span>Font</span>
                          <select
                            value={
                              inspector.styles.fontFamily.includes('Serif') || inspector.styles.fontFamily.includes('Song')
                                ? 'serif'
                                : inspector.styles.fontFamily.includes('Mono')
                                  ? 'mono'
                                  : inspector.styles.fontFamily.includes('PingFang')
                                    ? 'pingfang'
                                    : 'noto'
                            }
                            onChange={e => mutateSelectedElement({ type: 'style', styles: { fontFamily: FONT_FAMILIES[e.target.value] } })}
                          >
                            <option value="noto">Noto Sans SC</option>
                            <option value="pingfang">PingFang SC</option>
                            <option value="serif">Noto Serif SC (宋体)</option>
                            <option value="mono">JetBrains Mono</option>
                          </select>
                        </div>

                        <div className="ws-cd-prop-row">
                          <span>Weight</span>
                          <select
                            value={inspector.styles.fontWeight}
                            onChange={e => mutateSelectedElement({ type: 'style', styles: { fontWeight: e.target.value } })}
                          >
                            <option value="400">Regular (400)</option>
                            <option value="500">Medium (500)</option>
                            <option value="600">SemiBold (600)</option>
                            <option value="700">Bold (700)</option>
                            <option value="800">ExtraBold (800)</option>
                            <option value="900">Black (900)</option>
                          </select>
                        </div>

                        <div className="ws-cd-prop-row">
                          <span>Size (px)</span>
                          <input
                            type="number"
                            min={12}
                            max={120}
                            value={inspector.styles.fontSize}
                            onChange={e => mutateSelectedElement({ type: 'style', styles: { fontSize: `${e.target.value}px` } })}
                          />
                        </div>

                        <div className="ws-cd-prop-row">
                          <span>Spacing</span>
                          <div className="ws-cd-prop-pair">
                            <input
                              type="text"
                              title="行高 Line Height"
                              placeholder="行高 1.4"
                              value={inspector.styles.lineHeight}
                              onChange={e => mutateSelectedElement({ type: 'style', styles: { lineHeight: e.target.value } })}
                            />
                            <input
                              type="text"
                              title="字距 Letter Spacing"
                              placeholder="字距 normal"
                              value={inspector.styles.letterSpacing}
                              onChange={e => mutateSelectedElement({ type: 'style', styles: { letterSpacing: e.target.value } })}
                            />
                          </div>
                        </div>

                        <div className="ws-cd-prop-row">
                          <span>Color</span>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <div className="ws-cd-color-row">
                              <input
                                type="color"
                                className="ws-cd-color-swatch"
                                value={/^#[0-9A-F]{6}$/i.test(inspector.styles.color) ? inspector.styles.color : '#0A0A0A'}
                                onChange={e => mutateSelectedElement({ type: 'style', styles: { color: e.target.value } })}
                              />
                              <input
                                type="text"
                                value={inspector.styles.color}
                                onChange={e => mutateSelectedElement({ type: 'style', styles: { color: e.target.value } })}
                              />
                            </div>
                            <div className="ws-cd-swatches">
                              {QUICK_TEXT_COLORS.map(hex => (
                                <button
                                  key={hex}
                                  type="button"
                                  className={`ws-cd-dot ${inspector.styles.color.toUpperCase() === hex ? 'is-on' : ''}`}
                                  style={{ background: hex }}
                                  title={hex}
                                  onClick={() => mutateSelectedElement({ type: 'style', styles: { color: hex } })}
                                />
                              ))}
                            </div>
                          </div>
                        </div>

                        <div className="ws-cd-prop-row">
                          <span>Align</span>
                          <SlidingTabs activeKey={inspector.styles.textAlign} className="ws-cd-seg">
                            {[
                              { id: 'left', label: '左' },
                              { id: 'center', label: '中' },
                              { id: 'right', label: '右' },
                              { id: 'justify', label: '两端' },
                            ].map(al => (
                              <button
                                key={al.id}
                                type="button"
                                className={inspector.styles.textAlign === al.id ? 'is-on' : ''}
                                onClick={() => mutateSelectedElement({ type: 'style', styles: { textAlign: al.id } })}
                              >
                                {al.label}
                              </button>
                            ))}
                          </SlidingTabs>
                        </div>
                      </div>

                      <div className="ws-cd-sec">
                        <div className="ws-cd-sec-head"><span>Size</span></div>
                        <div className="ws-cd-prop-row">
                          <span>Width</span>
                          <div className="ws-cd-prop-pair">
                            <input
                              type="text"
                              value={inspector.styles.width}
                              onChange={e => mutateSelectedElement({ type: 'style', styles: { width: e.target.value } })}
                            />
                            <select
                              value={inspector.styles.widthMode}
                              onChange={e => mutateSelectedElement({ type: 'size-mode', axis: 'width', mode: e.target.value, value: inspector.styles.width })}
                            >
                              <option value="hug">Hug</option>
                              <option value="fill">Fill (100%)</option>
                              <option value="fixed">Fixed</option>
                            </select>
                          </div>
                        </div>

                        <div className="ws-cd-prop-row">
                          <span>Height</span>
                          <div className="ws-cd-prop-pair">
                            <input
                              type="text"
                              value={inspector.styles.height}
                              onChange={e => mutateSelectedElement({ type: 'style', styles: { height: e.target.value } })}
                            />
                            <select
                              value={inspector.styles.heightMode}
                              onChange={e => mutateSelectedElement({ type: 'size-mode', axis: 'height', mode: e.target.value, value: inspector.styles.height })}
                            >
                              <option value="hug">Hug</option>
                              <option value="fill">Fill (100%)</option>
                              <option value="fixed">Fixed</option>
                            </select>
                          </div>
                        </div>

                        <div className="ws-cd-prop-row">
                          <span>Grow</span>
                          <select
                            value={String(inspector.styles.flexGrow || '0')}
                            onChange={e => mutateSelectedElement({ type: 'style', styles: { flexGrow: e.target.value, flex: e.target.value === '1' ? '1' : '' } })}
                          >
                            <option value="0">0 (按内容高度)</option>
                            <option value="1">1 (自动纵向撑满防留白)</option>
                          </select>
                        </div>
                      </div>

                      <div className="ws-cd-sec">
                        <div className="ws-cd-sec-head"><span>Layout</span></div>
                        <div className="ws-cd-prop-row">
                          <span>Padding</span>
                          <input
                            type="text"
                            placeholder="如 24px 28px"
                            value={inspector.styles.padding}
                            onChange={e => mutateSelectedElement({ type: 'style', styles: { padding: e.target.value } })}
                          />
                        </div>
                        <div className="ws-cd-prop-row">
                          <span>Gap</span>
                          <input
                            type="text"
                            placeholder="如 16px"
                            value={inspector.styles.gap}
                            onChange={e => mutateSelectedElement({ type: 'style', styles: { gap: e.target.value } })}
                          />
                        </div>
                      </div>

                      <div className="ws-cd-sec">
                        <div className="ws-cd-sec-head"><span>Appearance</span></div>
                        <div className="ws-cd-prop-row">
                          <span>Fill</span>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <div className="ws-cd-color-row">
                              <input
                                type="color"
                                className="ws-cd-color-swatch"
                                value={/^#[0-9A-F]{6}$/i.test(inspector.styles.backgroundColor) ? inspector.styles.backgroundColor : '#FFFFFF'}
                                onChange={e => mutateSelectedElement({ type: 'style', styles: { backgroundColor: e.target.value } })}
                              />
                              <input
                                type="text"
                                placeholder="None"
                                value={inspector.styles.backgroundColor || 'None'}
                                onChange={e => {
                                  const v = e.target.value.trim()
                                  mutateSelectedElement({ type: 'style', styles: { backgroundColor: v === 'None' ? 'transparent' : v } })
                                }}
                              />
                              <button
                                type="button"
                                className="ws-link"
                                onClick={() => mutateSelectedElement({ type: 'style', styles: { backgroundColor: 'transparent' } })}
                              >
                                None
                              </button>
                            </div>
                            <div className="ws-cd-swatches">
                              {QUICK_FILL_COLORS.map(hex => (
                                <button
                                  key={hex}
                                  type="button"
                                  className={`ws-cd-dot ${inspector.styles.backgroundColor.toUpperCase() === hex ? 'is-on' : ''}`}
                                  style={{ background: hex }}
                                  title={hex}
                                  onClick={() => mutateSelectedElement({ type: 'style', styles: { backgroundColor: hex } })}
                                />
                              ))}
                            </div>
                          </div>
                        </div>

                        <div className="ws-cd-prop-row">
                          <span>Opacity</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <input
                              type="range"
                              min={0}
                              max={100}
                              value={inspector.styles.opacity}
                              onChange={e => mutateSelectedElement({ type: 'style', styles: { opacity: String(Number(e.target.value) / 100) } })}
                            />
                            <span style={{ minWidth: '36px', textAlign: 'right' }}>{inspector.styles.opacity}%</span>
                          </div>
                        </div>

                        <div className="ws-cd-prop-row">
                          <span>Radius (px)</span>
                          <input
                            type="number"
                            min={0}
                            max={120}
                            value={inspector.styles.borderRadius}
                            onChange={e => mutateSelectedElement({ type: 'style', styles: { borderRadius: `${e.target.value}px` } })}
                          />
                        </div>
                      </div>
                    </>
                  ) : null}

                  <div className="ws-cd-sec">
                    <div className="ws-cd-sec-head">
                      <span>配图 / 截图位嵌入</span>
                      {selectedCard.imageUrl || inspector?.imageSrc ? (
                        <button
                          type="button"
                          className="ws-link"
                          onClick={() => applyImageToCard('')}
                        >
                          移除配图
                        </button>
                      ) : null}
                    </div>
                    {articleImages.length > 0 ? (
                      <div className="ws-derive-img-options">
                        {articleImages.map((img, idx) => {
                          const active = selectedCard.imageUrl === img.url || inspector?.imageSrc === img.url
                          return (
                            <button
                              key={`${img.url}-${idx}`}
                              type="button"
                              className={`ws-derive-img-btn ${active ? 'is-on' : ''}`}
                              title={img.caption || img.url}
                              onClick={() => applyImageToCard(active ? '' : img.url, img.caption)}
                            >
                              <img src={img.url} alt={img.caption || '文章配图'} />
                              <span>{img.caption || (img.kind === 'cover' ? '文章封面' : '文内配图')}</span>
                            </button>
                          )
                        })}
                      </div>
                    ) : null}
                    <div className="ws-derive-img-actions">
                      <input
                        ref={imageInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        hidden
                        onChange={handleLocalImageSelect}
                      />
                      <button type="button" className="ws-btn" onClick={() => imageInputRef.current?.click()}>
                        上传本地截图
                      </button>
                      <span className="ws-derive-img-status">
                        {selectedCard.imageUrl ? '已绑定配图（可直接在画布上按住图片左右拖拽）' : '点击画布截图位或上方图片一键嵌入'}
                      </span>
                    </div>

                    {selectedCard.imageUrl || inspector?.imageSrc ? (() => {
                      const activeFraming = inspector?.imageFraming || selectedCard.imageFraming || {
                        fit: 'cover',
                        posX: 50,
                        posY: 50,
                        zoom: 100,
                        panX: 0,
                        panY: 0,
                      }
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px', paddingTop: '10px', borderTop: '1px dashed var(--line)' }}>
                          <div className="ws-cd-sec-head">
                            <span>插图构图与位置微调</span>
                            <button
                              type="button"
                              className="ws-link"
                              onClick={() => updateCardImageFraming({ fit: 'cover', posX: 50, posY: 50, zoom: 100, panX: 0, panY: 0 })}
                            >
                              重置居中
                            </button>
                          </div>

                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                            <button
                              type="button"
                              className="ws-btn"
                              style={{ fontSize: '11px', padding: '3px 8px' }}
                              onClick={() => updateCardImageFraming({ fit: 'cover', posX: 0, panX: 0 })}
                            >
                              露最左 (0%)
                            </button>
                            <button
                              type="button"
                              className="ws-btn"
                              style={{ fontSize: '11px', padding: '3px 8px' }}
                              onClick={() => updateCardImageFraming({ fit: 'cover', posX: 50, panX: 0 })}
                            >
                              居中 (50%)
                            </button>
                            <button
                              type="button"
                              className="ws-btn"
                              style={{ fontSize: '11px', padding: '3px 8px' }}
                              onClick={() => updateCardImageFraming({ fit: 'cover', posX: 85, panX: 0 })}
                            >
                              往左拉·露右侧人物 (85%)
                            </button>
                            <button
                              type="button"
                              className="ws-btn"
                              style={{ fontSize: '11px', padding: '3px 8px' }}
                              onClick={() => updateCardImageFraming({ fit: 'cover', posX: 100, panX: 0 })}
                            >
                              露最右 (100%)
                            </button>
                            <button
                              type="button"
                              className="ws-btn"
                              style={{ fontSize: '11px', padding: '3px 8px' }}
                              onClick={() => updateCardImageFraming({ fit: 'contain', zoom: 100, panX: 0, panY: 0 })}
                            >
                              完整不裁切
                            </button>
                          </div>

                          <div className="ws-cd-prop-row">
                            <span>裁切模式</span>
                            <select
                              aria-label="插图裁切模式"
                              value={activeFraming.fit}
                              onChange={e => updateCardImageFraming({ fit: e.target.value })}
                            >
                              <option value="cover">填满框体 (Cover · 可左右拉动露人像)</option>
                              <option value="contain">完整显示全图 (Contain · 不裁切)</option>
                              <option value="fill">拉伸铺满 (Fill)</option>
                            </select>
                          </div>

                          <div className="ws-cd-prop-row">
                            <span>左右焦点</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <input
                                type="range"
                                aria-label="插图左右位置"
                                min={0}
                                max={100}
                                value={activeFraming.posX}
                                onChange={e => updateCardImageFraming({ posX: Number(e.target.value) })}
                              />
                              <span style={{ minWidth: '40px', textAlign: 'right' }}>{activeFraming.posX}%</span>
                            </div>
                          </div>

                          <div className="ws-cd-prop-row">
                            <span>上下焦点</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <input
                                type="range"
                                aria-label="插图上下位置"
                                min={0}
                                max={100}
                                value={activeFraming.posY}
                                onChange={e => updateCardImageFraming({ posY: Number(e.target.value) })}
                              />
                              <span style={{ minWidth: '40px', textAlign: 'right' }}>{activeFraming.posY}%</span>
                            </div>
                          </div>

                          <div className="ws-cd-prop-row">
                            <span>画面缩放</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <input
                                type="range"
                                aria-label="插图缩放比例"
                                min={60}
                                max={200}
                                step={5}
                                value={activeFraming.zoom}
                                onChange={e => updateCardImageFraming({ zoom: Number(e.target.value) })}
                              />
                              <span style={{ minWidth: '40px', textAlign: 'right' }}>{activeFraming.zoom}%</span>
                            </div>
                          </div>

                          <div className="ws-cd-prop-row">
                            <span>水平平移</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <input
                                type="range"
                                aria-label="插图水平平移像素"
                                min={-300}
                                max={300}
                                step={4}
                                value={activeFraming.panX}
                                onChange={e => updateCardImageFraming({ panX: Number(e.target.value) })}
                              />
                              <span style={{ minWidth: '46px', textAlign: 'right' }}>{activeFraming.panX}px</span>
                            </div>
                          </div>

                          <div className="ws-cd-prop-row">
                            <span>垂直平移</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <input
                                type="range"
                                aria-label="插图垂直平移像素"
                                min={-300}
                                max={300}
                                step={4}
                                value={activeFraming.panY}
                                onChange={e => updateCardImageFraming({ panY: Number(e.target.value) })}
                              />
                              <span style={{ minWidth: '46px', textAlign: 'right' }}>{activeFraming.panY}px</span>
                            </div>
                          </div>
                        </div>
                      )
                    })() : null}
                  </div>

                  <details className="ws-cd-sec" open>
                    <summary style={{ cursor: 'pointer', fontSize: '12px', fontWeight: 700, color: 'var(--ink)' }}>
                      结构化文案表单（修改后可一键重排画布）
                    </summary>
                    <div className="ws-derive-xhs-editor" style={{ marginTop: '10px' }}>
                      <label className="ws-field">
                        <span>
                          顶部角标
                          <em className={`ws-derive-count ${charCount(selectedCard.badge ?? '') > badgeMax ? 'is-over' : ''}`}>
                            {charCount(selectedCard.badge ?? '')} / {badgeMax}
                          </em>
                        </span>
                        <input
                          type="text"
                          value={selectedCard.badge ?? ''}
                          onChange={event => rebuildCardHtml(safeSelected, { ...selectedCard, badge: event.target.value })}
                        />
                      </label>

                      <label className="ws-field">
                        <span>
                          卡片标题{selectedCard.kind === 'quote' ? '（可选）' : ''}
                          <em className={`ws-derive-count ${charCount(selectedCard.heading) > DERIVE_LIMITS.xhs.heading ? 'is-over' : ''}`}>
                            {charCount(selectedCard.heading)} / {DERIVE_LIMITS.xhs.heading}
                          </em>
                        </span>
                        <input
                          type="text"
                          value={selectedCard.heading}
                          onChange={event => rebuildCardHtml(safeSelected, { ...selectedCard, heading: event.target.value })}
                        />
                      </label>

                      <label className="ws-field">
                        <span>
                          高光句 / 核心高亮（可选）
                          <em className={`ws-derive-count ${charCount(selectedCard.accent ?? '') > accentMax ? 'is-over' : ''}`}>
                            {charCount(selectedCard.accent ?? '')} / {accentMax}
                          </em>
                        </span>
                        <input
                          type="text"
                          value={selectedCard.accent ?? ''}
                          onChange={event => rebuildCardHtml(safeSelected, { ...selectedCard, accent: event.target.value })}
                        />
                      </label>

                      {selectedCard.kind === 'cover' ? (
                        <div className="ws-derive-tags-wrap">
                          <div className="ws-derive-lines-head">
                            <span>封面胶囊标签（最多 {coverTagMax} 个）</span>
                            <span className="ws-derive-count">{(selectedCard.tags ?? []).length} / {coverTagMax}</span>
                          </div>
                          {(selectedCard.tags ?? []).length > 0 ? (
                            <div className="ws-derive-tag-chips">
                              {(selectedCard.tags ?? []).map(tag => (
                                <span className="ws-derive-tag" key={tag}>
                                  {tag}
                                  <button
                                    type="button"
                                    aria-label={`移除封面标签 ${tag}`}
                                    onClick={() => rebuildCardHtml(safeSelected, {
                                      ...selectedCard,
                                      tags: (selectedCard.tags ?? []).filter(t => t !== tag),
                                    })}
                                  >
                                    ×
                                  </button>
                                </span>
                              ))}
                            </div>
                          ) : null}
                          {(selectedCard.tags ?? []).length < coverTagMax ? (
                            <div className="ws-derive-line-row">
                              <input
                                type="text"
                                placeholder="空格或逗号分隔后回车"
                                value={coverTagInput}
                                onChange={event => setCoverTagInput(event.target.value)}
                                onKeyDown={event => {
                                  if (event.key === 'Enter') {
                                    event.preventDefault()
                                    addCoverTagsFromInput()
                                  }
                                }}
                              />
                              <button type="button" className="ws-btn" onClick={addCoverTagsFromInput}>添加</button>
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      <div className="ws-derive-lines-edit">
                        <div className="ws-derive-lines-head">
                          <span>正文条目（每行 ≤ {DERIVE_LIMITS.xhs[selectedCard.kind]?.lineChars ?? 28} 字）</span>
                          {selectedCard.lines.length < (DERIVE_LIMITS.xhs[selectedCard.kind]?.lines[1] ?? 5) ? (
                            <button
                              type="button"
                              className="ws-link"
                              onClick={() => rebuildCardHtml(safeSelected, {
                                ...selectedCard,
                                lines: [...selectedCard.lines, ''],
                              })}
                            >
                              + 加一行
                            </button>
                          ) : null}
                        </div>
                        {CARD_LINE_HINTS[selectedCard.kind] ? (
                          <p className="ws-derive-line-hint">{CARD_LINE_HINTS[selectedCard.kind]}</p>
                        ) : null}
                        {selectedCard.lines.map((line, lineIndex) => {
                          const lineMax = DERIVE_LIMITS.xhs[selectedCard.kind]?.lineChars ?? 28
                          const lineLen = charCount(line)
                          return (
                            <div className="ws-derive-line-row" key={lineIndex}>
                              <input
                                type="text"
                                value={line}
                                onChange={event => {
                                  const next = selectedCard.lines.map((item, idx) => (idx === lineIndex ? event.target.value : item))
                                  rebuildCardHtml(safeSelected, { ...selectedCard, lines: next })
                                }}
                              />
                              <span className={`ws-derive-count ${lineLen > lineMax ? 'is-over' : ''}`}>{lineLen}/{lineMax}</span>
                              {selectedCard.lines.length > (DERIVE_LIMITS.xhs[selectedCard.kind]?.lines[0] ?? 0) ? (
                                <button
                                  type="button"
                                  className="ws-link"
                                  onClick={() => rebuildCardHtml(safeSelected, {
                                    ...selectedCard,
                                    lines: selectedCard.lines.filter((_, idx) => idx !== lineIndex),
                                  })}
                                >
                                  删
                                </button>
                              ) : null}
                            </div>
                          )
                        })}
                      </div>

                      <label className="ws-field">
                        <span>
                          底部要点框 / 行动提示（可选）
                          <em className={`ws-derive-count ${charCount(selectedCard.callout ?? '') > calloutMax ? 'is-over' : ''}`}>
                            {charCount(selectedCard.callout ?? '')} / {calloutMax}
                          </em>
                        </span>
                        <input
                          type="text"
                          value={selectedCard.callout ?? ''}
                          onChange={event => rebuildCardHtml(safeSelected, { ...selectedCard, callout: event.target.value })}
                        />
                      </label>
                    </div>
                  </details>
                </>
              ) : null}

              {inspectorTab === 'code' && selectedCard ? (
                <>
                  <div className="ws-cd-sec">
                    <div className="ws-cd-sec-head">
                      <span>第 {safeSelected + 1} 页 HTML 源码</span>
                      <button
                        type="button"
                        className="ws-link"
                        onClick={() => rebuildCardHtml(safeSelected)}
                      >
                        重置为兜底模板
                      </button>
                    </div>
                    <p className="ws-derive-line-hint">
                      画布渲染在隔离 Shadow DOM 内，可直接编写 1080×1440 HTML，主色建议使用 var(--xhs-accent) 等变量以支持实时换肤。
                    </p>
                    <textarea
                      className="ws-cd-code-editor"
                      style={{ minHeight: '280px' }}
                      aria-label="卡片 HTML 源码"
                      value={selectedCardHtml}
                      onChange={e => updateCard(safeSelected, { html: e.target.value })}
                    />
                  </div>
                  <div className="ws-cd-sec">
                    <div className="ws-cd-sec-head"><span>第 {safeSelected + 1} 页专属 CSS（可选）</span></div>
                    <textarea
                      className="ws-cd-code-editor"
                      style={{ minHeight: '110px' }}
                      aria-label="单页专属 CSS"
                      placeholder=".my-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }"
                      value={selectedCard.pageCss || ''}
                      onChange={e => updateCard(safeSelected, { pageCss: e.target.value })}
                    />
                  </div>
                  <div className="ws-cd-sec">
                    <div className="ws-cd-sec-head"><span>整套共享样式 CSS（customCss）</span></div>
                    <textarea
                      className="ws-cd-code-editor"
                      style={{ minHeight: '110px' }}
                      aria-label="整套共享 CSS"
                      placeholder=".story-kicker { color: var(--xhs-accent); font-weight: 800; }"
                      value={draft.customCss || ''}
                      onChange={e => updateDraft(prev => ({ ...prev, customCss: e.target.value }))}
                    />
                  </div>
                </>
              ) : null}

              {inspectorTab === 'tweaks' ? (
                <>
                  <div className="ws-cd-sec">
                    <div className="ws-cd-sec-head"><span>配色主题（实时换肤，不破坏页面版式）</span></div>
                    <div className="ws-cd-preset-grid">
                      {XHS_STYLE_PRESETS.map(p => (
                        <button
                          key={p.id}
                          type="button"
                          className={`ws-cd-preset-card ${(tweaks.preset || 'claude') === p.id ? 'is-on' : ''}`}
                          onClick={() => switchStylePreset(p.id)}
                        >
                          <div className="ws-cd-preset-top">
                            <span className="ws-cd-dot" style={{ background: p.accent, width: '12px', height: '12px' }} />
                            <span>{p.label}</span>
                          </div>
                          <span className="ws-cd-preset-sub">{p.desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="ws-cd-sec">
                    <div className="ws-cd-sec-head"><span>全局调参 (Live Knobs)</span></div>
                    <div className="ws-cd-prop-row">
                      <span>主色调</span>
                      <div className="ws-cd-color-row">
                        <input
                          type="color"
                          className="ws-cd-color-swatch"
                          value={themeVars['--xhs-accent']}
                          onChange={e => updateTweaks({ accent: e.target.value })}
                        />
                        <div className="ws-cd-swatches">
                          {['#6D3BF2', '#C85A32', '#2563EB', '#059669', '#E11D48', '#D97706'].map(hex => (
                            <button
                              key={hex}
                              type="button"
                              className={`ws-cd-dot ${themeVars['--xhs-accent'].toUpperCase() === hex ? 'is-on' : ''}`}
                              style={{ background: hex }}
                              onClick={() => updateTweaks({ accent: hex })}
                            />
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="ws-cd-prop-row">
                      <span>画布底色</span>
                      <div className="ws-cd-swatches">
                        {[
                          { hex: '#F7F7FA', label: '冷灰白' },
                          { hex: '#FAF7F2', label: '暖米纸' },
                          { hex: '#F6F8FC', label: '极客白' },
                          { hex: '#FFFFFF', label: '纯白' },
                        ].map(item => (
                          <button
                            key={item.hex}
                            type="button"
                            className="ws-btn"
                            style={{ padding: '4px 8px', fontSize: '11px' }}
                            onClick={() => updateTweaks({ surface: item.hex })}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="ws-cd-prop-row">
                      <span>字号缩放</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input
                          type="range"
                          min={0.85}
                          max={1.2}
                          step={0.05}
                          value={tweaks.scale ?? 1}
                          onChange={e => updateTweaks({ scale: Number(e.target.value) })}
                        />
                        <span style={{ minWidth: '40px', textAlign: 'right' }}>{Math.round((tweaks.scale ?? 1) * 100)}%</span>
                      </div>
                    </div>

                    <div className="ws-cd-prop-row">
                      <span>留白密度</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input
                          type="range"
                          min={0.8}
                          max={1.15}
                          step={0.05}
                          value={tweaks.density ?? 1}
                          onChange={e => updateTweaks({ density: Number(e.target.value) })}
                        />
                        <span style={{ minWidth: '40px', textAlign: 'right' }}>{Math.round((tweaks.density ?? 1) * 100)}%</span>
                      </div>
                    </div>

                    <div className="ws-cd-prop-row">
                      <span>卡片圆角</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input
                          type="range"
                          min={0}
                          max={32}
                          step={2}
                          value={tweaks.radius ?? 20}
                          onChange={e => updateTweaks({ radius: Number(e.target.value) })}
                        />
                        <span style={{ minWidth: '40px', textAlign: 'right' }}>{tweaks.radius ?? 20}px</span>
                      </div>
                    </div>

                    <div className="ws-cd-prop-row">
                      <span>全局字体</span>
                      <select
                        value={tweaks.font || 'noto'}
                        onChange={e => updateTweaks({ font: e.target.value })}
                      >
                        <option value="noto">Noto Sans SC (现代黑体)</option>
                        <option value="pingfang">PingFang SC (苹方)</option>
                        <option value="serif">Noto Serif SC (杂志宋体)</option>
                        <option value="mono">JetBrains Mono (极客等宽)</option>
                      </select>
                    </div>
                  </div>
                </>
              ) : null}

              {inspectorTab === 'notes' ? (
                <div className="ws-cd-sec">
                  <div className="ws-derive-xhs-editor">
                    <label className="ws-field">
                      <span>
                        笔记标题
                        <em className={`ws-derive-count ${titleCount === 0 || titleCount > DERIVE_LIMITS.xhs.title ? 'is-over' : ''}`}>
                          {titleCount} / {DERIVE_LIMITS.xhs.title}
                        </em>
                      </span>
                      <input
                        type="text"
                        value={draft.title}
                        onChange={event => updateDraft(prev => ({ ...prev, title: event.target.value }))}
                      />
                    </label>

                    <label className="ws-field">
                      <span>
                        正文配文
                        <em className={`ws-derive-count ${bodyCount < DERIVE_LIMITS.xhs.body[0] || bodyCount > DERIVE_LIMITS.xhs.body[1] ? 'is-over' : ''}`}>
                          {bodyCount} / {DERIVE_LIMITS.xhs.body[1]}
                        </em>
                      </span>
                      <textarea
                        rows={8}
                        value={draft.body}
                        onChange={event => updateDraft(prev => ({ ...prev, body: event.target.value }))}
                      />
                    </label>

                    <div className="ws-derive-tags-wrap">
                      <div className="ws-derive-lines-head">
                        <span>标签（3–10 个）</span>
                        <span className={`ws-derive-count ${draft.tags.length < 3 || draft.tags.length > 10 ? 'is-over' : ''}`}>
                          {draft.tags.length} / {DERIVE_LIMITS.xhs.tags[1]}
                        </span>
                      </div>
                      <div className="ws-derive-tag-chips">
                        {draft.tags.map(tag => (
                          <span className="ws-derive-tag" key={tag}>
                            #{tag}
                            <button type="button" aria-label={`移除标签 ${tag}`} onClick={() => removeTag(tag)}>×</button>
                          </span>
                        ))}
                      </div>
                      <div className="ws-derive-line-row">
                        <input
                          type="text"
                          placeholder="输入标签，空格或逗号分隔后回车添加"
                          value={tagInput}
                          onChange={event => setTagInput(event.target.value)}
                          onKeyDown={event => {
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              addTagsFromInput()
                            }
                          }}
                        />
                        <button type="button" className="ws-btn" onClick={addTagsFromInput}>添加</button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
        </aside>
        </div>
      ) : null}

      {redesignConfirmMounted && activeRedesignConfirm ? (
        <div className={`ws-scrim${redesignConfirmClosing ? ' is-closing' : ''}`} role="presentation" onClick={event => { if (event.target === event.currentTarget) setRedesignConfirm(null) }}>
          <div className="ws-dialog" role="dialog" aria-modal="true" aria-label={`确认重设计第 ${activeRedesignConfirm.index + 1} 页`}>
            <div className="ws-dialog-head">
              <h2 className="ws-dialog-title">第 {activeRedesignConfirm.index + 1} 页有未保存修改</h2>
            </div>
            <p>
              你在第 {activeRedesignConfirm.index + 1} 页有尚未保存的本地修改。直接重设计会基于服务端已保存版本重新生成并替换这一页（其他页的未保存修改不受影响）。你可以先保存再基于你的修改重设计，或直接覆盖本页。
            </p>
            <div className="ws-dialog-foot">
              <button type="button" className="ws-btn" onClick={() => setRedesignConfirm(null)}>取消</button>
              <button
                type="button"
                className="ws-btn"
                onClick={() => {
                  const target = activeRedesignConfirm
                  setRedesignConfirm(null)
                  void executeRedesignCard(target.index, target.cardPrompt, { saveFirst: false, referenceImages: target.referenceImages || [] })
                }}
              >
                覆盖本页并重设计
              </button>
              <button
                type="button"
                className="ws-btn is-primary"
                onClick={() => {
                  const target = activeRedesignConfirm
                  setRedesignConfirm(null)
                  void executeRedesignCard(target.index, target.cardPrompt, { saveFirst: true, referenceImages: target.referenceImages || [] })
                }}
              >
                先保存再重设计
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {lightboxMounted && activeLightbox !== null && lightboxCard ? (
        <div className={`ws-scrim${lightboxClosing ? ' is-closing' : ''}`} onClick={() => setLightboxIndex(null)}>
          <div
            className="ws-dialog ws-derive-lightbox"
            role="dialog"
            aria-modal="true"
            aria-label={`第 ${activeLightbox + 1} 页卡片大图预览`}
            onClick={event => event.stopPropagation()}
          >
            <div className="ws-dialog-head">
              <strong className="ws-dialog-title">
                第 {activeLightbox + 1} / {cards.length} 页 · {CARD_KIND_LABELS[lightboxCard.kind] ?? lightboxCard.kind}
              </strong>
              <button type="button" className="ws-btn" onClick={() => setLightboxIndex(null)}>关闭</button>
            </div>
            <div className="ws-derive-lightbox-body">
              <div key={activeLightbox} className={lightboxSlideClass}>
              {lightboxPending ? (
                <div
                  className={`ws-cd-skeleton-card ${xhsJob?.activeCardIndex === activeLightbox ? 'is-active' : ''}`}
                  style={{ width: `${Math.round(1080 * 0.44)}px`, height: `${Math.round(1440 * 0.44)}px` }}
                  aria-label={`第 ${activeLightbox + 1} 页正在精绘`}
                >
                  <span className="ws-cd-skel-badge">{CARD_KIND_LABELS[lightboxCard.kind] ?? lightboxCard.kind}</span>
                  <strong className="ws-cd-skel-heading" style={{ fontSize: '20px' }}>{lightboxCard.heading || `第 ${activeLightbox + 1} 页`}</strong>
                  <div className="ws-cd-skel-line is-short" />
                  <div className="ws-cd-skel-block" />
                  <div className="ws-cd-skel-status" style={{ fontSize: '14px' }}>
                    {xhsJob?.activeCardIndex === activeLightbox
                      ? `✨ 正在精绘第 ${activeLightbox + 1} 页，完成后自动展示…`
                      : `排队等待精绘（第 ${activeLightbox + 1} 页），完成后自动展示…`}
                  </div>
                </div>
              ) : (
                <div
                  className="ws-cd-viewport"
                  style={{ width: `${Math.round(1080 * 0.44)}px`, height: `${Math.round(1440 * 0.44)}px` }}
                >
                  <div className="ws-cd-scale-layer" style={{ transform: 'scale(0.44)' }}>
                    <XhsArtboardShadow
                      html={ensureCardHtml(lightboxCard, {
                        index: activeLightbox,
                        total: cards.length,
                        author,
                        palette,
                        deckStyle,
                        tweaks,
                      })}
                      className={resolveArtboardClassName(lightboxCard)}
                      themeVars={themeVars}
                      styleText={buildCardStyleText({
                        customCss: draft?.customCss || '',
                        pageCss: lightboxCard.pageCss || '',
                      })}
                    />
                  </div>
                </div>
              )}
              </div>
            </div>
            <div className="ws-dialog-foot">
              <button
                type="button"
                className="ws-btn"
                disabled={activeLightbox === 0}
                onClick={() => setLightboxIndex(i => Math.max(0, (i ?? 0) - 1))}
              >
                上一页
              </button>
              <button
                type="button"
                className="ws-btn"
                disabled={activeLightbox >= cards.length - 1}
                onClick={() => setLightboxIndex(i => Math.min(cards.length - 1, (i ?? 0) + 1))}
              >
                下一页
              </button>
              <span className="ws-grow" />
              <button
                type="button"
                className="ws-btn"
                disabled={lightboxPending}
                onClick={() => {
                  setSelectedIndex(activeLightbox)
                  setInspectorOpen(true)
                  setLightboxIndex(null)
                }}
              >
                编辑此页
              </button>
              <button type="button" className="ws-btn is-primary" disabled={lightboxPending || exportingCards} onClick={() => downloadOneCard(activeLightbox)}>
                {downloadingCard === activeLightbox ? '导出中…' : '下载图片'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

export function DeriveView({ article, brand }) {
  const pending = useStudio(s => s.pending)
  const deriveDrafts = useStudio(s => s.deriveDrafts)
  const [tab, setTab] = React.useState('markdown')
  const [confirmState, setConfirmState] = React.useState(null)
  const { mounted: confirmMounted, closing: confirmClosing, value: activeConfirm } = usePresenceValue(confirmState)

  const runGenerate = async (platform, variant, confirmOverwrite, designPrompt = '', referenceImages = []) => {
    const res = await generateDerivative({ id: article.id, platform, variant, designPrompt, referenceImages, confirmOverwrite })
    if (res.needsConfirm) {
      setConfirmState({ type: 'generate', platform, variant, designPrompt, referenceImages, reason: 'edited' })
    }
  }

  const handleGenerate = async (platform, variant, { dirty = false, record = null, designPrompt = '', referenceImages = [] } = {}) => {
    const check = shouldConfirmDeriveAction({ action: 'generate', dirty, record })
    if (check.confirm) {
      setConfirmState({ type: 'generate', platform, variant, designPrompt, referenceImages, reason: check.reason })
      return
    }
    await runGenerate(platform, variant, false, designPrompt, referenceImages)
  }

  const handleDelete = async (platform, { dirty = false, record = null } = {}) => {
    const check = shouldConfirmDeriveAction({ action: 'delete', dirty, record })
    if (check.confirm) {
      setConfirmState({ type: 'delete', platform, reason: check.reason })
      return
    }
    await deleteDerivative({ id: article.id, platform })
  }

  const confirmAction = async () => {
    if (!confirmState) return
    const current = confirmState
    setConfirmState(null)
    if (current.type === 'delete') {
      await deleteDerivative({ id: article.id, platform: current.platform })
    } else {
      await runGenerate(current.platform, current.variant, true, current.designPrompt || '', current.referenceImages || [])
    }
  }

  return (
    <div className="ws-derive">
      <div className="ws-derive-head">
        <SlidingTabs activeKey={tab} className="ws-tabs" role="tablist" aria-label="派生形态">
          {SUB_TABS.map(item => {
            const hasDraft = item.id !== 'markdown' && Boolean(deriveDrafts[deriveDraftKey(article.id, item.id)])
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                className={tab === item.id ? 'is-on' : ''}
                onClick={() => setTab(item.id)}
              >
                {item.label}
                {hasDraft ? <span className="ws-derive-dirty-tag">未保存</span> : null}
              </button>
            )
          })}
        </SlidingTabs>
        <span className="ws-muted ws-small">母稿 → 派生单向导出，复制或下载后直接发布，不进入排期。</span>
      </div>

      <div key={tab} className={`ws-derive-body ws-view-enter ${tab === 'xhs' ? 'is-xhs-studio' : ''}`}>
        {tab === 'markdown' ? <MarkdownPanel article={article} /> : null}
        {tab === 'thread' ? <ThreadPanel article={article} pending={pending} onGenerate={handleGenerate} onDelete={handleDelete} /> : null}
        {tab === 'xhs' ? <XhsPanel article={article} brand={brand} pending={pending} onGenerate={handleGenerate} onDelete={handleDelete} /> : null}
      </div>

      {confirmMounted && activeConfirm ? (
        <div className={`ws-scrim${confirmClosing ? ' is-closing' : ''}`} role="presentation" onClick={event => { if (event.target === event.currentTarget) setConfirmState(null) }}>
          <div className="ws-dialog" role="dialog" aria-modal="true" aria-label={activeConfirm.type === 'delete' ? '确认删除派生' : '确认覆盖修改'}>
            <div className="ws-dialog-head">
              <h2 className="ws-dialog-title">{activeConfirm.type === 'delete' ? '确认删除派生' : '确认覆盖修改'}</h2>
            </div>
            <p>
              {activeConfirm.type === 'delete'
                ? (activeConfirm.reason === 'unsaved'
                  ? '你还有未保存的手改内容，删除后本地修改与这份派生稿都会清空，确定继续吗？'
                  : '这份派生稿你手动改过，删除后无法恢复，确定继续吗？')
                : (activeConfirm.reason === 'unsaved'
                  ? '你还有未保存的手改内容，重新生成会丢弃当前修改并覆盖，确定继续吗？'
                  : '这份派生稿你手动改过，重新生成会覆盖当前内容，确定继续吗？')}
            </p>
            <div className="ws-dialog-foot">
              <button type="button" className="ws-btn" onClick={() => setConfirmState(null)}>取消</button>
              <button type="button" className="ws-btn is-primary" onClick={confirmAction}>
                {activeConfirm.type === 'delete' ? '确定删除' : '确定重新生成'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

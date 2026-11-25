import React from 'react'
import { pickableStyleArticles } from '../src/writing-style-shared.js'
import { useDialogClose, useDirection } from './motion.jsx'
import {
  analyzeStyle,
  applyStyle,
  loadStyleProfile,
  openStyleWizard,
  previewStyle,
  renderStyleMarkdown,
  restoreStyle,
  setState,
  toast,
  useStudio,
} from './state.js'

function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function ChipEditor({ label, hint, items, placeholder, maxItems = 12, onChange }) {
  const [input, setInput] = React.useState('')
  const add = () => {
    const val = input.trim()
    if (!val || items.includes(val) || items.length >= maxItems) return
    onChange([...items, val])
    setInput('')
  }
  return (
    <div className="ws-style-field">
      <div className="ws-style-field-head">
        <span>{label}</span>
        {hint ? <small className="ws-muted">{hint}</small> : null}
      </div>
      <div className="ws-chip-list">
        {items.map(item => (
          <span className="ws-chip" key={item}>
            <span>{item}</span>
            <button type="button" aria-label={`移除 ${item}`} onClick={() => onChange(items.filter(x => x !== item))}>×</button>
          </span>
        ))}
        {items.length < maxItems ? (
          <span className="ws-chip-input">
            <input
              type="text"
              value={input}
              placeholder={placeholder}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  add()
                }
              }}
            />
            <button type="button" className="ws-link" onClick={add}>添加</button>
          </span>
        ) : null}
      </div>
    </div>
  )
}

/**
 * 编辑期间保留原始多行字符串（允许回车空行与英文行尾空格），只把清洗后的数组向上同步。
 */
function LinesEditor({ label, hint, items, resetKey, rows = 3, placeholder, onChange }) {
  const [raw, setRaw] = React.useState(() => (items ?? []).join('\n'))
  React.useEffect(() => {
    setRaw((items ?? []).join('\n'))
  }, [resetKey])

  return (
    <label className="ws-field ws-style-field">
      <span className="ws-style-field-head">
        <span>{label}</span>
        {hint ? <small className="ws-muted">{hint}</small> : null}
      </span>
      <textarea
        rows={rows}
        value={raw}
        placeholder={placeholder}
        onChange={e => {
          const text = e.target.value
          setRaw(text)
          onChange(text.split('\n').map(s => s.trim()).filter(Boolean))
        }}
      />
    </label>
  )
}

export function WritingStyleCard() {
  const style = useStudio(s => s.style)
  const [restoring, setRestoring] = React.useState(false)
  const [confirmMode, setConfirmMode] = React.useState(null) // null | 'default' | 'backup'

  React.useEffect(() => {
    if (!style) void loadStyleProfile()
  }, [])

  const onRestore = async restoreBackup => {
    if (restoring) return
    setRestoring(true)
    try {
      await restoreStyle({ restoreBackup })
      setConfirmMode(null)
    } catch (err) {
      toast(err.message, true)
    } finally {
      setRestoring(false)
    }
  }

  if (!style) {
    return (
      <section className="ws-style-card">
        <span className="ws-shimmer">正在读取个人写作风格…</span>
      </section>
    )
  }

  if (style.error) {
    return (
      <section className="ws-style-card">
        <p className="ws-warn">读取写作风格失败：{style.error}</p>
        <button type="button" className="ws-btn" onClick={() => void loadStyleProfile()}>重试</button>
      </section>
    )
  }

  const active = Boolean(style.active)
  const profile = style.profile
  const hasBackup = Boolean(style.hasBackup?.writer || style.hasBackup?.headline)
  const scopeLabels = [
    style.scopes?.writer ? '写正文与改稿' : null,
    style.scopes?.headline ? '标题与摘要' : null,
  ].filter(Boolean)
  const backupLabels = [
    style.hasBackup?.writer ? '写作（writer.md）' : null,
    style.hasBackup?.headline ? '标题（headline.md）' : null,
  ].filter(Boolean)

  return (
    <section className={`ws-style-card ${active ? 'is-active' : ''}`} aria-label="我的写作风格">
      <div className="ws-style-card-head">
        <div>
          <div className="ws-style-card-title-row">
            <h2>{active && profile ? profile.name : '我的写作风格'}</h2>
            <span className={`ws-skill-src ${active ? 'is-user' : ''}`}>
              {active ? '已启用' : '当前使用内置默认'}
            </span>
          </div>
          {active && profile ? (
            <p className="ws-style-card-summary">{profile.summary}</p>
          ) : (
            <p className="ws-muted">导入 1–5 篇你写过的文章，提炼成你的专属写法，之后写初稿、改稿、出标题都会按你的口吻来。</p>
          )}
        </div>
      </div>

      {active ? (
        <p className="ws-muted ws-small ws-style-card-meta">
          {[
            scopeLabels.length ? `生效范围：${scopeLabels.join('、')}` : null,
            style.sampleCount ? `基于 ${style.sampleCount} 篇文章` : null,
            style.updatedAt ? `更新于 ${formatDate(style.updatedAt)}` : null,
          ].filter(Boolean).join(' · ')}
        </p>
      ) : null}

      <div className="ws-style-card-actions">
        {active ? (
          <>
            <button type="button" className="ws-btn is-primary" onClick={() => openStyleWizard(2)}>微调风格</button>
            <button type="button" className="ws-btn" onClick={() => openStyleWizard(1)}>补充文章重学</button>
            <button type="button" className="ws-link" disabled={restoring} onClick={() => setConfirmMode('default')}>
              恢复默认风格
            </button>
          </>
        ) : (
          <>
            <button type="button" className="ws-btn is-primary" onClick={() => openStyleWizard(1)}>导入文章，生成我的风格</button>
            {profile ? (
              <button type="button" className="ws-btn" onClick={() => openStyleWizard(2)}>继续编辑上次的风格</button>
            ) : null}
          </>
        )}
        {hasBackup ? (
          <button type="button" className="ws-link" disabled={restoring} onClick={() => setConfirmMode('backup')}>
            恢复之前的自定义版本
          </button>
        ) : null}
      </div>

      {confirmMode ? (
        <div className="ws-style-confirm" role="alertdialog" aria-label="确认恢复操作">
          <p className="ws-small">
            {confirmMode === 'default'
              ? `确认恢复内置默认风格吗？将停用当前的个人风格（影响：${scopeLabels.join('、') || '无'}）。已写入的数据复盘规则会自动保留；如果你曾手动修改过生成的规则文件，系统会先自动备份。`
              : `确认恢复之前备份的自定义版本（${backupLabels.join('、')}）吗？已写入的数据复盘规则会自动合并保留；当前文件如有额外手改也会先自动备份。`}
          </p>
          <div className="ws-style-confirm-actions">
            <button type="button" className="ws-btn" disabled={restoring} onClick={() => setConfirmMode(null)}>取消</button>
            <button
              type="button"
              className="ws-btn is-primary"
              disabled={restoring}
              onClick={() => void onRestore(confirmMode === 'backup')}
            >
              {restoring ? '正在恢复…' : confirmMode === 'default' ? '确认恢复默认' : '确认恢复自定义版本'}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}

export function WritingStyleWizard() {
  const data = useStudio(s => s.data)
  const style = useStudio(s => s.style)
  const initialStep = useStudio(s => s.styleWizardStep) || 1
  const returnTo = useStudio(s => s.styleWizardReturnTo)

  const [step, setStep] = React.useState(initialStep)
  const [selectedIds, setSelectedIds] = React.useState([])
  const [uploadedFiles, setUploadedFiles] = React.useState([])
  const [pastedList, setPastedList] = React.useState([{ title: '', text: '' }])
  const [userNote, setUserNote] = React.useState('')
  const [dragOver, setDragOver] = React.useState(false)

  const [draftProfile, setDraftProfile] = React.useState(() => style?.profile ?? null)
  const [editorResetKey, setEditorResetKey] = React.useState(0)
  const [meta, setMeta] = React.useState(() => (style?.sampleTitles?.length ? { sampleCount: style.sampleCount, sampleTitles: style.sampleTitles, truncated: false, totalChars: 0 } : null))
  const [previewMarkdown, setPreviewMarkdown] = React.useState(() => style?.previewMarkdown ?? null)
  const [previewStale, setPreviewStale] = React.useState(false)
  const [markdownOpen, setMarkdownOpen] = React.useState(false)
  const [renderingMd, setRenderingMd] = React.useState(false)

  const [previewTopic, setPreviewTopic] = React.useState('')
  const [testResult, setTestResult] = React.useState(null)
  const [testResultStale, setTestResultStale] = React.useState(false)

  const [scopes, setScopes] = React.useState(() => ({
    writer: style?.active ? Boolean(style.scopes?.writer) : true,
    headline: style?.active ? Boolean(style.scopes?.headline) : true,
  }))

  const [busy, setBusy] = React.useState('')
  const [error, setError] = React.useState('')
  const fileInputRef = React.useRef(null)
  const profileRevRef = React.useRef(0)
  const previewSeqRef = React.useRef(0)
  const renderSeqRef = React.useRef(0)
  const abortRef = React.useRef(null)

  React.useEffect(() => {
    if (style?.profile && !draftProfile) {
      setDraftProfile(style.profile)
      setPreviewMarkdown(style.previewMarkdown ?? null)
      setEditorResetKey(k => k + 1)
    }
  }, [style?.profile])

  React.useEffect(() => () => {
    abortRef.current?.abort()
  }, [])

  const cancelRunning = React.useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    previewSeqRef.current += 1
    setBusy('')
  }, [])

  const closeImmediate = React.useCallback(() => {
    if (busy === 'apply') return
    if (busy) cancelRunning()
    setState({ dialog: returnTo === 'new' ? 'new' : null, styleWizardReturnTo: null })
  }, [busy, cancelRunning, returnTo])
  const { closing, requestClose: close } = useDialogClose(closeImmediate)
  const stepDir = useDirection(step)
  const stepClass = stepDir > 0 ? 'ws-slide-next' : stepDir < 0 ? 'ws-slide-prev' : 'ws-view-enter'

  React.useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  const pickable = React.useMemo(() => pickableStyleArticles(data?.articles), [data?.articles])

  const toggleArticle = id => {
    setSelectedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))
  }

  const readDroppedFiles = async fileList => {
    const files = [...(fileList ?? [])].filter(f => /\.(md|markdown|txt)$/i.test(f.name) || f.type.startsWith('text/'))
    if (!files.length) {
      setError('请选择 .md 或 .txt 文本文件。')
      return
    }
    setError('')
    const loaded = []
    for (const file of files.slice(0, 10)) {
      const text = await file.text()
      if (text.trim()) loaded.push({ title: file.name.replace(/\.(md|markdown|txt)$/i, ''), text })
    }
    setUploadedFiles(prev => [...prev, ...loaded])
  }

  const validPasted = pastedList.filter(item => item.text.trim().length > 0)
  const totalSamples = selectedIds.length + uploadedFiles.length + validPasted.length

  const updateProfile = patch => {
    profileRevRef.current += 1
    setDraftProfile(prev => (prev ? { ...prev, ...patch } : prev))
    setPreviewStale(true)
    if (testResult) setTestResultStale(true)
  }

  const updateHeadline = patch => {
    profileRevRef.current += 1
    setDraftProfile(prev => (prev ? { ...prev, headline: { ...prev.headline, ...patch } } : prev))
    setPreviewStale(true)
    if (testResult) setTestResultStale(true)
  }

  const refreshRenderedMarkdown = async profile => {
    if (!profile) return
    const reqRev = profileRevRef.current
    const reqId = ++renderSeqRef.current
    setRenderingMd(true)
    try {
      const res = await renderStyleMarkdown(profile)
      if (reqId !== renderSeqRef.current) return
      setPreviewMarkdown(res.previewMarkdown)
      if (reqRev === profileRevRef.current) setPreviewStale(false)
    } catch (err) {
      if (err?.name !== 'AbortError') toast(err.message, true)
    } finally {
      if (reqId === renderSeqRef.current) setRenderingMd(false)
    }
  }

  const runAnalyze = async () => {
    if (!totalSamples || busy) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setBusy('analyze')
    setError('')
    try {
      const res = await analyzeStyle(
        {
          articleIds: selectedIds,
          pasted: [...uploadedFiles, ...validPasted],
          userNote,
        },
        controller.signal,
      )
      if (controller.signal.aborted) return
      profileRevRef.current += 1
      setDraftProfile(res.profile)
      setEditorResetKey(k => k + 1)
      setMeta(res.meta)
      setPreviewMarkdown(res.previewMarkdown)
      setPreviewStale(false)
      setTestResult(null)
      setTestResultStale(false)
      setStep(2)
    } catch (err) {
      if (err?.name !== 'AbortError') setError(err.message)
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null
        setBusy('')
      }
    }
  }

  const runPreview = async () => {
    if (!draftProfile || busy) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const reqRev = profileRevRef.current
    const reqId = ++previewSeqRef.current
    setBusy('preview')
    setError('')
    try {
      const res = await previewStyle({ profile: draftProfile, topic: previewTopic }, controller.signal)
      if (controller.signal.aborted || reqId !== previewSeqRef.current) return
      setTestResult(res)
      const stillLatest = reqRev === profileRevRef.current
      setTestResultStale(!stillLatest)
      if (res.previewMarkdown && stillLatest) {
        setPreviewMarkdown(res.previewMarkdown)
        setPreviewStale(false)
      }
    } catch (err) {
      if (err?.name !== 'AbortError') setError(err.message)
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null
        setBusy('')
      }
    }
  }

  const runApply = async () => {
    if (!draftProfile || busy) return
    if (!scopes.writer && !scopes.headline) {
      setError('请至少勾选一个生效范围。')
      return
    }
    setBusy('apply')
    setError('')
    try {
      const res = await applyStyle({
        profile: draftProfile,
        scopes,
        sampleTitles: meta?.sampleTitles,
      })
      const backupNote = res.backedUp?.length ? `（原文件已自动备份：${res.backedUp.join('、')}）` : ''
      toast(`已启用「${res.state.profile?.name || '我的写作风格'}」${backupNote}`)
      setState({ dialog: returnTo === 'new' ? 'new' : null, styleWizardReturnTo: null })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy('')
    }
  }

  const steps = [
    { n: 1, label: '投喂文章' },
    { n: 2, label: '风格体检' },
    { n: 3, label: '一键启用' },
  ]

  return (
    <div className={`ws-scrim${closing ? ' is-closing' : ''}`} onMouseDown={e => { if (e.target === e.currentTarget) close() }}>
      <section className="ws-dialog ws-style-wizard" role="dialog" aria-modal="true" aria-label="我的写作风格">
        <div className="ws-dialog-head">
          <div>
            <h2 className="ws-dialog-title">我的写作风格</h2>
            <ol className="ws-style-steps" aria-label="步骤">
              {steps.map(s => (
                <li key={s.n} className={step === s.n ? 'is-now' : step > s.n ? 'is-done' : ''}>
                  <span>{s.n}</span>{s.label}
                </li>
              ))}
            </ol>
          </div>
          <button type="button" className="ws-icon-btn" aria-label="关闭" disabled={busy === 'apply'} onClick={close}>✕</button>
        </div>

        <div className="ws-style-wizard-body">
          {step === 1 ? (
            <div key="step-1" className={`ws-style-step ${stepClass}`}>
              <p className="ws-muted">选几篇你最满意的过往文章（支持馆藏稿件、本地 .md / .txt 文件或直接粘贴混合导入）。建议 3–5 篇，1 篇也能开始。</p>
              <div className="ws-style-tip ws-small">
                <svg className="ws-style-tip-icon" aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 12.5h4M6.7 14.3h2.6M8 1.8a4.5 4.5 0 0 0-2.6 8.15c.42.3.6.68.6 1.05v.2h4v-.2c0-.37.18-.75.6-1.05A4.5 4.5 0 0 0 8 1.8z" />
                </svg>
                <span>
                  本次分析使用当前模型 <code>{data?.model || '默认模型'}</code>。风格文件启用后会一直保留；日常写稿可随时切换模型，实际效果仍取决于所选模型。
                </span>
              </div>

              {pickable.length ? (
                <div className="ws-style-section">
                  <h3>从本工作区稿件中挑选（已选 {selectedIds.length} 篇）</h3>
                  <div className="ws-style-article-list">
                    {pickable.map(article => (
                      <label key={article.id} className={`ws-style-article-item ${selectedIds.includes(article.id) ? 'is-on' : ''}`}>
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(article.id)}
                          disabled={Boolean(busy)}
                          onChange={() => toggleArticle(article.id)}
                        />
                        <span className="ws-style-article-title">{article.title}</span>
                        <small className="ws-muted">{article.chars} 字</small>
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="ws-style-section">
                <h3>拖入或选择本地文件（.md / .txt）</h3>
                <button
                  type="button"
                  className={`ws-drop ws-dropzone ${dragOver ? 'is-over' : ''}`}
                  disabled={Boolean(busy)}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={e => {
                    e.preventDefault()
                    setDragOver(false)
                    void readDroppedFiles(e.dataTransfer.files)
                  }}
                >
                  把 .md / .txt 文章拖到这里，或点击多选
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".md,.markdown,.txt,text/markdown,text/plain"
                  multiple
                  hidden
                  onChange={e => {
                    void readDroppedFiles(e.target.files)
                    e.target.value = ''
                  }}
                />
                {uploadedFiles.length ? (
                  <div className="ws-chip-list">
                    {uploadedFiles.map((file, idx) => (
                      <span className="ws-chip" key={`${file.title}-${idx}`}>
                        <span>{file.title}（{file.text.length} 字）</span>
                        <button type="button" aria-label={`移除 ${file.title}`} onClick={() => setUploadedFiles(prev => prev.filter((_, i) => i !== idx))}>×</button>
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="ws-style-section">
                <div className="ws-sec-head">
                  <h3>直接粘贴文章</h3>
                  <button
                    type="button"
                    className="ws-link"
                    disabled={Boolean(busy) || pastedList.length >= 8}
                    onClick={() => setPastedList(prev => [...prev, { title: '', text: '' }])}
                  >
                    + 再加一篇
                  </button>
                </div>
                {pastedList.map((item, idx) => (
                  <div className="ws-style-paste-box" key={idx}>
                    <div className="ws-style-paste-head">
                      <input
                        type="text"
                        value={item.title}
                        placeholder={`文章标题（可选，第 ${idx + 1} 篇）`}
                        disabled={Boolean(busy)}
                        onChange={e => setPastedList(prev => prev.map((p, i) => (i === idx ? { ...p, title: e.target.value } : p)))}
                      />
                      {pastedList.length > 1 ? (
                        <button type="button" className="ws-link" onClick={() => setPastedList(prev => prev.filter((_, i) => i !== idx))}>移除</button>
                      ) : null}
                    </div>
                    <textarea
                      rows={4}
                      value={item.text}
                      disabled={Boolean(busy)}
                      placeholder="把过往文章正文粘贴到这里（代码块、图片链接、固定尾注会自动清洗）"
                      onChange={e => setPastedList(prev => prev.map((p, i) => (i === idx ? { ...p, text: e.target.value } : p)))}
                    />
                  </div>
                ))}
              </div>

              <label className="ws-field">
                <span>你希望读者读起来是什么感觉？（可选）</span>
                <input
                  type="text"
                  maxLength={200}
                  value={userNote}
                  disabled={Boolean(busy)}
                  placeholder="比如：像朋友聊天一样实在，少点鸡汤和黑话"
                  onChange={e => setUserNote(e.target.value)}
                />
              </label>
            </div>
          ) : null}

          {step === 2 && draftProfile ? (
            <div key="step-2" className={`ws-style-step ${stepClass}`}>
              {meta?.sampleCount ? (
                <p className="ws-muted ws-small">
                  已实际纳入 {meta.sampleCount} 篇文章生成风格体检卡
                  {meta.truncated ? `（内容较长，已均衡截取各篇开头和结尾，共约 ${meta.totalChars} 字）` : ''}
                  ，每一项都可以直接改成更像你的说法。
                </p>
              ) : null}

              <div className="ws-style-grid">
                <label className="ws-field">
                  <span>风格名称</span>
                  <input
                    type="text"
                    maxLength={40}
                    value={draftProfile.name}
                    onChange={e => updateProfile({ name: e.target.value })}
                  />
                </label>
                <label className="ws-field">
                  <span>一句话定位</span>
                  <input
                    type="text"
                    maxLength={80}
                    value={draftProfile.summary}
                    onChange={e => updateProfile({ summary: e.target.value })}
                  />
                </label>
              </div>

              <LinesEditor
                label="语气与读者视角"
                hint="每行一条"
                items={draftProfile.voice}
                resetKey={editorResetKey}
                rows={3}
                placeholder="例如：第一人称亲历视角，把复杂概念翻译成人话"
                onChange={voice => updateProfile({ voice })}
              />

              <LinesEditor
                label="开头与行文节奏"
                hint="每行一条"
                items={draftProfile.rhythm}
                resetKey={editorResetKey}
                rows={3}
                placeholder="例如：开头直接抛具体场景，段落控制在 2–4 句"
                onChange={rhythm => updateProfile({ rhythm })}
              />

              <ChipEditor
                label="常用表达 / 口头禅"
                hint="自然穿插，不会每段硬塞"
                items={draftProfile.phrases}
                placeholder="输入一个常用词后回车"
                onChange={phrases => updateProfile({ phrases })}
              />

              <ChipEditor
                label="个人雷区 / 禁用词"
                hint="会自动叠加基础去 AI 味底线"
                items={draftProfile.taboos}
                placeholder="输入不喜欢的词后回车"
                onChange={taboos => updateProfile({ taboos })}
              />

              <div className="ws-style-subcard">
                <h3>标题与摘要习惯</h3>
                <div className="ws-style-grid">
                  <label className="ws-field">
                    <span>标题长度偏好</span>
                    <input
                      type="text"
                      maxLength={30}
                      value={draftProfile.headline?.lengthRange ?? ''}
                      onChange={e => updateHeadline({ lengthRange: e.target.value })}
                    />
                  </label>
                  <label className="ws-field">
                    <span>标点习惯</span>
                    <input
                      type="text"
                      maxLength={80}
                      value={draftProfile.headline?.punctuation ?? ''}
                      onChange={e => updateHeadline({ punctuation: e.target.value })}
                    />
                  </label>
                </div>
                <label className="ws-field">
                  <span>摘要风格</span>
                  <input
                    type="text"
                    maxLength={100}
                    value={draftProfile.headline?.summaryStyle ?? ''}
                    onChange={e => updateHeadline({ summaryStyle: e.target.value })}
                  />
                </label>
                <LinesEditor
                  label="偏好的标题切入角度"
                  hint="每行一条"
                  items={draftProfile.headline?.hooks ?? []}
                  resetKey={editorResetKey}
                  rows={2}
                  onChange={hooks => updateHeadline({ hooks })}
                />
              </div>

              <LinesEditor
                label="原文代表句"
                hint="生成时已核对原文；手动修改后按你的输入使用，每行一段"
                items={draftProfile.excerpts}
                resetKey={editorResetKey}
                rows={4}
                onChange={excerpts => updateProfile({ excerpts })}
              />

              <section className="ws-style-preview" aria-label="现场试写">
                <div className="ws-sec-head">
                  <h3>现场试写</h3>
                  <span className="ws-muted ws-small">启用前先听听像不像你</span>
                </div>
                <div className="ws-style-preview-bar">
                  <input
                    type="text"
                    value={previewTopic}
                    disabled={busy === 'preview'}
                    placeholder="输入测试选题（留空默认：AI 工具真能帮普通人省时间吗？）"
                    onChange={e => setPreviewTopic(e.target.value)}
                  />
                  {busy === 'preview' ? (
                    <button type="button" className="ws-btn" onClick={cancelRunning}>取消试写</button>
                  ) : (
                    <button type="button" className="ws-btn is-primary" disabled={Boolean(busy)} onClick={() => void runPreview()}>
                      试写一段看看
                    </button>
                  )}
                </div>
                {testResult ? (
                  <div className={`ws-style-preview-result ${testResultStale ? 'is-stale' : ''}`}>
                    {testResultStale ? (
                      <p className="ws-style-stale-note ws-small">以下试写来自你修改风格之前的版本，点击「试写一段看看」可按当前设置重新生成。</p>
                    ) : null}
                    <p className="ws-muted ws-small">测试选题：{testResult.topic}</p>
                    <div className="ws-style-preview-opening">
                      <strong>开头试写</strong>
                      <p>{testResult.opening}</p>
                    </div>
                    <div className="ws-style-preview-titles">
                      <strong>3 个候选标题</strong>
                      <ol>
                        {testResult.titles.map((t, i) => <li key={i}>{t}</li>)}
                      </ol>
                    </div>
                  </div>
                ) : null}
              </section>

              <details
                className="ws-manual ws-style-raw"
                open={markdownOpen}
                onToggle={e => {
                  const open = e.currentTarget.open
                  setMarkdownOpen(open)
                  if (open && (previewStale || !previewMarkdown)) {
                    void refreshRenderedMarkdown(draftProfile)
                  }
                }}
              >
                <summary>查看底层生成的规则文件（可选）</summary>
                <div className="ws-style-raw-head">
                  <span className="ws-muted ws-small">
                    {renderingMd ? '正在按最新修改重生成…' : previewStale ? '你刚修改了风格，点击刷新查看最新规则' : '已与上方风格体检卡同步'}
                  </span>
                  <button type="button" className="ws-link" disabled={renderingMd} onClick={() => void refreshRenderedMarkdown(draftProfile)}>
                    刷新预览
                  </button>
                </div>
                {previewMarkdown ? (
                  <div className="ws-style-raw-grid">
                    <div>
                      <strong>writer.md</strong>
                      <pre>{previewMarkdown.writer}</pre>
                    </div>
                    <div>
                      <strong>headline.md</strong>
                      <pre>{previewMarkdown.headline}</pre>
                    </div>
                  </div>
                ) : null}
              </details>
            </div>
          ) : null}

          {step === 3 && draftProfile ? (
            <div key="step-3" className={`ws-style-step ${stepClass}`}>
              <div className="ws-style-subcard">
                <h3>准备启用：{draftProfile.name}</h3>
                <p className="ws-muted">{draftProfile.summary}</p>
              </div>

              <div className="ws-style-section">
                <h3>选择生效范围</h3>
                <label className="ws-style-scope-item">
                  <input
                    type="checkbox"
                    checked={scopes.writer}
                    disabled={Boolean(busy)}
                    onChange={e => setScopes(prev => ({ ...prev, writer: e.target.checked }))}
                  />
                  <span>
                    <strong>写正文与对话改稿</strong>
                    <small className="ws-muted">新建「从选题写」以及稿面左侧对话改稿时按你的口吻来写</small>
                  </span>
                </label>
                <label className="ws-style-scope-item">
                  <input
                    type="checkbox"
                    checked={scopes.headline}
                    disabled={Boolean(busy)}
                    onChange={e => setScopes(prev => ({ ...prev, headline: e.target.checked }))}
                  />
                  <span>
                    <strong>出标题与摘要</strong>
                    <small className="ws-muted">生成标题候选和文章摘要时按你的标题习惯，并自动保留已有的数据复盘规则</small>
                  </span>
                </label>
              </div>

              <p className="ws-muted ws-small">
                安全提示：如果你之前手动改过规则文件，启用或取消某项范围前都会自动备份，不会丢失；之后在「技能」页随时可以一键恢复内置默认风格。
              </p>
            </div>
          ) : null}

          {error ? <p className="ws-warn" role="alert">{error}</p> : null}
        </div>

        <div className="ws-dialog-foot">
          {step === 1 ? (
            <>
              <span className="ws-muted ws-small">已选 {totalSamples} 篇参考文章</span>
              <span className="ws-grow" />
              {busy === 'analyze' ? (
                <button type="button" className="ws-btn" onClick={cancelRunning}>取消分析</button>
              ) : (
                <button type="button" className="ws-btn" onClick={close}>取消</button>
              )}
              <button
                type="button"
                className="ws-btn is-primary"
                disabled={Boolean(busy) || totalSamples === 0}
                onClick={() => void runAnalyze()}
              >
                {busy === 'analyze' ? '正在分析写作风格…' : '分析我的写作风格'}
              </button>
            </>
          ) : step === 2 ? (
            <>
              <button type="button" className="ws-btn" disabled={busy === 'apply'} onClick={() => { if (busy) cancelRunning(); setStep(1) }}>上一步：重选文章</button>
              <span className="ws-grow" />
              <button type="button" className="ws-btn is-primary" disabled={Boolean(busy) || !draftProfile} onClick={() => setStep(3)}>下一步：确认启用</button>
            </>
          ) : (
            <>
              <button type="button" className="ws-btn" disabled={Boolean(busy)} onClick={() => setStep(2)}>上一步：返回微调</button>
              <span className="ws-grow" />
              <button
                type="button"
                className="ws-btn is-primary"
                disabled={Boolean(busy) || (!scopes.writer && !scopes.headline)}
                onClick={() => void runApply()}
              >
                {busy === 'apply' ? '正在启用…' : returnTo === 'new' ? '启用并继续写稿' : '启用我的写作风格'}
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  )
}

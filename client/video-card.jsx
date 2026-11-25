// 公众号视频装裱卡：稿纸内实时展示 + 一键复制富文本 + 可视化配置弹窗（带所见即所得实时预览）。
import React from 'react'
import {
  formatVideoCardMarkdown,
  isVideoCardText,
  normalizeVideoCard,
  parseVideoCardBlock,
  renderVideoCardHtml,
  VIDEO_CARD_STYLES,
} from '../src/video-card.js'
import { SlidingTabs, useDialogClose } from './motion.jsx'
import { copyRichText } from './state.js'

export { isVideoCardText, parseVideoCardBlock }

function themeOf(layoutStyle, palette) {
  return {
    st: layoutStyle || 'std',
    main: palette?.main || '#C9643E',
    soft: palette?.soft || '#FCF6F2',
    tint: palette?.tint || '#F7E3D5',
    line: palette?.line || '#DAB196',
    mark: palette?.mark || '#FCE7A6',
  }
}

export function VideoCardBlock({ text, layoutStyle, palette, onEdit }) {
  const card = React.useMemo(() => parseVideoCardBlock(text), [text])
  const theme = React.useMemo(() => themeOf(layoutStyle, palette), [layoutStyle, palette])
  const html = React.useMemo(() => (card ? renderVideoCardHtml(card, theme) : ''), [card, theme])
  if (!card) return null
  const styleMeta = VIDEO_CARD_STYLES.find(item => item.id === card.style) ?? VIDEO_CARD_STYLES[0]
  return (
    <div className="ws-paper-video">
      <div className="ws-paper-video-bar">
        <span className="ws-tag">视频装裱 · {styleMeta.name}</span>
        <div className="ws-paper-video-actions">
          <button
            type="button"
            className="ws-link"
            onClick={event => {
              event.stopPropagation()
              void copyRichText(html, '已复制视频装裱卡，贴进公众号后删掉框内提示行，点顶部「视频」插入即可')
            }}
          >
            复制装裱卡
          </button>
          {onEdit ? (
            <button
              type="button"
              className="ws-link"
              onClick={event => {
                event.stopPropagation()
                onEdit()
              }}
            >
              编辑装裱
            </button>
          ) : null}
        </div>
      </div>
      <div
        className={`ws-paper-video-stage${layoutStyle === 'dark' ? ' is-dark' : ''}`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}

export function VideoCardInsert({ card, layoutStyle, palette, onInsert, onClose, onUpload, Icon }) {
  const fileInput = React.useRef(null)
  const heading = React.useId()
  const existing = React.useMemo(() => parseVideoCardBlock(card.selection), [card.selection])
  const initialTitle = existing ? existing.title : (card.selection?.trim() && !card.selection.includes('\n') ? card.selection.trim() : '实机演示片段')

  const [style, setStyle] = React.useState(existing?.style ?? 'cinema')
  const [index, setIndex] = React.useState(existing ? existing.index : 'CASE 01')
  const [title, setTitle] = React.useState(initialTitle)
  const [model, setModel] = React.useState(existing ? existing.model : '1080P · 60FPS')
  const [duration, setDuration] = React.useState(existing ? existing.duration : '00:30')
  const [spec, setSpec] = React.useState(existing ? existing.spec : 'REC.709')
  const [note, setNote] = React.useState(existing ? existing.note : '')
  const [poster, setPoster] = React.useState(existing ? existing.poster : '')
  const [file, setFile] = React.useState(null)
  const [localPreview, setLocalPreview] = React.useState('')
  const [uploading, setUploading] = React.useState(false)
  const [error, setError] = React.useState('')

  const { closing, requestClose } = useDialogClose(onClose)
  const close = () => { if (!uploading) requestClose() }

  React.useEffect(() => {
    const onKey = event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [uploading])

  React.useEffect(() => {
    if (!file) { setLocalPreview(''); return }
    const url = URL.createObjectURL(file)
    setLocalPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const usesModel = style !== 'studio'
  const specLabel = style === 'cinema' ? '右下规格标签（选填）' : '右上规格标签（选填）'
  const modelLabel = style === 'editorial' ? '右上参数（选填）' : '模型 / 设备参数（选填）'
  const posterInvalid = Boolean(!file && poster.trim() && !/^https?:\/\/\S+$/i.test(poster.trim()))

  const draftSpec = React.useMemo(() => normalizeVideoCard({
    style,
    index,
    title,
    model: usesModel ? model : '',
    duration,
    spec,
    note,
    poster: localPreview ? '' : poster,
  }), [style, index, title, model, usesModel, duration, spec, note, poster, localPreview])

  const previewSpec = React.useMemo(() => ({
    ...draftSpec,
    poster: localPreview || draftSpec.poster,
  }), [draftSpec, localPreview])

  const theme = React.useMemo(() => themeOf(layoutStyle, palette), [layoutStyle, palette])
  const previewHtml = React.useMemo(() => renderVideoCardHtml(previewSpec, theme), [previewSpec, theme])
  const activeStyleMeta = VIDEO_CARD_STYLES.find(item => item.id === style) ?? VIDEO_CARD_STYLES[0]

  const chooseFile = next => {
    if (!next) return
    if (next.size > 10 * 1024 * 1024) { setError('封面预览图不能超过 10 MB。'); return }
    setFile(next)
    setError('')
  }

  const submit = async event => {
    event.preventDefault()
    if (uploading) return
    setError('')
    try {
      let nextPoster = poster.trim()
      if (file) {
        setUploading(true)
        nextPoster = await onUpload(file)
        setPoster(nextPoster)
        setFile(null)
      }
      if (nextPoster && !/^https?:\/\/\S+$/i.test(nextPoster)) {
        throw new Error('封面地址需要是有效的 HTTP 或 HTTPS 链接。')
      }
      await onInsert(formatVideoCardMarkdown({
        style,
        index,
        title,
        model: usesModel ? model : '',
        duration,
        spec,
        note,
        poster: nextPoster,
      }))
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div
      className={`ws-scrim${closing ? ' is-closing' : ''}`}
      onMouseDown={e => { if (e.target === e.currentTarget) close() }}
    >
      <div
        className="ws-dialog ws-video-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={heading}
      >
        <form className="ws-video-dialog-form" onSubmit={submit}>
          <div className="ws-dialog-head">
            <div className="ws-video-head-copy">
              <h2 id={heading} className="ws-dialog-title">{existing ? '编辑视频装裱卡' : '插入视频装裱卡'}</h2>
              <p className="ws-muted ws-small">纯内联样式与白名单 SVG；贴进公众号编辑器后，删掉框内提示行，再点顶部「视频」（本地上传 / 素材库 / 视频链接）插入即可。</p>
            </div>
            <button type="button" className="ws-icon-btn" aria-label="关闭" disabled={uploading} onClick={close}>
              <Icon name="close" />
            </button>
          </div>

          <div className="ws-video-workbench">
            <div className="ws-video-form">
              <div className="ws-video-style-picker">
                <SlidingTabs activeKey={style} className="ws-tabs" role="radiogroup" aria-label="视频装裱样式">
                  {VIDEO_CARD_STYLES.map(item => (
                    <button
                      key={item.id}
                      type="button"
                      role="radio"
                      aria-checked={style === item.id}
                      className={style === item.id ? 'is-on' : ''}
                      disabled={uploading}
                      onClick={() => setStyle(item.id)}
                    >
                      {item.name}
                    </button>
                  ))}
                </SlidingTabs>
                <p className="ws-muted ws-small">{activeStyleMeta.desc}</p>
              </div>

              <div className="ws-video-grid-2">
                <label>
                  编号 / 角标（选填）
                  <input value={index} maxLength={24} disabled={uploading} placeholder="CASE 01" onChange={e => setIndex(e.target.value)} />
                </label>
                <label>
                  时长（选填）
                  <input value={duration} maxLength={16} disabled={uploading} placeholder="00:30" onChange={e => setDuration(e.target.value)} />
                </label>
              </div>

              <label>
                视频标题
                <input value={title} maxLength={60} disabled={uploading} placeholder="实机演示片段" onChange={e => setTitle(e.target.value)} />
              </label>

              {usesModel ? (
                <div className="ws-video-grid-2">
                  <label>
                    {modelLabel}
                    <input value={model} maxLength={48} disabled={uploading} placeholder="例如：1080P · 60FPS 或拍摄机型" onChange={e => setModel(e.target.value)} />
                  </label>
                  <label>
                    {specLabel}
                    <input value={spec} maxLength={28} disabled={uploading} placeholder="REC.709" onChange={e => setSpec(e.target.value)} />
                  </label>
                </div>
              ) : (
                <label>
                  {specLabel}
                  <input value={spec} maxLength={28} disabled={uploading} placeholder="REC.709" onChange={e => setSpec(e.target.value)} />
                </label>
              )}

              <label>
                底部注记（选填）
                <input value={note} maxLength={140} disabled={uploading} placeholder="例如：一镜到底实测，从打开到出结果全程 30 秒" onChange={e => setNote(e.target.value)} />
              </label>

              <div className="ws-local-image ws-video-poster-box">
                <div className="ws-local-image-actions">
                  <button type="button" className="ws-btn" disabled={uploading} onClick={() => fileInput.current?.click()}>
                    <Icon name="upload" />{file ? '更换预览画面' : '上传预览画面（选填）'}
                  </button>
                  {file || poster ? (
                    <button type="button" className="ws-link" disabled={uploading} onClick={() => { setFile(null); setPoster('') }}>
                      清空预览图
                    </button>
                  ) : null}
                  <span className="ws-muted ws-small">
                    {file ? file.name : '不上传时生成可一键删除的纯文本视频槽；也可贴预览图在稿面提前看效果。'}
                  </span>
                </div>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp,.png,.jpg,.jpeg,.gif,.webp"
                  hidden
                  onChange={event => {
                    chooseFile(event.target.files?.[0])
                    event.target.value = ''
                  }}
                />
                {!file ? (
                  <>
                    <input
                      value={poster}
                      disabled={uploading}
                      placeholder="或粘贴预览图 / GIF 地址（https://…，选填）"
                      onChange={e => setPoster(e.target.value)}
                    />
                    {posterInvalid ? <p className="ws-warn ws-small" role="alert">请输入以 http:// 或 https:// 开头的图片地址。</p> : null}
                  </>
                ) : null}
              </div>
              {error ? <p className="ws-warn" role="alert">{error}</p> : null}
            </div>

            <aside className="ws-video-live" aria-label="装裱实时预览">
              <div className="ws-video-live-head">
                <span>实时效果预览</span>
                <span className="ws-muted ws-small">自动联动文章主题色</span>
              </div>
              <div
                key={style}
                className={`ws-video-live-canvas ws-view-enter${layoutStyle === 'dark' ? ' is-dark' : ''}`}
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            </aside>
          </div>

          <div className="ws-dialog-foot">
            <button
              type="button"
              className="ws-btn"
              disabled={uploading || Boolean(file)}
              title={file ? '上传并插入后可复制完整富文本' : '直接复制公众号富文本装裱卡'}
              onClick={() => void copyRichText(previewHtml, '已复制视频装裱卡，贴进公众号后删掉框内提示行，点顶部「视频」插入即可')}
            >
              复制装裱卡
            </button>
            <span className="ws-grow" />
            <button type="button" className="ws-btn" disabled={uploading} onClick={close}>取消</button>
            <button type="submit" className="ws-btn is-primary" disabled={uploading}>
              {uploading ? '正在上传预览图…' : existing ? '更新装裱卡' : '插入装裱卡'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

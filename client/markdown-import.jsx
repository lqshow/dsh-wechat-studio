import React from 'react'
import { plainOf, splitMarkdown } from '../src/article.js'
import { countMarkdownImages, feishuImageUrls } from '../src/markdown-images.js'
import { AnimatedNumber } from './motion.jsx'

export function MarkdownImportFields({ Icon, value, onChange, locked, reading, onReadingChange }) {
  const [dragging, setDragging] = React.useState(false)
  const [fileName, setFileName] = React.useState('')
  const [fileError, setFileError] = React.useState('')
  const fileInput = React.useRef(null)
  const inputId = React.useId()
  const disabled = locked || reading
  const readFiles = async files => {
    if (disabled || !files.length) return
    if (files.length !== 1 || !/\.(md|markdown)$/i.test(files[0].name)) {
      setFileError('请选择一个 .md 或 .markdown 文件。')
      return
    }
    const file = files[0]
    if (file.size >= 2_000_000) {
      setFileError('文件过大，请拆成较小的 Markdown 文件后再导入。')
      return
    }
    setFileError('')
    onReadingChange(true)
    try {
      const text = await file.text()
      if (!text.trim()) {
        setFileError('这个 Markdown 文件没有内容。')
        return
      }
      onChange(text)
      setFileName(file.name)
    } catch {
      setFileError('读取文件失败，请重新选择。')
    } finally {
      onReadingChange(false)
    }
  }
  const dragOver = event => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = disabled ? 'none' : 'copy'
    if (!disabled) setDragging(true)
  }
  const drop = event => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    setDragging(false)
    void readFiles(event.dataTransfer.files)
  }
  const preview = React.useMemo(() => {
    if (!value.trim()) return null
    const { title, blocks } = splitMarkdown(value)
    return {
      title,
      chars: Array.from(blocks.map(plainOf).join('').replace(/\s/g, '')).length,
      images: countMarkdownImages(blocks),
      transfers: feishuImageUrls(blocks.map(text => ({ text }))).length,
    }
  }, [value])
  return (
    <div className="ws-import-workbench">
      <div className={`ws-import-source ${dragging ? 'is-dragging' : ''}`} onDragOver={dragOver}
        onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false) }} onDrop={drop}>
        <div className="ws-import-source-head">
          <label htmlFor={`${inputId}-markdown`}>文章 Markdown</label>
          <button type="button" className="ws-btn" disabled={disabled} onClick={() => fileInput.current?.click()}>
            <Icon name="upload" />{reading ? '正在读取…' : fileName ? '更换文件' : '选择文件'}
          </button>
          <input ref={fileInput} type="file" accept=".md,.markdown" hidden onChange={event => {
            void readFiles(event.target.files)
            event.target.value = ''
          }} />
        </div>
        <textarea id={`${inputId}-markdown`} required readOnly={disabled} rows={preview ? 12 : 8} value={value}
          placeholder="粘贴 Markdown，或把 .md 文件拖到这里" onChange={event => onChange(event.target.value)} />
        {fileName ? <p className="ws-import-file-name" title={fileName}>已载入 {fileName}</p> : null}
        {fileError ? <p className="ws-warn" role="alert">{fileError}</p> : null}
      </div>
      <aside className="ws-import-summary" aria-label="导入预检">
        <h3><Icon name="doc" />导入预检</h3>
        {preview ? <>
          <div className="ws-import-title"><span>识别到的标题</span><strong>{preview.title || '未识别到一级标题'}</strong></div>
          <dl className="ws-import-metrics">
            <div><dt>估算字数</dt><dd><AnimatedNumber value={preview.chars} format={v => Math.round(v).toLocaleString('zh-CN')} /></dd></div>
            <div><dt>正文图片</dt><dd><AnimatedNumber value={preview.images} /></dd></div>
          </dl>
          <p className="ws-import-transfer"><Icon name="upload" />{preview.transfers
            ? `${preview.transfers} 张飞书图片将在导入后后台转存`
            : '没有需要转存的飞书图片'}</p>
        </> : <p className="ws-muted">载入 Markdown 后，在这里查看标题、字数和图片。</p>}
      </aside>
    </div>
  )
}

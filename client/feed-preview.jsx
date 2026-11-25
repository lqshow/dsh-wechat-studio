// 信息流卡片预览：按微信发表预览截图进行视觉模拟，展示订阅号信息流大图卡与转发给好友卡片。
import React from 'react'
import { buildFeedCardModel, FEED_PREVIEW_WIDTHS, MAX_FEED_DRAFT_TITLE_CHARS, MAX_FEED_MP_TITLE_CHARS } from './feed-preview-model.js'
import { SlidingTabs } from './motion.jsx'

export function FeedCardPreview({ article, brand, mp }) {
  const [widthId, setWidthId] = React.useState('375')
  const [avatarFailed, setAvatarFailed] = React.useState(false)
  const [coverFailed, setCoverFailed] = React.useState(false)
  const [titleClamped, setTitleClamped] = React.useState(false)
  const titleRef = React.useRef(null)

  const model = React.useMemo(
    () => buildFeedCardModel({ article, brand, mp }),
    [article, brand, mp],
  )
  const selectedWidth = FEED_PREVIEW_WIDTHS.find(item => item.id === widthId) ?? FEED_PREVIEW_WIDTHS[0]

  React.useEffect(() => { setAvatarFailed(false) }, [model.avatarUrl])
  React.useEffect(() => { setCoverFailed(false) }, [model.coverUrl])

  React.useLayoutEffect(() => {
    const el = titleRef.current
    if (!el || model.titleEmpty) {
      setTitleClamped(false)
      return
    }
    let cancelled = false
    const measure = () => {
      if (cancelled || !titleRef.current) return
      const node = titleRef.current
      setTitleClamped(node.scrollHeight > node.clientHeight + 1)
    }
    measure()
    let observer = null
    if (typeof ResizeObserver === 'function') {
      observer = new ResizeObserver(measure)
      observer.observe(el)
    }
    document.fonts?.ready?.then(measure).catch(() => {})
    return () => {
      cancelled = true
      observer?.disconnect()
    }
  }, [widthId, model.title, model.titleEmpty])

  const showAvatar = Boolean(model.avatarUrl) && !avatarFailed
  const showCover = Boolean(model.coverUrl) && !coverFailed
  const displayTitle = model.titleEmpty ? '（暂未填写标题）' : model.title
  const displaySummary = model.summary || '暂未填写摘要'

  return (
    <section className="ws-feed" aria-label="信息流卡片预览">
      <div className="ws-feed-toolbar">
        <SlidingTabs activeKey={selectedWidth.id} className="ws-tabs" role="radiogroup" aria-label="模拟手机屏宽">
          {FEED_PREVIEW_WIDTHS.map(option => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selectedWidth.id === option.id}
              className={selectedWidth.id === option.id ? 'is-on' : ''}
              onClick={() => setWidthId(option.id)}
            >
              {option.label}
            </button>
          ))}
        </SlidingTabs>
        <div className="ws-feed-status" role="status">
          <span
            className={`ws-feed-pill ${
              model.titleEmpty || model.titleOverMpLimit
                ? 'is-warn'
                : model.titleOverDraftLimit
                  ? 'is-caution'
                  : ''
            }`}
          >
            {model.titleEmpty
              ? '标题 0 字 · 缺少标题'
              : model.titleOverMpLimit
                ? `标题 ${model.titleChars} / ${MAX_FEED_MP_TITLE_CHARS} 字 · 超出公众号后台上限`
                : model.titleOverDraftLimit
                  ? `标题 ${model.titleChars} 字 · 超出草稿箱推送 ${MAX_FEED_DRAFT_TITLE_CHARS} 字上限（后台手动可填 ${MAX_FEED_MP_TITLE_CHARS} 字）`
                  : `标题 ${model.titleChars} / ${MAX_FEED_DRAFT_TITLE_CHARS} 字`}
          </span>
          {titleClamped ? (
            <span className="ws-feed-pill is-warn">当前屏宽下第 2 行已触发截断</span>
          ) : null}
        </div>
      </div>

      <div className="ws-feed-stage">
        <div className="ws-feed-phone" style={{ width: `${selectedWidth.width}px` }}>
          <div className="ws-feed-group">
            <div className="ws-feed-label">订阅号信息流大图卡</div>
            <article className="ws-feed-card ws-feed-hero">
              <header className="ws-feed-account">
                {showAvatar ? (
                  <img
                    className="ws-feed-avatar"
                    src={model.avatarUrl}
                    alt=""
                    referrerPolicy="no-referrer"
                    onError={() => setAvatarFailed(true)}
                  />
                ) : (
                  <span className="ws-feed-avatar is-fallback" aria-hidden="true">{model.avatarText}</span>
                )}
                <span className="ws-feed-account-name">{model.accountName}</span>
              </header>
              <div className="ws-feed-cover">
                {showCover ? (
                  <img
                    src={model.coverUrl}
                    alt={model.title || '封面预览'}
                    onError={() => setCoverFailed(true)}
                  />
                ) : (
                  <div className="ws-feed-cover-empty">
                    <span>暂未生成封面</span>
                    <small>可在稿面右侧配图栏生成 2.35:1 封面</small>
                  </div>
                )}
              </div>
              <h2
                ref={titleRef}
                className={`ws-feed-hero-title ${model.titleEmpty ? 'is-empty' : ''}`}
              >
                {displayTitle}
              </h2>
            </article>
          </div>

          <div className="ws-feed-group">
            <div className="ws-feed-label">
              转发给好友卡片
              {model.summary && model.summaryFallback ? <small> · 无摘要，已取首段正文</small> : null}
            </div>
            <article className="ws-feed-card ws-feed-share">
              <h3 className={`ws-feed-share-title ${model.titleEmpty ? 'is-empty' : ''}`}>
                {displayTitle}
              </h3>
              <div className="ws-feed-share-body">
                <p className={`ws-feed-share-summary ${!model.summary ? 'is-empty' : ''}`}>
                  {displaySummary}
                </p>
                <div className="ws-feed-share-thumb">
                  {showCover ? (
                    <img
                      src={model.coverUrl}
                      alt=""
                      onError={() => setCoverFailed(true)}
                    />
                  ) : (
                    <span aria-hidden="true">无封面</span>
                  )}
                </div>
              </div>
              <footer className="ws-feed-share-foot">
                公众号 · {model.accountName}
              </footer>
            </article>
          </div>
        </div>
      </div>
    </section>
  )
}

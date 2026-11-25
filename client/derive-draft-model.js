import { cardContentVersion } from '../src/derive-shared.js'

export function deriveDraftKey(articleId, platform) {
  return `${articleId}:${platform}`
}

export function recordVersion(record) {
  return `${record?.createdAt ?? ''}:${record?.editedAt ?? ''}:${record?.variant ?? ''}`
}

export function xhsCardDraftSignature(card) {
  if (!card) return ''
  return `${cardContentVersion(card)}:${JSON.stringify(card.imageFraming ?? null)}`
}

export function hasUnsavedXhsCardDraft(record, draftEntry, cardIndex) {
  const localCard = draftEntry?.payload?.cards?.[cardIndex]
  if (!localCard) return false
  const serverCard = record?.payload?.cards?.[cardIndex]
  if (!serverCard) return true
  return xhsCardDraftSignature(localCard) !== xhsCardDraftSignature(serverCard)
}

export function mergeRedesignedXhsCardDraft({
  existingDraft,
  serverRecord,
  cardIndex,
  expectedDraftCardHash = '',
} = {}) {
  const serverCard = serverRecord?.payload?.cards?.[cardIndex] ?? null
  if (!existingDraft?.payload || !serverCard) {
    return { status: 'no-draft', nextDraft: null, serverCard }
  }
  const currentLocalCard = existingDraft.payload.cards?.[cardIndex] ?? null
  const currentLocalHash = xhsCardDraftSignature(currentLocalCard)
  if (expectedDraftCardHash && currentLocalHash && currentLocalHash !== expectedDraftCardHash) {
    return {
      status: 'local-changed',
      nextDraft: existingDraft,
      serverCard,
    }
  }
  const mergedCards = (existingDraft.payload.cards ?? []).map((card, idx) => (
    idx === cardIndex ? serverCard : card
  ))
  return {
    status: 'merged',
    nextDraft: {
      ...existingDraft,
      baseVersion: recordVersion(serverRecord),
      payload: {
        ...existingDraft.payload,
        cards: mergedCards,
      },
    },
    serverCard,
  }
}

export function resolveThreadEditorState(record, draftEntry) {
  if (record && draftEntry?.payload) {
    return {
      variant: draftEntry.variant ?? record.variant ?? 'jike',
      posts: Array.isArray(draftEntry.payload.posts) ? draftEntry.payload.posts : [],
      dirty: true,
      baseChanged: draftEntry.baseVersion !== recordVersion(record),
    }
  }
  return {
    variant: record?.variant ?? 'jike',
    posts: Array.isArray(record?.payload?.posts) ? record.payload.posts : [],
    dirty: false,
    baseChanged: false,
  }
}

export function resolveXhsEditorState(record, draftEntry) {
  if (record && draftEntry?.payload) {
    return {
      draft: draftEntry.payload,
      dirty: true,
      baseChanged: draftEntry.baseVersion !== recordVersion(record),
    }
  }
  return {
    draft: record?.payload ?? null,
    dirty: false,
    baseChanged: false,
  }
}

export function hasUnsavedDeriveDrafts(articleId, deriveDrafts) {
  if (!articleId || !deriveDrafts || typeof deriveDrafts !== 'object') return false
  const prefix = `${articleId}:`
  return Object.entries(deriveDrafts).some(([key, entry]) => key.startsWith(prefix) && Boolean(entry))
}

export function shouldConfirmDeriveAction({ action, dirty, record }) {
  if (action !== 'generate' && action !== 'delete') return { confirm: false, reason: null }
  if (dirty) return { confirm: true, reason: 'unsaved' }
  if (record?.editedAt) return { confirm: true, reason: 'edited' }
  return { confirm: false, reason: null }
}

export function buildMarkdownRefreshKey({ article, target = 'blog', fixedLines = [] } = {}) {
  const blocks = Array.isArray(article?.blocks) ? article.blocks.map(block => String(block?.text ?? '')) : []
  const normalizedFixed = Array.isArray(fixedLines) ? fixedLines.map(line => String(line ?? '')) : []
  return [
    String(article?.id ?? ''),
    String(article?.title ?? ''),
    String(target ?? 'blog'),
    JSON.stringify(normalizedFixed),
    ...blocks,
  ].join('\u0001')
}

export function canExportMarkdown({ loading, error, result } = {}) {
  return Boolean(!loading && !error && result?.markdown)
}

export function summarizeCardPreviews(settledResults) {
  const list = Array.isArray(settledResults) ? settledResults : []
  const items = list.map(entry => (
    entry?.status === 'fulfilled'
      ? { status: 'ok', url: entry.value?.url ?? '', overflow: Boolean(entry.value?.overflow) }
      : { status: 'error', error: entry?.reason?.message || '预览渲染失败' }
  ))
  const failedCount = items.filter(item => item.status === 'error').length
  if (items.length > 0 && failedCount === items.length) {
    return { status: 'error', items, failedCount, error: items[0].error }
  }
  if (failedCount > 0) {
    return {
      status: 'ready',
      items,
      failedCount,
      error: `有 ${failedCount} 张卡片预览渲染失败，可点击重试或直接下载图片。`,
    }
  }
  return { status: 'ready', items, failedCount: 0, error: null }
}

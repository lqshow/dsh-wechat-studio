// 浏览器侧的状态：Host 状态的本地镜像，加上只属于界面的视图、弹窗等。
import React from 'react'
import { DERIVE_LIMITS } from '../src/derive-shared.js'
import { isNewerRelease } from '../src/version.js'
import { deriveDraftKey, mergeRedesignedXhsCardDraft, xhsCardDraftSignature } from './derive-draft-model.js'
import { applyTestJobToDraft } from './custom-cover-style-model.js'

const BASE = 'wechat-studio/'

export function countCurrentParagraphDrafts(blocks, drafts) {
  return blocks.filter(block => drafts.has(block.id)).length
}

let snap = { data: null, error: null, view: 'paper', paperHome: true, dialog: null, toast: null, editing: null, layout: null, deriveDrafts: {}, dismissedXhsErrors: {}, pending: null, chatOpen: true, bannerTried: {}, module: 'paper', skills: null, style: null, styleWizardStep: 1, styleWizardReturnTo: null, newDialogDraft: null, settings: null, update: null, insights: null, insightsRange: 'all', insightsError: null, insightsRulePreview: null, svgCardCandidate: null, coverStyles: null, customCoverWizard: { open: false, mode: 'create', styleId: null, returnTo: null, draftSession: null }, selectedCoverStyleId: null }
const listeners = new Set()
let timer = null

export function getState() {
  return snap
}

export function setState(patch) {
  snap = { ...snap, ...(typeof patch === 'function' ? patch(snap) : patch) }
  listeners.forEach(fn => fn())
}

export function useStudio(selector) {
  return React.useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn) }, () => selector(snap))
}

export function visibleXhsError(article, dismissedErrors = {}) {
  if (!article?.xhsError || dismissedErrors[article.id] === article.xhsError) return null
  return article.xhsError
}

export function dismissXhsError(articleId, error) {
  if (!error) return
  setState(s => s.dismissedXhsErrors[articleId] === error ? s : {
    dismissedXhsErrors: { ...s.dismissedXhsErrors, [articleId]: error },
  })
}

export function resetXhsErrorDismissal(articleId) {
  setState(s => {
    if (!Object.hasOwn(s.dismissedXhsErrors, articleId)) return s
    const dismissedXhsErrors = { ...s.dismissedXhsErrors }
    delete dismissedXhsErrors[articleId]
    return { dismissedXhsErrors }
  })
}

export function toast(text, error = false) {
  const item = { text, error, at: Date.now() }
  setState({ toast: item })
  setTimeout(() => { if (snap.toast === item) setState({ toast: null }) }, error ? 6000 : 2600)
}

async function request(path, options) {
  const res = await fetch(BASE + path, options)
  let body = null
  try {
    body = await res.json()
  } catch {
    // 不是 JSON 时按状态码报错
  }
  if (!res.ok) {
    const error = new Error(body?.error || `请求失败（${res.status}）`)
    error.status = res.status
    if (body?.code) error.code = body.code
    if (body?.activeJobId) error.activeJobId = body.activeJobId
    throw error
  }
  return body
}

export function postJson(path, body, options = {}) {
  return request(path, { ...options, method: 'POST', headers: { 'content-type': 'application/json', ...(options.headers ?? {}) }, body: JSON.stringify(body) })
}

const bodyKey = (current, brand) => (current ? [current.id, current.title, current.banner?.style, current.banner?.at, current.followCard, current.endMark, brand?.author, brand?.slogan, ...current.blocks.map(b => b.text)].join('\u0001') : '')

export function loadRevisions(id, signal) {
  return request(`revisions?${new URLSearchParams({ id })}`, { signal })
}

function pruneDeriveDrafts(drafts, articles) {
  if (!drafts || !Object.keys(drafts).length) return drafts
  const alive = new Set((articles ?? []).map(a => a.id))
  let changed = false
  const next = {}
  for (const [key, entry] of Object.entries(drafts)) {
    const articleId = key.split(':')[0]
    if (alive.has(articleId)) next[key] = entry
    else changed = true
  }
  return changed ? next : drafts
}

function accept(data) {
  const prevCurrent = snap.data?.current
  const current = data.current
  // 正文变了，之前排好的版式就过期了
  const layout = snap.layout?.key === bodyKey(current, data.brand) ? snap.layout : null
  const deriveDrafts = pruneDeriveDrafts(snap.deriveDrafts, data.articles)
  setState({ data, error: null, layout, deriveDrafts })
  if (prevCurrent && current && prevCurrent.id === current.id && prevCurrent.xhsJob && !current.xhsJob) {
    if (current.xhsError) resetXhsErrorDismissal(current.id)
    if (current.xhsError) toast(current.xhsError, true)
    else if (current.derivatives?.some(d => d.platform === 'xhs')) toast('小红书卡片已全部精绘完成')
  }
  clearTimeout(timer)
  if (current?.job || current?.coverJob || current?.inlineDiagramJob || current?.xhsJob || current?.imageImport?.total) {
    timer = setTimeout(refresh, current?.xhsJob ? 650 : 900)
  }
}

export function previewMarkdownReimport(body) {
  return postJson('articles/reimport/preview', body)
}

export async function reimportMarkdown(body) {
  const data = await postJson('articles/reimport', body)
  accept(data)
  return data
}

export async function refresh() {
  try {
    accept(await request('state'))
  } catch (err) {
    setState({ error: err.message })
    clearTimeout(timer)
    timer = setTimeout(refresh, 4000)
  }
}

/** 发一个修改请求，返回是否成功。失败时弹提示，不抛出。 */
export async function act(path, body = {}, { quiet = false } = {}) {
  setState({ pending: path })
  try {
    const data = await request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: snap.data?.current?.id, ...body }) })
    // 推送草稿箱这类操作会带非致命提醒（比如封面没生成用了占位图），成功后也要让用户看到
    if (Array.isArray(data.warnings) && data.warnings.length) toast(data.warnings.join('\n'))
    accept(data)
    return true
  } catch (err) {
    if (!quiet) toast(err.message, true)
    return false
  } finally {
    setState({ pending: null })
  }
}

let viewWrite = Promise.resolve()

export function rememberArticleView(id, view) {
  viewWrite = viewWrite.then(() => saveArticleView(id, view))
  return viewWrite
}

async function saveArticleView(id, view) {
  try {
    await request('articles/view', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, view }),
    })
    setState(s => s.data ? { data: { ...s.data, articles: s.data.articles.map(item =>
      item.id === id ? { ...item, lastView: view } : item) } } : {})
  } catch (err) {
    toast(err.message, true)
  }
}

export async function uploadReport(file) {
  if (!file) return
  setState({ pending: 'zhuque/report' })
  try {
    accept(await request(`zhuque/report?id=${encodeURIComponent(snap.data.current.id)}`, { method: 'POST', headers: { 'content-type': 'application/pdf' }, body: file }))
  } catch (err) {
    toast(err.message, true)
  } finally {
    setState({ pending: null })
  }
}

export async function uploadImage(file, articleId = snap.data?.current?.id) {
  const { url } = await request(`images/upload?id=${encodeURIComponent(articleId)}`, {
    method: 'POST', headers: { 'content-type': file.type || 'application/octet-stream' }, body: file,
  })
  return url
}

export async function uploadPortrait(file) {
  const { url } = await request('settings/portrait', {
    method: 'POST', headers: { 'content-type': file.type || 'application/octet-stream' }, body: file,
  })
  return url
}

export async function copyText(text, done) {
  let ok = false
  try {
    await navigator.clipboard.writeText(text)
    ok = true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.style.cssText = 'position:fixed;opacity:0;left:-999px'
    document.body.appendChild(area)
    area.select()
    try { ok = document.execCommand('copy') } catch { ok = false }
    area.remove()
  }
  toast(ok ? done : '浏览器没让写剪贴板，请手动复制', !ok)
  return ok
}

export async function copyRichText(html, done = '已复制动画卡片') {
  const plain = html.replace(/<[^>]+>/g, '')
  let ok = false
  const legacy = event => {
    event.clipboardData.setData('text/html', html)
    event.clipboardData.setData('text/plain', plain)
    event.preventDefault()
    ok = true
  }
  document.addEventListener('copy', legacy)
  try { ok = document.execCommand('copy') && ok } catch { ok = false }
  document.removeEventListener('copy', legacy)
  if (!ok && navigator.clipboard && window.ClipboardItem) {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' }),
      })])
      ok = true
    } catch {}
  }
  toast(ok ? done : '浏览器没让写剪贴板，请在排版预览中复制', !ok)
  return ok
}

export async function copyDetectionText() {
  try {
    const { text } = await request(`detection-text?id=${encodeURIComponent(snap.data.current.id)}`)
    await copyText(text, `已复制检测文本（${text.length} 字），贴到朱雀去检测`)
  } catch (err) {
    toast(err.message, true)
  }
}

export async function copyMarkdown() {
  try {
    const { markdown } = await request(`markdown?id=${encodeURIComponent(snap.data.current.id)}`)
    await copyText(markdown, '已复制 Markdown')
  } catch (err) {
    toast(err.message, true)
  }
}

export function loadPortableMarkdown(id, target = 'blog', signal) {
  return request(`derive/markdown?${new URLSearchParams({ id, target })}`, signal ? { signal } : undefined)
}

export function setDeriveDraft(articleId, platform, entry) {
  if (!articleId || !platform) return
  const key = deriveDraftKey(articleId, platform)
  setState(s => ({
    deriveDrafts: { ...s.deriveDrafts, [key]: entry },
  }))
}

export function clearDeriveDraft(articleId, platform) {
  if (!articleId || !platform) return
  const key = deriveDraftKey(articleId, platform)
  setState(s => {
    if (!Object.hasOwn(s.deriveDrafts, key)) return s
    const next = { ...s.deriveDrafts }
    delete next[key]
    return { deriveDrafts: next }
  })
}

export function clearArticleDeriveDrafts(articleId) {
  if (!articleId) return
  const prefix = `${articleId}:`
  setState(s => {
    const keys = Object.keys(s.deriveDrafts).filter(k => k.startsWith(prefix))
    if (!keys.length) return s
    const next = { ...s.deriveDrafts }
    for (const k of keys) delete next[k]
    return { deriveDrafts: next }
  })
}

export async function generateDerivative({
  id,
  platform,
  variant,
  designPrompt = '',
  referenceImages = [],
  confirmOverwrite = false,
}) {
  const targetId = id ?? snap.data?.current?.id
  if (platform === 'xhs') resetXhsErrorDismissal(targetId)
  setState({ pending: `derive/${platform}` })
  try {
    const cleanRefs = Array.isArray(referenceImages)
      ? referenceImages.filter(Boolean).slice(0, DERIVE_LIMITS.xhs.referenceImages)
      : []
    const data = await postJson('derive/generate', {
      id: targetId,
      platform,
      variant,
      ...(platform === 'xhs'
        ? {
          designPrompt: String(designPrompt ?? ''),
          ...(cleanRefs.length ? { referenceImages: cleanRefs } : {}),
          async: true,
        }
        : {}),
      confirmOverwrite,
    })
    clearDeriveDraft(targetId, platform)
    accept(data)
    return { ok: true }
  } catch (err) {
    if (err.status === 409 && err.code === 'edited') {
      return { ok: false, needsConfirm: true }
    }
    toast(err.message, true)
    return { ok: false }
  } finally {
    setState({ pending: null })
  }
}

export async function redesignXhsCard({
  id,
  cardIndex,
  cardPrompt = '',
  referenceImages = [],
  baseCardHash = '',
  expectedDraftCardHash = '',
}) {
  const targetId = id ?? snap.data?.current?.id
  const key = deriveDraftKey(targetId, 'xhs')
  const startDraftCard = snap.deriveDrafts?.[key]?.payload?.cards?.[cardIndex] ?? null
  const capturedDraftHash = expectedDraftCardHash || xhsCardDraftSignature(startDraftCard)
  const cleanRefs = Array.isArray(referenceImages) ? referenceImages.filter(Boolean).slice(0, 2) : []
  setState({ pending: `derive/xhs/card/${cardIndex}` })
  try {
    const data = await postJson('derive/redesign-card', {
      id: targetId,
      cardIndex,
      cardPrompt: String(cardPrompt ?? ''),
      ...(cleanRefs.length ? { referenceImages: cleanRefs } : {}),
      baseCardHash: String(baseCardHash ?? ''),
    })
    const serverRecord = data.current?.derivatives?.find(item => item.platform === 'xhs') ?? null
    const existingDraft = snap.deriveDrafts?.[key]
    accept(data)
    const merged = mergeRedesignedXhsCardDraft({
      existingDraft,
      serverRecord,
      cardIndex,
      expectedDraftCardHash: capturedDraftHash,
    })
    if (merged.status === 'merged' && merged.nextDraft) {
      setDeriveDraft(targetId, 'xhs', merged.nextDraft)
    }
    return {
      ok: true,
      card: merged.serverCard,
      localChanged: merged.status === 'local-changed',
    }
  } catch (err) {
    if (err.status === 409 && err.code === 'card_conflict') {
      toast(err.message || '该页卡片在重设计期间已有变动，请刷新后重试。', true)
      return { ok: false, conflict: true }
    }
    toast(err.message, true)
    return { ok: false }
  } finally {
    setState({ pending: null })
  }
}

export async function saveDerivative({ id, platform, payload }) {
  const targetId = id ?? snap.data?.current?.id
  const ok = await act('derive/update', { id: targetId, platform, payload })
  if (ok) clearDeriveDraft(targetId, platform)
  return ok
}

export async function deleteDerivative({ id, platform }) {
  const targetId = id ?? snap.data?.current?.id
  const ok = await act('derive/delete', { id: targetId, platform })
  if (ok) clearDeriveDraft(targetId, platform)
  return ok
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function loadLayout() {
  const id = snap.data?.current?.id
  if (!id) return
  const key = bodyKey(snap.data.current, snap.data.brand)
  const loading = { loading: true, key }
  setState({ layout: loading })
  try {
    const result = await request(`layout?id=${encodeURIComponent(id)}`)
    if (snap.layout === loading) setState({ layout: { html: result.html, report: result.report, key } })
  } catch (err) {
    if (snap.layout === loading) setState({ layout: { error: err.message, key } })
  }
}

export async function loadSkills() {
  try {
    setState({ skills: await request('skills') })
  } catch (err) {
    setState({ skills: { error: err.message } })
  }
}

export async function loadStyleProfile() {
  try {
    setState({ style: await request('style/profile') })
  } catch (err) {
    setState({ style: { error: err.message } })
  }
}

export function openStyleWizard(step = 1, { returnTo = null } = {}) {
  setState({ dialog: 'style-wizard', styleWizardStep: step, styleWizardReturnTo: returnTo })
  void loadStyleProfile()
}

export function analyzeStyle(payload, signal) {
  return postJson('style/analyze', payload, signal ? { signal } : undefined)
}

export function previewStyle(payload, signal) {
  return postJson('style/preview', payload, signal ? { signal } : undefined)
}

export function renderStyleMarkdown(profile, signal) {
  return postJson('style/render', { profile }, signal ? { signal } : undefined)
}

export async function applyStyle(payload) {
  const result = await postJson('style/apply', payload)
  setState(s => ({
    style: { ...result.state, previewMarkdown: result.previewMarkdown },
    skills: s.skills ? { ...s.skills, skills: result.skills } : s.skills,
  }))
  await refresh()
  return result
}

export async function restoreStyle({ restoreBackup = false } = {}) {
  const result = await postJson('style/restore', { restoreBackup })
  setState(s => ({
    style: { ...result.state, previewMarkdown: result.previewMarkdown },
    skills: s.skills ? { ...s.skills, skills: result.skills } : s.skills,
  }))
  await refresh()
  const backupNote = result.backedUp?.length ? `（手改内容已备份：${result.backedUp.join('、')}）` : ''
  const insightsNote = result.preservedInsights ? '，已保留数据复盘规则' : ''
  toast(`${restoreBackup ? '已恢复你之前的自定义规则' : '已恢复内置默认风格'}${insightsNote}${backupNote}`)
  return result
}

export async function loadSettings() {
  try {
    setState({ settings: await request('settings') })
    return true
  } catch (err) {
    toast(err.message, true)
    return false
  }
}

export async function loadVersion() {
  try {
    const result = await request('version')
    const newer = result.updateAvailable ?? isNewerRelease(result.latest, result.current)
    setState({ update: result.latest && newer ? { latest: result.latest } : null })
  } catch {
    // An offline update check should never interrupt the writing surface.
  }
}

/** 保存设置。成功返回 true；朱雀密钥有没有设置会影响稿面，所以顺手刷新一次状态。 */
export async function saveSettings(patch) {
  try {
    setState({ settings: await request('settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) }) })
    await refresh()
    return true
  } catch (err) {
    toast(err.message, true)
    return false
  }
}

/** 试一次朱雀接口。返回 {ok, tokens} 或 {error}。 */
export async function testZhuque(patch) {
  try {
    return await request('zhuque/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) })
  } catch (err) {
    return { error: err.message }
  }
}

/** 试一次公众号凭证。返回 {ok, nickname, headImg} 或 {error}；验证成功后刷新全局状态以同步缓存的公众号头像。 */
export async function testWechat(patch) {
  try {
    const result = await request('wechat/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) })
    if (result?.ok) await refresh()
    return result
  } catch (err) {
    return { error: err.message }
  }
}

export async function loadModels() {
  return request('models')
}

// ---------- 复盘 ----------

function acceptInsights(data) {
  setState({ insights: data, insightsRange: data.range, insightsError: null })
}

export async function loadInsights(range) {
  const target = range ?? snap.insightsRange ?? 'all'
  try {
    acceptInsights(await request(`insights/data?${new URLSearchParams({ range: target })}`))
  } catch (err) {
    setState({ insightsError: err.message })
  }
}

export async function importInsights(file) {
  if (!file) return false
  setState({ pending: 'insights/import' })
  try {
    acceptInsights(await request(`insights/import?${new URLSearchParams({ name: file.name, range: snap.insightsRange })}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file }))
    toast(`已导入「${file.name}」`)
    return true
  } catch (err) {
    toast(err.message, true)
    return false
  } finally {
    setState({ pending: null })
  }
}

async function insightsMutate(path, body) {
  setState({ pending: path })
  try {
    acceptInsights(await request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, range: snap.insightsRange }) }))
    return true
  } catch (err) {
    toast(err.message, true)
    return false
  } finally {
    setState({ pending: null })
  }
}

/** articleId：稿件 id；null 保持未匹配；'auto' 清掉手动指定、回到按标题自动对。 */
export const matchInsight = (key, articleId) => insightsMutate('insights/match', { key, articleId })
export const matchInsightDetail = (key, articleKey) => insightsMutate('insights/detail-match', { key, articleKey })
export const setInsightDetailTopic = (key, topic) => insightsMutate('insights/detail-topic', { key, topic })
export const saveInsightExperiment = experiment => insightsMutate('insights/experiment', experiment)
export const setInsightHook = (key, hook) => insightsMutate('insights/hook', { key, hook })

export async function previewInsightRule(ruleId) {
  const range = snap.insightsRange
  setState({ pending: 'insights/rule-preview' })
  try {
    const preview = await request('insights/rule-preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ruleId, range }) })
    setState({ insightsRulePreview: { ...preview, range } })
    return preview
  } catch (err) {
    toast(err.message, true)
    return null
  } finally {
    setState({ pending: null })
  }
}

export async function applyInsightRule(ruleId) {
  setState({ pending: 'insights/rule-apply' })
  try {
    const result = await request('insights/rule-apply', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ruleId, range: snap.insightsRulePreview?.range }) })
    setState({ insightsRulePreview: null })
    toast(`已写进 ${result.skill}.md`)
    return result
  } catch (err) {
    toast(err.message, true)
    return null
  } finally {
    setState({ pending: null })
  }
}

export const closeInsightRule = () => setState({ insightsRulePreview: null })

// ---------- 自定义封面风格 ----------

let coverStyleTestTimer = null
let coverStyleTestPollEpoch = 0
let dismissedTestJobId = null
const MAX_TEST_POLL_ERRORS = 5

function stopCoverStyleTestPoll() {
  coverStyleTestPollEpoch++
  if (coverStyleTestTimer) {
    clearTimeout(coverStyleTestTimer)
    coverStyleTestTimer = null
  }
}

function updateActiveTestJob(job) {
  setState(s => {
    const visibleJob = job && job.jobId === dismissedTestJobId && job.status !== 'running' ? null : job
    const nextCoverStyles = s.coverStyles
      ? { ...s.coverStyles, activeTestJob: visibleJob }
      : { styles: [], warnings: [], visionSupport: null, activeTestJob: visibleJob, loading: false, error: null }
    let nextWizard = s.customCoverWizard
    const sessionJobId = nextWizard?.draftSession?.testJobId
    if (visibleJob?.status === 'succeeded' && nextWizard?.draftSession?.draft && sessionJobId && sessionJobId === visibleJob.jobId) {
      const updatedDraft = applyTestJobToDraft(nextWizard.draftSession.draft, visibleJob, sessionJobId)
      nextWizard = {
        ...nextWizard,
        draftSession: {
          ...nextWizard.draftSession,
          draft: updatedDraft,
        },
      }
    }
    return { coverStyles: nextCoverStyles, customCoverWizard: nextWizard }
  })
}

export async function pollCustomCoverStyleTest(jobId = '', consecutiveErrors = 0) {
  const epoch = ++coverStyleTestPollEpoch
  if (coverStyleTestTimer) {
    clearTimeout(coverStyleTestTimer)
    coverStyleTestTimer = null
  }
  try {
    const query = jobId ? `?${new URLSearchParams({ jobId })}` : ''
    const job = await request(`cover-styles/test-status${query}`)
    if (epoch !== coverStyleTestPollEpoch) return null
    updateActiveTestJob(job)
    if (job?.status === 'running') {
      coverStyleTestTimer = setTimeout(() => { void pollCustomCoverStyleTest(job.jobId, 0) }, 900)
    } else if (job?.status === 'succeeded') {
      if (!snap.customCoverWizard?.open && snap.customCoverWizard?.draftSession?.testJobId === job.jobId) {
        toast('自定义封面样图已试生成，可返回继续编辑')
      }
    } else if (job?.status === 'failed' && job.error) {
      toast(job.error, true)
    }
    return job
  } catch (err) {
    if (epoch !== coverStyleTestPollEpoch) return null
    if (err.status === 404) {
      updateActiveTestJob(null)
      return null
    }
    const nextErrors = consecutiveErrors + 1
    if (nextErrors < MAX_TEST_POLL_ERRORS) {
      coverStyleTestTimer = setTimeout(() => { void pollCustomCoverStyleTest(jobId, nextErrors) }, 2500)
      return null
    }
    const prev = snap.coverStyles?.activeTestJob
    const failedJob = prev
      ? { ...prev, status: 'failed', error: err.message || '网络异常，无法继续查询试生成进度，请稍后重试。' }
      : null
    updateActiveTestJob(failedJob)
    toast(failedJob?.error || err.message, true)
    return null
  }
}

export async function loadCoverStyles() {
  setState(s => ({
    coverStyles: {
      styles: s.coverStyles?.styles ?? [],
      warnings: s.coverStyles?.warnings ?? [],
      visionSupport: s.coverStyles?.visionSupport ?? null,
      activeTestJob: s.coverStyles?.activeTestJob ?? null,
      loading: true,
      error: null,
    },
  }))
  try {
    const res = await request('cover-styles')
    const rawJob = res.activeTestJob ?? null
    let nextActiveJob = null
    setState(s => {
      const serverJob = rawJob && rawJob.jobId === dismissedTestJobId && rawJob.status !== 'running' ? null : rawJob
      const prevJob = s.coverStyles?.activeTestJob ?? null
      const sessionJobId = s.customCoverWizard?.draftSession?.testJobId ?? null
      const keepLocalFailed = !serverJob
        && prevJob?.status === 'failed'
        && prevJob.jobId !== dismissedTestJobId
        && Boolean(sessionJobId && prevJob.jobId === sessionJobId)
      nextActiveJob = serverJob ?? (keepLocalFailed ? prevJob : null)
      return {
        coverStyles: {
          styles: Array.isArray(res.styles) ? res.styles : [],
          warnings: Array.isArray(res.warnings) ? res.warnings : [],
          visionSupport: res.visionSupport ?? null,
          activeTestJob: nextActiveJob,
          loading: false,
          error: null,
        },
      }
    })
    if (nextActiveJob?.status === 'running') {
      stopCoverStyleTestPoll()
      const epoch = coverStyleTestPollEpoch
      coverStyleTestTimer = setTimeout(() => {
        if (epoch === coverStyleTestPollEpoch) void pollCustomCoverStyleTest(nextActiveJob.jobId, 0)
      }, 900)
    }
    return res
  } catch (err) {
    setState(s => ({
      coverStyles: {
        styles: s.coverStyles?.styles ?? [],
        warnings: s.coverStyles?.warnings ?? [],
        visionSupport: s.coverStyles?.visionSupport ?? null,
        activeTestJob: s.coverStyles?.activeTestJob ?? null,
        loading: false,
        error: err.message,
      },
    }))
    return null
  }
}

export async function loadCustomCoverStyle(id) {
  const res = await request(`cover-styles/item?${new URLSearchParams({ id })}`)
  return res.style
}

export async function analyzeCustomCoverStyle(payload) {
  return postJson('cover-styles/analyze', payload)
}

export async function startCustomCoverStyleTest(payload) {
  try {
    const job = await postJson('cover-styles/test-generate', payload)
    dismissedTestJobId = null
    updateActiveTestJob(job)
    stopCoverStyleTestPoll()
    const epoch = coverStyleTestPollEpoch
    coverStyleTestTimer = setTimeout(() => {
      if (epoch === coverStyleTestPollEpoch) void pollCustomCoverStyleTest(job.jobId, 0)
    }, 900)
    return job
  } catch (err) {
    if (err.status === 409 && err.activeJobId) {
      dismissedTestJobId = null
      toast('已有样图正在后台试生成，请等待当前任务完成后再试。')
      void pollCustomCoverStyleTest(err.activeJobId, 0)
      return null
    }
    throw err
  }
}

export async function saveCustomCoverStyle(payload) {
  const res = await postJson('cover-styles/save', payload)
  const active = snap.coverStyles?.activeTestJob ?? null
  if (active?.status !== 'running') {
    stopCoverStyleTestPoll()
    if (active?.jobId) dismissedTestJobId = active.jobId
  }
  setState(s => {
    const curActive = s.coverStyles?.activeTestJob ?? null
    return {
      coverStyles: {
        styles: Array.isArray(res.styles) ? res.styles : [],
        warnings: Array.isArray(res.warnings) ? res.warnings : [],
        visionSupport: s.coverStyles?.visionSupport ?? null,
        activeTestJob: curActive?.status === 'running' ? curActive : null,
        loading: false,
        error: null,
      },
      selectedCoverStyleId: s.customCoverWizard?.returnTo === 'cover'
        ? (res.style?.id ?? null)
        : s.selectedCoverStyleId,
    }
  })
  return res
}

export async function deleteCustomCoverStyle(id) {
  const res = await postJson('cover-styles/delete', { id })
  setState(s => {
    const dropSession = s.customCoverWizard?.styleId === id || s.customCoverWizard?.draftSession?.draft?.id === id
    return {
      coverStyles: {
        styles: Array.isArray(res.styles) ? res.styles : [],
        warnings: Array.isArray(res.warnings) ? res.warnings : [],
        visionSupport: s.coverStyles?.visionSupport ?? null,
        activeTestJob: s.coverStyles?.activeTestJob ?? null,
        loading: false,
        error: null,
      },
      customCoverWizard: dropSession
        ? { open: false, mode: 'create', styleId: null, returnTo: null, draftSession: null }
        : s.customCoverWizard,
      selectedCoverStyleId: s.selectedCoverStyleId === id ? null : s.selectedCoverStyleId,
    }
  })
  return res
}

export function openCustomCoverStyleWizard({ mode = 'create', styleId = null, returnTo = null, resume = false } = {}) {
  setState(s => ({
    dialog: returnTo === 'cover' ? null : s.dialog,
    customCoverWizard: resume && s.customCoverWizard?.draftSession
      ? { ...s.customCoverWizard, open: true, returnTo: returnTo ?? s.customCoverWizard.returnTo }
      : {
        open: true,
        mode,
        styleId,
        returnTo,
        draftSession: null,
      },
  }))
}

export function updateCustomCoverWizardSession(draftSession) {
  setState(s => ({
    customCoverWizard: {
      ...s.customCoverWizard,
      draftSession,
    },
  }))
}

export function closeCustomCoverStyleWizard({ preserveSession = false } = {}) {
  setState(s => {
    const returnTo = s.customCoverWizard?.returnTo
    const reopenCover = returnTo === 'cover' && Boolean(s.data?.current)
    const active = s.coverStyles?.activeTestJob ?? null
    let nextCoverStyles = s.coverStyles
    if (!preserveSession && active && active.status !== 'running') {
      dismissedTestJobId = active.jobId
      nextCoverStyles = s.coverStyles ? { ...s.coverStyles, activeTestJob: null } : s.coverStyles
    }
    return {
      dialog: reopenCover ? 'cover' : s.dialog,
      coverStyles: nextCoverStyles,
      customCoverWizard: preserveSession
        ? { ...s.customCoverWizard, open: false }
        : { open: false, mode: 'create', styleId: null, returnTo: null, draftSession: null },
    }
  })
}

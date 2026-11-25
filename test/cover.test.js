import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { deflateSync } from 'node:zlib'
import { createArticle } from '../src/article.js'
import { callModel, COVER_SKILL_DIR } from '../src/ai.js'
import { buildCoverPromptRequest } from '../src/cover-prompt.js'
import { coverDownloadName, generateArkCover, generateBailianCover, generateCoverImage, generateGeminiCover, generateMinimaxCover, generateOpenAICover, normalizeGeminiBaseUrl, normalizeOpenAIBaseUrl, readCover, saveCover } from '../src/cover.js'
import { BAILIAN_SIZES, COVER_PROVIDERS, GEMINI_DEFAULT_BASE_URL, INLINE_IMAGE_SIZES, MINIMAX_SIZES, OPENAI_DEFAULT_BASE_URL, OPENAI_LEGACY_LANDSCAPE_SIZE, OPENAI_SIZES, modelsFor, providerFormats, providerMeta } from '../src/cover-options.js'
import { normalizeImageFormat } from '../src/image-crop.js'
import { COVER_STYLES, CUSTOM_COVER_STYLE_LIMITS, extractTemplateSlots, hasPortraitMarkers, isCustomStyleId, resolveCoverStyleName } from '../src/cover-styles.js'
import { PNG } from 'pngjs'
import { AUTHOR_SAMPLE_PORTRAIT, publicSettings, readSettings, updateSettings } from '../src/settings.js'
import { Store } from '../src/store.js'

const DASHSCOPE = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'
const ARK = 'https://ark.cn-beijing.volces.com/api/v3/images/generations'
const MINIMAX_GEN = 'https://api.minimax.cn/v1/images/generations'
const MINIMAX_EDIT = 'https://api.minimax.cn/v1/images/edits'
const IMAGE_URL = 'https://dashscope-result.example/cover.png'
const MD = '# 封面测试标题\n\n这是一段用来生成封面的正文内容，写得稍微长一点方便模型理解主题。\n\n第二段补充一些细节，让素材更完整。'

const crcTable = (() => {
  const table = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()
const crc32 = buf => {
  let crc = 0xffffffff
  for (const byte of buf) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
// 造一张真实可被 sips 读取裁切的纯色 PNG，宽高取 47:20 的整数倍。
function makePng(width, height) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 2
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    const off = y * (width * 3 + 1)
    for (let x = 0; x < width; x++) { const p = off + 1 + x * 3; raw[p] = 0x33; raw[p + 1] = 0x66; raw[p + 2] = 0x99 }
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
const jsonReply = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const generationReply = () => ({ ok: true, status: 200, json: async () => ({ output: { choices: [{ message: { content: [{ image: IMAGE_URL }] } }] } }) })

test('封面下载文件名：包含标题、风格、日期和序号，清理特殊字符并限制标题长度', () => {
  const run = { style: 'kinetic', format: 'png', createdAt: '2026-11-17T10:00:00', images: [{ id: 'a' }, { id: 'b' }] }
  assert.equal(coverDownloadName({ title: '提示词/写作：第二版*' }, run, 'b'), '提示词 写作：第二版-动感大字-2026-11-17-100000-02.png')
  assert.equal(coverDownloadName({ title: '文'.repeat(60) }, { images: [{ id: 'a' }] }, 'a'), `${'文'.repeat(48)}-封面-01.png`)
})

test('百炼封面：千问模型共用多模态接口，关掉自动扩写，下载 PNG 落盘', async () => {
  const png = makePng(94, 40)
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    return url === DASHSCOPE ? generationReply() : new Response(png)
  }
  const image = await generateBailianCover('提示词', { apiKey: 'sk-x', model: 'qwen-image-3.0-pro', resolution: '2K', referenceImage: 'https://example.com/portrait.png' }, fetchImpl)
  assert.ok(image.equals(png))
  assert.equal(calls[0].url, DASHSCOPE)
  assert.equal(calls[0].init.headers.authorization, 'Bearer sk-x')
  const body = JSON.parse(calls[0].init.body)
  assert.equal(body.model, 'qwen-image-3.0-pro')
  assert.deepEqual(body.input.messages[0].content.map(part => Object.keys(part)[0]), ['image', 'text'])
  assert.equal(body.input.messages[0].content[0].image, 'https://example.com/portrait.png')
  assert.equal(body.input.messages[0].content[1].text, '提示词')
  assert.equal(body.parameters.size, BAILIAN_SIZES['2K'])
  assert.equal(body.parameters.prompt_extend, false)
  assert.equal(body.parameters.n, 1)
  assert.equal(body.parameters.watermark, false)
  assert.equal(calls[1].url, IMAGE_URL)
})

test('百炼封面：万相模型不传 prompt_extend，1K 用显式宽高', async () => {
  const png = makePng(94, 40)
  let body
  const fetchImpl = async (url, init) => {
    if (url === DASHSCOPE) { body = JSON.parse(init.body); return generationReply() }
    return new Response(png)
  }
  await generateBailianCover('p', { apiKey: 'k', model: 'wan2.7-image', resolution: '1K' }, fetchImpl)
  assert.equal(body.parameters.size, BAILIAN_SIZES['1K'])
  assert.ok(!('prompt_extend' in body.parameters))
})

test('封面：不传参考图时只发提示词，不带任何默认人物图', async () => {
  const png = makePng(94, 40)
  let bailianBody
  const bailianFetch = async (url, init) => {
    if (url === DASHSCOPE) { bailianBody = JSON.parse(init.body); return generationReply() }
    return new Response(png)
  }
  await generateBailianCover('p', { apiKey: 'k', model: 'wan2.7-image', resolution: '2K' }, bailianFetch)
  assert.deepEqual(bailianBody.input.messages[0].content, [{ text: 'p' }])
  let arkBody
  const arkFetch = async (url, init) => {
    arkBody = JSON.parse(init.body)
    return { ok: true, status: 200, json: async () => ({ data: [{ b64_json: png.toString('base64') }] }) }
  }
  await generateArkCover('p', { apiKey: 'k', model: 'm', resolution: '2K', format: 'png' }, arkFetch)
  assert.ok(!('image' in arkBody))
})

test('百炼封面：鉴权/限流/审核/通用报错分别映射', async () => {
  const opts = { apiKey: 'k', model: 'wan2.7-image', resolution: '2K' }
  await assert.rejects(generateBailianCover('p', opts, jsonReply(400, { code: 'InvalidApiKey' })), /百炼鉴权失败/)
  await assert.rejects(generateBailianCover('p', opts, jsonReply(401, {})), /百炼鉴权失败/)
  await assert.rejects(generateBailianCover('p', opts, jsonReply(429, { code: 'Throttling' })), /百炼限流/)
  await assert.rejects(generateBailianCover('p', opts, jsonReply(400, { code: 'DataInspectionFailed' })), /内容审核/)
  await assert.rejects(generateBailianCover('p', opts, jsonReply(500, {})), /HTTP 500/)
})

test('百炼封面：没图、下载失败、非 PNG 都报错', async () => {
  const opts = { apiKey: 'k', model: 'wan2.7-image', resolution: '2K' }
  await assert.rejects(generateBailianCover('p', opts, jsonReply(200, { output: { choices: [{ message: { content: [{ text: '无图' }] } }] } })), /未返回可保存的封面/)
  const dlFail = async url => (url === DASHSCOPE ? generationReply() : { ok: false, status: 403 })
  await assert.rejects(generateBailianCover('p', opts, dlFail), /下载失败/)
  const jpeg = Buffer.from('ffd8ff00', 'hex')
  const notPng = async url => (url === DASHSCOPE ? generationReply() : new Response(jpeg))
  await assert.rejects(generateBailianCover('p', opts, notPng), /有效的 PNG/)
})

test('百炼封面：非 HTTPS 地址不发请求', async () => {
  const opts = { apiKey: 'k', model: 'wan2.7-image', resolution: '2K' }
  const fetchImpl = async url => {
    assert.equal(url, DASHSCOPE)
    return Response.json({ output: { choices: [{ message: { content: [{ image: 'http://example.com/cover.png' }] } }] } })
  }
  await assert.rejects(generateBailianCover('p', opts, fetchImpl), /无效的 HTTPS/)
})

test('百炼封面：未声明大小的下载超过上限时取消读取', async () => {
  const opts = { apiKey: 'k', model: 'wan2.7-image', resolution: '2K' }
  const chunk = new Uint8Array(4 * 1024 * 1024)
  let cancelled = false
  const body = new ReadableStream({
    pull(controller) { controller.enqueue(chunk) },
    cancel() { cancelled = true },
  })
  const fetchImpl = async url => url === DASHSCOPE ? generationReply() : new Response(body)
  await assert.rejects(generateBailianCover('p', opts, fetchImpl), /超过 24 MB/)
  assert.equal(cancelled, true)
})

test('封面设置：提供方/模型按白名单校验，密钥不回传明文', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ws-cover-settings-'))
  const def = await readSettings(root)
  assert.equal(def.coverProvider, 'ark')
  assert.equal(def.arkModel, modelsFor('ark')[0].id)
  assert.equal(def.bailianModel, modelsFor('bailian')[0].id)
  const pub = publicSettings(await updateSettings(root, { coverProvider: 'bailian', bailianKey: '  sk-bailian-9999  ', bailianModel: 'wan2.7-image-pro' }))
  assert.equal(pub.coverProvider, 'bailian')
  assert.equal(pub.bailianModel, 'wan2.7-image-pro')
  assert.equal(pub.bailianKeySet, true)
  assert.ok(!JSON.stringify(pub).includes('bailian-9999'))
  assert.equal((await readSettings(root)).bailianKey, 'sk-bailian-9999')
  await assert.rejects(updateSettings(root, { coverProvider: 'nope' }), /封面提供方/)
  await assert.rejects(updateSettings(root, { bailianModel: modelsFor('ark')[0].id }), /百炼封面模型/)
  await assert.rejects(updateSettings(root, { arkModel: modelsFor('bailian')[0].id }), /封面模型/)
  assert.deepEqual(providerFormats('bailian'), ['png'])
  assert.deepEqual(providerFormats('ark'), ['png', 'jpeg'])
})

test('封面设置：IP 人物参考图默认为空，只收 https，留空清除', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ws-portrait-settings-'))
  assert.equal((await readSettings(root)).portraitUrl, '', '开源默认不带任何人的照片')
  const pub = publicSettings(await updateSettings(root, { portraitUrl: '  https://example.com/me.png  ' }))
  assert.equal(pub.portraitUrl, 'https://example.com/me.png')
  assert.equal((await readSettings(root)).portraitUrl, 'https://example.com/me.png')
  await assert.rejects(updateSettings(root, { portraitUrl: 'http://example.com/me.png' }), /https/)
  await assert.rejects(updateSettings(root, { portraitUrl: 'https://user:pass@example.com/me.png' }), /https/)
  await assert.rejects(updateSettings(root, { portraitUrl: '不是地址' }), /https/)
  assert.equal(publicSettings(await updateSettings(root, { portraitUrl: '' })).portraitUrl, '')
  assert.equal((await readSettings(root)).portraitUrl, '', '显式清空后不回落到默认地址')
})

test('设置：persona 校验、保存和公开', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ws-persona-settings-'))
  assert.deepEqual((await readSettings(root)).persona, { gender: 'auto', outfit: 'photo', outfitText: '', appearance: '' })
  const saved = await updateSettings(root, { persona: { gender: 'female', outfit: 'custom', outfitText: ' 米白色亚麻衬衫 ', appearance: '齐肩黑发' } })
  assert.deepEqual(publicSettings(saved).persona, { gender: 'female', outfit: 'custom', outfitText: '米白色亚麻衬衫', appearance: '齐肩黑发' })
  assert.deepEqual((await readSettings(root)).persona.outfitText, '米白色亚麻衬衫')
  await assert.rejects(updateSettings(root, { persona: { outfit: 'custom', outfitText: '  ' } }), /服装描述/)
  await assert.rejects(updateSettings(root, { persona: { gender: 'robot' } }), /性别/)
  const partial = await updateSettings(root, { persona: { gender: 'male' } })
  assert.equal(partial.persona.outfitText, '米白色亚麻衬衫', '只改性别时保留其他字段')
  await assert.rejects(updateSettings(root, { persona: { outfitText: 'an excited smile' } }), /服装描述里有封面禁用词「excited」/)
  await assert.rejects(updateSettings(root, { persona: { appearance: '眼神发亮' } }), /外貌补充里有封面禁用词/)
  assert.equal((await readSettings(root)).persona.outfitText, '米白色亚麻衬衫', '校验失败不落盘')
})

test('设置：已落盘的作者示例照片保留，但标记出来', async () => {
  const { writeFile } = await import('node:fs/promises')
  const root = mkdtempSync(join(tmpdir(), 'ws-author-portrait-'))
  await writeFile(join(root, 'settings.json'), JSON.stringify({ portraitUrl: AUTHOR_SAMPLE_PORTRAIT }))
  const settings = await readSettings(root)
  assert.equal(settings.portraitUrl, AUTHOR_SAMPLE_PORTRAIT, '不静默清空，作者本机还要用')
  assert.equal(publicSettings(settings).portraitIsAuthorSample, true)
  assert.equal(publicSettings(await updateSettings(root, { portraitUrl: 'https://example.com/me.png' })).portraitIsAuthorSample, false)
})

// 读真实模板数出占位符个数，再挑一个不含禁用词的填充值，让 coverPrompt 校验通过。
async function coverLLM(style = 'classic') {
  const templateName = style === 'classic' ? 'prompt_template.md' : `prompt_template_${style}.md`
  const template = await readFile(join(COVER_SKILL_DIR, `references/${templateName}`), 'utf8')
  const body = template.match(/^```[^\n]*\n([\s\S]*?)^```[ \t]*$/m)?.[1]?.trim()
  const terms = (await readFile(join(COVER_SKILL_DIR, 'references/blocklist.txt'), 'utf8'))
    .split(/\r?\n/).map(line => line.trim().toLowerCase()).filter(line => line && !line.startsWith('#'))
  let filler = '封面示例'
  while (terms.some(term => filler.toLowerCase().includes(term))) filler += '字'
  const values = [...body.matchAll(/\{\{([^{}]+)\}\}/g)].map(match => (match[1].startsWith('人物段') ? '无人物' : filler))
  return { prepareCall: async () => ({ config: {}, async *stream() { yield { type: 'text-delta', text: JSON.stringify({ values }) }; yield { type: 'finish', reason: { kind: 'stop' } } } }) }
}

async function coverHost({ provider, key, model, fetchImpl, llm }) {
  const { route } = await import('../src/host.js')
  const store = new Store(mkdtempSync(join(tmpdir(), 'ws-cover-host-')))
  const article = createArticle({ markdown: MD })
  await store.update(state => { state.articles.push(article); state.currentId = article.id })
  const settings = { coverProvider: provider }
  const meta = providerMeta(provider)
  settings[meta.keyField] = key
  if (model) settings[meta.modelField] = model
  await updateSettings(store.root, settings)
  const services = llm ? { llm, agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) } } : {}
  const deps = { ctx: { get: name => services[name] ?? null }, store, pipeline: { job: () => null }, fetchImpl }
  const request = async (path, payload) => {
    const req = { url: '/wechat-studio/' + path, method: payload ? 'POST' : 'GET', async *[Symbol.asyncIterator]() { if (payload) yield Buffer.from(JSON.stringify(payload)) } }
    let result
    await route(deps, req, { setHeader() {}, end(value) { result = JSON.parse(value) } })
    return result
  }
  const requestImage = async path => {
    const req = { url: '/wechat-studio/' + path, method: 'GET' }
    const headers = {}
    let body
    await route(deps, req, { setHeader(name, value) { headers[name] = value }, end(value) { body = value } })
    return { headers, body }
  }
  return { store, article, request, requestImage }
}

async function waitCover(request) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const { current } = await request('state')
    const run = current.coverRuns?.at(-1)
    if (!current.coverJob && run && run.status !== 'running') return current
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.fail('封面生成未结束')
}

test('封面路由：按提供方查 Key，百炼只收 png', async () => {
  const ark = await coverHost({ provider: 'ark', key: '' })
  assert.match((await ark.request('cover/generate', { id: ark.article.id, style: 'classic', format: 'png' })).error, /火山方舟 API Key/)
  assert.match((await ark.request('cover/generate', { id: ark.article.id, style: 'classic', format: 'jpeg' })).error, /火山方舟 API Key/, 'ark 接受 jpeg，过了格式闸才查 Key')
  const bl = await coverHost({ provider: 'bailian', key: '' })
  assert.match((await bl.request('cover/generate', { id: bl.article.id, style: 'classic', format: 'png' })).error, /百炼 API Key/)
  assert.match((await bl.request('cover/generate', { id: bl.article.id, style: 'classic', format: 'jpeg' })).error, /只支持 png/)
})

test('封面路由：百炼走多模态接口并落盘，记录提供方', async () => {
  const png = makePng(94, 40)
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    return url === DASHSCOPE ? generationReply() : new Response(png)
  }
  const { article, request, requestImage } = await coverHost({ provider: 'bailian', key: 'sk-bl', model: 'wan2.7-image-pro', fetchImpl, llm: await coverLLM() })
  const res = await request('cover/generate', { id: article.id, style: 'classic', resolution: '2K', count: 1, format: 'png' })
  assert.ok(!res.error, res.error)
  const current = await waitCover(request)
  assert.equal(calls[0].url, DASHSCOPE)
  assert.equal(JSON.parse(calls[0].init.body).model, 'wan2.7-image-pro')
  assert.equal(current.coverError, null)
  assert.equal(current.coverRuns.at(-1).status, 'succeeded')
  assert.equal(current.coverRuns.at(-1).images.length, 1)
  assert.equal(current.cover.provider, 'bailian')
  assert.equal(current.cover.model, 'wan2.7-image-pro')
  const download = await requestImage(`cover/image?id=${article.id}&asset=${current.cover.id}&download=1`)
  assert.ok(Buffer.isBuffer(download.body))
  const disposition = download.headers['content-disposition']
  assert.match(disposition, /filename\*=UTF-8''/)
  const filename = decodeURIComponent(disposition.split("filename*=UTF-8''")[1])
  assert.equal(filename, coverDownloadName(article, current.coverRuns.at(-1), current.cover.id))
  assert.match(filename, /^封面测试标题-经典深绿-\d{4}-\d{2}-\d{2}-\d{6}-01\.png$/)
})

test('封面路由：火山方舟仍走原接口', async () => {
  const png = makePng(94, 40)
  const calls = []
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({ data: [{ b64_json: png.toString('base64') }] }) } }
  const { store, article, request } = await coverHost({ provider: 'ark', key: 'sk-ark', model: 'doubao-seedream-5-5-261028', fetchImpl, llm: await coverLLM() })
  await updateSettings(store.root, { portraitUrl: 'https://example.com/me.png' })
  await request('cover/generate', { id: article.id, style: 'classic', resolution: '2K', count: 1, format: 'png' })
  const current = await waitCover(request)
  assert.equal(calls[0].url, ARK)
  assert.equal(JSON.parse(calls[0].init.body).model, 'doubao-seedream-5-5-261028')
  assert.equal(JSON.parse(calls[0].init.body).image, 'https://example.com/me.png')
  assert.equal(current.coverRuns.at(-1).status, 'succeeded')
  assert.equal(current.cover.provider, 'ark')
})

test('封面路由：火山方舟详细错误写入生成记录，并清理敏感信息', async () => {
  const apiKey = 'sk-ark-secret'
  const fetchImpl = async () => Response.json({
    error: { code: 'InvalidParameter', message: `提示词参数无效\n请检查请求，密钥 ${apiKey} 不应写入历史。${'补'.repeat(700)}` },
  }, { status: 400, headers: { 'x-request-id': 'req-ark-123' } })
  const { article, request } = await coverHost({ provider: 'ark', key: apiKey, fetchImpl, llm: await coverLLM() })
  await request('cover/generate', { id: article.id, style: 'classic', resolution: '2K', count: 1, format: 'png' })
  const current = await waitCover(request)
  const error = current.coverRuns.at(-1).errors[0]
  assert.match(error, /HTTP 400/)
  assert.match(error, /InvalidParameter/)
  assert.match(error, /提示词参数无效/)
  assert.match(error, /req-ark-123/)
  assert.ok(!error.includes(apiKey))
  assert.ok(!error.includes('\n'))
  assert.ok(error.length < 700)
  assert.equal(current.coverError, error)
})

test('火山方舟封面：无法读取详细错误时保留通用提示', async () => {
  const opts = { apiKey: 'k', model: 'm', resolution: '2K', format: 'png' }
  await assert.rejects(generateArkCover('p', opts, jsonReply(400, {})), /HTTP 400.*请重试/)
  await assert.rejects(generateArkCover('p', opts, jsonReply(400, { error: { code: 'ModelNotOpen', message: 'provider detail' } })), /尚未开通/)
})
test('封面模板：每种风格都有带占位符的提示词代码块', async () => {
  for (const style of COVER_STYLES) {
    const templateName = style.id === 'classic' ? 'prompt_template.md' : `prompt_template_${style.id}.md`
    const template = await readFile(join(COVER_SKILL_DIR, `references/${templateName}`), 'utf8')
    const body = template.match(/^```[^\n]*\n([\s\S]*?)^```[ \t]*$/m)?.[1]?.trim()
    assert.ok(body, `${style.id} 模板缺少提示词代码块`)
    assert.ok([...body.matchAll(/\{\{([^{}]+)\}\}/g)].length > 0, `${style.id} 模板没有占位符`)
  }
})

const PERSON_TEMPLATES = {
  'prompt_template.md': ['[[SUBJECT]]', '[[OUTFIT]]'],
  'prompt_template_editorial.md': ['[[SUBJECT]]', '[[OUTFIT]]'],
  'prompt_template_campaign.md': ['[[SUBJECT]]', '[[OUTFIT]]'],
  'prompt_template_kinetic.md': ['[[SUBJECT]]', '[[OUTFIT]]'],
  'prompt_template_grunge.md': ['[[SUBJECT]]', '[[OUTFIT]]'],
  'prompt_template_magenta.md': ['[[人物]]', '[[服装]]'],
  'prompt_template_felt.md': [],
}
const HARDCODED = /midnight green|#004953|#1E3329|午夜绿|asian male|男性程序员|深灰色圆领|深灰 ?T ?恤|深绿圆领|thin black wire-frame|薄黑圆框眼镜|waffle|华夫格|\bpolo\b|\bLQ\b/i

test('封面模板：人物和服装只来自宿主占位符', async () => {
  for (const [name, markers] of Object.entries(PERSON_TEMPLATES)) {
    const template = await readFile(join(COVER_SKILL_DIR, `references/${name}`), 'utf8')
    const body = template.match(/^```[^\n]*\n([\s\S]*?)^```[ \t]*$/m)?.[1] ?? ''
    for (const marker of markers) assert.ok(body.includes(marker), `${name} 的代码块缺少 ${marker}`)
    assert.ok(!HARDCODED.test(template), `${name} 还写死了人物或服装：${template.match(HARDCODED)?.[0]}`)
    assert.ok(!/\{\{服装/.test(body), `${name} 不应再让 LLM 选服装`)
  }
  const felt = await readFile(join(COVER_SKILL_DIR, 'references/prompt_template_felt.md'), 'utf8')
  assert.match(felt.match(/^```[^\n]*\n([\s\S]*?)^```[ \t]*$/m)[1], /\{\{人物段:只填「无人物」或「玩偶」/)
  const skill = await readFile(join(COVER_SKILL_DIR, 'SKILL.md'), 'utf8')
  assert.ok(!HARDCODED.test(skill), `SKILL.md 还写死了：${skill.match(HARDCODED)?.[0]}`)
})

test('封面路由：按设置填人物，半身照沿用照片服装，felt 不提参考图', async () => {
  const png = makePng(94, 40)
  const calls = []
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({ data: [{ b64_json: png.toString('base64') }] }) } }

  const withPhoto = await coverHost({ provider: 'ark', key: 'sk-ark', fetchImpl, llm: await coverLLM('magenta') })
  await updateSettings(withPhoto.store.root, { portraitUrl: 'https://example.com/me.png', persona: { gender: 'female', outfit: 'photo' } })
  await withPhoto.request('cover/generate', { id: withPhoto.article.id, style: 'magenta', resolution: '2K', count: 1, format: 'png' })
  await waitCover(withPhoto.request)
  const sent = JSON.parse(calls.at(-1).init.body)
  assert.equal(sent.image, 'https://example.com/me.png')
  assert.match(sent.prompt, /与参考图完全一致的同一套衣服/)
  assert.ok(!/T 恤|针织上衣/.test(sent.prompt), '沿用参考图衣服时不夹带兜底服装词')
  assert.ok(!/\[\[/.test(sent.prompt))

  await updateSettings(withPhoto.store.root, { persona: { outfit: 'simple' } })
  await withPhoto.request('cover/generate', { id: withPhoto.article.id, style: 'magenta', resolution: '2K', count: 1, format: 'png' })
  await waitCover(withPhoto.request)
  const simpleSent = JSON.parse(calls.at(-1).init.body)
  assert.match(simpleSent.prompt, /针织上衣/, '简约纯色上衣按女性性别生成')
  assert.ok(!/与参考图完全一致/.test(simpleSent.prompt))

  const felt = await coverHost({ provider: 'ark', key: 'sk-ark', fetchImpl, llm: await coverLLM('felt') })
  await updateSettings(felt.store.root, { portraitUrl: 'https://example.com/me.png', persona: { gender: 'male', outfit: 'custom', outfitText: '藏青色牛仔衬衫' } })
  await felt.request('cover/generate', { id: felt.article.id, style: 'felt', resolution: '2K', count: 1, format: 'png' })
  await waitCover(felt.request)
  const feltBody = JSON.parse(calls.at(-1).init.body)
  assert.equal(feltBody.image, undefined)
  assert.ok(!/参考图/.test(feltBody.prompt), 'felt 不带参考图，提示词里也不该提参考图')
})

test('封面路由：felt 风格不传真人参考图', async () => {
  const png = makePng(94, 40)
  const calls = []
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({ data: [{ b64_json: png.toString('base64') }] }) } }
  const { store, article, request } = await coverHost({ provider: 'ark', key: 'sk-ark', fetchImpl, llm: await coverLLM('felt') })
  await updateSettings(store.root, { portraitUrl: 'https://example.com/me.png' })
  await request('cover/generate', { id: article.id, style: 'felt', resolution: '2K', count: 1, format: 'png' })
  const current = await waitCover(request)
  assert.equal(JSON.parse(calls[0].init.body).image, undefined, 'felt 是毛毡微缩场景，不能带真人参考图')
  assert.equal(current.coverRuns.at(-1).status, 'succeeded')
  assert.equal(current.cover.style, 'felt')
})

test('saveCover：跨平台裁切落盘，失败提示不再依赖 sips', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ws-save-cover-'))
  const id = await saveCover(root, makePng(100, 40), 'png')
  const decoded = PNG.sync.read(await readCover(root, id))
  assert.equal(decoded.width, 94)
  assert.equal(decoded.height, 40)
  assert.deepEqual(await readdir(join(root, 'covers')), [`${id}.png`], '不留临时文件')
  await assert.rejects(
    saveCover(root, Buffer.from('not an image'), 'png'),
    error => !/sips/.test(error.message) && /封面裁切或保存失败/.test(error.message),
  )
})

test('MiniMax 选项与尺寸：双模型、格式、47:20 零裁切档位及浏览器安全边界', async () => {
  assert.ok(COVER_PROVIDERS.some(p => p.id === 'minimax'))
  assert.deepEqual(modelsFor('minimax').map(m => m.id), ['MiniMax-H3-Image', 'MiniMax-H3-Image-Highspeed'])
  assert.deepEqual(providerFormats('minimax'), ['png', 'jpeg'])
  assert.equal(INLINE_IMAGE_SIZES.minimax, '2048x1152')
  for (const [tier, size] of Object.entries(MINIMAX_SIZES)) {
    const [w, h] = size.split('x').map(Number)
    assert.ok(w * h >= 655_360 && w * h <= 9_400_000, `${tier}: ${size} 面积越界`)
    assert.equal(w % 47, 0, `${tier}: 宽度应为 47 的整数倍`)
    assert.equal(h % 20, 0, `${tier}: 高度应为 20 的整数倍`)
    assert.equal(w / 47, h / 20, `${tier}: 严格 47:20 零裁切`)
  }
  const source = await readFile(new URL('../src/cover-options.js', import.meta.url), 'utf8')
  assert.ok(!/from\s+['"]node:/.test(source), 'cover-options.js 必须保持浏览器安全')
})

test('MiniMax H3：无参考图走 generations 且关 Prompt 增强，有参考图走 edits', async () => {
  const png = makePng(94, 40)
  const jpeg = Buffer.from('ffd8ffe000104a464946', 'hex')
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    const body = JSON.parse(init.body)
    const img = body.output_format === 'jpeg' ? jpeg : png
    return Response.json({ data: [{ b64_json: img.toString('base64') }] })
  }

  const outPng = await generateMinimaxCover('封面提示词', {
    apiKey: 'mm-key', model: 'MiniMax-H3-Image', resolution: '2K', format: 'png',
  }, fetchImpl)
  assert.ok(outPng.equals(png))
  assert.equal(calls[0].url, MINIMAX_GEN)
  assert.equal(calls[0].init.headers.authorization, 'Bearer mm-key')
  const genBody = JSON.parse(calls[0].init.body)
  assert.equal(genBody.model, 'MiniMax-H3-Image')
  assert.equal(genBody.size, MINIMAX_SIZES['2K'])
  assert.equal(genBody.n, 1)
  assert.equal(genBody.output_format, 'png')
  assert.equal(genBody.response_format, 'b64_json')
  assert.equal(genBody.aigc_watermark, false)
  assert.equal(genBody.disable_prompt_enhanced, true)
  assert.equal('images' in genBody, false)
  assert.equal('aspect_ratio' in genBody, false)
  assert.equal('area' in genBody, false)

  const outJpeg = await generateMinimaxCover('带参考图提示词', {
    apiKey: 'mm-key', model: 'MiniMax-H3-Image-Highspeed', resolution: '1.5K', format: 'jpeg',
    referenceImage: 'https://example.com/portrait.png',
  }, fetchImpl)
  assert.ok(outJpeg.equals(jpeg))
  assert.equal(calls[1].url, MINIMAX_EDIT)
  const editBody = JSON.parse(calls[1].init.body)
  assert.equal(editBody.model, 'MiniMax-H3-Image-Highspeed')
  assert.equal(editBody.size, MINIMAX_SIZES['1.5K'])
  assert.equal(editBody.output_format, 'jpeg')
  assert.deepEqual(editBody.images, [{ image_url: 'https://example.com/portrait.png' }])
  assert.equal('disable_prompt_enhanced' in editBody, false)

  await generateMinimaxCover('插图提示词', {
    apiKey: 'mm-key', model: 'MiniMax-H3-Image', resolution: '1K', size: '2048x1152', format: 'png', subject: '插图',
  }, fetchImpl)
  assert.equal(JSON.parse(calls[2].init.body).size, '2048x1152')
})

test('MiniMax H3：超时不自动重试，返回非幂等计费提醒且不含请重试', async () => {
  let attempts = 0
  const timeoutFetch = async () => {
    attempts++
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
  }
  await assert.rejects(
    generateMinimaxCover('p', { apiKey: 'k', model: 'MiniMax-H3-Image', resolution: '2K', format: 'png' }, timeoutFetch),
    err => err.code === 'MINIMAX_TIMEOUT'
      && err.nonRetryable === true
      && /600 秒/.test(err.message)
      && /计费/.test(err.message)
      && !/请重试/.test(err.message),
  )
  assert.equal(attempts, 1)
})

test('MiniMax H3：错误码映射、body.error.code 兼容、trace_id 优先级、脱敏与 Base64 双重大小校验', async () => {
  const apiKey = 'sk-minimax-secret-123'
  const opts = { apiKey, model: 'MiniMax-H3-Image', resolution: '2K', format: 'png' }
  const reply = (status, body, headers = {}) => async () => Response.json(body, { status, headers })

  // 鉴权：401/1004 与 2049
  await assert.rejects(generateMinimaxCover('p', opts, reply(401, { error: { message: 'login fail (1004)' }, request_id: 'req-body' })), /鉴权失败.*请求 ID：req-body/)
  await assert.rejects(generateMinimaxCover('p', opts, reply(400, { error: { code: '2049', message: 'invalid api key' } })), /鉴权失败|API Key 无效/)

  // 余额/积分/套餐额度不足：402 + 1008 / 2053 / 2067
  await assert.rejects(generateMinimaxCover('p', opts, reply(402, { error: { message: 'insufficient balance (1008)' } })), /余额、积分或套餐额度不足/)
  await assert.rejects(generateMinimaxCover('p', opts, reply(402, { error: { message: 'insufficient points (2053)' } })), /余额、积分或套餐额度不足/)
  await assert.rejects(generateMinimaxCover('p', opts, reply(402, { error: { code: 2067, message: 'quota exhausted' } })), /余额、积分或套餐额度不足/)

  // 套餐不支持模型：2068（含 HTTP 402 返回 2068）与 2061 独立映射到套餐升级提示
  await assert.rejects(generateMinimaxCover('p', opts, reply(402, { error: { message: 'plan not supported (2068)' } })), /套餐等级不支持该模型.*升级套餐/)
  await assert.rejects(generateMinimaxCover('p', opts, reply(400, { error: { code: '2061', message: 'plan does not support model' } })), /套餐等级不支持该模型.*升级套餐/)

  // 模型不存在/无权使用 & 已下线：2022 / 2069
  await assert.rejects(generateMinimaxCover('p', opts, reply(400, { error: { code: '2022', message: 'model not found' } })), /模型不存在或当前账号无权使用/)
  await assert.rejects(generateMinimaxCover('p', opts, reply(400, { error: { message: 'model offline (2069)' } })), /模型已下线/)

  // 内容安全审核：422 + 1026 / 1027 & 200 下单张 data[0].error
  await assert.rejects(generateMinimaxCover('p', opts, reply(422, { error: { message: 'input sensitive (1026)' } })), /内容安全审核/)
  await assert.rejects(
    generateMinimaxCover('p', opts, reply(200, { data: [{ error: { code: '1027', message: 'output failed safety' } }] }, { trace_id: 'trace-200-err' })),
    /内容安全审核.*请求 ID：trace-200-err/,
  )

  // 限流与 M Plan 限制：429 + 1002 / 2056 / 2062
  await assert.rejects(generateMinimaxCover('p', opts, reply(429, { error: { message: 'rate limit (1002)' } })), /速率限制|用量达到上限/)
  await assert.rejects(generateMinimaxCover('p', opts, reply(429, { error: { message: 'plan limit (2056)' } })), /速率限制|用量达到上限/)
  await assert.rejects(generateMinimaxCover('p', opts, reply(429, { error: { code: '2062', message: 'm plan rate limit' } })), /速率限制|用量达到上限/)

  // 请求 ID 优先级：body.request_id -> body.error.request_id -> trace_id -> x-request-id，含非法 JSON 与脱敏/限长
  await assert.rejects(
    generateMinimaxCover('p', opts, reply(500, { error: { request_id: 'err-req-id', message: `boom Bearer ${apiKey} ${apiKey}` } }, { trace_id: 'hdr-trace' })),
    err => err.message.includes('err-req-id') && !err.message.includes(apiKey) && !err.message.includes('hdr-trace'),
  )
  await assert.rejects(
    generateMinimaxCover('p', opts, reply(500, { error: { message: 'internal (1000)' } }, { trace_id: `trace-${apiKey}-${'x'.repeat(160)}`, 'x-request-id': 'x-req' })),
    err => /请求 ID：trace-\[已隐藏\]-/.test(err.message) && !err.message.includes(apiKey) && !err.message.includes('x-req') && err.message.length < 260,
  )
  await assert.rejects(
    generateMinimaxCover('p', opts, reply(500, {}, { 'x-request-id': 'fallback-x-req' })),
    /HTTP 500.*请求 ID：fallback-x-req/,
  )
  const badJsonFetch = async () => new Response('<html>502</html>', { status: 200, headers: { trace_id: 'bad-json-trace' } })
  await assert.rejects(generateMinimaxCover('p', opts, badJsonFetch), /无效响应.*请求 ID：bad-json-trace/)

  // Base64 校验：空值、编码超限、解码后实际超 24 MB、格式魔数不符
  await assert.rejects(generateMinimaxCover('p', opts, reply(200, { data: [{}] })), /未返回可保存的封面/)
  await assert.rejects(generateMinimaxCover('p', opts, reply(200, { data: [{ b64_json: 'A'.repeat(34_000_000) }] })), /超过 24 MB/)
  // 24 MB + 3 字节 => base64 长度 33,554,436（落在编码长度上限 +16 之内，但解码后实际超过 24 MB）
  const slightlyOver24Mb = Buffer.alloc(24 * 1024 * 1024 + 3, 0x41).toString('base64')
  await assert.rejects(generateMinimaxCover('p', opts, reply(200, { data: [{ b64_json: slightlyOver24Mb }] })), /超过 24 MB/)
  await assert.rejects(generateMinimaxCover('p', opts, reply(200, { data: [{ b64_json: Buffer.from('ffd8ff00', 'hex').toString('base64') }] })), /格式不符/)

  // generateCoverImage 未知提供方报错
  await assert.rejects(generateCoverImage('unknown', 'p', opts, badJsonFetch), err => err.status === 400 && /生图提供方/.test(err.message))
})

test('MiniMax 设置与封面路由：持久化脱敏、edits/generations 分流及超时中止剩余批次', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ws-minimax-settings-'))
  const def = await readSettings(root)
  assert.equal(def.minimaxModel, 'MiniMax-H3-Image')
  assert.equal(def.minimaxKey, '')
  const pub = publicSettings(await updateSettings(root, {
    coverProvider: 'minimax',
    minimaxModel: 'MiniMax-H3-Image-Highspeed',
    minimaxKey: '  sk-mm-secret-9999  ',
  }))
  assert.equal(pub.coverProvider, 'minimax')
  assert.equal(pub.minimaxModel, 'MiniMax-H3-Image-Highspeed')
  assert.equal(pub.minimaxKeySet, true)
  assert.ok(!JSON.stringify(pub).includes('sk-mm-secret-9999'))
  assert.equal((await readSettings(root)).minimaxKey, 'sk-mm-secret-9999')
  await assert.rejects(updateSettings(root, { minimaxModel: modelsFor('ark')[0].id }), /MiniMax 封面模型/)

  // 缺 Key 拦截 & 格式支持 png/jpeg
  const noKey = await coverHost({ provider: 'minimax', key: '' })
  assert.match((await noKey.request('cover/generate', { id: noKey.article.id, style: 'classic', format: 'png' })).error, /MiniMax API Key/)
  assert.match((await noKey.request('cover/generate', { id: noKey.article.id, style: 'classic', format: 'jpeg' })).error, /MiniMax API Key/)

  // 有 portraitUrl 时 classic 走 edits，felt 不带参考图走 generations
  const png = makePng(94, 40)
  const calls = []
  const okFetch = async (url, init) => {
    calls.push({ url, init })
    return Response.json({ data: [{ b64_json: png.toString('base64') }] })
  }
  const host = await coverHost({ provider: 'minimax', key: 'sk-mm', model: 'MiniMax-H3-Image-Highspeed', fetchImpl: okFetch, llm: await coverLLM('classic') })
  await updateSettings(host.store.root, { portraitUrl: 'https://example.com/me.png' })
  await host.request('cover/generate', { id: host.article.id, style: 'classic', resolution: '2K', count: 1, format: 'png' })
  const afterClassic = await waitCover(host.request)
  assert.equal(calls[0].url, MINIMAX_EDIT)
  assert.equal(afterClassic.cover.provider, 'minimax')
  assert.equal(afterClassic.cover.model, 'MiniMax-H3-Image-Highspeed')

  const feltHost = await coverHost({ provider: 'minimax', key: 'sk-mm', fetchImpl: okFetch, llm: await coverLLM('felt') })
  await updateSettings(feltHost.store.root, { portraitUrl: 'https://example.com/me.png' })
  await feltHost.request('cover/generate', { id: feltHost.article.id, style: 'felt', resolution: '1K', count: 1, format: 'png' })
  await waitCover(feltHost.request)
  assert.equal(calls.at(-1).url, MINIMAX_GEN)
  assert.equal(JSON.parse(calls.at(-1).init.body).disable_prompt_enhanced, true)

  // count: 3 时第 1 张超时：立即停止剩余 2 张，不重试、不继续付费请求
  let timeoutCalls = 0
  const timeoutHost = await coverHost({
    provider: 'minimax',
    key: 'sk-mm',
    fetchImpl: async () => {
      timeoutCalls++
      throw new DOMException('timeout', 'TimeoutError')
    },
    llm: await coverLLM('classic'),
  })
  await timeoutHost.request('cover/generate', { id: timeoutHost.article.id, style: 'classic', resolution: '2K', count: 3, format: 'png' })
  const afterTimeout = await waitCover(timeoutHost.request)
  assert.equal(timeoutCalls, 1, 'MiniMax 超时后应立即停止剩余批次，不能继续发起付费请求')
  const run = afterTimeout.coverRuns.at(-1)
  assert.equal(run.status, 'failed')
  assert.equal(run.errors.length, 1)
  assert.match(run.errors[0], /600 秒.*计费/)
  assert.doesNotMatch(run.errors[0], /请重试/)
})

test('Gemini 提供方选项与 normalizeImageFormat 格式转换', async () => {
  assert.ok(COVER_PROVIDERS.some(p => p.id === 'gemini' && p.name === 'Google Gemini'))
  assert.deepEqual(modelsFor('gemini').map(m => m.id), [
    'gemini-nano-banana-2.1',
    'gemini-3.1-flash-image',
    'gemini-3-pro-image',
  ])
  const meta = providerMeta('gemini')
  assert.equal(meta.modelField, 'geminiModel')
  assert.equal(meta.keyField, 'geminiKey')
  assert.equal(meta.keySetField, 'geminiKeySet')
  assert.equal(meta.baseUrlField, 'geminiBaseUrl')
  assert.equal(meta.defaultBaseUrl, GEMINI_DEFAULT_BASE_URL)
  assert.equal(meta.envKey, 'GEMINI_API_KEY')
  assert.deepEqual(providerFormats('gemini'), ['png', 'jpeg'])
  assert.equal(INLINE_IMAGE_SIZES.gemini, '2K')

  const png = makePng(94, 40)
  assert.strictEqual(normalizeImageFormat(png, 'png'), png, 'PNG -> PNG 应原样返回')
  const asJpeg = normalizeImageFormat(png, 'jpeg')
  assert.equal(asJpeg.toString('hex', 0, 3), 'ffd8ff', 'PNG -> JPEG 应输出有效 JPEG')
  assert.strictEqual(normalizeImageFormat(asJpeg, 'jpeg'), asJpeg, 'JPEG -> JPEG 应原样返回')
  const backToPng = normalizeImageFormat(asJpeg, 'png')
  assert.equal(backToPng.toString('hex', 0, 8), '89504e470d0a1a0a', 'JPEG -> PNG 应输出有效 PNG')
  const parsed = PNG.sync.read(backToPng)
  assert.equal(parsed.width, 94)
  assert.equal(parsed.height, 40)
  assert.throws(() => normalizeImageFormat(Buffer.from('not-an-image'), 'png'), /Invalid image|格式/)
})

test('Gemini Nano Banana：文生图、自定义 Base URL、参考图（HTTPS & data:）、格式转码与错误映射', async () => {
  // normalizeGeminiBaseUrl
  assert.equal(normalizeGeminiBaseUrl(''), GEMINI_DEFAULT_BASE_URL)
  assert.equal(normalizeGeminiBaseUrl('  https://proxy.example.com/  '), 'https://proxy.example.com')
  assert.equal(normalizeGeminiBaseUrl('https://proxy.example.com/v1beta/'), 'https://proxy.example.com')
  assert.equal(normalizeGeminiBaseUrl('https://proxy.example.com/gemini/v1beta'), 'https://proxy.example.com/gemini')
  assert.throws(() => normalizeGeminiBaseUrl('http://proxy.example.com'), err => err.status === 400 && /https/i.test(err.message))
  assert.throws(() => normalizeGeminiBaseUrl('https://user:pass@proxy.example.com'), err => err.status === 400)

  const png = makePng(94, 40)
  const jpeg = normalizeImageFormat(png, 'jpeg')
  const calls = []
  const okFetch = (mimeType, buf) => async (url, init) => {
    calls.push({ url, init })
    return Response.json({
      candidates: [{
        content: {
          role: 'model',
          parts: [{ inlineData: { mimeType, data: buf.toString('base64') } }],
        },
        finishReason: 'STOP',
      }],
    })
  }

  // 默认官方地址 + x-goog-api-key 请求头 + 1K/1.5K/2K 映射 + JPEG 自动转 PNG
  const outPng = await generateGeminiCover('画一张封面', {
    apiKey: 'AIza-secret-123',
    model: 'gemini-nano-banana-2.1',
    resolution: '1.5K',
    format: 'png',
  }, okFetch('image/jpeg', jpeg))
  assert.equal(outPng.toString('hex', 0, 8), '89504e470d0a1a0a', '服务端返回 JPEG 时应自动转为请求的 PNG')
  assert.equal(calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-nano-banana-2.1:generateContent')
  assert.ok(!calls[0].url.includes('AIza-secret-123'), 'API Key 不能出现在 URL 中')
  assert.equal(calls[0].init.headers['x-goog-api-key'], 'AIza-secret-123')
  assert.equal(calls[0].init.redirect, 'error')
  const body0 = JSON.parse(calls[0].init.body)
  assert.deepEqual(body0.generationConfig, {
    responseModalities: ['IMAGE'],
    imageConfig: { aspectRatio: '21:9', imageSize: '2K' },
  })
  assert.deepEqual(body0.contents, [{ role: 'user', parts: [{ text: '画一张封面' }] }])

  // 自定义 Base URL（含 /v1beta/ 后缀）+ 1K + PNG 自动转 JPEG + generateCoverImage 分发
  calls.length = 0
  const outJpeg = await generateCoverImage('gemini', '封面2', {
    apiKey: 'AIza-secret-123',
    model: 'gemini-3-pro-image',
    resolution: '1K',
    format: 'jpeg',
    baseUrl: 'https://relay.example.com/v1beta/',
    aspectRatio: '16:9',
  }, okFetch('image/png', png))
  assert.equal(outJpeg.toString('hex', 0, 3), 'ffd8ff', '服务端返回 PNG 时应自动转为请求的 JPEG')
  assert.equal(calls[0].url, 'https://relay.example.com/v1beta/models/gemini-3-pro-image:generateContent')
  assert.deepEqual(JSON.parse(calls[0].init.body).generationConfig.imageConfig, { aspectRatio: '16:9', imageSize: '1K' })

  // 参考图 1：data: URL 不触发下载，直接作为 inlineData
  calls.length = 0
  const refDataUrl = `data:image/png;base64,${png.toString('base64')}`
  await generateGeminiCover('按样式生成', {
    apiKey: 'AIza-secret-123',
    model: 'gemini-3.1-flash-image',
    resolution: '2K',
    format: 'png',
    referenceImage: refDataUrl,
  }, okFetch('image/png', png))
  assert.equal(calls.length, 1, 'data: 参考图不应发起额外下载请求')
  const refParts = JSON.parse(calls[0].init.body).contents[0].parts
  assert.equal(refParts.length, 2)
  assert.deepEqual(refParts[0], { inlineData: { mimeType: 'image/png', data: png.toString('base64') } })
  assert.deepEqual(refParts[1], { text: '按样式生成' })

  // 参考图 2：https:// URL 先下载再作为 inlineData
  calls.length = 0
  const refFetch = async (url, init) => {
    calls.push({ url, init })
    if (url === 'https://example.com/portrait.jpg') {
      return new Response(jpeg, { status: 200, headers: { 'content-type': 'image/jpeg' } })
    }
    return Response.json({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: png.toString('base64') } }] } }],
    })
  }
  await generateGeminiCover('按人物生成', {
    apiKey: 'AIza-secret-123',
    model: 'gemini-nano-banana-2.1',
    resolution: '2K',
    format: 'png',
    referenceImage: 'https://example.com/portrait.jpg',
  }, refFetch)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].url, 'https://example.com/portrait.jpg')
  const httpsParts = JSON.parse(calls[1].init.body).contents[0].parts
  assert.deepEqual(httpsParts[0], { inlineData: { mimeType: 'image/jpeg', data: jpeg.toString('base64') } })

  // 错误映射与密钥脱敏
  const errReply = (status, body) => async () => Response.json(body, { status })
  const baseOpts = { apiKey: 'AIza-leak-999', model: 'gemini-nano-banana-2.1', resolution: '2K', format: 'png' }
  await assert.rejects(generateGeminiCover('p', baseOpts, errReply(401, { error: { message: 'API key not valid' } })), /鉴权失败|API Key/)
  await assert.rejects(generateGeminiCover('p', baseOpts, errReply(403, { error: { message: 'Permission denied' } })), /鉴权失败|API Key/)
  await assert.rejects(generateGeminiCover('p', baseOpts, errReply(400, { error: { status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.' } })), /鉴权失败|API Key/)
  await assert.rejects(generateGeminiCover('p', baseOpts, errReply(404, { error: { message: 'Model not found' } })), /模型不存在|暂不可用/)
  await assert.rejects(generateGeminiCover('p', baseOpts, errReply(429, { error: { message: 'Quota exceeded' } })), /限流|额度|付费层级/)
  await assert.rejects(generateGeminiCover('p', baseOpts, errReply(400, { error: { message: 'User location is not supported for the API use.' } })), /地区|自定义 API 地址/)
  await assert.rejects(
    generateGeminiCover('p', baseOpts, errReply(500, { error: { message: 'boom AIza-leak-999 x-goog-api-key AIza-leak-999' } })),
    err => /HTTP 500/.test(err.message) && !err.message.includes('AIza-leak-999'),
  )
  await assert.rejects(
    generateGeminiCover('p', baseOpts, errReply(200, { candidates: [{ finishReason: 'IMAGE_SAFETY' }] })),
    /内容安全审核/,
  )
  await assert.rejects(
    generateGeminiCover('p', baseOpts, errReply(200, { promptFeedback: { blockReason: 'SAFETY' } })),
    /内容安全审核/,
  )
  await assert.rejects(
    generateGeminiCover('p', baseOpts, errReply(200, { candidates: [{ content: { parts: [{ text: 'no image' }] } }] })),
    /未返回可保存的封面/,
  )
})

test('Gemini 设置：持久化脱敏、Base URL 规范化与非法值拦截', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ws-gemini-settings-'))
  const def = await readSettings(root)
  assert.equal(def.geminiModel, 'gemini-nano-banana-2.1')
  assert.equal(def.geminiKey, '')
  assert.equal(def.geminiBaseUrl, '')

  const updated = await updateSettings(root, {
    coverProvider: 'gemini',
    geminiModel: 'gemini-3-pro-image',
    geminiKey: '  AIza-secret-8888  ',
    geminiBaseUrl: '  https://proxy.example.com/v1beta/  ',
  })
  const pub = publicSettings(updated)
  assert.equal(pub.coverProvider, 'gemini')
  assert.equal(pub.geminiModel, 'gemini-3-pro-image')
  assert.equal(pub.geminiKeySet, true)
  assert.equal(pub.geminiBaseUrl, 'https://proxy.example.com')
  assert.ok(!JSON.stringify(pub).includes('AIza-secret-8888'))
  const reread = await readSettings(root)
  assert.equal(reread.geminiKey, 'AIza-secret-8888')
  assert.equal(reread.geminiBaseUrl, 'https://proxy.example.com')

  // 清空 Base URL 恢复默认
  const cleared = publicSettings(await updateSettings(root, { geminiBaseUrl: '' }))
  assert.equal(cleared.geminiBaseUrl, '')

  // 非法模型与非法 Base URL 拦截
  await assert.rejects(updateSettings(root, { geminiModel: modelsFor('ark')[0].id }), /Google Gemini 封面模型/)
  await assert.rejects(updateSettings(root, { geminiBaseUrl: 'http://insecure.example.com' }), /https/i)
  await assert.rejects(updateSettings(root, { geminiBaseUrl: 'https://u:p@proxy.example.com' }), /账号密码|https/i)

  // 封面路由：缺 Key 报错、自定义 Base URL 透传与正常生成
  const noKey = await coverHost({ provider: 'gemini', key: '' })
  assert.match((await noKey.request('cover/generate', { id: noKey.article.id, style: 'classic', format: 'png' })).error, /Google Gemini API Key/)
  assert.match((await noKey.request('cover/generate', { id: noKey.article.id, style: 'classic', format: 'jpeg' })).error, /Google Gemini API Key/)

  const png = makePng(94, 40)
  const calls = []
  const host = await coverHost({
    provider: 'gemini',
    key: 'AIza-route-key',
    model: 'gemini-3-pro-image',
    fetchImpl: async (url, init) => {
      calls.push({ url, init })
      return Response.json({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: png.toString('base64') } }] } }],
      })
    },
    llm: await coverLLM('classic'),
  })
  await updateSettings(host.store.root, { geminiBaseUrl: 'https://relay.example.com/v1beta/' })
  await host.request('cover/generate', { id: host.article.id, style: 'classic', resolution: '2K', count: 1, format: 'jpeg' })
  const after = await waitCover(host.request)
  assert.equal(calls[0].url, 'https://relay.example.com/v1beta/models/gemini-3-pro-image:generateContent')
  assert.equal(after.cover.provider, 'gemini')
  assert.equal(after.cover.model, 'gemini-3-pro-image')
  assert.equal(after.cover.format, 'jpeg')
  assert.equal(after.cover.baseUrl, undefined, 'baseUrl 不应写入文章封面记录')
})

test('OpenAI（GPT Image）：选项约束、Base URL 规范化、文生图、参考图编辑、格式转码与错误映射', async () => {
  // cover-options 契约
  assert.ok(COVER_PROVIDERS.some(p => p.id === 'openai'))
  assert.deepEqual(
    modelsFor('openai').map(m => m.id),
    ['gpt-image-2.6-sunburst', 'gpt-image-2.6-flare', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-flare', 'gpt-image-2', 'gpt-image-1.5'],
  )
  assert.deepEqual(providerFormats('openai'), ['png', 'jpeg'])
  assert.equal(INLINE_IMAGE_SIZES.openai, '2048x1152')
  assert.equal(providerMeta('openai').baseUrlField, 'openaiBaseUrl')
  assert.equal(providerMeta('openai').baseUrlEnvKey, 'OPENAI_BASE_URL')
  for (const [resKey, dim] of Object.entries(OPENAI_SIZES)) {
    const [w, h] = dim.split('x').map(Number)
    assert.equal(w % 16, 0, `${resKey} 宽度必须是 16 的倍数`)
    assert.equal(h % 16, 0, `${resKey} 高度必须是 16 的倍数`)
    assert.equal(w * 20, h * 47, `${resKey} 必须严格匹配 47:20`)
    assert.ok(w * h >= 655_360 && w * h <= 8_294_400, `${resKey} 面积在 OpenAI 限制内`)
    assert.ok(Math.max(w, h) <= 3840, `${resKey} 最长边不超过 3840`)
  }

  // normalizeOpenAIBaseUrl
  assert.equal(normalizeOpenAIBaseUrl(''), OPENAI_DEFAULT_BASE_URL)
  assert.equal(normalizeOpenAIBaseUrl('  https://api.openai.com  '), 'https://api.openai.com/v1')
  assert.equal(normalizeOpenAIBaseUrl('https://api.openai.com/v1/'), 'https://api.openai.com/v1')
  assert.equal(normalizeOpenAIBaseUrl('https://relay.example.com'), 'https://relay.example.com/v1')
  assert.equal(normalizeOpenAIBaseUrl('https://relay.example.com/openai/v1/'), 'https://relay.example.com/openai/v1')
  assert.equal(normalizeOpenAIBaseUrl('https://relay.example.com/custom-gw/'), 'https://relay.example.com/custom-gw')
  assert.equal(normalizeOpenAIBaseUrl('https://relay.example.com/v1/images/generations'), 'https://relay.example.com/v1')
  assert.equal(normalizeOpenAIBaseUrl('https://relay.example.com/v1/images/edits'), 'https://relay.example.com/v1')
  assert.throws(() => normalizeOpenAIBaseUrl('http://relay.example.com/v1'), err => err.status === 400 && /https/i.test(err.message))
  assert.throws(() => normalizeOpenAIBaseUrl('https://u:p@relay.example.com/v1'), err => err.status === 400)

  const png = makePng(94, 40)
  const jpeg = normalizeImageFormat(png, 'jpeg')
  const calls = []
  const okFetch = buf => async (url, init) => {
    calls.push({ url, init })
    return Response.json({ data: [{ b64_json: buf.toString('base64') }] })
  }

  // 1. 默认官方地址 + JSON /images/generations + 精确 47:20 尺寸 + 不传废弃的 response_format + JPEG 自动转 PNG
  const outPng = await generateOpenAICover('画一张封面', {
    apiKey: 'sk-openai-secret-123',
    model: 'gpt-image-2.6-sunburst',
    resolution: '1.5K',
    format: 'png',
  }, okFetch(jpeg))
  assert.equal(outPng.toString('hex', 0, 8), '89504e470d0a1a0a')
  assert.equal(calls[0].url, 'https://api.openai.com/v1/images/generations')
  assert.equal(calls[0].init.headers.authorization, 'Bearer sk-openai-secret-123')
  assert.equal(calls[0].init.headers['content-type'], 'application/json')
  assert.equal(calls[0].init.redirect, 'error')
  const body0 = JSON.parse(calls[0].init.body)
  assert.deepEqual(body0, {
    model: 'gpt-image-2.6-sunburst',
    prompt: '画一张封面',
    n: 1,
    size: '2256x960',
    output_format: 'png',
    background: 'opaque',
  })

  // 2. 自定义 Base URL + gpt-image-1.5 自动回退 1536x1024 + PNG 自动转 JPEG + generateCoverImage 分发
  calls.length = 0
  const outJpeg = await generateCoverImage('openai', '封面2', {
    apiKey: 'sk-openai-secret-123',
    model: 'gpt-image-1.5',
    resolution: '2K',
    format: 'jpeg',
    baseUrl: 'https://relay.example.com/openai/v1/',
  }, okFetch(png))
  assert.equal(outJpeg.toString('hex', 0, 3), 'ffd8ff')
  assert.equal(calls[0].url, 'https://relay.example.com/openai/v1/images/generations')
  assert.equal(JSON.parse(calls[0].init.body).size, OPENAI_LEGACY_LANDSCAPE_SIZE)
  assert.equal(JSON.parse(calls[0].init.body).output_format, 'jpeg')

  // 3. 参考图（data: URL）走 multipart/form-data /images/edits，不发额外下载请求
  calls.length = 0
  await generateOpenAICover('按参考图编辑', {
    apiKey: 'sk-openai-secret-123',
    model: 'gpt-image-2.6-flare',
    resolution: '1K',
    format: 'png',
    referenceImage: `data:image/png;base64,${png.toString('base64')}`,
  }, okFetch(png))
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://api.openai.com/v1/images/edits')
  assert.equal(calls[0].init.headers['content-type'], undefined, 'multipart 请求不能手写 content-type 覆盖 boundary')
  assert.ok(calls[0].init.body instanceof FormData)
  assert.equal(calls[0].init.body.get('model'), 'gpt-image-2.6-flare')
  assert.equal(calls[0].init.body.get('size'), '1504x640')
  assert.equal(calls[0].init.body.get('output_format'), 'png')
  assert.equal(calls[0].init.body.get('background'), 'opaque')
  const uploaded = calls[0].init.body.get('image')
  assert.ok(uploaded instanceof Blob)
  assert.equal(uploaded.type, 'image/png')
  assert.equal(uploaded.name, 'reference.png')

  // 4. 参考图（https:// URL）先下载再走 /images/edits，兼容中转返回的 https url
  calls.length = 0
  const refAndUrlFetch = async (url, init) => {
    calls.push({ url, init })
    if (url === 'https://example.com/me.jpg') {
      return new Response(jpeg, { status: 200, headers: { 'content-type': 'image/jpeg' } })
    }
    if (url === 'https://cdn.example.com/out.png') {
      return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } })
    }
    return Response.json({ data: [{ url: 'https://cdn.example.com/out.png' }] })
  }
  const fromUrl = await generateOpenAICover('人物封面', {
    apiKey: 'sk-openai-secret-123',
    model: 'gpt-image-2',
    resolution: '2K',
    format: 'png',
    referenceImage: 'https://example.com/me.jpg',
  }, refAndUrlFetch)
  assert.equal(fromUrl.toString('hex', 0, 8), '89504e470d0a1a0a')
  assert.equal(calls.length, 3)
  assert.equal(calls[0].url, 'https://example.com/me.jpg')
  assert.equal(calls[1].url, 'https://api.openai.com/v1/images/edits')
  assert.equal(calls[1].init.body.get('image').type, 'image/jpeg')
  assert.equal(calls[1].init.body.get('image').name, 'reference.jpg')
  assert.equal(calls[2].url, 'https://cdn.example.com/out.png')

  // 5. 错误映射、请求 ID 与密钥脱敏
  const errReply = (status, body, headers = {}) => async () => Response.json(body, { status, headers })
  const baseOpts = { apiKey: 'sk-leak-openai-999', model: 'gpt-image-2.6-sunburst', resolution: '2K', format: 'png' }
  await assert.rejects(generateOpenAICover('p', baseOpts, errReply(401, { error: { code: 'invalid_api_key', message: 'Invalid key' } }, { 'x-request-id': 'req_401' })), /鉴权失败.*req_401/)
  await assert.rejects(generateOpenAICover('p', baseOpts, errReply(403, { error: { message: 'Your organization must be verified to use the model.' } })), /组织验证/)
  await assert.rejects(generateOpenAICover('p', baseOpts, errReply(403, { error: { message: 'Access denied' } })), /无权调用该模型/)
  await assert.rejects(generateOpenAICover('p', baseOpts, errReply(404, { error: { code: 'model_not_found', message: 'No such model' } })), /不存在|暂不可用/)
  await assert.rejects(generateOpenAICover('p', baseOpts, errReply(429, { error: { code: 'insufficient_quota', message: 'Quota' } })), /余额或配额不足/)
  await assert.rejects(generateOpenAICover('p', baseOpts, errReply(429, { error: { code: 'rate_limit_exceeded', message: 'Slow down' } })), /速率限制/)
  await assert.rejects(generateOpenAICover('p', baseOpts, errReply(400, { error: { code: 'moderation_blocked', message: 'Blocked' } })), /内容安全审核/)
  await assert.rejects(generateOpenAICover('p', baseOpts, errReply(400, { error: { message: 'Country, region, or territory not supported' } })), /地区.*自定义 API 地址/)
  await assert.rejects(
    generateOpenAICover('p', baseOpts, errReply(500, { error: { message: 'boom sk-leak-openai-999 Bearer sk-leak-openai-999' } }, { 'x-request-id': 'req_500' })),
    err => /HTTP 500/.test(err.message) && /req_500/.test(err.message) && !err.message.includes('sk-leak-openai-999'),
  )
  await assert.rejects(generateOpenAICover('p', baseOpts, errReply(200, { data: [{}] })), /未返回可保存的封面/)
})

test('OpenAI 设置：持久化脱敏、Base URL 规范化、非法值拦截与封面路由', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ws-openai-settings-'))
  const def = await readSettings(root)
  assert.equal(def.openaiModel, 'gpt-image-2.6-sunburst')
  assert.equal(def.openaiKey, '')
  assert.equal(def.openaiBaseUrl, '')

  const updated = await updateSettings(root, {
    coverProvider: 'openai',
    openaiModel: 'gpt-image-2.6-flare',
    openaiKey: '  sk-openai-secret-8888  ',
    openaiBaseUrl: '  https://relay.example.com/  ',
  })
  const pub = publicSettings(updated)
  assert.equal(pub.coverProvider, 'openai')
  assert.equal(pub.openaiModel, 'gpt-image-2.6-flare')
  assert.equal(pub.openaiKeySet, true)
  assert.equal(pub.openaiBaseUrl, 'https://relay.example.com/v1')
  assert.ok(!JSON.stringify(pub).includes('sk-openai-secret-8888'))
  const reread = await readSettings(root)
  assert.equal(reread.openaiKey, 'sk-openai-secret-8888')
  assert.equal(reread.openaiBaseUrl, 'https://relay.example.com/v1')

  const cleared = publicSettings(await updateSettings(root, { openaiBaseUrl: '' }))
  assert.equal(cleared.openaiBaseUrl, '')

  await assert.rejects(updateSettings(root, { openaiModel: modelsFor('ark')[0].id }), /OpenAI 封面模型/)
  await assert.rejects(updateSettings(root, { openaiBaseUrl: 'http://insecure.example.com/v1' }), /https/i)
  await assert.rejects(updateSettings(root, { openaiBaseUrl: 'https://u:p@relay.example.com/v1' }), /账号密码|https/i)

  const noKey = await coverHost({ provider: 'openai', key: '' })
  assert.match((await noKey.request('cover/generate', { id: noKey.article.id, style: 'classic', format: 'png' })).error, /OpenAI API Key/)

  const png = makePng(94, 40)
  const calls = []
  const host = await coverHost({
    provider: 'openai',
    key: 'sk-openai-route',
    model: 'gpt-image-2.6-flare',
    fetchImpl: async (url, init) => {
      calls.push({ url, init })
      return Response.json({ data: [{ b64_json: png.toString('base64') }] })
    },
    llm: await coverLLM('classic'),
  })
  await updateSettings(host.store.root, { openaiBaseUrl: 'https://relay.example.com/openai/v1/' })
  await host.request('cover/generate', { id: host.article.id, style: 'classic', resolution: '2K', count: 1, format: 'jpeg' })
  const after = await waitCover(host.request)
  assert.equal(calls[0].url, 'https://relay.example.com/openai/v1/images/generations')
  assert.equal(after.cover.provider, 'openai')
  assert.equal(after.cover.model, 'gpt-image-2.6-flare')
  assert.equal(after.cover.format, 'jpeg')
  assert.equal(after.cover.baseUrl, undefined, 'baseUrl 不应写入文章封面记录')
})

test('cover-styles.js：浏览器安全、内置元数据和共享纯函数', async () => {
  const source = await readFile(new URL('../src/cover-styles.js', import.meta.url), 'utf8')
  assert.ok(!/from\s+['"]node:/.test(source), 'cover-styles.js 必须保持浏览器安全')
  assert.equal(COVER_STYLES.length, 7)
  for (const item of COVER_STYLES) {
    assert.equal(item.source, 'builtin')
    assert.equal(item.usePortrait, item.id !== 'felt')
  }
  assert.deepEqual(CUSTOM_COVER_STYLE_LIMITS, {
    maxStyles: 30,
    maxReferenceImages: 3,
    maxReferenceBytes: 2 * 1024 * 1024,
    minSlots: 2,
    maxName: 16,
    maxDescription: 80,
    maxRequirement: 1000,
    maxTemplate: 8000,
    maxGuidance: 4000,
  })
  assert.equal(isCustomStyleId('custom-a1b2c3d4'), true)
  assert.equal(isCustomStyleId('classic'), false)
  assert.equal(isCustomStyleId('../x'), false)
  assert.equal(isCustomStyleId('custom-../bad'), false)
  assert.equal(isCustomStyleId(null), false)
  assert.deepEqual(extractTemplateSlots('A {{ 标题 }} B {{视觉元素}} C {{  }}'), ['标题', '视觉元素'])
  assert.equal(hasPortraitMarkers('[[SUBJECT]] wearing [[OUTFIT]]'), true)
  assert.equal(hasPortraitMarkers('左侧放[[人物]]，穿[[服装]]'), true)
  assert.equal(hasPortraitMarkers('只有物件没有真人'), false)
  const live = [{ id: 'custom-1111aaaa', name: '实时名称' }]
  assert.equal(resolveCoverStyleName('custom-1111aaaa', live, '旧名称'), '实时名称')
  assert.equal(resolveCoverStyleName('custom-deleted1', live, '已删风格名'), '已删风格名')
  assert.equal(resolveCoverStyleName('kinetic', live, ''), '动感大字')
  assert.equal(resolveCoverStyleName('custom-unknown1', live, ''), '封面')
})

test('coverDownloadName：支持自定义风格名覆盖、run.styleName 与旧记录回退', () => {
  const customRun = { style: 'custom-abcd1234', styleName: '黑金杂志风', format: 'png', createdAt: '2026-11-23T10:00:00', images: [{ id: 'a' }] }
  assert.equal(coverDownloadName({ title: '测试标题' }, customRun, 'a'), '测试标题-黑金杂志风-2026-11-23-100000-01.png')
  assert.equal(coverDownloadName({ title: '测试标题' }, customRun, 'a', '实时新名字'), '测试标题-实时新名字-2026-11-23-100000-01.png')
  const legacyBuiltin = { style: 'kinetic', format: 'png', createdAt: '2026-11-23T10:00:00', images: [{ id: 'a' }] }
  assert.equal(coverDownloadName({ title: '旧记录' }, legacyBuiltin, 'a'), '旧记录-动感大字-2026-11-23-100000-01.png')
  const legacyUnknown = { style: 'custom-gone9999', format: 'png', createdAt: '2026-11-23T10:00:00', images: [{ id: 'a' }] }
  assert.equal(coverDownloadName({ title: '旧自定义' }, legacyUnknown, 'a'), '旧自定义-封面-2026-11-23-100000-01.png')
})

test('callModel strictImages：不支持识图或运行时报图片错误时直接抛 400 且不降级纯文本', async () => {
  const img = `data:image/png;base64,${makePng(47, 20).toString('base64')}`

  let textOnlyCalls = 0
  const textOnlyCtx = {
    get: name => ({
      agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'text-only' }) },
      llm: {
        listModels: async () => [{ id: 'text-only', inputModalities: ['text'] }],
        prepareCall: async () => {
          textOnlyCalls++
          return { config: {}, async *stream() { yield { type: 'text-delta', text: 'fallback' }; yield { type: 'finish', reason: { kind: 'stop' } } } }
        },
      },
    }[name] ?? null),
  }
  await assert.rejects(
    callModel(textOnlyCtx, { system: 's', user: 'u', images: [img], task: 'test', strictImages: true }),
    err => err.status === 400 && /不支持识图/.test(err.message),
  )
  assert.equal(textOnlyCalls, 0, 'strictImages 在 vision === false 时不应发起模型调用')

  let runtimeCalls = 0
  const runtimeUnsupportedCtx = {
    get: name => ({
      agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'unknown-vision' }) },
      llm: {
        listModels: async () => [{ id: 'unknown-vision' }],
        prepareCall: async () => {
          runtimeCalls++
          return {
            config: {},
            async *stream() {
              if (runtimeCalls === 1) throw new Error('Provider error: model does not support images')
              yield { type: 'text-delta', text: 'text-fallback' }
              yield { type: 'finish', reason: { kind: 'stop' } }
            },
          }
        },
      },
    }[name] ?? null),
  }
  await assert.rejects(
    callModel(runtimeUnsupportedCtx, { system: 's', user: 'u', images: [img], task: 'test', strictImages: true }),
    err => err.status === 400 && /不支持图片输入/.test(err.message),
  )
  assert.equal(runtimeCalls, 1, 'strictImages 在运行时报图片不支持时不应回退纯文本重试')

  // 默认 strictImages: false 仍保持优雅降级
  runtimeCalls = 0
  let fallbackReason = ''
  const out = await callModel(runtimeUnsupportedCtx, {
    system: 's', user: 'u', images: [img], task: 'test',
    onImageFallback: reason => { fallbackReason = reason },
  })
  assert.equal(out, 'text-fallback')
  assert.equal(runtimeCalls, 2)
  assert.match(fallbackReason, /不支持图片输入/)
})

test('内置封面风格：7 套 buildCoverPromptRequest 保持 SKILL.md 与模板逐字不变', async () => {
  const skill = await readFile(join(COVER_SKILL_DIR, 'SKILL.md'), 'utf8')
  for (const style of COVER_STYLES) {
    const templateName = style.id === 'classic' ? 'prompt_template.md' : `prompt_template_${style.id}.md`
    const template = await readFile(join(COVER_SKILL_DIR, `references/${templateName}`), 'utf8')
    const req = await buildCoverPromptRequest('测试标题', MD, style.id, {}, { hasReference: style.usePortrait })
    assert.equal(req.style, style.id)
    assert.ok(req.system.startsWith(`${skill}\n\n${template}\n\n`), `${style.id} 必须原样保留 SKILL.md 和模板`)
    assert.ok(req.slots.length > 0)
  }
})

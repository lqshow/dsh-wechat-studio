// 微信公众号成稿台独立 CLI：复用 src/*.js 核心能力，供外部 Agent 与脚本调用。
// 不修改 DSH 插件逻辑；默认共享 <DSH_HOME>/wechat-studio 数据目录，也可通过 --data-dir 隔离。
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { skillSources } from './ai.js'
import { createArticle, listMeta, splitMarkdown, toMarkdown } from './article.js'
import { createStandaloneCtx, resolveStandaloneLlmConfig } from './cli-llm.js'
import { COVER_FORMATS, COVER_PROVIDERS, COVER_RESOLUTIONS, providerFormats, providerMeta } from './cover-options.js'
import { buildCoverPromptRequest } from './cover-prompt.js'
import { COVER_STYLES } from './cover-styles.js'
import { listCoverStyles, resolveCoverReferenceImage, resolveCoverStyle } from './custom-cover-styles.js'
import { coverPrompt, generateCoverImage, readCover, saveCover } from './cover.js'
import { generateDerivative, prepareDerivePrompt } from './derive.js'
import { toPortableMarkdown } from './derive-markdown.js'
import { MARKDOWN_TARGETS, THREAD_VARIANTS, threadClipboardText, xhsClipboardText } from './derive-shared.js'
import { buildInsights, importData, INSIGHTS_EMPTY } from './insights.js'
import { checkBanner, detectionText, renderLayout, renderSvgCard, renderWechatHtml, resolveLayoutPreferences, STYLES, SVG_CARD_KINDS, THEMES } from './layout.js'
import { MAX_WECHAT_TITLE, runPreflight } from './preflight.js'
import {
  addBag,
  addNote,
  formatBriefMarkdown,
  PREP_EMPTY,
  promoteBag,
  reconcilePrep,
  resolveSponsoredBrief,
  savePrepAsset,
  transferPromotedArticleImages,
} from './prep.js'
import { publicSettings, readSettings, updateSettings } from './settings.js'
import { dshHome, JsonStore, Store } from './store.js'
import { pushWechatDraft, verifyCredentials } from './wechat.js'
import { analyzeWritingStyle, applyWritingStyle, buildAnalyzePrompt, buildPreviewPrompt, previewWritingStyle, readStyleState, restoreDefaultStyle } from './writing-style.js'
import { DEFAULT_ENDPOINT, detect, mapSegments } from './zhuque.js'

const { version: VERSION } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

const ENV_ZHUQUE_KEY = ['ZHUQUE', 'API', 'KEY'].join('_')
const ENV_WECHAT_APP_ID = ['WECHAT', 'APP', 'ID'].join('_')
const ENV_WECHAT_APP_SECRET = ['WECHAT', 'APP', 'SECRET'].join('_')

class UsageError extends Error {
  constructor(message) {
    super(message)
    this.code = 'USAGE'
    this.exitCode = 2
  }
}

const GLOBAL_OPTIONS = {
  json: { type: 'boolean', default: false },
  'data-dir': { type: 'string' },
  help: { type: 'boolean', short: 'h', default: false },
  version: { type: 'boolean', short: 'v', default: false },
}

const LLM_OPTIONS = {
  model: { type: 'string' },
  'base-url': { type: 'string' },
}

const VALUE_FLAGS = new Set([
  '--data-dir', '--style', '--theme', '--banner', '--out', '--title', '--line', '--lines-file',
  '--range', '--key', '--endpoint', '--resolution', '--format', '--provider',
  '--prompt-file', '--note', '--topic', '--model', '--base-url',
  '--author', '--slogan', '--cover-provider', '--ark-model', '--bailian-model', '--minimax-model', '--gemini-model', '--openai-model', '--portrait-url',
  '--zhuque-key', '--zhuque-endpoint', '--ark-key', '--bailian-key', '--minimax-key', '--gemini-key', '--gemini-base-url', '--openai-key', '--openai-base-url',
  '--mp-name', '--mp-app-id', '--mp-app-secret', '--from-json', '--preflight-words',
  '--app-id', '--app-secret', '--cover', '--avatar', '--target', '--variant',
  '--bag', '--article', '--image', '--partner', '--date', '--selling-points', '--must-include', '--taboo', '--markdown',
])

const HELP_TEXT = `wechat-studio v${VERSION} — 微信公众号成稿台 CLI（兼容 DeepSeek Harness 插件工作区）

用法:
  wechat-studio <command> [options]

子命令:
  prep <list|note|bag>           管理备稿纸条、选题袋/商单袋与外部 Markdown 原地成稿
  check <file.md|->              零成本发布防踩坑体检（媒体/占位/标题/商单外链/文字墙/合规词）
  layout <file.md|->             将 Markdown 排成公众号 HTML 页面
  svg-card <kind>                渲染单张公众号 SMIL 动画 SVG 卡片
  detect <file.md|->             调用朱雀文本检测并定位标红段落
  cover [file.md|-]              生成 2.35:1 公众号封面（支持 --prompt-only / --prompt-file）
  draft <push|verify>            校验公众号凭证或将排版后的文章推送到草稿箱
  settings <get|set>             查看或更新工作区配置（作者/标语/默认排版/体检词/凭证）
  skills                         查看当前工作区生效的技能文件路径（内置或个人覆盖）
  articles <list|get|import>     管理工作区稿件（与 DSH 插件实时共享）
  insights <import|summary>      导入公众号后台数据或输出复盘指标
  style <status|analyze|preview|apply|restore>
                                 管理个人写作风格（支持 --prompt-only）
  derive <markdown|thread|xhs> <id>
                                 一稿多发：导出通用 Markdown 或生成串推/小红书

全局选项:
  --json                         仅在 stdout 输出单行结构化 JSON（供 Agent 解析）
  --data-dir <path>              指定工作区目录（默认 <DSH_HOME>/wechat-studio）
  -v, --version                  显示版本号
  -h, --help                     显示帮助（支持 wechat-studio <command> --help）
`

const SUB_HELP = {
  layout: `用法: wechat-studio layout <file.md|-> [options]
选项:
  --style <id>       正文风格（${STYLES.join(', ')}）
  --theme <id>       配色主题（${THEMES.join(', ')}）
  --banner <json>    开头横幅规格 JSON 文件（按 skills/banner.md 生成）
  --follow-card      包含文末关注卡
  --out <file.html>  输出 HTML 到文件（推荐 Agent 配合 --json 使用，避免大体积 HTML 占满上下文）
  --data-dir <path>  指定工作区目录
  --json             输出单行 JSON`,

  'svg-card': `用法: wechat-studio svg-card <kind> --title <标题> (--line <条目>... | --lines-file <文件|->) [options]
卡型 (<kind>):
  ${SVG_CARD_KINDS.join(', ')}
选项:
  --title <text>     卡片标题（必填）
  --line <text>      卡片条目（可重复传入）
  --lines-file <f>   从文件或 -（stdin）按行读取条目
  --style <id>       正文风格（默认 std）
  --theme <id>       配色主题（默认 orange）
  --out <file.html>  输出 HTML 到文件
  --json             输出单行 JSON`,

  detect: `用法: wechat-studio detect <file.md|-> [options]
选项:
  --key <key>        朱雀 API Key（默认读环境变量或工作区设置）
  --endpoint <url>   自定义 EdgeOne 网关地址（仅支持 https://）
  --data-dir <path>  指定工作区目录
  --json             输出单行 JSON`,

  cover: `用法: wechat-studio cover <file.md|-> [options]
      wechat-studio cover --prompt-file <file|-> [options]
选项:
  --style <id>       封面风格（内置：${COVER_STYLES.map(s => s.id).join(', ')}，以及工作区本地自定义风格 ID，默认 classic）
  --resolution <r>   分辨率（${COVER_RESOLUTIONS.join(', ')}，默认 2K）
  --format <fmt>     输出格式（${COVER_FORMATS.join(', ')}，默认 png）
  --provider <p>     生图提供方（${COVER_PROVIDERS.map(p => p.id).join(', ')}）
  --prompt-only      零密钥模式：仅输出封面模板、slots、fragments、personSegments 及 system/user
  --prompt-file <f>  直接读取最终生图提示词文件（或 - 读 stdin），跳过模型填槽直接生图并裁切
  --out <file>       将裁切后的 2.35:1 封面另存到指定路径
  --model <id>       覆盖独立模型名称
  --base-url <url>   覆盖独立模型接口地址
  --data-dir <path>  指定工作区目录
  --json             输出单行 JSON`,

  skills: `用法: wechat-studio skills [options]
说明: 列出当前工作区各技能（writer/headline/humanizer/cover 等）实际生效的文件路径及来源（user/bundled）。
选项:
  --data-dir <path>  指定工作区目录
  --json             输出单行 JSON`,

  articles: `用法: wechat-studio articles <list|get|import> [options]
子命令:
  list [--archived]        列出稿件（默认未归档）
  get <id>                 读取指定稿件 Markdown 与元数据
  import <file.md|->       导入 Markdown 到工作区（与 DSH 插件实时共享）`,

  insights: `用法: wechat-studio insights <import|summary> [options]
子命令:
  import <file.xls> [--range 7|30|all]  导入公众号后台导出 XLS
  summary [--range 7|30|all]            输出复盘汇总指标`,

  style: `用法: wechat-studio style <status|analyze|preview|apply|restore> [options]
子命令:
  status                                                     查看个人风格启用状态
  analyze <f1.md|-> [f2.md...] [--note <t>] [--out <p.json>] [--prompt-only]
                                                             分析参考文章提炼风格档案
  preview <profile.json|-> [--topic <t>] [--prompt-only]     按风格档案现场试写
  apply <profile.json|-> [--no-writer] [--no-headline]       启用个人风格并写入 skills/
  restore [--backup]                                         恢复内置默认风格（或恢复 .bak 备份）`,

  settings: `用法: wechat-studio settings <get|set> [options]
子命令:
  get                                  查看当前工作区公开配置（不含明文密钥）
  set [options]                        更新工作区配置（自动以 600 权限写入 settings.json）
常用 set 选项:
  --author <name>                      作者名（用于文末关注卡与草稿箱作者）
  --slogan <text>                      文末关注卡标语
  --style <id>                         默认正文风格（${STYLES.join(', ')}）
  --theme <id>                         默认配色主题（${THEMES.join(', ')}）
  --cover-provider <${COVER_PROVIDERS.map(p => p.id).join('|')}>
                                       默认封面生图提供方
  --ark-model <id> / --bailian-model <id> / --minimax-model <id> / --gemini-model <id> / --openai-model <id>
                                       默认封面生图模型
  --portrait-url <https://...|"">      封面人物参考图地址（传空字符串清除）
  --zhuque-key / --ark-key / --bailian-key / --minimax-key / --gemini-key / --openai-key <key>
                                       保存对应服务密钥（传空字符串清除）
  --gemini-base-url <https://...|"">   Google Gemini 自定义 API 地址（选填，传空字符串恢复官方地址）
  --openai-base-url <https://...|"">   OpenAI 自定义 API 地址（选填，传空字符串恢复官方地址）
  --mp-name / --mp-app-id / --mp-app-secret <val>
                                       保存公众号名称、AppID、AppSecret
  --preflight-words <词1,词2>          发布体检自定义提醒词（逗号分隔，传空字符串清空）
  --from-json <file|->                 从 JSON 文件或 stdin 批量读取配置补丁（适合传密钥）`,

  check: `用法: wechat-studio check <file.md|-> [options]
说明: 零模型成本、确定性的发布防踩坑体检（外链/文字墙/合规词/商单约束仅提醒，绝不阻断发布）。
选项:
  --title <text>                       覆盖待检查的标题（默认取 Markdown 一级标题）
  --bag <bagId>                        载入指定商单袋的必带信息与禁忌红线参与体检（与 --article 互斥）
  --article <articleId>                载入指定稿件关联的商单约束参与体检（与 --bag 互斥）
  --fail-on-blocking                   存在阻断项（媒体/占位/空标题/超 64 字标题）时以退出码 1 结束
  --data-dir <path>                    指定工作区目录（读取 fixedLines 与 preflightWords）
  --json                               输出单行结构化 JSON`,

  draft: `用法: wechat-studio draft <push|verify> [options]
子命令:
  verify [--app-id <id>] [--app-secret <secret>]
                                       校验公众号凭证与 IP 白名单
  push <file.md|-> [options]           将 Markdown 排版后推送到公众号草稿箱
push 选项:
  --title <text>                       覆盖草稿标题（默认取 Markdown 一级标题，上限 32 字）
  --author <text>                      覆盖草稿作者（默认取 settings.brand.author）
  --style <id> / --theme <id>          正文风格与配色主题
  --banner <spec.json>                 开头横幅规格 JSON 文件
  --follow-card                        包含文末关注卡
  --avatar <https://...>               关注卡/横幅头像地址（留空使用首字徽章）
  --cover <file.png|jpg>               本地封面图（留空自动上传纯色占位图并提示）
  --bag <bagId>                        载入指定商单袋的商单约束参与推送前体检（与 --article 互斥）
  --article <articleId>                载入指定稿件关联的商单约束参与推送前体检（与 --bag 互斥）
  --app-id <id> / --app-secret <sec>   临时覆盖公众号凭证（也支持环境变量 WECHAT_APP_ID / WECHAT_APP_SECRET）
  --dry-run                            仅在本地完成排版与完整体检，不调用微信接口
  --force                              忽略阻断级预检问题（本地图/飞书图/占位/标题超长等）强制推送`,

  prep: `用法:
  wechat-studio prep list [--bags] [--notes] [--sponsored] [--json]
  wechat-studio prep note <text|-> [--bag <bagId>] [--image <path>] [--json]
  wechat-studio prep bag create <title> [--sponsored] [--partner <name>] [--date YYYY-MM-DD]
                        [--selling-points <text>] [--must-include <csv>] [--taboo <csv>] [--json]
  wechat-studio prep bag export <bagId> [--out <file>] [--json]
  wechat-studio prep bag promote <bagId> --markdown <file|-> [--operation-id <id>] [--json]
说明:
  管理「备稿」模块的纸条与选题袋/商单袋，与 DSH 插件实时共享 prep.json 和 prep-assets/。
全局选项:
  --data-dir <path>                    指定工作区目录
  --json                               输出单行结构化 JSON`,

  derive: `用法:
  wechat-studio derive markdown <articleId> [--target zhihu|juejin|blog] [--out <file.md>]
  wechat-studio derive thread   <articleId> [--variant jike|x] [--force] [--prompt-only]
  wechat-studio derive xhs      <articleId> [--force] [--prompt-only]
说明:
  基于工作区稿件库中的已成稿，导出通用 Markdown 或提炼即刻/X 串推、小红书图文。
  卡片 PNG 与 ZIP 打包请在插件「一稿多发」页导出。
常用选项:
  --target <zhihu|juejin|blog>         通用 Markdown 目标平台（默认 blog）
  --variant <jike|x>                   串推平台（默认 jike）
  --out <file.md>                      将通用 Markdown 写入文件
  --force                              覆盖已手动修改过的派生稿
  --prompt-only                        仅输出提示词与输入段落，不调用模型也不写库
  --model / --base-url                 覆盖独立模型配置
  --data-dir <path>                    指定工作区目录
  --json                               输出单行结构化 JSON`,
}

function scrubSecrets(text, secrets = []) {
  let out = String(text ?? '')
  for (const s of secrets) {
    if (s) out = out.split(s).join('[已隐藏]')
  }
  return out.replace(/Bearer\s+\S+/gi, 'Bearer [已隐藏]')
}

function writeLine(stream, text) {
  stream.write(`${text}\n`)
}

function emitSuccess(io, isJson, payload, humanText) {
  if (isJson) {
    writeLine(io.stdout, JSON.stringify({ ok: true, ...payload }))
  } else if (humanText != null) {
    writeLine(io.stdout, humanText)
  }
  return 0
}

function emitError(io, isJson, err, secrets = []) {
  const exitCode = err?.exitCode === 2 ? 2 : 1
  const code = exitCode === 2 ? 'USAGE' : 'RUNTIME'
  const causeCode = exitCode === 1 && typeof err?.code === 'string' && err.code !== 'RUNTIME' ? err.code : undefined
  const message = scrubSecrets(err?.message || String(err), secrets)
  if (isJson) {
    writeLine(io.stdout, JSON.stringify({ ok: false, code, ...(causeCode ? { causeCode } : {}), error: message }))
  } else {
    writeLine(io.stderr, `错误：${message}`)
  }
  return exitCode
}

function hasJsonFlag(argv) {
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token === '--') return false
    if (token === '--json') return true
    if (VALUE_FLAGS.has(token)) i += 1
  }
  return false
}

function parseSubcommandArgs(argv, extraOptions = {}) {
  try {
    return parseArgs({
      args: argv,
      options: { ...GLOBAL_OPTIONS, ...extraOptions },
      strict: true,
      allowPositionals: true,
    })
  } catch (err) {
    throw new UsageError(err.message)
  }
}

function assertPositionals(positionals, max, usage) {
  if (positionals.length > max) {
    throw new UsageError(`参数过多：${positionals.slice(max).join(' ')}。${usage}`)
  }
}

async function readStdin(io) {
  const source = io.stdin ?? process.stdin
  if (typeof source === 'string') return source
  if (Buffer.isBuffer(source)) return source.toString('utf8')
  const chunks = []
  for await (const chunk of source) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function readTextFile(filePath, label = '文件', io = null) {
  if (!filePath) throw new UsageError(`缺少${label}路径。`)
  if (filePath === '-') return readStdin(io ?? {})
  try {
    return await readFile(filePath, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') throw new UsageError(`找不到${label}：${filePath}`)
    throw err
  }
}

async function readJsonFile(filePath, label = 'JSON 文件', io = null) {
  const raw = await readTextFile(filePath, label, io)
  try {
    return JSON.parse(raw)
  } catch {
    throw new UsageError(`${label}不是有效的 JSON：${filePath}`)
  }
}

async function writeOutFile(outPath, content) {
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, content)
}

function resolveDataDir(values, env) {
  if (values['data-dir']) return values['data-dir']
  if (env.DSH_HOME) return join(env.DSH_HOME, 'wechat-studio')
  return join(dshHome(), 'wechat-studio')
}

function resolveCtx(io, values, secrets) {
  if (io.ctx) return io.ctx
  const cfg = resolveStandaloneLlmConfig(io.env, {
    model: values.model,
    baseUrl: values['base-url'],
  })
  if (cfg.apiKey) secrets.push(cfg.apiKey)
  return createStandaloneCtx({ ...cfg, fetchImpl: io.fetchImpl })
}

function extractCommand(argv) {
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token === '--') return null
    if (token.startsWith('-')) {
      if (VALUE_FLAGS.has(token)) i += 1
      continue
    }
    return { command: token, index: i }
  }
  return null
}

function splitSubAction(argv) {
  const found = extractCommand(argv)
  if (!found) return { action: null, rest: argv }
  return {
    action: found.command,
    rest: [...argv.slice(0, found.index), ...argv.slice(found.index + 1)],
  }
}

async function handleLayout(argv, io) {
  const { values, positionals } = parseSubcommandArgs(argv, {
    style: { type: 'string' },
    theme: { type: 'string' },
    banner: { type: 'string' },
    'follow-card': { type: 'boolean', default: false },
    out: { type: 'string' },
  })
  if (values.help) return emitSuccess(io, values.json, { help: SUB_HELP.layout }, SUB_HELP.layout)
  const usage = '用法：wechat-studio layout <file.md|-> [--style <id>] [--theme <id>] [--banner <spec.json>] [--follow-card] [--out <file.html>]'
  assertPositionals(positionals, 1, usage)
  const file = positionals[0]
  if (!file) throw new UsageError(usage)
  if (values.style && !STYLES.includes(values.style)) {
    throw new UsageError(`不支持的排版风格：${values.style}（可选：${STYLES.join(', ')}）`)
  }
  if (values.theme && !THEMES.includes(values.theme)) {
    throw new UsageError(`不支持的配色主题：${values.theme}（可选：${THEMES.join(', ')}）`)
  }
  if (file === '-' && values.banner === '-') {
    throw new UsageError('正文和 --banner 不能同时从标准输入 - 读取。')
  }
  const dataDir = resolveDataDir(values, io.env)
  const [markdown, settings, bannerSpec] = await Promise.all([
    readTextFile(file, 'Markdown 文件', io),
    readSettings(dataDir),
    values.banner ? readJsonFile(values.banner, '横幅规格 JSON', io) : Promise.resolve(null),
  ])
  let bannerWarnings = []
  if (bannerSpec !== null) {
    if (!bannerSpec || typeof bannerSpec !== 'object' || Array.isArray(bannerSpec)) {
      throw new UsageError('横幅规格必须是 JSON 对象（请参考 skills/banner.md）。')
    }
    bannerWarnings = await checkBanner(bannerSpec)
    const fatal = bannerWarnings.find(w => w.startsWith('规格画不出来'))
    if (fatal) throw new UsageError(`横幅规格无效：${fatal}`)
  }
  const prefs = resolveLayoutPreferences(settings)
  const style = values.style ?? prefs.style
  const theme = values.theme ?? prefs.theme
  const { html, report } = await renderLayout(markdown, {
    style,
    theme,
    banner: bannerSpec ?? undefined,
    followCard: values['follow-card'],
    brand: settings.brand,
  })
  if (values.out) await writeOutFile(values.out, html)
  const payload = {
    style,
    theme,
    out: values.out ?? null,
    chars: html.length,
    report,
    ...(bannerSpec ? { bannerWarnings } : {}),
    ...(values.out ? {} : { html }),
  }
  const text = values.out
    ? `已生成排版页面：${values.out}（${style} · ${theme}，${html.length} 字符）${report ? `\n${report}` : ''}`
    : html
  return emitSuccess(io, values.json, payload, text)
}

async function handleSvgCard(argv, io) {
  const { values, positionals } = parseSubcommandArgs(argv, {
    title: { type: 'string' },
    line: { type: 'string', multiple: true },
    'lines-file': { type: 'string' },
    style: { type: 'string', default: 'std' },
    theme: { type: 'string', default: 'orange' },
    out: { type: 'string' },
  })
  if (values.help) return emitSuccess(io, values.json, { help: SUB_HELP['svg-card'] }, SUB_HELP['svg-card'])
  const usage = '用法：wechat-studio svg-card <kind> --title <标题> (--line <条目>... | --lines-file <文件|->) [--style <id>] [--theme <id>] [--out <file.html>]'
  assertPositionals(positionals, 1, usage)
  const kind = positionals[0]
  if (!kind || !values.title) throw new UsageError(usage)
  if (!SVG_CARD_KINDS.includes(kind)) {
    throw new UsageError(`不支持的 SVG 卡片类型：${kind}（可选：${SVG_CARD_KINDS.join(', ')}）`)
  }
  if (!STYLES.includes(values.style)) throw new UsageError(`不支持的风格：${values.style}`)
  if (!THEMES.includes(values.theme)) throw new UsageError(`不支持的配色：${values.theme}`)
  let lines = Array.isArray(values.line) ? [...values.line] : []
  if (values['lines-file']) {
    const raw = await readTextFile(values['lines-file'], '条目文件', io)
    lines.push(...raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean))
  }
  if (!lines.length) throw new UsageError('请至少通过 --line 或 --lines-file 提供一条卡片内容。')
  const { html, report } = await renderSvgCard(
    { kind, title: values.title, lines },
    { style: values.style, theme: values.theme },
  )
  if (values.out) await writeOutFile(values.out, html)
  const payload = { kind, title: values.title, style: values.style, theme: values.theme, out: values.out ?? null, report, html }
  const text = values.out ? `已生成 SVG 动画卡：${values.out}` : html
  return emitSuccess(io, values.json, payload, text)
}

async function handleSkills(argv, io) {
  const { values, positionals } = parseSubcommandArgs(argv)
  if (values.help) return emitSuccess(io, values.json, { help: SUB_HELP.skills }, SUB_HELP.skills)
  assertPositionals(positionals, 0, '用法：wechat-studio skills [--data-dir <path>] [--json]')
  const dir = join(resolveDataDir(values, io.env), 'skills')
  const skills = await skillSources(dir)
  const text = skills.map(s => `${s.name}\t${s.source}\t${s.path || '(缺失)'}`).join('\n')
  return emitSuccess(io, values.json, { dir, skills }, text)
}

async function handleArticles(argv, io) {
  const { action, rest } = splitSubAction(argv)
  if (!action) {
    const { values } = parseSubcommandArgs(rest)
    return emitSuccess(io, values.json, { help: SUB_HELP.articles }, SUB_HELP.articles)
  }
  if (action === 'list') {
    const { values, positionals } = parseSubcommandArgs(rest, { archived: { type: 'boolean', default: false } })
    if (values.help) return emitSuccess(io, values.json, { help: SUB_HELP.articles }, SUB_HELP.articles)
    assertPositionals(positionals, 0, '用法：wechat-studio articles list [--archived]')
    const store = new Store(resolveDataDir(values, io.env))
    const state = await store.read()
    const items = state.articles
      .filter(a => (values.archived ? Boolean(a.archivedAt) : !a.archivedAt))
      .map(a => listMeta(a))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    const text = items.length
      ? items.map(a => `${a.id}\t${a.chars}字\t${a.title}`).join('\n')
      : '工作区里还没有稿件。'
    return emitSuccess(io, values.json, { count: items.length, currentId: state.currentId, articles: items }, text)
  }
  if (action === 'get') {
    const { values, positionals } = parseSubcommandArgs(rest)
    if (values.help) return emitSuccess(io, values.json, { help: SUB_HELP.articles }, SUB_HELP.articles)
    const usage = '用法：wechat-studio articles get <id>'
    assertPositionals(positionals, 1, usage)
    const id = positionals[0]
    if (!id) throw new UsageError(usage)
    const store = new Store(resolveDataDir(values, io.env))
    const state = await store.read()
    const article = state.articles.find(a => a.id === id)
    if (!article) throw Object.assign(new Error(`找不到稿件：${id}`), { status: 404 })
    const markdown = toMarkdown(article)
    return emitSuccess(io, values.json, {
      id: article.id,
      title: article.title,
      summary: article.summary,
      updatedAt: article.updatedAt,
      archivedAt: article.archivedAt ?? null,
      blockCount: article.blocks.length,
      markdown,
    }, markdown)
  }
  if (action === 'import') {
    const { values, positionals } = parseSubcommandArgs(rest)
    if (values.help) return emitSuccess(io, values.json, { help: SUB_HELP.articles }, SUB_HELP.articles)
    const usage = '用法：wechat-studio articles import <file.md|->'
    assertPositionals(positionals, 1, usage)
    const file = positionals[0]
    if (!file) throw new UsageError(usage)
    const markdown = await readTextFile(file, 'Markdown 文件', io)
    if (!markdown.trim()) throw new UsageError('Markdown 文件为空。')
    const store = new Store(resolveDataDir(values, io.env))
    const article = createArticle({ markdown })
    await store.update(state => {
      if (state.lastLayoutPreferences) article.layoutPreferences = { ...state.lastLayoutPreferences }
      state.articles.push(article)
      state.currentId = article.id
    })
    return emitSuccess(io, values.json, {
      id: article.id,
      title: article.title,
      blockCount: article.blocks.length,
    }, `已导入稿件：${article.id}（${article.title}，${article.blocks.length} 段）`)
  }
  throw new UsageError(`未知的 articles 子命令：${action}（支持 list、get、import）`)
}

async function handleInsights(argv, io) {
  const { action, rest } = splitSubAction(argv)
  if (!action) {
    const { values } = parseSubcommandArgs(rest)
    return emitSuccess(io, values.json, { help: SUB_HELP.insights }, SUB_HELP.insights)
  }
  const validateRange = range => {
    if (!['7', '30', 'all'].includes(range)) throw new UsageError(`无效的时间范围：${range}（可选：7、30、all）`)
    return range
  }
  if (action === 'summary') {
    const { values, positionals } = parseSubcommandArgs(rest, { range: { type: 'string', default: 'all' } })
    if (values.help) return emitSuccess(io, values.json, { help: SUB_HELP.insights }, SUB_HELP.insights)
    assertPositionals(positionals, 0, '用法：wechat-studio insights summary [--range 7|30|all]')
    const range = validateRange(values.range)
    const dataDir = resolveDataDir(values, io.env)
    const store = new Store(dataDir)
    const insightsStore = new JsonStore(dataDir, { file: 'insights.json', empty: INSIGHTS_EMPTY })
    const [insights, state] = await Promise.all([insightsStore.read(), store.read()])
    const summary = buildInsights(insights, state.articles, range)
    const hasData = Boolean(summary.hasData)
    return emitSuccess(io, values.json, { range, hasData, summary }, hasData ? JSON.stringify(summary, null, 2) : '还没有导入公众号后台数据。')
  }
  if (action === 'import') {
    const { values, positionals } = parseSubcommandArgs(rest, { range: { type: 'string', default: 'all' } })
    if (values.help) return emitSuccess(io, values.json, { help: SUB_HELP.insights }, SUB_HELP.insights)
    const usage = '用法：wechat-studio insights import <file.xls> [--range 7|30|all]'
    assertPositionals(positionals, 1, usage)
    const range = validateRange(values.range)
    const file = positionals[0]
    if (!file) throw new UsageError(usage)
    let buffer
    try {
      buffer = await readFile(file)
    } catch (err) {
      if (err.code === 'ENOENT') throw new UsageError(`找不到数据文件：${file}`)
      throw err
    }
    const parsed = importData(buffer, basename(file))
    const dataDir = resolveDataDir(values, io.env)
    const store = new Store(dataDir)
    const insightsStore = new JsonStore(dataDir, { file: 'insights.json', empty: INSIGHTS_EMPTY })
    await insightsStore.update(state => {
      if (parsed.kind !== 'detail') {
        state[parsed.kind] = parsed
        return
      }
      const existing = (state.details ?? []).find(detail => detail.key === parsed.key)
      if (existing?.articleKey !== undefined) parsed.articleKey = existing.articleKey
      if (existing?.topic) parsed.topic = existing.topic
      state.details = [...(state.details ?? []).filter(detail => detail.key !== parsed.key), parsed]
    })
    const [insights, state] = await Promise.all([insightsStore.read(), store.read()])
    const summary = buildInsights(insights, state.articles, range)
    return emitSuccess(io, values.json, { importedKind: parsed.kind, range, summary }, `已导入复盘数据（类型：${parsed.kind}）。`)
  }
  throw new UsageError(`未知的 insights 子命令：${action}（支持 import、summary）`)
}

async function handleDetect(argv, io, secrets) {
  const { values, positionals } = parseSubcommandArgs(argv, {
    key: { type: 'string' },
    endpoint: { type: 'string' },
  })
  if (values.help) return emitSuccess(io, values.json, { help: SUB_HELP.detect }, SUB_HELP.detect)
  const usage = '用法：wechat-studio detect <file.md|-> [--key <key>] [--endpoint <url>]'
  assertPositionals(positionals, 1, usage)
  const file = positionals[0]
  if (!file) throw new UsageError(usage)
  const dataDir = resolveDataDir(values, io.env)
  const [markdown, settings] = await Promise.all([readTextFile(file, 'Markdown 文件', io), readSettings(dataDir)])
  const key = String(values.key ?? io.env[ENV_ZHUQUE_KEY] ?? settings.zhuqueKey ?? '').trim()
  if (key) secrets.push(key)
  if (!key) throw new UsageError(`缺少朱雀 API Key，请通过 --key、环境变量 ${ENV_ZHUQUE_KEY} 或工作区设置配置。`)
  const endpoint = String(values.endpoint ?? settings.zhuqueEndpoint ?? DEFAULT_ENDPOINT).trim() || DEFAULT_ENDPOINT
  const article = createArticle({ markdown })
  const text = await detectionText(markdown, settings.fixedLines)
  const result = await detect(text, { key, endpoint, fetchImpl: io.fetchImpl })
  const mapped = mapSegments(article, result.segments)
  const payload = {
    overall: result.overall,
    flagged: mapped.segments,
    coveredBlocks: mapped.covered.size,
    totalBlocks: article.blocks.length,
    tokens: result.tokens,
  }
  const human = `朱雀检测完成：标红 ${mapped.segments.length} 段` + (result.overall ? `（人工 ${result.overall.human}% / 疑似 ${result.overall.suspect}% / AI ${result.overall.ai}%）` : '')
  return emitSuccess(io, values.json, payload, human)
}

async function handleCover(argv, io, secrets) {
  const { values, positionals } = parseSubcommandArgs(argv, {
    ...LLM_OPTIONS,
    style: { type: 'string', default: 'classic' },
    resolution: { type: 'string', default: '2K' },
    format: { type: 'string', default: 'png' },
    provider: { type: 'string' },
    out: { type: 'string' },
    'prompt-only': { type: 'boolean', default: false },
    'prompt-file': { type: 'string' },
  })
  if (values.help) return emitSuccess(io, values.json, { help: SUB_HELP.cover }, SUB_HELP.cover)
  const usage = '用法：wechat-studio cover <file.md|-> [--style <id>] [--prompt-only] | wechat-studio cover --prompt-file <file|-> [--out <file>]'
  if (values['prompt-only'] && values['prompt-file']) {
    throw new UsageError('--prompt-only 和 --prompt-file 不能同时使用。')
  }
  assertPositionals(positionals, 1, usage)
  const file = positionals[0]
  if (!values['prompt-file'] && !file) throw new UsageError(usage)
  const dataDir = resolveDataDir(values, io.env)
  const resolvedStyle = await resolveCoverStyle(dataDir, values.style)
  if (!resolvedStyle) {
    const { styles } = await listCoverStyles(dataDir)
    throw new UsageError(`不支持的封面风格：${values.style}（可选：${styles.map(s => s.id).join(', ')}）`)
  }
  if (!COVER_RESOLUTIONS.includes(values.resolution)) {
    throw new UsageError(`不支持的分辨率：${values.resolution}（可选：${COVER_RESOLUTIONS.join(', ')}）`)
  }
  if (!COVER_FORMATS.includes(values.format)) {
    throw new UsageError(`不支持的图片格式：${values.format}（可选：${COVER_FORMATS.join(', ')}）`)
  }
  const settings = await readSettings(dataDir)
  const provider = values.provider ?? settings.coverProvider ?? 'ark'
  if (!COVER_PROVIDERS.some(p => p.id === provider)) {
    throw new UsageError(`不支持的封面提供方：${provider}（可选：${COVER_PROVIDERS.map(p => p.id).join('、')}）`)
  }
  if (!values['prompt-only'] && !providerFormats(provider).includes(values.format)) {
    throw new UsageError(`提供方 ${provider} 仅支持格式：${providerFormats(provider).join(', ')}`)
  }
  const { referenceImage, referenceKind } = await resolveCoverReferenceImage(dataDir, resolvedStyle, settings)
  const customStyle = resolvedStyle.source === 'custom' ? resolvedStyle : null

  let prompt
  if (values['prompt-file']) {
    prompt = (await readTextFile(values['prompt-file'], '封面提示词文件', io)).trim()
    if (!prompt) throw new UsageError('封面提示词文件为空。')
  } else {
    const markdown = await readTextFile(file, 'Markdown 文件', io)
    const parsed = splitMarkdown(markdown)
    const title = parsed.title || (file === '-' ? '未命名文章' : basename(file, '.md'))
    if (values['prompt-only']) {
      const req = await buildCoverPromptRequest(title, markdown, resolvedStyle.id, settings.persona, {
        hasReference: referenceKind === 'portrait',
        customStyle,
      })
      return emitSuccess(io, values.json, {
        style: req.style,
        styleName: resolvedStyle.name,
        title: req.title,
        promptOnly: true,
        slots: req.slots,
        template: req.template,
        fragments: req.fragments,
        personSegments: req.personSegments,
        system: req.system,
        user: req.user,
      }, `${req.system}\n\n---\n\n${req.user}`)
    }
    const ctx = resolveCtx(io, values, secrets)
    prompt = await coverPrompt(ctx, title, markdown, resolvedStyle.id, settings.persona, {
      hasReference: referenceKind === 'portrait',
      referenceKind,
      customStyle,
    })
  }

  const meta = providerMeta(provider)
  const apiKey = String(io.env[meta.envKey] ?? settings[meta.keyField] ?? '').trim()
  if (apiKey) secrets.push(apiKey)
  if (!apiKey) {
    throw new UsageError(`缺少 ${provider} 生图 API Key，请设置环境变量 ${meta.envKey} 或在工作区设置中保存。`)
  }
  const model = settings[meta.modelField]
  const baseUrl = meta.baseUrlField
    ? String((meta.baseUrlEnvKey ? io.env[meta.baseUrlEnvKey] : undefined) ?? settings[meta.baseUrlField] ?? '').trim()
    : ''
  const rawImage = await generateCoverImage(provider, prompt, {
    apiKey, model, resolution: values.resolution, format: values.format, referenceImage, baseUrl,
  }, io.fetchImpl)
  const id = await saveCover(dataDir, rawImage, values.format)
  const savedPath = join(dataDir, 'covers', `${id}.${values.format}`)
  if (values.out) {
    const cropped = await readCover(dataDir, id, values.format)
    await writeOutFile(values.out, cropped)
  }
  return emitSuccess(io, values.json, {
    id,
    style: values.style,
    provider,
    format: values.format,
    resolution: values.resolution,
    savedPath,
    out: values.out ?? null,
    prompt,
  }, `已生成封面：${values.out ?? savedPath}`)
}

async function handleStyle(argv, io, secrets) {
  const { action, rest } = splitSubAction(argv)
  if (!action) {
    const { values } = parseSubcommandArgs(rest)
    return emitSuccess(io, values.json, { help: SUB_HELP.style }, SUB_HELP.style)
  }
  if (action === 'status') {
    const { values, positionals } = parseSubcommandArgs(rest)
    if (values.help) return emitSuccess(io, values.json, { help: SUB_HELP.style }, SUB_HELP.style)
    assertPositionals(positionals, 0, '用法：wechat-studio style status')
    const state = await readStyleState(resolveDataDir(values, io.env))
    const text = state.active
      ? `个人写作风格已启用（正文：${state.scopes.writer ? '是' : '否'}，标题：${state.scopes.headline ? '是' : '否'}）`
      : '当前使用内置默认风格。'
    return emitSuccess(io, values.json, state, text)
  }
  if (action === 'analyze') {
    const { values, positionals } = parseSubcommandArgs(rest, {
      ...LLM_OPTIONS,
      note: { type: 'string', default: '' },
      out: { type: 'string' },
      'prompt-only': { type: 'boolean', default: false },
    })
    if (values.help) return emitSuccess(io, values.json, { help: SUB_HELP.style }, SUB_HELP.style)
    if (!positionals.length) throw new UsageError('用法：wechat-studio style analyze <file1.md|-> [file2.md ...] [--note <说明>] [--out <profile.json>] [--prompt-only]')
    const dataDir = resolveDataDir(values, io.env)
    const settings = await readSettings(dataDir)
    const samples = await Promise.all(positionals.map(async (file, i) => ({
      title: file === '-' ? `stdin-${i + 1}` : basename(file, '.md'),
      text: await readTextFile(file, '参考文章', io),
    })))
    if (values['prompt-only']) {
      const { system, user, meta } = buildAnalyzePrompt(samples, { userNote: values.note, fixedLines: settings.fixedLines })
      return emitSuccess(io, values.json, { promptOnly: true, system, user, meta }, `${system}\n\n---\n\n${user}`)
    }
    const ctx = resolveCtx(io, values, secrets)
    const result = await analyzeWritingStyle(ctx, samples, { userNote: values.note, fixedLines: settings.fixedLines })
    if (values.out) await writeOutFile(values.out, JSON.stringify(result.profile, null, 2))
    return emitSuccess(io, values.json, { ...result, out: values.out ?? null }, values.out ? `已生成风格档案：${values.out}` : JSON.stringify(result.profile, null, 2))
  }
  if (action === 'preview') {
    const { values, positionals } = parseSubcommandArgs(rest, {
      ...LLM_OPTIONS,
      topic: { type: 'string', default: '' },
      'prompt-only': { type: 'boolean', default: false },
    })
    if (values.help) return emitSuccess(io, values.json, { help: SUB_HELP.style }, SUB_HELP.style)
    const usage = '用法：wechat-studio style preview <profile.json|-> [--topic <选题>] [--prompt-only]'
    assertPositionals(positionals, 1, usage)
    const file = positionals[0]
    if (!file) throw new UsageError(usage)
    const rawProfile = await readJsonFile(file, '风格档案', io)
    if (values['prompt-only']) {
      const { topic, system, user } = buildPreviewPrompt(rawProfile, values.topic)
      return emitSuccess(io, values.json, { promptOnly: true, topic, system, user }, `${system}\n\n---\n\n${user}`)
    }
    const ctx = resolveCtx(io, values, secrets)
    const result = await previewWritingStyle(ctx, rawProfile, values.topic)
    const human = `选题：${result.topic}\n\n${result.opening}\n\n标题候选：\n${result.titles.map((t, i) => `${i + 1}. ${t}`).join('\n')}`
    return emitSuccess(io, values.json, result, human)
  }
  if (action === 'apply') {
    const { values, positionals } = parseSubcommandArgs(rest, {
      'no-writer': { type: 'boolean', default: false },
      'no-headline': { type: 'boolean', default: false },
    })
    if (values.help) return emitSuccess(io, values.json, { help: SUB_HELP.style }, SUB_HELP.style)
    const usage = '用法：wechat-studio style apply <profile.json|-> [--no-writer] [--no-headline]'
    assertPositionals(positionals, 1, usage)
    const file = positionals[0]
    if (!file) throw new UsageError(usage)
    const rawProfile = await readJsonFile(file, '风格档案', io)
    const dataDir = resolveDataDir(values, io.env)
    const result = await applyWritingStyle(dataDir, rawProfile, {
      scopes: { writer: !values['no-writer'], headline: !values['no-headline'] },
    })
    return emitSuccess(io, values.json, result, `已启用个人写作风格（写入：${result.written.join('、') || '无'}）。`)
  }
  if (action === 'restore') {
    const { values, positionals } = parseSubcommandArgs(rest, {
      backup: { type: 'boolean', default: false },
    })
    if (values.help) return emitSuccess(io, values.json, { help: SUB_HELP.style }, SUB_HELP.style)
    assertPositionals(positionals, 0, '用法：wechat-studio style restore [--backup]')
    const dataDir = resolveDataDir(values, io.env)
    const result = await restoreDefaultStyle(dataDir, { restoreBackup: values.backup })
    return emitSuccess(io, values.json, result, values.backup ? '已从备份恢复风格文件。' : '已恢复内置默认风格。')
  }
  throw new UsageError(`未知的 style 子命令：${action}（支持 status、analyze、preview、apply、restore）`)
}

function collectPatchSecrets(patch, secrets) {
  for (const v of [patch.zhuqueKey, patch.arkKey, patch.bailianKey, patch.minimaxKey, patch.geminiKey, patch.openaiKey, patch.cloudinary?.apiSecret, patch.mp?.appSecret]) {
    if (typeof v === 'string' && v.trim()) secrets.push(v.trim())
  }
}

function formatSettingsSummary(pub) {
  return [
    `作者：${pub.brand.author}`,
    `标语：${pub.brand.slogan}`,
    `默认排版：${pub.style ?? 'std（默认）'} · ${pub.theme ?? 'orange（默认）'}`,
    `封面提供方：${pub.coverProvider}（ark=${pub.arkModel}，bailian=${pub.bailianModel}，minimax=${pub.minimaxModel}，gemini=${pub.geminiModel}，openai=${pub.openaiModel}）`,
    `参考图：${pub.portraitUrl || '(未设置)'}`,
    `朱雀质检：${pub.zhuqueKeySet ? `已配置（****${pub.zhuqueKeyTail}）` : '未配置'}`,
    `体检自定义词：${pub.preflightWords?.length ? `${pub.preflightWords.length} 个（${pub.preflightWords.slice(0, 5).join('、')}）` : '未配置'}`,
    `生图密钥：火山方舟 ${pub.arkKeySet ? '已配置' : '未配置'} / 百炼 ${pub.bailianKeySet ? '已配置' : '未配置'} / MiniMax ${pub.minimaxKeySet ? '已配置' : '未配置'} / Gemini ${pub.geminiKeySet ? '已配置' : '未配置'} / OpenAI ${pub.openaiKeySet ? '已配置' : '未配置'}`,
    `公众号草稿箱：${pub.mp.appId ? `${pub.mp.name ? `${pub.mp.name} · ` : ''}${pub.mp.appId}（AppSecret ${pub.mp.appSecretSet ? '已配置' : '未配置'}）` : '未配置'}`,
  ].join('\n')
}

async function handleSettings(argv, io, secrets) {
  const { action, rest } = splitSubAction(argv)
  if (!action) {
    const { values } = parseSubcommandArgs(rest)
    return emitSuccess(io, values.json, { help: SUB_HELP.settings }, SUB_HELP.settings)
  }
  if (action === 'get') {
    const { values, positionals } = parseSubcommandArgs(rest)
    if (values.help) return emitSuccess(io, values.json, { help: SUB_HELP.settings }, SUB_HELP.settings)
    assertPositionals(positionals, 0, '用法：wechat-studio settings get [--data-dir <path>] [--json]')
    const settings = await readSettings(resolveDataDir(values, io.env))
    const pub = publicSettings(settings)
    return emitSuccess(io, values.json, { settings: pub }, formatSettingsSummary(pub))
  }
  if (action === 'set') {
    const { values, positionals } = parseSubcommandArgs(rest, {
      author: { type: 'string' },
      slogan: { type: 'string' },
      style: { type: 'string' },
      theme: { type: 'string' },
      'cover-provider': { type: 'string' },
      'ark-model': { type: 'string' },
      'bailian-model': { type: 'string' },
      'minimax-model': { type: 'string' },
      'gemini-model': { type: 'string' },
      'openai-model': { type: 'string' },
      'portrait-url': { type: 'string' },
      'zhuque-key': { type: 'string' },
      'zhuque-endpoint': { type: 'string' },
      'ark-key': { type: 'string' },
      'bailian-key': { type: 'string' },
      'minimax-key': { type: 'string' },
      'gemini-key': { type: 'string' },
      'gemini-base-url': { type: 'string' },
      'openai-key': { type: 'string' },
      'openai-base-url': { type: 'string' },
      'mp-name': { type: 'string' },
      'mp-app-id': { type: 'string' },
      'mp-app-secret': { type: 'string' },
      'preflight-words': { type: 'string' },
      'from-json': { type: 'string' },
    })
    if (values.help) return emitSuccess(io, values.json, { help: SUB_HELP.settings }, SUB_HELP.settings)
    assertPositionals(positionals, 0, '用法：wechat-studio settings set [options]（运行 wechat-studio settings --help 查看选项）')
    const patch = {}
    if (values['from-json']) {
      const parsed = await readJsonFile(values['from-json'], '配置 JSON', io)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new UsageError('配置 JSON 必须是对象。')
      }
      Object.assign(patch, parsed)
    }
    if (values.style !== undefined) {
      if (!STYLES.includes(values.style)) throw new UsageError(`不支持的排版风格：${values.style}（可选：${STYLES.join(', ')}）`)
      patch.style = values.style
    }
    if (values.theme !== undefined) {
      if (!THEMES.includes(values.theme)) throw new UsageError(`不支持的配色主题：${values.theme}（可选：${THEMES.join(', ')}）`)
      patch.theme = values.theme
    }
    if (values.author !== undefined || values.slogan !== undefined) {
      patch.brand = { ...(patch.brand ?? {}) }
      if (values.author !== undefined) patch.brand.author = values.author
      if (values.slogan !== undefined) patch.brand.slogan = values.slogan
    }
    if (values['cover-provider'] !== undefined) patch.coverProvider = values['cover-provider']
    if (values['ark-model'] !== undefined) patch.arkModel = values['ark-model']
    if (values['bailian-model'] !== undefined) patch.bailianModel = values['bailian-model']
    if (values['minimax-model'] !== undefined) patch.minimaxModel = values['minimax-model']
    if (values['gemini-model'] !== undefined) patch.geminiModel = values['gemini-model']
    if (values['openai-model'] !== undefined) patch.openaiModel = values['openai-model']
    if (values['portrait-url'] !== undefined) patch.portraitUrl = values['portrait-url']
    if (values['zhuque-key'] !== undefined) patch.zhuqueKey = values['zhuque-key']
    if (values['zhuque-endpoint'] !== undefined) patch.zhuqueEndpoint = values['zhuque-endpoint']
    if (values['ark-key'] !== undefined) patch.arkKey = values['ark-key']
    if (values['bailian-key'] !== undefined) patch.bailianKey = values['bailian-key']
    if (values['minimax-key'] !== undefined) patch.minimaxKey = values['minimax-key']
    if (values['gemini-key'] !== undefined) patch.geminiKey = values['gemini-key']
    if (values['gemini-base-url'] !== undefined) patch.geminiBaseUrl = values['gemini-base-url']
    if (values['openai-key'] !== undefined) patch.openaiKey = values['openai-key']
    if (values['openai-base-url'] !== undefined) patch.openaiBaseUrl = values['openai-base-url']
    if (values['preflight-words'] !== undefined) {
      patch.preflightWords = values['preflight-words'].trim()
        ? values['preflight-words'].split(/[,，\n]/).map(s => s.trim()).filter(Boolean)
        : []
    }
    if (values['mp-name'] !== undefined || values['mp-app-id'] !== undefined || values['mp-app-secret'] !== undefined) {
      patch.mp = { ...(patch.mp ?? {}) }
      if (values['mp-name'] !== undefined) patch.mp.name = values['mp-name']
      if (values['mp-app-id'] !== undefined) patch.mp.appId = values['mp-app-id']
      if (values['mp-app-secret'] !== undefined) patch.mp.appSecret = values['mp-app-secret']
    }
    collectPatchSecrets(patch, secrets)
    if (!Object.keys(patch).length) {
      throw new UsageError('请至少提供一个要更新的配置项（运行 wechat-studio settings --help 查看选项）。')
    }
    let next
    try {
      next = await updateSettings(resolveDataDir(values, io.env), patch)
    } catch (err) {
      if (err?.status === 400) throw new UsageError(err.message)
      throw err
    }
    const pub = publicSettings(next)
    return emitSuccess(io, values.json, { settings: pub }, `已更新工作区配置：\n${formatSettingsSummary(pub)}`)
  }
  throw new UsageError(`未知的 settings 子命令：${action}（支持 get、set）`)
}

function detectImageFormat(buffer) {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png'
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg'
  return null
}

async function handleDraft(argv, io, secrets) {
  const { action, rest } = splitSubAction(argv)
  if (!action) {
    const { values } = parseSubcommandArgs(rest)
    return emitSuccess(io, values.json, { help: SUB_HELP.draft }, SUB_HELP.draft)
  }
  if (action === 'verify') {
    const { values, positionals } = parseSubcommandArgs(rest, {
      'app-id': { type: 'string' },
      'app-secret': { type: 'string' },
    })
    if (values.help) return emitSuccess(io, values.json, { help: SUB_HELP.draft }, SUB_HELP.draft)
    assertPositionals(positionals, 0, '用法：wechat-studio draft verify [--app-id <id>] [--app-secret <secret>]')
    const settings = await readSettings(resolveDataDir(values, io.env))
    const appId = String(values['app-id'] ?? io.env[ENV_WECHAT_APP_ID] ?? settings.mp.appId ?? '').trim()
    const appSecret = String(values['app-secret'] ?? io.env[ENV_WECHAT_APP_SECRET] ?? settings.mp.appSecret ?? '').trim()
    if (appSecret) secrets.push(appSecret)
    if (!appId || !appSecret) {
      throw new UsageError(`缺少公众号 AppID 或 AppSecret，请通过 --app-id/--app-secret、环境变量 ${ENV_WECHAT_APP_ID}/${ENV_WECHAT_APP_SECRET} 或 wechat-studio settings set 配置。`)
    }
    const result = await verifyCredentials(appId, appSecret, io.fetchImpl)
    const label = result.nickname ? `公众号凭证验证通过：${result.nickname}` : '公众号凭证验证通过。'
    return emitSuccess(io, values.json, result, label)
  }
  if (action === 'push') {
    const { values, positionals } = parseSubcommandArgs(rest, {
      title: { type: 'string' },
      author: { type: 'string' },
      style: { type: 'string' },
      theme: { type: 'string' },
      banner: { type: 'string' },
      'follow-card': { type: 'boolean', default: false },
      avatar: { type: 'string' },
      cover: { type: 'string' },
      bag: { type: 'string' },
      article: { type: 'string' },
      'app-id': { type: 'string' },
      'app-secret': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
    })
    if (values.help) return emitSuccess(io, values.json, { help: SUB_HELP.draft }, SUB_HELP.draft)
    const usage = '用法：wechat-studio draft push <file.md|-> [--title <标题>] [--style <id>] [--theme <id>] [--banner <spec.json>] [--follow-card] [--cover <file>] [--bag <bagId> | --article <articleId>] [--dry-run] [--force]'
    assertPositionals(positionals, 1, usage)
    const file = positionals[0]
    if (!file) throw new UsageError(usage)
    if (values.bag !== undefined && values.article !== undefined) {
      throw new UsageError('--bag 和 --article 不能同时使用，请只指定其中一项。')
    }
    if (values.style && !STYLES.includes(values.style)) {
      throw new UsageError(`不支持的排版风格：${values.style}（可选：${STYLES.join(', ')}）`)
    }
    if (values.theme && !THEMES.includes(values.theme)) {
      throw new UsageError(`不支持的配色主题：${values.theme}（可选：${THEMES.join(', ')}）`)
    }
    if (file === '-' && values.banner === '-') {
      throw new UsageError('正文和 --banner 不能同时从标准输入 - 读取。')
    }
    if (values.avatar && !/^https:\/\//.test(values.avatar.trim())) {
      throw new UsageError('--avatar 必须是 https:// 图片地址。')
    }
    const dataDir = resolveDataDir(values, io.env)
    const [markdown, settings, bannerSpec, sponsoredBrief] = await Promise.all([
      readTextFile(file, 'Markdown 文件', io),
      readSettings(dataDir),
      values.banner ? readJsonFile(values.banner, '横幅规格 JSON', io) : Promise.resolve(null),
      resolveSponsoredBriefOption(dataDir, values),
    ])
    if (!markdown.trim()) throw new UsageError('Markdown 文件为空。')
    if (bannerSpec !== null) {
      if (!bannerSpec || typeof bannerSpec !== 'object' || Array.isArray(bannerSpec)) {
        throw new UsageError('横幅规格必须是 JSON 对象（请参考 skills/banner.md）。')
      }
      const bannerWarnings = await checkBanner(bannerSpec)
      const fatal = bannerWarnings.find(w => w.startsWith('规格画不出来'))
      if (fatal) throw new UsageError(`横幅规格无效：${fatal}`)
    }
    let coverImage = null
    if (values.cover) {
      let buffer
      try {
        buffer = await readFile(values.cover)
      } catch (err) {
        if (err.code === 'ENOENT') throw new UsageError(`找不到封面文件：${values.cover}`)
        throw err
      }
      const format = detectImageFormat(buffer)
      if (!format) throw new UsageError('封面图片仅支持 PNG 或 JPEG 格式。')
      coverImage = { buffer, format }
    }
    const prefs = resolveLayoutPreferences(settings)
    const style = values.style ?? prefs.style
    const theme = values.theme ?? prefs.theme
    const author = (values.author ?? '').trim() || settings.brand.author
    const rendered = await renderWechatHtml(markdown, {
      style,
      theme,
      banner: bannerSpec ?? undefined,
      followCard: values['follow-card'],
      brand: { ...settings.brand, author },
      avatarUrl: values.avatar?.trim() ?? '',
      name: file === '-' ? '' : basename(file),
    })
    const title = values.title !== undefined
      ? values.title.trim()
      : (rendered.title || '未命名')
    const preflight = runPreflight(
      { title, markdown },
      { fixedLines: settings.fixedLines, customWords: settings.preflightWords, sponsoredBrief, layoutIssues: rendered.issues, titleTarget: 'draft' },
    )
    const blockingItems = preflight.items.filter(item => item.severity === 'blocking')
    const blockingMessages = blockingItems.map(item => item.title)
    const allIssues = preflight.items.map(item => item.title)
    if (values['dry-run']) {
      const payload = {
        dryRun: true,
        title,
        author,
        style,
        theme,
        chars: rendered.html.length,
        hasCover: Boolean(coverImage),
        preflight,
        issues: allIssues,
        blocking: blockingMessages,
      }
      const header = `本地预检完成（未推送）：《${title || '未命名'}》（${style} · ${theme}，${rendered.html.length} 字符）`
      return emitSuccess(io, values.json, payload, `${header}\n${formatPreflightText(preflight)}`)
    }
    if (blockingItems.length && !values.force) {
      throw new UsageError(`发布前预检发现阻断项，已阻止推送（确认继续请加 --force）：${blockingMessages.join('；')}`)
    }
    const appId = String(values['app-id'] ?? io.env[ENV_WECHAT_APP_ID] ?? settings.mp.appId ?? '').trim()
    const appSecret = String(values['app-secret'] ?? io.env[ENV_WECHAT_APP_SECRET] ?? settings.mp.appSecret ?? '').trim()
    if (appSecret) secrets.push(appSecret)
    if (!appId || !appSecret) {
      throw new UsageError(`缺少公众号 AppID 或 AppSecret，请通过 --app-id/--app-secret、环境变量 ${ENV_WECHAT_APP_ID}/${ENV_WECHAT_APP_SECRET} 或 wechat-studio settings set 配置。`)
    }
    const result = await pushWechatDraft({
      article: { title: title || '未命名' },
      html: rendered.html,
      settings: {
        ...settings,
        brand: { ...settings.brand, author },
        mp: { ...settings.mp, appId, appSecret },
      },
      cover: coverImage,
      fetchImpl: io.fetchImpl,
    })
    const warnings = [...result.warnings]
    if (values.force && title.length > MAX_WECHAT_TITLE) {
      warnings.push(`标题共 ${title.length} 字，超过 ${MAX_WECHAT_TITLE} 字上限，公众号草稿箱已截断为前 ${MAX_WECHAT_TITLE} 字。`)
    }
    const payload = {
      mediaId: result.mediaId,
      title,
      author,
      style,
      theme,
      chars: rendered.html.length,
      preflight,
      issues: allIssues,
      warnings,
    }
    const allNotices = [...allIssues, ...warnings]
    const warnText = allNotices.length ? `\n提醒：\n- ${allNotices.join('\n- ')}` : ''
    return emitSuccess(io, values.json, payload, `已推送到公众号草稿箱：${result.mediaId}（《${title || '未命名'}》）${warnText}`)
  }
  throw new UsageError(`未知的 draft 子命令：${action}（支持 push、verify）`)
}

function formatPreflightText(preflight) {
  const blocking = preflight.items.filter(item => item.severity === 'blocking')
  const warns = preflight.items.filter(item => item.severity === 'warn')
  const infos = preflight.items.filter(item => item.severity === 'info')
  const lines = [
    `统计：正文 ${preflight.stats.chars} 字，标题 ${preflight.stats.titleChars} 字，链接 ${preflight.stats.links} 处，图片 ${preflight.stats.images} 张`,
  ]
  if (blocking.length) {
    lines.push(`发现 ${blocking.length} 项阻断问题（正式推送将被拦截，修复后重试或加 --force 强制推送）：`, ...blocking.map(x => `- ${x.title}`))
  }
  if (warns.length) {
    lines.push(`发现 ${warns.length} 项提醒（不阻止发布）：`, ...warns.map(x => `- ${x.title}`))
  }
  if (infos.length) {
    lines.push('可读性提示：', ...infos.map(x => `- ${x.title}`))
  }
  if (!blocking.length && !warns.length && !infos.length) {
    lines.push('预检通过，未发现问题。')
  }
  return lines.join('\n')
}

function openPrepStore(dataDir) {
  return new JsonStore(dataDir, { file: 'prep.json', empty: PREP_EMPTY })
}

async function resolveSponsoredBriefOption(dataDir, values) {
  if (values.bag !== undefined && values.article !== undefined) {
    throw new UsageError('--bag 和 --article 不能同时使用，请只指定其中一项。')
  }
  if (values.bag !== undefined) {
    const bagId = values.bag.trim()
    if (!bagId) throw new UsageError('--bag 不能为空。')
    const prepState = await openPrepStore(dataDir).read()
    const bag = (prepState.bags ?? []).find(b => b.id === bagId)
    if (!bag) throw Object.assign(new Error(`找不到选题袋：${bagId}`), { status: 404 })
    return resolveSponsoredBrief({ sourceBagId: bag.id }, prepState)
  }
  if (values.article !== undefined) {
    const articleId = values.article.trim()
    if (!articleId) throw new UsageError('--article 不能为空。')
    const [articleState, prepState] = await Promise.all([
      new Store(dataDir).read(),
      openPrepStore(dataDir).read(),
    ])
    const article = (articleState.articles ?? []).find(a => a.id === articleId)
    if (!article) throw Object.assign(new Error(`找不到稿件：${articleId}`), { status: 404 })
    return resolveSponsoredBrief(article, prepState)
  }
  return null
}

function sortActiveBags(bags) {
  return bags.slice().sort((a, b) => {
    const typeDiff = Number(b.type === 'sponsored') - Number(a.type === 'sponsored')
    if (typeDiff !== 0) return typeDiff
    if (a.type === 'sponsored' && b.type === 'sponsored') {
      if (a.targetDate && b.targetDate && a.targetDate !== b.targetDate) {
        return a.targetDate.localeCompare(b.targetDate)
      }
      if (a.targetDate && !b.targetDate) return -1
      if (!a.targetDate && b.targetDate) return 1
    }
    return String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? ''))
  })
}

async function handleCheck(argv, io) {
  const { values, positionals } = parseSubcommandArgs(argv, {
    title: { type: 'string' },
    bag: { type: 'string' },
    article: { type: 'string' },
    'fail-on-blocking': { type: 'boolean', default: false },
  })
  if (values.help) return emitSuccess(io, values.json, { help: SUB_HELP.check }, SUB_HELP.check)
  const usage = '用法：wechat-studio check <file.md|-> [--title <标题>] [--bag <bagId> | --article <articleId>] [--fail-on-blocking] [--data-dir <path>] [--json]'
  assertPositionals(positionals, 1, usage)
  const file = positionals[0]
  if (!file) throw new UsageError(usage)
  if (values.bag !== undefined && values.article !== undefined) {
    throw new UsageError('--bag 和 --article 不能同时使用，请只指定其中一项。')
  }
  const dataDir = resolveDataDir(values, io.env)
  const [markdown, settings, sponsoredBrief] = await Promise.all([
    readTextFile(file, 'Markdown 文件', io),
    readSettings(dataDir),
    resolveSponsoredBriefOption(dataDir, values),
  ])
  if (!markdown.trim()) throw new UsageError('Markdown 文件为空。')
  const parsed = splitMarkdown(markdown)
  const title = values.title !== undefined ? values.title.trim() : parsed.title
  const preflight = runPreflight(
    { title, markdown },
    { fixedLines: settings.fixedLines, customWords: settings.preflightWords, sponsoredBrief },
  )
  const human = formatPreflightText(preflight)
  if (values['fail-on-blocking'] && !preflight.ok) {
    if (values.json) {
      writeLine(io.stdout, JSON.stringify({
        ok: false,
        code: 'PREFLIGHT_BLOCKED',
        passed: false,
        counts: preflight.counts,
        stats: preflight.stats,
        items: preflight.items,
      }))
    } else {
      writeLine(io.stderr, human)
    }
    return 1
  }
  return emitSuccess(io, values.json, {
    passed: preflight.ok,
    counts: preflight.counts,
    stats: preflight.stats,
    items: preflight.items,
  }, human)
}

async function handleDerive(argv, io, secrets) {
  const { action, rest } = splitSubAction(argv)
  if (!action) {
    const { values } = parseSubcommandArgs(rest)
    return emitSuccess(io, values.json, { help: SUB_HELP.derive }, SUB_HELP.derive)
  }
  if (action === 'markdown') {
    const { values, positionals } = parseSubcommandArgs(rest, {
      target: { type: 'string', default: 'blog' },
      out: { type: 'string' },
    })
    if (values.help) return emitSuccess(io, values.json, { help: SUB_HELP.derive }, SUB_HELP.derive)
    const usage = '用法：wechat-studio derive markdown <articleId> [--target zhihu|juejin|blog] [--out <file.md>]'
    assertPositionals(positionals, 1, usage)
    const id = positionals[0]
    if (!id) throw new UsageError(usage)
    if (!MARKDOWN_TARGETS.includes(values.target)) {
      throw new UsageError(`不支持的导出目标：${values.target}（可选：${MARKDOWN_TARGETS.join(', ')}）`)
    }
    const dataDir = resolveDataDir(values, io.env)
    const store = new Store(dataDir)
    const [state, settings] = await Promise.all([store.read(), readSettings(dataDir)])
    const article = state.articles.find(a => a.id === id)
    if (!article) throw Object.assign(new Error(`找不到稿件：${id}`), { status: 404 })
    const result = toPortableMarkdown(article, { target: values.target, fixedLines: settings.fixedLines })
    if (values.out) {
      await writeOutFile(values.out, result.markdown)
      const warnText = result.warnings.length ? `\n提醒：\n${result.warnings.map(w => `- ${w}`).join('\n')}` : ''
      return emitSuccess(io, values.json, { id: article.id, target: values.target, out: values.out, ...result }, `已导出通用 Markdown：${values.out}${warnText}`)
    }
    if (!values.json && result.warnings.length) {
      for (const warning of result.warnings) writeLine(io.stderr, `提醒：${warning}`)
    }
    return emitSuccess(io, values.json, { id: article.id, target: values.target, out: null, ...result }, result.markdown.replace(/\n$/, ''))
  }
  if (action === 'thread' || action === 'xhs') {
    const platform = action
    const { values, positionals } = parseSubcommandArgs(rest, {
      ...LLM_OPTIONS,
      ...(platform === 'thread' ? { variant: { type: 'string', default: 'jike' } } : {}),
      force: { type: 'boolean', default: false },
      'prompt-only': { type: 'boolean', default: false },
    })
    if (values.help) return emitSuccess(io, values.json, { help: SUB_HELP.derive }, SUB_HELP.derive)
    const usage = platform === 'thread'
      ? '用法：wechat-studio derive thread <articleId> [--variant jike|x] [--force] [--prompt-only]'
      : '用法：wechat-studio derive xhs <articleId> [--force] [--prompt-only]'
    assertPositionals(positionals, 1, usage)
    const id = positionals[0]
    if (!id) throw new UsageError(usage)
    if (platform === 'thread' && !THREAD_VARIANTS.includes(values.variant)) {
      throw new UsageError(`不支持的串推平台：${values.variant}（可选：${THREAD_VARIANTS.join(', ')}）`)
    }
    const dataDir = resolveDataDir(values, io.env)
    const store = new Store(dataDir)
    if (values['prompt-only']) {
      const state = await store.read()
      const article = state.articles.find(a => a.id === id)
      if (!article) throw Object.assign(new Error(`找不到稿件：${id}`), { status: 404 })
      const prepared = await prepareDerivePrompt(article, { platform, variant: values.variant, root: dataDir })
      const payload = {
        promptOnly: true,
        id: article.id,
        platform,
        ...(platform === 'thread' ? { variant: prepared.variant } : {}),
        system: prepared.system,
        user: prepared.user,
      }
      return emitSuccess(io, values.json, payload, `${prepared.system}\n\n---\n\n${prepared.user}`)
    }
    const ctx = resolveCtx(io, values, secrets)
    const record = await generateDerivative(ctx, store, {
      id,
      platform,
      variant: values.variant,
      confirmOverwrite: values.force,
      root: dataDir,
    })
    const warnText = record.warnings?.length ? `\n\n提醒：\n${record.warnings.map(w => `- ${w}`).join('\n')}` : ''
    let human
    if (platform === 'thread') {
      human = `${threadClipboardText(record.payload.posts)}${warnText}`
    } else {
      const outline = record.payload.cards.map((card, i) => `[${i + 1}/${record.payload.cards.length} ${card.kind}] ${card.heading}${card.lines.length ? ` — ${card.lines.join(' / ')}` : ''}`).join('\n')
      human = `${xhsClipboardText(record.payload)}\n\n---\n卡片大纲：\n${outline}\n\n提示：卡片 PNG 请在插件「一稿多发」页导出。${warnText}`
    }
    return emitSuccess(io, values.json, { id, ...record }, human)
  }
  throw new UsageError(`未知的 derive 子命令：${action}（支持 markdown、thread、xhs）`)
}

async function handlePrep(argv, io, secrets) {
  const { action, rest } = splitSubAction(argv)
  if (!action) {
    const { values } = parseSubcommandArgs(rest)
    return emitSuccess(io, values.json, { help: SUB_HELP.prep }, SUB_HELP.prep)
  }

  if (action === 'list') {
    const { values, positionals } = parseSubcommandArgs(rest, {
      bags: { type: 'boolean', default: false },
      notes: { type: 'boolean', default: false },
      sponsored: { type: 'boolean', default: false },
    })
    if (values.help) return emitSuccess(io, values.json, { help: SUB_HELP.prep }, SUB_HELP.prep)
    assertPositionals(positionals, 0, '用法：wechat-studio prep list [--bags] [--notes] [--sponsored]')
    const dataDir = resolveDataDir(values, io.env)
    const prepStore = openPrepStore(dataDir)
    const store = new Store(dataDir)
    await reconcilePrep(prepStore, store)
    const state = await prepStore.read()
    const allNotes = state.notes ?? []
    const noteCountByBag = new Map()
    for (const note of allNotes) {
      if (note.bagId) noteCountByBag.set(note.bagId, (noteCountByBag.get(note.bagId) ?? 0) + 1)
    }

    const showBags = values.bags || values.sponsored || !values.notes
    const showNotes = values.notes || (!values.bags && !values.sponsored)

    const bags = showBags
      ? sortActiveBags((state.bags ?? []).filter(b => !b.archivedAt && !b.articleId && (!values.sponsored || b.type === 'sponsored')))
        .map(b => ({ ...b, noteCount: noteCountByBag.get(b.id) ?? 0 }))
      : []
    const notes = showNotes
      ? allNotes.filter(n => n.bagId == null).slice().sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
      : []

    const lines = []
    if (bags.length) {
      lines.push('选题袋：')
      for (const b of bags) {
        const tag = b.type === 'sponsored' ? `[商单${b.brief?.partner ? `·${b.brief.partner}` : ''}]` : '[选题]'
        const datePart = b.targetDate ? `\t${b.targetDate}` : ''
        lines.push(`${b.id}\t${tag}${datePart}\t${b.title}（${b.noteCount} 条）`)
      }
    }
    if (notes.length) {
      if (lines.length) lines.push('')
      lines.push('自由纸条：')
      for (const n of notes) {
        const preview = (n.text || n.image?.name || '[截图]').replace(/\s+/g, ' ').slice(0, 60)
        lines.push(`${n.id}\t[${n.kind}]\t${preview}`)
      }
    }
    const human = lines.length ? lines.join('\n') : '当前没有活跃选题袋或自由纸条。'
    return emitSuccess(io, values.json, { bags, notes }, human)
  }

  if (action === 'note') {
    const { values, positionals } = parseSubcommandArgs(rest, {
      bag: { type: 'string' },
      image: { type: 'string' },
    })
    if (values.help) return emitSuccess(io, values.json, { help: SUB_HELP.prep }, SUB_HELP.prep)
    const usage = '用法：wechat-studio prep note <text|-> [--bag <bagId>] [--image <path>]'
    assertPositionals(positionals, 1, usage)
    const rawArg = positionals[0]
    let text = ''
    if (rawArg === '-') {
      text = await readStdin(io)
    } else if (rawArg !== undefined) {
      text = rawArg
    }
    if (!text.trim() && !values.image) throw new UsageError(usage)

    const dataDir = resolveDataDir(values, io.env)
    let image = null
    if (values.image) {
      let buffer
      try {
        buffer = await readFile(values.image)
      } catch (err) {
        if (err.code === 'ENOENT') throw new UsageError(`找不到图片文件：${values.image}`)
        throw err
      }
      try {
        image = await savePrepAsset(dataDir, buffer, basename(values.image))
      } catch (err) {
        if (err?.status === 400) throw new UsageError(err.message)
        throw err
      }
    }

    const prepStore = openPrepStore(dataDir)
    const store = new Store(dataDir)
    await reconcilePrep(prepStore, store)
    let note
    try {
      note = await prepStore.update(state => addNote(state, {
        text,
        bagId: values.bag ?? null,
        image,
      }))
    } catch (err) {
      if (err?.status === 400) throw new UsageError(err.message)
      throw err
    }
    const targetLabel = note.bagId ? `（已归入 ${note.bagId}）` : '（自由纸条）'
    return emitSuccess(io, values.json, { note }, `已记下纸条：${note.id}${targetLabel}`)
  }

  if (action === 'bag') {
    const { action: bagAction, rest: bagRest } = splitSubAction(rest)
    if (!bagAction) {
      const { values } = parseSubcommandArgs(bagRest)
      return emitSuccess(io, values.json, { help: SUB_HELP.prep }, SUB_HELP.prep)
    }

    if (bagAction === 'create') {
      const { values, positionals } = parseSubcommandArgs(bagRest, {
        sponsored: { type: 'boolean', default: false },
        partner: { type: 'string' },
        date: { type: 'string' },
        'selling-points': { type: 'string' },
        'must-include': { type: 'string' },
        taboo: { type: 'string' },
      })
      if (values.help) return emitSuccess(io, values.json, { help: SUB_HELP.prep }, SUB_HELP.prep)
      const usage = '用法：wechat-studio prep bag create <title> [--sponsored] [--partner <name>] [--date YYYY-MM-DD] [--selling-points <text>] [--must-include <csv>] [--taboo <csv>]'
      assertPositionals(positionals, 1, usage)
      const title = positionals[0]
      if (!title || !title.trim()) throw new UsageError(usage)

      const dataDir = resolveDataDir(values, io.env)
      const prepStore = openPrepStore(dataDir)
      const store = new Store(dataDir)
      await reconcilePrep(prepStore, store)
      let bag
      try {
        bag = await prepStore.update(state => addBag(state, {
          title,
          type: values.sponsored ? 'sponsored' : 'topic',
          targetDate: values.date ?? null,
          brief: {
            partner: values.partner ?? '',
            sellingPoints: values['selling-points'] ?? '',
            mustInclude: values['must-include'] ?? '',
            taboo: values.taboo ?? '',
          },
        }))
      } catch (err) {
        if (err?.status === 400) throw new UsageError(err.message)
        throw err
      }
      const typeLabel = bag.type === 'sponsored' ? '商单袋' : '选题袋'
      const dateLabel = bag.targetDate ? `，目标日期 ${bag.targetDate}` : ''
      return emitSuccess(io, values.json, { bag }, `已创建${typeLabel}：${bag.id}（${bag.title}${dateLabel}）`)
    }

    if (bagAction === 'export') {
      const { values, positionals } = parseSubcommandArgs(bagRest, {
        out: { type: 'string' },
      })
      if (values.help) return emitSuccess(io, values.json, { help: SUB_HELP.prep }, SUB_HELP.prep)
      const usage = '用法：wechat-studio prep bag export <bagId> [--out <file>]'
      assertPositionals(positionals, 1, usage)
      const bagId = positionals[0]
      if (!bagId) throw new UsageError(usage)

      const dataDir = resolveDataDir(values, io.env)
      const prepState = await openPrepStore(dataDir).read()
      const bag = (prepState.bags ?? []).find(b => b.id === bagId)
      if (!bag) throw Object.assign(new Error(`找不到选题袋：${bagId}`), { status: 404 })
      const bagNotes = (prepState.notes ?? []).filter(n => n.bagId === bagId)
      const markdown = formatBriefMarkdown(bag, bagNotes, { root: dataDir })
      if (values.out) await writeOutFile(values.out, markdown)
      return emitSuccess(
        io,
        values.json,
        { bagId: bag.id, title: bag.title, out: values.out ?? null, markdown },
        values.out ? `已导出备料单：${values.out}` : markdown.replace(/\n$/, ''),
      )
    }

    if (bagAction === 'promote') {
      const { values, positionals } = parseSubcommandArgs(bagRest, {
        markdown: { type: 'string' },
        'operation-id': { type: 'string' },
      })
      if (values.help) return emitSuccess(io, values.json, { help: SUB_HELP.prep }, SUB_HELP.prep)
      const usage = '用法：wechat-studio prep bag promote <bagId> --markdown <file|-> [--operation-id <id>]'
      assertPositionals(positionals, 1, usage)
      const bagId = positionals[0]
      if (!bagId || !values.markdown) throw new UsageError(usage)

      const markdown = await readTextFile(values.markdown, 'Markdown 文件', io)
      if (!markdown.trim()) throw new UsageError('Markdown 文件为空。')

      const dataDir = resolveDataDir(values, io.env)
      const prepStore = openPrepStore(dataDir)
      const store = new Store(dataDir)
      await reconcilePrep(prepStore, store)

      let promoted
      try {
        promoted = await promoteBag({
          prepStore,
          store,
          bagId,
          mode: 'import',
          markdown,
          operationId: values['operation-id'],
        })
      } catch (err) {
        if (err?.status === 400) throw new UsageError(err.message)
        throw err
      }

      const settings = await readSettings(dataDir)
      if (settings.cloudinary?.apiSecret) secrets.push(settings.cloudinary.apiSecret)
      const imageTransfer = await transferPromotedArticleImages({
        store,
        prepStore,
        articleId: promoted.articleId,
        feishuUrls: promoted.feishuUrls,
        prepAssetRefs: promoted.prepAssetRefs,
        settings,
        fetchImpl: io.fetchImpl,
      })
      const warnings = [...imageTransfer.warnings]
      const payload = {
        articleId: promoted.articleId,
        bagId: promoted.bagId,
        scheduledFor: promoted.scheduledFor,
        imageTransfer,
        warnings,
      }
      const scheduleSuffix = promoted.scheduledFor ? `，已继承排期 ${promoted.scheduledFor}` : ''
      const warnText = warnings.length ? `\n提醒：\n${warnings.map(w => `- ${w}`).join('\n')}` : ''
      const human = `已将选题袋 ${promoted.bagId} 升格为稿件 ${promoted.articleId}${scheduleSuffix}${warnText}`
      return emitSuccess(io, values.json, payload, human)
    }

    throw new UsageError(`未知的 prep bag 子命令：${bagAction}（支持 create、export、promote）`)
  }

  throw new UsageError(`未知的 prep 子命令：${action}（支持 list、note、bag）`)
}

export async function runCli(argv = [], rawIo = {}) {
  const io = {
    stdin: rawIo.stdin ?? process.stdin,
    stdout: rawIo.stdout ?? process.stdout,
    stderr: rawIo.stderr ?? process.stderr,
    env: rawIo.env ?? process.env,
    fetchImpl: rawIo.fetchImpl ?? fetch,
    ctx: rawIo.ctx ?? null,
  }
  const isJson = hasJsonFlag(argv)
  const secrets = []
  try {
    const found = extractCommand(argv)
    if (!found) {
      const { values } = parseSubcommandArgs(argv)
      if (values.version) {
        return emitSuccess(io, values.json, { version: VERSION }, VERSION)
      }
      return emitSuccess(io, values.json, { version: VERSION, help: HELP_TEXT }, HELP_TEXT)
    }
    const { command, index } = found
    const subArgv = [...argv.slice(0, index), ...argv.slice(index + 1)]
    switch (command) {
      case 'prep': return await handlePrep(subArgv, io, secrets)
      case 'check': return await handleCheck(subArgv, io)
      case 'layout': return await handleLayout(subArgv, io)
      case 'svg-card': return await handleSvgCard(subArgv, io)
      case 'skills': return await handleSkills(subArgv, io)
      case 'articles': return await handleArticles(subArgv, io)
      case 'insights': return await handleInsights(subArgv, io)
      case 'detect': return await handleDetect(subArgv, io, secrets)
      case 'cover': return await handleCover(subArgv, io, secrets)
      case 'style': return await handleStyle(subArgv, io, secrets)
      case 'settings': return await handleSettings(subArgv, io, secrets)
      case 'draft': return await handleDraft(subArgv, io, secrets)
      case 'derive': return await handleDerive(subArgv, io, secrets)
      default:
        throw new UsageError(`未知命令：${command}。运行 wechat-studio --help 查看可用子命令。`)
    }
  } catch (err) {
    return emitError(io, isJson, err, secrets)
  }
}

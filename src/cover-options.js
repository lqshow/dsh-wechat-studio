export const GEMINI_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com'

export const COVER_PROVIDERS = [
  { id: 'ark', name: '火山方舟' },
  { id: 'bailian', name: '阿里云百炼' },
  { id: 'minimax', name: 'MiniMax' },
  { id: 'gemini', name: 'Google Gemini' },
]

export const COVER_MODELS = [
  { id: 'doubao-seedream-5-5-261028', name: 'Doubao Seedream 5.5', provider: 'ark' },
  { id: 'qwen-image-2.1-pro', name: 'Qwen-Image 2.1 Pro', provider: 'bailian' },
  { id: 'qwen-image-3.0-pro', name: 'Qwen-Image 3.0 Pro', provider: 'bailian' },
  { id: 'wan2.7-image-pro', name: '通义万相 2.7 Pro', provider: 'bailian' },
  { id: 'wan2.7-image', name: '通义万相 2.7', provider: 'bailian' },
  { id: 'MiniMax-H3-Image', name: 'MiniMax H3 Image', provider: 'minimax' },
  { id: 'MiniMax-H3-Image-Highspeed', name: 'MiniMax H3 Image Highspeed', provider: 'minimax' },
  { id: 'gemini-nano-banana-2.1', name: 'Nano Banana 2.1', provider: 'gemini' },
  { id: 'gemini-3.1-flash-image', name: 'Nano Banana 2', provider: 'gemini' },
  { id: 'gemini-3-pro-image', name: 'Nano Banana Pro', provider: 'gemini' },
]

export const COVER_PROVIDER_META = {
  ark: {
    id: 'ark',
    name: '火山方舟',
    subtitle: 'Doubao Seedream',
    modelField: 'arkModel',
    keyField: 'arkKey',
    keySetField: 'arkKeySet',
    envKey: ['ARK', 'API', 'KEY'].join('_'),
    description: '配置火山方舟的生图模型和凭证。',
    link: 'https://ark.volcengine.com/region:cn-beijing/apikey',
    linkLabel: '火山方舟 API Key',
    keyPlaceholder: '输入火山方舟 API Key',
    missingKeyError: '请先在设置中填写火山方舟 API Key。',
    hint: '',
  },
  bailian: {
    id: 'bailian',
    name: '阿里云百炼',
    subtitle: '通义万相 · 千问图像',
    modelField: 'bailianModel',
    keyField: 'bailianKey',
    keySetField: 'bailianKeySet',
    envKey: ['BAILIAN', 'API', 'KEY'].join('_'),
    description: '配置阿里云百炼的生图模型和凭证。',
    link: 'https://bailian.console.aliyun.com/cn-beijing/model/settings/api-key',
    linkLabel: '阿里云百炼 API Key',
    keyPlaceholder: '输入阿里云百炼 API Key',
    missingKeyError: '请先在设置中填写阿里云百炼 API Key。',
    hint: '当前仅支持中国内地（北京）的百炼 API Key，图片格式为 PNG。',
  },
  minimax: {
    id: 'minimax',
    name: 'MiniMax',
    subtitle: 'H3 Image',
    modelField: 'minimaxModel',
    keyField: 'minimaxKey',
    keySetField: 'minimaxKeySet',
    envKey: ['MINIMAX', 'API', 'KEY'].join('_'),
    description: '配置 MiniMax H3 的生图模型和凭证。',
    link: 'https://platform.minimax.cn/user-center/basic-information/interface-key',
    linkLabel: 'MiniMax API Key',
    keyPlaceholder: '输入 MiniMax API Key',
    missingKeyError: '请先在设置中填写 MiniMax API Key。',
    hint: '当前支持 MiniMax 国内开放平台（platform.minimax.cn）的 API Key，支持 PNG 和 JPEG。',
  },
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    subtitle: 'Nano Banana',
    modelField: 'geminiModel',
    keyField: 'geminiKey',
    keySetField: 'geminiKeySet',
    baseUrlField: 'geminiBaseUrl',
    defaultBaseUrl: GEMINI_DEFAULT_BASE_URL,
    envKey: ['GEMINI', 'API', 'KEY'].join('_'),
    description: '配置 Google Gemini（Nano Banana）的生图模型和凭证。',
    link: 'https://aistudio.google.com/apikey',
    linkLabel: 'Google AI Studio API Key',
    keyPlaceholder: '输入 Google Gemini API Key',
    missingKeyError: '请先在设置中填写 Google Gemini API Key。',
    hint: '需要 Google AI Studio 付费层级（Tier 1+）API Key，支持 PNG 和 JPEG；如国内网络直连受限，可填写自定义 API 地址。',
  },
}

export const providerMeta = provider => COVER_PROVIDER_META[provider] ?? COVER_PROVIDER_META.ark
export const modelsFor = provider => COVER_MODELS.filter(model => model.provider === provider)

export const COVER_RESOLUTIONS = ['1K', '1.5K', '2K']
export const COVER_FORMATS = ['png', 'jpeg']
export const MAX_COVER_COUNT = 4

// 百炼只回 PNG；带参考图时万相的 1K/2K 缩写会跟随参考图比例，所以统一显式传宽*高，
// 比例取 47:20，和 saveCover 的裁切一致，避免中心裁切切掉构图。
export const BAILIAN_SIZES = { '1K': '1504*640', '1.5K': '1880*800', '2K': '2048*872' }
// MiniMax H3 支持精确宽x高（面积 655,360 ~ 20,000,000，宽高比 1:3 ~ 3:1）。
// 三档分别取 32 / 48 / 64 倍 47:20，严格匹配公众号封面比例且避开二次裁切与重编码。
export const MINIMAX_SIZES = { '1K': '1504x640', '1.5K': '2256x960', '2K': '3008x1280' }
export const INLINE_IMAGE_SIZES = { ark: '2048x1152', bailian: '2048*1152', minimax: '2048x1152', gemini: '2K' }
export const providerFormats = provider => (provider === 'bailian' ? ['png'] : COVER_FORMATS)

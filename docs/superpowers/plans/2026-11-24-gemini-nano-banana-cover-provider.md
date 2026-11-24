# Google Gemini（Nano Banana）生图提供方扩展实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为封面生成（并同步支持共用的正文插图、自定义风格试生成与 CLI）扩展第 4 个生图提供方 **Google Gemini（Nano Banana）**，内置 3 款模型（`gemini-nano-banana-2.1`、`gemini-3.1-flash-image`、`gemini-3-pro-image`），并仅针对 Gemini 提供选填的自定义 Base URL。

**Architecture:**
- 在 `src/cover-options.js` 的声明式注册表中新增 `gemini` 提供方、3 款 Nano Banana 模型、`GEMINI_DEFAULT_BASE_URL`、`GEMINI_ASPECT_RATIOS` 与 `baseUrlField: 'geminiBaseUrl'`。
- 在 `src/image-crop.js`（经 `scripts/build.mjs` 打包至 `dist/image-crop.mjs`）新增 `normalizeImageFormat(image, targetFormat)`，利用已打包的 `pngjs` / `jpeg-js` 在 Gemini 返回格式与目标格式不一致时自动转码，保证封面支持 PNG/JPEG、正文插图稳定输出 PNG。
- 在 `src/cover.js` 实现 `generateGeminiCover`，原生 `fetch` 调用 `{baseUrl}/v1beta/models/{model}:generateContent`（`x-goog-api-key` 请求头、`redirect: 'error'`、180s 超时），兼容 `https://` 与 `data:image/...;base64,...` 两种参考图来源。
- 同步扩展 `src/settings.js`、`src/inline-assets.js`、`src/host.js`、`src/custom-cover-styles.js`、`src/cli.js`、`client/app.jsx`、`README.md`、`scripts/smoke-package.mjs` 及配套单测。

**Tech Stack:** Node.js `>=20` ESM、React 18（esbuild 打包至 `dist/client.js`）、`dist/image-crop.mjs`（`pngjs` / `jpeg-js`）、`node:test`、`node:assert/strict`、内置 `fetch`。

**Spec:** `docs/superpowers/specs/2026-11-24-gemini-nano-banana-cover-provider-design.md`

## Global Constraints

- **零新增运行时依赖**：禁止新增任何 npm runtime 依赖，`npm run check:package` 必须通过。
- **浏览器安全边界**：`src/cover-options.js` 会打包进 `dist/client.js`，禁止导入任何 `node:*` 模块。
- **密钥零泄露**：`geminiKey` 仅保存在本机 `settings.json`（权限 `600`），通过 `x-goog-api-key` 请求头传递（严禁拼进 URL query）；`publicSettings` 仅暴露 `geminiKeySet`；错误文案经 `providerDetail` 脱敏 `apiKey`、`Bearer` 与 `x-goog-api-key`；CLI `collectPatchSecrets` 与 `secrets` 登记 `geminiKey`。
- **Base URL 安全规范化**：`geminiBaseUrl` 仅允许不带账号密码的 `https://` 地址，留空回退 `https://generativelanguage.googleapis.com`；自动去掉末尾 `/` 以及末尾 `/v1beta` / `/v1beta/` 后缀避免拼出重复路径。
- **不改现有提供方行为**：火山方舟（`ark`）、阿里云百炼（`bailian`）、MiniMax（`minimax`）的请求体、端点、超时与 UI 行为保持 100% 兼容。
- **验证命令**：`npm run build && npm test && npm run check:package && mkdir -p artifacts && npm pack --pack-destination artifacts && npm run smoke:package`

## Review Focus

1. **自定义 Base URL 尾部斜杠与 `/v1beta` 重复拼接**：用户贴入 `https://proxy.example.com/` 或 `https://proxy.example.com/v1beta/` 时，最终请求必须规范化为 `https://proxy.example.com/v1beta/models/<model>:generateContent`，不得出现 `//v1beta` 或 `/v1beta/v1beta`。
2. **自定义封面风格传入 `data:` 参考图**：`src/custom-cover-styles.js` 的样式参考图传入的是 `data:image/...;base64,...`，`generateGeminiCover` 必须直接解析为 `inlineData` 而不触发 `fetch`，同时 `https://` 人物参考图正常下载转 `inlineData`。
3. **Gemini 返回格式与请求格式不一致**：Gemini 返回 JPEG 而请求要求 PNG（尤其是正文插图 `saveInlineImage` 强校验 PNG 魔数）或返回 PNG 而封面要求 JPEG 时，经 `normalizeImageFormat` 自动转码后必须通过魔数校验并成功落盘。
4. **安全审核拦截与免费层 429 错误**：Gemini 返回 `candidates[0].finishReason: 'SAFETY' / 'IMAGE_SAFETY'` 或 `promptFeedback.blockReason`、以及 HTTP 400（地区限制）/ 401 / 403 / 404 / 429 时，均应给出清晰中文提示并脱敏密钥。
5. **非法的 `geminiBaseUrl` 与 `geminiModel` 拦截**：传入 `http://`、带账号密码 URL 或其他提供方模型 ID 时，`updateSettings` 必须以 `status: 400` 拒绝。

---

### Task 1: 提供方元信息、模型列表与图片格式转码（`src/cover-options.js`、`src/image-crop.js`、`scripts/build.mjs`）

**Files:**
- Modify: `src/cover-options.js`
- Modify: `src/image-crop.js`
- Modify: `scripts/build.mjs:40-44`
- Test: `test/cover.test.js`

**Interfaces:**
- Produces (`src/cover-options.js`):
  - `GEMINI_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com'`
  - `COVER_PROVIDERS`：新增 `{ id: 'gemini', name: 'Google Gemini' }`
  - `COVER_MODELS`：新增
    - `{ id: 'gemini-nano-banana-2.1', name: 'Nano Banana 2.1', provider: 'gemini' }`
    - `{ id: 'gemini-3.1-flash-image', name: 'Nano Banana 2', provider: 'gemini' }`
    - `{ id: 'gemini-3-pro-image', name: 'Nano Banana Pro', provider: 'gemini' }`
  - `COVER_PROVIDER_META.gemini`：
    - `id: 'gemini'`, `name: 'Google Gemini'`, `modelField: 'geminiModel'`, `keyField: 'geminiKey'`, `keySetField: 'geminiKeySet'`, `baseUrlField: 'geminiBaseUrl'`, `defaultBaseUrl: GEMINI_DEFAULT_BASE_URL`, `envKey: ['GEMINI', 'API', 'KEY'].join('_')`, `link: 'https://aistudio.google.com/apikey'`, `linkLabel: 'Google AI Studio API Key'`, `description: '配置 Google Gemini（Nano Banana）的生图模型和凭证。'`, `keyPlaceholder: '输入 Google Gemini API Key'`, `missingKeyError: '请先在设置中填写 Google Gemini API Key。'`, `hint: '需要 Google AI Studio 付费层级（Tier 1+）API Key，支持 PNG 和 JPEG；如国内网络直连受限，可填写自定义 API 地址。'`
  - `INLINE_IMAGE_SIZES`：新增 `gemini: '2K'`
  - `providerFormats('gemini')` 返回 `['png', 'jpeg']`
- Produces (`src/image-crop.js` & `dist/image-crop.mjs`):
  - `normalizeImageFormat(image: Buffer, targetFormat: 'png' | 'jpeg') -> Buffer`：检测 PNG/JPEG 魔数，与 `targetFormat` 一致则原样返回；否则校验尺寸不超过 `MAX_PIXELS` 后用 `pngjs` / `jpeg-js` 互转；不支持的字节流抛错。

- [ ] **Step 1: 在 `test/cover.test.js` 写失败测试**
  - 断言 `COVER_PROVIDERS` 含 `gemini`、`modelsFor('gemini')` 含 3 款 Nano Banana 模型（默认 `gemini-nano-banana-2.1`）、`providerMeta('gemini').baseUrlField === 'geminiBaseUrl'`、`providerFormats('gemini')` 为 `['png', 'jpeg']`、`INLINE_IMAGE_SIZES.gemini === '2K'`。
  - 断言 `normalizeImageFormat`：PNG→PNG 原样返回、JPEG→JPEG 原样返回、JPEG→PNG 输出有效 PNG 魔数且像素尺寸不变、PNG→JPEG 输出有效 JPEG 魔数且像素尺寸不变、非法字节流抛错。
- [ ] **Step 2: 运行确认失败** — `node --test test/cover.test.js`
- [ ] **Step 3: 更新 `src/cover-options.js`、`src/image-crop.js`、`scripts/build.mjs` 并运行 `npm run build`**
- [ ] **Step 4: 运行确认通过** — `node --test test/cover.test.js`

---

### Task 2: 实现 Gemini（Nano Banana）生图客户端与调度（`src/cover.js`）

**Files:**
- Modify: `src/cover.js`
- Test: `test/cover.test.js`

**Interfaces:**
- Consumes: `GEMINI_DEFAULT_BASE_URL` from `./cover-options.js`, `normalizeImageFormat` from `../dist/image-crop.mjs`
- Produces:
  - `normalizeGeminiBaseUrl(value?: string) -> string`：空值返回 `GEMINI_DEFAULT_BASE_URL`；校验 `https://`、无 `username`/`password`、无 `search`/`hash`；去除末尾 `/` 及末尾 `/v1beta`（不区分大小写）后再去末尾 `/`；非法值抛 `status: 400` 错误。
  - `generateGeminiCover(prompt, { apiKey, model, resolution = '2K', format = 'png', referenceImage = null, baseUrl = '', aspectRatio = '21:9', subject = '封面' }, fetchImpl = fetch) -> Promise<Buffer>`
  - `generateCoverImage(provider, prompt, options, fetchImpl = fetch)`：新增 `if (provider === 'gemini') return generateGeminiCover(prompt, options, fetchImpl)`

**实现要点：**
- URL 组装：`${normalizeGeminiBaseUrl(baseUrl)}/v1beta/models/${encodeURIComponent(model)}:generateContent`；请求头 `x-goog-api-key: apiKey`、`content-type: application/json`，`redirect: 'error'`，`signal: AbortSignal.timeout(180_000)`。
- 请求体：
  - `contents: [{ role: 'user', parts }]`（无参考图时 `parts = [{ text: prompt }]`；有参考图时先放 `{ inlineData: { mimeType, data } }` 再放 `{ text: prompt }`）
  - `generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio, imageSize: resolution === '1K' ? '1K' : '2K' } }`
- 参考图加载 `loadGeminiReferenceImage(referenceImage, fetchImpl)`：
  - 若匹配 `^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$`：校验解码字节 `<= MAX_IMAGE` 直接返回 `{ mimeType, data }`。
  - 否则校验 `https://` 且无账号密码，用 `fetchImpl(referenceImage, { redirect: 'error', signal: AbortSignal.timeout(60_000) })` 流式读取（上限 24 MB），按魔数识别 PNG/JPEG/WebP（回退 `content-type`）并返回 `{ mimeType, data: buf.toString('base64') }`。
- 响应解析与转码：
  - 提取 `candidates?.[0]?.content?.parts` 中第一个含 `inlineData?.data`（兼容 `inline_data?.data`）的 part，检查大小 ≤ 24 MB 后解码 `Buffer`，再经 `normalizeImageFormat(buf, format)` 统一为目标格式返回。
  - 若 `promptFeedback?.blockReason` 存在或 `finishReason` 为 `SAFETY` / `IMAGE_SAFETY` / `PROHIBITED_CONTENT` / `BLOCKLIST`，抛出「提示词或生成结果未通过 Google Gemini 内容安全审核，请调整后重试。」。
- 错误映射与脱敏：
  - 401/403 → 鉴权失败或无权调用提示
  - 404 → 模型不存在或暂不可用提示
  - 429 → 触发速率限制或免费层/配额不足提示（提醒确认付费层级）
  - 400 且 `message` 含 `location` / `region` / `country` → 当前网络出口地区不受支持提示（提醒切换代理或填写自定义 API 地址）
  - 其余错误拼装脱敏后的 `status` / `code` / `message`（清除 `apiKey`、`Bearer` 与 `x-goog-api-key`）。

- [ ] **Step 1: 在 `test/cover.test.js` 写失败测试**
  - 无参考图文生图：验证默认端点、`x-goog-api-key` 头（URL 不含 key）、`aspectRatio: '21:9'`、`imageSize`（`1K→'1K'`、`1.5K→'2K'`、`2K→'2K'`）、返回 PNG 与返回 JPEG 自动转码为目标格式。
  - 自定义 `baseUrl`：测试 `https://proxy.example.com/`、`https://proxy.example.com/v1beta/`、`https://proxy.example.com/gemini/v1beta` 均拼出正确路径且无重复 `/v1beta`；测试非法 `http://` 抛 400。
  - 参考图支持：① `https://example.com/portrait.png` 自动下载并转 `inlineData`；② `data:image/png;base64,...` 直接转 `inlineData` 且不发下载请求。
  - 错误映射：401/403、404、429、400 地区限制、`IMAGE_SAFETY` / `promptFeedback.blockReason` 拦截、空图响应、超 24 MB、错误文案脱敏 `apiKey`。
  - `generateCoverImage('gemini', ...)` 正确分发。
- [ ] **Step 2: 运行确认失败** — `node --test test/cover.test.js`
- [ ] **Step 3: 实现 `src/cover.js`**
- [ ] **Step 4: 运行确认通过** — `node --test test/cover.test.js`

---

### Task 3: 设置持久化、校验与脱敏公开（`src/settings.js`）

**Files:**
- Modify: `src/settings.js`
- Test: `test/cover.test.js`

**Interfaces:**
- Consumes: `modelsFor`, `GEMINI_DEFAULT_BASE_URL` from `./cover-options.js`, `normalizeGeminiBaseUrl` from `./cover.js`
- Produces:
  - `readSettings(root)` 新增：
    - `geminiModel`: `modelsFor('gemini').find(m => m.id === saved.geminiModel)?.id ?? modelsFor('gemini')[0].id`
    - `geminiKey`: `typeof saved.geminiKey === 'string' ? saved.geminiKey : ''`
    - `geminiBaseUrl`: 安全读取已保存字符串（非法或空则回退 `''`，代表使用默认官方地址）
  - `updateSettings(root, body)` 新增：
    - `body.geminiModel`：白名单校验，非法抛 400「请选择支持的 Google Gemini 封面模型。」
    - `body.geminiKey`：`trim().slice(0, 400)`
    - `body.geminiBaseUrl`：空字符串清空（恢复默认），非空经 `normalizeGeminiBaseUrl` 校验并规范化保存（上限 500 字符）
  - `publicSettings(settings)` 新增：
    - `geminiModel: settings.geminiModel`
    - `geminiKeySet: Boolean(settings.geminiKey)`
    - `geminiBaseUrl: settings.geminiBaseUrl`

- [ ] **Step 1: 在 `test/cover.test.js` 扩充设置测试**
  - 默认值：`geminiModel === 'gemini-nano-banana-2.1'`、`geminiKey === ''`、`geminiBaseUrl === ''`。
  - 更新 `coverProvider: 'gemini'`、`geminiModel: 'gemini-3-pro-image'`、`geminiKey: '  AIza-test-9999  '`、`geminiBaseUrl: 'https://proxy.example.com/v1beta/'` 后：`publicSettings` 不含明文 Key、`geminiKeySet === true`、`geminiBaseUrl === 'https://proxy.example.com'`。
  - 传入空 `geminiBaseUrl: ''` 清空恢复默认；传入 `http://bad.example.com` 或含账号密码 URL 抛 400；传入非法 `geminiModel` 抛 400。
- [ ] **Step 2: 运行确认失败** — `node --test test/cover.test.js`
- [ ] **Step 3: 更新 `src/settings.js`**
- [ ] **Step 4: 运行确认通过** — `node --test test/cover.test.js`

---

### Task 4: 正文插图、自定义封面风格与 Host 路由适配（`src/inline-assets.js`、`src/host.js`、`src/custom-cover-styles.js`）

**Files:**
- Modify: `src/inline-assets.js`
- Modify: `src/host.js`
- Modify: `src/custom-cover-styles.js`
- Test: `test/cover.test.js`, `test/inline-diagrams.test.js`, `test/inline-diagram-routes.test.js`, `test/custom-cover-styles.test.js`

**变动细节：**
- `src/inline-assets.js`：`generateInlineImage` 接受可选 `baseUrl`，对 `gemini` 传入 `aspectRatio: '16:9'` 与 `baseUrl`，仍要求 `format: 'png'`（由 `generateGeminiCover` 内部经 `normalizeImageFormat` 保证输出有效 PNG）。
- `src/host.js`：
  - `startCover`、`startInlineGeneration`、`case 'cover/generate'` 通过 `meta.baseUrlField ? settings[meta.baseUrlField] : ''` 透传 `baseUrl`。
- `src/custom-cover-styles.js`：
  - `previewCustomCoverStyle` 通过 `meta.baseUrlField ? settings?.[meta.baseUrlField] : ''` 透传 `baseUrl`。

- [ ] **Step 1: 补充失败测试**
  - `test/cover.test.js`：覆盖 `cover/generate` 使用 `gemini`（缺 Key 报错、带自定义 `geminiBaseUrl` 正常生成 PNG/JPEG、带 `portraitUrl` 传 `inlineData`）。
  - `test/inline-diagrams.test.js` & `test/inline-diagram-routes.test.js`：覆盖 `gemini` 插图生成传 `aspectRatio: '16:9'`、`baseUrl` 透传，且服务端返回 JPEG 时自动转为有效 PNG 落盘。
  - `test/custom-cover-styles.test.js`：覆盖 `coverProvider: 'gemini'` 试生成样式参考图（`data:` URL）与 `geminiBaseUrl` 透传。
- [ ] **Step 2: 运行确认失败** — `node --test test/cover.test.js test/inline-diagrams.test.js test/inline-diagram-routes.test.js test/custom-cover-styles.test.js`
- [ ] **Step 3: 更新 `src/inline-assets.js`、`src/host.js`、`src/custom-cover-styles.js`**
- [ ] **Step 4: 运行确认通过** — `node --test test/cover.test.js test/inline-diagrams.test.js test/inline-diagram-routes.test.js test/custom-cover-styles.test.js`

---

### Task 5: CLI 对齐（`src/cli.js`）

**Files:**
- Modify: `src/cli.js`
- Test: `test/cli.test.js`

**变动细节：**
- `VALUE_FLAGS` 增加 `'--gemini-model'`、`'--gemini-key'`、`'--gemini-base-url'`；`SUB_HELP.settings` 同步说明。
- `handleCover`：透传 `baseUrl: meta.baseUrlField ? settings[meta.baseUrlField] : ''`（支持 `io.env.GEMINI_BASE_URL ?? settings.geminiBaseUrl`）。
- `handleSettings`、`collectPatchSecrets`、`formatSettingsSummary`：支持 `--gemini-model`、`--gemini-key`、`--gemini-base-url`，脱敏 `patch.geminiKey`，摘要展示 `gemini=${pub.geminiModel}` 与 `Gemini ${pub.geminiKeySet ? '已配置' : '未配置'}`。

- [ ] **Step 1: 在 `test/cli.test.js` 写失败测试**
  - `settings set --cover-provider gemini --gemini-model gemini-3-pro-image --gemini-key AIza-secret-01 --gemini-base-url https://proxy.example.com/ --json`：确认写入、规范化且输出不含明文密钥。
  - `cover --prompt-file ... --provider gemini --out ... --json`：验证 `GEMINI_API_KEY` 与自定义 `geminiBaseUrl` 生效并裁切输出。
- [ ] **Step 2: 运行确认失败** — `node --test test/cli.test.js`
- [ ] **Step 3: 更新 `src/cli.js`**
- [ ] **Step 4: 运行确认通过** — `node --test test/cli.test.js`

---

### Task 6: 前端 UI、文档、冒烟脚本与全量验证（`client/app.jsx`、`README.md`、`scripts/smoke-package.mjs`）

**Files:**
- Modify: `client/app.jsx`
- Modify: `README.md`
- Modify: `scripts/smoke-package.mjs`
- Rebuild: `dist/client.js`, `dist/image-crop.mjs`

**变动细节：**
- `client/app.jsx`：
  - `SettingsDialog` 新增 `geminiBaseUrl` 本地 state（`null` 表示未改）；在 `patch()` 中提交 `geminiBaseUrl`（仅在修改过时提交或与 `zhuqueEndpoint` 一致按当前值提交，清空即恢复默认）。
  - 仅当 `pMeta.baseUrlField` 存在（即选中 `Google Gemini`）时，在「API Key」下方渲染：
    - `<label className="ws-field"><span>API 地址（选填）</span><input type="url" spellCheck={false} value={geminiBaseUrlValue} onChange={...} placeholder="https://generativelanguage.googleapis.com，留空使用官方地址" /></label>`
- `README.md`：
  - 配置表格新增 **Google Gemini** 一行（Nano Banana 2.1 / 2 / Pro，支持选填自定义 API 地址）；数据外发说明补充 Google Gemini。
- `scripts/smoke-package.mjs`：
  - 增加离线安装后 CLI 读写 `--cover-provider gemini --gemini-model gemini-nano-banana-2.1 --gemini-base-url https://proxy.example.com/` 的冒烟断言。

- [ ] **Step 1: 更新 `client/app.jsx`、`README.md`、`scripts/smoke-package.mjs`**
- [ ] **Step 2: 运行全量构建、测试、打包校验与安装包冒烟**
  - `npm run build && npm test && npm run check:package && mkdir -p artifacts && npm pack --pack-destination artifacts && npm run smoke:package`
  - 期望：全部测试通过、`check:package` 与 `smoke:package` 零报错。

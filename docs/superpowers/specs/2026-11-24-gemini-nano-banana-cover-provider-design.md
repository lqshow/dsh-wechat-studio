# Google Gemini（Nano Banana）生图提供方扩展设计

**日期：** 2026-11-24  
**规模：** 小型增量扩展（沿用 `src/cover-options.js` + `src/cover.js` 的多提供方架构）

## 意图与目标
- 为「封面生成」扩展第 4 个生图提供方 **Google Gemini（Nano Banana）**，同步覆盖共用的**正文插图、自定义封面风格试生成与 CLI**。
- 保留 3 款 Nano Banana 模型：
  - `gemini-nano-banana-2.1`（Nano Banana 2.1，默认）
  - `gemini-3.1-flash-image`（Nano Banana 2）
  - `gemini-3-pro-image`（Nano Banana Pro）
- 仅针对 Google Gemini 提供一个选填的「自定义 API 地址（Base URL）」，留空默认直连 `https://generativelanguage.googleapis.com`，方便国内用户使用自建反代或中转站。

## 非目标与约束
- **零新增运行时依赖**：继续使用 Node.js 内置 `fetch` 与已打包的 `dist/image-crop.mjs`（`pngjs` / `jpeg-js`），确保 `npm run check:package` 通过。
- **不改现有提供方行为**：火山方舟（`ark`）、阿里云百炼（`bailian`）、MiniMax（`minimax`）的接口、参数与 UI 保持完全兼容。
- **密钥零泄露**：`geminiKey` 仅存本地 `settings.json`（权限 `600`），通过 `x-goog-api-key` 请求头传递（不拼 URL query），日志与错误文案均脱敏；`publicSettings` 只暴露 `geminiKeySet`。
- **Base URL 安全校验**：`geminiBaseUrl` 仅允许不带账号密码的 `https://` 地址，留空回退官方地址，自动规范化末尾 `/` 与 `/v1beta` 后缀避免路径重复。

## 方案对比
1. **原生 `fetch` 直连 Gemini REST `:generateContent`（已选定）**：零依赖、可控超时与错误映射、完整支持 `imageConfig` 与参考图 `inlineData`。
2. **引入 `@google/genai` SDK（不采用）**：违反项目零运行时依赖约束，且仅调用单个 REST 端点，引入 SDK 过重。
3. **走 OpenAI 兼容层（不采用）**：对 Nano Banana 的 `imageConfig`（`aspectRatio`/`imageSize`）和多模态参考图编辑支持不完整。

## 关键实现决策
- **端点与鉴权**：`POST {baseUrl}/v1beta/models/{model}:generateContent`，请求头 `x-goog-api-key: <apiKey>`，`redirect: 'error'`，超时 `180_000` ms。
- **尺寸与比例**：
  - 封面：`generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '21:9', imageSize: resolution === '1K' ? '1K' : '2K' } }`，落盘前由现有 `saveCover` 中心裁切至 `47:20`（2.35:1）。
  - 正文插图：`aspectRatio: '16:9'`、`imageSize: '2K'`。
- **参考图（图生图）**：传入 `referenceImage` 时先校检 `https://`（无账号密码）并下载（限制 24 MB、超时 60s，支持 PNG/JPEG/WebP），编码为 `inlineData: { mimeType, data }` 与文本提示词共同放入 `contents[0].parts`。
- **输出格式兼容**：Gemini 返回的 `inlineData` 可能是 `image/png` 或 `image/jpeg`。在 `src/image-crop.js`（打包至 `dist/image-crop.mjs`）新增 `normalizeImageFormat(image, targetFormat)`，若实际魔数与目标格式一致则原样返回，否则用内置 `pngjs` / `jpeg-js` 无依赖转码，保证封面稳定支持 `png` / `jpeg`、正文插图稳定输出 `png`。
- **错误映射**：覆盖 401/403（Key 无效或无权限）、400（地区限制/无效参数/无效模型）、404（模型不存在）、429（配额不足或免费层受限）、安全拦截（`SAFETY` / `IMAGE_SAFETY` / `PROHIBITED_CONTENT`）及空图/超 24 MB。

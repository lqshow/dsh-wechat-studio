# 「备稿」模块设计方案（纸条 × 选题袋）

**日期：** 2026-11-25  
**规模：** 项目级多模块扩展（新增独立数据存储、Host API、前端模块、排期/稿面/体检跨模块联动及 CLI 子命令）  
**关联模块：** `备稿`（新增）、`稿面`、`排期`、`发布防踩坑体检`、`wechat-studio` CLI

---

## 1. 意图与背景

目前「公众号成稿台（`dsh-wechat-studio`）」的起点是**「稿面」**，隐含前提是文章已经开写或已在外部写完 Markdown。但在真实创作周期里，「动笔之前」长期处于真空：

1. **零散灵感碎片**（一句话、截图、链接）冒出来时没有归属，只能挤进 Obsidian、Apple Notes 或微信文件传输助手，越积越乱；
2. **商单与已立项选题**（带着甲方卖点、必带信息、禁忌红线、交稿/发稿日期）在动笔前会陆陆续续冒出零碎切入点，既需要独立容器集中攒料，又需要提前在排期里占住位置，避免漏看冲突；
3. 作为开源产品，创作者分两派：一派直接在成稿台内起草，另一派习惯在 Obsidian / 飞书 / Claude Code 等外部工具写完再导入 Markdown。前置模块不能假设用户抛弃原有写作工具，而要成为衔接外部与成稿台的**出版前置中枢**。

核心设计原则：**用户体验至高无上，界面自己说明自己**——打开无需教程，平时记录零负担，真正动笔时所有素材、约束和排期恰好在手边。

---

## 2. 目标、非目标与反目标

### 目标（Goals）
- **0.5 秒零负担捕获**：打开「备稿」即可直接记录文字、粘贴截图或链接，无需先起标题、选标签或建文件夹；支持任意页面快捷键随时速记。
- **一屏分清两种密度**：用**「纸条（散落火苗）」**与**「选题袋（已立项的选题与商单容器）」**两个概念替代复杂结构，界面一眼自解释。
- **商单轻量化闭环**：普通选题与商单共用同一容器，商单仅多一枚开关与「甲方要点卡」，支持粘贴甲方原文按需 AI 拆解，并在升格成稿后自动衔接「排期占位」「稿面参照」与「发布防踩坑体检」。
- **双轨成稿出口**：每个选题袋同时支持「站内放上稿面（AI 起草 / 空白开写）」与「站外写作回填（一键复制结构化备料单 / 拖入 `.md` 原地升格为稿件）」。
- **开放给外部 Agent**：提供 `wechat-studio prep` CLI 子命令，与插件共享数据文件。

### 非目标（Non-Goals）
- **不做多列看板**：不引入 `待开始 / 执行中 / 待确认 / 已完成` 等状态列拖拽。
- **不做无限自由画布**：不引入缩放、自由摆放坐标的白板。
- **不做商单 CRM / 财务管理**：不记录报价、合同、发票、回款状态、联系人电话。
- **不做标签树 / 文件夹树 / 双向链接笔记软件**：不与 Obsidian 竞争知识库管理，只按极少内容形态筛选 + 搜索兜底。
- **不做常驻占屏的 AI 聊天侧栏**：AI 仅在三个明确省力的节点按需触发，离线或未配置模型时核心功能 100% 可用。

### 反目标（Anti-Goals — 即使功能能跑也算失败）
- 记录一句话前被迫填标题、选分类或点弹窗。
- 用红点或未读数字催促用户处理旧灵感，制造待办焦虑。
- 袋子升级为正式稿件后，仍需在「备稿」和「稿面」两处手动同步状态，或在「排期」里产生重复条目。

---

## 3. 约束条件

- **零新增运行时依赖**：严格沿用 Node.js 20+ 内置 API、现有 `JsonStore`（跨进程文件锁 + 原子写）及 React 18 前端架构，保证 `npm run check:package` 与 `npm run build` 通过。
- **数据隔离与向后兼容**：新增独立存储 `~/.dsh/wechat-studio/prep.json` 与本地图片附件目录 `~/.dsh/wechat-studio/prep-assets/`；不破坏现有 `index.json` / `articles/<id>/` 结构，旧稿件零迁移成本。
- **视觉与主题一致**：沿用 `dsh-wechat-studio` 的杂志编辑桌视觉语言（刊头、`Songti SC` 衬线标题、等宽数字、陶土色 `#a84b2c`、暖亚麻纸感），所有壳层色值走 DSH 语义 token，完整支持深色与浅色主题。
- **离线可用**：除两个显式 AI 辅助按钮（「贴甲方原文提炼」「理出可写角度」）及「AI 带料起草」外，其余全部操作纯本地确定性运行。
- **安全、容量与限额（服务端强制校验）**：
  - 数量上限：袋子总数（活跃 + 已成稿 + 归档）上限 `200` 个；纸条总数上限 `2000` 条；单袋内纸条上限 `200` 条。
  - 字段长度上限：袋标题 `120` 字；单条纸条正文 `4000` 字；合作方名 `60` 字；核心卖点 `500` 字；必带信息与禁忌红线各最多 `20` 条、单条上限 `120` 字；甲方原文（`rawText` / 提炼输入）上限 `20000` 字。
  - 图片附件：单张上限 `10 MB`（同 `MAX_LOCAL_IMAGE`）；**严格按文件头魔数识别** PNG / JPEG / GIF / WebP（复用 `src/cloudinary.js` 魔数判定，不信任扩展名与 MIME，落盘扩展名强制由魔数决定）；`assetId`（UUID 白名单）、扩展名与最终路径均做严格白名单和根目录防穿越校验。

---

## 4. 方案对比

设计阶段评估并排除了「多列看板」（维护列状态是反人性的打工感）与「无限自由画布」（卡片超过 20 张即变乱，无法承载商单约束与截止日期），在 3 个可行方案中定案：

| 方案 | 概要 | 取舍 | 结论 |
| :--- | :--- | :--- | :--- |
| **方案 A：独立前置模块「备稿」（纸条 × 选题袋）** | 在左侧栏首位激活独立模块，形成 `备稿 → 稿面 → 排期 → 复盘 → 技能` 完整出版链；顶部速记条 + 定向投递胶囊，上区剪报袋卡片 + 右侧抽屉，下区自由纸条砖墙流，并打通排期虚线占位、稿面原袋参照、商单本地体检与 CLI。 | 新增一个一级模块，需保持界面克制；但保住了「稿面」首页的纯粹性，同时兼顾站内写稿与外部 Markdown 回填。 | **已选定** |
| **方案 B：轻嵌入「稿面」首页** | 维持左侧 4 个模块，在「稿面」首页内新增“筹备中”页签 + 全局快捷键侧边纸条抽屉。 | 左侧栏零增加，但「稿面」首页已承载头版、4 项 KPI、排期预告与稿件网格，再塞入速记与商单袋会导致信息密度过载。 | 不采用 |
| **方案 C：流式收件箱 + AI 后台自动归拢** | 不设手动袋子结构，统一流式扔入文字/截图/聊天记录，由 AI 在后台持续分类并抽取商单日期。 | 录入最无脑，但强绑定模型持续在线消耗 token，且 AI 分错类会破坏创作者掌控感。 | 不采用（仅吸收“按需一键拆解甲方原文”） |

---

## 5. 数据模型与存储设计

存储根目录沿用 `Store.root`（默认 `~/.dsh/wechat-studio/`，CLI 支持 `--data-dir`）。

### 5.1 `prep.json`（由 `JsonStore` 管理，支持跨进程锁）

```json
{
  "v": 1,
  "bags": [
    {
      "id": "bag_xxx",
      "title": "Cursor 2.0 重构实战：真实提效还是营销话术？",
      "type": "sponsored",
      "targetDate": "2026-11-26",
      "brief": {
        "partner": "Cursor",
        "sellingPoints": "多文件 Agent 重构速度、本地 Privacy Mode 不传源码",
        "mustInclude": ["专属试用链接", "14天Pro兑换码"],
        "taboo": ["全网最强", "直接点名贬低竞品"],
        "rawText": ""
      },
      "articleId": null,
      "pendingPromotion": null,
      "promotedAt": null,
      "archivedAt": null,
      "createdAt": "2026-11-22T09:00:00.000Z",
      "updatedAt": "2026-11-25T10:20:00.000Z"
    }
  ],
  "notes": [
    {
      "id": "note_xxx",
      "text": "开头别吹参数，直接拿上周重构 800 行旧表单时翻车又救回来的真实录屏切入。",
      "kind": "text",
      "link": null,
      "image": null,
      "bagId": "bag_xxx",
      "pinned": true,
      "included": true,
      "createdAt": "2026-11-24T14:14:00.000Z",
      "updatedAt": "2026-11-24T14:14:00.000Z"
    }
  ]
}
```

#### 字段规则
- **Note（纸条）**
  - `kind`: `'text' | 'link' | 'image'`，录入时根据内容自动判定（含附件图片为 `image`；正文含 `https?://` URL 且无图片为 `link` 并自动提取 `link.url` 和 `link.host`；其余为 `text`），用户无需手动选择类型。
  - `bagId`: `null` 表示在「自由纸条池」；非空表示已归入对应选题袋。
  - `pinned`: 仅在入袋后有效，用于置顶核心切入点（袋内排序：置顶优先，其次按 `createdAt` 倒序）。
  - `included`: 默认 `true`，表示升格成稿或导出备料单时是否带上这条想法。
  - `image`: `{ assetId, ext, mimeType, bytes, name?, cloudinaryUrl? }`，实体文件存于 `prep-assets/<assetId>.<ext>`。`cloudinaryUrl` 在首次成功上传图床后缓存，避免重复上传。**引用保护与孤儿清理**：删除纸条清理磁盘文件前，必须同时检查 `prep.json` 其他纸条及 `Store` 中全部文章正文块是否仍引用该 `assetId`，仍被文章引用的文件保留不删；同时在 `prepStore` 加载或清理时扫描 `prep-assets/`，对未被任何纸条/文章引用且 `mtime` 超过 24 小时的孤儿上传文件自动回收。
- **Bag（选题袋 / 商单袋）**
  - `type`: `'topic' | 'sponsored'`，切换为 `'sponsored'` 时启用 `brief` 对象（切换回 `'topic'` 时保留已有 `brief` 数据但不展示/不触发商单体检，防止误点丢失）。
  - `targetDate`: 可选的本地日历日期字符串 `'YYYY-MM-DD'`（与 `schedule-time.js` 的 `dayKey` / `parseDay` 格式一致，且年份须在 `2000–2100` 内）。
  - `pendingPromotion`: 升格过程中的幂等占位记录 `{ operationId, articleId, mode, createdAt } | null`，仅在跨 Store 升格进行中存在，两侧确认一致后立即清除（详见 5.3）。
  - `brief.mustInclude` 与 `brief.taboo`: 字符串数组（UI 编辑时以换行或中文/英文逗号分隔录入，便于展示与本地体检逐条匹配）。
  - **生命周期状态（推导态，不存冗余状态枚举）**：
    - `活跃攒料中`：`!archivedAt && !articleId`
    - `已成稿`：`!archivedAt && Boolean(articleId)`（按联合查询 `Store` 细分为：对应文章正常 / `linkedArticleStatus: 'archived'` 对应稿件已归档 / `linkedArticleStatus: 'deleted'` 原稿已删除）
    - `已归档`：`Boolean(archivedAt)`
  - **已成稿袋删除约束（防商单回退）**：**已成稿的袋子只允许归档，禁止物理删除**（UI 隐藏删除按钮，`POST prep/bags/delete` 返回 `409`）。仅未成稿袋子支持物理删除（默认把袋内想法退回自由纸条）。由此彻底消除“修订商单约束后删除原袋导致文章回退到旧快照”的风险。

### 5.2 `Article` 扩展字段与稿件生命周期关系（`src/article.js`、`src/duplicate-article.js`）
在 `article.json` 上仅增加两个可选字段，保持对旧稿件完全向后兼容：
- `sourceBagId?: string | null`：指向来源选题袋 ID。
- `sponsoredSnapshot?: { partner: string, sellingPoints: string, mustInclude: string[], taboo: string[] } | null`：仅在两种场景使用：① **商单文章复制**：副本必须携带独立快照；② `prep.json` 意外缺失时的极端兜底。对于带 `sourceBagId` 的原文章，运行时始终优先读取 `prep.json` 中对应袋子的最新 `brief`（因已成稿袋禁止物理删除，原文章永不发生约束回退）。

#### 稿件复制 / 归档 / 删除与袋子的契约
1. **复制文章（`src/duplicate-article.js`）**：
   - `duplicateArticle` 必须清除副本的 `sourceBagId`（加入清理键清单），严禁两篇文章共享同一袋子；
   - 若原稿关联商单，由调用方在复制前解析出**当前最新 `brief`** 写入副本的 `sponsoredSnapshot`，使副本独立享有最新商单体检与参照，且不再受原袋变动影响。
2. **原文章归档（`article.archivedAt != null`）**：
   - 对应袋子视图展示 **`对应稿件已归档`** 状态，不展示会失效的“打开稿面”按钮，改为提供「恢复并打开稿件」（调用现有恢复接口）或跳转「稿面 → 已归档」。
3. **原文章被删除（`Store` 中找不到 `bag.articleId`）**：
   - 袋子**不静默恢复为活跃攒料袋**，而是明确展示 **`原稿已删除`** 状态，由用户显式选择「重新升格成稿」（清空旧 `articleId` 后走正常升格流程）或「归档此袋」。

### 5.3 跨 Store 幂等升格与对账恢复契约
由于 `Store`（`articles/` + `.store.lock`）与 `prepStore`（`prep.json` + `prep.json.lock`）各自独立加锁，不采用跨 Store 嵌套锁，而采用**四步幂等流程 + 启动/读取对账恢复**：
1. **预占（`prepStore.update`）**：
   - 请求携带或由服务端生成 `operationId`；校验袋子当前态：
     - 若 `bag.articleId` 已存在且文章存在：同 `operationId` 幂等返回该文章，否则返回 `409`；
     - 若 `bag.pendingPromotion` 已存在：复用其中预生成的 `articleId` 继续对账，绝不重复造新 ID；
     - 否则（若为多选自由纸条直建模式，同次 `update` 先建袋收拢仍处自由态的纸条），预先生成 `articleId = newId('a')` 并写入 `bag.pendingPromotion = { operationId, articleId, mode, createdAt }` 落盘。
2. **建稿（`store.update`）**：
   - 检查 `state.articles` 中是否已存在 `id === articleId`：若已存在（崩溃重试场景）直接幂等跳过；
   - 否则创建文章（固定 `id = articleId`、`sourceBagId = bag.id`、若商单则写 `sponsoredSnapshot`、若有 `bag.targetDate` 则调用现有 `atOn(bag.targetDate, 20, 0)` 写入 `scheduledFor`），并更新 `state.currentId = articleId`。
3. **落定（`prepStore.update`）**：
   - 将 `bag.articleId = articleId`、`bag.promotedAt = now`，清除 `bag.pendingPromotion`。
4. **异步流水线触发（两侧一致后）**：
   - 仅在第 3 步完成后才触发 `pipeline.draft(articleId)` / `pipeline.titles(articleId)` / `startImageImport(...)`（若文章已有正文或已有运行中 job 则跳过，防止重试重复生成）。
5. **自动对账恢复（`reconcilePrep`）**：
   - 在 Host 初始化、`GET prep` 及 CLI `prep` 写操作前执行轻量对账：
     - 袋子含 `pendingPromotion` 且 `Store` 中对应 `articleId` **已存在** → 自动补完第 3 步（写 `bag.articleId`、清 `pendingPromotion`）；
     - 袋子含 `pendingPromotion` 且 `Store` 中对应 `articleId` **不存在**且已超时（> 30 秒，判定为建稿前崩溃）→ 清除 `pendingPromotion`，恢复为可重试态；
     - `Store` 中某文章有 `sourceBagId` 但对应袋子 `articleId` 为空且无 `pendingPromotion` → 自动回绑 `bag.articleId = article.id`。

---

## 6. 界面架构与核心交互规范

### 6.1 左侧导航与入口
- 左侧栏 `MODULES` 替换原隐藏的 `materials` 占位，正式顺序为：**`备稿` → `稿面` → `排期` → `复盘` → `技能`**。
- **默认启动落点（设计决策）**：插件打开仍默认进入「稿面」首页，不打断老用户肌肉记忆；点击左侧栏首位「备稿」进入备稿桌。
- **全站快捷键速记浮窗与焦点守卫**：
  - 组合快捷键：macOS 为 **`⌘J`**（同时支持备选 **`Alt+Shift+J`**），Windows / Linux 为 **`Alt+Shift+J`**（刻意避开 `Ctrl+J` 浏览器下载页与 `Ctrl+Shift+J` 开发者工具冲突），监听时调用 `preventDefault()`；并在界面顶栏/左侧栏保留点击入口，不强依赖快捷键。
  - 聚焦守卫：备稿页内单键快捷操作（如按 `N` 聚焦速记条、按 `/` 聚焦搜索）**仅当焦点不在 `<input>` / `<textarea>` / `[contenteditable]` 时触发**；组合快捷键在「稿面」正文编辑框聚焦时允许呼出速记浮窗，关闭后恢复原焦点与光标选区。

### 6.2 备稿主界面（三层自解释布局）
1. **刊头区**：沿用 `.ws-dh-masthead` 样式——`EDITORIAL DESK · 公众号成稿台` + 衬线大字 `备稿` + 实时统计（`X 商单 · Y 选题 · Z 自由纸条`）+ 搜索框（同时检索袋标题、甲方名、纸条正文）+ `+ 新建选题` 主按钮。
2. **顶部 0.5 秒速记条**：
   - 单行/自适应多行输入框，支持直接打字、`⌘V` 粘贴剪贴板图片、拖拽图片文件、粘贴链接；`Enter` 提交，`Shift+Enter` 换行。
   - **定向投递胶囊行**：紧贴输入框下方，默认选中 `[ 自由纸条 ]`，后面列出最多 **4 个活跃袋子**（排序规则：商单优先按 `targetDate` 升序，其次按最近更新 `updatedAt` 降序）。选中某商单胶囊后回车，内容直接成为该袋内的一条想法，无需打开抽屉；提交后保持当前选中目标方便连续输入，或一键切回「自由纸条」。
3. **上区「正在攒料」**：
   - 卡片网格（桌面宽屏 3 列、中等宽度 2 列、窄屏 1 列）。
   - **排序**：活跃商单置顶（有 `targetDate` 的按日期由近及远，无日期的按 `updatedAt` 倒序），活跃普通选题按 `updatedAt` 倒序。
   - **视觉区分**：
     - 商单袋采用与「稿面」头版同源的暖沙亚麻渐变底色（深色主题对应暖炭色）+ 陶土色虚线 `商单 · <合作方>` 印章 + 截稿倒计时（如 `周四交稿 · 剩 3 天`；过期的显示 `已过目标日`）；卡片内展示一行精简约束摘要（卖点 / 必带 / 忌）。
     - 普通选题袋采用素白卡片 + 轻量 `选题` 标签 + 最新/置顶想法摘要。
   - **直接拖拽投喂**：下方任意自由纸条拖至上方某袋卡片释放，即刻归入该袋（袋卡片悬停时高亮边框提示可放入）；同时卡片与纸条均保留点击式「归入袋子」菜单，兼容无拖拽场景。
   - **「已成稿 / 已归档」折叠区**：位于活跃袋子列表右上角或下方折叠栏，默认收起不占主视觉；展开后可一键跳到对应「稿面」文章或查看原备料记录。
4. **下区「自由纸条」**：
   - 轻筛选：`全部` / `链接` / `截图`（无标签体系）。
   - 当自由纸条数 ≥ 5 且模型可用时，筛选栏右侧安静显示次级按钮 `✦ 理出可写角度`。点击后请求 AI 返回 1～3 组建议聚类（每组含建议选题名、一句话角度和关联纸条 ID 列表），在轻弹窗中由用户勾选确认后才生成选题袋，绝不自动改写或删除原纸条。
   - **反焦虑自然沉淀**：`updatedAt` 超过 30 天的自由纸条视觉柔和变淡（虚线轻框 + 降饱和），超过 12 条沉淀纸条时折叠为「更早的纸条（N）」，永不显示未读提醒。
   - **多选撞火花**：点击自由纸条选中态（或勾选框），底部浮出深色浮动操作条，支持：**「合成新选题袋」**、**「归入已有袋子」**、**「直接放上稿面写」**、**「删除」**。
    - **「直接放上稿面写」行为（设计决策）**：弹出极轻的 1 步确认条（可填一句方向，默认取首条纸条前 24 字；选择 `✦ AI 带料起草`（无模型时禁用并提示）或 `空白稿面（挂原纸条）`），提交后通过 5.3 的幂等升格流程完成“建袋收拢选中纸条 + 升格为稿面文章”，保证选中纸条自动移出自由纸条池，且稿面同样拥有「原备料袋」参照卡片，无需维护无袋直建的第二套生命周期。

### 6.3 右侧滑出「剪报袋抽屉」
点击任意袋卡片（或从排期占位卡跳转）时，右侧滑出抽屉（保留主页面上下文，按 `Esc` 或点遮罩关闭）：
- **头部**：`普通选题 / 商单` 切换开关、可编辑方向标题、目标日期选择器（选中日期后即刻显示 `● 已占排期` 绿标，并允许一键清除）、归档/删除菜单。
- **甲方要点卡（仅商单态展开）**：
  - 4 个轻量字段：合作方/产品名、核心卖点、必带信息（多条胶囊/换行）、禁忌红线（多条胶囊/换行）。
  - 右上角提供 **`✦ 贴甲方原文提炼`** 按钮：弹出简洁文本框，贴入任意微信聊天记录或 Brief 原文后调用模型抽取上述字段及建议目标日期，展示确认预览后再回填覆盖。
- **袋内速记框 + 想法流**：
  - 顶部专属输入框直接向本袋追加文字、链接或粘贴截图。
  - 每条想法带复选框（控制本次写作是否纳入 `included`）、置顶图标（`★ 核心切入点`）、移回自由纸条、删除。
- **底部双轨成稿出口**（仅活跃袋子展示；已成稿袋子改为「打开对应稿面文章」按钮）：
  1. **`✦ AI 带料放上稿面`**（主按钮）：将袋标题作为 `topic`，把甲方要点（卖点/必带/禁忌）+ 所有勾选的 `included` 想法（置顶项排前）整理为结构化 `material`，调用后端升格接口创建文章并启动现有 `pipeline.draft`（复用个人写作风格 `writer` skill），自动跳转至该文章「稿面」。
     - **图片纸条在 AI 起草中的处理（设计决策）**：v1 保持 `pipeline.draft` 纯文本输入以兼容全部文本模型与低 token 成本——图片纸条在 `material` 中转写为 `[截图：<文字说明或文件名>]` 线索，引导模型在合适位置保留 `[截图：...]` 占位供作者后续确认插入。
  2. **`开空白稿面（挂此袋）`**：创建文章但不触发 AI 起草（保留空正文与 `topic`/`sourceBagId`），直接进入「稿面」编辑模式，并在稿面侧栏自动展开「原备料袋」供边看边写。
  3. **`复制备料单`**（次级动作）：零模型调用，前端/后端确定性拼接一份清爽 Markdown（含标题方向、目标日期、商单硬约束表、置顶与普通想法、图片说明与本地路径）写入剪贴板，方便带去 Obsidian / Claude Code / 飞书写作。
  4. **`拖入 .md 原地成稿`**（次级动作）：打开文件选择器或直接拖入 `.md`/`.markdown` 文件，复用现有 `splitMarkdown` 与飞书图片转存逻辑，**原地绑定本袋**创建正式文章，自动继承排期、标记本袋为已成稿并跳入「稿面」。若导入的 `.md` 中引用了本机 `prep-assets/<assetId>.<ext>` 路径：已配置 Cloudinary 时复用 `uploadLocalImage` 自动转存为线上 URL（并回写 `note.image.cloudinaryUrl` 缓存）；未配置图床时保留原路径并由现有「发布防踩坑体检」拦截提示替换，不阻断导入。

---

## 7. 三个跨模块联动规范

### 7.1 与「排期」的联动（`client/schedule.jsx`）
- **虚线占位卡**：在 `schedule` 周历与待办视图中，额外接收所有活跃且设置了 `targetDate` 的袋子（`!archivedAt && !articleId && targetDate`）。
- 渲染在对应日期列里，采用暖亚麻底色 + 陶土色虚线边框（普通选题为中性灰虚线边框），标注 `商单占位 · 待开写` 或 `选题占位 · 待开写`、袋标题与已攒想法数。
- **点击行为**：点击虚线占位卡直接切换至 `备稿` 模块并自动展开该袋抽屉；也支持在排期卡片菜单里直接「改期」或「取消占位」。
- **无缝转正与单一事实来源（设计决策）**：当一个带有 `targetDate` 的袋子通过任一方式升格为正式文章时，后端自动将该日期转换为默认时段（**当日晚 8 点 `20:00` 本地时区**，与现有 `SLOTS` 中的 `evening` 一致，后续可在排期自由拖拽改时段）写入 `article.scheduledFor`；由于袋子已写入 `articleId`，原虚线占位卡自动消失，由实心稿件卡无缝接替。**成稿之后，`article.scheduledFor` 成为排期唯一事实来源**：已成稿袋子的 `targetDate` 变为只读历史记录，抽屉头部改直接显示对应文章的实时排期/已发布状态并提供跳转「排期」的入口，避免跨 `Store` 与 `prepStore` 双向写锁。

### 7.2 与「稿面」的联动（`client/app.jsx`）
- 当当前打开的文章带有 `sourceBagId`（或 `sponsoredSnapshot`）时，在稿面 `SidePane` 的「文章」页签顶部展示一张可折叠的**「原备料袋」只读参照卡**（商单带陶土色印章）：
  - 展示合作方、核心卖点、必带信息、禁忌红线，以及原袋里攒下来的想法列表；
  - 若原袋仍存在，卡片右上角提供「去备稿修改要点 →」快捷入口（已成稿袋子在「备稿」抽屉中仍允许修订甲方要点卡，保存后回到稿面与体检立即生效；不在稿面侧栏内嵌第二套编辑表单）；
  - 每条想法提供「复制」与「插入到正文末尾」两个轻操作，方便边改稿边捡回遗漏金句：
    - **图片纸条「插入到正文末尾」行为（设计决策）**：若已配置 Cloudinary 图床，优先复用 `note.image.cloudinaryUrl` 缓存或调用现有 `uploadLocalImage` 上传后直接插入 `![说明](https://...)`；若未配置图床，则降级插入 `[截图：说明]` 占位并轻提示“未配置图床，已插入截图占位”，确保 100% 离线可用且不触发本地路径阻断；
  - 若是从空白稿面开写（`blocks.length === 0`），该卡片默认展开，正文区域同时保留“直接开始写”或“导入写好的 Markdown”入口，不再强迫走 AI 起草。

### 7.3 与「发布防踩坑体检」的联动（`src/preflight.js`）
- 扩展 `runPreflight(input, options)`，新增可选参数 `sponsoredBrief?: { partner?: string, mustInclude?: string[], taboo?: string[] } | null`，保持纯 JS、零模型成本、100% 确定性：
  - **两份精确清洗语料（严禁混用原始 Markdown）**：
    1. **可见正文语料（`visibleText`）**：对标题及每个非代码块的段落文本，先剥离围栏代码（`stripFencedCode`）、行内代码（`stripInlineCode`）与 Markdown 图片语法，再经 `plainOf` 得到纯可见文本（与段落一一对应，保留 `blockId` 与段号），彻底排除代码示例、图片路径与代码注释造成的假阳性；
    2. **真实链接集合（`links`）**：直接复用 `extractLinks()` 提取正文中的真实链接 destination（自动跳过代码块、行内代码与图片地址）。
  - **必带信息核对（`sponsored-must-include`）**：遍历 `mustInclude` 非空条目——若条目为链接或 URL 片段（如 `https?://` 开头或含域名路径），在 `links` 集合及 `visibleText` 中做大小写不敏感子串检查；普通文本/口令条目**仅在 `visibleText`（含标题）中检查**；未命中项产出 `severity: 'warn'` 提醒（不阻断导出与推送）。
  - **禁忌红线核对（`sponsored-taboo`）**：遍历 `taboo` 非空条目，基于同一套清洗规则逐段扫描每段的 `visibleText`（含标题）及该段 `extractLinks()`；命中项产出 `severity: 'warn'` 提醒，复用现有自定义合规词的段落定位结构（附带 `blockId` 与段号，点击直达对应段落）。
- **DSH 面板与 CLI 的商单上下文获取（设计决策）**：
  - DSH 面板（`host.js`）在执行文章体检时，自动根据 `article.sourceBagId` 优先读取 `prep.json` 中对应袋子的最新 `brief`（仅当无 `sourceBagId` 如副本文章、或极端缺袋时兜底读取 `article.sponsoredSnapshot`）传入 `runPreflight`；
  - CLI `wechat-studio check <file.md|->` 与 `wechat-studio draft push` 新增可选参数 `--bag <bagId>` / `--article <articleId>`：传入其一时自动加载商单约束参与体检；**同时传入 `--bag` 与 `--article` 时直接报用法错误退出**（不做隐式优先级猜测）；均不传时保持完全向后兼容。

---

## 8. Host API 与 CLI 设计

### 8.1 Host HTTP 接口（`/wechat-studio/prep/*`）
所有修改操作均走 `prepStore.update(...)`（跨进程锁），并返回最新 `{ bags, notes }` 切片或由前端刷新状态：
- `GET prep`：获取全部 `{ bags, notes }`（含各袋关联文章的标题/发布态摘要，便于「已成稿」区直达）。
- `POST prep/notes`：新增纸条（支持 `text`、`bagId`、`imageAssetId`）。
- `PATCH prep/notes/update`：编辑纸条正文、切换 `included` / `pinned`、修改 `bagId`（归入袋子或退回自由纸条）。
- `POST prep/notes/delete`：删除单条或多条纸条，并清理孤立图片附件。
- `POST prep/notes/batch`：多选纸条批量归入某袋，或一键合成为新选题袋。
- `POST prep/assets` / `GET prep/assets?id=...`：上传（二进制流，同 `images/upload`）与读取 `prep-assets/` 图片。
- `POST prep/bags`：新建选题袋/商单袋。
- `PATCH prep/bags/update`：修改袋标题、`type`、`targetDate`、`brief`、归档/恢复。
- `POST prep/bags/delete`：仅允许删除未成稿袋子（已成稿袋返回 `409`，请改用归档）；支持参数 `keepNotes: true` 默认将袋内想法退回自由纸条，防止误删素材。
- `POST prep/bags/promote`：升格成稿（`mode: 'ai' | 'blank' | 'import'`，可选 `operationId`、`bagId` 或 `noteIds` + `title` 用于多选自由纸条直接起草，及 `markdown`、`scheduleTime`）。严格按 5.3 的四步幂等流程与对账恢复执行，两侧一致后才启动 `pipeline.draft` / 飞书图片与 `prep-assets` 转存 / 出标题。
- `POST prep/bags/brief-markdown`：确定性生成结构化「备料单 Markdown」（纯函数，供前端复制与 CLI 共用）。
- `POST prep/ai/extract-brief`：按需调用当前配置模型，从粘贴的甲方原文（上限 `20000` 字）抽取建议 JSON `{ partner, sellingPoints, mustInclude, taboo, targetDate }`。**严格输出校验**：所有文本与条目数按第 3 节限额清洗截断；`targetDate` 必须通过 `schedule-time.js` 的 `parseDay` 及年份（`2000–2100`）校验，非法值丢弃为 `null`；接口只返回建议，必须经用户确认后才通过 `PATCH prep/bags/update` 落盘。
- `POST prep/ai/cluster-notes`：按需调用当前配置模型，从自由纸条中提炼 1～3 组可写选题建议。**严格输出校验与防漂移**：对每组 `noteIds` 去重，剔除不存在、已被删除或已归袋（`bagId !== null`）的 ID，丢弃有效数 `< 2` 的空组；接口绝不自动建袋或移动纸条；当用户在弹窗点击「确认建袋」提交 `prep/notes/batch` 时，服务端再次过滤仅迁移当前仍处于自由态的纸条，若期间有纸条被移动/删除则返回跳过提示。

### 8.2 `wechat-studio prep` CLI 子命令（`src/cli.js`）
所有子命令支持 `--json` 单行输出、`--help` 与 `-` 从 stdin 读入：
- `wechat-studio prep list [--bags] [--notes] [--sponsored] [--json]`：列出当前活跃袋子与自由纸条。
- `wechat-studio prep note <text|-> [--bag <bagId>] [--image <path>] [--json]`：速记一条灵感或直接投递进指定袋子。
- `wechat-studio prep bag create <title> [--sponsored] [--partner <name>] [--date YYYY-MM-DD] [--selling-points ...] [--must-include ...] [--taboo ...] [--json]`：新建选题/商单袋。
- `wechat-studio prep bag export <bagId> [--out <file>] [--json]`：导出结构化备料单 Markdown，方便外部 Agent / Obsidian 写作。
- `wechat-studio prep bag promote <bagId> --markdown <file|-> [--json]`：将外部写好的 Markdown 原地回填升格为正式稿件并继承排期。
- 现有 `wechat-studio check <file.md|->` 与 `wechat-studio draft push` 新增可选参数 `--bag <bagId>` / `--article <articleId>`，传入时自动载入对应商单的必带项与禁忌红线参与本地体检。

---

## 9. 验收与边界场景

1. **跨 Store 崩溃与重试测试**：单测必须覆盖“写完 `pendingPromotion` 后崩溃”“建稿成功但写回袋子前崩溃”“相同 `operationId` 重试”三种路径，验证 `reconcilePrep` 恢复后既不产生重复文章也不卡死袋子，且 `pipeline.draft` 仅在两侧一致后触发一次。
2. **删除保护与防商单回退**：删除未成稿袋子时默认将袋内想法退回「自由纸条」；**已成稿袋子禁止物理删除**（仅允许归档），彻底杜绝商单约束回退到旧快照。
3. **稿件复制 / 归档 / 删除联动**：复制商单文章时清除副本 `sourceBagId` 并写入当前最新 `sponsoredSnapshot`；原文章归档后袋子显示「对应稿件已归档」并引导恢复；原文章删除后袋子显示「原稿已删除」由用户显式选择「重新升格成稿」或「归档」，绝不静默退回活跃区。
4. **附件引用保护与安全**：未配图床文章引用本地 `prep-assets` 时，删除对应纸条不得删除仍被引用的磁盘文件；孤儿上传文件超过 24 小时自动回收；非白名单魔数文件（即便伪造 `.png` 后缀）直接拒绝上传。
5. **离线 / 无模型降级**：未配置 DSH 模型时，隐藏或弱化 `✦` AI 按钮并给出清晰提示；速记、投递、商单手填、排期占位、空白开写、备料单导出、`.md` 原地升格、商单本地体检全部正常工作。
6. **并发一致性**：CLI（外部 Agent）写入 `prep.json` 后，DSH 面板切换或聚焦窗口自动刷新，通过 `JsonStore` 跨进程文件锁避免互相覆盖；`wechat-studio check` 同时传 `--bag` 和 `--article` 时报用法错误。
7. **窄窗口、深色主题与快捷键**：在 56px 窄栏与深色主题下，暖亚麻商单卡切为暖炭底色配亮陶土印章（`#e38562`），抽屉在窄屏下自动占满视口宽度；Windows/Linux 使用 `Alt+Shift+J` 不触发浏览器下载页，输入框聚焦时不误触单键快捷键。

---

## 10. 留给实现者决定的部分

- 前端组件拆分方式（如独立 `client/prep.jsx` + 纯模型 `client/prep-model.js`）与具体 CSS 类命名（建议沿用 `ws-prep-*` 前缀）。
- 自由纸条拖入袋子的实现机制（原生 HTML5 Drag & Drop 或 Pointer Events）与动效曲线（遵循 `styles.css` 统一动效变量）。
- 剪贴板链接自动抓取网页标题策略：默认零网络请求仅提取域名与完整 URL（安全快速），如需可选抓标题留给后续迭代。
- `articles/new` 路由允许空白稿件创建的兼容方式（建议仅通过 `prep/bags/promote` 的 `mode: 'blank'` 创建空白关联稿，保持原 `articles/new` 校验不变）。
- 单元测试文件组织方式（按仓库惯例放入 `test/prep*.test.js` 覆盖存储、备料单导出、升格与排期继承、商单体检、CLI 子命令）。

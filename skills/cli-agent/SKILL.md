---
name: wechat-studio-cli
description: 通过 wechat-studio CLI 调用公众号成稿台能力（备稿纸条与选题袋/商单袋、发布体检、公众号排版、SVG 动画卡、朱雀检测、封面生成、草稿箱推送、一稿多发、个人写作风格、生效技能查询与稿件/复盘管理），供外部 Agent 与自动化脚本使用。
---

# WeChat Studio CLI 使用指南（External Agent）

`wechat-studio` 是 `dsh-wechat-studio` 的命令行入口，与 DeepSeek Harness（DSH）插件共享同一套核心模块与默认工作区（`<DSH_HOME>/wechat-studio`），也可通过 `--data-dir <path>` 隔离运行。

## 调用约定

- **总是加 `--json`**：保证 `stdout` 只输出单行合法 JSON（`{"ok":true,...}` 或 `{"ok":false,"code":"USAGE|RUNTIME","error":"..."}`），方便解析。
- **退出码**：`0` 成功，`1` 运行时/接口错误，`2` 参数错误或缺少必填选项/文件。
- **自发现帮助**：任何一级或二级子命令都支持 `--help`（如 `wechat-studio prep --help`、`wechat-studio layout --help`、`wechat-studio style analyze --help`）。
- **Stdin 管道（`-`）**：`prep note -`、`prep bag promote <bagId> --markdown -`、`check -`、`layout -`、`detect -`、`articles import -`、`cover --prompt-file -`、`style apply -`、`draft push -` 等均支持从标准输入读取内容，无需创建临时文件。
- **免额外密钥工作流（`--prompt-only`）**：外部 Agent 如果自带大模型，可在 `style analyze`、`style preview`、`cover`、`derive thread` 或 `derive xhs` 上加 `--prompt-only`，直接拿结构化提示词交给自己生成结果，再调用 `style apply` 或 `cover --prompt-file` 完成闭环。

## 常用子命令

```bash
# 0. 查看当前工作区生效的技能文件路径（写稿/改稿前先读用户个人风格或默认技能）
wechat-studio skills --json

# 1. 备稿管理（纸条 × 选题袋/商单袋，与 DSH 插件实时共享 prep.json 和 prep-assets/，100% 离线本地运行）
# 查看活跃选题袋与自由纸条（可按 --bags / --notes / --sponsored 过滤）
wechat-studio prep list --json
wechat-studio prep list --sponsored --json

# 记纸条（支持自由纸条、--bag 定向投递、- 读 stdin、--image 附本地 PNG/JPEG/GIF/WebP）
wechat-studio prep note "开头直接拿上周重构翻车的真实录屏切入" --json
wechat-studio prep note "补充一个对比数据" --bag <bagId> --image shot.png --json
echo "从 stdin 记一条纸条" | wechat-studio prep note - --bag <bagId> --json

# 创建选题袋 / 商单袋（--must-include 和 --taboo 用逗号分隔）
wechat-studio prep bag create "本地 Agent 工作流拆解" --date 2026-11-28 --json
wechat-studio prep bag create "Cursor 2.0 实测" --sponsored --partner "Cursor" --date 2026-11-26 \
  --selling-points "多文件 Agent 重构速度" --must-include "专属试用链接,14天Pro兑换码" --taboo "全网最强,贬低竞品" --json

# 导出确定性 Markdown 备料单（供外部 Agent 写稿前读取；不传 --out 则在 JSON/stdout 返回 markdown）
wechat-studio prep bag export <bagId> --out brief.md --json

# 将外部写好的 Markdown 原地升格为工作区正式稿件（自动绑定原袋、继承排期为当日 20:00、按配置转存飞书/prep-assets 图片）
wechat-studio prep bag promote <bagId> --markdown final.md --operation-id <id> --json
cat final.md | wechat-studio prep bag promote <bagId> --markdown - --json

# 2. Markdown 排成公众号 HTML（支持文件路径或 - 读 stdin；推荐加 --out 避免大体积 HTML 占满上下文）
# 如需开头横幅，先读 skills --json 里的 banner.md 生成规格 JSON，再通过 --banner 传入；--follow-card 开启文末关注卡
wechat-studio layout article.md --style neo --theme forest --banner banner.json --follow-card --out preview.html --json
cat article.md | wechat-studio layout - --out preview.html --json

# 3. 渲染单张公众号 SMIL 动画 SVG 卡片
wechat-studio svg-card svg-steps --title "写作流程" --line "收集素材" --line "起草改稿" --out card.html --json

# 4. 稿件库管理（与 DSH 插件实时共享）
wechat-studio articles list --json
wechat-studio articles import article.md --json
wechat-studio articles get <id> --json

# 5. 零成本发布防踩坑体检（媒体/占位/空标题/超 64 字标题阻断；33–64 字标题、商单外链/文字墙/合规词与商单约束仅提醒不阻断）
# 可传 --bag <bagId> 或 --article <articleId> 载入商单必带信息与禁忌红线参与体检（两参数互斥，不可同传）
wechat-studio check article.md --json
wechat-studio check article.md --bag <bagId> --fail-on-blocking --json
wechat-studio check article.md --article <articleId> --json

# 6. 朱雀文本检测（需配置环境变量或工作区设置中的朱雀 Key）
wechat-studio detect article.md --json

# 7. 个人写作风格（外部 Agent 推荐两步闭环：--prompt-only -> apply）
wechat-studio style status --json
wechat-studio style analyze sample1.md sample2.md --prompt-only --json
# 将 Agent 生成的 StyleProfile JSON 保存到 profile.json 后启用：
wechat-studio style apply profile.json --json
# 恢复默认风格：
wechat-studio style restore --json

# 8. 封面生成（2.35:1）
wechat-studio cover article.md --style felt --out cover.png --json
# 零模型 Key 闭环：先拿模板、slots、fragments、personSegments 和 system/user，
# 由 Agent 自身模型填完槽位并展开 [[...]] 后，通过 --prompt-file 直接生图并裁切：
wechat-studio cover article.md --style felt --prompt-only --json
wechat-studio cover --prompt-file final-prompt.txt --style felt --out cover.png --json

# 9. 复盘数据导入与汇总
wechat-studio insights import export.xls --json
wechat-studio insights summary --range 30 --json

# 10. 工作区配置（作者/标语/默认排版/服务凭证，不含明文回显）
wechat-studio settings get --json
wechat-studio settings set --author "你的公众号名" --slogan "一句话介绍" --style neo --theme forest --json

# 11. 公众号草稿箱推送（支持 --dry-run 本地预检、--bag / --article 商单约束体检，以及环境变量 WECHAT_APP_ID / WECHAT_APP_SECRET）
wechat-studio draft verify --json
wechat-studio draft push article.md --bag <bagId> --dry-run --json
wechat-studio draft push article.md --article <articleId> --style neo --theme forest --banner banner.json --follow-card --cover cover.png --json

# 12. 一稿多发（基于工作区稿件或本地 Markdown 导出通用 Markdown、串推、小红书图文与 PNG）
wechat-studio derive markdown <articleId> --target zhihu --out zhihu.md --json
wechat-studio derive thread <articleId> --variant x --prompt-only --json
wechat-studio derive thread <articleId> --variant jike --force --json

# 小红书图文：先查询全部可选风格、配色主题与背景氛围装饰
wechat-studio derive xhs --options --json
# 支持稿件 ID、本地 .md 文件或 - 读 stdin，并直接渲染 2× 高清 PNG 到 --out-dir
wechat-studio derive xhs article.md --style monocle --theme editorial --decor silk-dots --decor-scope smart --out-dir ./xhs-out --json
# 支持自定义设计想法与多张参考图：
wechat-studio derive xhs article.md --design-prompt "杂志暖纸感，克制留白" --ref-image ref1.png --ref-image ref2.png --out-dir ./xhs-out --json
# 免额外 API Key 闭环：由外部 Agent 自身模型生成精绘 deck.json 后，一步校验入库并导出 2× 高清 PNG：
wechat-studio derive xhs apply article.md deck.json --style monocle --theme editorial --decor silk-dots --decor-scope smart --out-dir ./xhs-out --json
# 零模型成本换配色 / 换背景氛围装饰重新出图：
wechat-studio derive xhs render <articleId> --theme bold --decor orbital-arc --decor-scope cover --out-dir ./xhs-out --json
```

## 小红书图文对话式交互协议（外部 Agent 必读）

当用户在对话中要求「把文章转成小红书图文 / 生成小红书卡片」时，**不要跳过确认直接盲目生成**，也**不需要用户配置额外的 `WECHAT_STUDIO_API_KEY`**，请按以下 3 步与用户对话协作：

1. **先拉取最新选项清单**：运行 `wechat-studio derive xhs --options --json`（或直接运行 `derive xhs` 触发风格确认门禁），获取最新的视觉风格（`styles`）、配色主题（`themes`）、背景氛围装饰（`decors`）与作用范围（`decorScopes`）。
2. **用简洁问题向用户确认偏好**（除非用户已在首句明确指定）：
   - **视觉风格**：让用户选择「① 自由发挥（`auto`，AI 按题材定制）」、「② 从 7 套固定风格里选一套（如瑞士大字报 `swiss`、纽约客报纸 `newyorker`、Monocle 日系 `monocle`、工业工具说明书 `manual`、红笔手账 `notebook`、工程实测 `tech`、杂志画报 `editorial`）」、「③ 输入自定义风格描述（`--design-prompt`）」或「④ 提供本地参考图路径（`--ref-image`）」。
   - **配色与氛围装饰**：询问是否使用默认「智能匹配（`--decor auto --decor-scope smart`，封面浓、内页轻）」，还是指定配色主题（如 Anthropic 暖砂 `editorial`、Claude 词元紫 `claude` 等）与背景装饰（如流光丝带×点阵 `silk-dots`、印刷准星 `editorial-frame` 等）。
3. **执行生成并交付成图（支持零额外 Key 自动精绘）**：
   - 将用户选择拼入 `wechat-studio derive xhs <file.md|articleId> ... --out-dir <dir> --json` 执行。
   - 若返回 `mode: "agent_generate"`（未配独立 CLI 模型 Key），直接用你自身的大模型按返回的 `system`、`user`、`styleKit.guidance`（内置排版原语类）与 `articleImages`（原文配图）生成精绘 `deck.json`，再执行返回的 `applyCommand`（即 `wechat-studio derive xhs apply ... --out-dir <dir> --json`）一步入库并渲染 2× 高清 PNG。
   - 生成后向用户汇报 `post.txt`（可直接复制的小红书标题/正文/标签）、`preview.html`（离线画廊）以及导出的 2× 高清 PNG 路径列表。
   - 若用户后续想换配色、换背景装饰或只给封面加装饰，**不要重新调模型**，直接调用 `wechat-studio derive xhs render <articleId> --theme ... --decor ... --decor-scope ... --out-dir <dir> --json` 秒级重出图。

`--operation-id` 可选。重试同一次建稿时，沿用相同的 ID、袋子和 Markdown 内容。

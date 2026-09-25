# 头脑风暴 · BRAINSTORM

每天自动抓取 AI 资讯，由 AI 结合你的个人背景（法务 / 商务 / 金融 / 经济 + 动漫，见 `profile.md`）筛出 **10 个可落地的创意**，在本地网页上以 aihot 风格的暗色时间线浏览。

## 策展管线（lib/ideas.mjs）

1. **分池草稿**（两波错峰）：法律 / 金融 / 经济 三路（内部找真痛点）+ 不限领域两路（不限定技术、行业、专业背景）
2. **闸一 · 自检清单 + 五维打分**（评委 AI）：
   - 自检四项：差异化能一句话说清？点名了资讯里的具体机制？第一步今晚/本周能做？产出物明确？
   - 五维（满分 100）：新颖度 20 + 有用性 20 + **可落地性 25** + 时机性 15 + 个人契合与复利 15
   - 四个一票否决：换皮成熟产品 / 只有概念没操作 / 跨领域硬凑 / 合规伦理风险
   - 裁决：**GO（≥80 且自检全过）** / 降位（65-79） / 淘汰（<65 或命中否决）
3. **配额选条**：法律/金融/经济保底 6 条 + 不限领域 4 条（先剔淘汰，不足才按分回补，回补的卡片标 ⚠）
4. **精修深化**：idea 280~380 字讲透 + 4~6 步落地路线（每步：动作 + 工具/数据/产出）+ 产出物 + 最大难点
5. **闸二 · 异模型终审**（agnes-2.0-flash，与生成不同源）：逐条判断 关联真实 / 可落地 / 有趣 / 合规，四项全过才发布；打回的按终审意见定向重写一次并复终审，仍不过的卡片标 ⚠ 交你人工判断；整批打回率超 30% 会告警
6. 鼠标悬停卡片上的「GO/评分/终审」徽章可看五维分项、自检结果、评委毒评和终审明细

## 20 条样例

```bash
node sample.mjs                                  # 走完整管线生成 20 条（12 条法律/金融/经济 + 8 条不限领域）
AIHOT_WINDOW=7d MERGE=1 node sample.mjs          # 换 7 天资讯窗口再生成一轮，并与已有样例合并（按资讯去重、取高分）
SKIP_REVIEW=1 node sample.mjs                    # 通道不稳时跳过闸二终审，先出结果
# 打开 http://127.0.0.1:4321/?sample=1
```

样例页的「再抓一次」会重跑 `sample.mjs`。

## AI 渠道（自动降级）

`.env` 里配了多个 OpenAI 兼容渠道，按**健康度自适应排序**（连续失败的渠道自动沉底），主渠道余额/额度出问题会自动切下一个：

1. `SENSENOVA`（token.sensenova.cn，deepseek-v4-flash）——有 TPM/RPM 限流，忙时会被降级
2. `OPENCODE_GO`（opencode.ai/zen/go/v1，deepseek-v4.1-flash，你的套餐，需要 `x-opencode-session` 头）
3. `DEEPSEEK`（api.deepseek.com，直连）——**当前余额不足（HTTP 402），充值后自动恢复**
4. `BIGMODEL`（open.bigmodel.cn，glm-5.3-flash）

**闸二终审走独立通道** `AGNES`（apihub.agnes-ai.com，Anthropic messages 协议，agnes-2.0-flash）。注意：你给的这把 key 是**免费档**，速率上限很紧（会报 "rate limit for free users"），忙时会退避重试，仍失败则回退主渠道做终审（记录里会标明「回退:渠道名」）。想要稳定的异模型把关，建议升级 agnes 的 Token Plan。

诊断渠道：`node test-llm.mjs`（逐个测通断）。

## 每天怎么用

```bash
# 1. 抓取并生成今天的脑洞（约 1-2 分钟）
node collect.mjs

# 2. 启动本地站点
node server.mjs
# 打开 http://127.0.0.1:4321
```

也可以直接双击 `run-daily.bat`（只采集）或 `start-site.bat`（启动网站）。

页面右下角的「再抓一次」按钮可以随时重新生成当天的脑洞。

## 每日定时自动采集

用 Windows 任务计划程序，每天 08:30 自动采集（在项目目录执行过一次即可）：

```bat
schtasks /create /tn "IdeaDaily-Collect" /tr "\"C:\Users\Shen longfei\.zcode\workspace\default\idea-daily\run-daily.bat\"" /sc daily /st 08:30 /f
```

删除任务：`schtasks /delete /tn "IdeaDaily-Collect" /f`
查看日志：`logs\collect.log`（`run-daily.bat` 自动写入）

看网站仍需 `node server.mjs`（或 `start-site.bat`）；数据是纯静态 JSON，采集完成刷新页面即可。

## 目录结构

```
idea-daily/
├── collect.mjs        # 每日采集 + AI 策展入口
├── sample.mjs         # 样例批次（20 条，走同一条管线）
├── server.mjs         # 本地静态站点（端口 4321）
├── test-llm.mjs       # 渠道体检（逐个测通断）
├── lib/
│   ├── sources.mjs    # 数据源适配（新增源在这里加）
│   ├── llm.mjs        # DeepSeek 调用（.env 配置）
│   └── ideas.mjs      # 脑洞生成提示词与解析
├── public/            # 前端（原生 HTML/CSS/JS，aihot 风格）
├── data/              # 每日结果 JSON + index.json 归档索引
├── profile.md         # 你的用户画像，改这里就能调整脑洞方向
├── .env               # API Key 与模型配置
├── run-daily.bat      # 定时任务入口（写日志）
└── start-site.bat     # 启动网站并打开浏览器
```

## 数据源（lib/sources.mjs）

| 源 | 方式 | 说明 |
|---|---|---|
| [AIHOT](https://aihot.news) | 官方匿名 API `/api/v1/items` | 免 Key；个人非商业免费，页面已保留来源署名 |
| [AI工具集日报](https://ai-bot.cn/daily-ai-news/) | 静态 HTML 解析 | 工作日更新 |

**想加新源**（比如 astra）：在 `lib/sources.mjs` 里照 `fetchAibot` 写一个 `fetchXxx()`，
返回 `{title, summary, url, source, ...}` 数组，然后在 `gatherCandidates()` 里加进 `Promise.allSettled` 即可。

## AI 配置（.env）

```
DEEPSEEK_API_KEY=...      # 直连 api.deepseek.com 的 Key
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-v4-flash
PORT=4321
```

任何 OpenAI 兼容接口都能用（改 BASE_URL/MODEL 即可）。Key 失效时当日会降级为"高分资讯榜"，
修复后重跑 `node collect.mjs` 即可恢复脑洞。

## 调整脑洞口味

- 改 `profile.md`：兴趣、职业、想探索的方向都写在这里，AI 每天都会读。
- 改 `lib/ideas.mjs` 里的 `SYSTEM` / 任务描述：控制选题偏好（目前是"好玩 > 重要"）、
  每天条数、多样性要求等。

## 已知边界

- 生成用的模型多是**推理模型**：思考会占用 max_tokens，长输出容易被截断。管线里的对策：草稿/精修都小批多次、两波错峰、失败自动减量重试，解析器还会**抢救被截断 JSON 里已完整的条目**（不再整批丢弃）。
- 一次完整策展约 5-10 分钟（20 条样例更久），全部在后台跑；"再抓一次"会轮询数据文件，完成后自动刷新。
- 渠道额度：SENSENOVA 有 rpm/tpm 限流、DeepSeek 余额待充、agnes 免费档限流较紧——都会自动降级/回退，日志里能看到。
- AIHOT 的 API 许可：个人非商业免费；商业化需联系其授权（见 aihot.news/agent）。

# 多会话协作约定（AI 会话 / 人工都请遵守）

这个仓库可能同时有多个 AI 会话在干活（主会话 + 辅助会话）。为了避免互相覆盖，约定如下：

## 分工边界

| 文件/目录 | 归属 | 说明 |
|---|---|---|
| `data/2026-*.json` | collect.mjs | 每日脑洞产物，不要手改 |
| `data/frontier-*.json` | frontier.mjs | 前沿关注产物，不要手改 |
| `data/sample-20.json` | sample.mjs | 样例产物，重新生成会整体替换 |
| `data/frontier-raw/` | frontier.mjs | 公众号原文存档，**只留本地，绝不发布** |
| `site/` | build-site.mjs | Pages 快照，**只改 public/ 和 build-site.mjs，不要手动塞文件** |
| `public/` `lib/` `*.mjs` | 共享 | 改前先 `git pull --rebase`，改完立即提交推送 |

## Git 习惯

1. push 前先 `git pull --rebase`；push 要检查退出码，不要用管道吞掉失败（`git push | tail -1` 会让失败看起来像成功）。
2. 提交信息里说明改动来自哪个会话/为什么改。
3. 发现别人的提交和自己的冲突：先读懂对方的意图再动，拿不准就在最终答复里向用户说明。

## 已知陷阱

- `build-site.mjs` 曾整目录删除 `site/`（连 `.git` 一起），毁掉对方提交历史——已修复为"保留 .git、只覆盖受管文件"。
- 长时间前台/后台 node 进程会被环境回收：大任务放后台并轮询，或拆小批。

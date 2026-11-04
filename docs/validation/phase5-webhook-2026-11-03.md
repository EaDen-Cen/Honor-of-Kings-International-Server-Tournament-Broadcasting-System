# Phase 5：Webhook 优先通知

## 使用方法

1. 设置中心 → Discord Webhook / 可选 Bot：填写已有 Webhook URL 并保存。只发送通知时 Bot Token、服务器 ID、频道 ID 均可留空。密钥复用 SecureSettings 加密保存，不返回浏览器或写入日志。
2. 打开“Discord 通知 / 投票”工作区。选择赛事开始、队伍/比分、本局结束、已确认 MVP、赛事结束或外部投票链接。
3. 点击“生成发送预览”，核对文字后再点“确认发送到 Discord”。预览本身不会调用 Discord；比赛关键状态改变后需重新预览，服务器也检查预览摘要。
4. 本局结束须已 commit；系列赛结束须比分已达到胜局要求；MVP 须先在赛后报告人工选择确认。公告与既有 MVP Overlay 使用同一 selectedMvpRowId，不创建第二套 MVP 权威状态。
5. 日志 `sent` 表示 Discord 已返回消息 ID；`failed` 表示明确拒绝或限流；`uncertain` 表示可能已投递，需先核对频道，再加载原预览并勾选确认才重发。429 按服务端 retry_after 冷却，不自动循环发送。

## 无 Bot 的投票方案

由有权限成员使用 Discord 原生投票，导播核对结果并手工确认赛后 MVP；或通过 Webhook 发布外部平台的 HTTPS 投票链接，再手工确认结果。Webhook 不读取反应、频道消息或票数，不宣称外部投票一人一票或防刷。原 Bot 自动投票保留在“可选增强”折叠区，需要额外安装权限；其观众 MVP 数据仍独立保存。

## 边界与接口

- `server/discordWebhook.ts`：只负责生成预览、显式发送及投递记录。直接复用安全配置中的 Webhook，不依赖 Bot 投票 archive 的健康状态。
- `GET /api/v1/discord/webhook`：脱敏状态和最近 100 条记录。
- `POST .../webhook-preview`：根据当前权威比赛状态生成内容和摘要。
- `POST .../webhook-send`：要求公告 ID、原预览摘要；同 ID 已成功的请求不重复发送。仅本机 Control 授权可用。
- `webhook-notices.json`：发送前落盘 sending；重启后未确认记录转 uncertain，不自动重发。保存最近 100 条，去重范围也是这 100 条。此文件不包含 URL/token，也不属于比赛数据导出；建议运维独立保留。
- 当比赛或 Webhook 地址变化时，旧记录重试会拒绝，需根据当前状态重新预览。手动重发不保证外部系统 exactly-once，特别是网络超时后。
- 不默认启用旧 Bot 自动公告；已有用户如开启 Bot autoStart，需自行决定是否还发送手工公告，避免有意操作造成重复通知。

协议使用 Discord 官方的 `wait=true` 获取消息确认，`allowed_mentions.parse=[]` 禁止队名/选手名触发群体提醒；不跟随重定向。依据：[Webhook API](https://github.com/discord/discord-api-docs/blob/main/developers/resources/webhook.mdx)、[Rate limits](https://github.com/discord/discord-api-docs/blob/main/developers/topics/rate-limits.mdx)。

## 验证与回滚

模拟 HTTP 的 Webhook/Bot 服务端回归 7/7 通过：无 Bot 发送、消息确认、重启去重、预览失效、未知投递显式重试、限流、秘密不入日志、已确认 MVP 及无效输入。

浏览器回归 1/1 通过（12.7 秒），使用真实本机预览 API 验证无 Bot、状态变化清除预览、明确发送、成功后禁用重复发送与未确认 MVP 拒绝；发送请求被测试拦截。构建、Lint（2 条既有 warning）和格式检查通过。这不代表真实 Discord 频道联调，真实 Webhook 通知、频道权限、MVP 展示须在测试频道由操作者验收。

回滚此阶段提交即可恢复旧 Bot 入口，无 MatchState/报告格式迁移；保留 webhook-notices.json 作为投递核对记录。不得在投递未确认时通过删除日志实现“重试”。

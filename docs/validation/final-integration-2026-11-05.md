# main 最终集成记录

核对日期为 2026-11-05。集成分支为 `codex/final-integration-20261105`，目标为 `main`。合并到 main 由用户审查后执行，发布版本另行决定。

## 分支与提交证据

- 核对时 main 为 `e19717d50fec25af6fcc67446c949171211ba4ba`，包含 #99、#100。
- 功能链末端为 `727d443cfd61206b5a53a754799393f69a87b460`（`codex/portrait-recognition-performance`）。
- 两端各有 2 / 21 个独有提交。main 独有的是 #99 与 #100 的合并提交，其源提交及文件内容也已进入功能链。
- 从最新 main 建立独立工作区，以普通 merge 合入功能链，生成 `248e134665ed6a6606c975d8967256b75443b31e`。没有文本冲突，合并后的文件树与功能链末端一致。
- 已逐一执行 ancestry 检查，#99–#108 的 head 提交和 main 均为集成提交的祖先。单个 PR 显示 Merged 所对应的目标如下。

| PR | 实际合并目标 | 已合并的 head | 合并提交 |
| --- | --- | --- | --- |
| [#99](https://github.com/EaDen-Cen/Honor-of-Kings-International-Server-Tournament-Broadcasting-System/pull/99) | `main` | `f8ef7e52bc43` | `47994d5f7ccf` |
| [#100](https://github.com/EaDen-Cen/Honor-of-Kings-International-Server-Tournament-Broadcasting-System/pull/100) | `main` | `094459f0251c` | `e19717d50fec` |
| [#101](https://github.com/EaDen-Cen/Honor-of-Kings-International-Server-Tournament-Broadcasting-System/pull/101) | `codex/phase0-baseline-20261103` | `6b18b8e34324` | `74eca6225052` |
| [#102](https://github.com/EaDen-Cen/Honor-of-Kings-International-Server-Tournament-Broadcasting-System/pull/102) | `codex/phase1-reliability-20261103` | `90caccd2eecf` | `8dc6e46875ee` |
| [#103](https://github.com/EaDen-Cen/Honor-of-Kings-International-Server-Tournament-Broadcasting-System/pull/103) | `codex/phase2-core-20261103` | `50446d8e410c` | `b57bcfb29985` |
| [#104](https://github.com/EaDen-Cen/Honor-of-Kings-International-Server-Tournament-Broadcasting-System/pull/104) | `codex/phase3-preflight-20261103` | `3b2dff581026` | `0248bfc8e7e0` |
| [#105](https://github.com/EaDen-Cen/Honor-of-Kings-International-Server-Tournament-Broadcasting-System/pull/105) | `codex/phase4-recognition-20261103` | `1b4a8fd1db92` | `db7ff60511c3` |
| [#106](https://github.com/EaDen-Cen/Honor-of-Kings-International-Server-Tournament-Broadcasting-System/pull/106) | `codex/phase5-webhook-20261103` | `84ccc76a36c6` | `557d7e3d7e03` |
| [#107](https://github.com/EaDen-Cen/Honor-of-Kings-International-Server-Tournament-Broadcasting-System/pull/107) | `codex/phase6-handover-20261103` | `90116ceaa850` | `54782ddfc9b7` |
| [#108](https://github.com/EaDen-Cen/Honor-of-Kings-International-Server-Tournament-Broadcasting-System/pull/108) | `codex/portrait-recognition-performance` | `991a502125bd` | `727d443cfd61` |

## 功能覆盖

| 来源 | 集成中的实现与验证入口 |
| --- | --- |
| #99、#100 | 原锁定英雄纠错、OBS 录制磁盘检查和人工预检，以及基线审计文档，均保留 |
| #101 | Store 逐局报告隔离、历史编辑、Undo、BP/OBS 回归及英雄资源同步修复 |
| #102 | `server/postGameActions.ts`，由 Store 调用，统一持久化与 revision |
| #103、#106 | `PreflightStatus`、预检接口、绕过留痕与工作区快捷键 |
| #104 | `AiBudget` 在服务启动时注入，含预算设置接口与 UI；逐字段 HUD 空白遮挡拒绝 |
| #105 | 独立 `DiscordWebhook`、预览与发送接口及 `DiscordWebhookPanel`，具备无 Bot 的隔离测试 |
| #107 | `capture.ts` 圆形头像有效通道匹配，保留候选排序和识别性能回归 |
| #108 | `DirectLineup`、`set_game_roles`、英雄归属动作、鼠标/触屏拖拽、历史报告与 MVP 同步 |

## 集成工作区验证

使用集成工作区的 lockfile 执行 npm ci，完整 build、lint、unit、Playwright 和四项 Windows 脚本。测试进程使用临时比赛文件与隔离服务。执行环境为 Windows、Node v24.14.1、npm 11.11.0。

已完成 build 与格式检查，lint 零错误、2 个既有 Fast Refresh 警告。完整单元与服务测试 354 项，352 通过、2 跳过、0 失败。两项跳过分别需要私有标注真实英雄/锁定裁图和十名选手校准裁图。生产依赖审计为零漏洞。

Windows 的 managed-process、launcher-smoke、launcher-session、tunnel-sync 四个脚本全部通过。Windows 原生图片识别 2 项通过，包含本地英雄头像逐个解码匹配。

完整 Playwright E2E 109/109 通过，耗时 14.5 分钟，无失败。所有应用代码来自集成合并提交 248e134，验证后仅更新文档。提交 PR 前再次读取 origin/main，仍为 e19717d，且是本分支祖先。

本次没有删除测试、降低断言或额外修改业务代码。GitHub Actions 会随最终 PR 运行，其状态以 PR 页面为准；上述为独立集成工作区的实际本机验证结果。

## 风险与审查边界

- Caster 继续使用既有延迟。人工实际分路与默认分路、P1–P5、英雄归属各自保存。
- AI 预算金额使用估算，真实供应商账单另行核对。Webhook 未向真实频道发送验收消息。
- Windows 脚本与原生图片识别检查覆盖软件流程。真实 OBS 音视频、实体平板、复杂赛事遮挡和元流之子实战样本仍待现场验收，见 [现场清单](hardware-acceptance.md)。
- 新字段有旧档读取兼容。回滚应用前应保留完整比赛存档，旧版本可能无法展示新分路数据。
- 本次集成通过独立 PR 审查。正式版本、标签与生产部署继续由用户决定。

# 模块地图

磁盘维护入口与保留规则集中在[存储维护架构](storage-ocr-reliability.md)。查动作提交或图片响应的耗时，从[传输与确认验证](../validation/upload-latency.md)定位服务器边界。

| 责任 | 现有入口 | 主要依赖与边界 |
| --- | --- | --- |
| 比赛核心 | `server/store.ts`, `src/shared/draftRules.ts`, `types.ts` | 校验 action、revision、Undo、事件、有效局与比分；所有客户端共享 |
| 传输与授权 | `server/server.ts`, `access.ts`, `src/shared/useMatch.ts`, `matchProtocol.ts` | HTTP/WS、Control 权限、延迟 Caster；不绕过 Store 写比赛数据 |
| BP 识别 | `server/capture.ts`, `recognitionProvider.ts`, `src/control/ScreenInput.tsx` | 模板、槽位、锁定、连续采样；输出候选 |
| 画面采集 | `sharedWindowCapture.ts`, `useGameDataCapture.ts`, `hudCapture.ts` | source generation、ROI、取消过期请求；窗口和静态截图分开 |
| 局内数据 | `gameDataRecognition.ts`, `src/shared/liveGame.ts`, `LiveHudCapturePanel.tsx` | 多帧、计时递进、人工冻结；仍 Experimental |
| 赛后 | `server/postGameActions.ts`, `PostGamePanel.tsx`, `SettlementCapturePanel.tsx`, `postGame*.ts` | 报告 ID 绑定归档局；人工字段保护与证据；只操作 Store 的事务副本，不另存比赛状态 |
| OBS | `obsBridge.ts`, `ObsDirectorPanel.tsx`, `postGameCarousel.ts` | 独立远程服务，必须读回确认；失败保留人工操作 |
| Discord | `discordWebhook.ts`, `DiscordWebhookPanel.tsx`; 可选 `discordVoting.ts` | Webhook 独立预览/显式发送/投递记录；Bot 投票不作为前置条件；MVP 复用报告确认值 |
| AI 费用 | `aiRecognition.ts`, `aiBudget.ts`, `AiBudgetSettings.tsx` | 每个实际请求前持久化预留每日预算；不拥有比赛状态；费用估算不是账单 |
| 开播预检 | `StartupPreflight.tsx`, `PreflightStatus.tsx` | 复用只读健康/OBS/恢复接口，实际观测与人工勾选分开 |
| 安全配置 | `secureSettings.ts`, `aiProfiles.ts` | Windows DPAPI / 非 Windows AES-GCM；不得导出密钥 |
| 恢复 | `recovery.ts`, `teamTransfer.ts`, `teamPresets.ts` | 校验、校验和、原子替换、独占锁；与赛事状态分别备份 |
| 操作台 | `BroadcastApp.tsx`, `DockWorkspace.tsx`, `workspaceLayout.ts` | 复用面板与预设；不重新实现布局框架 |
| 英雄资料 | `scripts/hero-sync/`, `heroPool.ts`, `heroIdOrder.ts` | 本地稳定 ID、外部 ID、变体与资源分离 |

变更传播清单：Store 改动同时检查 Action 类型、协议校验、归档/Undo/延迟状态、所有发送者和旧数据测试；识别改动同时检查 BP、GHUD、玩家 ID、最终阵容及人工保护；资源同步同时检查头像、原画缓存、生成清单和工作流提交路径。

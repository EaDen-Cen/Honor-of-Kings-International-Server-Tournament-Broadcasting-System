# 模块地图

| 责任 | 现有入口 | 主要依赖与边界 |
| --- | --- | --- |
| 比赛核心 | `server/store.ts`, `src/shared/draftRules.ts`, `types.ts` | 校验 action、revision、Undo、事件、有效局与比分；所有客户端共享 |
| 传输与授权 | `server/server.ts`, `access.ts`, `src/shared/useMatch.ts`, `matchProtocol.ts` | HTTP/WS、Control 权限、延迟 Caster；不绕过 Store 写比赛数据 |
| BP 识别 | `server/capture.ts`, `recognitionProvider.ts`, `src/control/ScreenInput.tsx` | 模板、槽位、锁定、连续采样；输出候选 |
| 画面采集 | `sharedWindowCapture.ts`, `useGameDataCapture.ts`, `hudCapture.ts` | source generation、ROI、取消过期请求；窗口和静态截图分开 |
| 局内数据 | `gameDataRecognition.ts`, `src/shared/liveGame.ts`, `LiveHudCapturePanel.tsx` | 多帧、计时递进、人工冻结；仍 Experimental |
| 赛后 | `PostGamePanel.tsx`, `SettlementCapturePanel.tsx`, `postGame*.ts` | 报告 ID 绑定归档局；人工字段保护与证据；跨局 UI 草稿隔离 |
| OBS | `obsBridge.ts`, `ObsDirectorPanel.tsx`, `postGameCarousel.ts` | 独立远程服务，必须读回确认；失败保留人工操作 |
| Discord | `discordVoting.ts`, `DiscordVotePanel.tsx` | 当前以 Bot 原生投票为主；Webhook 尚不是完整独立工作流 |
| 安全配置 | `secureSettings.ts`, `aiProfiles.ts` | Windows DPAPI / 非 Windows AES-GCM；不得导出密钥 |
| 恢复 | `recovery.ts`, `teamTransfer.ts`, `teamPresets.ts` | 校验、校验和、原子替换、独占锁；与赛事状态分别备份 |
| 操作台 | `BroadcastApp.tsx`, `DockWorkspace.tsx`, `workspaceLayout.ts` | 复用面板与预设；不重新实现布局框架 |
| 英雄资料 | `scripts/hero-sync/`, `heroPool.ts`, `heroIdOrder.ts` | 本地稳定 ID、外部 ID、变体与资源分离 |

变更传播清单：Store 改动同时检查 Action 类型、协议校验、归档/Undo/延迟状态、所有发送者和旧数据测试；识别改动同时检查 BP、GHUD、玩家 ID、最终阵容及人工保护；资源同步同时检查头像、原画缓存、生成清单和工作流提交路径。

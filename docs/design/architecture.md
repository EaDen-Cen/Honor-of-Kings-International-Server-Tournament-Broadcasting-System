# 系统结构

[文档索引](../README.md)

| 位置（仓库根目录起） | 职责 |
| --- | --- |
| `vite-project/src/main.tsx` → `BroadcastApp.tsx` | 当前前端入口、Control / Caster / Overlay |
| `vite-project/src/control/` | 导播工作区、Auto BP、Player ID 对齐、最终阵容、设置、照片、队伍库 |
| `vite-project/src/overlay/` | Draft Overlay、1920×1080 MVP、赛后对位/雷达/经济进程、实验性 Game HUD 与英雄揭示动画 |
| `vite-project/src/shared/` | 类型、BP 规则、显示、语言与比赛连接；结算行序共享映射及经济时间序列的解析/验证 |
| `vite-project/src/components/`、`src/data/` | 既有组件与英雄数据；旧单机组件保留 |
| `vite-project/server/server.ts` | HTTP / WebSocket、权限、静态文件与上传入口 |
| `vite-project/server/store.ts` | 比赛状态、修订号、Undo、历史、延迟和落盘 |
| `vite-project/server/teamPresets.ts`、`portraits.ts` | 独立队伍资料库与图片存储 |
| `vite-project/server/*.test.ts`、`e2e/` | 服务端测试及浏览器验收 |
| `vite-project/public/` | 构建时复制的静态资源 |
| `deploy/`、`vite-project/Dockerfile` | Compose、Caddy、容器构建 |
| `research/` | 研究证据 JSON，不是运行时英雄数据库 |

操作台经共享连接提交带修订号的操作，由服务器验证和持久化后确认并广播。Control 与 Overlay 使用实时状态，Caster 从事件时间轴读取延迟比赛进度，再叠加实时队伍/赛事资料和展示配置；延迟的是数据，不是视频。

服务器默认读取 `vite-project/data/match.json`，同级保存 `access.json`、`team-presets.json` 与 `uploads/player-portraits/`。`DATA_FILE` 可改变数据基准位置，`UPLOAD_DIR` 可另指定照片目录；迁移应覆盖全部数据。队伍资料载入比赛时复制阵容并保留稳定身份，现场修改不会自动覆盖资料库。

## 性能与扩展边界

- WebSocket 仍按 200ms 检查延迟事件；各角色按比赛修订号和可见延迟事件版本缓存序列化快照。没有变化时不重新复制或序列化状态。
- 延迟事件查询使用二分查找，避免每轮复制并反转事件数组。
- 识别保留多裁剪算法，去掉中间图片编码，缓存完全一致的证据，最多同时计算 4 个浏览器识别请求。
- 屏幕识别、英雄编辑器和模拟器页面按需加载。
- `server/access.ts` 保存随机角色 token、密码盐和 scrypt 哈希，数据位于 `data/access.json`；环境变量只用于初始配置。
- `server/recognitionProvider.ts` 定义英雄图像识别提供者接口；英雄头像仍使用 `local-template-v1`。Player ID 与赛后数字使用常驻本地 Tesseract，不调用远程 AI。
- `/api/v1/capabilities` 返回识别协议能力；`/api/v1/recognition/frame` 与已有 `/api/recognize-frame` 共用权限、修订号和响应结构。

详细协议见 [API 接口](api.md)，性能复测见 `vite-project/scripts/benchmark-recognition.ts`。

## 英雄视觉数据的三层来源

英雄图片/构图现在明确分为三层：

1. `HeroList + autoSyncedHeroes + heroSyncOverrides`：仓库中的英雄身份、Icon、Full Art 等共享数据；Hero Sync 可以更新。
2. `src/data/heroArtFocusOverrides.ts`：仓库中的 **Panel / Side 公共裁切默认值**，随 Git 和 Release 分发。
3. `MatchState.heroArtOverrides / heroDataOverrides`：导播现场保存的运行时覆盖，持久化到 `data/match.json` 并进入备份，但 `data/` 被 Git 忽略。

运行时裁切优先于共享默认值。需要把现场验证过的 Panel / Side 构图发布给所有用户时，用 `npm run hero:crop-sync` 把第 3 层中的裁切元数据提升到第 2 层，再人工审查 Git diff。这个命令不会导出其他比赛状态，也不会自动 push GitHub。

## Player ID 与实验性 HUD 状态

开局 Player ID 对齐复用 Auto BP 的共享窗口流：Control 一次裁剪双方 10 个 ID，后端使用英文/简中常驻 OCR worker 生成候选，再在每队已知 5 人 roster 中求 120 种一一映射。双方都可信时通过 `set_player_slot_orders` 原子提交；单帧边缘结果可在连续相同排列下做两帧时间一致性复核。人工采用、人工交换、恢复自动和 ID 区域独立预设都不会修改 TeamPreset 本身。

`/overlay/game-hud` 与 `LiveGameStats` 已接入状态、持久化和 OBS Overlay，但 **HUD 仍处于测试阶段**。人头、推塔和经济已有顶栏七项 OCR 原型及两帧核验；中立资源主要由 Control 人工维护；真实游戏连续识别、长时间 OBS 稳定性和版本 UI 变化尚未完成验收，因此架构上将其视为 Experimental 模块，而不是 v1.0.0 的唯一官方比分源。

## 选手对齐、恢复、HUD 与赛后 MVP

已接入每局选手槽位映射、常驻本地 OCR、备份/停机恢复、实验性局内 HUD 和赛后数据草稿/MVP 页面。HUD 仍在测试阶段。参见 [功能与操作说明](../guides/player-alignment-recovery-hud.md) 与 [项目里程碑](../../MILESTONES.md)。

## 后续 Broadcast Data Engine 设计方向

M21–M25 将逐步构建基于现有 MatchState 的统一数据模型：`MatchData`（队伍、BO、选手、当前局）、`LiveGameData`（时间、人头、塔、资源、经济；与现有 LiveGameStats 兼容）、`PostGameData`（赛后十人数据；与现有 PostGameReport 兼容），避免引入第二份竞争性的权威赛事状态。

采集适配层按实时观战与赛后多页面分开处理；OCR/图像匹配的输出先进入带 `source / capturedAt / confidence / verified` 及原始截图证据的候选层，经连续帧/异常值/跨页一致性检查后才可发布。人工修正能冻结单字段，且始终提供恢复自动与回退。M12A 的 Player Slot Order 是将游戏屏幕位置绑定到正式选手身份的唯一关键映射；不得直接凭 OCR 猜选手身份。

OBS Browser Source、Caster、Control、十人结算和 MVP 卡从一致的可信快照渲染。KPL 的图形排版是信息展示参考，不意味着存在我们可直接使用的比赛官方 API。后续音频自动化应通过可控的 OBS/音频总线接口实现 Fade、Ducking 和场景控制，必须有手动覆盖、音量安全状态和断连保护，不得阻塞 Auto BP、直播画面采集或造成音画不同步。

见 [M21–M25 具体里程碑与验收标准](../../MILESTONES.md)。**M19 Game HUD 仍为实验功能，M20 自动判页尚未通过实机验收。**


## PR #67：回放结算与赛后展示的数据边界

`SettlementCapturePanel.tsx` 将某局的 0–9 屏幕行号映射到已确认 `rowId`，在六种选手页复用，同页 OCR 不可静默覆写已有映射；这层 UI 映射只在当前浏览器 localStorage 中。真正保存的 `PostGameReport.players[].fields` 仍经 `post_game_fields` 按 `rowId` 校验、合并并进入 Store。固定模板评分 ROI 未验实，导播补录评分仍使用原来的数值字段与人工可信标记。

`postGameTimeline.ts` 接受 2–240 个真实回放时间/双方经济样本，`store.ts` 写入 `PostGameReport.goldTimeline`；`PostGameBroadcast.tsx` 在 `/overlay/game-progress` 画折线，在 `/overlay/postgame-compare` 使用已核实的同角色双方字段生成对位表及相对数值雷达。三种赛后 Overlay（包括重设计的 MVP）复用 `ViewportCanvas` 的 1920×1080 空间，不用截图拼图，也不会因缺失数据生成假值。


## PR #68：双服英雄身份与 BP 阶段抽象

`src/shared/heroPool.ts` 维护国际服已存在 ID 和独立国服工作目录，CN-only ID 用稳定的英雄名字哈希命名空间生成，**不因源文件排序、官方 ID 变化而覆盖历史国际服 ID**。`src/shared/types.ts` 的 `phases(draftMode,firstPickSide,banCount)` 定义可复现的 0–5 Ban 顺序；`src/shared/draftTurns.ts` 负责同步多选回合聚合。`server/store.ts` 对每个 Action 以当前英雄池和 Ban 数执行合法性验证，提交有效局时写入这些字段并锁定配置。Control、OBS Draft Overlay、20 槽可校准截图、Simulator、Hero Picker 都读取同一设置，不应再分散写死固定 Ban 数。

旧存档无新字段按 Match=4/Normal=2 归一化。国服2026-08-19 国服官方接口存档和近代候选仍是可人工更新的截至 2026-08-19 的 132 条存档目录；自动识别器尚未获得 CN-only 全套图像模板，不应因数据目录已经能显示而宣称具备真实国服自动 BP 能力。

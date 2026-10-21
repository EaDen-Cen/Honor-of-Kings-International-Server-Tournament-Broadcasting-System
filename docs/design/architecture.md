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

## OBS M24.0 最小落地（未经过实机验收）

`server/obsBridge.ts` 建立受回环 URL 约束的 OBS WebSocket v5 连接；支持本地密码挑战鉴权、场景列表、当前节目场景和录制状态。Node 暴露仅本地 Control 身份可调用的 `GET /api/v1/obs/status`、`POST /api/v1/obs/scene`；场景必须属于 OBS 返回的名单，切换后重新读取 Program Scene 确认。密码位于服务器环境变量，客户端从不获取。新 `ObsDirectorPanel.tsx` 显示状态并提供人工切换。

这一实现是 M24.0 的代码候选，必须与完整 [OBS 设计路线](obs-websocket-integration-roadmap.md) 区分：音乐 Fade、盘符容量、自动联动、跨公网 Agent 仍为规划。

## OBS 控制器新路径（设计规划）

现有 OBS Browser Source 属于单向网页展示；**M24.0 本地 OBS WebSocket 场景/录制状态已提交开发候选，尚未真实 OBS 验收；完整双向音频/场景自动化未实现**。计划由本地 Node `ObsAdapter` 通过 OBS 5.x 读取 Program Scene / Recording 真正状态并下发受限场景、音频预设，Control 只访问经过权限验证的本地 HOK API，不在远程浏览器保存 OBS 密码。OBS 输出目录空间由本地文件系统检查，不能靠网页或云端服务器读取本机 E 盘。必须先解决最终阵容归属“检测但没有应用”的服务端确认、状态竞态与帮抢问题，避免未核验 BP 触发自动转场。

详见 [完整 OBS 双向集成路线图](obs-websocket-integration-roadmap.md)，内容均为**计划，不属于现有接口**。

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


## PR #69：UI 路由与 GHUD 采集安全边界
`server/uiRoutes.ts` 是 Node/Vite 单页壳路由的完整枚举，`BroadcastApp.tsx` 按 `location.pathname` 选择具体 Overlay。通过这一双向清单避免组件写好了但生产服务器 404。MVP 画布对美术插画采用包含式构图，保持焦点完整。
`LiveHudCalibration.tsx` 是 Control 内的七字段按图框选 UI；由 `useGameDataCapture.tsx` 提供严格选择的 16:9 图像（不会误把下方回放工具栏当作顶部偏移），按 ROI map 请求 `server/gameDataRecognition.ts`。服务端拒绝无效 ROI 并返回 profile；`shared/liveGame.ts` 验证同一 profile、时钟增长及稳定合理的两次数值后才能写入 Store。正式比赛数据仍应以裁判/游戏界面为准。
`GameHud.tsx` 采用全画布不透明 matte 盖住顶部、底部、左右原生 UI 并绘制已有可靠的团队与十人信息；地图本身在默认纯色遮罩之下，OBS 需要一个附加地图裁切源才能恢复真实地图。

### PR #70：在单浏览器会话复用截图，解耦十人固定 ROI
`sharedGameStill.ts` 发布已 decode 的截图对象，让 `useGameDataCapture` 各实例（整页采集、单字段、GHUD）读到同一静态图；`sharedWindowCapture` 继续维护共享视频源。单字段工具在 `PostGamePanel` 冻结一张 1920×1080 画面供 `PostGameRegionPicker` 显示并框选；前端直接按像素裁出非空白 OCR 图，服务端 `postGameCaptureRows.ts` 验证候选绑定完整 report rowId，拒绝 P1 下标错配，`server.ts` 跳过无视觉信息的纯色图并保留现场证据。旧十图 POST 仍然兼容。所有数据仍经既有 PostGameField merge/Manual 保护。

## PR #91 隔离边界

`AiRecognitionService` 是有界后台调度器，`aiTransport` 在实际 DNS socket 查验公共地址并限制响应大小；`aiFusion` 复用英雄池/玩家名单/数字解析与既有比赛规则。配置或权威修改递增代次并取消旧请求。HUD 区域缓存按 worker/game/profile 保存短期相同图像读数，仍需时钟推进和双样本发布校验；AI 双缓存读数不能冒充独立样本。没有把云端请求加入 HUD 关键等待链。

工作区采用 React 18 兼容的 FlexLayout 0.8.17。布局模型只存节点/尺寸/标签；稳定 portal 宿主拥有真实组件，停靠槽位只负责移动 DOM。关闭标签不卸载识别组件，切换布局不修改服务器状态。小屏幕改纵向宿主排列，退出 Control 正常执行组件清理。

Windows Job 将一次 BAT 启动产生的进程树绑定到启动窗口生命周期。隧道监督器只负责隧道/同步，不拥有后台重启权限。站点请求只发往交接指定接口，密钥从进程环境或忽略的本地 JSON 读取。默认资源准备发生在后台启动前，避免比赛中批量下载。

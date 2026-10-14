# API 接口

除公开健康检查与登录入口外，比赛和识别接口使用 `Authorization: Bearer <角色 token>`。Control 可修改比赛，Caster / Overlay 只读；Caster 的 BP、比分与比赛进度保持延迟，队伍/赛事资料与展示配置实时更新（字段边界见 `server/store.ts` 的 `casterViewState`）。

| 接口 | 方法 | 用途 |
| --- | --- | --- |
| `/api/health` | GET | 进程健康检查 |
| `/api/access?role=control\|caster\|overlay` | GET | 连接检查；经验证的本机返回请求角色 token；Control 可获取分享 token |
| `/api/access?role=…` | POST | `{password}` 登录，也支持请求角色的 token |
| `/api/access` | PUT | Control 保存 `{password}`，轮换全部角色 token |
| `/api/match` | GET | 当前角色比赛快照 |
| `/api/heroes` | GET | 基础英雄数据 |
| `/api/v1/capabilities` | GET | 识别版本、提供者、形状与接口位置 |
| `/api/v1/recognition/frame` | POST | Control 上传浏览器英雄头像裁剪；兼容路径 `/api/recognize-frame` |
| `/api/v1/recognition/players` | GET / POST | 查询本地 Player OCR 状态；或提交双方 10 个 ID 裁剪与 roster/gameNumber，返回映射建议 |
| `/api/v1/recognition/postgame` | POST | 提交十行数字裁剪 images、reportId 与必填 metric，返回 OCR 草稿、置信度与证据；支持字段适用的 K/万/% 单位，不合法数字返回 null |
| `/api/v1/recognition/settlement` | POST | Control 提交 `{image, reportId, page, region?}`；page 为 auto/overview/damage/survival/economy/record/team/recap，返回整页数字候选、身份匹配与原图证据 |
| `/api/v1/recognition/live-hud` | POST | Control 提交 `{image, context, region?}`，返回七项顶栏候选、置信度与服务器采集时间；context 由当前局、队伍、已提交局 ID 和 Picks 组成，变化返回 409 |
| `/ws` | WebSocket | 身份认证、修订号动作、ACK 和状态广播 |

识别请求：`{revision, image, allowedHeroIds?, shape?}`。`image` 为 PNG/JPEG/WebP 的 base64 data URL；`shape` 为 square / circle。限制为 4 MiB 请求、3 MiB 解码文件及 400 万像素。显式空英雄池不会回退到全部英雄。响应包含 `preview`、`fingerprint`、`lockFingerprint`、`meanLuma`、`candidates: [{heroId, confidence}]`。confidence 是相似度，不是准确率。陈旧修订号返回 409。

未来 AI 实现 `HeroRecognitionProvider`，保持证据结构、修订号和 BP 校验流程；提供者只识别，不直接修改比赛。当前未提供 AI 模型、云端凭据或 AI 推理功能。

整页接口接受 PNG/JPEG data URL，限制 5 MiB 请求、4 MiB 编码图像和 900 万像素；`region` 为 0–1 的 `{x,y,width,height}`，必须选中 16:9 游戏内容，服务端统一到 1920×1080。模板基于当前提供的中文版结算 UI；自动判页不明确时返回错误，允许指定 page 兜底。未通过身份匹配的行返回 `rowId:null`，须人工逐行确认；不默认沿用 BP 行序。PR #67 的 Control 使用 `report.id` 对应的唯一 0–9 行身份映射，跨六种选手结算页面复用，之后的新 OCR 不会自动覆盖已确认行序；映射保存在当前浏览器 `localStorage` 的 `hok-settlement-mapping-v1:<reportId>` 中，不随服务器比赛备份迁移。recap 返回按 left/right 的 `teamCandidates`，应用前须确认队伍方向。

`post_game_fields` 合并逐选手数据，`post_game_team_fields` 合并逐队 recap；字段可带 `capturedAt`、`evidence`，可信冲突和人工值受到保护。Rating 仍是 `PostGameMetric` 中的现有数值字段；PR #67 增加十人评分人工补录（`manual:true, sourcePage:'overview'`），固定整页模板尚不自动识别评分位置，也不读取 S/A/SSS 字母评级。`live_game_ocr` 提交 `{context, previous, sample}`，两个样本均为 `{capturedAt,candidates}`，服务端复核两帧一致性、置信度、合理趋势、30 秒有效期与冻结状态；单样本不直接写入播出。`live_game_freeze` 接收 `{key,frozen}`；人工改值自动冻结该项。WebSocket 单消息上限 64 KiB，支持最多 100 项字段批次。

密码 8–256 字符，保存盐和 scrypt 哈希；修改后已连接页面通过 `access_token_update` 获取本角色新 token。离线页面重新登录。密码可取得 Control 权限，只读成员应使用角色分享 token。环境变量 `ACCESS_PASSWORD` 只在尚未配置密码时初始化。

## 选手对齐、恢复、HUD 与赛后 MVP

已接入每局选手槽位映射、常驻本地 OCR、备份/停机恢复、局内 HUD 和赛后数据草稿/MVP 页面。参见 [功能与操作说明](../guides/player-alignment-recovery-hud.md)。真实游戏和 OBS 验收状态见 [项目里程碑](../../MILESTONES.md)。

Control action `set_player_slot_orders` 接收 `blue` / `red` 两个五人排列，以及 `expectedPlayers: [蓝方 roster, 红方 roster]`。一次校验、提交和撤销双方映射；任一排列非法、名单改变或本局已提交，均不修改任何一方。原 `set_player_slot_order` 继续用于单队及人工调整。

补充 Control / 恢复 API：

| 接口 | 行为 |
| --- | --- |
| GET /api/recovery | 备份列表、最近自动备份时间与失败状态 |
| POST /api/recovery | 立即创建本机完整备份 |
| GET /api/match-export | 导出比赛/队伍/上传媒体，排除 access.json |

WS Action 包含 `set_player_slot_order`（单队人工/自动修正）、`set_player_slot_orders`（双方原子更新）、`live_game_stats`、`live_game_ocr`、`live_game_freeze`、`post_game_begin`、`post_game_fields`、`post_game_team_fields`、`post_game_gold_timeline`、`select_mvp`，沿用修订号校验、撤销、持久化及角色权限。选手 OCR 在 BP 并行推进时按阵容/当前局检验上下文，映射写入仍须使用当前 revision。OBS 路由 `/overlay/game-hud`、`/overlay/mvp`、`/overlay/postgame-compare?role=mid`、`/overlay/game-progress` 使用 overlay 角色。三种赛后图形在 1920×1080 设计画布中渲染；`role` 可用 `clash/jungle/mid/farm/roam`，默认 `clash`。雷达至少需要双方三个共同可信字段，每个轴以这两名选手的最大值为比例尺，不代表官方评分。**GHUD 的七项顶栏 OCR 已有实验原型，但真实长时间 OBS 验收未完成**，正式比赛须保留官方/人工比分兜底。


## PR #67：经济时间线与赛后图形契约

`post_game_gold_timeline` 为 Control WebSocket Action：`{type:"post_game_gold_timeline",reportId,points:[{timeSeconds,blueGold,redGold},...]}`。服务器验证 2–240 个样本、时间严格递增且为 0–7200 的整数秒、双方经济为 0–1,000,000 的非负整数。通过后写入本局 `PostGameReport.goldTimeline`，走修订号、Undo 与持久化。导播文本输入允许 `mm:ss,blueGold,redGold`，数字支持 `K/万`；最终局总经济不能替代历史采样。详情参见 [回放工作流](../guides/player-alignment-recovery-hud.md#回放结算测试与全屏赛后图形开发-pr-67)。


## PR #68：服务器英雄池与 Ban 数字段

`MatchState` / `MatchSettings` 新增 `heroPool: "global" | "cn"` 与 `banCount: 0 | 1 | 2 | 3 | 4 | 5`。服务器强制检查每次选/禁的 `heroId` 属于当前池，按 Ban 数判断轮次及结束条件；两个字段在首手 BP 及有效历史产生后锁定。每份新 `GameDraftRecord` 保存自己的 `heroPool` 和 `banCount`；旧文件缺失时归一化为全球池、Match=4/Normal=2，避免重编号旧英雄。局内状态与模拟器可共享同一 `heroPool` / `banCount`，仅改客户端 UI 不能绕过服务端合法性验证。

`GET /api/heroes` 返回国际服全名单（兼容旧调用），`GET /api/heroes?pool=cn` 返回当前国服工作候选名单。国服目录在 `src/data/cnHeroCatalog.ts`，`npm run hero:cn-sync` 将从官方名单重新生成此文件，但尚未完成 2026-10 实时抓取验收。巅峰对决盲选不由普通 0 Ban 规则表示。

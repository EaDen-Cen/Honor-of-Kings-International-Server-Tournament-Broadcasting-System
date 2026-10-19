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
| `/api/obs` | GET | Control 专属 OBS public config 与真实状态聚合；不含连接密码 |
| `/api/obs/config` | GET / PUT | 查询公开配置或保存连接/场景/音源/警告阈值；password 只写，省略保留，clearPassword 配合 enabled:false 移除 |
| `/api/obs/status` | GET | 当前 OBS 连接、场景、录制/直播、音源与磁盘状态 |
| `/api/obs/connect`、`/api/obs/disconnect` | POST | 建立/断开本机 OBS 控制连接，不操作录制/直播输出 |
| `/api/obs/command` | POST | 白名单命令与独立 id；等待 OBS 确认并返回 succeeded / failed / cancelled / unconfirmed |
| `/ws` | WebSocket | 身份认证、修订号动作、ACK 和状态广播 |

识别请求：`{revision, image, allowedHeroIds?, shape?}`。`image` 为 PNG/JPEG/WebP 的 base64 data URL；`shape` 为 square / circle。限制为 4 MiB 请求、3 MiB 解码文件及 400 万像素。显式空英雄池不会回退到全部英雄。响应包含 `preview`、`fingerprint`、`lockFingerprint`、`meanLuma`、`candidates: [{heroId, confidence}]`。confidence 是相似度，不是准确率。陈旧修订号返回 409。

未来 AI 实现 `HeroRecognitionProvider`，保持证据结构、修订号和 BP 校验流程；提供者只识别，不直接修改比赛。当前未提供 AI 模型、云端凭据或 AI 推理功能。

整页接口接受 PNG/JPEG data URL，限制 5 MiB 请求、4 MiB 编码图像和 900 万像素；`region` 为 0–1 的 `{x,y,width,height}`，必须选中 16:9 游戏内容，服务端统一到 1920×1080。模板基于当前提供的中文版结算 UI；自动判页不明确时返回错误，允许指定 page 兜底。未通过身份匹配的行返回 `rowId:null`，须人工逐行确认；不默认沿用 BP 行序。Control 使用 `report.id` 对应的唯一 0–9 行身份映射，跨七种十人结算页面复用，之后的新 OCR 不会自动覆盖已确认行序；映射保存在当前浏览器 `localStorage` 的 `hok-settlement-mapping-v1:<reportId>` 中，不随服务器比赛备份迁移。第八种 recap 返回按 left/right 的 `teamCandidates`，应用前须确认队伍方向。

`post_game_fields` 合并逐选手数据，可附 `grades:[{rowId,field}]` 将字母评级与数字字段原子保存；`post_game_grades` 单独修正评级。数字字段可带显示精度 `resolution`（1/10/100/1000/10000，非单位字段只能为 1），精确值可完善相容的圆整值。Rating 仍为可选数字评分，SSS/S/A+/B 等单独存为 `player.grade`，不能用总览经济或字母评级填入数字评分。`post_game_team_fields` 合并逐队 recap，可带 `goldDifference:{points:[{timeSeconds,difference}],source,confidence,maxDifference,evidence?,capturedAt?,partial?,durationSeconds?}` 原子保存曲线；difference 为蓝方减红方的有符号经济优势，最多 240 点，时间严格递增，自动源至少 .85 置信度，人工曲线不被 OCR 覆盖。`post_game_mvp_art_scale` 接收 `{reportId,scale}`，scale 为 1–2。字段可带 `capturedAt`、`evidence`，可信冲突和人工值受到保护。`live_game_ocr` 提交 `{context, previous, sample}`，两个样本均为 `{capturedAt,candidates}`，服务端复核两帧一致性、置信度、合理趋势、30 秒有效期与冻结状态；单样本不直接写入播出。`live_game_freeze` 接收 `{key,frozen}`；人工改值自动冻结该项。WebSocket 单消息上限 64 KiB，支持最多 100 项字段批次。

密码 8–256 字符，保存盐和 scrypt 哈希；修改后已连接页面通过 `access_token_update` 获取本角色新 token。离线页面重新登录。密码可取得 Control 权限，只读成员应使用角色分享 token。环境变量 `ACCESS_PASSWORD` 只在尚未配置密码时初始化。

## 选手对齐、恢复、HUD 与赛后 MVP

### 服务器身份核验与 OBS 联动（2026-10-19）

`set_player_slot_order(s)` 新增可选 `expectedContext`，成功保存有效身份排列后写入 `playerSlotVerification`。`verify_player_slot_orders` 接收 `{blue,red,expectedPlayers,expectedContext}`，仅核验当前不变的双方排列；可用于当前已提交局，不允许借机改变历史。上下文含本局、队伍/ID/分路、显示方向及 P1–P5，身份变化、重置与 Undo 清理过期核验。前端等待对应操作 ACK 与已保存核验结果，旧本地勾选不再生效。

OBS API 仅 Control 可访问，包括配置和本地录制目录；没有 localhost 权限绕过。写入限制 64 KiB，校验来源与 JSON。命令为 `{id,type:'preset',preset}`、`{id,type:'scene',sceneName}`、`{id,type:'bgm',volume?,muted?,fadeMs?}`、`{id,type:'cancel'}` 或 refresh；不支持任意 OBS request。preset 为共享协议中的 12 个固定逻辑阶段，场景/音源实际名称需绑定 OBS 返回资源。相同 id+命令返回原结果，不重复执行；重用 id 改命令被拒绝，缓存为当前服务进程最近 1024 条，服务重启不重放历史。

进入 Game 预设或切到所绑定的 Game 场景都必须通过 `validateGameReady`，渐变结束且切镜前再次检查。未核验身份、未完成 BP、非法阵容或错误局号会阻止动作。OBS 手动变化取消冲突动作，超时/断线结果为未确认，必须读回实际状态后人工决定下一步。连接密码位于独立本机文件，不在任何比赛快照、导出和恢复备份中。更多设置与限制见 [OBS 导播台](../guides/obs-director-setup.md)。

### 最终阵容写入确认（2026-10-19）

`set_lineup_assignments` 接收 `{blue,red,expectedContext?}`。新控制台使用 `lineupWriteContext(state)` 生成 expectedContext，涵盖当前局、阶段、先手/显示方、队伍/选手/角色、P1–P5 顺序、Pick 与原 assignments。服务器在修改前核对上下文，变化则整次拒绝；HUD、语言等独立变化不会使身份上下文失效。省略字段的旧客户端保持兼容，仍需 revision、完整阵容与 BP 资格校验。

WebSocket `ack` 新增可选 `revision`，仅在 Store 成功持久化后返回。客户端 `send` 返回操作 ID，`actionFeedback` 区分 pending / acknowledged / rejected / unconfirmed。最终阵容的“已应用”同时要求匹配操作 ID 的 ACK、新版权威快照、相同局/身份上下文及双方目标 assignments 完全相同；单纯发出命令或仅收到 ACK 都不能证明保存完成。旧 ACK 未带 revision 时继续等待至少下一版权威状态。确认超时/断线不自动重放写入，保留候选供导播核对后重试；切局和人工修改使旧上下文失效。

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

2026-10-14：上述手动回放点同时转换为 `source:'manual'` 的有符号经济优势曲线，显式人工修正优先于截图源。`recognition/settlement` 的 recap 响应新增 `goldCurve`，读取截图刻度/时间标签/圆环标记，返回像素估计的差值点或明确错误；前端确认「我方」对应蓝/红后决定符号，再随 recap 一次提交。图表采用中间零线和右侧纵轴，不将截图差值转换为虚构的双方累计经济总量。

框选适配修正：`goldCurve.warning` 标记末尾遮挡等部分结果，前端提交为 `goldDifference.partial:true`。部分自动曲线不能覆盖完整已保存曲线；可信完整曲线可完善部分结果，人工值仍受保护。图表边界、刻度和时间标签按实际定位读取，不要求固定端点坐标。

`goldCurve.durationSeconds` / `goldDifference.durationSeconds` 为可选的实际最后时间刻度，必须是末尾已观察点至 7200 之间的整数秒。部分曲线可据此保留完整横轴，末尾没有标记的位置不生成数据点；旧曲线没有该字段时沿用最后观察点。正负经济刻度均须独立达到 `.85`，总可信度取必要刻度和时间证据的最低值。结算总览可返回 `gradeWarning`：评级失败时仍返回成功识别的数字和身份草稿。

恢复与实时 Action 共用赛后字段、评级、精度、曲线校验。停机恢复在验证与文件替换期间持续持有后端锁。GHUD 样本的 30 秒有效期约束新提交样本，采集中断不会永久锁死旧 OCR 字段；重新获得两帧可信连续样本后仍检查合理趋势与人工冻结。

数字 Rating 在实时写入和恢复时均限定 0–100。`post_game_grades` 和 `post_game_mvp_art_scale` 同样沿用 Control 权限、修订号、Undo 与持久化；快照协议校验包含评级、数值精度、曲线及缩放字段。

结算识别请求支持 `leftSide?:"blue"|"red"`（旧客户端默认 `blue`）。十人页面响应回传 `leftSide`，按该方向匹配左右队伍的选手身份，`screenRow` 和数值仍对应原截图行。控制台按报告记住方向；切换时作废旧请求和身份绑定，保留待审核的数字草稿。


## PR #68：服务器英雄池与 Ban 数字段

`MatchState` / `MatchSettings` 新增 `heroPool: "global" | "cn"` 与 `banCount: 0 | 1 | 2 | 3 | 4 | 5`。服务器强制检查每次选/禁的 `heroId` 属于当前池，按 Ban 数判断轮次及结束条件；两个字段在首手 BP 及有效历史产生后锁定。每份新 `GameDraftRecord` 保存自己的 `heroPool` 和 `banCount`；旧文件缺失时归一化为全球池、Match=4/Normal=2，避免重编号旧英雄。局内状态与模拟器可共享同一 `heroPool` / `banCount`，仅改客户端 UI 不能绕过服务端合法性验证。

`GET /api/heroes` 返回国际服全名单（兼容旧调用），`GET /api/heroes?pool=cn` 返回当前国服工作候选名单。国服目录在 `src/data/cnHeroCatalog.ts`，`npm run hero:cn-sync` 将从官方名单重新生成此文件，但尚未完成 2026-10 实时抓取验收。巅峰对决盲选不由普通 0 Ban 规则表示。


## PR #69：真实 SPA 路由 + HUD 自定义 ROI 请求
后端 HTML Shell 由 `server/uiRoutes.ts` 统一维护。路由新增 `/overlay/postgame-compare`（`role` 为查询参数，选对位：clash/jungle/mid/farm/roam）和 `/overlay/game-progress`，二者均映射 `dist/index.html`，不增加多页面 Vite 入口；未知 HTML 路径不得使用任意 overlay shell 兜底。

`POST /api/v1/recognition/live-hud` 接收 `{image,context,regions?}`，`regions` 是精确含七个 `LiveCaptureKey` 的 0–1 矩形 map。每个 ROI 必须位于合法画面中，限制宽/高及互相覆盖比例，不合法返回 HTTP 400；无 `regions` 兼容旧请求，但 Control UI 必须经过手动预览确认才能提交。返回 `profile` 为规范化 ROI 字符串，随后 `live_game_ocr` 若 `previous.profile !== sample.profile` 必须拒绝跨配置两帧合并；时钟必须实际增长。运营端保存 `localStorage['hok-ghud-calibration-v1']`，不是云端共享预设，不应暗示自动同步到另一台设备。

### PR #70：数字字段 OCR 部分选手模式
`POST /api/v1/recognition/postgame` 支持 `{reportId,metric,images:[PNG data URL ...],rowIds:[report rowId ...]}`，其中 image/rowId 一一对应，允许 1–10 项，`rowIds` 必须属于对应已建立的 `PostGameReport.players` 且不能重复。旧客户端若省略 rowIds，只接受与报告人数一致的完整十行数组，不允许一张图暗中写入 P1。请求中完全空白/纯色图将跳过，若全部空白返回 422；有有效图才调用数值 OCR，并按原始 rowId 返回 `{candidates:[{rowId,value,confidence,text,evidence}],elapsedMs}`。每个 candidate 必须由 Control 人工点击应用，保护手工值与已有可信冲突。截图通过前端会话分享；服务器存储的 evidence 仅为实际参与 OCR 的裁图。

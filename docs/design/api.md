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
| `/api/v1/recognition/postgame` | POST | 提交赛后数字裁剪与 reportId，返回 OCR 草稿、置信度与证据 |
| `/ws` | WebSocket | 身份认证、修订号动作、ACK 和状态广播 |

识别请求：`{revision, image, allowedHeroIds?, shape?}`。`image` 为 PNG/JPEG/WebP 的 base64 data URL；`shape` 为 square / circle。限制为 4 MiB 请求、3 MiB 解码文件及 400 万像素。显式空英雄池不会回退到全部英雄。响应包含 `preview`、`fingerprint`、`lockFingerprint`、`meanLuma`、`candidates: [{heroId, confidence}]`。confidence 是相似度，不是准确率。陈旧修订号返回 409。

未来 AI 实现 `HeroRecognitionProvider`，保持证据结构、修订号和 BP 校验流程；提供者只识别，不直接修改比赛。当前未提供 AI 模型、云端凭据或 AI 推理功能。

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

WS Action 包含 `set_player_slot_order`（单队人工/自动修正）、`set_player_slot_orders`（双方原子更新）、`live_game_stats`、`post_game_begin`、`post_game_fields`、`select_mvp`，沿用修订号校验、撤销、持久化及角色权限。选手 OCR 在 BP 并行推进时按阵容/当前局检验上下文，映射写入仍须使用当前 revision。新 OBS 路由 `/overlay/game-hud` 与 `/overlay/mvp` 使用 overlay 角色。**`/overlay/game-hud` 当前为 Experimental / 测试阶段**：接口与持久化已实现，但自动 HUD 数据读取尚未实现；真实比赛长时间稳定性待实机验收；正式比赛须保留官方/人工比分兜底。

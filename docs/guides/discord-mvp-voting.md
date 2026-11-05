# Discord 观众 MVP 投票

## 无 Bot 的严格三分钟投票（开发分支）

采用 Webhook + 本系统投票页面。Discord 原生 Poll 的 `duration` 是整数小时，普通 Webhook 没有提前结束 Poll 的接口。三分钟后编辑文字仅是软截止，不能阻止新票，也不能将后续变化的结果当作三分钟最终票数。本功能不创建原生 Poll。依据：[Discord Poll](https://docs.discord.com/developers/resources/poll)、[Webhook API](https://docs.discord.com/developers/resources/webhook)（2026-11-05 核对）。

### 配置与操作

1. 在设置中心只保存频道 Webhook URL，Bot Token、服务器 ID、频道 ID 均可留空。复用已有 DPAPI 加密密钥存储。
2. 为本服务准备可公开访问的 HTTPS 域名。在「Discord 通知 / 投票」→「三分钟 MVP 投票」→「投票设置」填入域名，例如 `https://broadcast.example.com`（不带路径）。该设置不会替你部署域名、隧道或证书。反向代理必须转发 `/vote/*`、`/api/v1/public-votes/*` 与页面静态资源；不要把 Control 口令附在公开链接里。
3. 默认候选为十人，可保存为胜方五人。核对本局赛后名单；先提交 BP 阵容，再选择胜方并点击「确认本局比赛已结束」。**提交 BP 不会自动发票，结束确认也不会修改比分。**
4. 自动发布默认关闭。保存开启后，服务器在本局结束确认后自动创建投票并发布 HTTPS 链接；开启时当前局已经确认结束，也会处理该局。关闭自动发布时，可人工「发布三分钟投票」。不必保持 Control 页面打开。
5. 180 秒从服务器创建投票时开始，开始时间与截止时间先持久化，再发送公告。Discord 网络耗时或重试不会延长窗口。页面按服务器时间及本地单调计时显示倒计时，最终是否收票由服务器决定；在截止时刻及之后拒绝提交。正常结束通知由后台定时发送，网络故障可能延迟公告，但不会延迟停止收票。
6. 导播可提前截止或取消。取消后票数作废，但保留审计记录；同一局不重新创建第二张票。结束后查看每名选手票数，手工选择 MVP，勾选身份与结果已核对，再确认写入赛事 MVP。平票、零票不会自动选人。
7. 确认后的 MVP 使用现有赛后报告和 `/overlay/mvp`。历史局确认只修改对应报告，不切换当前局展示。本功能不写旧 Bot 的 `/overlay/audience-mvp` 存档。

### 防重复与名单变化

每个浏览器保存随机投票标识，服务器只持久化每局加盐哈希；同一候选的重试不重复计数，更换候选的重复提交会拒绝。接口另有按连接地址的请求限流，不信任客户端伪造的转发 IP。**这不是实名一人一票**：清除浏览器存储、更换设备或自动生成标识可绕过身份防重复，必须人工核验。没有实现 Discord OAuth；也不要求安装 Bot。

名单、队伍与实际分路在投票创建时冻结。之后修正赛后名单或换路不会悄悄改票的含义，导播面板会显示变化警告；身份不再匹配时不能从投票面板确认该 MVP，应在赛后面板重新核实。投票设置只影响尚未创建的投票。

### 恢复与重试

- `data/strict-votes.json` 保存配置、投票 ID、对应报告 ID、候选快照、开始/截止时间、匿名票据哈希、票数及开始/结束公告状态与消息 ID。与比赛 Store 和旧 Bot 的 `audience-votes.json` 分离。
- 重启从原截止时间恢复，过期投票立即关闭；Undo、跨局和网页刷新不重开投票。损坏存档时保留原文件并停止此功能，不自动重建空档。首次使用时才创建新投票文件；删除原文件会丢失记录。
- Webhook 发送复用 `webhook-notices.json` 的持久化日志。已成功的公告不重发；429 等明确失败可等待后安全重试。超时或崩溃导致结果不确定时，必须先核对频道，再勾选允许重试，可能重复的只是同一链接公告，不会创建新投票或延长截止。Webhook 没有端到端 exactly-once 保证。
- 存档写入失败时停止收票；修复磁盘权限或空间后重启。比赛导出/旧备份格式不包含投票文件，停服备份时应另行保管 `strict-votes.json` 和 `webhook-notices.json`。不要删除它们来“重试”，否则会丢失防重复记录。加密凭证另行按原设置指南保管。
- HTTPS 可达性、真实 Discord 频道和高并发观众需现场彩排；代理共享连接地址会共享限流额度。当前未验证大规模刷票抵抗和高并发容量，不能称为正式身份认证投票。

普通的 Webhook 开始/比分/结束/MVP/外部链接公告仍可预览后手动发送，见 [此前 Webhook 验证](../validation/phase5-webhook-2026-11-03.md)。本轮自动化测试与真实联调边界见 [严格投票验证](../validation/strict-mvp-voting.md)。

以下 Bot 自动投票为可选增强，需要额外安装权限，不是 Webhook 通知的前置条件。

本功能是 2026-10-23 开发升级，真实 Discord 频道验收待用户配置。本轮按用户决定只进行隔离测试。

## Bot 与凭证

在 Discord Developer Portal 创建应用和 Bot，在目标服务器授权 View Channel、Send Messages、Read Message History、Send Polls；先使用专用测试频道。无需为本功能开启读取所有消息的 Gateway privileged intent。复制服务器及频道 ID，在本机 Control 顶部「设置中心」填写 Bot Token 和 ID，保存后点击「测试 Bot 连接」。连接测试只验证身份和频道可读，发布权限仍须实际 Poll 彩排确认。

Webhook 是可选公告通道，填写新建的 `https://discord.com/api/webhooks/.../...`，不要继续使用已暴露的旧地址。旧 Bot 模式由 Bot 创建或结束原生 Poll；上述无 Bot 模式使用独立页面严格截止。所有提及默认关闭，候选人文本不会触发 @everyone。

Bot Token、Webhook URL 由当前 Windows 用户 DPAPI 加密保存在 `data/secure-settings.json`，GET 仅返回配置标记与部分 Bot 掩码。留空沿用凭证，单独清除 Webhook 或删除凭证；进行中的投票完成前不能更换 Bot / 频道。该文件不进 Git、比赛导出、浏览器存储或日志。Linux/macOS 需按 [AI 配置](ai-recognition.md) 设置 `HOK_CONFIG_KEY`。加密文件应由同一 OS 用户保管，不具备跨机器可移植性。

## 赛事流程

1. BP 完成时即可建议游戏画面。比赛结束后人工覆盖 OBS 阶段为赛后，核对后「确认本局有效」并创建十人赛后报告。
2. 从面板列表打开「MVP 投票」，自动准备本局名单。默认全场 10 人、3 分钟单选；可设 2–5 分钟。获胜队 5 人模式需要人工确认胜方，本系统不从比分增减猜胜方。
3. 编辑候选人昵称并核对，点击开始。由同一个 Bot 创建原生 Poll，Discord 原生 duration 设置 1 小时，本地服务在分钟截止时间调用该 Bot 的提前结束接口。Discord 文本的可见截止时间仍可能显示原生小时期限，消息正文会说明实际分钟截止。
4. 本地每 5 秒同步票数与截止状态，可提前结束或取消。没有 results 时显示等待数据；有 results 的缺省 answer count 按 Discord 语义为零。截止后直到 `is_finalized=true` 才确认最终结果。
5. 赛后六类数据轮播与投票独立运行。数据 / 赛事 MVP 继续使用已有人工核验流程，观众 MVP 单独保存；没有新增或改变评分算法。
6. 平票列出所有最高票者，由导播按赛前规则处理；零票显示无人投票，不随机选人。自动发起默认关闭，显式开启后仅全场模式可无人确认发起；胜队模式仍需人工确认。

## 恢复与失败

每局记录保存在 `data/audience-votes.json`，包含消息 ID、频道、截止时间及最终票数，不包含凭证。重启后恢复已知消息并补做截止，绝不自动重新发布同一局。建议随赛事数据另外保管此记录；旧备份格式不会包含新投票记录或加密凭证。

创建请求先保存 creating 意图，并使用稳定 nonce。若请求超时或崩溃，进入「创建待核对」：在频道找到同一 Bot 的投票，复制消息 ID，在控制台恢复；会核验作者和完整候选顺序。未知创建状态不能直接取消，否则可能遗留仍可投票的远程 Poll。若 Discord 明确以 4xx 拒绝创建，则记录失败，修正权限或等待限流后可人工重新开始。不要为了重试而删除本地记录。

API 429 按 Retry-After / reset 信息冷却；网络断开保持现有状态，恢复后继续。最终计票未就绪显示待确认并提供重试。自动公告采用先记意图再发送，防止崩溃后反复推送；如果发送未确认，先在频道核对，控制台结果仍保留。服务完全离线时无法保证在三分钟当刻调用截止，恢复后补做；原生 Poll 最迟仍按小时期限结束。

## OBS

添加 `/overlay/audience-mvp`，1920×1080，并使用 Overlay 角色访问令牌。显示双方、候选人、倒计时、票数百分比及最终结果。设置可隐藏直播端实时票数，结束后揭晓；不会覆盖 `/overlay/mvp`。

## 接口与官方依据

本机 Control：`GET/PUT /api/v1/discord/config`，`POST /api/v1/discord/test|start|end|cancel|retry|recover`。投票操作仅在用户点击或显式授权自动模式后执行。`GET /api/v1/audience-vote` 需要角色令牌，Overlay 响应遵守隐藏实时票数设置。

实现依据：[Poll](https://docs.discord.com/developers/resources/poll)、[Create Message / nonce](https://docs.discord.com/developers/resources/message#create-message)、[Rate limits](https://docs.discord.com/developers/topics/rate-limits)。

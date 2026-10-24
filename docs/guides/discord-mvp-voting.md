# Discord 观众 MVP 投票

本功能是 2026-10-23 开发升级，真实 Discord 频道验收待用户配置。本轮按用户决定只进行隔离测试。

## Bot 与凭证

在 Discord Developer Portal 创建应用和 Bot，在目标服务器授权 View Channel、Send Messages、Read Message History、Send Polls；先使用专用测试频道。无需为本功能开启读取所有消息的 Gateway privileged intent。复制服务器及频道 ID，在本机 Control 顶部「设置中心」填写 Bot Token 和 ID，保存后点击「测试 Bot 连接」。连接测试只验证身份和频道可读，发布权限仍须实际 Poll 彩排确认。

Webhook 是可选公告通道，填写新建的 `https://discord.com/api/webhooks/.../...`，不要继续使用已暴露的旧地址。Webhook 不负责创建或结束投票。所有提及默认关闭，候选人文本不会触发 @everyone。

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

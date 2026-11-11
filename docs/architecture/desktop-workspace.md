# 桌面工作区与原生投票边界

现场切换或关闭面板后，核对同一动作的服务器 ACK，识别任务是否继续由原有面板服务管理。详情可从[桌面工作区操作](../guides/dock-workspace.md)进入。

DockWorkspace 继续独占 FlexLayout Model 和每个业务面板的稳定 Portal host。菜单仅触发原有 action 或布局操作；网页内浮动是同一 host 的另一种挂载槽位，不创建第二套比赛状态或独立窗口服务。隐藏面板停车在原 parking 容器，React 组件与采集任务不卸载。预检与指南拆分成独立面板；预检计数上报主界面，自动查询与人工确认继续分开。OBS 关键状态由已有 ObsDirectorPanel 上报。

StrictVoting 沿用 #110 独立投票文件、每个 reportId 一个投票、候选快照和终态保护，增加 native/web 模式；缺少 mode 的旧配置与记录按 web 解读，新配置默认 native。native 发布前为 pending，发布时间/截止时间为 0；仅 Webhook 日志确认 sent 后记录成功时间并激活 180 秒期限。过期 closed 对 native 只表示本地规定时间结束，不表示 Discord 关闭，不生成或读取票数快照。web 的逐次服务器期限检查不变。

DiscordWebhook 保存冻结的 Poll 请求并纳入预览 hash，继续禁用 mentions、复用安全密钥存储及发送日志。未知 native POST 不允许直接重试，恢复读取原消息并校验作者、问题、单选和候选顺序，用原消息时间恢复。发布和原消息恢复都遵守持久化 Retry-After 冷却，重启不提前重试。开始和截止通知独立幂等。取消不删除 Discord 消息。Bot 原有计票存档保留，仅在显式选择 Bot 模式且权威报告已确认结束时自动启动。

最终 MVP 仍走 select_mvp 身份校验与 activate:false，历史报告不会切换当前 Overlay。原生模式不填充本地票数，不将默认零数组展示成已读取的零票结果。

回滚前应保留比赛、strict-votes.json 和 webhook-notices.json，并完成或取消活动流程。旧版本不理解新增原生记录，投票服务可能拒绝加载；不要为回滚删除记录或清空生产状态，比赛主 Store 未新增破坏性迁移。

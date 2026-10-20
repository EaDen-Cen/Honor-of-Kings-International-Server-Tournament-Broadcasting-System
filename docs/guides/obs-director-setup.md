# OBS Director（M24.2 · 赛事工作区、场景联动与布局核查）

> **开发分支功能，尚未在用户赛事机 OBS 实测验收。** 当前支持连接、场景列表、Program Scene 切换、录制状态和**手动指定音频源淡入淡出**。尚不包含自动导播宏、磁盘空间检测、直播状态、自动切镜或云端 Agent。
>
> [文档总索引](../README.md) · [M24 完整设计](../design/obs-websocket-integration-roadmap.md)

## 前置条件

- OBS Studio 28 及以上版本，启用 **工具 → WebSocket Server Settings → Enable WebSocket server**，设置一个强密码；WebSocket 默认端口通常为 `4455`。
- 确认 OBS 与运行 HOK Node 服务的机器是**同一台电脑**；此阶段不会跨互联网控制另一台 PC。
- 通过本机 `localhost` 或 `127.0.0.1` 登录 `/control`。通过远端域名/反向代理访问 Control 不允许调用本地 OBS API，这是刻意的安全约束。

## 本地服务配置

在启动 HOK Node 的环境中配置（不要提交 `.env` 到 Git）：

```dotenv
OBS_WS_URL=ws://127.0.0.1:4455
OBS_WS_PASSWORD=在OBS中设置的WebSocket密码
```

运行服务器时沿用项目已有的启动器或 `npm run server`（从 `vite-project/` 执行；现有启动脚本会读取其环境配置，部署方式不同请确保变量传递至 Node 进程）。**不要把 OBS WebSocket 密码写在前端 `VITE_*` 配置中**，也不要把 4455 端口映射到公网。

若未设置 `OBS_WS_URL`，OBS Director 会显示未配置，不会尝试连接。

## 使用步骤

1. 启动本机 OBS，先把 Waiting、BP、Game、Postgame、MVP 等场景在 OBS 内建立好。
2. 启动 HOK Broadcast，打开本地 `/control`。
3. 展开 **OBS 导播联动（本地）** 面板，查看 OBS 当前场景、是否正在录制与连接状态。
4. 在下拉框选择 OBS 中已经存在的目标场景，点击 **确认切换 OBS 场景**。
5. 程序等待 OBS WebSocket 的请求结果并重新读取实际 Program Scene。只有场景确实改变后才提示成功。
6. 在「OBS 音频淡入淡出」选择 OBS 混音器中的音频源，选择 0/1/3/5 秒时长，设置淡入目标音量（0%–200%）。「淡出至静音」会平滑降低所选源音量到 0%，「淡入至目标音量」会平滑调整到滑块值。**这只调整音量，不切换 OBS 静音开关，也不停止直播或录制。**
7. 音频源列表与实际音量通过 OBS WebSocket 读取；没有可控制源时请在 OBS 添加音频输入/媒体源，点击刷新音频源。

注意：现在不会按 BP 的识别结果自动切换画面。录制中断只显示当前真实状态；**不会**监测磁盘可用空间或判断“录制是否意外终止”。不提供停止录制/停止直播按钮。

## 赛事阶段联动（人工执行）

Control 的 OBS 工作区自动读取权威比赛状态并提示建议场景：赛前 Waiting、BP 阶段 Draft/BP、提交对局后 Game、进入赛后报告后 Postgame。Pause / MVP / Safe 是人工选择。七个阶段均可在下拉框绑定 OBS 真实场景，常见英文/中文名称可精确匹配。场景映射保存在**当前浏览器**的 localStorage，不随服务器备份或跨设备同步。

点击阶段右侧「切换」后，才会调用 OBS WebSocket 切镜并回读实际 Program Scene；未绑定、场景已删除、连接失败、已经在播的场景不能重复切镜。**不会因 OCR、BP 锁定或计分变化自动转场**，也不会自动开始/停止录制。

## OBS Browser Source 布局检查

在右侧手动场景控制选择目标场景，点击「检查所选场景的浏览器源布局」。系统通过 OBS WebSocket 的 GetSceneItemList/GetInputSettings 读取该场景内可识别的 Browser Source **名称、是否启用、设计宽高**；非浏览器源被过滤，源 URL、查询口令和 OBS 密码不返回前端。推荐图形源设计为 1920×1080：BP `/overlay/draft`、GHUD `/overlay/game-hud`、MVP `/overlay/mvp`、经济时间线 `/overlay/game-progress`。这些只是导播检查指引，程序不会修改来源的位置、裁剪、层级或可见性。

## 安全与故障处理

- 后端 `GET /api/v1/obs/status`、`POST /api/v1/obs/scene`、`GET/POST /api/v1/obs/audio`、`GET /api/v1/obs/layout` 仅允许本机回环请求 + 已认证的 Control token。音频命令只能操作已有 OBS 音频源，限制目标音量为 0%–200%、渐变时长为 0–5000ms。Caster/Overlay 和公网 Control 无权调用。
- OBS WS 目的地址必须是 `ws://127.0.0.1:端口`、`ws://localhost:端口` 或 `ws://[::1]:端口`，禁止任意外网地址、URL 用户名密码及路径。
- 状态与场景命令不对用户开放 OBS WS 密码；密码仅位于 Node 服务环境变量中。
- 连接失败：检查 OBS 是否运行、**工具 → WebSocket 服务器设置**是否开启、端口/密码是否对应、本机安全软件是否阻断；本地服务修改 `.env` 后必须重启 Node。点击「刷新 OBS 连接状态」。`Connection refused` 通常说明 OBS WebSocket 未监听该端口；需要密码但未配置会明确提示。
- 音频渐变中断：检查 OBS 连接；程序不会在断线后继续执行剩余渐变步骤。渐变途中不要在 OBS 同时拖动同一源的音量，避免两边相互覆盖。
- 目标场景不存在：先到 OBS 创建该场景，再重新读取场景列表。
- 与直播画面链路隔离：HOK Control 或 OBS WebSocket 断连**不会停止 OBS 原有录制与推流**，不触发自动转场。

## 后续阶段

已实现手动音频源选择和淡入淡出（需 OBS 实机验收）。待实现：M24.1 阶段预设/一键切换；M24.2 音源分组映射与自动 Ducking；M24.3 录制目录空间告警；M24.4 可信自动联动与 M24.5 远程 Agent。

真实比赛前需完成 Windows OBS 28+ 环境下密码正确/错误、断线/重连、录制启动/停止状态、场景不存在、Player ID OCR 并发、游戏音画同步与持续运行测试。

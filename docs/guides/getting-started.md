> [文档索引](../README.md) · 除特别注明外，文件路径以仓库根目录为基准，npm 命令在 `vite-project/` 中执行。

# 安装、运行与部署指南

> v1.0.0 Release Candidate 状态：核心 BP / Auto BP / Player ID / 换英雄链路已完成软件验证。**局内 HUD 仍是测试功能**，自动 HUD 数据读取尚未实现，真实 OBS 长时间运行待实机验收。

第一次使用建议先看 [新手上手教程](beginner-guide.md)。当前比赛操作以 [操作指南](operator-guide.md) 为准；Auto BP 见 [屏幕识别指南](screen-recognition.md)；版本交接与旧实施计划见 [历史归档](../archive/README.md)。

基于 `qiqi47/HOK_Ban_Pick`，沿用原英雄资料与 MIT 许可；当前英雄 ID 已迁移为 release-order ID，图片资产文件名保持独立。
源码与执行目录：`vite-project/`。原单机组件保留在仓库中，新入口为 `src/BroadcastApp.tsx`。

## 本机运行

要求 Node.js 24（开发验证版本 24.14.1）。在 PowerShell 中进入 `vite-project`：

```powershell
npm ci
npm run build
npm run server
```

打开以下本地地址，无需添加 token：

- 操作台：http://127.0.0.1:3001/control
- 解说台：http://127.0.0.1:3001/caster
- Draft Overlay：http://127.0.0.1:3001/overlay/draft
- 实验性 Game HUD：http://127.0.0.1:3001/overlay/game-hud
- MVP Overlay：http://127.0.0.1:3001/overlay/mvp

开发热更新：另一个终端运行 `npm run dev`，打开 http://localhost:5173/control。
Vite 转发 `/api` 与 `/ws` 到 3001 端口。浏览器通过 `/api/access` 获取经服务器验证的本机角色凭据，前端不包含固定口令。前端默认同域连接，跨域地址可通过 `.env` 中的
`VITE_API_URL` 与 `VITE_WS_URL` 配置，并在更改后重新构建。

## 三端操作

### /control

1. 点 **比赛设置**，设置队名、队徽、比分、赛制、阶段和选禁模式，保存；局数按比分自动计算。
2. 默认每队 4 Ban / 5 Pick 的赛事顺序，也可在空 BP 时切换 2 Ban 模式。
3. 根据当前蓝/红方 Ban/Pick，点一次英雄。阶段、重复英雄与 ID 由服务器验证。
4. 搜索支持中英文；位置过滤支持主/副位置。“界面语言”选择中文或英文并保存后，整套界面和英雄名称一起切换。英雄数据与图片设置使用可搜索头像网格选择英雄。
5. Undo 撤销最后一次比赛操作，包括设置、选禁和重置；延迟设置不进入 Undo。
6. Reset Draft 只清 BP；Reset Match 清当前比赛进度并保留比赛名称、赛制与规则等配置。两者都可以 Undo。
7. 修改 Caster delay，支持直接输入 0–3600 秒及 ±1/5/10 秒微调。

多个操作员同时操作时，服务器拒绝过期版本的指令并回传最新状态。
操作未确认前禁用按钮；断线时不离线排队、不自动重放选禁，防止恢复后意外执行旧操作。
断线提示后应查看恢复的比赛状态再重试。

### /caster

只读。Ban/Pick、比分、当前局进度与有效局历史使用延迟时间轴；队名、Logo、选手资料、Stage、BO、语言、规则和展示配置实时更新。分析使用该组合快照。
Synergy、Counter、Be Countered 和克制敌方推荐使用原仓库数据，显示关系来源英雄。
已 Ban 的英雄从分析隐藏，已 Pick 的相关英雄标记 ✓。关系数据未经当前游戏版本核验，供人工参考。

解说端 REST 和 WS 由独立 token 限制为延迟状态，修改 URL 参数不会切换成实时状态。
不要向解说分享管理员密码、Control/Overlay 凭据或实时画面。

### /overlay/draft

OBS Browser Source 尺寸设为 **1920 × 1080**。本机直接使用 `/overlay/draft`；公网使用角色分享链接或登录窗口。
画布透明，可选择底部横排或左右竖排布局；中央保留游戏画面区域。
选禁有短暂入场动画，当前行动方高亮。
Overlay 首次未授权会显示登录窗口，可输入密码或该角色 token。断线保留最后画面并自动重连；1920×1080 设计画布会按窗口等比缩放。本机 OBS 无需密码。
Logo 支持 HTTPS URL 或 `/teamLogo/xxx.png`，本地图片放 `public/teamLogo/` 后重新构建。
同一路径的 Logo 不要在比赛中覆盖，换新文件名，以免历史时间轴显示新图片。

## 延迟的精确定义

每个比赛操作保存 `timestamp + resultingState`。每 200ms 取
`timestamp <= serverNow - casterDelaySeconds` 的最新事件，作为解说状态。
初始无可见事件时，比赛进度使用默认值，但队伍/赛事资料与展示配置仍实时可见。比分、BP、下一局、有效局历史和 Undo 的比赛进度经过同一时间轴。
REST 和 WS 都使用同一选择函数，重连不会回落到实时状态。

调大延迟会回退到相应历史状态；调小会前进。已经看过的信息无法撤回。
服务器数据与延迟配置落盘后才确认和广播，重启继续计算队列。
请保持服务器系统时钟准确，赛中不要手动更改时间。

**这里延迟的是数据，不是视频。** B站实际端到端延迟和不同播放器的进度必须测量，
不能把平台自然延迟当作保证的 180 秒防窥屏措施。

## 视频和音频接线

```text
Observer / Emulator
  → 导播 OBS（游戏 + 实时 Overlay，游戏声音）
  → B站
  → 最终节目工作站播放该延迟画面
  → 合成该画面声音 + 针对这份画面的解说音频
  → Discord 观众
```

最终节目必须明确由哪台电脑合成。尽量让解说观看最终节目工作站提供的同一份画面，
不同地区分别打开 B站播放器可能不在同一播放时间点。
若两位解说各用播放器，必须分别对齐进度；本版本只有一套公共解说数据延迟。
远程音频仍可能有传输偏差，需要实测校准。不要在最终延迟画面上再次叠加实时 Overlay。
Production 通信不送入节目总线；最终节目声音也不要回送到解说监听，避免回声。

## 数据恢复与运行边界

- 默认持久化文件：`vite-project/data/match.json`，包含当前状态、事件历史、Undo、请求 ID 和延迟。
- `match.json` 的当前状态还包含导播保存的 `heroArtOverrides` / `heroDataOverrides`。它们属于本机运行数据，`data/` 被 Git 忽略，不会自动上传仓库。
- 同目录临时文件写入并 fsync，然后 rename 替换；写入失败不推进内存状态。
- 文件损坏时启动报错，不自动清空比赛。恢复上一份完整备份后重启。
- **只运行一个后端进程**，不要用集群模式或多副本同时写同一个文件。
- 赛前备份、赛后归档整个数据目录（比赛 JSON、队伍资料库和上传照片）；自定义 `UPLOAD_DIR` 时一并备份该目录。历史不自动裁剪；适合社区赛事的小规模操作量。
- 浏览器刷新、WS 重连会恢复；仍需部署平台提供进程重启和持久化磁盘。
- Overlay 无连接状态角标，导播应同时打开 Control 监控连接。

## 共享英雄 Panel / Side 裁切

如果只是在一台赛事机上临时调整英雄构图，直接在 Control 保存即可，数据会随 `match.json` 和备份恢复。

如果要把这些构图变成仓库/Release 的公共默认值，在保存后运行：

```powershell
cd vite-project
npm run hero:crop-sync
```

或双击 `sync-hero-crops.bat`。脚本只把 Panel / Side 的 x/y/scale 合并到受 Git 管理的 `src/data/heroArtFocusOverrides.ts`，不会读取并提交比赛身份、密码等私有内容。完成后仍需人工检查 diff，再用正常 Git commit/push/PR 发布；程序不会自行连接 GitHub 写仓库。

## 云端部署

提供 `vite-project/Dockerfile` 和 `deploy/compose.yaml`、`deploy/Caddyfile`，尚未实际部署。
VPS 需要域名、80/443 端口和 Docker Compose。将域名解析到 VPS 后：

1. 复制 `deploy/.env.example` 为 `deploy/.env`。
2. 填写域名与初始 `ACCESS_PASSWORD`（8–256 字符）。服务器生成并保存独立的角色 token。
3. 在 `deploy` 运行 `docker compose up -d --build`。
4. 访问 `https://你的域名/control`，输入初始访问密码；之后可在“访问与网站设置”更换密码。
5. 在“访问与网站设置”填写公网网址，生成 Caster / Overlay 的只读分享链接。不要向只读使用者分享管理员密码。

容器使用命名卷保存比赛数据，Caddy 提供 HTTPS/WSS。不要运行 `docker compose down -v`，
它会删除持久化卷。备份卷和凭据，不要将 `.env` 提交到 Git。
角色 token 自动生成，旧部署仍可显式配置环境变量 token；`ALLOWED_ORIGINS` 填写前端完整 HTTPS origin。密码修改后，已连接页面更新角色 token；离线页面需重新登录或使用新分享链接。
token 经 Authorization 头和 WS 初始认证消息发送，分享链接使用 fragment，避免出现在 HTTP 请求 URL。

## Player ID、HUD 与赛后页面

屏幕识别模式会复用 Auto BP 的采集窗口，在开局并行识别双方 10 个 Player ID，并把游戏画面的 P1–P5 映射到赛前 roster。ID 区域可以独立保存命名预设；手动修正后可以用“恢复自动识别”重新交给 OCR。当前 Simulator 最佳完整核查约 1.8 秒，边缘帧会在不降低原阈值的前提下做两帧一致性复核。

`/overlay/game-hud` 已支持队伍身份、系列赛进度、人头、推塔和中立资源，但**仍处于测试阶段**。当前局内统计主要由 Control 人工维护，自动读取真实游戏 HUD 尚未实现；赛事机长期运行和 OBS 遮挡/缩放仍需实机验收。正式比赛应继续保留官方观战 UI 或人工比分兜底。

`/overlay/mvp` 与赛后报告基础链路已接入，可在投票确定 MVP 后展示结构化数据卡；自动判页尚未实现；手动指定页的真实结算画面识别仍需实机验收。

## 验证

比赛设置中的“界面语言”控制整套界面和英雄名称。选择中文或英文并保存后，按钮、设置、状态、错误、阵容分析与直播画面统一切换，每处只显示当前语言；搜索始终支持中英文。
语言由服务器随比赛状态保存，刷新后保留；控制台和直播画面实时更新，解说页实时更新语言设置，BP/比分仍使用延迟时间轴。自定义队名与选手名保留原文。
解说页的两组关系分析分别标注蓝方、红方、实际队名和对手，队名与队徽实时更新，BP 分析使用延迟的选禁数据。

```powershell
npm run hero:validate
npm test
npm run lint
npm run build
npm run test:e2e
```

浏览器测试默认使用 Windows Chrome，可通过 `CHROME_PATH` 指向其他 Chrome/Chromium。
测试启动独立 3101 端口，数据写入 `artifacts/e2e-时间戳.json`，不会更改正式 `data/match.json`。
测试截图位于 `artifacts/`。

上线前彩排：走完两套 BP、Player ID 队内乱序识别、换英雄、修改比分、刷新页面、断开网络至少 30 秒、重启后端，确认 Draft Overlay 恢复、Caster 无实时剧透；再测量 B站→解说→Discord 的真实音画偏差。若启用实验性 HUD，必须单独验证 OBS 长时间运行并保留人工/官方比分兜底。
Auto BP 已支持浏览器窗口采集、18 槽位校准/预设、Pick/Ban 识别、空 Ban、P1–P5 Player ID 本地 OCR 自动对齐、独立 ID 区域预设与最终阵容换英雄同步；详细限制见 [屏幕识别指南](screen-recognition.md)。本版**已包含本地 OCR**，但仍不包含 OBS 场景自动控制、赛事编排和自动视频同步。

实现参考：[ws 官方文档](https://github.com/websockets/ws/blob/master/README.md)、[Vite 代理文档](https://vite.dev/config/server-options.html#server-proxy)。

## 英雄名单与素材维护

默认采用每队 4 Ban / 5 Pick 的赛事模式。英雄名单与本地头像由同步器维护，
当前名单以独立的 [hero-roster.md](../research/hero-roster.md) 和 Hero Sync 校验结果为准。ID 按国际服上架顺序编号，旧存档自动迁移，旧名保留搜索别名。当前 UI 图标使用本地资产；官方 Full Art 和部分识别模板仍可能依赖官方 CDN。
未核实的新英雄关系保持“暂无数据”；Flowborn 形态及联动英雄以实际比赛房间为准。
当前编号与迁移原则见 [ID 规则](../research/hero-id-order.md)，
同步内容与来源见 [历史英雄数据核查](../research/hero-data-audit-2026-09-16.md)、
[图标来源清单](../../research/new-hero-assets.json)。

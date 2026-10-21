> [文档索引](../README.md) · 除特别注明外，文件路径以仓库根目录为基准，npm 命令在 `vite-project/` 中执行。

# Windows one-click broadcast launcher

> v1.0.0 Release Candidate：启动器、Director app mode 与 Simulator 后台启停已进入发布准备状态。Game HUD 仍是测试功能；启动器只负责运行服务，不代表 HUD 已完成真实比赛验收。

From `vite-project`, double-click `start-broadcast.bat`.

首次使用或更新源码后可以直接运行启动器：它会根据 `package-lock.json` 检查依赖并执行生产构建。下文 `artifacts/` 路径均相对于 `vite-project/`。

It will:
1. verify Node/npm/cloudflared, prepare dependencies and build;
2. reuse this checkout's server and tunnel when already running;
3. start `npm run server` if needed, reporting a port conflict when another application uses 3001;
4. wait until the local Control page responds;
5. start a Cloudflare Quick Tunnel;
6. capture the new `trycloudflare.com` address;
7. save the public, Control, Caster, and Overlay URLs to `artifacts/current-public-url.txt`;
8. open the local Control in a dedicated Director app window (Edge/Chrome app mode with its own local profile).

The server runs in the background and writes `artifacts/server.log`; keep the tunnel running during the event. Double-click `stop-broadcast.bat` when finished.

启动器使用项目目录、进程编号、进程创建时间和运行脚本确认进程归属，并通过互斥锁防止重复启动。重复点击会保留当前运行会话；更新源码后需先运行 `stop-broadcast.bat`，再重新启动以构建新版。停止脚本只结束本目录启动器记录的进程树，不按端口或 `cloudflared.exe` 名称结束其他程序。旧版启动器或手工启动的服务没有此记录，需要先在原窗口停止，再使用新版启动器。

The local operator intentionally uses `http://127.0.0.1:3001/control`; remote Caster/Overlay clients use the generated HTTPS URL.

If startup fails, inspect `artifacts/cloudflared.log` and the `artifacts/server.log`.


## BP Simulator 一键启动

双击：

```text
start-bp-simulator.bat
```

启动器会检查 Node/npm、准备依赖，然后通过隐藏 PowerShell 后台启动 Vite Simulator；已在本目录运行时会复用会话。若 5173 被其他程序占用，会报错并保留该程序。页面就绪后自动打开 Simulator Control，启动命令窗口随后关闭。Simulator Control 目前提供 **选手 ID 排序 → BP 模拟 → 角色交换** 三个独立测试模式，并可调 Pick/Ban 尺寸、自动脚本等待与锁定 cue。

后台日志：

```text
artifacts/bp-simulator.log
```

测试结束后双击：

```text
stop-bp-simulator.bat
```

它只停止本目录启动器记录的 Simulator 进程树。正常使用不再需要一直保留一个 CMD/PowerShell 窗口。

开发者可通过 `pwsh -NoProfile -File scripts/managed-process.test.ps1` 重跑脚本解析及进程归属、PID 复用、损坏记录、并发启动和端口冲突检查。测试会模拟 Windows 进程查询与结束命令；Linux 通过此检查仍不能代替 Windows 原生启停、浏览器窗口与 Cloudflare 联调。

## 英雄构图同步快捷脚本

在 Control 中调好底部横排 Panel / 左右竖排 Side 的英雄裁切并点击保存后，可以双击：

```text
sync-hero-crops.bat
```

它等价于 `npm run hero:crop-sync`，会读取本机 `data/match.json` 中的英雄裁切覆盖，只把 Panel / Side 的 x/y/scale 写入 Git 跟踪的 `src/data/heroArtFocusOverrides.ts`。

该脚本**不会自动上传 GitHub**。运行完成后应在 GitHub Desktop / Git 中检查这个文件的 diff，再正常 commit 和 push。这样可以避免把本机 `data/` 中的比赛、队伍或访问配置误提交。

## Director app window

`start-broadcast.bat` now calls `vite-project/open-director.ps1` for the local operator.

The launcher prefers Microsoft Edge, then Chrome, and opens Control with `--app=` rather than as a normal browser tab. A dedicated profile is stored under:

```text
vite-project/data/director-browser-profile/
```

This keeps Control isolated from the operator's normal browser profile and avoids inheriting a saved per-site zoom level. The Auto BP calibration UI also blocks Ctrl/Cmd zoom shortcuts and Ctrl+wheel while it is mounted.

This is the first desktopization step, not the final distributable EXE. It deliberately reuses the existing server and browser engine while real-device Auto BP / Player ID / OBS validation continues. The planned Electron package can later bundle the same Control UI, server lifecycle, tunnel status and logs without changing match-state APIs.

启动后本机窗口免登录。首次远程使用前在 Control 的“访问与网站设置”保存密码；Quick Tunnel 和其他代理连接需要密码或角色 token。模拟器可独立运行，读取 Control 规则需同时启动 Broadcast 后端。

## PR #91 自动同步 Sites、立绘准备与退出清理

`start-broadcast.bat` → `scripts/launcher-session.ps1`（Windows Job 生命周期）→ 原 BAT 就绪检查 → `run-server.ps1` → `run-cloudflare.ps1`。保持启动器窗口打开；按最后的任意键或关闭窗口会清理本次启动的新子进程，已有复用会话不属于该 Job。手动停止现有会话继续用 `stop-broadcast.bat`；它按项目路径、PID 和创建时间验证归属。

准备阶段默认运行 `npm run hero:art-cache`，复用并校验本地图；仅下载缺失/损坏且具有立绘来源的英雄。当前目录 112 张已知立绘均可本地使用；没有立绘来源的英雄保留头像，不虚构高清资源。最多 3 路下载、单图超时 20 秒/8 MiB，离线失败不阻止构建。紧急启动可以设置 `HOK_SKIP_ART_CACHE=1`；正常使用不建议跳过赛前检查。

Sites 同步独立配置（不要使用 Control token 或管理员密码）：

```powershell
$env:TUNNEL_SYNC_TOKEN = '<网站端配置的独立同步密钥>'
.\start-broadcast.bat
```

或复制 `tunnel-sync.example.json` 为 `tunnel-sync.local.json`，本机填写 token。该文件已忽略，禁止提交、截图或转发。缺少 token 不请求 API，保留手动后台连接。

固定请求：`PUT https://chasingwind-esport.prettyelm1.chatgpt.site/gateway/api/tunnel`，Bearer 同步密钥，JSON `{ "origin": "https://…trycloudflare.com" }`。本地和公网 `/api/health` 均确认 `ok:true` 才请求；HTTPS 不跟随重定向，不打印响应体/密钥。网站端必须独立验证后端归属、访问配置及 SSRF；客户端健康检查不证明所有权。

URL 仅从 cloudflared 的盒状公告行获取；帮助链接、子域后缀、路径及查询参数均拒绝。监督进程增量读取日志，变化 URL 重置同步状态。每个地址最多 12 次健康等待、3 次发送；401/403 提示凭据、404/405/501 表示接口不可用并停止该地址重试。更正配置或部署 API 后仅重启隧道即可重新尝试，不能为此重启 HOK 后端。隧道自身退出最多启动 5 次。

交接时 Sites API 未部署；本 PR 只实现 GitHub 侧调用，不改变网站 D1、所有者登录或手动填写功能。查看启动器消息及 `artifacts/cloudflared.log`；无密钥日志。

测试：`powershell -NoProfile -File scripts/tunnel-sync.test.ps1` 使用模拟网络，不含真实凭据。完整成功配对、Cloudflare 断线重连和 Sites 真实部署仍待双方联合验收。

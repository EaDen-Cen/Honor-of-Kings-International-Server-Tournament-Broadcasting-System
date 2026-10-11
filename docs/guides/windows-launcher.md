> [文档索引](../README.md) · 除特别注明外，文件路径以仓库根目录为基准，npm 命令在 `vite-project/` 中执行。

# Windows one-click broadcast launcher

> v1.0.0 Release Candidate：启动器、Director app mode 与 Simulator 后台启停已进入发布准备状态。Game HUD 仍是测试功能；启动器只负责运行服务，不代表 HUD 已完成真实比赛验收。

From `vite-project`, double-click `start-broadcast.bat`.

首次使用或更新源码后可以直接运行启动器：它会根据 `package-lock.json` 检查依赖并执行生产构建。下文 `artifacts/` 路径均相对于 `vite-project/`。

It will:
1. verify Node/npm/cloudflared, prepare dependencies and build;
2. stop any old process listening on port 3001 and any old `cloudflared.exe`;
3. start `npm run server`;
4. wait until the local Control page responds;
5. start a Cloudflare Quick Tunnel;
6. capture the new `trycloudflare.com` address;
7. save the public, Control, Caster, and Overlay URLs to `artifacts/current-public-url.txt`;
8. open the local Control in a dedicated Director app window (Edge/Chrome app mode with its own local profile).

The server runs in the background and writes `artifacts/server.log`; keep the tunnel running during the event. Double-click `stop-broadcast.bat` when finished.

The local operator intentionally uses `http://127.0.0.1:3001/control`; remote Caster/Overlay clients use the generated HTTPS URL.

If startup fails, inspect `artifacts/cloudflared.log` and the `artifacts/server.log`.


## BP Simulator 一键启动

双击：

```text
start-bp-simulator.bat
```

启动器会检查 Node/npm、准备依赖、清理旧的 5173 端口进程，然后通过隐藏 PowerShell 后台启动 Vite Simulator。页面就绪后自动打开 Simulator Control，启动命令窗口随后关闭。Simulator Control 目前提供 **选手 ID 排序 → BP 模拟 → 角色交换** 三个独立测试模式，并可调 Pick/Ban 尺寸、自动脚本等待与锁定 cue。

后台日志：

```text
artifacts/bp-simulator.log
```

测试结束后双击：

```text
stop-bp-simulator.bat
```

它会停止监听 5173 端口的 Simulator。正常使用不再需要一直保留一个 CMD/PowerShell 窗口。

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

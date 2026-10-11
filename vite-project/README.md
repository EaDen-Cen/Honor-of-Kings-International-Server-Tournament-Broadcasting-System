# 应用目录

> v1.0.0 Release Candidate：核心 BP / Auto BP / Player ID / 换英雄链路已进入发布准备状态。**Game HUD 仍是 Experimental / 测试功能**，不要把它当作已完成正式赛事验收的比分源。

这是 HOK Broadcast 的前端、后端和测试执行目录。项目概览见 [根 README](../README.md)，全部说明见 [文档索引](../docs/README.md)。

使用 Node.js 24，以下命令在本目录执行：

```powershell
npm ci
npm run build
npm run server
```

英雄公共构图同步：

```powershell
npm run hero:crop-sync
```

开发时保持后端运行，在另一个终端执行 `npm run dev`。验证命令为 `npm run hero:validate`、`npm test`、`npm run lint`、`npm run build`、`npm run test:e2e`；浏览器测试需要 Chrome，可通过 `CHROME_PATH` 指定路径。

- [第一次使用教程](../docs/guides/beginner-guide.md)
- [运行、部署与备份](../docs/guides/getting-started.md)
- [比赛操作及队伍资料库](../docs/guides/operator-guide.md)
- [Auto BP / Player ID / 屏幕识别](../docs/guides/screen-recognition.md)
- [选手对齐、恢复、实验性 HUD 与 MVP](../docs/guides/player-alignment-recovery-hud.md)
- [Windows 启动器](../docs/guides/windows-launcher.md)
- [v1.0.0 发布说明](../docs/releases/v1.0.0.md)
- [系统结构](../docs/design/architecture.md)

启动器、配置、源码、图片和测试素材保持原位置。`data/` 和 `artifacts/` 是本机生成目录；备份应覆盖比赛、队伍资料库及上传图片。 HeroArt 的现场覆盖也在 `data/match.json`；需要跨电脑/Release 共用时使用 `hero:crop-sync` 提升到仓库默认文件。原 Vite 模板说明见 [历史归档](../docs/archive/legacy/vite-template-readme.md)。


## Windows 快捷入口

- `start-broadcast.bat`：准备依赖、构建、启动 Broadcast 和 Quick Tunnel。
- `stop-broadcast.bat`：停止 Broadcast 与 tunnel。
- `start-bp-simulator.bat`：后台启动 BP Simulator，启动窗口完成后自动关闭；控制页提供 **选手 ID 排序 → BP 模拟 → 角色交换** 三种独立测试，并可用“从 Control 同步模拟器数据”快速复用当前比赛状态。
- `stop-bp-simulator.bat`：停止 BP Simulator。
- `sync-hero-crops.bat`：把当前 `data/match.json` 中的 Panel / Side 英雄裁切提升到 Git 跟踪的 `src/data/heroArtFocusOverrides.ts`；只生成本地 diff，不自动 push。

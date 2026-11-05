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
- [选手对齐、恢复、实验性 HUD 与赛后图形](../docs/guides/player-alignment-recovery-hud.md)
- [赛后全高清 OBS 页面/API](../docs/design/api.md#pr-67经济时间线与赛后图形契约)
- [Windows 启动器](../docs/guides/windows-launcher.md)
- [2026-10-30 · 第二局赛后报告、锁定 BP 纠错、OBS 录制盘容量与逐局开播流程](../docs/guides/live-preflight-and-corrections-2026-10-30.md)
- [v1.0.0 发布说明](../docs/releases/v1.0.0.md)
- [系统结构](../docs/design/architecture.md)

启动器、配置、源码、图片和测试素材保持原位置。`data/` 和 `artifacts/` 是本机生成目录；备份应覆盖比赛、队伍资料库及上传图片。 HeroArt 的现场覆盖也在 `data/match.json`；需要跨电脑/Release 共用时使用 `hero:crop-sync` 提升到仓库默认文件。原 Vite 模板说明见 [历史归档](../docs/archive/legacy/vite-template-readme.md)。


## Windows 快捷入口

- `start-broadcast.bat`：准备依赖、构建、启动 Broadcast 和 Quick Tunnel。
- `stop-broadcast.bat`：停止 Broadcast 与 tunnel。
- `start-bp-simulator.bat`：后台启动 BP Simulator，启动窗口完成后自动关闭；控制页提供 **选手 ID 排序 → BP 模拟 → 角色交换** 三种独立测试，并可用“从 Control 同步模拟器数据”快速复用当前比赛状态。
- `stop-bp-simulator.bat`：停止 BP Simulator。
- `sync-hero-crops.bat`：把当前 `data/match.json` 中的 Panel / Side 英雄裁切提升到 Git 跟踪的 `src/data/heroArtFocusOverrides.ts`；只生成本地 diff，不自动 push。


## PR #67：回放赛后图形预览

启动本地服务器后，Control 准备本局报告，再依次打开 `/overlay/mvp`（1920×1080 全屏 MVP）、`/overlay/postgame-compare?role=mid`（更换 role 为 clash/jungle/mid/farm/roam）与 `/overlay/game-progress`（导入回放实测经济时间序列后绘图）。共享十人身份映射只保存在当前浏览器 localStorage，数字统计和时间序列存入服务器比赛状态。任何未核对的评分、缺失的雷达维度或中断的时间曲线均不可补造数值。完整操作见 [回放流程](../docs/guides/player-alignment-recovery-hud.md#回放结算测试与全屏赛后图形开发-pr-67)。


## 双服英雄池与 0–5 Ban（开发 PR #68）

`Control → 比赛设置` 可单独选择 `global / cn` 英雄池、每队 Ban 数 0–5。Simulator 的 BP 测试也必须使用同样设置，或通过「从 Control 同步」复制。国服候选可尝试用 `npm run hero:cn-sync` 从官网刷新（失败时不覆写旧数据）；此功能尚未完成真实国服截图 OCR 适配与国服全量英雄清单验收。规则和来源见 [双服操作指南](../docs/guides/hero-pool-and-ban-rules.md)。


## PR #69 赛后路由与 GHUD 画面/OCR 修复
本地运行 3001 生产服务必须先执行 `npm run build` 并重启后端；`/overlay/postgame-compare?role=mid`、`/overlay/game-progress` 由同一 `dist/index.html` 入口载入而非多个 `.html`。OBS 游戏源和完整不透明 GHUD 层按 1920×1080 叠放，地图区域默认是缺源占位，需要 OBS 上层另行叠加真实地图裁切。Control →「GHUD 顶栏识别」必须预览实际图像、画出七项数字框、保存确认，并人工核对两次 OCR 后再开启自动推送。详见 [彩排文档](../docs/guides/postgame-ghud-overlay-fixes.md)。

### PR #70 赛后 OCR 框选恢复
先用结算页截图或共享窗口在 Control 中「单字段 OCR」点击预览，选择玩家并鼠标直接框选数字（可从一人按 130px 复制同队五行并检查），再识别一人/已框选所有人。框选结果不是自动应用，黑图/空白不会入库。与整页采集工具在当前会话复用截图。详见 [导播指南](../docs/guides/operator-guide.md)。

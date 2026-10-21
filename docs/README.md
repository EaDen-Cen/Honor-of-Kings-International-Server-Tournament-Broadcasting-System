# 文档总索引

[返回项目首页](../README.md)

> **主分支状态（2026-10-21）**：PR #67–#91 的相关改动已合并 `main`，包含单行 GHUD、OBS Director、云端 AI 非权威辅助、停靠工作区、Windows 隧道同步客户端与离线素材准备。GitHub 发布的 `v1.0.0-rc.1` 是 10 月 10 日的旧预发布快照，不包含后续功能。GHUD / 云端 AI / 赛后自动采集仍需真实赛事与 OBS 连续验收，正式比分保留官方/人工兜底。

| 类别 | 入口 | 用途 |
| --- | --- | --- |
| OBS Director（M24.0） | [本地连接与场景控制指南](guides/obs-director-setup.md) | WebSocket 本地配置、场景/录制状态、人工切镜、音源渐变与安全边界（已合并，待 OBS 真机验收） |
| 当前操作 | [新手上手](guides/beginner-guide.md)、[运行指南](guides/getting-started.md)、[操作指南](guides/operator-guide.md)、[Auto BP / Player ID](guides/screen-recognition.md)、[选手对齐 / 恢复 / HUD / MVP](guides/player-alignment-recovery-hud.md)、[国服/国际服英雄池与 0–5 Ban](guides/hero-pool-and-ban-rules.md)、[Windows 启动器](guides/windows-launcher.md) | 第一次使用、安装部署、现场操作、屏幕识别、恢复与实验功能 |
| AI 与可停靠工作区 | [AI 辅助识别](guides/ai-recognition.md)、[工作区拖拽 / 预设](guides/dock-workspace.md)、[Windows 隧道同步](guides/windows-launcher.md#pr-91-自动同步-sites立绘准备与退出清理) | PR #91 已合并；真实 AI 服务商与 Sites 接口仍需配对验收 |
| 识别与图片性能 | [识别延迟、OBS 本地原画与代码维护](guides/recognition-latency-and-obs-assets.md) | 采集管线、原画资源更新、格式检查与基准测量 |
| 当前设计 | [系统结构](design/architecture.md)、[API 接口](design/api.md)、[OBS WebSocket 双向集成路线图](design/obs-websocket-integration-roadmap.md) | 状态架构、控制边界、OBS 连接/场景/音乐/录制监测的待开发计划 |
| 发布说明 | [v1.0.0](releases/v1.0.0.md) | Release Candidate 功能、发布检查、升级和已知边界 |
| 验证记录 | [历次验证](validation/history.md)、[2026-10-18 两场实战复盘](validation/live-two-match-retrospective-2026-10-18.md) | 按日期/版本保留结果、真实操作困难及未验收范围 |
| 研究资料 | [研究索引](research/README.md)、[英雄名单](research/hero-roster.md)、[英雄自动同步](research/hero-sync.md) | 当前英雄池、release-order ID、英雄核查、Panel/Side 公共裁切发布与原始 JSON 证据 |
| 历史交接 | [归档索引](archive/README.md) | 版本交接、旧计划与原始说明 |

## 按使用角色阅读

- **首次使用**：[新手教程](guides/beginner-guide.md) → [运行指南](guides/getting-started.md) → Simulator：选手 ID 排序 → BP 模拟 → 角色交换。
- **现场导播**：[操作指南](guides/operator-guide.md) → [屏幕识别](guides/screen-recognition.md) → [恢复与 MVP](guides/player-alignment-recovery-hud.md) → [发布边界](releases/v1.0.0.md)。
- **开发者/维护者**：[应用命令](../vite-project/README.md) → [架构](design/architecture.md) → [API](design/api.md) → [Hero Sync](research/hero-sync.md) → [验证记录](validation/history.md)。

## 命名和维护规则

- 根目录仅放项目 README（许可证保持原位）；应用目录 README 仅说明执行入口。
- 当前指南使用稳定的小写英文连字符名称，更新原文，不为每次会话新增交接文件。
- 版本交接归入 `archive/handoffs/`，历史计划归入 `archive/planning/`；日期使用 YYYY-MM-DD。
- 测试结果写入验证记录并注明日期、环境、实际执行和未验证范围，不能混入当前操作步骤。
- 研究叙述放在 `docs/research/`，原始证据继续放在根目录 `research/`。
- **任何 GitHub 源码、界面、API、数据结构或操作流程改动，必须在同一个 PR 中同步检查并更新相关文档**，不可只提交代码。默认检查根 README、用户/操作指南、设计/API、`MILESTONES.md`、Release Notes 与验证记录；不相关的文档可不更改，但须确认。
- 新增或移动文档同步修改本索引及相对链接；旧资料保留，不把历史需求当现状。
- 发布前检查文档中“已实现 / Experimental / 规划”的状态一致性；只写实际执行过的测试，CI 不等于真实游戏或 OBS 验收。
- 文中源码、运行数据和产物路径默认以仓库根目录为基准；npm 命令在 `vite-project/` 执行。历史原文的路径仍按其注明的原上下文理解。

## 选手对齐、恢复、HUD 与赛后 MVP

已接入每局选手槽位映射、常驻本地 OCR、双队原子顺序更新、时间一致性复核、ID 区域预设、备份/停机恢复与赛后数据草稿/MVP 页面。局内 HUD 已有人工统计、顶栏 OCR 与 OBS Overlay，但**仍处于测试阶段**；其真实比赛长时间运行和正式比分可靠性尚未验收。参见 [功能与操作说明](guides/player-alignment-recovery-hud.md) 与 [项目里程碑](../MILESTONES.md)。

## 后续广播图形发展路线（M21–M25）

参考 2026 KPL 转播的信息结构，后续优先完成 [M21 赛后多页 OCR、M22 赛后图形/MVP、M23 局内 HUD 实时数据、M24 OBS/音乐自动化和 M25 高级视觉包装](../MILESTONES.md#后续开发规划参考-kpl-2026-转播信息体系2026-10-08)。其中 M21 的固定模板识别和 M22 的对位/全屏 MVP 基础图形已在 PR #67 合并至 `main`，其余完整验收与扩展功能仍为规划目标；这些功能不能视为已发布的 v1.0.0-rc.1 内容。架构约束见 [系统结构](design/architecture.md#后续-broadcast-data-engine-设计方向)。


## 国服 / 国际服英雄池与可配置 Ban 数量（PR #68 已合并）

入口：[国服英雄池与 0–5 Ban 规则说明](guides/hero-pool-and-ban-rules.md)。此功能已在 `main` 提供独立 `heroPool`、`banCount`，历史状态默认行为不改变。国服英雄名单为**待与官方实时目录核对的工作快照**，国服专属英雄头像识别与真实 5 Ban 游戏 UI 尚未经过实机/OBS 验收，不属于此前已发布的 `v1.0.0-rc.1` 承诺。


## 新增 · PR #69 赛后页面和 GHUD 采集修复
- [赛后路由 / MVP 立绘 / 历史遮罩改动 / GHUD OCR 七项校准指南](guides/postgame-ghud-overlay-fixes.md)。
- 与 [原 GHUD/MVP 工作流](guides/player-alignment-recovery-hud.md) 配合使用，旧版本没有逐字段七项校准、自动发布前强制预览。软件自动化结果与 OBS 现场验收分开。


**赛后 OCR 可视化框选修复（PR #70）**：选手评分不再只能输入百分比坐标；详情见 [赛后与 GHUD 彩排指南](guides/postgame-ghud-overlay-fixes.md#2026-10-13--pr-70--赛后数字-ocr-恢复截图直接框选) 和 [导播操作指南](guides/operator-guide.md)。

**2026-10-18 整合增量**：各识别模块默认复用 BP 窗口，位置校准统一鼠标框选；结算按页面收集数据，MVP 按选手位置显示去重统计，经济图保留实际读取点与完整时间刻度。云端已有连接、设置草稿及 Windows 启动器保护继续保留。详见 [操作步骤](guides/player-alignment-recovery-hud.md) 与 [整合选择和验证](validation/history.md#2026-10-18本地与-github-逐功能整合)。

- [AI 辅助识别配置 / 多厂商 API](guides/ai-recognition.md)（实验功能）

- [可停靠工作区：拖拽、预设、保存与恢复](guides/dock-workspace.md)
- [PR #91 验证记录、基准范围与待实机验收项](validation/pr91-validation.md)

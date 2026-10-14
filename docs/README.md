# 文档总索引

[返回项目首页](../README.md)

> **v1.0.0 发布准备状态（2026-10-10）**：核心 BP / Auto BP / Player ID / 换英雄链路已进入 Release Candidate。局内 HUD `/overlay/game-hud` 仍为 **Experimental / 测试阶段**，可用于彩排和 OBS 预览。顶栏七项 HUD OCR 与两帧核验已有实验原型，真实比赛长时间稳定性待实机验收；正式比赛保留官方/人工比分兜底。

| 类别 | 入口 | 用途 |
| --- | --- | --- |
| 当前操作 | [新手上手](guides/beginner-guide.md)、[运行指南](guides/getting-started.md)、[操作指南](guides/operator-guide.md)、[Auto BP / Player ID](guides/screen-recognition.md)、[选手对齐 / 恢复 / HUD / MVP](guides/player-alignment-recovery-hud.md)、[国服/国际服英雄池与 0–5 Ban](guides/hero-pool-and-ban-rules.md)、[Windows 启动器](guides/windows-launcher.md) | 第一次使用、安装部署、现场操作、屏幕识别、恢复与实验功能 |
| 当前设计 | [系统结构](design/architecture.md)、[API 接口](design/api.md) | 代码职责、状态流与存储边界 |
| 发布说明 | [v1.0.0](releases/v1.0.0.md) | Release Candidate 功能、发布检查、升级和已知边界 |
| 验证记录 | [历次验证](validation/history.md) | 按日期/版本保留结果和未验收范围 |
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

参考 2026 KPL 转播的信息结构，后续优先完成 [M21 赛后多页 OCR、M22 赛后图形/MVP、M23 局内 HUD 实时数据、M24 OBS/音乐自动化和 M25 高级视觉包装](../MILESTONES.md#后续开发规划参考-kpl-2026-转播信息体系2026-10-08)。其中 M21 的固定模板识别和 M22 的对位/全屏 MVP 基础图形已在 PR #67 开发分支实现，其余完整验收与扩展功能仍为规划目标；这些功能不能视为已发布的 v1.0.0-rc.1 内容。架构约束见 [系统结构](design/architecture.md#后续-broadcast-data-engine-设计方向)。


## 国服 / 国际服英雄池与可配置 Ban 数量（开发 PR #68）

入口：[国服英雄池与 0–5 Ban 规则说明](guides/hero-pool-and-ban-rules.md)。此功能在开发分支中提供独立 `heroPool`、`banCount`，历史状态默认行为不改变。国服英雄名单为**待与官方实时目录核对的工作快照**，国服专属英雄头像识别与真实 5 Ban 游戏 UI 尚未经过实机/OBS 验收，不属于已发布 RC 的承诺。


## 新增 · PR #69 赛后页面和 GHUD 采集修复
- [赛后路由 / MVP 立绘 / 不透明赛事 HUD / GHUD OCR 七项校准指南](guides/postgame-ghud-overlay-fixes.md)。
- 与 [原 GHUD/MVP 工作流](guides/player-alignment-recovery-hud.md) 配合使用，旧版本没有逐字段七项校准、自动发布前强制预览。软件自动化结果与 OBS 现场验收分开。

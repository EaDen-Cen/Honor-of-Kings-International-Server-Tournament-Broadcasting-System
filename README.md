# HOK Broadcast · 王者荣耀赛事 BP 导播系统

HOK Broadcast 是一套面向 **Honor of Kings / 王者荣耀国际服社区赛事** 的本地优先导播系统。它的目标不是替代 OBS、游戏客户端或完整赛事平台，而是把比赛中最容易让单人导播手忙脚乱的工作集中到一套状态系统里：**赛前队伍与选手、BP 数据、选手 P1–P5 顺序、最终英雄归属、解说延迟、OBS 图形、备份恢复，以及赛后 MVP 数据展示**。

项目最初围绕 Discord 社区线上赛和单导播工作流开发，因此设计重点一直是：

- 导播只维护一份权威比赛状态，Caster 与 OBS Overlay 按各自的数据时序跟随；
- 能自动识别的步骤尽量自动完成，但始终保留人工确认、Undo 和手动 fallback；
- 屏幕识别、选手 ID OCR 与换英雄识别尽量在本机完成，避免把比赛主链路依赖在远程 AI 或临时网络服务上；
- 测试工具与正式比赛状态隔离，方便在没有真实房间、没有十名选手时反复压测；
- 数据、队伍资料和运行时状态可持久化、备份和恢复，不把一场比赛建立在浏览器临时状态上。

当前技术栈为 **React + TypeScript + Node.js + WebSocket**。Node 服务端维护权威 MatchState、修订号、Undo/事件历史、Caster 延迟时间线与持久化；浏览器端分别提供导播、解说、OBS Browser Source 和 Simulator。

2026-10-18 开发增量：识别模块默认共享 BP 窗口并用鼠标框选，结算按八种页面收集；MVP 使用选手位置和照片，经济优势曲线从对局截图读取并保留完整时间刻度。云端连接、设置草稿和 Windows 启动器保护继续保留。操作步骤见 [赛后与 HUD 指南](docs/guides/player-alignment-recovery-hud.md)，本地与 GitHub 的选择依据见 [验证记录](docs/validation/history.md#2026-10-18本地与-github-逐功能整合)。

```text
HOK 游戏画面 / BP Simulator
          │
          ├─ Auto BP 英雄识别
          ├─ Player ID OCR / P1–P5 对齐
          └─ 最终阵容 / 换英雄识别
                    │
                    ▼
              Control / MatchState
             ┌──────┼─────────┐
             ▼      ▼         ▼
          Caster   OBS      Backup
          延迟数据 Overlay   / Recovery
```

> **发布状态（2026-10-10）**：当前目标为 **v1.0.0**。核心比赛状态、Auto BP、Player ID、换英雄、Caster、Draft Overlay、备份恢复已经进入 Release Candidate。Simulator 中 BP 极限测试在约 **1.5–2 秒**选角窗口下可稳定出结果，Player ID 完整核查最佳实测约 **1.8 秒**；这些是既有 Simulator 测试环境成绩，不等于真实赛事机 SLA。**局内 Game HUD 仍属于 Experimental / 测试功能**，不应作为唯一官方比分来源。

## OBS 赛事导播工作区与布局核查（2026-10-19）

Control 的「OBS 导播工作区（本地）」新增响应式状态看板、赛事阶段快捷场景、手动切镜、Browser Source 布局核查与独立音频控制。根据权威 MatchState 的 BP 进度、正式开局与赛后报告自动**推荐** Waiting / BP / Game / Postgame；Pause / MVP / Safe 始终可手动选择。每个阶段绑定到 OBS 中真实存在的场景，精确名称匹配，映射仅保存在当前浏览器本地存储；导播点击「切换」后才向 OBS 发出命令并读回确认。**不会根据 OCR 自动切镜，也不会创建/移动 OBS 来源。** 可手动检查所选 OBS 场景的 Browser Source 名称、启用状态与设计尺寸（建议 1920×1080），API 不返回来源 URL、访问 token 或 OBS 密码。详见 [OBS 设置指南](docs/guides/obs-director-setup.md)。

## OBS 本地音频控制与连接诊断（2026-10-19）

在 **OBS 导播联动（本地）** 面板中可刷新连接状态，查看当前场景/录制状态；新增 OBS 音频源列表与 0/1/3/5 秒手动淡入淡出，可独立调整目标音量（0%–200%）或淡出至 0%。只修改选定 OBS 音频源的音量，不更改静音开关，不影响 OBS 录制和推流状态；后端只接受本机 Control 授权，密码仍只存于 Node 环境。连接失败提示与 [OBS 本地设置指南](docs/guides/obs-director-setup.md) 已同步完善。**真实 OBS 音频设备仍需实机测试；磁盘告警、自动 Ducking 和自动切镜未实现。**

## GHUD 可调宽度（2026-10-19）

导播端 **局内 HUD / 人头、推塔与资源 → HUD 宽度** 新增 50%–100%（每档 5%）滑块与恢复默认按钮。默认 100% 兼容旧比赛；建议先试 80%（顶部 1536px）。整体比分条按比例缩放，顶部居中，不会更改 OBS Browser Source 的 **1920×1080** 画布，也不会添加不透明的背景遮罩。宽度由服务器保存并同步到所有浏览器源，下一局及重置整场比赛后仍保留；原有 Compact / Full 高度档位独立设置。

## 2026-10-19 · GHUD 侧边交换与 CI 回归完善

新版 99px / 131px 透明顶部 HUD 保持不变；修复换边后推塔、经济和中立资源数值仍使用固定蓝左红右颜色，以及 Full 模式十人条按红方而非右侧位置反转的问题。PR #82 后遗留的四处 Playwright 断言仍指向旧版全屏 HUD 类名，已迁移到新版 `game-hud-kills`、`game-hud-metric`、`game-hud-capture`、`game-hud-team` 等实际结构，并强化换边与人工 P1–P5 核对端到端覆盖。所有变更须经最新 CI 验证；真实 OBS 彩排仍需单独执行。

## P1–P5 开播核对回归修复（2026-10-19）

修复 PR #77 引入的核对状态随 BP 历史条数变化而失效的问题。现在 Control 顶部直接显示服务器当前蓝红 P1–P5 选手顺序，并可跳转自动识别 / 手动调整面板；人工核对在同一局 Ban/Pick 过程中保持有效，但名单或权威顺序变更、进入下一局后必须重新确认。OCR 状态区分采集未连接、视频未就绪、识别中和暂停。**核对勾选仅是当前浏览器的人工确认记录，不代表 OCR 成功。** 见 [比赛操作指南](docs/guides/operator-guide.md)。

## 两场实战复盘与对位 OBS 场景（待合并改动）

[2026-10-18 真实双局现场复盘](docs/validation/live-two-match-retrospective-2026-10-18.md) 记录单人导播操作负担、元流之子形态误识别、P1–P5 排序遗漏、录制磁盘耗尽、赛后整理效率、帮抢和 GHUD/经济对位等问题。除已有稳定功能外，不将这些问题写作“已修复”。

此开发分支新增五个 **独立、固定角色** 的浏览器源：
`/overlay/postgame-clash`、`/overlay/postgame-jungle`、`/overlay/postgame-mid`、`/overlay/postgame-farm`、`/overlay/postgame-roam`；每页左蓝右红展示选手，中间为核验后的雷达与数值。保留旧 `/overlay/postgame-compare?role=...` 作为兼容入口。自动 BP 识别中可随时中断扫描并人工审阅已有候选。Control 本机增加逐局 Player ID 顺序核对提醒，**仅是操作清单而非服务端身份认证**。上述改动需合并 PR 并实机验收后才是正式可用版本。

## 最终阵容自动应用可靠性（开发分支，尚待实机确认）

根据双场实战反馈，修复单方英雄互换因另一方识别不可靠而无法自动同步的问题；新增服务器回执与权威阵容核对，区分“发现变更”“发送成功”“真正应用”，失败允许人工接管且会提示错误。此为 P0 候选修复，尚未完成 CI/实机验收。参见 [操作指南](docs/guides/operator-guide.md) 与 [里程碑](MILESTONES.md)。

## M24.0 · OBS 本地桥接（开发候选，尚未实机验收）

新增可选的 OBS WebSocket v5 Node 连接器及 Control 内的可折叠 OBS Director 面板。支持在本地读取当前场景、OBS 场景列表、录制状态，并人工切换经 OBS 确认的 Program Scene。使用服务端 `OBS_WS_URL` / `OBS_WS_PASSWORD` 变量，不把 OBS 密码送入前端。仅本地 Control 有权调用；默认不配置则完全禁用。参见 [OBS Director 本地设置](docs/guides/obs-director-setup.md)。

请注意：**手动音频淡入淡出已提交候选，但录制容量预警、自动场景联动和云端远控尚未实现**。已有单向 Browser Source 仍然独立运行。本候选尚须通过 CI 和 Windows OBS 真实设备测试。

## OBS 双向集成及单人导播路线（计划中）

OBS Browser Source 单向显示已经具备；HOK 控制 OBS 的本地场景切换、状态读取与**手动单音源音量淡入淡出**已提交候选代码，仍待 CI/真机验收。自动混音 Ducking、自动导播与录制容量保护仍未开发。2026-10-19 新增 [OBS WebSocket 双向集成路线图](docs/design/obs-websocket-integration-roadmap.md)：规划本地 Node + OBS 5.x 接入、人工一键转场、BGM 淡入淡出、录制目录容量与中断告警、后续可信自动切镜与受控远程桥接。**最终阵容归属识别到变化但未成功应用**是 P0 前置可靠性缺陷，必须先实现服务器确认与正确玩家/英雄匹配，不能基于未应用的英雄信息自动切场景。

## 系统组成

| 模块 | 用途 |
| --- | --- |
| **Control** | 导播主操作台。管理队伍、比分、Stage、赛制、BP、选手顺序、最终阵容、访问设置、恢复与赛后数据。 |
| **Caster** | 解说端。读取延迟的 BP、比分与比赛进度，队伍/赛事资料和展示配置实时更新，减少远程解说看到实时 BP 数据造成的信息提前量。 |
| **Draft Overlay** | OBS Browser Source。展示队名、Logo、比分、当前局、Ban/Pick、选手 ID、英雄与有效局历史。 |
| **Auto BP** | 从共享游戏窗口读取 18 个 Ban/Pick 槽位，识别英雄、空 Ban、双 Pick、锁定与阶段推进。 |
| **Player ID Alignment** | 从同一采集窗口识别双方 10 个 Player ID，在已知五人名单中做全局一一匹配并恢复 P1–P5 顺序。 |
| **Final Lineup Sync** | BP 结束后识别实际英雄归属，处理选手在最终确认阶段交换英雄的问题。 |
| **BP Simulator** | 默认与正式 MatchState 隔离，显式 Control 联动可建立测试基线；可测试 Player ID、BP、角色交换、尺寸、锁定时间和极限选角节奏。 |
| **Recovery / Backup** | 本地自动备份、完整恢复、比赛导入导出、操作日志与单后端进程保护。 |
| **Game HUD / MVP** | Game HUD 目前为 Experimental；MVP 基础链路支持赛后 OCR 草稿、人工修正和 OBS MVP 页面。 |

## 典型比赛流程

```text
赛前
设置队伍 / Logo / 首发 / Player ID / BO / Stage
        ↓
开局房间
Player ID OCR 自动确认 P1–P5 实际顺序
        ↓
BP
Auto BP 识别 Ban / Pick / 空 Ban / 双 Pick
        ↓
BP 完成
识别最终 P1–P5 英雄归属与角色交换
        ↓
比赛进行
Control / Caster / OBS 保持同一比赛状态
        ↓
Game End
提交有效局 → 更新系列赛比分 / Draft History
        ↓
赛后
可采集结算页数据 → 人工/投票选择 MVP → /overlay/mvp
```

系统不会强迫所有识别结果自动写入比赛。低置信度、临时替补、特殊字符或 UI 改版时仍允许导播采用建议、手动交换、直接选英雄或恢复自动识别。

## 快速启动

第一次使用建议先看 [新手上手教程](docs/guides/beginner-guide.md)。操作台的四步指引与断线处理说明见 [导播操作流程更新](docs/guides/operator-workflow-update.md)，采集、设置草稿、数字编辑与存档恢复变化见 [操作与可靠性改进说明](docs/guides/system-reliability-update.md)。

使用 Node.js 24 从源码启动：

```powershell
git clone https://github.com/EaDen-Cen/Honor-of-Kings-International-Server-Tournament-Broadcasting-System.git
cd Honor-of-Kings-International-Server-Tournament-Broadcasting-System/vite-project
npm ci
npm run build
npm run server
```

Windows 现场使用可直接双击：

```text
vite-project/start-broadcast.bat
```

启动器需要 cloudflared，会准备依赖、构建网页、启动服务器和 Cloudflare Quick Tunnel。本机离线运行使用上面的源码命令。结束时运行 `stop-broadcast.bat`。

本机入口：

- Control：<http://127.0.0.1:3001/control>
- Caster：<http://127.0.0.1:3001/caster>
- Draft Overlay：<http://127.0.0.1:3001/overlay/draft>
- Experimental Game HUD：<http://127.0.0.1:3001/overlay/game-hud>
- MVP Overlay：<http://127.0.0.1:3001/overlay/mvp>
- 五位置对位图：<http://127.0.0.1:3001/overlay/postgame-compare?role=mid>
- 经济时间线：<http://127.0.0.1:3001/overlay/game-progress>

本机访问由服务器验证后免登录；远程密码和各角色 token 在 Control 的“访问与网站设置”中管理。

## BP 屏幕采集模拟器

为了测试识别链路，不需要每次进入真实游戏房间。仓库提供与正式比赛状态隔离的 Simulator：

```powershell
cd vite-project
npm run simulator
```

Windows 也可以直接运行：

```text
vite-project/start-bp-simulator.bat
```

控制台与采集画面：

```text
http://127.0.0.1:5173/tools/bp-simulator-control
http://127.0.0.1:5173/tools/bp-simulator
```

当前测试阅读/操作顺序为：

1. **选手 ID 排序**：随机双方五人房间顺序，测试 Control 在短时间内恢复 P1–P5 对应关系。
2. **BP 模拟**：测试 Ban/Pick、双 Pick、空 Ban、预选切换、锁定 cue、蓝/红先手与完整 phase。
3. **角色交换**：只测试 BP 完成后的最终英雄归属，不与 BP 识别混在一起。

顶部的 **“从 Control 同步模拟器数据”** 可以把当前 Control 状态单向读入 Simulator：ID 模式同步选手与槽位顺序，BP 模式同步当前 Draft，角色交换模式同步最终 assignments 作为 Ground Truth。该按钮不会反向修改正式比赛状态。开启“Control 联动测试”并建立 Simulator → Control 基线则会重置/修改当前比赛，应使用测试比赛。

测试结束后运行：

```text
vite-project/stop-bp-simulator.bat
```

## 英雄数据库

当前程序包含的英雄/形态、名称和编号由独立名单维护。

- [程序内英雄名单](docs/research/hero-roster.md)：当前有效英雄、中文/英文名称与 release-order ID。
- [英雄 Release-order ID 规则](docs/research/hero-id-order.md)：编号原则、同批英雄处理和旧存档迁移。
- [英雄数据自动同步](docs/research/hero-sync.md)：名单来源、自动检查、图片与文档更新规则。

Hero ID 目前按国际服 **Launch Time 从旧到新**连续编号，因此 ID 越大代表越晚上架；图片资产文件名与 Hero ID 已解耦。

## 文档导航

| 需要做什么 | 文档 |
| --- | --- |
| 第一次使用，从下载安装到完成一轮测试 | [新手上手教程](docs/guides/beginner-guide.md) |
| 安装、三端接入、延迟、备份和部署 | [运行指南](docs/guides/getting-started.md) |
| 比赛流程、快捷 BP、照片、队伍库及替补 | [操作指南](docs/guides/operator-guide.md) |
| Auto BP、18 框校准、Player ID、预设、锁定与换英雄 | [屏幕识别指南](docs/guides/screen-recognition.md) |
| 选手对齐、恢复、HUD 与 MVP | [后续功能指南](docs/guides/player-alignment-recovery-hud.md) |
| Windows 一键启动、Simulator 启停及 Cloudflare | [启动器说明](docs/guides/windows-launcher.md) |
| 查看当前程序英雄名单 | [英雄名单](docs/research/hero-roster.md) |
| 自动检查英雄名单和图片更新 | [Hero Sync](docs/research/hero-sync.md) |
| v1.0.0 功能、发布检查与已知边界 | [v1.0.0 发布说明](docs/releases/v1.0.0.md) |
| 理解源码目录和状态流 | [系统结构](docs/design/architecture.md) |
| 查看项目阶段与未来路线 | [项目里程碑](MILESTONES.md) |
| 查看历次测试及未验收范围 | [验证记录](docs/validation/history.md) |
| 查全部文档和维护规则 | [文档总索引](docs/README.md) |
| 查旧交接、旧计划和原项目介绍 | [历史归档](docs/archive/README.md) |

## 选手对齐、恢复、HUD 与赛后 MVP

选手身份和英雄归属是后续 HUD、赛后数据和 MVP 的基础。系统现在为每局维护独立的 `bluePlayerSlotOrder` / `redPlayerSlotOrder`，不会因为游戏房间里的 P1–P5 顺序改变而重排队伍资料库。

Player ID OCR 会利用赛前已经知道的五人名单做全局匹配，而不是把整个 ID 交给通用 AI 从零猜测；双方可信时可以一次原子更新 10 个槽位。单帧存在边缘弱项时，连续相同排列可以进行两帧一致性复核，仍然保持原安全阈值。

备份与恢复已经覆盖比赛状态、事件历史、队伍资料、上传媒体和访问配置。局内 Game HUD 支持人工统计，2026-10-13 开发增量加入时间/人头/经济/推塔的顶栏 OCR、两次采样核验与逐项冻结；仍为 **Experimental**，OBS 长时间稳定性和连续真实游戏画面适配待实机验收。赛后新增六种十人结算页及对局汇总的整页模板采集、页签分类、身份审核和证据保存；可直接用截图彩排，装备与截图内的经济曲线不在**自动识别**范围内；可在赛后补录评分，导入真实经济时间点绘制图形。

赛后 MVP 模块的重点不是由程序决定“谁最值得 MVP”，而是把分散在多个结算页的数据尽快整理成结构化报告。MVP 人选由比赛方/投票决定，系统负责展示。

详细说明见 [选手对齐、恢复、HUD 与赛后 MVP](docs/guides/player-alignment-recovery-hud.md)。

## 低配置导播优化

项目默认假设导播电脑还要同时运行 OBS、浏览器采集、Discord/解说链路甚至游戏客户端，因此持续避免让辅助系统占用不必要资源。

- MatchState 按角色和 revision 缓存，Caster 延迟事件使用二分查询，减少重复复制与序列化。
- 英雄识别减少中间图片编码，保留必要的多裁剪候选，并缓存完全相同画面的识别证据。
- Player ID OCR worker 在服务启动阶段预加载并保持常驻；正常首轮只跑较轻的预处理，未通过的队伍才追加候选。
- Auto BP 扫描串行化，避免识别请求堆积；重型英雄编辑器与 Simulator 按需加载。
- Overlay 与 Simulator 使用固定设计画布并随窗口等比缩放，减少为了不同 OBS 分辨率维护多套页面。
- 高级识别项默认收起，自动输入置信度阈值可以按赛事设备在 50%–100% 范围调整。

真实 CPU、内存、OBS 掉帧和录制音画稳定性仍以赛事机彩排为准，不能用单张图片识别 benchmark 推断完整直播负载。

API 与未来识别 Provider 接口见 [协议文档](docs/design/api.md)，性能与打包路线见 [项目里程碑](MILESTONES.md)。

## 英雄数据与广播裁切同步

英雄小头像、广播 Full Art 和 Panel/Side 构图属于不同层的数据。现场修改不会在后台自动上传 GitHub。

Panel（底部横排）和 Side（左右竖排）的裁切有两层存储：

- Control 中点击“保存英雄图片”后，当前机器的调整保存在 `data/match.json -> state.heroArtOverrides`。它会进入本机备份，但 `data/` 被 Git 忽略。
- 可共享的默认裁切保存在 Git 跟踪文件 `src/data/heroArtFocusOverrides.ts`。在实际完成构图校准的电脑上运行 `sync-hero-crops.bat`，或在 `vite-project/` 执行 `npm run hero:crop-sync`，会把运行时 Panel/Side x/y/scale 提升到共享文件。

推荐流程：

```text
Control 调整 Panel / Side 构图
        ↓
保存英雄图片
        ↓
sync-hero-crops.bat
        ↓
检查 heroArtFocusOverrides.ts diff
        ↓
commit / push / PR
        ↓
其他赛事机 pull 或使用下一版 Release
```

同步命令只导出 `panel/side` 的 x/y/scale，不会把比赛、队伍、密码、选手资料、访问 token 或 `useLegacyImage` 一并提交，也不会自动执行 git push。

名单与图片来源维护详见 [Hero Sync](docs/research/hero-sync.md)。

## 仓库结构

```text
README.md           项目入口
LICENSE.txt         MIT 许可
docs/               当前指南、设计、验证、研究与历史归档
research/           英雄研究原始 JSON 证据
deploy/             Docker Compose / Caddy / 环境变量示例
vite-project/       应用与 npm 命令执行目录
  src/              前端、共享类型、比赛状态与 BP 规则
  server/           HTTP/WS、持久化、识别、上传、备份与队伍资料库
  scripts/          Hero Sync、benchmark 与维护脚本
  e2e/              Playwright 浏览器测试
  public/           英雄头像与其他静态资源
  data/             运行时比赛、队伍库、访问配置、上传媒体（不入库）
  artifacts/        本机测试截图和日志（不入库）
```

开发和验证命令见 [应用目录说明](vite-project/README.md)。OBS、跨设备公网、完整音画同步与真实游戏 UI 兼容性仍需要赛事设备彩排；自动化测试不能替代现场验收。

本项目基于 qiqi47 的原项目继续开发，保留原英雄数据及 [MIT 许可](LICENSE.txt)。[原中英文 README](docs/archive/legacy/upstream-readme.md) 已完整归档，旧站点与旧安装说明仅作历史参考。


## 回放赛后图形（开发 PR #67）

不必凑齐十位玩家才能测试结算流程：使用游戏回放中的 PNG/JPEG 截图，第一次核对十人身份行序后，六种玩家统计页共用这一映射；如后续 OCR 与已保存顺序冲突则显示提醒，不会自动覆盖。此映射存在当前浏览器 localStorage，换电脑/浏览器需重核。

OBS 三种 **1920×1080** 页面：`/overlay/mvp` 全屏 MVP、`/overlay/postgame-compare?role=mid`（clash/jungle/mid/farm/roam 五位置对位雷达）及 `/overlay/game-progress` 经济 x 时间。评分可核实后人工补录或自行校准原有单字段 OCR；不会凭字母评级猜数字。经济线只连接输入的 **2–240 个真实时间/双方经济观测点**，不从最终经济反推。上述均为开发分支能力，**未通过真实十人+OBS 长时验收，也不包含在此前发布的 RC.1 中**。详细使用方式见 [操作指南](docs/guides/operator-guide.md#回放优先的赛后彩排pr-67)。

所有代码改动须在同一个 PR 中同步核对、更新相关文档，规则见 [文档索引与维护约定](docs/README.md#命名和维护规则)。


## 国服 / 国际服双英雄池与自定义 0–5 Ban（开发 PR #68）

比赛设置新增互不依赖的英雄池 `global / cn` 与每队 `0–5` Ban。Match 模式按先 2 Ban、三选、再禁剩余 Ban、两选的结构运行（5 Ban 为 KPL 风格 2+3，国际赛事 4 Ban 为 2+2）；Normal 将 Ban 全部放在选人前。修改后服务器校验、比赛历史、Control、OBS、Simulator 与捕获槽位都使用相同的设置。旧 Match 默认 4 Ban，旧 Normal 默认 2 Ban。特殊巅峰对决/Ultimate Battle 的盲选不是普通 0 Ban，目前尚不支持。

**国服英雄名单仍是工作快照**：目前由有来源和日期的 2026-08-19 国服官方接口存档（132 条）组成；不能保证覆盖国服 2026 年 10 月全部英雄。可运行 `npm run hero:cn-sync` 尝试更新国服官方名单；国服独有英雄自动 OCR 与 Ban #5 的真实游戏 ROI 尚未验收，优先人工输入。完整规则、来源、兼容性与测试矩阵见 [双服英雄池/自定义 Ban 指南](docs/guides/hero-pool-and-ban-rules.md)。

## 2026-10-13 · 赛后路由/MVP 与完整 GHUD 包装修复（PR #69）

- **Node 生产路由修复**：`/overlay/postgame-compare?role=clash|jungle|mid|farm|roam`、`/overlay/game-progress` 与 MVP/Draft/GHUD 一样返回现有 Vite SPA 的 `dist/index.html`；路径中的 `?role` 属于查询参数，不是独立 HTML 页面。不要重复创建不存在的 `postgame-econ/radar/lane` 路由；雷达包含在对位页面内。需要服务器重新启动到此 commit（并完成前端 build），不能只刷新旧服务器。
- **MVP 改图**：人像素材使用裁剪焦点，完整英雄立绘优先 `object-fit:contain` + 模糊背景，避免 `cover` 截掉头部或手；支持素材自带 `artPosition`，未核实的游戏评分不再显示一个只有「—」的评分卡。评分来源仍须真实 OCR 或人工输入，不通过自造评分填坑。
- **GHUD 1920×1080 赛事顶栏（2026-10-19 新版）**：根据双场实战反馈废弃四周大面积遮罩与假地图，采用参考 KPL 信息层级的原创紧凑顶部条。Compact 仅占顶端 99px，Full 加十人英雄/ID 小条后占 131px，其余区域完全透明，保留真实小地图、游戏画面、两侧信息与底部技能/回放内容。仍须根据观战源实际布局处理**原生顶部 UI 重影**，不能假设官方客户端有统一坐标。旧版全遮挡方案只留历史记录。
- **GHUD OCR 重新校准**：导播必须选择采集窗口 → 预览当前 16:9 游戏帧 → 七项逐字段拖动数字框或按像素调整 `x/y/width/height` → 保存确认 → 手动采两次 → 检查候选 → 再决定是否开启自动采样和自动播出。位置保存在**当前浏览器** `localStorage['hok-ghud-calibration-v1']`；修改采集源/顶部偏移或切换窗口后禁止自动播出，必须重新预览确认。以零偏移为初始值，禁止把窗口多出来的底部回放区猜成顶部标题栏。服务器校验七个 ROI 的范围、尺寸、重叠和两次采样的裁切 profile；游戏时钟停滞、低置信度、采样不一致、异常数据或人工冻结会拒绝自动合并。蓝队青色背景只在裁切图中确实存在时才作自适应抑制；其他 UI 保留原像素，经实际回归避免把 1.5K 误读为 15.0K。
- **保留限制**：实测截屏的 ROI/自动识别准确率、UI 客户端/分辨率切换、OBS 长时并发、屏幕安全区和完整官方视觉包装均需要本机实测；CI 构建/单元测试不能证明官方完整 HUD 已适配。没有可靠经济时间序列仍只提示 Control 导入真实点，不从结算总经济推导趋势。

详见 [赛后修复与 GHUD 彩排](docs/guides/postgame-ghud-overlay-fixes.md)。


### 修复单字段 OCR 黑图与难用的评分框选（PR #70）

赛后「单字段 OCR」改为**上传截图/共享窗口 → 预览冻结游戏画面 → 选择选手 → 直接拖框数字 → 单人或批量识别 → 人工核验后应用**。上传到「结算整页采集」的 PNG/JPEG 可在同页的字段工具直接复用；不再依赖独立隐藏视频流或臆测的十个默认裁图位置。可将校准框按同队 130px 固定行距生成其余四人（须人工核对），黑图/纯色裁图拒绝入库，报告数据仍保留置信度和可信冲突保护。详见 [操作说明](docs/guides/postgame-ghud-overlay-fixes.md#2026-10-13--pr-70--赛后数字-ocr-恢复截图直接框选)。

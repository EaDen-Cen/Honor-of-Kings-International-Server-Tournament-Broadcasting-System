# HOK Broadcast · 王者荣耀赛事 BP 导播系统

HOK Broadcast 是一套面向 **Honor of Kings / 王者荣耀国际服社区赛事** 的本地优先导播系统。它的目标不是替代 OBS、游戏客户端或完整赛事平台，而是把比赛中最容易让单人导播手忙脚乱的工作集中到一套状态系统里：**赛前队伍与选手、BP 数据、选手 P1–P5 顺序、最终英雄归属、解说延迟、OBS 图形、备份恢复，以及赛后 MVP 数据展示**。

项目最初围绕 Discord 社区线上赛和单导播工作流开发，因此设计重点一直是：

- 导播只维护一份权威比赛状态，Caster 与 OBS Overlay 按各自的数据时序跟随；
- 能自动识别的步骤尽量自动完成，但始终保留人工确认、Undo 和手动 fallback；
- 屏幕识别、选手 ID OCR 与换英雄识别尽量在本机完成，避免把比赛主链路依赖在远程 AI 或临时网络服务上；
- 测试工具与正式比赛状态隔离，方便在没有真实房间、没有十名选手时反复压测；
- 数据、队伍资料和运行时状态可持久化、备份和恢复，不把一场比赛建立在浏览器临时状态上。

当前技术栈为 **React + TypeScript + Node.js + WebSocket**。Node 服务端维护权威 MatchState、修订号、Undo/事件历史、Caster 延迟时间线与持久化；浏览器端分别提供导播、解说、OBS Browser Source 和 Simulator。

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

第一次使用建议先看 [新手上手教程](docs/guides/beginner-guide.md)。

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

备份与恢复已经覆盖比赛状态、事件历史、队伍资料、上传媒体和访问配置。局内 Game HUD 已支持人工维护的系列赛信息、人头、推塔和中立资源，但仍为 **Experimental**；自动读取游戏 HUD 尚未实现，OBS 长时间稳定性和实际游戏画面适配待实机验收。

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

# HOK / LoL 功能对照审计（2026-10-06）

> 历史研究快照（2026-10-06），不作为当前操作指南。Simulator 当前支持显式 Control 联动；备份/恢复已实现。当前状态见 [里程碑](../../MILESTONES.md)，操作见 [屏幕识别指南](../guides/screen-recognition.md)。

> 目标：只学习 LoL 项目的功能、可靠性与导播工作流优化，不复制 LoL 的 UI / 视觉语言。

## 本次检查范围

对照仓库：

- HOK：`Honor-of-Kings-International-Server-Tournament-Broadcasting-System`
- LoL：`League-of-Legends-International-Server-Tournament-Broadcasting-System`

重点检查了 LoL 的当前里程碑、Team Library、Draft Lifecycle、Champion Studio、Store/Caster delay、自动 BP 与近期真实 League Client 调试提交。

## HOK 已经具备，不需要重复移植

以下能力已经存在于 HOK：

- Team Library；
- 替补名单；
- 快速换人；
- Final Lineup Assignment / 帮抢后最终归属；
- 中文拼音声母英雄搜索；
- Enter 快速提交；
- Caster Delay；
- Hero Art Panel / Side 独立裁切；
- 浏览器窗口采集与 18 个 BP 槽位独立校准；
- Manual fallback；
- Undo / Draft History；
- 全局 BP / 选手 BP / 普通 BP。

## 本分支新增：BP Capture Simulator

新增独立工具：

```text
/tools/bp-simulator
```

Windows 可直接运行：

```text
vite-project/start-bp-simulator.bat
```

或：

```powershell
cd vite-project
npm run simulator
```

它不会连接或修改真实比赛状态，仅用于给 Auto BP 提供稳定的测试窗口。

模拟器支持：

- Match / Normal BP；
- 蓝 / 红先手；
- HOK 真实 draft phase 顺序；
- 蓝红双方 Pick 槽；
- 圆形 Ban 头像；
- 锁定标记；
- 空 Ban；
- 单步前进 / 后退；
- 随机英雄；
- 自动脚本；
- Ban / Pick 头像尺寸调节；
- 隐藏控制面板，得到干净的采集画面；
- 快捷键：N/B 步进、Space 锁定、E 空 Ban、R 随机、A 自动、H 隐藏控制。

推荐测试流程：

```text
HOK Control / Auto BP
        │
        ├─ 选择游戏窗口
        │
        ▼
BP Simulator 独立窗口
        │
        ├─ 测 Pick recognition
        ├─ 测小尺寸圆形 Ban
        ├─ 测 lock cue
        └─ 测 empty Ban
```

这样不需要每次开真实游戏、自定义房或等待真人 BP，就能稳定复现识别问题。

## 从 LoL 移植的功能优化

### 1. Reset Match 保留赛事配置

LoL 当前的 `reset_match` 只清空比赛进度，而保留赛事级配置。

HOK 本分支同步这一语义。重置整场比赛后保留：

- Stage / Event 名称；
- BO1 / BO3 / BO5；
- Draft Mode；
- BP Rule；
- 元流之子计算规则；
- First Pick；
- Side Swap Mode；
- Language；
- Overlay Layout；
- Score Display；
- BP Input Mode；
- Hero artwork / data overrides；
- Hero name display。

清空：

- 比分；
- Game number；
- 当前 Ban/Pick；
- Final lineup；
- committed games / history。

这样“重置比赛”不再等于“重新配置整套赛事”。

### 2. Caster 实时看到非敏感元数据

LoL 的 Caster Delay 已经把“比赛进度”和“资料配置”分离。

HOK 本分支同步：

**实时：**

- 队名；
- 队标；
- 选手 ID / portrait / 分路；
- Stage；
- BO；
- 语言；
- Overlay / 展示设置；
- Hero data/art overrides。

**继续延迟：**

- Ban / Pick；
- 比分；
- Game progress；
- committed Draft History。

这样异地解说刚连进来不会在 180 秒延迟期间看到一块默认空白资料板，但仍不会提前看到比赛信息。

### 3. Hero Studio 支持运行时 Portrait / Full Art 覆盖

LoL Champion Studio 允许修改赛事运行时的 Portrait / Splash 来源。

HOK 本分支加入：

- Hero Portrait URL / 本地绝对路径；
- Hero Full Art URL / 本地绝对路径；
- 搜索后 Enter 快速切换当前编辑英雄；
- 预览立即使用尚未保存的图片源。

并同步 LoL 的一个重要可靠性优化：

> Store 只保存真正不同于生成基线的字段。

例如只修改敖隐高清图时，不会顺便把当时的名称、分路、alias 固化进 override。以后自动 Hero Sync 更新其他字段时，不会被无意的旧 override 卡住。

## 没有移植的 LoL 功能

### League Client API Auto BP

不移植。

LCU 是 League Client 私有本机 API，对 HOK 没有对应接口。HOK 继续走：

```text
Window Capture
→ 18-slot calibration
→ Recognition
→ Human review
→ Manual fallback
```

### LoL 视觉 / Role Icon 样式

不移植。

用户明确要求学习功能优化而不是 UI。LoL 的黑金视觉、Champion Card、Role Icon Style、五 Ban 布局都保持 LoL 独立。

### LoL 5 Ban 规则

不移植。

HOK Match / Normal Draft 顺序继续使用 HOK 自己的规则模型。

## 下一批值得移植的功能

按收益排序：

1. **Match Snapshot / Export / Import**
   - 彩排前保存；
   - 崩溃后恢复；
   - 不依赖手工复制 `match.json`。

2. **Event Audit Log**
   - 谁在什么时候 Ban/Pick/Undo/Reset/改比分；
   - Auto BP 与人工操作来源区分；
   - 非常适合正式赛事排错。

3. **Health Dashboard**
   - Server；
   - Caster；
   - OBS；
   - Tunnel；
   - Capture source；
   - Auto BP；
   - 数据存储；
   一屏判断哪里断了。

4. **Team Library Backup / Restore**
   - 队伍和选手 portrait 属于长期赛事资产，应能单独备份。

5. **Crash Recovery / Last Known Good State**
   - 保存最近可恢复快照；
   - 避免机器异常重启后临场手工重建。

6. **Named Tunnel / Director App 整合**
   - 让桌面 Director 直接显示公网 URL 与连接状态。

## 原则

HOK 与 LoL 可以共享：

- authoritative server 思路；
- undo / history；
- roster library；
- reliability workflow；
- data override 模型；
- operator safety guard；
- test strategy。

但不应该共享：

- 游戏专属 API；
- BP 规则；
- 英雄数据来源；
- 视觉 identity。

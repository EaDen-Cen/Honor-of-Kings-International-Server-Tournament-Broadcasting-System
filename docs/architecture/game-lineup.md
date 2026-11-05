# 本局实际阵容与直接编辑

## 审查结论

既有 Store 保存 Pick 顺序和最终英雄归属，使用 revision、ACK、Undo 与原子保存。`replace_draft_hero` 已具备历史局纠错及赛后英雄更新能力。`PlayerSlotOrder` 表示画面槽位到选手名单索引的映射，`Assignments` 表示画面槽位上的英雄。赛后数据使用 `team.id:rosterIndex` 绑定选手。

原实现通过 `Team.playerRoles` 读取分路，无法独立记录每局换路。MVP 展示还会通过当前队伍资料重写已保存的分路。新增分路必须与这两条读取路径一起修正。

## 四种映射

| 信息 | 存储 | 更新入口 |
| --- | --- | --- |
| 队伍默认资料 | TeamPreset，比赛载入后的 Team 快照 | 既有队伍编辑 |
| 画面槽位到选手 | PlayerSlotOrder，值为 rosterIndex | 既有选手识别或手动排序 |
| 画面槽位到英雄 | Assignments | swap_assignments / set_lineup_assignments |
| 选手到本局分路 | GameRoles，按 rosterIndex 索引 | set_game_roles |

`blueGameRoles` / `redGameRoles` 在开始 BP 时保存本局默认值，提交时随 GameDraftRecord 保存。历史修正只改目标记录及其报告。换路更新报告的 role，英雄交换更新 heroId，个人数值、rowId、MVP 选择继续绑定原选手。

## 操作与一致性

`set_game_roles`、`swap_assignments`、`confirm_game_lineup` 支持显式 gameId。Store 校验目标局、分路排列及英雄合法性，并复用统一事务和 Undo。已确认阵容要求先解除确认。手动操作设置本局的 `lineupAutomationBlocked`，防止旧自动识别结果回写。下一局清除该标记。

点击 BP 头像使用原 `replace_draft_hero`。它会更新对应 Pick 记录及引用该英雄的最终归属。拖动最终阵容英雄则调用 `swap_assignments`，Pick 记录继续保留原次序。

界面只保存尚未确认的交互预览。正式修改仍通过 WebSocket 发往 Store，ACK 后显示服务器确认。相关阵容发生变更会取消旧预览。普通直播统计更新不关闭英雄选择器。

Overlay 完成 BP 后按本局分路展示卡片，Caster 沿用配置的延迟并显示最终归属。赛后与 MVP 使用报告快照，后续队伍默认资料更新不会覆盖历史阵容。

## 兼容与边界

旧档没有 GameRoles 时从该局 Team 的默认分路读取。恢复入口校验新字段，下一局重新采用默认分路。每个队伍应有五个不同的默认分路，异常旧值回退标准五路并保持待人工确认。

当前 OCR 提供选手与英雄证据。缺乏实际分路证据时维持默认值，界面显示待人工确认。合成测试与触控模拟只能证明程序路径，赛事画面、真实平板和操作者耗时需现场验收。

# 逐局规则与比赛记录

本增量沿用 Store、MatchState、GameDraftRecord 和 PostGameReport，不另建比赛状态源。

```text
SeriesRules.defaultGameRules + games[局号] 覆盖
  -> gameRulesFor(局号)
  -> 当前局生效规则 / 现有 BP 字段
  -> start_blind_game 或 BP + commit_game
  -> GameDraftRecord.rules 固定快照 + 稳定 Game ID
  -> PostGameReport（包括无英雄盲选局）
```

`SeriesRules.games` 是单局稀疏覆盖，系列赛格式继续由 `MatchState.seriesFormat` 唯一保存；管理器按格式展现全部潜在局。`currentGameRules` 是当前实际规则，`GameDraftRecord.rules` 是已确认局的实际规则快照。历史查看和跨局贡献读取历史自身快照，不读取当前默认。

`series_rules` 操作在 Store 原子验证、写盘和广播；原有修订号/ACK 保护继续生效。普通编辑锁定已开局局次；未来局可改。格式变化验证当前比分、最大局号和既有报告，不能删除已打局。

Global/Player BP 仍调用既有 `pickRestriction`、`banRestriction`、`draftRestriction`，统一筛选当前局之前、已确认且贡献历史的记录。团队按稳定 team ID，个人按规范化玩家身份；换边、替补、元流形态和跨池稳定英雄 ID 继续复用原规则。

盲选没有 Ban/Pick 阶段，正常零 Ban 则保留十次 Pick。盲选开局创建 Game ID，关闭英雄记录时 picks/阵容为空但赛后仍有十人数据行；可选录入实际阵容不能伪造 Pick 顺序。报告以 Game ID 绑定，英雄缺失使用未知占位，不能从当前/上一局补英雄。

旧存档迁移覆盖当前、Undo 与延迟事件快照。新增属性写入现有比赛存档和恢复归档；客户端协议校验接受 BO7 和规则字段。历史贡献管理员纠错使用独立操作并保存原因、前后值及时间；Undo 还原整个状态。

实际 UI 和操作见 [逐局规则指南](../guides/game-rules-manager.md)。

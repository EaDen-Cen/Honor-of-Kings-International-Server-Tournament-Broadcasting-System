# 数据与确认边界

```mermaid
sequenceDiagram
  participant UI as Control
  participant OCR as Recognition
  participant S as Store
  participant D as Disk
  participant O as Overlay/Caster
  UI->>OCR: 当前局上下文、采集代次、ROI
  OCR-->>UI: 候选、时间、置信度、证据
  UI->>UI: 多帧核验 / 人工确认
  UI->>S: action ID + revision + 授权
  S->>S: 校验局与字段、保留人工优先级
  S->>D: 写临时文件并原子替换
  S-->>UI: ACK / 权威快照或错误
  S-->>O: 即时 / 延迟快照
```

异步识别必须核对报告 ID、采集源 generation、请求取消状态和当前上下文。过期返回不得进入新局。发送成功不能等同于服务端保存成功；失败时保留输入并显示原因。

Series 保存赛事、队伍、赛制与比分；有效 Game 使用 `draftHistory[].id`；Postgame Report 使用同一稳定 ID。显示的 gameNumber 不能代替身份。当前 main 在 `next_game` 后仍保留旧 activePostGameReportId，因此 UI 必须明确历史编辑上下文；PR #99 在 commit 时创建并选择新报告，需补充未 commit 阶段和截图草稿的验证。

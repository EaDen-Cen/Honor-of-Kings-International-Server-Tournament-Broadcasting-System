# 存储维护与 OCR 证据边界

这项实现已由 #115 合入 main（`29d2212`）。回放的裁图/OCR 时间与在线 Control 等待 ACK 的时间使用独立测量。[回放指南](../guides/hud-occlusion-replay.md) · [动作 ACK 基准](../validation/upload-latency.md)

基线 main `6b5abd9`，保留 #113 BO7/逐局规则；不采用已关闭 #114 的实现。

## 存储

```text
Playwright 实际输出 → 身份/时间/内容凭据 → .maintenance/receipts
本机 Control / 只读 CLI → 有预算的目录统计 + 保护引用检查 → 预览
预览 ID → 当前活动检查 → 锁 → 再核对引用/内容/祖先路径 → 单文件 unlink
                                        → 持久化删除/跳过记录
```

`storageMaintenance.ts` 不依赖比赛动作，不维护第二份比赛状态。服务通过只读回调提供 Store（含历史）及恢复 JSON 引用、当前比赛/OBS 状态；维护设置和最近 20 次记录独立保存在现有数据目录的 `storage-maintenance.json`。CLI 仅扫描，删除只能在本机 Control 以新鲜预览 ID 执行。

文件扩展名和目录白名单只是必要条件，生产者凭据才是资格来源。对修改时间、大小、文件身份、硬链接数与 SHA-256 再校验，检测正常并发写入；逐个检查所有祖先和 realpath，拒绝 junction/symlink。没有递归删除，也不跟随链接扫描。正常本机使用下的链接/替换回归已测试；Node 路径校验和 unlink 不是操作系统的原子 handle-relative 删除，不把它当作抵抗有同等本机写权限恶意竞态的安全沙箱。

保护引用采用保守字符串/文件名匹配，可产生额外保留，不能产生主动放宽。损坏、过大或超时的引用扫描使清理停止。赛后证据目前共用上传目录，无法证明临时来源，因此不纳入删除范围。旧无凭据的测试文件同样保持只读。

## OCR

`hudOcrCache` 只保留非空、符合字段格式且 ≥85% 的结果；命中返回原 evidenceId。`recognizeLiveHudCrops` 为同一批解码像素生成 frameHash。`trustedLiveUpdates` 要求新像素与独立字段证据，再执行原格式、双帧一致性、增长边界和人工冻结检查。

新版证据允许逐字段更新，不再由时钟失败关闭全部字段。旧协议没有 frameHash 时保留原时钟门槛。Store 校验新增元数据后仍使用原 revision / ACK / Undo / 持久化；BO7 和盲选 BP 逻辑没有改动。校准确认 epoch 加入来源标识，避免相同坐标重新校准后复用旧缓存。

Overlay 读取已核验秒数；时钟不再做本地推算。健康提示和候选只是导播 UI 状态，不会覆盖权威数字。研究与回放工具是离线验证，不改变生产引擎或读取生产密钥。

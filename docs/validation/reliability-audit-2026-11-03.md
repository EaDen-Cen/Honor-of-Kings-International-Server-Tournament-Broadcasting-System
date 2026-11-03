# 可靠性审计与阶段验收账本

## 范围与恢复点

基线 main：`c7f0f43f9519528e87bed9f50fee40d3be01f114`。独立分支 `codex/phase0-baseline-20261103`；本地已建立完整 Git bundle。没有访问用户运行中的比赛资料、配置或凭证，因此不能宣称已备份生产资料。上线前须停服创建受校验的 Recovery 备份。

唯一开放 PR 为 [#99](https://github.com/EaDen-Cen/Honor-of-Kings-International-Server-Tournament-Broadcasting-System/pull/99)，head `f8ef7e52bc436fef37be076116219c33c96b816c`，draft，25 个文件，517 增/22 删。含锁定 BP 纠错、自动新报告、OBS 容量、人工 checklist；应复用而非重做。检查发现：checklist 仅 sessionStorage 人工勾选；OBS 路径来自远程时必须避免误查本机同名路径；历史英雄纠错需审核规则上下文与最终阵容映射；尚不能按完成验收。

## 实测基线

| 检查 | 结果 | 限制 |
| --- | --- | --- |
| `npm ci` | 成功，Node 24.14.1 | 初次沙箱 DNS ENOTFOUND，正常权限重试成功；安装报告 12 moderate，尚未逐项审计 |
| `npm run build` | 通过 | 不代表运行时功能通过 |
| `npm run lint` | 通过 | 保留既有 warnings |
| `npm run format:check` | 失败，42 文件 | main 自身基线问题，不跳过检查 |
| `npm test`，正常 Windows 权限 | 331 通过，0 失败，2 跳过，共 333 | 沙箱首次 EPERM 不计为业务失败；真实私有图样未提供 |
| 指定九项 E2E 本地复测 | 进行中 | 沙箱健康探测失败后改为正常权限；已复现设置与 GHUD/模拟器失败 |
| Windows 启动器 / 真实 OBS / Discord / 平板 | 本次未执行实机验收 | 单元测试不能替代 |

## Actions 证据

[Broadcast run 41163028740](https://github.com/EaDen-Cen/Honor-of-Kings-International-Server-Tournament-Broadcasting-System/actions/runs/41163028740)：validate 的 build/lint/unit/format/launcher 通过，浏览器 **90 通过、9 失败**；windows-native 通过。失败涉及旧设置入口、GHUD 提示和人工修改后的采样断言、自动发布采样时序、Simulator status 不唯一、Linux 安全配置写入、两个同屏布局断言。不能将其全部当作超时。

[Hero sync run 41518751447](https://github.com/EaDen-Cen/Honor-of-Kings-International-Server-Tournament-Broadcasting-System/actions/runs/41518751447)：同步后测试有三项失败。王维头像由 `/heroesImg/120.png` 更新为内容寻址名称，旧测试硬编码路径；通用头像测试仅允许数字文件名；盾山原画更新后 broadcastArtAssets 没有对应 source。工作流需要生成并提交相匹配的 WebP 和 manifest，保留内容哈希及资源存在断言。

## 缺陷与优先级

| 优先级 | 根因/缺口 | 影响 | 验收 |
| --- | --- | --- | --- |
| P0 | 切局仍选择历史报告，commit 未自动选新报告；异步截图上下文需审查 | 后续局误录/覆盖 | BO1/3/5、旧报告编辑、重启、Undo、重复 action、晚到 OCR |
| P0 | main 不允许已 commit BP 的局部英雄修正 | 错图无法临场补救 | 复用 #99，当前/历史纠错、人工统计保留、Caster、Undo |
| P0 | CI 业务/测试/环境问题混杂 | 无可靠回归门槛 | 九个 E2E 原断言语义及全部回归通过 |
| P1 | 同步新原画未重建播出缓存 | 资源失配 | 同步产物与内容哈希一致 |
| P1 | GHUD 无真实遮挡回归集 | 不可信画面可能污染候选 | 真实遮挡/恢复、冻结/恢复自动；保留 Experimental |
| P1 | AI 无日/局预算；缓存仅 4 秒 | 持续付费不可控 | 默认本地、精确调用审计、预算耗尽停止所有兜底 |
| P1 | Discord Webhook 仅附属于 Bot 结果发布 | 无 Bot 权限不可完成流程 | 独立预览/发送/重试日志、确认 MVP |
| P1 | 开播检查与阶段 UI 未完整连接实际状态 | 单人导播易漏步骤 | 自动检测/人工确认分开，紧急绕过不假报通过 |
| P2 | 服务入口集中、README 多段历史声明互相冲突 | 难维护与错误完成认知 | 架构地图、状态清单、迁移后回归 |

## 功能完成度（本次审计状态）

| 功能 | 状态 | 下一验证 |
| --- | --- | --- |
| 权威 Store、revision、Undo、历史、重启恢复 | 已实现且有自动测试 | BO5 完整浏览器与现场连续使用 |
| 比分/局号 | 已实现但完整流程仍有缺陷 | 系列结束、第二小分、换边回归 |
| 锁定英雄纠错 / 录制容量 | 部分实现（未合并 #99） | 修订后单独验收 |
| GHUD 冻结/恢复与多帧 | 已实现但存在 E2E 回归，未实机验收 | 遮挡真实样本 |
| OBS 场景、音频淡化、赛后轮播 | 已实现但未实机验证 | Windows OBS 场景、录制、音频 |
| 录制中断告警 | 待完整核对 | 区分手停与故障，现场测试 |
| 自动识别设置持久化 / 远程连接与隧道 | 部分实现 | 重启恢复与真实远程设备 |
| AI 调度缓存 / 费用预算 | 部分实现 / 预算未实现 | 调用及预算回归 |
| Discord Bot 投票 | 已实现但未真实联调 | 无 Bot 权限不可依赖 |
| Webhook 独立通知与手工 MVP | 未实现完整工作流 | 无 Bot 配置完成公告 |
| 模拟器隔离 / Caster 延迟 / 备份恢复 | 已实现且有自动测试 | E2E 及实机彩排 |

## 分阶段交付约束

Phase 0 提交地图、基线和缺陷账本；Phase 1 修复 CI/跨局/纠错并复用 #99；Phase 2 提取经过验证的核心边界；Phase 3 改善已有工作区和真实检查；Phase 4 建立识别与成本保护；Phase 5 Webhook 优先联动；Phase 6 BO3/BO5 彩排与发布清单。每阶段独立提交/PR、测试证据和 revert 方法。不得将本账本当作后续阶段已完成。

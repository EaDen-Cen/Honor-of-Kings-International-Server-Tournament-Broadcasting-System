# PR #91 验证记录（2026-10-21）

初始验证基线：`c0afa2e8ad5b5e8e888fbc1cfb2838841f8136c2`。**状态更新（2026-10-21）**：PR #91 已合并 `main`，合并提交 [`00dedd05a224`](https://github.com/EaDen-Cen/Honor-of-Kings-International-Server-Tournament-Broadcasting-System/commit/00dedd05a224d77efd5d3dbf4f1c2bf2fb7b18c0)。本文保留草稿阶段测试与失败的时间顺序，不把早期失败写成最终状态。

## 已执行

- 审查全部 19 个 PR 提交与 8 个原差异文件。草稿阶段的两条 GitHub CI 曾因 `TTL_MS` 未使用在 Lint 失败；Windows 原生检查通过，主流程后续 E2E 当时跳过。此故障随后已修复，最终 PR 分支 CI 通过。
- 本机 Windows、Node 24.14.1、Chrome。完整单元/服务测试 306 项：304 通过、2 项按环境跳过、0 失败。其后新增 HUD 并发帧隔离用例，与全部 AI 用例合计 16/16 通过。
- AI 14 项模拟传输测试通过：密钥目标隔离、配置代次、取消、并发、超时/冷却结构、跨场景缓存隔离、三协议、非法候选、HUD/ID/赛后解析。
- 停靠/保存/切换预设/DOM 与输入状态保留、旧识别性能场景共 6 项浏览器测试通过。模拟双读换英雄到服务器确认一次测得 692ms，不能代表真实视频 P99。
- 全套首次 E2E：67/91 通过、24 失败。修复面板导航适配、OBS 窄面板按钮重叠及小屏 sticky 容器后，失败集复测 22/24 通过，余下布局项与工作区测试再复测 6/6 通过。最终完整回归 **91/91 通过（12.0 分钟）**；随后新增采集流与最终工作区定向回归 **4/4 通过（14.5 秒）**，覆盖预设、真实拖动、响应式重排后同一采集流仍为 live。
- 构建、Lint、格式检查通过；生产依赖审计 0 漏洞。Windows 真实启动/进程归属/异常关闭清理测试通过，既有独立进程保留。
- `hero:art-cache` 校验成功：112/112 已知高清立绘。无来源的英雄保留头像。
- PowerShell 同步模拟测试通过：URL 公告识别、伪造 URL 拒绝、健康前置、Bearer PUT、不重定向、401/403/404/405/429/500 分类。未发送真实同步 token。

最终 PR #91 分支提交 `277639bc2baade0c7da749482c9e523a44a789df` 对应的 **Broadcast system checks 与 Hero data sync 均成功**；合并后 `main` 的状态以 [GitHub Actions](https://github.com/EaDen-Cen/Honor-of-Kings-International-Server-Tournament-Broadcasting-System/actions) 为准（合并时再次触发 CI，不预先宣称结果）。本机 91/91 浏览器回归、Windows 原生检查及截图回放结果分别保留在上文；均不能替代真实赛事采集至 OBS 的端到端验证。

## 截图回放基准

用户指定本机资料目录中找到历史源码、真实截图裁图和运行截图，未找到 mp4/mkv/webm/mov/avi 录屏。复用 `server/fixtures/game-data-screenshots.json`，素材 SHA-256 `b1b01d270ba8f205a19d92430a220c1b1666b8fb1d96179c31eb209b2de3d560`。

首次测量 CPU i7-12700K；无缓存与短期 ROI 缓存交错各 100 次。同一录制 HUD 截图重复回放：

| 模式 | P50 ms | P95 ms | P99 ms | 正确字段 |
|---|---:|---:|---:|---:|
| 无缓存 | 130.34 | 146.93 | 172.43 | 700/700 |
| ROI 缓存 | 11.23 | 17.33 | 140.46 | 700/700 |

赛后 6 页数字批次：P50 1062.80ms，P95/P99 1775.04ms，319/320 字段正确。6 个批次不足以估计真实赛后 P99。另行重放已定位唯一误读：`team` 页第 32 个裁图（healing），预期 22,100（22.1k），OCR 文本为 `221k`，解析为 221,000；尚未修复该小数点漏读，保留赛后人工复核。原始耗时见 [pr91-replay.json](pr91-replay.json)。重现：在 `vite-project` 执行 `npm run benchmark:replay -- --fixtures-dir <截图素材目录> --iterations 100 --output replay.json`。

**范围**：仅图像预处理+OCR，排除画面采集、网络、WebSocket、Control/OBS 渲染及云端。静态重复帧有利于缓存；初次测量与浏览器回归同时运行。不能据此宣称所有 P0 实时目标已经达成。

## 尚需实机验收

真实服务商 API 与视觉模型兼容性、付费失败/断网；完整 BP/HUD/赛后录屏标注和采集到 Overlay 的 P50/P95/P99；长时间直播内存稳定性；真实 Cloudflare URL 变化与已部署 Sites 配对成功。网站代码、密钥、D1 接口不在本次 GitHub 改动范围。API 尚未部署时允许本地继续制作并手动填写。

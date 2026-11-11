# BetterGI 局部识别研究与 HOK 适用边界

研究中的缓存与逐字段验证建议已随 #115 合入（`29d2212`）。同批回放与实际端到端确认的测量边界见[识别回放](../guides/hud-occlusion-replay.md)和[传输验证](../validation/upload-latency.md)。

[研究索引](README.md) · [GHUD 采集架构](../architecture/ghud-capture.md)

核查日期：2026-11-08。HOK 基线为 main `6b5abd9`（#113，包含 BO7/逐局规则/盲选）；此文是源码研究与迁移判断，不是 BetterGI 或 PaddleOCR 在 HOK 上的性能实测。

## 固定的源码版本

BetterGI 仓库 `babalae/better-genshin-impact`，本次查阅的提交为 [`a9e08fc0b275f244633e02618db88190826e06e5`](https://github.com/babalae/better-genshin-impact/commit/a9e08fc0b275f244633e02618db88190826e06e5)，提交时间 2026-11-07 06:30:11 UTC，查询时默认分支为 `refactor/20260930`。下面链接都固定到该提交，不能把旧版教程或方法名当作当前实现。

| 源文件 | 核查内容 |
|---|---|
| [AutoPickTrigger.cs](https://github.com/babalae/better-genshin-impact/blob/a9e08fc0b275f244633e02618db88190826e06e5/BetterGenshinImpact/GameTask/AutoPick/AutoPickTrigger.cs#L316-L474) | 拾取键定位、相对 ROI、干扰图标排除、文字边界与两条 OCR 路径 |
| [AutoPickAssets.cs](https://github.com/babalae/better-genshin-impact/blob/a9e08fc0b275f244633e02618db88190826e06e5/BetterGenshinImpact/GameTask/AutoPick/Assets/AutoPickAssets.cs) | 按画面尺寸加载拾取键资源，支持自定义键 |
| [TextRectExtractor.cs](https://github.com/babalae/better-genshin-impact/blob/a9e08fc0b275f244633e02618db88190826e06e5/BetterGenshinImpact/GameTask/AutoPick/TextRectExtractor.cs) | 灰度、二值化、形态学和列投影，估计连续文字右边界 |
| [OcrFactory.cs](https://github.com/babalae/better-genshin-impact/blob/a9e08fc0b275f244633e02618db88190826e06e5/BetterGenshinImpact/Core/Recognition/OCR/OcrFactory.cs) | `Paddle` 是可插拔 OCR 门面；默认模型注释为 PP-OCRv6 |
| [PaddleOcrService.cs](https://github.com/babalae/better-genshin-impact/blob/a9e08fc0b275f244633e02618db88190826e06e5/BetterGenshinImpact/Core/Recognition/OCR/Paddle/PaddleOcrService.cs#L170-L257) | 无检测路径直接调用识别模型；完整路径先检测文字框再识别 |

## 自动拾取实际做了什么

1. `OnCapture` 首先在当前画面查找拾取键。没有找到时不进入物品文字 OCR；另有滚轮图标分支。这里的锚点是已知界面图形，不是让 OCR 先读全屏。
2. 找到键后，使用本次运行环境的 `AssetScale` 和配置偏移计算 `iconRoi`、文字 `textRect`。局部区域先查聊天图标，未找到再查设置图标；白名单模式下干扰图标直接优先拒绝，其他模式结合配置决定是否继续。这不是无条件对所有疑似图标拒绝。文字 ROI 越界时返回。
3. 在文字区域顶部少量像素计算 Sobel 梯度，检测拾取动画中的不稳定状态并跳过。该判据专属于此界面，不能照搬阈值判断 HOK 浮层。
4. `Yap` 配置走专用推理；另一条路径使用 `TextRectExtractor`。提取器假定文字从左侧开始、向右连续，默认灰度阈值 160，腐蚀一次、膨胀两次，按列投影遇到连续空列超过 30 时结束。
5. 边界有效（`X < 20`、宽高均大于 5）时裁到右边界并留少量余量，调用 `OcrWithoutDetector`；边界无效才对已经缩小的 `textMat` 调用带检测 OCR。它没有回到整张截图重新检测。

以上步骤对应 [AutoPickTrigger](https://github.com/babalae/better-genshin-impact/blob/a9e08fc0b275f244633e02618db88190826e06e5/BetterGenshinImpact/GameTask/AutoPick/AutoPickTrigger.cs#L316-L474) 与 [TextRectExtractor](https://github.com/babalae/better-genshin-impact/blob/a9e08fc0b275f244633e02618db88190826e06e5/BetterGenshinImpact/GameTask/AutoPick/TextRectExtractor.cs)。源码说明的是输入约束与推理路径，不能证明 HOK 准确率或延迟。

## HOK 应复用的方法与不应复制的假设

| 对象 | HOK 已有基础 | 最小适用改进 | 验证边界 |
|---|---|---|---|
| 时间、击杀、经济、塔数 | `gameCapture.ts` 的归一化字段框；`gameDataRecognition.ts` 裁图；常驻数字 OCR | 保留导播确认的顶栏/字段校准，逐字段检查格式、置信度、新鲜度与独立观测；失败结果不写复用缓存 | 未有多分辨率锚点标注前，不声称已实现自动顶栏定位；不因单个时间区域失败停掉清晰字段 |
| 选手 ID | `locateBadgeLabel`、多语言裁图、`solvePlayerSlotCandidates` 当场名单匹配 | 继续局部识别与名单约束；近似名字保留候选/人工确认，不能取最近名字就自动确定身份 | 名单不是补造图中不可见字符的依据 |
| 英雄头像 | 现有独立头像识别管线 | 为元流辅助/孙尚香建立真实裁图独立回归，保留相似度差距和歧义拒识 | 不用数字 OCR 修头像错误；原画/模板自测不等于真实 BP 皮肤/光效样本 |
| 中立资源图标 | 分开的资源 ID、累计数与存活状态 | 图标身份走图像匹配，已确认身份旁的可见累计数走数字 OCR | 没有分类证据不把总计分给某一资源；动画/倒计时不是击败次数 |
| 远控覆盖提示 | Windows 与独立 ADB 采集入口 | 同段正常/遮挡/恢复原始帧先定位污染来源；干净来源优先进入相同字段识别 | 被浮层真正遮住的像素无法靠换 OCR 引擎恢复；不得猜填后播出 |

这些是对 HOK 的工程判断，并非 BetterGI 对本项目的保证。HOK 的红蓝经济字、细冒号、`k` 后缀及观战动画与 BetterGI 的白色单行文字不同。照搬灰度阈值/腐蚀/空列阈值可能删除有效笔画；保留原裁图作为对照，只有同批标注样本指标改善才启用预处理。局部失败回退也应有次数/耗时上限，不能对相同失败图片反复排队。

本轮首先修复 `hudOcrCache.ts` 的证据语义，而不是替换引擎：复用一次成功识别结果属于减少计算，不能成为第二次独立观测；低置信度/空文本应允许下一次真正 OCR 重试。像素指纹、来源/校准/局数隔离与逐字段发布时间必须一起检查，单纯缩短 4 秒 TTL 不能解决根因。

## PaddleOCR：可选对照，当前不新增依赖

BetterGI 当前项目是 .NET Windows 程序，项目文件引用 ONNX Runtime/DirectML；其 Paddle 服务以独立检测/识别模型工作。这与 HOK 的 Node + Tesseract.js + Sharp 部署不同，不能把 BetterGI 的 DLL/服务直接当作无成本替代。[项目文件](https://github.com/babalae/better-genshin-impact/blob/a9e08fc0b275f244633e02618db88190826e06e5/BetterGenshinImpact/BetterGenshinImpact.csproj)、[模型服务](https://github.com/babalae/better-genshin-impact/blob/a9e08fc0b275f244633e02618db88190826e06e5/BetterGenshinImpact/Core/Recognition/OCR/Paddle/PaddleOcrService.cs)。

| 核查项 | 结果与决策 |
|---|---|
| BetterGI 代码许可 | 固定提交的 [LICENSE](https://github.com/babalae/better-genshin-impact/blob/a9e08fc0b275f244633e02618db88190826e06e5/LICENSE) 为 GPL v3。本文记录思路与链接，没有复制其代码、模型或素材进入 HOK；如以后直接移植，需另做许可证兼容核查。 |
| PaddleOCR 代码许可 | 核查提交 [`dab3fe35379033fdcb2d0e9572fac0b36c9a9ebf`](https://github.com/PaddlePaddle/PaddleOCR/blob/dab3fe35379033fdcb2d0e9572fac0b36c9a9ebf/LICENSE) 的 LICENSE 为 Apache 2.0。不能据此推定任意第三方转换权重和训练样本均同许可。 |
| 候选模型许可 | 官方 [PP-OCRv5_mobile_rec 模型卡，固定版本 682f20538d8c086cb2128e5cfac775e6c4904e85](https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_rec/blob/682f20538d8c086cb2128e5cfac775e6c4904e85/README.md) 声明 Apache 2.0，提供仅识别单行文字的 `TextRecognition`。如试验，应锁定权重/字典校验值及该模型卡；本轮没有下载或分发权重。 |
| Windows 成本 | 官方安装页要求兼容的 64 位 Python、x64 架构及相应运行环境；CPU 与 GPU 包分开，GPU 还需匹配 CUDA，默认包涉及 AVX/MKL。Python 路线会增加独立环境、进程生命周期、模型下载/离线打包与版本固定；ONNX 路线则需要转换后的模型/字典和运行时校验。不能只统计模型文件体积。 |
| 比较方式 | 先使用现有七字段和 ID 的相同 PNG 裁图、相同 ground truth、相同发布门限；分开统计冷启动、热推理、RSS、部署容量、每字段准确率/拒识率/错误发布及恢复延迟。先试 CPU 本地识别，不把云端结果或引擎宣传数据混入。 |

安装环境依据：[PaddlePaddle Windows 官方安装页](https://www.paddlepaddle.org.cn/documentation/docs/en/install/pip/windows-pip_en.html)（2026-11-08 查阅）；软件拆分依据：[PaddleOCR 固定版本快速开始](https://github.com/PaddlePaddle/PaddleOCR/blob/dab3fe35379033fdcb2d0e9572fac0b36c9a9ebf/docs/quick_start.en.md)。不同页面示例版本并不完全相同，未来试验要选定并实际安装验证组合，本文不提供“已经验证可用”的安装承诺。

## 实测素材和结论限制

现有 [GHUD 验证记录](../validation/ghud-adb-objectives.md) 已有雷电 1920×1080 的短样本，Windows PrintWindow 看见远控覆盖而 ADB 未见；它不是同步的浏览器/ADB 三阶段对照，也没有覆盖长时间运行或真实断线恢复。约 0.63 帧/秒的旧测量不能证明这次机器负载下的实时性能。

最低补样清单：同一操作的 Windows 浏览器原始帧与 ADB 原始帧（正常、浮层完整遮挡、解除后各阶段，带源时间/尺寸/校准）；逐帧七字段人工真值与不可见标记；至少一次 ADB 断开/恢复；元流辅助和孙尚香在实际 BP 同槽位/尺寸下的裁图；容易混淆的当场选手名单与裁图；可明确归类的资源图标及累计数字。真实赛事录像与模拟器观战样本分组，合成遮挡只用于防护回归，不能记作真实浮层准确率。

验收应以最终发布事件为准：遮挡期间错误数字发布次数为 0，清晰字段可继续更新，解除后记录恢复用了几帧/几秒，人工冻结在主动恢复前不变。没有完整标注数据时，回放工具可以验收数据通路和明确故障，但不能给出整场识别正确率或“已解决所有遮挡”的结论。

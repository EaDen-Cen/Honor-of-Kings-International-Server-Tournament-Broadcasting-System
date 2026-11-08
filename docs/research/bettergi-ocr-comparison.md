# BetterGI 视觉识别方案研究与 HOK OCR 稳定性改造建议

> 研究日期：2026-11-08。分析对象：[BetterGI](https://github.com/babalae/better-genshin-impact) 的公开源码，不代表对其所有任务的定量可靠性验证。HOK 没有从 BetterGI 复制代码或模型资源。

## 可靠性的来源不只是 OCR 模型

1. **明确的捕获层。** BetterGI 提供多种 GDI/DXGI 截图路径；业务层应使用经过校准的游戏区域而非把桌面或远程控制弹窗当作有效游戏帧。HOK #112 已有 ADB 本地采集，但仍须验证帧率、延迟和不同实例。
2. **先找目标再识别。** BetterGI 的 `RecognitionObject` 有 RegionOfInterest、参考画布大小、模板匹配、颜色阈值及文字筛选；`MatchTemplateHelper` 提供阈值、掩码与重复结果抑制。HOK 应先确定正确 UI 元素的位置和版式，再对数字做 OCR。比 OCR 引擎品牌更重要的是避免截错区域。
3. **把有框文字检测与无检测的单行 OCR 分开。** BetterGI 的 `IOcrService` 区分 `OcrResult` 与 `OcrResultWithoutDetector` / `OcrResultLinesWithoutDetector`。对已精确裁剪的数字 HUD，可跳过通用文字框检测，直接批量识别；对于不确定位置的名字/界面，仍需检测和定位。
4. **复用已加载的离线模型。** BetterGI 当前源代码以 PP-OCRv6（Paddle OCR + ONNX Runtime）作为默认的可插拔 OCR 实现；识别线程/模型实例由专门组件管理。其识别器的 `Rec.Run(Mat[] srcs)` 使用批次推理，不为每个裁图反复加载模型。
5. **时间上核实。** `TemplateMatchStabilityDetector` 在降采样图上判断帧相似度，避免在过渡画面上采取动作。阈值和连续帧要求必须依据 HOK 素材重新校准，不能直接复用 BetterGI 的 0.98 / 2 帧常量。
6. **多种视觉能力组合。** 模板匹配适合已知按钮、图标和头像，OCR 适合文字、时间及经济，颜色/形态判断适合状态指示。不能只换成 PaddleOCR 就期待所有 BP 英雄、资源图标也得到改善。

上游源码：
- [OCR 接口](https://github.com/babalae/better-genshin-impact/blob/main/BetterGenshinImpact/Core/Recognition/OCR/IOcrService.cs)
- [PP-OCRv6 注册](https://github.com/babalae/better-genshin-impact/blob/main/BetterGenshinImpact/Core/Recognition/OCR/PpOcrV6Service.cs)
- [批量识别](https://github.com/babalae/better-genshin-impact/blob/main/BetterGenshinImpact/Core/Recognition/OCR/Paddle/Rec.cs)
- [识别对象与 ROI](https://github.com/babalae/better-genshin-impact/blob/main/BetterGenshinImpact/Core/Recognition/RecognitionObject.cs)
- [模板匹配](https://github.com/babalae/better-genshin-impact/blob/main/BetterGenshinImpact/Core/Recognition/OpenCv/MatchTemplateHelper.cs)
- [稳定帧判断](https://github.com/babalae/better-genshin-impact/blob/main/BetterGenshinImpact/Core/Recognition/OpenCv/TemplateMatchStabilityDetector.cs)

## HOK 当前能力与差距

| 链路 | 现状 | 优先补足 |
| --- | --- | --- |
| 游戏截取 | Window/共享捕获与可选雷电 ADB；ROI 可校准 | 精确画面几何、远控遮挡证据、重连后校准失效 |
| 英雄 BP | 本地头像匹配+锁定时序+人工覆盖 | 元流多形态、混淆矩阵、不同 UI 模板分类 |
| Player ID | 常驻 Tesseract 中英 worker、裁图预处理 | 角色 ID 检测/定位、背景分离、已知名单约束 |
| 实时 HUD | 独立数字 OCR worker、白名单、单次批量、两次读取审核 | 多引擎可切换基准、遮挡/过渡帧分类、数字置信度校准 |
| 实时源 | #112 的 ADB PNG screencap 短时约 0.6 fps | 连续视频帧路径及 P95 端到端时延实测 |
| OCR 反馈 | 失败与候选人工审核 | 匿名化错误原因分布、按设备/ROI/主题/分辨率的准确率 |

## 本轮已实施的低风险修复

`server/hudOcrCache.ts` 原本可能把低置信度或空白的 OCR 答案缓存四秒，导致遮挡刚消失仍重复出现旧候选。本轮仅对非空且 >= 0.85 的识别结果启用短期相同裁图缓存；低可信结果下一次采样会重新推理。未放宽原有服务端双帧门槛、人工冻结和时钟连续性检查。该改动**不是**解决 OCR 根本准确率的证明。

## 后续建议：基准驱动的识别升级

**P0：建立真实截图回归集（需用户授权和现场素材）**

- 分别采集 BP、数字 GHUD、选手 ID、赛后页面；对每张图人工标注正确答案。
- 至少包含不同模拟器分辨率、红蓝方、低帧率、遮挡、压缩、元流形态以及 10k/100k 经济等困难样本。
- 尽量只收集必要 ROI；不自动向远程 AI 或 GitHub 上传截图、用户账号或选手隐私。
- 输出准确率、误报率、拒识率、P50/P95 延时、CPU/内存、以及每次有效识别成本。将“拒识而不乱报”视为可靠性的关键指标。

**P1：可插拔引擎 A/B**

- 不依赖桌面 UI，在识别服务接口后增加可选的独立 PP-OCRv6/ONNX 实验适配器，原有 Tesseract 不移除。
- 精确数字 ROI 走 detector-free 数字识别；不可靠的整页文本先定位再识别。
- 本地启动预热，批处理、背压、超时、缓存按源/实例/尺寸/校准绑定；推理异常回到 Tesseract 或人工。
- 禁止未经验证的 Paddle 输出覆盖人工确认、历史比分或比赛状态。
- 先用离线实测证明其收益，再选择默认引擎；模型安装、磁盘占用、许可及 Windows 部署独立评估。

**P2：多模态证据融合**

- 图标匹配（英雄/资源）、时间数字、同一 UI 页面的定位证据、时间序列一致性共同决定候选可信度。
- 检测遮挡或 HUD 切换导致的视觉布局异常时拒绝发布，而非仅提高 OCR 重试次数。
- 继续以 MatchState 单一权威状态 + ACK / 人工纠错为核心，不自动写入未经确认的数据。

### 许可证边界

BetterGI 上游为 GPLv3。这里只研究公开实现思路，没有移植其 C# 源代码、资源、模型权重。引入任何第三方 OCR 模型/包前应检查各自许可证及再分发条件；不要将 BetterGI 源码直接粘贴到现有项目。

### 未验证的事项

本轮没有在你的实际 Windows/雷电/OBS 设备上跑比较基准，没有声称 PP-OCRv6 对王者荣耀数字一定优于 Tesseract，也没有改动 HOK 默认 OCR 引擎。

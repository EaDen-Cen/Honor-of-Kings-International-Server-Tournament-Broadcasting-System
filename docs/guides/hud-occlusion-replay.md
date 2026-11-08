# OCR 遮挡回放与逐字段核验

本轮沿用本地 Tesseract、16:9 内容校准与七字段裁图，不引入云端默认识别或 PaddleOCR 依赖。BetterGI 的源码依据和许可边界见 [研究记录](../research/bettergi-vision.md)。当前改进是失败缓存、独立观测和逐字段保留，不宣称完成自动顶栏锚点检测或中立资源图标分类。

## 操作变化

- 空文字、格式不合法或低于 85% 的结果不缓存，下一次采样重新 OCR。
- 缓存保留原识别证据 ID；同一缓存不能与自身组成“双帧”。实际裁图解码后的像素哈希相同，也不能形成独立观测。
- 时钟区域读不出时保留可信时间，其他清晰字段各自通过双帧后可以更新。人工值保持冻结，直到导播明确恢复自动。
- 导播面板显示距最后核验的秒数、拒识/重复画面/缓存原因。Overlay 只显示已核验时间，不再用最后一次 OCR 时间推算秒数；采集较慢时会呈阶梯更新，这是避免遮挡或暂停期间播出推算值的取舍。
- 切局、切源、尺寸/内容框改变或重新确认校准后重新积累证据。旧客户端无像素身份时继续采用原保守时钟核验，不能借此在遮挡时放宽更新。

成功的相同字段仍可缓存最多 4 秒。必须等到新识别证据才能再次核验，所以固定数字的新确认有时会等待缓存过期。识别准确率与更新覆盖率分别统计，不能把少播数据说成识别率提升。

## 直接运行同批 A/B

在 `vite-project`：

```powershell
npm run replay:hud:example -- artifacts/occlusion-demo
npm run replay:hud -- --manifest artifacts/occlusion-demo/manifest.json --output artifacts/occlusion-demo/report.json
Start-Process artifacts/occlusion-demo/report.html
```

示例是 **22 帧构造的文字和时钟遮挡**，不是无界趣连浮层或真实赛事验收。生成文件不会自动登记为可删产物，避免把人工保留样本清掉。

自己的逐帧标注格式：

```json
{
  "kind": "emulator",
  "frames": [
    {"file":"normal-001.png","atMs":0,"stage":"normal","expected":{"blueKills":0,"redKills":0,"gameTimeSeconds":63}},
    {"file":"covered-001.png","atMs":1500,"stage":"occluded","expected":{"blueKills":0,"redKills":0,"gameTimeSeconds":64}},
    {"file":"clear-001.png","atMs":3000,"stage":"recovered","expected":{"blueKills":0,"redKills":0,"gameTimeSeconds":66}}
  ]
}
```

使用归一化的 1920×1080 帧或 1920 宽、至少 100px 高的原始顶栏裁图。路径相对 manifest；时间严格递增；实际样本应包含每阶段多帧。可提供 `regions` 覆盖七字段校准。`expected` 由人工对照原画面标注，不要直接拿 OCR 输出当真值；未标注字段不计入准确率。`kind` 必须区分 `real-match`、`emulator`、`synthetic`，一次报告只统计同一种。

工具冻结 main `6b5abd9` 的旧缓存行为和旧时钟总闸作为基线，其他预处理/引擎相同。分别调用同一版识别管线和内存 Store，不连接运行中的比赛。JSON/HTML 给出逐字段 N、正确率、未提交率、实际提交错误数、遮挡阶段错误数、解除后首次正确提交的帧数/秒数及 P95。未提交率包含首帧、缓存、冻结和规则拒绝，不能等同字符识别失败率。

恢复帧数从第一张 `recovered` 画面起计，恢复秒数按标注采集时间计算。没有该阶段则显示未观测。P95 是文件读取→裁图→OCR→内存权威动作的离线耗时，**不包括采集、HTTP/WS ACK、浏览器渲染或 OBS**。若修复后遮挡阶段存在错误击杀数提交，命令退出码为 1；完整逐帧记录可定位错误。

## 需要补采的真实素材

本轮机器未运行雷电，不能补采。已有 2026-11-05 的 ADB 原始顶栏可以复用，但没有同一操作的 Windows/ADB 同步三阶段，不能把它当成真实遮挡闭环。

下一次实机：固定观战分辨率和内容框，同时保存 Windows 实际捕获源与 ADB 的原始帧及时间戳；录制正常、开启无界趣连并出现提示、提示解除三个阶段。另测断开 ADB 后重连，记录首张有效帧与重新核验时间。已有入口 `npm run benchmark:adb -- --output <目录> --device 0 --samples 30 --regions <七字段JSON>` 测 ADB；Windows 路径应保存实际浏览器捕获流，PrintWindow 截图不能代替该路径。

还缺：真实赛事遮挡录像、元流辅助被误认成孙尚香的原始槽位裁图与邻近帧、分类中立资源图标及击败样本、多分辨率/100k 经济素材。当前元流辅助独立回归使用压缩/变色模板图，标为合成；当场名单匹配和歧义候选沿用现有选手识别流程。缺少图标依据时资源类型仍由人工确认，不用 OCR 猜英雄或资源类别。

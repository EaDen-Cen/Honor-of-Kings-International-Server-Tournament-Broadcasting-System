# 导播操作确认、采集上传与队伍资料传输（2026-11-10）

本轮从 main `a6a1af1` 开发。#115 的空间维护和逐字段 OCR 已合入 `29d2212`。当时唯一开放的 #116 已按原提交合并，涉及两名英雄的图片资料。合并前本机运行 `npm run hero:validate` 和英雄同步测试，120 个国际服英雄的映射、引用和本地图片校验通过，26 项测试通过。#116 的两个工作流在合并时显示 `action_required`，随后均以 `failure` 结束。GitHub 返回的任务列表为空，无法从运行日志判定原因。[Broadcast system checks](https://github.com/EaDen-Cen/Honor-of-Kings-International-Server-Tournament-Broadcasting-System/actions/runs/42697087431) · [Hero data sync](https://github.com/EaDen-Cen/Honor-of-Kings-International-Server-Tournament-Broadcasting-System/actions/runs/42697087458)

## 在导播机上测量

打开 Control，执行一次 BP 或比分操作，在「帮助 → 操作指南 / 版本」打开的「操作指南与诊断」面板查看最近一次从本页发送到服务器确认的毫秒数。计时包含浏览器发送、网络往返、服务器处理、落盘和接收确认。识别图片通过单独的 HTTP 请求提交，可在浏览器开发者工具的 Network 中查看 `/api/recognize-frame` 的请求大小、等待响应时间和下载时间。比较同一帧、相同选框、相同候选范围，分别记录本机和远程连接。

| 想测的操作 | 对应请求 | 记录什么 |
|---|---|---|
| GHUD 采样 | `/api/v1/recognition/live-hud` | 面板显示的采样总耗时、请求类型和字节数。首帧使用 JSON。 |
| 队伍资料导入 | `/api/team-presets/transfer/preview`、`/api/team-presets/transfer/import` | 分别记录预览与确认的上传量和等待响应时间。 |
| 选手照片或队标 | `/api/uploads/player-portrait` | 记录 POST 上传耗时和预览是否又发起 GET。PNG/WebP 在当前编辑窗口可就地预览，刷新后会读取服务端文件。 |

## 比赛操作

原先每次操作都会深拷贝整份存档，包括延迟播出的旧事件和 Undo 历史。现在只深拷贝本次可修改的比赛状态，复制历史数组时复用只读条目。Undo 取出历史状态后再复制，后续编辑不会改写已有记录。仍须写完临时文件、同步到磁盘并替换存档，服务器才广播新 revision 并返回 ACK。

在 `vite-project` 运行 `npm run benchmark:action-ack`。它在本机回环地址启动独立服务，使用临时存档，依次发送比分操作，每次核对收到的 revision、ACK 编号和磁盘状态。要对比两个版本，可将另一份已安装相同依赖的 `vite-project` 目录作为参数传入同一脚本。

在同一 Windows 主机上依次运行 main `a6a1af1` 和优化版本，每组预热 8 次再测量 40 次，使用一个 Control 连接；每次收到 ACK 后立即读盘验证 revision、操作编号和完整状态。空档表示起始状态，后续比分操作会逐条产生历史。

| 初始存档（构造数据） | main P50 / P95 | 优化后 P50 / P95 |
|---|---:|---:|
| 0 个事件、0 个 Undo，2,293 B | 8.00 / 12.98 ms | 6.50 / 9.98 ms |
| 600 个事件、200 个 Undo，1,833,674 B | 29.31 / 36.67 ms | 15.16 / 21.36 ms |

较大存档的 P95 降低约 42%。这是回环 WebSocket 的实测结果，使用合成历史和同一台机器的磁盘。

## BP 图像

圆形 Ban 的英雄区域与锁定标记区域相同，浏览器现在只编码并上传一次。方形 Pick 继续单独上传下方的锁定标记区域。BP 和最终阵容识别可要求服务端省去与输入完全相同的预览，浏览器直接使用本地原图；不同的预览照常返回。旧版客户端仍收到完整预览。

取同一张 72×72 的仓库头像和一个候选英雄，通过真实 HTTP 入口比较序列化 JSON 字节数。以下数字不含 HTTP 头和 TLS 开销。

| 圆形 Ban | 原协议 | 优化后 |
|---|---:|---:|
| 请求 | 46,106 B | 23,100 B |
| 响应 | 23,205 B | 178 B |

两次响应的识别结果相同。运行 `npm run test:e2e -- e2e/broadcast-update.spec.ts -g "Ban recognition sends one crop"` 可复现该组数据。

本轮尚无现场公网、隧道、OBS 并发或用户日常比赛存档的计时。存档较大时，每次确认仍需序列化并写入完整 JSON；图像识别的采集和推理耗时也需计入现场等待。

## GHUD 远程采样

浏览器先用 JSON 采样。实时识别接口成功回应并声明支持 gzip 后，非回环连接上至少 8,192 个字符的请求可在浏览器内压缩。仅在压缩后更小时才发送 gzip。小样本和本机回环使用原协议。服务端对传输体和解压后的内容分别执行 5 MiB 限制，继续校验控制权限、本局上下文与校准区域。

在 Chromium 用同一批 30 帧已有模拟器顶栏样本逐帧裁出七个 PNG。原始 JSON 共 1,155,820 B，gzip 后为 850,840 B，减少 26.39%。30 份请求解压后均与原始 JSON 逐字节相同。序列化加压缩的 P95 为 2.00 ms，服务端解压 P95 为 2.57 ms。该测量只覆盖请求编码、大小和解压。实际 ADB 抓帧、OCR 推理和公网总耗时需单独测量。

在 `vite-project` 运行 `node --import tsx scripts/benchmark-hud-upload.ts "<样本目录>"`，输入宽 1920 像素且包含七个校准区域的完整帧或顶栏图片，文件命名为 `hud-*.png`。

## 队标与选手照片

服务端完整解码验证 PNG/WebP 并保存原始文件。上传成功后浏览器可直接预览刚选择的同一份文件。刷新、其他终端与 Overlay 继续使用持久化图片地址。JPEG 会校正 EXIF 方向并重新编码，客户端预览服务端保存的结果。

在 Windows 上使用仓库图片和本机 HTTP 上传处理器，预热一次后计时 9 次。下表计时包含 POST 到预览所需网络数据收齐，不包含浏览器绘制。

| 输入 | 原 P50 / P95 | 优化后 P50 / P95 | 上传成功后再下载的预览 |
|---|---:|---:|---:|
| PNG，3,750,317 B | 39.54 / 41.01 ms | 28.87 / 31.35 ms | 3,750,317 B → 0 B |
| JPEG，3,700,247 B | 125.72 / 130.58 ms | 129.62 / 138.21 ms | 两者均为 707,966 B |

本轮 JPEG 实测稍慢，上传文件字节数没有变化。复测命令为 `npm run benchmark:portrait-upload -- --baseline "<旧版 vite-project 目录>" --rounds 9`。

## 队伍资料导入

预览和确认原来都要上传资料包并验证图片。新版 Control 在预览时上传一次。服务器限时保留一份已校验数据，确认操作只提交预览编号和冲突处理方式。编号与 Control 凭据绑定，五分钟内可使用一次。队伍库变化或服务器重启后需重新预览。最终写入前仍会执行原有备份。

用仓库中的六张图片打包一支队伍（队标与五名首发），资料包大小为 267,419 B。相同队伍 ID 选择跳过，两个版本都跳过一支队伍，写入图片数为零。预览加确认的两次 JSON 请求体合计由 534,878 B 减到 267,521 B，单独的确认请求由 267,448 B 减到 70 B。预热后交错测量六次，本地校验和确认合计 P50 从 16.68 ms 降至 8.59 ms。该组计时不含网络、备份或新增队伍落盘。

## 本地回归

生产构建、核心格式检查通过。Lint 为 0 错误，AudienceVoteView 保留 2 条既有 Fast Refresh 警告。完整单元和服务测试 418 项通过、2 项私人样本跳过。两组定向 Playwright 各通过 15 项，覆盖 BP/阵容识别、ACK、导入预览确认、PNG/JPEG/WebP 上传、刷新、GHUD 权限和压缩请求、Overlay 同步。

在同一 Windows 工作区运行完整 `npm run test:e2e`，124 项全部通过，用时 17.5 分钟，0 跳过。用例包括正常 BP、BO7 盲选和断线重连、延迟 Caster、照片上传与 Undo，以及网页投票满 180 秒后拒收新票。隧道同步的 PowerShell 契约测试使用模拟网络通过。持续集成状态随提交更新。[性能 PR 与检查结果](https://github.com/EaDen-Cen/Honor-of-Kings-International-Server-Tournament-Broadcasting-System/pull/117/checks)

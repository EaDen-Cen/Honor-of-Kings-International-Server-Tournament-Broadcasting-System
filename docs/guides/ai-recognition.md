# AI 辅助识别（实验功能）

## 配置与安全

在本机 Control → 设置中心 → AI 识别，选择服务商、视觉模型和独立 API Key。OpenAI-compatible 厂商不代表所有模型都支持视觉。默认关闭；配置现在加密保存在 `data/secure-settings.json`，Windows 使用当前用户 DPAPI，重启自动加载。GET、比赛存档、Overlay 和日志不返回密钥。

支持最多 10 个配置；保存时设为默认，并可选择另一份作为备用。非敏感参数更新省略 Key 会沿用同一完整网关的已存密钥，更换网关不会携带旧 Key。默认请求失败时在原有总截止时间内尝试备用，不延长实时识别时限；主请求耗尽时限时仍回退本地。连接测试会实际调用当前默认视觉模型，可能产生费用。温度 0 与输出上限保持识别管线的固定安全参数，不开放任意生成参数。

非 Windows 部署须提供 32 字节随机数的 base64 `HOK_CONFIG_KEY`，使用 AES-256-GCM 加密；程序不会生成一个与密文放在一起的明文主密钥。解密失败保留原文件并禁止覆盖，应恢复原 Windows 用户/原加密环境；不能在另一台电脑直接使用 DPAPI 密文。已有 `.env` 不被改写，OBS 仍可从环境变量初始化。退出前确认设置页面保存成功。

同一服务商且同一完整接口地址省略 apiKey 可沿用；切换接口/服务商会清除旧密钥，避免误发。API 显式传空字符串可清除密钥。Custom 仅允许无查询参数的公共 HTTPS；实际建连 DNS 查验拒绝内网/保留地址，不跟随重定向，响应上限 64 KiB。

## 识别与采用规则

- 本地结果立即返回，云端只后台补充。全系统一个云端请求，无排队；最短间隔 1200 ms、全流程超时 1800 ms，429/5xx 冷却 10 秒。
- 相同图像、任务、比赛版本和字段命中才复用云端结果；有效期 4 秒、最多 80 条。配置/权威状态变化取消请求并清缓存。取消与配置代次检查共同阻止迟到结果写回。
- 英雄仅接受当前英雄池中的整数 ID、有限置信度 0.9–1；采用分数封顶 0.95。强本地结果保持不变；可信冲突（本地 >=0.65）保持本地结果。原有锁定图、稳定帧、Ban/Pick 阶段和自动采用阈值继续生效，AI 不能制造锁定或跳阶段。
- 玩家逐裁图转录，必须与该侧真实名单完全一致，继续由全队一一映射和原有连续采样校验决定是否更新位置。
- GHUD 七字段逐项经过原有数字范围/时间/单位解析。人工冻结、两帧一致、时钟推进和异常跳变检查不变。两次 AI 缓存答案不能独立构成两帧证据，至少要本地识别参与核验。
- 赛后单字段和结算页面数字通过原有 metric 解析；行身份和人工核验/采用流程继续保留。AI 不自动确认 MVP、字母评级、曲线或比赛胜负。
- 多裁图按可用配额逐项补充，不宣称单次云端调用覆盖整页。变化很快、没有重复出现的画面可能永远拿不到云端结果；保持本地输出。
- 原先原文 `ai.text` sidecar 已移除，避免把未经校验的模型文字当作结构化比赛状态。

## 本机开发代理与 403 排查

- 浏览器在 Vite 开发页 `http://127.0.0.1:5173` 对后端 `127.0.0.1:3001` 发起 POST/PUT 时，代理可能保留 `Origin: http://127.0.0.1:5173` 但采用 API 端口作为 `Host`。旧版只允许 Origin/Host 完全匹配，导致 `AI 效果对比实验室` 返回 403 `Local Control only`，即使本机 GET `/api/access` 报告 `local: true`。
- 后端仅在非 production 模式，允许本机 socket、loopback Host:3001 与 HTTP loopback Origin:5173 这一组 Vite 代理来源；Vite 启用固定 5173 端口（`strictPort`）。所有具有本机权限要求的路由统一使用这一来源检查。正式生产模式仍要求原有 Origin/Host 匹配。
- Control Token 权限检查照旧；远程 IP、Cloudflare/Forwarded 标记、公网 Host、其他前端端口及 HTTPS 不匹配来源仍拒绝。**不要删除本地来源检查，也不要将 API 密钥写进仓库。**
- 回归验证：在本机 Vite 页面调用 `GET /api/access?role=control` 应返回 `local: true`；已授权 Control 对 `POST /api/v1/ai-recognition/evaluate` 发送空 JSON `{}` 应返回 400 `Invalid evaluation sample`，而非 403。空样本不会触发云端 AI。完成这一步后，再用真实裁图测试模型与延迟；403 修复不表示第三方 API 已验证成功。

## API

`GET /api/v1/ai-recognition/config` 返回公开配置及无敏感信息的 diagnostics（调度、命中、跳过、失败、取消、完成、缓存数量、busy）。

`PUT /api/v1/ai-recognition/config` 接受 `{enabled,vendor,model,endpoint,apiKey?}`。两者均只允许本机、已授权 Control。英雄实际入口为 `/api/recognize-frame` / `/api/v1/recognition/frame`；此前文档的 `/api/v1/capture/browser` 不准确。

多配置接口为 `POST /api/v1/ai-recognition/profiles`（`id? / name / enabled / vendor / model / endpoint / apiKey?`）；`PUT` 选择 `{activeId,backupId}`；`DELETE` 删除 `{id}`；`POST /api/v1/ai-recognition/test` 验证默认模型。公开响应只有 configured 标记，不含 Key。

HUD 未变化裁图在本地复用最多 4 秒 OCR，变化字段仍合成一个 OCR 批次；独立工作器、比赛上下文、校准和重置隔离缓存。缓存复用不跳过发布校验。

## 验证与边界

### 模拟器配对评测

打开 `/tools/bp-simulator-control` 的「AI 效果对比实验室」。先在 Control 配置并启用视觉 AI，然后上传单个英雄头像的 PNG/JPEG/WebP 裁图（每批最多 30 张），选择正确英雄及 Pick 方形 / Ban 圆形。正确答案只留在浏览器评分，不发送给模型。建议使用至少 30 张独立的真实截图，包含清晰、小尺寸、压缩和遮挡情况；暂停其他自动采集以减少共享调度竞争。

点击「开始配对评测」会使用已配置的模型，可能产生费用。后端对同一裁图执行一次本地识别，再按正式 AI 调度和冲突保护规则尝试补充：强本地结果直接保留，弱结果最多调度一次，之后仅查询缓存约 2 秒；不会发布比赛状态、重置配置或切换 OBS。忙碌、节流、超时和无效答案显示为「AI 无有效结果」，保留本地结果计入准确率。

界面展示本地/辅助准确率、提升百分点、纠正与退化数、P95 和失败数量，并导出无密钥、无原图的 JSON。请求失败不计入准确率，必须与有效样本数一同报告；停止后保留已完成样本，服务端已开始的请求可能继续短暂结束。这里仅量化英雄 Top-1 裁图识别；Player ID、HUD、赛后数字仍需对应流程验收。

辅助耗时为本地识别到观察到有效 AI 答案的总时间（约 100 ms 轮询粒度），不是实时主链路延迟。重复截图可能命中本地缓存；静态裁图不验证运动视频、锁定阶段、人工修正耗时或 OBS 端到端表现。不要把缺少真实样本和真实模型的测试当成提升结论。

`POST /api/v1/ai-recognition/evaluate` 仅允许本机 Control，接受 `{image,heroPool,shape}`，全局最多一个评测请求。使用生产 AI 调度器，不另建无限制云端队列。

`npm test` 含不访问网络的模拟服务商回归；`npm run benchmark:replay -- --iterations 100 --output artifacts/replay.json` 对现有真实截图裁图记录 P50/P95/P99、逐字段准确率和原始耗时。可用 `--fixtures-dir` 指向另一份同格式资料。

截图重复回放有利于缓存，不等于运动视频、采集到 OBS 的端到端延迟。真实付费 API、所有服务商、完整录屏和长时间 OBS 彩排仍须另行验收。详见 [验证记录](../validation/pr91-validation.md)。

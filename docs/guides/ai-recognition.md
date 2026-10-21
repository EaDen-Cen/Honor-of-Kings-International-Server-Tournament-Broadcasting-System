# AI 辅助识别 / AI-assisted Recognition

> Status: experimental, opt-in. AI currently supplements **browser hero crop recognition**. It does not automatically parse every game statistic, determine ban/pick lock states, change match phases, drive OBS scenes or replace established OCR.

## 配置
1. 在本机打开 Control → 比赛设置 → **AI 识别**。
2. 选择服务商，填入**具备图片输入能力**的模型 ID 和自己的 API Key。OpenAI、Claude、Gemini 使用各自的消息协议；DeepSeek、通义千问、豆包、GLM、Kimi、百度千帆和 Custom 目前走 OpenAI-compatible Chat Completions 适配器，**并不意味着所选服务商的每个模型都能接收图像**。
3. 保留默认 URL，或为 Custom 输入公共 HTTPS Chat Completions 完整接口地址。选择“启用”并点击“应用”。
4. 识别低置信度的英雄裁切图时，先得到本地结果，再尝试请求模型。如果 AI 返回合法 heroId 且可信度 >=0.85，则优先提供该候选；失败、限流、超时或返回不合法信息，保留本地结果。

## 安全与运行限制
- API Key 仅驻留本地 Node 服务内存；配置 GET 响应不返回密钥，状态不写入比赛存档、网页缓存或日志。**重启服务必须重新配置密钥**。请不要把密钥提交到 GitHub。
- 配置 API 只允许本地、已授权的 Control；不提供给远程 Control、解说或 OBS overlay。
- 请求 4.5 秒超时；最多一个同时进行的云端请求，实时采集不排队，不自动无限重试。模型调用消耗提供商配额/费用。
- AI 不接触回放编辑和 MatchState 的自动提交：任何英雄判定仍要遵守已有的锁定、阈值及人工确认规则。
- 只发送用户允许发送的图片裁切数据到用户选择的第三方服务商。导播有责任确认比赛画面、选手隐私和厂商处理政策。
- 已接入的路径仅为 `POST /api/v1/capture/browser` 的英雄识别（与现有路径一致）；HUD、赛后、ID OCR 目前仍使用原有本地实现。
- 没有经过真机、所有服务商账户和模型的验证。尤其国内厂商的视觉功能/端点需要按其最新文档选择正确的模型与接口。

## API
- `GET /api/v1/ai-recognition/config`：返回公开配置和 configured 标志，不包含密钥。
- `PUT /api/v1/ai-recognition/config`：JSON `{enabled,vendor,model,endpoint,apiKey?}`；仅本机带 Control Bearer token。空 apiKey 保留本进程已配置密钥。

## 验证
运行 `npm test`、`npm run build`、`npm run lint` 和 `npm run test:e2e`。在线模型和 OBS 的实机彩排必须独立完成。验证禁用 AI、无 key、错误模型、429、API 断线、超时、非法 JSON、重复识别和不同英雄池。不要在测试中使用真实付费密钥。

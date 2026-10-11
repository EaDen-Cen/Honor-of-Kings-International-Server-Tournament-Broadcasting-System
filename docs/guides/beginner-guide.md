# HOK Broadcast v1.0.0 新手上手教程

> **Release Candidate（2026-10-10）**：核心 BP / Auto BP / Player ID / 换英雄流程已进入发布准备状态。局内 HUD 目前仍是 **测试功能**，第一次使用时先把 Draft Overlay 和手动比分流程跑通，再单独彩排 HUD。

> 这份教程按“第一次接触项目也能跑起来”的顺序写。更完整的参数、部署和比赛规则见 [运行指南](getting-started.md)、[比赛操作指南](operator-guide.md) 与 [Auto BP 指南](screen-recognition.md)。

## 你会得到什么

HOK Broadcast 分成四个主要页面：

- **Control**：导播操作台，设置比赛、录入/识别 BP、确认最终阵容。
- **Caster**：给解说看的延迟 BP 信息。
- **Overlay**：给 OBS Browser Source 使用的直播图层。
- **BP Simulator**：不用进真实游戏房间，也能独立测试 选手 ID 排序 → BP 模拟 → 角色交换。

第一次建议先在一台 Windows 电脑上把 **Control + Simulator** 跑通，再接 OBS、解说和公网。

## 第 1 步：安装需要的软件

推荐 Windows 10/11。

必须：

1. 安装 **Node.js 24 LTS**。
2. 准备 Microsoft Edge 或 Google Chrome。

如果要使用一键公网地址，还需要安装 **cloudflared**，并确保在命令行执行：

```powershell
cloudflared --version
```

能正常显示版本。

## 第 2 步：下载项目

可以从 GitHub Release 下载 Source code ZIP，解压后进入：

```text
Honor-of-Kings-International-Server-Tournament-Broadcasting-System
└─ vite-project
```

也可以使用 Git：

```powershell
git clone https://github.com/EaDen-Cen/Honor-of-Kings-International-Server-Tournament-Broadcasting-System.git
cd Honor-of-Kings-International-Server-Tournament-Broadcasting-System\vite-project
```

## 第 3 步：第一次先启动 BP Simulator

双击：

```text
vite-project\start-bp-simulator.bat
```

第一次运行可能需要安装 npm 依赖，因此会比之后慢。准备完成后启动窗口会自动关闭，Simulator 在后台继续运行，并打开控制页。

两个地址分别是：

```text
控制页  http://127.0.0.1:5173/tools/bp-simulator-control
采集页  http://127.0.0.1:5173/tools/bp-simulator
```

控制页按 **选手 ID 排序 → BP 模拟 → 角色交换** 三种模式测试；采集页保持干净，给 Auto BP 抓取。

BP 自动脚本可以设置**随机等待范围**，在思考期间随机切换预选英雄，并在真正锁定前保留约 1.2 秒稳定候选窗口；锁定 cue 默认约 1.1 秒并可调。当前 Simulator 极限测试在约 1.5–2 秒选角窗口下已能稳定出结果，但真实 HOK/OBS 并发仍需赛事机彩排。

测试结束后双击：

```text
vite-project\stop-bp-simulator.bat
```

## 第 4 步：启动 HOK Broadcast

如果已经安装 cloudflared，最简单的方法是双击：

```text
vite-project\start-broadcast.bat
```

启动器会自动：

1. 检查 Node/npm/cloudflared；
2. 根据 package-lock 准备依赖；
3. 构建 Control/Caster/Overlay；
4. 启动本机服务器；
5. 启动 Cloudflare Quick Tunnel；
6. 保存公网地址；
7. 打开本机 Director Control。

公网地址会写到：

```text
vite-project\artifacts\current-public-url.txt
```

比赛结束后运行：

```text
vite-project\stop-broadcast.bat
```

如果你只想本机测试、不需要 Cloudflare：

```powershell
cd vite-project
npm ci
npm run build
npm run server
```

然后打开：

```text
http://127.0.0.1:3001/control
```

## 第 5 步：建立第一场比赛

在 Control：

1. 打开 **比赛设置**。
2. 填写蓝方、红方队名。
3. 选择 BO1 / BO3 / BO5。
4. 选择 Match BP（4 Ban）或 Normal BP（2 Ban）。
5. 选择蓝方或红方先手。
6. 如果只想手动录 BP，选择手动输入。
7. 如果要测试自动识别，选择 **屏幕识别**。
8. 保存。

第一次测试建议使用 BO1 + Match BP。

## 第 6 步：第一次配置 Auto BP

切换到屏幕识别后：

1. 点击 **选择/更换采集窗口**。
2. 选择 BP Simulator 的采集页，或真实 HOK BP 窗口。
3. 展开 **识别框校准与工具**。
4. 对蓝/红双方的 Ban 与 Pick 共 18 个框进行校准。
5. 建议进入全屏精细校准，把每个框尽量贴合头像区域。
6. 校准好后，展开 **18 框位置预设**，保存一个有意义的名字，例如：
   - `Simulator 1920x1080`
   - `赛事机 1080p`
   - `比赛直播布局`

之后只要画面布局没变，通常直接载入预设即可，不需要重新框 18 次。

识别框按窗口相对比例保存，所以单纯移动窗口或普通缩放通常不会破坏预设。

## 第 7 步：确认 P1–P5 选手顺序

屏幕识别模式会复用同一采集窗口识别双方 10 个 Player ID。赛前先确保双方 5 个 ID 已正确填写。

- 默认 ID 区域从 P1–P5 Pick 头像旁自动推导；
- 如真实 UI 不同，可在“高级：选手 ID 区域校准”微调并保存**独立 ID 区域预设**；
- 高置信度会自动同步双方顺序；
- 边缘结果会后台复核；同一排列连续出现时可做两帧一致性确认；
- 如导播手动采用/交换后想重新交给程序，点击 **恢复自动识别**。

Simulator 的 Player ID 排序测试会随机双方队内顺序并自动计时。当前最好成绩约 1.8 秒，实机时间以实际字体、缩放和机器负载为准。

## 第 8 步：开始自动识别

主操作区建议保持：

- 游戏预览；
- 当前阶段；
- 当前槽位；
- 当前候选；
- Auto Watch。

打开 **自动监视** 后，程序会持续扫描。

### Pick

普通 Pick 不会只因为“看到了英雄头像”就认为已经锁定。程序会等待下一位对手真正开始预选，用来确认上一组 Pick 已结束。

双选阶段会同时识别两个 Pick 槽。

如果游戏里已经锁定，但自动锁定判断没有触发，可以点击：

**手动确认当前最高候选**

程序会把当前扫描中相似度最高的单个英雄或英雄组打开到人工确认窗口。确认无误后再提交。

### Ban

Ban 使用圆形头像匹配，并结合锁定状态判断。

空 Ban 会等待短暂保护时间后再判断，避免选手还没操作就过早提交。

任何时候都可以使用 **空 Ban** 手动按钮。

## 第 9 步：BP 结束后确认换英雄

BP 完成以后会出现最终阵容/换英雄区域。

如果选手进行了英雄互换：

- 自动检测开启时，阵容稳定后会同步最终英雄归属；
- 也可以点击 **立即识别并应用换英雄**；
- 如果识别仍不可靠，可以直接使用每名选手旁边的下拉框人工调整。

这里改变的是“最终谁使用哪个英雄”，不会改写原本的 Pick/Ban 历史。

## 第 10 步：接入 OBS

添加 Browser Source：

```text
http://127.0.0.1:3001/overlay/draft
```

推荐尺寸：

```text
1920 × 1080
```

公网比赛应使用生成的 HTTPS 地址和独立 Overlay token。

## 第 11 步：给解说 Caster 页面

本机开发地址：

```text
http://127.0.0.1:3001/caster
```

Caster 是只读的，BP、比分和比赛进度按 Control 设置延迟；队伍、选手、赛事资料与展示配置实时更新。

注意：这里延迟的是**赛事数据**，不是视频本身。直播平台、Discord 和远程解说的视频延迟仍然需要现场测量。

## 实验功能：局内 HUD 与赛后 MVP

`/overlay/game-hud` 已能显示队伍、系列赛比分、当前局、人头、推塔与中立资源；`/overlay/mvp` 可展示赛后选中的 MVP 数据卡。

**局内 HUD 当前仍处于测试阶段**：人头/塔/资源主要由 Control 人工维护，自动读取真实游戏 HUD 尚未实现，OBS 长时间稳定性也仍需实机验收。正式比赛必须保留官方观战 UI 或人工比分作为兜底，不要把测试 HUD 当成唯一权威比分源。

## 比赛前最少做一次完整彩排

正式比赛前至少测试：

1. 完整走完一局 18 个 Ban/Pick 槽位的 Match BP；
2. 测一次双 Pick、一次空 Ban和一次 1.5–2 秒压力脚本；
3. 测一次 Player ID 队内随机排序，并确认双方自动同步；
4. 故意让自动锁定判断失败，再测试“手动确认当前最高候选”；
5. BP 完成后交换两名选手的英雄；
6. 检查 Draft Overlay 与 Caster 延迟；
7. 如准备启用 HUD，仅作为额外测试源检查，不替代官方比分；
8. 刷新 Control，确认状态恢复；
9. 停止并重新启动服务器，确认比赛数据仍在。

## 数据在哪里

主要运行数据默认保存在：

```text
vite-project\data\
```

日志和启动器生成的信息在：

```text
vite-project\artifacts\
```

18 框英雄校准预设与 10 个 Player ID 区域预设都保存在 Director 浏览器的 localStorage 中，所以更换浏览器配置、清除站点数据或换电脑前，应重新确认并重新载入/校准本机预设。

## 常见问题

### 双击 start-broadcast.bat 后提示找不到 Node/npm

重新安装 Node.js 24 LTS，并重新打开命令行或重启电脑。

### 找不到 cloudflared

如果只是本机测试，可以直接使用 `npm run server`。需要一键公网地址时再安装 cloudflared。

### Auto BP 一直识别不到

先检查：

1. 是否选择了正确的采集窗口；
2. 18 个框是否仍然贴合头像；
3. 是否载入了错误分辨率/布局的预设；
4. 游戏 BP UI 是否与校准时发生变化。

### 英雄识别正确，但一直不弹确认

如果英雄已经实际锁定，可以用 **手动确认当前最高候选** 进入人工确认，不需要为了自动锁定检测卡住整轮 BP。

### Simulator 启动后命令窗口消失了

这是正常行为。v1.0.0 开始 Simulator 会在后台运行。结束时双击 `stop-bp-simulator.bat`。

## 下一步

熟悉基本流程后再阅读：

- [比赛操作指南](operator-guide.md)
- [Auto BP / 屏幕识别指南](screen-recognition.md)
- [Windows 启动器说明](windows-launcher.md)
- [系统结构](../design/architecture.md)

## 远程登录与自动识别设置

本机直接打开 Control / Caster / Overlay，无需在网址添加密码。远程访问前，在 Control 顶栏打开“访问与网站设置”保存密码，再生成只读分享链接。Overlay 缺少凭据时会显示登录窗口。

比赛设置选择屏幕识别后展开高级项，可启用高相似度自动输入并设置 50%–100% 阈值。先使用模拟器校准；相似度不是准确率，自动输入仍等待稳定与锁定证据。

# 开发与验证

从仓库根目录进入 `vite-project`，使用 Node 24 与锁文件：`npm ci`。不要用升级依赖替代定位回归。

依次运行 `npm run build`、`npm run lint`、`npm run format:check`、`npm test`、`npm run test:e2e`。识别变更还需对应 benchmark 与私有真实样本。Windows 启动器测试命令见 `.github/workflows/broadcast-checks.yml`，测试使用隔离资料目录；不要连接正在比赛的服务。

E2E 使用 `e2e/fixtures.ts` 启动独立后端，固定 3101 端口。端口占用时应停止测试并排查，不复用或终止用户的服务。测试修改必须保持业务断言：不删除测试、不跳过失败用例、不靠增加 timeout 通过。

修改定位：比分/切局/Undo → Store；采集过期 → source generation 和 CaptureRequest；候选核验 → shared 纯函数；布局 → DockWorkspace 和面板容器；权限 → server 的统一 guard；真实接口联调 → 对应适配器。

每个阶段单独提交。PR 写明基线、根因、修改范围、实际命令与结果、设备限制、回滚方法。回滚代码可 revert 阶段提交；运行时资料恢复须停服并使用受校验的备份，不能覆盖正在运行的比赛。未经实机验证的 OBS、Discord 和识别效果必须明确标注。

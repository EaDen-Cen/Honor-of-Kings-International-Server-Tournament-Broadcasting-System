# HOK 本地存储诊断与安全自动清理

## 为什么本地文件比 GitHub 大

仓库 `vite-project/` 运行后会生成 `node_modules/`（依赖）、`dist/`（网页构建）、`artifacts/`（工具/测试日志）、`test-results/` / `playwright-report/`（Playwright 产物）及 `data/`（本地比赛资料、状态与备份）。它们多数被 `.gitignore` 排除，**不能把远端仓库体积当作本机使用空间**。

特别注意：`data/match.json` 保存权威比赛状态与操作事件，`data/backups/` 会保留最多 20 份含状态及部分图片的完整存档。它们可能比普通日志大得多；本次自动清理不会删除或压缩这些存档。

## 如何检查

在 `vite-project/` 执行：

```powershell
npm run storage:inspect
```

输出各目录的**汇总磁盘字节数**（不显示选手、比赛和隐私文件名），以及过期可清理文件的数量/大小。这只是扫描和预览，绝不删除。

手动执行相同安全策略：

```powershell
npm run storage:cleanup
```

服务端启动后约 30 秒自动执行一次，持续运行时每 24 小时检查一次；失败只写不含敏感内容的诊断事件，不妨碍比赛运行。无需在 OBS 或比赛过程中手动操作。

## 精确删除范围

仅有以下 **HOK 自动生成的测试/CI 目录**中的普通文件，在超过 14 天未修改时符合清理条件：

- `artifacts/ci/`
- `artifacts/e2e-*/`
- `test-results/`
- `playwright-report/`

每次最多清理 **500 个文件、512 MiB**；下次维护继续。符号链接不跟随，最近修改的文件不处理，遇到权限/并发写入异常跳过；空目录可尝试移除。运行时输出包含扫描、符合条件和实际删除的文件数及字节数。

**永不纳入自动清理的目录：**

- `data/`、`data/backups/`、`data/uploads/`、`data/logs/`
- `public/` 里的英雄、Logo、选手照片；构图缓存
- `node_modules/`、`dist/` 及任何源代码
- `artifacts/server.log`、`artifacts/cloudflared.log`、进程/隧道状态文件
- OBS 录制文件夹、外置 SSD、其他项目目录和任何用户自建文件夹

本地磁盘使用量如果主要来自 `data/backups` 或录像，本方案只报告占用，不会替你自动删除它们。备份的压缩/保留策略应作为独立的可回滚迁移任务设计，不能以“文件过期”为由直接删除。

## 回滚与安全

升级不会移动或修改现有比赛数据结构。手动执行前应确保已备份重要的比赛状态。自动清除的测试输出一般可以重新运行生成，但删除后的旧测试截图/trace 不可恢复；如果需要长期保留某场故障证据，应提前复制到上述清理范围之外。

源代码：`server/storageMaintenance.ts`；CLI：`scripts/storage-maintenance.ts`；测试：`server/storageMaintenance.test.ts`。

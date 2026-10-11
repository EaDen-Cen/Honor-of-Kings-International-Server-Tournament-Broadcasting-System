# 英雄数据自动同步

<!-- HERO-SYNC:STATUS:START -->
## 当前自动同步状态

- 最近同步检查：**2026-10-08**
- 程序内有效英雄：**119**
- 本次远端目录条目：**119**
- 独立英雄名单、本文状态、研究索引和 M14 状态均由同步器自动刷新。

> 这些数字只描述最近一次成功生成候选更新时的仓库状态；是否允许进入具体赛事房仍需按赛事规则人工确认。
<!-- HERO-SYNC:STATUS:END -->

[文档索引](../README.md) · [研究索引](README.md) · [程序内英雄名单](hero-roster.md)

## 目的

英雄名单不再依赖偶尔手工比对。仓库提供独立的 **Hero Data Synchronizer**，用于定期发现国际服英雄名单变化、验证候选数据并生成需要人工确认的 GitHub Pull Request。

它**不会在比赛启动时运行**，也不会让远端网页成为比赛当天的实时依赖。

## 数据源与信任边界

同步器使用两类公开来源：

1. **Honor of Kings 官方 IP 页面 / 官方资源域名**
   - 英文详情：`world.honorofkings.com/zlkdatasys/ip/hero/en/{campId}.html`
   - 繁中详情：`world.honorofkings.com/zlkdatasys/ip/hero/zh-Hant/{campId}.html`
   - 英雄图片只接受 `camp.honorofkings.com` HTTPS 资源。
2. **BitTopup 国际服英雄目录**
   - `https://wiki.bittopup.com/hok`
   - 用于发现完整名单候选、Camp ID 和推荐分路。
   - 它是辅助目录，不作为赛事资格或版本规则的唯一权威来源。

2026-09-16 的核查已经确认官网首页的展示 JSON 当时只有部分英雄，因此同步器**不会用该展示 JSON 覆盖本地完整名单**。历史证据见 [英雄数据核查](hero-data-audit-2026-09-16.md)。

## 安全规则

同步器必须遵守：

- 本项目 `Hero.id` 是稳定的本地 ID；绝不拿 Camp ID / 官网 ID 覆盖。
- 新上线英雄只会分配 `max(localId) + 1` 之后的新 ID；历史补录须人工维护 release-order 基线和迁移，不能直接追加。
- 优先按 `campId` 匹配；否则按英文名和 aliases 匹配。
- 名称变化会利用上一份来源快照保持身份，不因改名制造重复英雄。
- 每次同步都会把**所有已匹配的本地旧英雄**再次与当前远端目录核对，而不只检查“远端自上次以来发生了什么变化”。
- 全量旧英雄核对当前覆盖 `campId`、英文名和主分路；历史 alias 会被视为合法旧名，不会反复制造改名提示。
- 缺失的稳定 `campId` 可安全补齐；英文名只有在官方英雄页确认后才自动更新；分路差异只进入人工复核，不自动覆盖。
- 远端暂时找不到本地英雄时只记录 Warning，**不会自动删除**。
- 来源数量异常下降时直接失败，避免把半页/故障响应当成完整名单。
- `counter`、`combo`、`beCountered` 从不自动抓取或覆盖。
- 新英雄关系字段保持空数组并标记 `relationshipStatus: "unverified"`。
- 第三方目录的分路变化只进入人工复核，不自动改生产数据。
- 小尺寸 Hero Icon 下载到本地后检查真实 PNG/JPEG/WebP 文件头、大小并记录 SHA-256。
- Broadcast Pick Card 另外使用官方英雄详情页识别出的高分辨率 Character / Key Art，记录在 `Hero.artLink`。
- Full Art 不预裁成固定正方形；Overlay 根据卡片实际尺寸用 `object-fit: cover` 实时裁切，未来横卡/竖卡/方卡共用同一素材。
- 默认视觉焦点为 `50% 28%`；个别构图可以通过 `Hero.artPosition` 单独微调。
- 官方 Full Art CDN 加载失败时自动退回本地 `imageLink` Icon，避免比赛画面出现空卡。
- 自动任务只开 PR，不自动合并到 `main`。


## Release-order Hero ID

v1.0.0 前将当前基线的 119 个英雄/形态条目改为按国际服 **Launch Time 从旧到新连续编号**。当前编号范围为 `1..119`，ID 越大代表越晚上架；Control 的“上线时间（新→旧）”因此直接按 ID 降序，不再依赖缺失的 releaseDate 元数据。

完整规则、Flowborn 多形态、Plus 2.0 AoV 英雄同批处理和旧存档迁移见 [hero-id-order.md](hero-id-order.md)。头像资产路径与 hero ID 已解耦，不会因为重新编号再次重命名你已经整理好的 `public/heroesImg/`。

## Wang Wei 与新英雄来源回退

2026-10-08 的第一次检查其实已经发现了 `Wang Wei (campId 138)`，但当时辅助目录的 `/hok/138` 详情页返回 HTTP 502。旧实现必须先从该详情页补齐图片，因此审计记录为“Skipped new hero Wang Wei”。

现在新英雄流程改为：

1. 先查询官方 HOK 英雄页确认英文身份，并尝试读取官方中文名与 Character / Key Art；
2. 再尝试辅助目录详情页补齐 Icon；
3. 如果辅助详情页临时失败，但官方身份已确认且已有可信 Key Art，则仍可加入英雄，临时用官方远程素材作为 Picker / Overlay 图片；
4. 后续同步一旦拿到辅助目录的官方 CDN Icon，会继续下载到 `public/heroesImg/`，把英雄恢复为本地 Icon + 官方 Full Art 的常规结构。

当前已加入 **Wang Wei / 王维，release-order ID 119，Camp ID 138，Mid Lane**。关系数据保持空数组和 `unverified`，不会因为新英雄同步而自动生成 Counter / Combo。

王维官网同时提供了带装饰圆框的人物肖像和横向 Key Art。圆框肖像不再作为 UI `imageLink`，否则 Hero Picker / Ban 小头像会把金色边框一起显示。当前人工整理后的 UI 图标使用本地 `/heroesImg/120.png`；`artLink` 继续提供广播大图，`recognitionImageLink` 独立用于识别模板。注意这里的 `120.png` 是历史资产文件名，程序 hero ID 已迁移为 119。

## Panel / Side 裁切数据如何同步

Control 中“英雄数据与图片”里的 **Panel（底部横排）** 与 **Side（左右竖排）** x/y/scale，原本只有两种来源：

- 默认/少量人工源码值：`src/data/heroArtFocus.ts`；
- 导播在网页中保存后的运行时覆盖：`data/match.json -> state.heroArtOverrides`。

第二种属于运行时比赛数据，`vite-project/.gitignore` 明确忽略 `/data/`，所以它会被本机持久化和备份，但**不会自动进入 GitHub**。这也是以前一台机器调好的构图不会自然出现在另一台机器上的原因。

现在共享默认值拆到：

```text
vite-project/src/data/heroArtFocusOverrides.ts
```

这个文件受 Git 跟踪，会跟随仓库、Release 和其他电脑。要把当前导播电脑已经调好的裁切提升成项目默认值，在 `vite-project/` 执行：

```powershell
npm run hero:crop-sync
```

Windows 也可以直接双击：

```text
sync-hero-crops.bat
```

命令读取当前 `data/match.json`（设置了 `DATA_FILE` 时读取对应文件），仅提取已知英雄的 `panel` / `side` x、y、scale，合并写入 `src/data/heroArtFocusOverrides.ts`。它**不会自动 git commit/push**，也不会导出队伍、选手、比赛、访问凭据、英雄运行时数据或 `useLegacyImage`。这样可以先检查 diff，再决定哪些构图应该成为所有用户共享的默认值。

推荐流程：

```text
Control 调好英雄构图
→ 保存英雄图片
→ sync-hero-crops.bat
→ 查看 heroArtFocusOverrides.ts diff
→ commit / push / PR
→ 其他机器 pull 或下载下一版 Release
```

## 本地命令

在 `vite-project/` 中：

```powershell
npm run hero:check
```

只访问来源并打印差异，不修改仓库文件。

机器可读模式：

```powershell
npm --silent run hero:check -- --json
```

准备候选更新：

```powershell
npm run hero:sync
```

这一步可能更新：

```text
src/data/autoSyncedHeroes.ts
src/data/heroSyncOverrides.ts
public/heroesImg/
../research/hero-sync/catalog-snapshot.json
../research/hero-sync/YYYY-MM-DD.json
../docs/research/hero-roster.md
../MILESTONES.md
../docs/research/README.md
../docs/research/hero-sync.md
```

完成后执行：

```powershell
npm run hero:validate
npm run build
npm test
npm run lint
```

## 自动任务

`.github/workflows/hero-data-sync.yml` 每周运行一次，也可以在 GitHub Actions 中手动触发。

流程：

```text
Fetch catalog
    ↓
Compare with local roster + previous source snapshot
    ↓
No change ──────────────→ End
    ↓
Change detected
    ↓
Generate candidate data/assets/audit + refresh managed documentation
    ↓
Validate → Build → Tests → Lint
    ↓
Open/update automation/hero-data-sync PR
    ↓
Human review
    ↓
Merge
```

第一次运行如果还没有 `catalog-snapshot.json`，会把建立来源基线本身视为一次变化并创建 PR。合并该基线后，后续任务才能准确识别目录中的改名、分路和图片变化。

## Icon 与 Full Art 的分工

英雄视觉资源拆成两层：

```text
imageLink
→ 小尺寸本地 Icon
→ Hero Picker / Ban / Draft History / Full Art fallback

artLink
→ 官方高分辨率 Character / Key Art
→ Broadcast Pick Card
```

Overlay 不再假设“正方形头像就是最终素材”。卡片只负责定义自己的尺寸，浏览器自动按容器比例裁切完整角色封面：

```css
width: 100%;
height: 100%;
object-fit: cover;
object-position: 50% 28%;
```

因此以后 Side、Panel 或新的赛事 UI 改成长横卡、窄竖卡或方卡时，不需要重新抓取对应比例的英雄头像。同步器会优先从官方英雄详情页中、皮肤展示区域之前的 Hero / Cover / Character / Key Visual 候选寻找主角色图，并排除 skin、skill、icon、logo、QR code、avatar 等小图。

## 生成文件的职责

- `additionalHeroes.ts`：保留 2026-09-16 人工核验过的历史新增记录。
- `autoSyncedHeroes.ts`：今后同步器发现并加入的新英雄。
- `heroSyncOverrides.ts`：对既有英雄进行安全的名称/图片等显示元数据覆盖。
- `HeroList.tsx`：组合历史英雄、人工新增英雄、自动新增英雄与安全 override。
- `research/hero-sync/*.json`：来源快照和每次候选更新的审计证据。

即使 override 更新了英雄名称或图片，人工维护的关系数组仍由原记录提供，不被自动同步器替换。

## 仍需人工判断的内容

自动化不能证明：

- 某英雄是否允许进入当前赛事自定义房；
- AoV 联动英雄是否在特定比赛规则下可用；
- Flowborn 不同形态在实际赛事房间中的互斥规则；
- Counter / Combo 是否仍适用于当前版本；
- 第三方目录给出的分路是否应成为赛事默认分路。

这些变化会保留为审计信息或 PR 警告，由赛事管理员确认。

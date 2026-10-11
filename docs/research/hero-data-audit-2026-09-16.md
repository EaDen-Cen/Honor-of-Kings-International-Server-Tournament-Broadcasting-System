> [文档索引](../README.md) · 除特别注明外，文件路径以仓库根目录为基准，npm 命令在 `vite-project/` 中执行。

> 本文保留 2026-09-16 的研究快照，不代表当前游戏版本已重新核验。本文旧 ID 与计数仅适用于当时；当前名单和编号见 [hero-roster](hero-roster.md) 与 [ID 规则](hero-id-order.md)。证据 JSON 仍在根目录 `research/`。

# HOK 国际服英雄数据差异核查

核查日期：2026-09-16。范围：Honor of Kings 国际服 MOBA，不包含国服完整名单、王者荣耀世界或 Arena of Valor 独立游戏全名单。

## 结论

- 本地原始文件：`vite-project/src/components/HeroList.tsx`，96 条记录、95 个有效命名条目；ID 29 名称为空。
- 本地克隆版本：`87cc55d`，提交日期 `2024-11-27`，提交说明 `add miyue`。
- 本次读取的国际服公开目录含 116 条英雄/形态记录。归一化 5 组名称差异后，本地缺少 **21 条记录**。
- 21 条中包含 Flowborn 的 3 种形态，不能称作 21 名不同角色；按同名角色归并为 19 项。
- **已完成本轮名单与头像补齐**：21 条新增记录使用本地 ID 97–117，运行时共 116 条有效记录；空白 ID 29 停止提供选禁，旧 ID 不重排。

## 本轮同步结果

- 新增数据：`vite-project/src/data/additionalHeroes.ts`，由原 `HeroList.tsx` 统一导出，服务器、操作页、解说页和 Overlay 使用同一份名单。
- 全部 21 张头像已从 `camp.honorofkings.com` 下载至 `public/heroesImg/`，按原始 PNG/JPEG 编码保存。比赛显示不再请求外部图片。
- 每张图片的目录页、官方资源 URL、Camp ID、本地路径、下载日期及 SHA-256 见 `research/new-hero-assets.json`。Camp ID 与本地 ID 分开保存。
- 5 组旧名已作为搜索别名保留；显示名称同步为目录名称。新增项中曾使用英文占位的 9 个中文名现已补齐，21 条新增记录均有中文显示名，中英文都可搜索；名称来源见 `research/new-hero-chinese-names.json`，区分第三方国际服中文目录和 AoV 官方中文名沿用。
- 修正 Butterfly 的 `couter` 拼写，删除 Zilong 的自身被克制引用；运行时旧图片路径统一指向已有本地资源。
- 新英雄的 Counter / Combo / Be Countered 保持空数组并标注未核验，不生成无依据的关系。
- Flowborn 三形态分别记录并带 `variantGroup` 标识；AoV 三条带 `crossover` 标识。当前工具用于人工录入实际房间 BP，不把未核实的职业赛规则硬编码为形态互斥限制；控制页提示以本场房间实际可用范围为准。
- 本次同步为有来源快照，未实现持续自动抓取。原始差异 JSON 保留，便于复核同步前基线。

比较目录：[BitTopup 国际服英雄目录](https://wiki.bittopup.com/hok)。它是第三方整理，不能作为唯一官方完整性保证。
已核对官网，但[官网首页英雄展示数据](https://www.honorofkings.com/data/heroes.json?v=1.1)本次只有 58 条，是展示子集，不能直接当完整名单覆盖本地。
本次读取的目录名称快照和差异结果保存为 `research/hero-roster-comparison.json`。

## 本轮已补齐的原缺失记录

下表的位置为比较目录给出的推荐位置，尚未逐项与赛事设备上的客户端复核。英文名沿用该目录，未自行创造中文译名。

| 英雄/形态 | 目录推荐位置 | 证据与需要注意的事项 |
| --- | --- | --- |
| Arke | 打野 | 目录存在，本地缺失 |
| Bai Qi | 对抗路 | 目录存在，本地缺失 |
| Chano | 发育路 | 目录存在，本地缺失 |
| Chicha | 对抗路 | 目录存在，本地缺失 |
| Devara | 对抗路 | 官方发行方公告明确于 2026-06-17 上线，见下文 |
| Fatih | 对抗路 | 目录存在，本地缺失；不要直接把国服名称当另一条新英雄重复添加 |
| Feyd | 打野 | 官方发行方 2025-03-05 公告明确作为当季新英雄加入，见下文 |
| Garuda | 中路 | 目录存在，本地缺失 |
| Haya | 中路 | 目录存在；上线报道为 2026-01-22，见下文 |
| Lapulapu | 游走 | 目录存在，本地缺失；不得混入其他 MOBA 的同名角色数据 |
| Sakeer | 游走 | 目录存在，本地缺失 |
| Umbrosa | 对抗路 | 目录存在，本地缺失；不能与已有 Ying 混为一条 |
| Xuance | 打野 | 目录存在，本地缺失 |
| Yango | 对抗路 | 目录存在，本地缺失；不能与已有 Yang Jian 混为一条 |
| Yixing | 中路 | 目录存在，本地缺失 |
| Flowborn (Tank) | 对抗路 | 同一角色的坦克形态，需定义 BP 中的形态与互斥规则 |
| Flowborn (Marksman) | 发育路 | 同一角色的射手形态，需定义 BP 中的形态与互斥规则 |
| Flowborn (Mage) | 中路 | 同一角色的法师形态，需定义 BP 中的形态与互斥规则 |
| Annette | 游走 | AoV 联动；官方公告提到加入匹配，赛事房间可用性/开放期须另核 |
| Florentino | 对抗路 | AoV 联动；官方公告提到加入匹配，赛事房间可用性/开放期须另核 |
| Lorion | 中路 | AoV 联动；官方公告提到加入匹配，赛事房间可用性/开放期须另核 |

上述 21 条及位置来自[目录逐项比对](https://wiki.bittopup.com/hok)，不是根据论坛猜测推算。
没有将传闻、体验服内容或未来版本预告自动并入差异。

### 额外上线证据

- **Feyd**：2025-03-05 的发行方公告正文确认新英雄已到来，并给出 3 月 5–30 日的解锁活动。
  [官方公告](https://www.levelinfinite.com/news/honor-of-kings-unveils-new-hero-feyd-and-new-game-modes-in-latest-season-update/)。
- **Devara**：发行方 Level Infinite 于 2026-06-24 发布的文章明确给出 6 月 17 日上线，并描述为对抗路英雄。
  同一文章点名 **Annette、Lorion、Florentino** 加入匹配阵容；这不足以证明赛事自定义房间允许使用。
  [官方公告](https://www.levelinfinite.com/news/hok-plus-2-0-update/)。
- **Haya**：2026-01-22 的上线报道与目录一致，但本次官方新闻稿页面返回授权错误，未把搜索片段冒充已读取的官方正文。
  [上线报道](https://pinoygamer.ph/articles/honor-of-kings-welcomes-2026-with-a-new-hero-new-skin-and-exciting-gameplay-mode.27179/)。
- 其余条目的名单与位置主要证据为公开目录；本轮已记录该目录关联的 Camp ID 并下载对应官方资源域名头像。赛事客户端可用性仍以实际房间为准。

补充：搜索索引还返回以下官方 IP 目录页，支持名称存在，但本次多数详情页直接打开超时，
因此只作为**官方目录索引线索**，不当作已完整读取的上线公告：
[Fatih](https://world.honorofkings.com/zlkdatasys/ip/hero/en/128.html)、
[Yango](https://world.honorofkings.com/zlkdatasys/ip/hero/en/125.html)、
[Haya](https://world.honorofkings.com/zlkdatasys/ip/hero/id/521.html)、
[Umbrosa](https://world.honorofkings.com/zlkdatasys/ip/hero/id/558.html)、
[Garuda](https://world.honorofkings.com/zlkdatasys/ip/hero/m/tr/110.html)、
[Flowborn](https://world.honorofkings.com/zlkdatasys/ip/hero/en/581.html)、
[Sakeer](https://world.honorofkings.com/zlkdatasys/ip/hero/en/534.html)、
[Yixing](https://world.honorofkings.com/zlkdatasys/ip/hero/id/197.html)、
[Chicha](https://world.honorofkings.com/zlkdatasys/ip/hero/m/ms/172.html)、
[Lapulapu](https://world.honorofkings.com/zlkdatasys/ip/hero/en/168.html)。
Flowborn 总称页也不能替代三种形态的逐项可用性核验。

## 名称差异：不应算新增英雄

| 本地名称 | 比较目录名称 | 本地 ID |
| --- | --- | --- |
| Loong | Ao'yin | 54 |
| Prince of Lanling | Gao Changgong | 73 |
| Princess Frost | Wang Zhaojun | 74 |
| Zhuang Zhou | Zhuangzi | 92 |
| Dr. Bian | Dr Bian | 25 |

以上按名称/身份归一化进行比较和同步，保留原 ID，旧名已保留为搜索别名。
不能直接用官网或 Camp 的数字 ID 覆盖本项目 1–96 的本地 ID：它们属于不同编号体系。

## 同步前发现的已有数据问题

以下均来自本地文件检查，不依赖网络推测：

| 位置 | 问题 | 影响/建议 |
| --- | --- | --- |
| ID 29，约第 297 行 | 中英文名都为空字符串/空格 | 空白英雄仍可被当前逻辑选入 BP，正式使用前应禁用该占位，不能按位置猜补名字 |
| Butterfly / ID 11，约第 114 行 | 字段写成 `couter` | 分析读取 `counter`，该数组被忽略；需修正字段并复核其关系 |
| Zilong / ID 93，约第 971 行 | `beCountered` 包含自身 ID 93 | 会产生自己克制自己的推荐，需要人工确认 intended ID |
| ID 29 与 Fang / ID 89 | 相同 `imageLink` | 占位记录引用了 Fang 的图片链接 |
| Ziya 94 / Ying 95 / Mi Yue 96 | 三者 `imageLink` 都指向姜子牙图片 | 元数据明显需复核；当前 UI 用本地 `/heroesImg/{id}.png`，不等于这三张正在显示的头像都错误 |
| Shi / ID 13 | `imageLink` 指向 Cao Cao 图片路径 | 应核对元数据；不能据此断言曹操已被正确收录 |

`public/heroesImg/` 中 1–96.png 存在，另有 45.jpg。存在图片文件只说明资源可加载，不能证明名称、身份、版本或关系正确。
没有发现关系数组引用不存在的 ID；但引用可解析不等于克制关系在当前版本仍准确。

## 同步执行与后续核验

1. 已保留旧有效 ID，并修复空白占位、拼写和自身引用问题。
2. 已补齐 21 条名称、推荐位置、Camp ID 与本地头像，并记录可追溯来源。
3. 已记录 Flowborn 形态分组及 AoV 联动分类；未确认的房间规则由操作员按实际游戏录入。
4. 已新增本地 ID 97–117，并保留旧名称搜索别名。
5. 新增项缺乏可靠关系资料时显示“暂无数据”；以后可单独补带来源的关系数据。
6. 名单/图片/引用校验、完整 BP 和三端显示检查结果见 [VALIDATION.md](../validation/history.md)。

该步骤放在其他系统开发、验证与说明之后，见 [WORKFLOW.md](../archive/planning/workflow-2026-09-17.md)。

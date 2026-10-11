# 英雄 Release-order ID 规则

## 目标

从 v1.0.0 起，程序内英雄 ID 不再是历史录入顺序，而是**国际服上架顺序**：

- `ID 1` = 当前英雄池里最早的一批英雄中的第一位；
- ID 单调递增；
- **ID 越大，国际服上架越晚**；
- 当前基线为 `1..119`，最新英雄 Wang Wei / 王维为 `ID 119`。

这样 Control 的“上线时间（新→旧）”不再依赖不完整的 `releaseDate` 字段，直接按 ID 降序即可覆盖全部英雄。

## 排序来源

主顺序使用 World of Honor of Kings 英雄页的 **Launch Time** 排序：

https://world.honorofkings.com/ipworld/en/m/champion.html

该页面把 Flowborn 作为一个英雄条目，因此程序里为了 BP 独立选择而拆出的 5 个形态在同一 release slot 内连续编号，固定按 Camp ID：

1. Flowborn (Tank) — 581
2. Flowborn (Mage) — 582
3. Flowborn (Assassin) — 583
4. Flowborn (Marksman) — 584
5. Flowborn (Roamer) — 585

Annette / Florentino / Lorion 不出现在该 IP World 列表中，但 Level Infinite 的 Plus 2.0 公告确认它们与 Devara 属于同一批加入 matchmaking 的英雄。四名英雄因此作为同一 release batch 连续编号；同批内部采用固定确定性顺序：

`Annette → Florentino → Lorion → Devara`

来源：

https://www.levelinfinite.com/news/hok-plus-2-0-update/

同批内部顺序**不是精确到分钟的发布时间声明**，只是为了让内部 ID 唯一、连续和稳定；“上线时间”排序层面它们属于同一批。

## 当前尾部编号

| ID | Hero |
| ---: | --- |
| 104 | Flowborn (Tank) |
| 105 | Flowborn (Mage) |
| 106 | Flowborn (Assassin) |
| 107 | Flowborn (Marksman) |
| 108 | Flowborn (Roamer) |
| 109 | Umbrosa |
| 110 | Garuda |
| 111 | Lapulapu |
| 112 | Chicha |
| 113 | Haya |
| 114 | Yango |
| 115 | Annette |
| 116 | Florentino |
| 117 | Lorion |
| 118 | Devara |
| 119 | Wang Wei |

完整 `1..119` 顺序以 `vite-project/src/data/heroIdOrder.ts` 和 [独立英雄名单](hero-roster.md)为准。

## 旧 ID 与本地数据

本次编号调整是一次性 schema migration。

- 旧 `data/match.json` 的 picks、bans、assignments、draftHistory、postGameReports、heroArtOverrides、heroDataOverrides 会在 Store 加载时从旧 ID 自动映射到 release-order ID。
- Match store 版本由 `1` 升到 `2`。
- 迁移映射保存在 `src/data/heroIdOrder.ts`，只用于读取旧存档，不作为新的英雄身份来源。
- 新英雄正常追加在当前最大 ID 之后；历史补录英雄如果不是“最新上线英雄”，必须人工维护 release-order 基线，不能简单 append。

## 图标文件不跟着重命名

`public/heroesImg/` 是已经人工整理过的资产集合。本次**不批量重命名二进制图标文件**。

因此：

- hero ID 是赛事逻辑 / 上线顺序 ID；
- `imageLink` 是稳定资产路径；
- 两者不要求文件名数字相等。

例如 Wang Wei 的程序 ID 是 `119`，但当前已整理好的 UI 图标使用 `/heroesImg/120.png`。这样避免为了逻辑编号迁移再次破坏已经核对好的图标。

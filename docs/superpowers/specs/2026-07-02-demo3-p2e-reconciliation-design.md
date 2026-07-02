# demo3 · P2-E 设计 — 收入核对（台账 ⇄ 附表10 逐租户配平）

- **状态**：待用户复审
- **日期**：2026-07-02
- **作者**：Claude（brainstorming）
- **项目**：demo3 · P2 第五刀（承接 A–D；兑现 P1 附表10 spec 预留的配平）
- **事实源**：原型 `app/legacy/recon-page-v3.js`（生效版，方案C「双源对照」：①选月→②左租户清单/右单户对账，台账按公司分卡⇄附表10按期区，底部配平条，差异行处置浮层，蓝对齐/橙金额不符/红一侧缺记）；领域口径=P1 附表10 spec（两本账并行人手分记，配平抓「多记/漏记一户/金额不符」；台账费用列与附表10列**同一套费用科目**是配平根基；s10 软引用 tenant_id+自由 tenant_name 为此预留）。

---

## 0. 定性

收入核对 = **纯派生读模型 + 一张处置小表**：同一笔租户交款在 月度台账（按管理公司记）与 附表10（按期区记）两本账各记一份，本屏按 (年,月) 逐租户交叉比对差异。无导入、无行编辑——数据修正回源头两屏改。

## 1. 决策（Decision Log）

| # | 决策 | 取舍 |
|---|---|---|
| E1 | 比对实体集合 = 该月 **台账有行的租户 ∪ 附表10 有行的租户**；匹配：s10.tenant_id 优先，null 时按 `tenant_name == tenant.company_name`，仍不匹配 = 附表10 独有实体（以 name 为键） | 软引用语义（s10 spec） |
| E2 | 比对粒度 = **同名费用科目逐项**（台账 21 列 ∩ 附表10 25/20 列的同名交集）；仅一侧存在的科目计入该侧总额、明细中标「仅台账 / 仅附表10」 | 同一套科目是配平根基；侧独有科目不误报 |
| E3 | 状态三档（容差 0.005）：**ok**(两侧都有且各科目全等) / **diff**(两侧都有但有科目不等) / **miss**(仅一侧有行)；月卡与清单以此聚合 | 原型 蓝/橙/红 |
| E4 | 台账侧聚合 = 该租户跨全部公司 Σ（按公司分卡展示明细）；附表10 侧 = 跨期区 Σ（按期分卡展示） | 原型双源对照 |
| E5 | **处置标记持久化**：`recon_mark(year,month,租户键,note)`——差异户可标「已核实」+备注，清单变灰排后；取消=删除 | 用户拍板 |
| E6 | 服务端算好整月对照（跨 mapper 只读聚合，DataHomeService 先例）；前端只渲染 | 实体~14×科目~21，量小 |
| E7 | 跳转两屏 v1 = 简单 `router.push('/ledger'|'/sales-income')`（不带深链上下文） | YAGNI，深链 backlog |
| E8 | 「总项损益/分项损益」两张母册汇总 sheet **不属本刀**（附表1-5 卷积视图，归 F/backlog） | 分类清楚 |

## 2. 数据模型（V28，仅处置小表）

```sql
CREATE TABLE recon_mark (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  year        INT          NOT NULL,
  month       INT          NOT NULL,
  tenant_id   INT UNSIGNED NULL,                    -- 匹配上的真实租户
  tenant_name VARCHAR(128) NOT NULL,                -- 展示名/未匹配实体的键
  note        VARCHAR(255) NULL,
  created_at  DATETIME     NOT NULL,
  updated_at  DATETIME     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_mark (year, month, tenant_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

（键用 tenant_name：未匹配实体无 id；同名即同实体，与 E1 一致。）

## 3. 后端（`ReconController` `/api/recon`）

| 动词 | 路径 | 返回 | 说明 |
|---|---|---|---|
| GET | `/overview?year=` | `ReconOverviewDTO{months:[{month,hasData,entityCount,okCount,diffCount,missCount}]}` | 月卡（hasData=两侧任一有数据；确定性年范围同各屏，年参数默认取有数据最大年） |
| GET | `/{year}/{month}` | `ReconMonthDTO{entities:[ReconEntityDTO]}` | 整月对照 |
| POST | `/{year}/{month}/mark` | `ReconMarkDTO` | body `{tenantName, tenantId?, note}` upsert（uk 冲突即更新 note） |
| DELETE | `/{year}/{month}/mark?tenantName=` | void | 取消核实 |

`ReconEntityDTO{ tenantId?, tenantName, status(ok|diff|miss), ledgerTotal, s10Total, diff, marked, markNote,
  fees:[{key, label, ledgerAmt?, s10Amt?, delta, onlySide?('ledger'|'s10')}],
  ledgerCards:[{companyName, total, fees:{key:amt}}], s10Cards:[{phase, total, fees:{colId:amt}}] }`
- `ReconService` 只读注入 `MonthlyLedgerMapper/S10RecordMapper/TenantMapper/ManagementCompanyMapper` + `ReconMarkMapper`；科目交集映射常量单点定义（后端持有 台账 FEE 列名 ↔ s10 COLS 列名 对照，同名直接映射）。
- 无数据月：entities 空数组（前端空态），不 404。

## 4. 前端（`views/reports/recon/`，路由 `reconciliation` 换真屏）

1:1 移植 v3 视觉（`--pa-*` token 换 demo3 令牌）：
- **① 月份层**：顶部 4 指标条（台账总额/附表10总额/差额/差异+缺记户数，取当年聚合）+ 12 月卡（状态点：全平蓝/有差异橙/有缺记红 + 户数摘要）；年份胶囊切换。§6 加载门。
- **② 对账工作台**（`ReconWorkbench`）：
  - 左 **租户清单**（sticky 搜索框 + Segmented `全部|有差异|缺记|已平`，计数徽标；行=状态点+租户名+差额；`已核实` 灰显排后带勾）。
  - 右 **单户对照**：上双卡——左卡「月度台账」按公司分卡（每卡费用行 key+金额），右卡「附表10」按期区分卡；**同名科目行差异高亮**（橙=两侧不等，红=onlySide）；底部**配平条**（台账合计 ⇄ 附表10合计 ⇄ 差额，蓝/橙/红判定）。
  - 差异行/配平条点击 → **处置浮层（居中弹窗 §7）**：显示两侧值+差额，动作=「标记已核实+备注」（POST mark）/「取消核实」（DELETE）/「去改台账」「去改附表10」（router.push）。
- `reports/recon.ts` 纯函数：状态判定/科目交集合并/清单过滤排序（可单测）。
- `api/recon.ts` + `types/recon.ts`。

## 5. 测试

- 后端 `ReconApiIT`（真库）：构造场景断言——同租户两侧等值→ok；某科目不等→diff 且 fees.delta 对；仅台账有→miss(ledger 侧)；s10 软引用 name 匹配（tenant_id null 但名字对上→归并同实体）；跨公司/跨期聚合正确；mark upsert/删除往返；overview counts。
- 前端 vitest：`recon.ts` 状态判定/过滤排序/科目合并。
- 真跑：种子数据（台账 2026-1..5 + s10 2024-2026.6 现成两本账！）选重叠月对照，肉眼验状态/分卡/配平条/标记流；0 console error。**注意种子里 s10 与台账数值本就不同源——正好演示 diff/miss，真实差异非造假。**

## 6. DoD

- [ ] V28 + Recon 实体/Mapper/DTO/Service/Controller 4 端点 + ReconApiIT；全量 `./mvnw test` 绿。
- [ ] recon.ts 纯函数 + ReconView(月层+工作台+处置浮层) + api/types + 路由换真屏；build+vitest 绿。
- [ ] 真跑 preview：重叠月双源对照/状态三色/标记已核实持久化/跳转两屏/0 console error。

## 7. 显式延后

- 深链跳转带上下文（公司/月/期直达）；报表间 tieout（利润表↔资产负债表↔附表总额，归 F 报表中心）；总项/分项损益卷积视图（F/backlog）；差异导出。

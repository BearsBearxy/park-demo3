# demo3 表格溢出治理 + 主数据 KPI 左栏化 spec(2026-07-11)

来源:用户反馈。①租户管理长名撑出页面横向滚动条;②数据表格数字过长显示不全;
③楼栋/租户/合同三屏 KPI 卡片挤占首屏主内容,改左侧竖排。
(用户第4点「关联租户数据是否打通」为讨论题,不在本 spec 内。)

---

## 0. 现状(实测)

| 位置 | 机制 | 问题 |
|---|---|---|
| FPLedgerTable(台账宽表) | 列宽写死(lgColumns w:104 等)+ `.lg-nv/.lg-sumc` overflow:hidden+ellipsis | **金额静默截断**(`1,234,567.89`=12字符>104px),财务数据危险;`.lg-tname/.lg-note` 同截无提示 |
| FPSortableTable(租户/楼栋/合同列表) | 单元格 nowrap 不截断 | 长租户名撑宽表格 → **页面横向滚动条**(用户点名) |
| SalaryTable `.s12-c-note` / S10Table `.s10-tname` / FinReportTable `.fin-rowlabel` | ellipsis | 截断无 tooltip |
| 三屏 KPI(Buildings/Tenants/Contracts) | 顶部横排 grid(minmax 204px)+KpiCard padding 24px | 首屏近半高度被 KPI 占据 |

## 1. 数字溢出的行业通行解法(用户要求对齐市面产品)

财务/后台表格产品(Ant Design Pro Table、Stripe Dashboard、金蝶云/用友、Google Sheets)的共识:

1. **金额永不静默截断**——Excel 列窄显 `####` 明示;Web 端做法 = 右对齐 + tabular-nums(本项目已有)
   + **列宽随内容**(表格在自身容器内横向滚动,不截数字);
2. **文本列才允许 ellipsis,且必须 hover tooltip 出全文**(Ant Design Table `ellipsis:{showTitle:true}` 模式,
   即原生 `title` 属性,零成本);
3. 大额紧凑化(折万)只用于**只读分析视图**(本项目分析层已用),录入/对账表格必须精确值。

本项目落法:
- **数字单元格**:去 maxWidth 锁死 → min-width 保底 + 允许按内容撑宽(FPLedgerTable 的 `.lg-table`
  已是 `width:max-content` + `.lg-wrap overflow:auto`,表内横滚现成);ellipsis 移除;`title` 兜底保留完整值。
- **文本单元格**(租户名/备注/科目):保留 ellipsis(+max-width 上限),一律补 `:title` 原文。
- **租户列表名称列**:加 max-width(≈240px)+ellipsis+title,消页面级横滚。

## 2. 任务分解(文件互不相交)

### W1 租户管理屏(views/tenants/TenantsView.vue)
1. **名称列防撑宽**:名称列 custom render 内包一层 `max-width:240px; overflow:hidden; text-overflow:ellipsis;
   white-space:nowrap` 的容器 + `title=companyName`(家族聚合的 └ 前缀/关联副行/+N 徽标布局保持,
   副行「关联:X」同样受 max-width 约束);其他列不动。FPSortableTable 组件本身不改(render 函数内自包)。
2. **KPI 左栏化**(§3 统一样式):4 张 KpiCard 从顶部横排 grid 移到左侧竖排栏。

### W2 楼栋屏 KPI 左栏化(views/buildings/BuildingsView.vue)
同 §3。

### W3 合同屏 KPI 左栏化(views/contracts/ContractsView.vue)
同 §3。

### W4 数据表格数字/文本溢出治理(共享表格组件+3 个表格)
- `components/fp/FPLedgerTable.vue`:
  - 数字列(kind num/sum/bal):`widthStyle` 对这些列不再输出 maxWidth(min-width 保底,列随内容撑);
    `.lg-nv/.lg-sumc` 移除 overflow:hidden/text-overflow;只读态数字 span 加 `:title="fmt(v)"`;
  - `.lg-tname` 加 `:title="row.tenantName"`;`.lg-note` 只读态加 `:title="row.note ?? ''"`。
  - 编辑态 input(.lg-ni)本身可滚动光标,不动。
- `components/fp/FPSortableTable.vue`:普通文本单元格(非 custom render)串值加 `title`(一行:
  在 td 渲染处把原始值放 title;custom render 列由调用方自理)。数字列现状 nowrap 不截,不动。
- `views/salary/SalaryTable.vue` `.s12-c-note`、`views/sales-income/S10Table.vue` `.s10-tname`、
  `components/fin/FinReportTable.vue` `.fin-rowlabel`:各自加 `:title` 原文(样式不动)。

## 3. KPI 左栏统一样式(W1/W2/W3 三屏同款,像素级一致)

```html
<!-- 原:顶部 <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(204px,1fr));gap:16px">×N 卡 -->
<div class="mx-body">
  <aside class="mx-kpirail">
    <KpiCard ... :style="{ padding: '14px 16px' }" />   <!-- 紧凑内边距,KpiCard 已支持 style prop -->
    ×4(卡片顺序/内容/tint 不变)
  </aside>
  <div class="mx-main">
    …原主内容(期区 tabs + 工具条 + 表格 + 分页,原封搬入)…
  </div>
</div>
```

```css
.mx-body { display:grid; grid-template-columns:200px minmax(0,1fr); gap:16px; align-items:start; }
.mx-kpirail { display:flex; flex-direction:column; gap:12px; position:sticky; top:0; }
.mx-main { min-width:0; display:flex; flex-direction:column; gap:16px; }
@media (max-width:1100px) {  /* 窄屏回落:rail 变横排,主内容全宽 */
  .mx-body { grid-template-columns:1fr; }
  .mx-kpirail { flex-direction:row; flex-wrap:wrap; position:static; }
  .mx-kpirail > * { flex:1 1 160px; }
}
```

注意:三屏 KPI 数值/图标/顺序零变化;`summary` 加载门(v-if)语义不变;
main 列 `minmax(0,1fr)`+`min-width:0` 必须有(否则内部表格又把页面撑宽)。

## 4. 验收

1. `npx vue-tsc --noEmit` 0 错;`npx vitest run` 全绿(本批为样式/模板改动,无新增纯函数则无新用例)
2. 目视:
   - 租户管理:构造/查看最长名(火炬园火炬园邓宇峰),无页面横滚,名称截断有 tooltip
   - 台账宽表 2025-10:六位数金额完整显示(列撑宽,表内横滚),hover 有完整值
   - 楼栋/租户/合同三屏:KPI 在左侧竖排,首屏主内容(表格)直接可见;窄窗口(<1100px)回落横排

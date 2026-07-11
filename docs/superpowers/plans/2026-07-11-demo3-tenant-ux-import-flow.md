# demo3 租户关联/选择器/导入流程统一 spec(2026-07-11)

来源:用户反馈三组问题。调查结论与修复方案如下;实现走 Workflow(6 任务,文件互不相交)。

---

## 0. 调查结论(现状)

1. **租户关联**:`tenant.parent_id` 机制全链路已存在(表列/TenantDTO.parentId+parentName/新建编辑弹窗),
   但 356 户仅 6 户有关联。名称规则可自动关联 **14 对**(实测 SQL,见 §T1),含一条两级链
   `309 火炬园火炬园邓宇峰 → 24 火炬园邓宇峰 → 60 邓宇峰` 需拍平到根。同名重复行为 0(此前已合并)。
2. **租户列表难找**三个帮凶:默认按月租降序(=乱序感)、pageSize=8(356 户=45 页)、列表完全不显示关联。
3. **租户选择器**:台账添加租户行(LedgerWideTable ~171)、合同新建(ContractNewDialog ~183)、
   租户弹窗「关联主租户」(TenantNewDialog ~143)均为**原生 `<select>` + tenantApi.list() 库序 + 无搜索**;
   s10「新增租户」抽屉(S10View drawer)待实现者核实同批处理。
4. **导入按钮两种相反模式并存**:
   - 台账(LedgerWideTable)+三大报表(IS/BS/TB):导入仅**非编辑态**;
   - SchedHeader 8 屏(s10/elec/pv/chg7/chg8/salary/utilities×2)+损益附表 5 屏:导入仅**编辑态**(edit-actions slot);
   - s10 空态文案「导入 Excel 即将上线」过期(功能早已有)。

---

## 1. 统一规范(本 spec 的裁决)

**工具条状态机(所有数据录入屏)**:
- **非编辑态** = `导入 Excel` + `导出 Excel` + `编辑表格`(导入自带预览确认弹窗+独立落库,不依赖编辑草稿,
  用户拿到 Excel 无须理解"编辑模式"即可导入);
- **编辑态** = `完成/保存/取消` + 行级操作(新增行/新增租户/删除选中/清空本期导入/填入派生值),
  **不显示导入**(避免导入落库与未保存草稿冲突);导出无害,常驻两态。

**租户选择**:所有"从租户全集挑一个"的场景一律用共享组件 `FPTenantPicker`(可搜索+有序+关联可见)。

**租户列表**:默认视图按「家族聚合的名称序」;关联在列表内可见。

---

## 2. 任务分解

### T0(已由本人预置)
`components/sched/SchedHeader.vue` 已加 `<slot v-if="!edit" name="idle-actions" />`(非编辑态专用槽)。

### T1 后端:租户关联数据铺底(Flyway V31)
新建 `backend/src/main/resources/db/migration/V31__tenant_parent_link.sql`:
1. 名称规则关联(仅动 `parent_id IS NULL` 的行,已有 6 条手工关联不覆盖):
   child.company_name = parent.company_name + 后缀 `宿舍|（宿舍）|（饭堂）|商铺|（商铺）`,
   或 = 前缀 `火炬园` + parent.company_name;parent 须 `parent_id IS NULL`(指向根)。
2. 链拍平(跑两遍防两级):`UPDATE tenant c JOIN tenant p ON c.parent_id=p.id AND p.parent_id IS NOT NULL
   SET c.parent_id=p.parent_id`。
3. 自指防御:`AND c.id <> p.id`。
验收:迁移后 `SELECT COUNT(*) FROM tenant WHERE parent_id IS NOT NULL` = 20(14 新+6 旧);
广联（宿舍）/广联（饭堂）→ 广联(28);309 → 60(根)。**注意后端在跑需重启才执行迁移——由收尾人做,agent 只写文件+
在文件头注释里写清验证 SQL。**

### T2 租户列表重设计(views/tenants)
`TenantsView.vue`:
1. 默认排序改「名称(家族聚合)」:族键 = 根租户名(子取 parentName,root 取自身),
   `localeCompare(zh)`;族内 root 在前、子按名称。点击其他列头(月租等)时为普通全表排序(聚合让位,现有 fpSort 不动)。
2. 子租户行视觉:名称前 `└` 缩进(或等价缩进样式)+ 名称副行小字「关联:<parentName>」;
   root 有子时名称后小徽标「+N」(N=子数)。数据端 TenantDTO 已有 parentId/parentName,子数客端聚合。
3. `pageSize` 8 → 20。
4. 搜索命中即普通过滤(不强行聚合)。
`TenantNewDialog.vue`:「关联主租户」原生 select 换 `FPTenantPicker`(候选=在租+无 parent+非自身,现有过滤逻辑保留)。

### T3 共享组件 FPTenantPicker(components/fp)
新建 `components/fp/FPTenantPicker.vue` + 逻辑纯函数(过滤/排序)colocated spec:
- Props:`tenants: {id,name,phase?,parentName?}[]`、`modelValue: number|null`、`placeholder?`、`disabled?`;
  emit `update:modelValue`。
- 交互:点击开 popover(输入框+列表);输入即 substring 过滤(大小写不敏感);列表按名称 zh 排序;
  每行 = 名称 + 期区小徽章(一期/二期/三期/宿舍,取自 phase,无则省)+ 有 parentName 时小字「关联:<parentName>」;
  ↑↓ 高亮、Enter 选中、Esc/点外关闭;选中后输入框显示所选名称。
- 视觉:对齐现有 DS popover 观感(参照 `components/ds/Select.vue` 的浮层样式与 tokens:
  var(--surface-white)/--border-subtle/--radius/阴影),简约无装饰;列表虚高不需要(356 行直接渲染可接受,
  max-height + overflow-y)。
- 纯函数 `filterTenants(list, q)`(过滤+排序)抽出单测:空 q 全量有序/子串命中/大小写。

### T4 台账选择器替换(views/ledger)
`LedgerWideTable.vue` 编辑态「添加租户行…」原生 select 换 FPTenantPicker(候选 addableTenants 形状适配,
选中即触发现有 onAddTenant 流程,添加后清空)。`LedgerView.vue` 的 addableTenants computed 补名称排序。

### T5 合同新建选择器替换(views/contracts)
`ContractNewDialog.vue` 「请选择租户」原生 select 换 FPTenantPicker;`mode==='renew'` 的只读分支保持不变;
错误态(err==='请选择租户')的红框语义保留(组件加 `invalid?: boolean` prop 或外层 class)。

### T6 s10 屏 + 其余 8 屏导入按钮统一
- `S10View.vue`:①「导入 Excel」按钮从 `#edit-actions` 挪到 `#idle-actions`;②空态过期文案
  「导入 Excel 即将上线」改为「可在非编辑态导入 Excel,或进入编辑新增租户」;③「新增租户」抽屉内若为
  原生租户 select 则换 FPTenantPicker(核实:若抽屉是纯手输姓名则不动,报告即可)。
- `ElecView/PvView/ChargingView/SalaryView/UtilitiesView/PnlScheduleView`:「导入 Excel」从
  `#edit-actions` 挪到 `#idle-actions`(每屏 ~8 行搬移;「清空本期导入」「新增行/记账」「派生值」留 edit-actions;
  导出留 static-actions 不动)。
- 台账+三大报表已符合规范,不动。

---

## 3. 验收

1. 各新增 spec 用例 + 全量 `npx vitest run` 绿 + `npx vue-tsc --noEmit` 0 错
2. 重启后端 → V31 执行 → 库内 parent_id 非空 = 20;租户管理列表:广联/广联（宿舍）/广联（饭堂）相邻聚合、
   子行有「关联:广联」、默认名称序、每页 20 条
3. 台账编辑态添加租户行:可搜索下拉,输"广联"出 3 条含期区徽章
4. s10/elec/pv/charging/salary/utilities/pnl 非编辑态可见「导入 Excel + 导出 + 编辑表格」;
   进编辑后导入隐藏、行级操作可见;台账/报表行为不变
5. 合同新建、租户编辑弹窗的租户选择均可搜索

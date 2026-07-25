# 合同管理重做 Phase A 实现计划（CONTRACT-BILLING-REWORK Phase A）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 合同管理改为 master-detail 整页布局，详情卡删阶梯块、加「月租金合计(标准)」、抬显标的段，并回填 14 份空续签合同成完整合同。

**Architecture:** 纯前端布局/组件调整（`ContractsView` 换 master-detail 栅格、`ContractDrawer` 从居中模态 `FPDrawer` 换成右侧内联面板）+ 一次性数据回填脚本（父合同标的段 × 阶梯次段比例 → 空续签的 billing lines，直连 DB 并复算标量缓存）。无 schema 变更。

**Tech Stack:** Vue 3 `<script setup>` + TS + Vitest（前端）；Python + docker exec mysql（回填）。

## Global Constraints

- 规范源：`docs/design/CONTRACT-BILLING-REWORK-SPEC.md`；注释引用写 `CONTRACT-BILLING-REWORK-SPEC §x.y`。
- 前端类型检查**必须** `npm run typecheck`（在 frontend/），**禁**裸跑 `vue-tsc --noEmit`（曾漏报）。
- 前端测试 `npm run test`（vitest run）。
- **无 schema 变更**：Phase A 不建表不改列；`link_type`/`bill_notice`/`DROP contract_rent_tier` 全属 Phase B。
- 阶梯**后端表/DTO 暂留**（Phase B 用），只删**前端 UI**（展示块 + 编辑器 + `FPRentTierBar.vue`/`rentTier.ts`）。
- 账单派生**不做**（Phase B）。BILL-FORWARD 链一行不动。
- dev 环境：MySQL=docker `demo3-mysql` 宿主机 :13306（`docker exec demo3-mysql sh -c 'MYSQL_PWD=root mysql -uroot park_demo3 ...'`）；前端 :5173，后端 :8080（`DB_PORT=13306`）。
- 只读账号 `viewer/viewer123` 供 UI 目视核对。

---

## 文件结构

| 文件 | 职责 | Task |
|---|---|---|
| `frontend/src/views/contracts/ContractDrawer.vue` | 删阶梯块、加月合计、换内联面板壳 | 1,2 |
| `frontend/src/views/contracts/ContractNewDialog.vue` | 删阶梯段编辑器（保留期限原文/类型/阶梯价原文文本） | 1 |
| `frontend/src/views/contracts/FPRentTierBar.vue` | 删除 | 1 |
| `frontend/src/views/contracts/rentTier.ts` / `rentTier.spec.ts` | 删除 | 1 |
| `frontend/src/views/contracts/contractNewDialog.spec.ts` | 去掉阶梯段断言（保留期限原文断言） | 1 |
| `frontend/src/views/contracts/ContractsView.vue` | master-detail 栅格 + 行点选中 + 内联详情 | 2 |
| `frontend/src/views/contracts/mx-list.css`（或局部） | master-detail 布局类 | 2 |
| `<scratchpad>/backfill_renewals.py` | 回填 14 份空续签（一次性，直连 DB） | 3 |

**串行铁律**：Task 1 与 Task 2 都改 `ContractDrawer.vue`，必须**先 1 后 2、同一执行者**。Task 3（数据）独立，可与前端并行。

---

## Task 1: 删阶梯 UI + 加「月租金合计(标准)」

**Files:**
- Modify: `frontend/src/views/contracts/ContractDrawer.vue`
- Modify: `frontend/src/views/contracts/ContractNewDialog.vue`
- Modify: `frontend/src/views/contracts/contractNewDialog.spec.ts`
- Delete: `frontend/src/views/contracts/FPRentTierBar.vue`, `frontend/src/views/contracts/rentTier.ts`, `frontend/src/views/contracts/rentTier.spec.ts`

**Interfaces:**
- Consumes: `lineMonthly(l, kva)`（已 import 于 ContractDrawer，`types/contract.ts:240`）。
- Produces: ContractDrawer 详情多一行「合同月租金合计(标准)」；不再渲染 `.rt`/`FPRentTierBar`；ContractNewDialog 不再编辑 `rentTiers`。

- [ ] **Step 1: 删 ContractDrawer 的阶梯块 + import**

`ContractDrawer.vue`：删掉 import 行 `import FPRentTierBar from './FPRentTierBar.vue'`（约 L13）；删掉整段渲染块（约 L232-236）：

```html
      <!-- 2.5 租金阶梯(V2-SPEC §5)… -->
      <div v-if="(detail?.rentTiers?.length ?? 0) > 1">
        <FPSectionLabel icon="trending-up">租金阶梯</FPSectionLabel>
        <FPRentTierBar :tiers="detail!.rentTiers" :today="today" :contract-unit-price="contract.unitPrice" />
      </div>
```

若 `const today = …`（本地日期那段）此后无其它引用，一并删除（grep `today` 确认仅阶梯块用）。

- [ ] **Step 2: 加「合同月租金合计(标准)」computed + 渲染**

`ContractDrawer.vue` `<script setup>` 增（放在 `rowMonthly` 附近）：

```ts
// 合同标准月租金合计 = 各计费行月单价之和(参考,非账单实收;账单含免租/proration 属账单管理)
const contractMonthlyTotal = computed(() => {
  let s = 0
  for (const l of detail.value?.billingLines ?? []) {
    const m = lineMonthly(l, props.contract?.kva)
    if (m != null) s += m
  }
  return s
})
```

在「标的段与费用」段之后插入一行（沿用 `.fp-field` 样式）：

```html
      <div v-if="detail && detail.billingLines.length" class="fp-field">
        <span class="k">合同月租金合计（标准）</span>
        <span class="v mono">{{ contractMonthlyTotal.toLocaleString('en-US', { maximumFractionDigits: 2 }) }}
          <span style="font-size:11px;color:var(--text-muted);font-family:var(--font-sans)"> · 参考,非账单实收</span></span>
      </div>
```

- [ ] **Step 3: 删 ContractNewDialog 的阶梯段编辑器（保留期限原文/类型/阶梯价文本）**

`ContractNewDialog.vue`：
- 删渲染块 L530-553（`<!-- 租金阶梯期… -->` 起到该 `ct-span2` div 结束的整段，即「租金阶梯期 · 参考排程」+ `v-for rentTiers` + 添加阶梯档按钮）。**保留** L525-529 的「分年阶梯价(原文留档)」textarea 和上方期限原文/类型。
- 删 `rentTiers` ref（约 L72：`const rentTiers = ref<RentTierReq[]>([])`）。
- 删编辑态回填（约 L158-166：`rentTiers.value = (d.rentTiers ?? []).map(...)` 整段）。
- 删提交里的 `rentTiers`（约 L310：`rentTiers: rentTiers.value.map(...)` 那一行）。
- 删 `RentTierReq` import（约 L20，从 `@/types/contract` 的解构里去掉）。
- 删阶梯专用样式类若仅此处用（`.ct-tier-row/.ct-tier-label/.ct-tier-add`，grep 确认）。

> 说明：不发 `rentTiers` → PUT 时后端按 `null=不动`，已存的 tier 数据原样保留（Phase B 用）。

- [ ] **Step 4: 删文件**

```bash
git rm frontend/src/views/contracts/FPRentTierBar.vue frontend/src/views/contracts/rentTier.ts frontend/src/views/contracts/rentTier.spec.ts
```

- [ ] **Step 5: 改 contractNewDialog.spec.ts**

打开 `frontend/src/views/contracts/contractNewDialog.spec.ts`，删掉「可增删阶梯段」那个 `it(...)`（触发 `.ct-tier-*` 的用例）；保留「编辑态回填」「提交带期限原文四字段」里除 `rentTiers` 外的断言（把断言里对 `rentTiers` 的检查删掉）。改后该 spec 只覆盖 termText/termType/tierPriceNote 三字段回填与提交。

- [ ] **Step 6: 型检 + 测试**

Run: `cd frontend && npm run typecheck && npm run test`
Expected: typecheck 无错（无残留 FPRentTierBar/rentTier/RentTierReq 引用）；测试全绿。若报 `rentTier` 相关未使用 import/找不到模块，按 Step1/3 补删干净。

- [ ] **Step 7: Commit**

```bash
git add frontend/src/views/contracts/ContractDrawer.vue frontend/src/views/contracts/ContractNewDialog.vue frontend/src/views/contracts/contractNewDialog.spec.ts
git commit -m "feat(contract): 删阶梯块UI + 加合同月租金合计(标准) (REWORK-SPEC §3.2)"
```

---

## Task 2: master-detail 整页布局

**Files:**
- Modify: `frontend/src/views/contracts/ContractsView.vue`
- Modify: `frontend/src/views/contracts/ContractDrawer.vue`
- Modify: `frontend/src/views/contracts/mx-list.css`（新增 master-detail 类，勿动其它两屏既有类）

**Interfaces:**
- Consumes: Task 1 后的 `ContractDrawer`（内容段不变）。
- Produces: `ContractDrawer` **始终**渲染为右侧内联面板（去掉 `FPDrawer` 外壳，无 `open`/`@close`/模态）；`ContractsView` 左列表右详情两栏，行点击设 `openContract`（选中高亮，不弹模态）。

- [ ] **Step 1: ContractDrawer 去 FPDrawer 外壳，改常驻内联面板**

`ContractDrawer` **只被 `ContractsView` 一处引用**（探底确认），无需双模式/向后兼容。把最外层 `<FPDrawer :open …>` 整个换成内联面板容器；`badge`/`footer`/默认插槽三段内容**原样搬进**面板（不复制、就一份）：

- props：删 `open`；保留 `contract`/`chain`。emits：删 `close`（详情常驻，关闭=父级清 `openContract`；`×` 按钮 emit 一个 `close` 仍可保留，父级监听清选中）。
- 结构：

```html
<template>
  <div v-if="contract" class="cd-inline">
    <div class="cd-inline-bar">
      <div class="cd-inline-title">
        <component :is="iconFor('file-text')" :size="18" aria-hidden="true" />
        <div style="min-width:0">
          <div class="cd-inline-no">{{ contract.contractNo }}</div>
          <div class="cd-inline-sub">{{ subtitle }}</div>
        </div>
        <FPContractStatus :status="contract.status" />
      </div>
      <div class="cd-inline-actions">
        <!-- 原 footer 的 终止/删除/编辑/续签 四个 Button 原样搬来(emit 同名事件不变) -->
      </div>
    </div>
    <div class="cd-inline-body">
      <!-- 原 FPDrawer 默认插槽的全部内容(租户卡/链/合同信息/标的段/月合计/生命周期/备注)原样搬来,一份 -->
    </div>
  </div>
  <!-- 终止/删除确认弹窗 Teleport 保持不变 -->
</template>
```

> 就是「把 FPDrawer 的三个 template 摊平进 `.cd-inline` 的 bar/body」，不是复制两份。`ContractsView` 用 `v-if="openContract"` 控制显隐，故 `ContractDrawer` 自身不再需要 `open`。

`.cd-inline*` 样式（`ContractDrawer.vue` scoped）：

```css
.cd-inline { display:flex; flex-direction:column; height:100%; background:var(--surface-white); border:1px solid var(--border-subtle); border-radius:var(--radius-lg); overflow:hidden; }
.cd-inline-bar { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 16px; border-bottom:1px solid var(--divider); flex:0 0 auto; }
.cd-inline-title { display:flex; align-items:center; gap:10px; min-width:0; }
.cd-inline-no { font-size:15px; font-weight:var(--fw-semibold); }
.cd-inline-sub { font-size:12px; color:var(--text-muted); }
.cd-inline-actions { display:flex; gap:6px; flex:0 0 auto; }
.cd-inline-body { flex:1 1 auto; overflow-y:auto; padding:16px; display:flex; flex-direction:column; gap:18px; }
```

- [ ] **Step 2: ContractsView 换 master-detail 栅格**

`ContractsView.vue` template：把 `.mx-body`（含 `aside.mx-kpirail` + `.mx-main`）改为「KPI 顶条 + 左列表/右详情两栏」：

```html
    <template v-if="summary">
    <!-- KPI 顶条(横向) -->
    <div class="mx-kpitop">
      <KpiCard label="执行中" :value="String(summary.contractActive)" tint="slate" />
      <KpiCard label="即将到期" :value="String(summary.contractExpiring)" delta="90天内·需续签" trend="down" tint="cyan" />
      <KpiCard label="草稿待签" :value="String(summary.contractDraft)" delta="待生效" tint="sky" />
      <KpiCard label="月租金合计" :value="fpWan(summary.monthlyRent)" tint="blue" />
    </div>
    <div class="mx-md">
      <!-- 左:列表列 -->
      <div class="mx-md-list">
        <div class="mx-toolbar"><!-- 既有 toolbar 原样搬入 --></div>
        <Card surface="white" :padding="0" class="mx-listcard">
          <div ref="tableWrapEl" class="mx-tablewrap">
            <FPSortableTable :columns="TABLE_COLUMNS" :rows="paged" rowKey="id" :sort="sort" :rowHover="true"
              :selectedKey="openContract?.id ?? null"
              @sortChange="sort = $event" @rowClick="openContract = $event" />
            <div v-if="filtered.length === 0" style="text-align:center;padding:40px;color:var(--text-disabled)">没有匹配的合同</div>
          </div>
          <div v-if="filtered.length > 0" class="mx-pagerbar"><FPPager :page="safePage" :pageCount="pageCount" :total="filtered.length" @page="page = $event" /></div>
        </Card>
      </div>
      <!-- 右:详情列 -->
      <div class="mx-md-detail">
        <ContractDrawer v-if="openContract" inline
          :contract="openContract" :chain="chainOf(contracts, openContract.id)"
          @jump="openContract = $event" @edit="editFrom = $event" @renew="renewFrom = $event"
          @terminated="onTerminated" @deleted="onDeleted" />
        <div v-else class="mx-md-empty">
          <component :is="iconFor('file-text')" :size="40" />
          <p>从左侧选择一份合同查看详情</p>
        </div>
      </div>
    </div>
    </template>
```

删掉底部原 `<ContractDrawer :open=…>`（模态用法，L347-357），因为详情已内联到右栏。`ContractNewDialog`（新增/编辑/续签模态）保持在原位不动。

> `FPSortableTable` 若无 `selectedKey`/选中高亮 prop：本 Step 加一个可选 prop（`selectedKey?: string|number|null`，命中行加 `.is-selected` 背景类）；若时间不够，选中高亮可后续补，先保证点击→右侧切换。

- [ ] **Step 3: mx-list.css 加 master-detail 类**

`frontend/src/views/contracts/mx-list.css` 末尾追加（勿改现有 `.mx-body/.mx-kpirail/.mx-main`，那两屏还在用）：

```css
.mx-kpitop { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }
.mx-md { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.35fr); gap:16px; flex:1 1 auto; min-height:0; }
.mx-md-list { display:flex; flex-direction:column; min-height:0; }
.mx-md-detail { min-height:0; display:flex; }
.mx-md-detail > * { flex:1 1 auto; min-height:0; }
.mx-md-empty { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; color:var(--text-disabled); border:1px dashed var(--divider); border-radius:var(--radius-lg); }
@media (max-width:1100px){ .mx-md{ grid-template-columns:1fr; } }
```

- [ ] **Step 4: 型检 + 测试**

Run: `cd frontend && npm run typecheck && npm run test`
Expected: 全绿。（布局为视觉改动，测试主要保证不回归；视觉由人工浏览器核对。）

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/contracts/ContractsView.vue frontend/src/views/contracts/ContractDrawer.vue frontend/src/views/contracts/mx-list.css
git commit -m "feat(contract): master-detail 整页布局(左列表+右内联详情) (REWORK-SPEC §3.1)"
```

---

## Task 3: 回填 14 份空续签（一次性数据脚本）

**Files:**
- Create: `<scratchpad>/backfill_renewals.py`（scratchpad，不进仓库）

**Interfaces:**
- Consumes: `contract`(parent/child)、`contract_billing_term`(父标的段)、`contract_rent_tier`(父阶梯)。
- Produces: 14 份空续签各 INSERT 完整 billing lines + UPDATE 标量缓存；产出「待核对」清单。

- [ ] **Step 1: 写回填脚本**

`backfill_renewals.py`（直连 DB；复算标量缓存逻辑镜像后端 `syncScalarCache`）：

```python
# -*- coding: utf-8 -*-
import subprocess, json, sys
def q(sql):
    out = subprocess.run(["docker","exec","demo3-mysql","sh","-c",
        f'MYSQL_PWD=root mysql -uroot park_demo3 --default-character-set=utf8mb4 -N -B -e "{sql}"'],
        capture_output=True, text=True, encoding="utf-8")
    if out.returncode: sys.exit("SQL ERR: "+out.stderr)
    return [line.split("\t") for line in out.stdout.splitlines() if line]

BUILDING_RENT = {"rent_factory","rent_office","rent_dorm","rent_shop"}
SCALE_KEYS = {"rent_factory","rent_office","rent_dorm","rent_shop","mgmt","infra"}  # per_sqm_month 缩放

# 14 份空续签(child) + 其 parent
children = q("SELECT c.id, c.parent_contract_id, c.start_date, c.end_date FROM contract c "
             "WHERE c.parent_contract_id IS NOT NULL "
             "AND NOT EXISTS(SELECT 1 FROM contract_billing_term t WHERE t.contract_id=c.id)")

todo, review = [], []
for cid, pid, cstart, cend in children:
    cid, pid = int(cid), int(pid)
    # 父标的段
    plines = q(f"SELECT property_type,location,fee_key,fee_name,bill_mode,unit_price,area,coeff,room_count,amount_override,seq,tax_rate,params,note "
               f"FROM contract_billing_term WHERE contract_id={pid} ORDER BY seq,id")
    if not plines: review.append((cid,pid,"父合同无标的段")); continue
    # 父阶梯:首段=最早,次段=覆盖child起始的段
    tiers = q(f"SELECT start_date,end_date,monthly_amount FROM contract_rent_tier WHERE contract_id={pid} ORDER BY seq")
    dt = [(s,e,float(m) if m not in ('NULL','',None) else None) for s,e,m in tiers]
    first = next((m for s,e,m in dt if m), None)
    nxt = next((m for s,e,m in dt if m and s!='NULL' and e!='NULL' and s<=cstart<=e), None)
    if not nxt: nxt = next((m for s,e,m in dt[1:] if m), None)   # 兜底取第2个有值档
    if not first or not nxt:
        review.append((cid,pid,"阶梯首段/次段缺月额")); continue
    ratio = round(nxt/first, 6)
    if ratio < 1 or ratio > 3:
        review.append((cid,pid,f"ratio异常={ratio}")); continue
    todo.append((cid, plines, ratio))

def esc(v): return "NULL" if v in ('NULL','',None) else "'"+v.replace("'","''")+"'"
def num(v): return "NULL" if v in ('NULL','',None) else v

for cid, plines, ratio in todo:
    vals=[]
    for pt,loc,fk,fn,bm,up,ar,co,rc,ao,sq,tr,pa,nt in plines:
        new_up = up
        if fk in SCALE_KEYS and bm=="per_sqm_month" and up not in ('NULL','',None):
            new_up = f"{round(float(up)*ratio,4)}"
        vals.append(f"({cid},{esc(pt)},{esc(loc)},{esc(fk)},{esc(fn)},{esc(bm)},{num(new_up)},{num(ar)},{num(co)},{num(rc)},{num(ao)},{num(sq)},{num(tr)},{esc(pa)},{esc(nt)},'manual')")
    q(f"DELETE FROM contract_billing_term WHERE contract_id={cid}")
    q("INSERT INTO contract_billing_term (contract_id,property_type,location,fee_key,fee_name,bill_mode,unit_price,area,coeff,room_count,amount_override,seq,tax_rate,params,note,source) VALUES "+",".join(vals))
    # 复算标量缓存(镜像 syncScalarCache):rentArea=建筑租金行(location,fee_key,area)去重和;无则回退 infra
    lines = q(f"SELECT fee_key,bill_mode,unit_price,area,amount_override,location FROM contract_billing_term WHERE contract_id={cid}")
    def dedup_area(keys):
        seen=set(); s=0.0
        for fk,bm,up,ar,ao,loc in lines:
            if fk in keys and ar not in ('NULL','',None):
                k=(loc,fk,str(round(float(ar),4)))
                if k not in seen: seen.add(k); s+=float(ar)
        return s
    has_rent = any(fk in BUILDING_RENT for fk,*_ in lines)
    rent_area = dedup_area(BUILDING_RENT) if has_rent else dedup_area({"infra"})
    building_area = round(rent_area*0.8,2) if rent_area>0 else None
    def first_up(pred):
        for fk,bm,up,ar,ao,loc in lines:
            if pred(fk,bm) and up not in ('NULL','',None): return up
        return None
    def first_ao(fkey):
        for fk,bm,up,ar,ao,loc in lines:
            if fk==fkey and ao not in ('NULL','',None): return ao
        return None
    up_rent = first_up(lambda fk,bm: fk in BUILDING_RENT and bm=="per_sqm_month")
    up_mgmt = first_up(lambda fk,bm: fk=="mgmt"); up_infra=first_up(lambda fk,bm: fk=="infra")
    ele=first_ao("elevator"); tr=first_ao("transformer")
    sets=[f"rent_area={rent_area}", f"building_area={'NULL' if building_area is None else building_area}",
          f"unit_price={num(up_rent)}", f"mgmt_fee_price={num(up_mgmt)}", f"infra_fee_price={num(up_infra)}",
          f"elevator_fee={num(ele)}", f"transformer_fee={num(tr)}"]
    q(f"UPDATE contract SET {','.join(sets)} WHERE id={cid}")

print(f"回填 {len(todo)} 份;待核对 {len(review)} 份")
for r in review: print("  待核对:", r)
```

- [ ] **Step 2: 跑回填**

Run: `python <scratchpad>/backfill_renewals.py`
Expected: 打印「回填 N 份；待核对 M 份」（N+M=14）。

- [ ] **Step 3: 验证（DB 断言）**

Run:
```bash
docker exec demo3-mysql sh -c 'MYSQL_PWD=root mysql -uroot park_demo3 -N -e "
SELECT COUNT(*) FROM contract c WHERE c.parent_contract_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM contract_billing_term t WHERE t.contract_id=c.id) AND c.id NOT IN (/*待核对id*/ 0);
SELECT c.contract_no, COUNT(t.id) lines, c.rent_area FROM contract c JOIN contract_billing_term t ON t.contract_id=c.id WHERE c.parent_contract_id IS NOT NULL GROUP BY c.id;"'
```
Expected: 已回填的续签 `lines>0`、`rent_area>0`；仅「待核对」份仍空。

- [ ] **Step 4: 浏览器核对锚点（人工，由主控做）**

打开 C2024M-009（采妍续签）→ 右侧详情应显示完整标的段与费用 + 面积 + 月租金合计，不再空白；月合计 ≈ 该续签阶梯次段合计（±1%）。

- [ ] **Step 5: 记录（不提交数据脚本）**

回填是 dev DB 数据操作，脚本留 scratchpad。把「回填 N 份 / 待核对清单」记入 plan 执行记录。

---

## Task 4: 全量把关 + 浏览器验收

**Files:** 无（验证）

- [ ] **Step 1: 前端全绿**

Run: `cd frontend && npm run typecheck && npm run test`
Expected: 全绿；无 FPRentTierBar/rentTier 残留引用。

- [ ] **Step 2: 浏览器验收（主控做，登 viewer/viewer123）**

逐条核 REWORK-SPEC §6 锚点：① master-detail 左列表右整页、点行右侧展开不弹模态；② C2024M-009 续签显示完整标的段；③ 详情有「合同月租金合计(标准)·参考」；④ 卡片无阶梯块；⑤ 14 份续签 rentArea>0；⑥ 待核对份不乱填。

- [ ] **Step 3: Commit 计划执行记录**

```bash
git add docs/superpowers/plans/2026-07-25-contract-billing-rework-phase-a.md
git commit -m "chore(contract): Phase A 执行记录(回填N份/待核对M份/锚点验收)"
```

---

## 执行编排（workflow）

```
串行:  Task 1(删阶梯+月合计) → Task 2(master-detail)   [同改 ContractDrawer,必须先后同人]
并行:  Task 3(回填14份续签)                            [数据,独立]
汇合:  Task 4(typecheck+test+浏览器验收)               [主控做浏览器部分]
```

**并行安全铁律**：Task 1/2 改 `ContractDrawer.vue`/`ContractsView.vue`，绝不与其它前端任务并行。Task 3 只碰 DB，安全并行。

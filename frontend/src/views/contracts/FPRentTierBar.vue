<script setup lang="ts">
// 租金阶梯期可视化(CONTRACT-CARD-V2-SPEC §5)。替代原「分年阶梯价」纯文本一坨。
// 阶梯=参考排程,不参与计费(§1);换档靠人工改合同现行单价,故有 §5.3 错档提示。
import { computed } from 'vue'
import type { RentTierDTO, FeeKey } from '@/types/contract'
import { FEE_NAME } from '@/types/contract'
import { groupTiers, currentTierIndex, tierMismatch } from './rentTier'
const props = defineProps<{ tiers: RentTierDTO[]; today: string; contractUnitPrice?: number | null }>()

const groups = computed(() => groupTiers(props.tiers))
const idxOf   = (rows: RentTierDTO[]) => currentTierIndex(rows, props.today)
const dated   = (rows: RentTierDTO[]) => rows.every(r => r.startDate && r.endDate)
// 告警轨=整份合同合计口径(feeKey 空)那组;缺则退首组。告警文案的档号必须取自同一组,勿另算。
const mismGrp = computed(() => groups.value.find(x => x.feeKey == null) ?? groups.value[0])
const mism    = computed(() =>
  mismGrp.value ? tierMismatch(mismGrp.value.rows, props.today, props.contractUnitPrice) : null)
const feeName = (k: string) => FEE_NAME[k as FeeKey] ?? k
const n = (v: number | null | undefined) => (v != null ? v.toLocaleString('en-US') : '—')
</script>

<template>
  <div v-if="props.tiers.length > 1" class="rt">
    <!-- §5.3 换档告警:人工换档流程唯一漏点=忘了改合同 -->
    <div v-if="mism" class="rt-warn">
      今天已进入第 {{ mismGrp ? idxOf(mismGrp.rows) + 1 : '?' }} 档（{{ n(mism.expected) }} 元/㎡·月），
      但合同现行单价为 {{ n(mism.actual) }} 元/㎡·月，请更新合同。
    </div>

    <div v-for="(g, gi) in groups" :key="gi" class="rt-grp">
      <div v-if="g.feeKey" class="rt-fee">{{ feeName(g.feeKey) }}</div>

      <!-- 分段条:有完整日期才按当前段高亮;相对期限退化为等分示意 -->
      <div class="rt-bar">
        <div v-for="(r, i) in g.rows" :key="r.id" class="rt-seg"
             :class="{ cur: dated(g.rows) && i === idxOf(g.rows) }">
          {{ r.label || ('第' + r.seq + '档') }}
        </div>
      </div>
      <div v-if="!dated(g.rows)" class="rt-rel">相对期限：具体日期以交付后书面确定</div>

      <div class="rt-head"><span class="fx">档</span><span>起止</span><span>单价</span><span>月额</span></div>
      <div v-for="(r, i) in g.rows" :key="'r' + r.id" class="rt-row"
           :class="{ cur: dated(g.rows) && i === idxOf(g.rows) }">
        <span class="fx">{{ r.label || ('第' + r.seq + '档') }}</span>
        <span class="mono">{{ r.startDate ? r.startDate + ' → ' + r.endDate : '—' }}</span>
        <span class="mono">{{ n(r.unitPrice) }}</span>
        <span class="mono">{{ n(r.monthlyAmount) }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rt { display:flex; flex-direction:column; gap:10px; }
.rt-warn { padding:7px 10px; border-radius:var(--radius-md); font-size:12px; line-height:1.5;
  background:rgba(255,149,0,.10); border:1px solid rgba(255,149,0,.35); color:var(--text-primary); }
.rt-grp { display:flex; flex-direction:column; gap:4px; }
.rt-fee { font-size:11.5px; color:var(--text-muted); }
.rt-bar { display:flex; gap:3px; }
.rt-seg { flex:1; padding:5px 4px; text-align:center; font-size:11px; border-radius:var(--radius-sm);
  background:var(--surface-card); color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.rt-seg.cur { background:var(--hue-blue); color:#fff; font-weight:var(--fw-semibold); }
.rt-rel { font-size:11px; color:var(--text-muted); }
.rt-head, .rt-row { display:grid; grid-template-columns:1.1fr 1.6fr .8fr .9fr; gap:6px; padding:4px 2px; align-items:baseline; }
.rt-head { font-size:11px; color:var(--text-muted); border-bottom:1px dashed var(--divider); }
.rt-head span:not(.fx), .rt-row span:not(.fx) { text-align:right; }
.rt-row { font-size:12.5px; border-top:1px dashed var(--divider); }
.rt-row.cur { font-weight:var(--fw-semibold); }
.rt-row .mono { font-family:var(--font-mono); }
</style>

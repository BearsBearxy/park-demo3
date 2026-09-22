<script setup lang="ts">
// 收款方(S20-BILL-DELIVERY-SPEC §2.2「去指定」落点):催缴单明细抽屉里的一段。
//
// 2026-09-23 照稿重画(画布「催缴单租户抽屉 · 整屏重设计」)。原来是一槽一张卡铺成网格 +
// 底部多选条,换成:
//   · 默认**收起成一条 40 px**,只报数(N 项待指定 / N 项已全部指定 · 公司分布)。
//     实测 161 户里 42 户已全部指定 —— 那一整片卡片对他们是纯噪音;54 户一个没设 ——
//     11 张卡各印一遍「未设置」也不比一个数字说得更多。
//   · 展开后是**一行一槽**的行表,没设的那一格直接是下拉,选完即落库 ——
//     原来要「勾卡片 → 底部选公司 → 应用」三步。
//   · ⚠ 这一条**恒出**,连「本户没有需要指定的费用」也留着条:抽屉里要按「下一户」走 158 次,
//     整块撤掉会让下面的费项表跳上去(稿上「换户时费项表不移动」那块画板钉的就是这条)。
//
// 只发事件不落库:保存由宿主(BillNoticesView 抽屉)统一提交 PUT /bills/paymap,失败提示也归宿主。
import { computed, ref, watch } from 'vue'
import type { S10ColId } from '@/types/s10'
import type { SlotCell } from '@/utils/payBookLogic'
import { fpMoney } from '@/utils/money'
import { iconFor } from '@/components/ds/icon'
import Select from '@/components/ds/Select.vue'

const props = withDefaults(defineProps<{
  cells: SlotCell[]
  companies: { id: number; name: string; short?: string }[]
  canEdit?: boolean
  saving?: boolean
  /** 该户本月的单仍按上次生成时的归属拆(gapOf):收起条上补一句,不另起一行 */
  stale?: boolean
}>(), { canEdit: true, saving: false, stale: false })

const emit = defineEmits<{ save: [{ colIds: S10ColId[]; companyId: number }] }>()

const open = ref(false)
// 换户后收回去:上一户展开着,下一户跟着展开会让费项表的位置随上一户的操作变
watch(() => props.cells, () => { open.value = false })

const coOpts = computed(() =>
  props.companies.map(c => ({ value: String(c.id), label: c.short || c.name })))

const gaps = computed(() => props.cells.filter(c => c.companyId == null).length)
// 已全部指定时报公司分布:比「6 项已全部指定」多说一件事 —— 钱分别进了谁的账
const spread = computed(() => {
  const n = new Map<string, number>()
  for (const c of props.cells) if (c.companyName) n.set(c.companyName, (n.get(c.companyName) ?? 0) + 1)
  return [...n].map(([name, k]) => `${name} ${k}`).join('、')
})

function pick(colId: string, v: string) {
  if (!props.canEdit || !v) return
  emit('save', { colIds: [colId] as S10ColId[], companyId: +v })
}
</script>

<template>
  <div class="psg">
    <!-- 收起条:三态同高 40 px。空态也出条(见顶部注释:撤掉会让费项表跳上去) -->
    <button type="button" class="psg-bar" :class="{ open }" :disabled="!cells.length"
            @click="cells.length && (open = !open)">
      <span class="psg-ttl">收款公司</span>
      <span v-if="!cells.length" class="psg-none">本户本月没有需要指定收款公司的费用</span>
      <span v-else-if="gaps" class="psg-pend"><b>{{ gaps }}</b> 项待指定</span>
      <template v-else>
        <span class="psg-done"><b>{{ cells.length }}</b> 项已全部指定<template v-if="spread"> · {{ spread }}</template></span>
        <!-- 屏上这些格子都已指定 ≠ 本月的单已按它们拆:单是生成那一刻拍的快照 -->
        <span v-if="stale" class="psg-stale">重新生成本月后,单才按新归属拆</span>
      </template>
      <span v-if="cells.length" class="psg-act">
        {{ open ? '收起' : (canEdit && gaps ? '展开指定' : '展开') }}
        <component :is="iconFor('chevron-down')" :size="13" :style="open ? 'transform:rotate(180deg)' : undefined" />
      </span>
    </button>

    <!-- 展开:一行一槽。没设的那一格直接是下拉,选完即落库 -->
    <div v-if="open && cells.length" class="psg-rows">
      <div class="psg-row hd">
        <span>收款槽</span><span>承接的费项</span><span class="am">本期金额</span><span>收款公司</span>
      </div>
      <div v-for="c in cells" :key="c.colId" class="psg-row" :class="{ gap: c.companyId == null }">
        <span class="nm">{{ c.label }}<em v-if="c.note" class="psg-tag">整单通吃</em></span>
        <span class="it" :title="c.items.join('、')">{{ c.items.join('、') }}</span>
        <span class="am">{{ c.amount == null ? '–' : fpMoney(c.amount) }}</span>
        <span class="co">
          <Select v-if="canEdit" :options="coOpts" :model-value="c.companyId == null ? '' : String(c.companyId)"
                  size="sm" placeholder="选择公司" :invalid="c.companyId == null" :disabled="saving"
                  @update:model-value="pick(c.colId, $event)" />
          <template v-else>
            <span v-if="c.companyId != null" class="psg-pill">{{ c.companyName }}</span>
            <span v-else class="psg-ro-none">未设置</span>
          </template>
          <em v-if="c.inherit" class="psg-inh">{{ c.inherit }}</em>
          <em v-else-if="c.neverSeeded && c.companyId == null" class="psg-inh">系统从无默认</em>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.psg { display: flex; flex-direction: column; }

/* 收起条 */
.psg-bar {
  display: flex; align-items: center; gap: 10px; width: 100%; height: 40px; padding: 0 14px;
  border: 1px solid var(--border-subtle); border-radius: var(--radius-md);
  background: var(--surface-card); font-family: var(--font-sans); font-size: var(--fs-label);
  color: var(--text-secondary); cursor: pointer; text-align: left;
  transition: border-color var(--dur-fast) var(--ease-standard);
}
.psg-bar:hover:not(:disabled) { border-color: var(--border-strong); }
.psg-bar:disabled { cursor: default; }
.psg-bar.open { border-bottom-left-radius: 0; border-bottom-right-radius: 0; border-bottom-color: transparent; }
.psg-ttl { flex: 0 0 auto; font-weight: var(--fw-semibold); color: var(--text-primary); }
.psg-bar b { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-weight: var(--fw-semibold); }
.psg-pend {
  display: inline-flex; align-items: center; gap: 5px; height: 22px; padding: 0 10px;
  border-radius: var(--radius-full); background: var(--warn-soft); color: var(--warn-text); font-weight: var(--fw-medium);
}
.psg-pend::before { content: ""; width: 6px; height: 6px; border-radius: var(--radius-full); background: var(--hue-orange); }
.psg-done, .psg-none { color: var(--text-muted); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.psg-stale { flex: 0 0 auto; color: var(--warn-text); }
.psg-act { margin-left: auto; flex: 0 0 auto; display: inline-flex; align-items: center; gap: 4px; color: var(--text-link); }

/* 行表 */
.psg-rows { border: 1px solid var(--border-subtle); border-top: none; border-radius: 0 0 var(--radius-md) var(--radius-md); overflow: hidden; }
.psg-row {
  /* 末列要同时放下拉 + 「继承自X」/「系统从无默认」那行小字 —— 真屏实测 170px 会把小字挤出去 */
  display: grid; grid-template-columns: minmax(110px, 1.2fr) minmax(0, 1.6fr) 92px 216px;
  align-items: center; gap: 10px; padding: 0 12px; min-height: 38px;
  background: var(--surface-white); font-size: var(--fs-label);
}
.psg-row + .psg-row { border-top: 1px solid var(--divider); }
.psg-row.hd { min-height: 28px; background: var(--surface-card); color: var(--text-muted); font-size: var(--fs-micro); }
.psg-row .nm { display: flex; align-items: center; gap: 6px; font-weight: var(--fw-medium); color: var(--text-primary); }
.psg-row .it { color: var(--text-muted); font-size: var(--fs-micro); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.psg-row .am { text-align: right; font-family: var(--font-mono); font-variant-numeric: tabular-nums; color: var(--text-secondary); }
.psg-row .co { display: flex; align-items: center; gap: 8px; min-width: 0; }
.psg-row .co > :first-child { flex: 0 0 132px; }
.psg-tag { font-style: normal; padding: 1px 6px; border-radius: var(--radius-full); background: var(--surface-sunken); font-size: var(--fs-micro); color: var(--text-muted); }
.psg-pill { display: inline-flex; align-items: center; height: 22px; padding: 0 10px; border-radius: var(--radius-full); background: var(--accent-slate); color: var(--slate-text); font-weight: var(--fw-medium); }
.psg-ro-none { color: var(--orange-text); }
.psg-inh { flex: 1 1 auto; min-width: 0; font-style: normal; font-size: var(--fs-micro);
           color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>

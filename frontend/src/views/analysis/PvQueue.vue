<script setup lang="ts">
/**
 * PvQueue —— PV-ANALYSIS-SPEC §06.3 左栏楼栋队列(L1)。
 *
 * **纯文字 + 数字,一张图都不画。** 判据线已经替用户决定了「是哪栋」——那是文字和数字的活;
 * 右边那张大图的职责是看清那一栋(§00 v3 #1)。
 *
 * 两条必须守住的:
 * ① **排序键就印在行右边那两列** —— 出范围刻度数、最大偏离。顺序可复算、可反对,
 *    行上不出现任何判词(§05)。
 * ② **第三档「读不出」必须存在**(§04.3)。覆盖不足 / 月频口径的栋落进「未低于你设的线」
 *    就是假绿 —— §07 里写着「这里最容易出」。
 *
 * 「未低于你设的线」不写「正常」:阈值是用户设的,前者更准,也让人随时想起那条线可以改。
 * 「读不出」不写「无数据」:后者是判词。
 *
 * 点任意一栋都能换图,包括「未低于线」的那些 —— 判据线决定谁进命中组,不决定谁能被看。
 */
import { computed, ref } from 'vue'
import type { BoardRow } from './pvMeterAna.logic'

// unit 必须由父层给:年档的刻度是「个月」不是「天」,写死会在按年档显示成「天/12」。
// 这是契约之外补的一个 prop —— 组件自己够不到 gran,父层才知道现在是哪一档。
const props = withDefaults(
  defineProps<{ rows: BoardRow[]; selId: number | null; unborn: string[]; unit?: string }>(),
  { unit: '天' },
)
const emit = defineEmits<{ (e: 'pick', id: number): void }>()

const openHit = ref(true)      // ① 出范围段:默认展开
const openQuiet = ref(false)   // ② 未低于你设的线:默认折叠
const openThin = ref(false)    // ③ 读不出:默认折叠

/**
 * 「读不出」的两种,组内要分行标注是哪一种 —— 合成一句「无数据」就把
 * 「口径不同」和「没抄够」混成同一件事了。
 * 判据线(coverMonth / bandRun)不在本组件的入参里,所以这里**不猜阈值**:
 * 只认三件从行本身读得出来的事实。
 */
function thinWhy(r: BoardRow): string | null {
  if (r.cadence === 'monthly') return '月频口径'
  if (r.seenN === 0) return `未抄 0/${r.elapsedN}`
  if (r.center == null) return `范围估不出 ${r.seenN}/${r.elapsedN}`
  return null
}

/** 排序:出范围刻度数降序 → 最大偏离绝对值降序 → id。三段全部印在屏上。 */
function cmp(a: BoardRow, b: BoardRow): number {
  return b.outN - a.outN || Math.abs(b.maxDev) - Math.abs(a.maxDev) || a.id - b.id
}

// 未投产的不占行(下面单独一句话),也不该混进三个组里被当成漏抄
const born = computed(() => props.rows.filter(r => r.bornBySeg))

const thin = computed(() => born.value.filter(r => thinWhy(r) !== null).sort(cmp))
const hit = computed(() =>
  born.value.filter(r => thinWhy(r) === null && r.runs.length > 0).sort(cmp))
const quiet = computed(() =>
  born.value.filter(r => thinWhy(r) === null && r.runs.length === 0).sort(cmp))

/** 列头的 N = **已过去**刻度数,不是整段 —— 月中打开时分母写整月,13 栋会一股脑掉进「读不出」(§03.8)。 */
const elapsed = computed(() => Math.max(0, ...props.rows.map(r => r.elapsedN)))

/** 首条抄表日期由行给,`unborn` 若已自带日期则原样出 —— 两种上游都不至于把日期丢掉。 */
const unbornText = computed(() => {
  const first = new Map(props.rows.filter(r => !r.bornBySeg).map(r => [r.name, r.firstDate]))
  return props.unborn.map(n => (first.get(n) ? `${n}（首条抄表 ${first.get(n)}）` : n))
})

const empty = computed(() => !born.value.length && !props.unborn.length)

// 方向靠 ▲▼ + 位置,不靠色相 —— 上越下越共用 --hue-orange 一个色(§06.7)
const arrow = (r: BoardRow) => (r.maxDev < 0 ? '▼' : r.maxDev > 0 ? '▲' : '')

function dev(r: BoardRow): string {
  if (!r.seenN || !Number.isFinite(r.maxDev) || r.maxDev === 0) return '—'
  const p = r.maxDev * 100
  return `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`
}
</script>

<template>
  <div class="pq">
    <div class="pq-hd">
      <span aria-hidden="true"></span>
      <span>楼栋</span>
      <span class="n">{{ unit }}/{{ elapsed }}</span>
      <span class="n">最大偏离</span>
    </div>

    <!-- ① 出范围段。0 命中时整组不渲染,不留一个 0 行的空标题(§08 v3-9) -->
    <template v-if="hit.length">
      <button type="button" class="pq-gh" @click="openHit = !openHit">
        <span class="ar" :class="{ open: openHit }">▸</span>
        <span>出范围段</span>
        <span class="c">{{ hit.length }}</span>
      </button>
      <div v-show="openHit" class="pq-body cap-hit">
        <button
          v-for="r in hit" :key="r.id" type="button"
          class="pq-row out" :class="{ on: r.id === selId }"
          @click="emit('pick', r.id)"
        >
          <span class="ar2">{{ arrow(r) }}</span>
          <span class="nm" :title="r.name">{{ r.name }}</span>
          <span class="n">{{ r.outN }}</span>
          <span class="n">{{ dev(r) }}</span>
        </button>
      </div>
    </template>

    <!-- ② 「未低于你设的线」不是「正常」:线是用户画的,他随时能改 -->
    <template v-if="quiet.length">
      <button type="button" class="pq-gh" @click="openQuiet = !openQuiet">
        <span class="ar" :class="{ open: openQuiet }">▸</span>
        <span>未低于你设的线</span>
        <span class="c">{{ quiet.length }}</span>
      </button>
      <div v-show="openQuiet" class="pq-body cap-rest">
        <button
          v-for="r in quiet" :key="r.id" type="button"
          class="pq-row" :class="{ on: r.id === selId }"
          @click="emit('pick', r.id)"
        >
          <span class="ar2">{{ arrow(r) }}</span>
          <span class="nm" :title="r.name">{{ r.name }}</span>
          <span class="n">{{ r.outN }}</span>
          <span class="n">{{ dev(r) }}</span>
        </button>
      </div>
    </template>

    <!-- ③ 读不出:既不是命中也不是未命中。组内分行标注是哪一种 -->
    <template v-if="thin.length">
      <button type="button" class="pq-gh" @click="openThin = !openThin">
        <span class="ar" :class="{ open: openThin }">▸</span>
        <span>读不出</span>
        <span class="c">{{ thin.length }}</span>
      </button>
      <div v-show="openThin" class="pq-body cap-rest">
        <button
          v-for="r in thin" :key="r.id" type="button"
          class="pq-row dim" :class="{ on: r.id === selId }"
          @click="emit('pick', r.id)"
        >
          <span class="ar2"></span>
          <span class="nm" :title="r.name">{{ r.name }}</span>
          <span class="why">{{ thinWhy(r) }}</span>
        </button>
      </div>
    </template>

    <!-- ④ 尚未投产:不占行。它没数据不是漏抄,是那时候还没建 -->
    <p v-if="unbornText.length" class="pq-un">
      {{ unbornText.length }} 栋在这一段还没投产，不画：{{ unbornText.join('、') }}
    </p>

    <p v-if="empty" class="pq-un">这一段没有已投产的楼栋。</p>
  </div>
</template>

<style scoped>
/* 268px 与右侧大图在主卡里对半分(§06.3 grid-template-columns: 268px minmax(0,1fr)) */
.pq { width: 268px; display: flex; flex-direction: column; gap: 2px; }

.pq-hd,
.pq-row {
  display: grid;
  grid-template-columns: 12px minmax(0, 1fr) 30px 56px;
  gap: 0 6px;
  align-items: center;
}
.pq-hd {
  height: 20px;
  font-size: var(--fs-micro);
  color: var(--text-muted);
  border-bottom: 1px solid var(--divider);
  margin-bottom: 2px;
}
.pq-hd .n { font-family: var(--font-mono); font-variant-numeric: tabular-nums; text-align: right; }

/* 组名与计数常驻:折叠只收行,不收标题 —— 收了标题,「读不出 3 栋」就在屏上消失了 */
.pq-gh {
  display: flex; align-items: center; gap: 6px; width: 100%;
  height: 22px; padding: 0 2px; margin-top: 4px;
  background: none; border: 0; cursor: pointer; text-align: left;
  font-family: var(--font-sans); font-size: var(--fs-micro); color: var(--text-muted);
}
.pq-gh:hover { color: var(--text-secondary); background: var(--bg-hover); border-radius: 4px; }
.pq-gh .ar { transition: transform var(--dur-fast); }
.pq-gh .ar.open { transform: rotate(90deg); }
.pq-gh .c {
  margin-left: auto; padding-right: 4px;
  font-family: var(--font-mono); font-variant-numeric: tabular-nums;
}

/* 命中 >4 栋时组内滚动,主卡高度钉死(§06.1);展开「未低于线」由页面滚动承接 */
.pq-body { display: flex; flex-direction: column; }
.pq-body.cap-hit { max-height: 104px; overflow-y: auto; }
.pq-body.cap-rest { max-height: 190px; overflow-y: auto; }

.pq-row {
  height: 26px; width: 100%; padding: 0 4px 0 2px;
  background: none; border: 0; border-radius: 4px; cursor: pointer;
  font-family: var(--font-sans); color: var(--text-primary);
}
/* 元素间不用实线:hover 与选中都走底色(国内 B 端惯例) */
.pq-row:hover { background: var(--bg-hover); }
.pq-row.on { background: var(--surface-sunken); box-shadow: inset 2px 0 0 var(--ink-300); }
.pq-row.on .nm { font-weight: var(--fw-semibold); }

.pq-row .ar2 { font-size: 9px; line-height: 1; color: var(--text-muted); }
.pq-row .nm {
  font-size: var(--fs-label); text-align: left;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.pq-row .n {
  font-family: var(--font-mono); font-variant-numeric: tabular-nums;
  font-size: var(--fs-micro); color: var(--text-secondary); text-align: right;
}

/* 出范围的两个数与方向标共用 --hue-orange(#9D5D17):强调色只在 L0/L1 */
.pq-row.out .ar2,
.pq-row.out .n { color: var(--hue-orange); }
.pq-row.out .nm { color: var(--text-primary); }

.pq-row.dim .nm { color: var(--text-secondary); }
.pq-row .why {
  grid-column: 3 / -1;
  font-size: var(--fs-micro); color: var(--text-muted); text-align: right;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

.pq-un {
  margin: 6px 0 0; font-size: var(--fs-micro); color: var(--text-muted); line-height: 1.6;
}

/* ≤1100 队列从大图左侧改到上方(§06.7),这时候不再钉 268px */
@media (max-width: 1100px) { .pq { width: 100%; } }
</style>

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
/**
 * 未投产的**按首条抄表日期归并**。
 *
 * 逐栋各带一个「（首条抄表 2025-06-01）」的话,8 栋会把同一个日期重复 6 遍,
 * 拼出一段 90 字的墙 —— 与 B0 横幅、大图页脚是同一个病。
 * 同一批投产的栋本来就该被读成一批。
 */
const unbornGroups = computed(() => {
  const first = new Map(props.rows.filter(r => !r.bornBySeg).map(r => [r.name, r.firstDate]))
  const by = new Map<string, string[]>()
  for (const n of props.unborn) {
    const d = first.get(n) ?? ''
    const k = by.get(d)
    if (k) k.push(n); else by.set(d, [n])
  }
  return [...by].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([d, names]) => ({ at: d ? d.slice(5) : '', names }))
})

const empty = computed(() => !born.value.length && !props.unborn.length)

// 方向靠 ▲▼ + 位置,不靠色相 —— 上越下越共用 --hue-orange 一个色(§06.7)。
// **只有成段的行才有方向。** 一栋 0 天出范围却挂着 ▲,方向标记在那里没有指涉物,
// 还会让未命中行看起来像命中(实屏上 C、D座 0 天 ▲ +62.6% 就是这么来的)。
const arrow = (r: BoardRow) => {
  if (!r.runs.length) return ''
  return r.runs[0].dir < 0 ? '▼' : '▲'
}

/**
 * 数字列必须**印着分组依据**(§06.3「排序键就印在行右边那一列,顺序可复算、可反对」)。
 *
 * 原来印的是「天」与「最大偏离」,两个都不是分组依据 —— 分组看的是**段**
 * (连续 ≥bandRun 个已抄刻度同向)。实屏上因此出现:
 *   11栋 14 天 +131.8% → 进「出范围段」
 *   10栋  8 天 **+170.9%** → 没进
 * 偏离更大反而没命中,用户没法从行上复算出为什么。
 *
 * 改成印「段」与「天」:段决定进哪一组,天决定组内的先后,两个都在行上。
 * 最大偏离挪走 —— 它对 0 天出范围的行本来就没有指涉(那是「离中心最远的那天」,
 * 而那天在范围内),留在这里只会被读成「超了 62.6%」。选中后大图卡头写着它。
 */
const segN = (r: BoardRow) => (r.runs.length ? `${r.runs.length} 段` : '')
</script>

<template>
  <div class="pq">
    <div class="pq-hd">
      <span aria-hidden="true"></span>
      <span>楼栋</span>
      <span class="n">{{ unit }}/{{ elapsed }}</span>
      <span class="n">段</span>
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
          <span class="n seg">{{ segN(r) }}</span>
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
          <span class="n seg">{{ segN(r) }}</span>
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
    <div v-if="unbornGroups.length" class="pq-un">
      <div class="t">{{ unborn.length }} 栋本段未投产，不画</div>
      <div v-for="g in unbornGroups" :key="g.at" class="g">
        <span v-if="g.at" class="at">{{ g.at }} 起</span>
        <span class="ns">{{ g.names.join(' ') }}</span>
      </div>
    </div>

    <div v-if="empty" class="pq-un"><div class="t">这一段没有已投产的楼栋</div></div>
  </div>
</template>

<style scoped>
/* 268px 与右侧大图在主卡里对半分(§06.3 grid-template-columns: 268px minmax(0,1fr))
 *
 * **整体钉高 + 内部滚动。** 队列原来没有整体上限,只有每组各自的 ——
 * 展开「未低于你设的线」会把主卡从 638 撑到 830(实屏量的),
 * 段控与下面所有卡整体下移 192px。用户点一下队列,半屏跳一次。
 * 钉在与右侧大图同高(PvDayChart 的 .pdc 实测 248px)之后,卡高由**图**决定,
 * 展开哪一组都只在队列内部滚,版面纹丝不动。 */
.pq {
  width: 268px; display: flex; flex-direction: column; gap: 2px;
  max-height: 248px; overflow-y: auto; overscroll-behavior: contain;
}

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

/* 组内**不再单独滚动** —— 外层 .pq 已经兜住卡高,套两层滚动条只会更难用 */
.pq-body { display: flex; flex-direction: column; }

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

/* 「段」列:未成段的行留空(而不是写 0)—— 空白本身就说明它不在那一组 */
.pq-row .n.seg { color: var(--text-muted); }
.pq-row.out .n.seg { color: var(--hue-orange); }

/* 未投产:按首条抄表日期归并成几行,不再逐栋各带一个括号 */
.pq-un {
  margin: 8px 0 0; padding-top: 6px; border-top: 1px solid var(--divider);
  font-size: var(--fs-micro); color: var(--text-muted); line-height: 1.55;
}
.pq-un .t { margin-bottom: 2px; }
.pq-un .g { display: flex; gap: 6px; align-items: baseline; }
.pq-un .at {
  flex: 0 0 auto; font-family: var(--font-mono); font-variant-numeric: tabular-nums;
  color: var(--ink-300);
}
.pq-un .ns { min-width: 0; }

/* ≤1100 队列从大图左侧改到上方(§06.7),这时候不再钉 268px */
@media (max-width: 1100px) { .pq { width: 100%; } }
</style>

<script setup lang="ts">
/**
 * S 档(≤600)宽表行→卡片的**唯一模板**(响应式稿 WideCardVariants 板 §3)。
 *
 * 稿把五张 B 级宽表判到三种密度,调用方只给一个 `fields(row)` 映射,版式不逐屏手写:
 *   64 紧凑 —— 损益附表(年度矩阵,17 列)        两行,金额挤在第一行右端
 *   88 标准 —— 月度台账 / 附表10 / 附表12 工资 / 附表11 电费 / 科目余额表
 *                                               三行,金额独占第二行 mono 20
 *   96 带条 —— 标准 + 底部 4px 比值条。**当前无调用方**,见下。
 *
 * **96 档为什么现在没人用**:稿 §3 行5 把附表11 判成「带收缴条 96」,理由是
 * 「这屏有一个天然的 0–100% 比值(损耗率 / 分摊占比)」。对稿时实测不成立 ——
 * `types/elec.ts:25` 的 `ElecRecordDTO` 是**对外电费进项发票**(期别 / 时段 / 用电类别 /
 * qty / price / amount / tax / total),既没有楼栋也没有损耗率;损耗率的分母(供电侧电量)
 * 在楼栋损耗那一屏(`/alloc/loss`),跨屏取数是另一件活。所以附表11 降成 88 无条,
 * 96 档的实现留着(有断言钉住),等真有比值的表来用。
 *
 * 不卡片化的表不用这个组件:三大报表(资产负债表 / 利润表 / 现金流量表,只有 1~2 根数值列)
 * 走首列 sticky,colgroup 定宽表(催缴单 / 计费参数 / 充电桩 / MeterLedgerGrid)列永不增删,
 * 窄了只许横滚。
 *
 * 硬条件(稿 §2「三种都满足的硬条件」五条,前四条逐条有断言 —— fpWideCards.spec.ts):
 *   ① 定高(骨架卡与真卡同几何,数据落进来零位移)
 *   ② 整卡可点 :active 反馈(触屏无 hover)
 *   ③ 字号只取阶梯 20/14/12/11
 *   ④ 金额 mono + tabular-nums + 负号 U+2212
 *   ⑤「每页固定 10 张,FPPager 留在卡列底部」—— **不做**。实测六张宽表桌面端
 *      一处分页器都没有(grep Pagination|FPPager|useFitRows 全为 0),给 S 档单独加分页
 *      等于手机上看到的行数和桌面不一样,与「M 档不许删列」同一条理由。
 *      稿这一条是从 mx 列表页那套抄过来的 —— 那边桌面本来就有分页器,这边没有。
 */
import { computed } from 'vue'
import { useViewport } from '@/composables/useViewport'

export type WideCardTone = 'ok' | 'warn' | 'info'

export interface WideCard {
  /** 第一行主字段(租户名 / 姓名 / 科目细分 / 楼栋) */
  name: string
  /** 主金额。88/96 档独占第二行 mono 20;64 档贴第一行右端 mono 14 */
  amount: string
  /** 末行一句次级信息(「已收 ¥x · 收缴 y%」)。64 档是第二行灰字 */
  sub?: string
  /** 状态胶囊。88/96 贴第一行右端;64 档退成末行右端的 mono 数(稿 §2 紧凑档画法) */
  pill?: { text: string; tone: WideCardTone } | null
  /** 0–100 比值条,只有 96 档画(收缴率 / 损耗率) */
  bar?: number | null
}

const props = withDefaults(defineProps<{
  rows: any[]
  /** 行身份:字段名或取值函数(台账是 ledgerRowKey(row),不是某个字段) */
  rowKey: string | ((row: any) => string | number)
  fields: (row: any) => WideCard
  density?: 64 | 88 | 96
  /** 数据未到时先画几张同高骨架卡(0 = 不画) */
  skeletonRows?: number
  selectedKey?: string | number | null
}>(), { density: 88, skeletonRows: 0, selectedKey: null })

defineEmits<{ rowClick: [row: any] }>()

// jsdom/SSR 无 matchMedia → tier 恒 'xl',既有桌面测试走表格分支不变(与 FPLedgerTable 同一处理)
const { tier } = useViewport()
const keyOf = (r: any) => (typeof props.rowKey === 'function' ? props.rowKey(r) : r[props.rowKey])
// 映射一次:模板里 `fields(r)` 会在每次 patch 重算 27 列的取值,行多时白烧
const cards = computed(() => props.rows.map(r => ({ r, k: keyOf(r), f: props.fields(r) })))
</script>

<template>
  <!-- 宽档由调用方渲染原表;本组件只在 S 档出卡列 -->
  <div v-if="tier === 's'" class="fpwc">
    <!-- 骨架卡:与真卡同一个 .fpwc-c 定高与行结构,换的只是格子里的微光条 -->
    <div
      v-for="i in (skeletonRows || 0)"
      :key="'sk-' + i"
      class="fpwc-c" :class="'d' + density"
      aria-hidden="true"
    >
      <div class="r1">
        <span class="fp-shim nm-sk" :style="{ width: [52, 40, 46, 58][i % 4] + '%' }"></span>
        <span class="fp-shim pill-sk"></span>
      </div>
      <span v-if="density !== 64" class="fp-shim amt-sk"></span>
      <span class="fp-shim sub-sk"></span>
      <div v-if="density === 96" class="bar"><i style="width:0"></i></div>
    </div>

    <div
      v-for="c in cards"
      :key="c.k"
      class="fpwc-c" :class="['d' + density, { 'is-selected': selectedKey != null && c.k === selectedKey }]"
      @click="$emit('rowClick', c.r)"
    >
      <div class="r1">
        <span class="nm" :title="c.f.name">{{ c.f.name }}</span>
        <!-- 64 档没有第二行大字,金额贴在第一行右端(稿 §2 紧凑档) -->
        <span v-if="density === 64" class="amt sm">{{ c.f.amount }}</span>
        <span v-else-if="c.f.pill" class="pill" :class="c.f.pill.tone">
          <i class="d"></i>{{ c.f.pill.text }}
        </span>
      </div>
      <div v-if="density !== 64" class="amt">{{ c.f.amount }}</div>
      <div class="r2">
        <span v-if="c.f.sub" class="sub">{{ c.f.sub }}</span>
        <!-- 紧凑档的状态退成末行右端一个 mono 数:22px 胶囊塞不进 64 的两行 -->
        <span v-if="density === 64 && c.f.pill" class="bal" :class="c.f.pill.tone">{{ c.f.pill.text }}</span>
      </div>
      <div v-if="density === 96" class="bar">
        <i :style="{ width: Math.max(0, Math.min(100, c.f.bar ?? 0)) + '%' }"></i>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 像素照抄 WideCardVariants.dc.html 的 .lgc 系(卡片密度板,三档同一套类,只换定高) */
.fpwc-c {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 5px;
  padding: 0 4px;
  border-bottom: 1px solid var(--divider);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard);
}
/* 定高三档:骨架卡与真卡走同一条规则,零位移靠它(稿 §2 硬条件①) */
.fpwc-c.d64 { height: 64px; }
.fpwc-c.d88 { height: 88px; }
.fpwc-c.d96 { height: 96px; }
.fpwc-c:active { background: var(--bg-panel); }      /* 触屏无 hover,点按反馈用 :active(硬条件②) */
.fpwc-c.is-selected { background: var(--row-selected); }

.r1 { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.nm { flex: 1; min-width: 0; font-size: 14px; line-height: 20px; font-weight: var(--fw-medium); color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* 金额:mono + tabular-nums,负号由调用方用 U+2212(硬条件④,money.ts/finFmt.ts 已统一) */
.amt { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 20px; line-height: 26px; font-weight: var(--fw-semibold); color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.amt.sm { flex: 0 0 auto; font-size: 14px; line-height: 20px; }

.r2 { display: flex; align-items: center; gap: 10px; min-width: 0; font-size: 11px; line-height: 16px; color: var(--text-muted); }
.d64 .r2 { font-size: 12px; line-height: 18px; }
.sub { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bal { margin-left: auto; flex: 0 0 auto; font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 12px; font-weight: var(--fw-semibold); }

/* 状态胶囊:稿 .badge.sub —— 无底色,只有 6px 圆点 + 文字(有底色的 22px 胶囊会把长租户名挤没) */
.pill { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px; height: 22px; padding: 0 2px; font-size: 12px; font-weight: var(--fw-medium); line-height: 1; white-space: nowrap; }
.pill .d { width: 6px; height: 6px; border-radius: 50%; flex: 0 0 auto; }
.pill.ok   { color: var(--ok-text); }      .pill.ok   .d { background: var(--hue-green); }
.pill.warn { color: var(--amber-text); }   .pill.warn .d { background: var(--hue-orange); }
.pill.info { color: var(--hue-blue); }     .pill.info .d { background: var(--hue-blue); }
.bal.ok { color: var(--ok-text); } .bal.warn { color: var(--amber-text); } .bal.info { color: var(--hue-blue); }

.bar { height: 4px; border-radius: 999px; background: var(--ink-100); overflow: hidden; margin-top: 2px; flex: 0 0 auto; }
.bar i { display: block; height: 100%; border-radius: 999px; background: var(--fill-blue); }

/* 骨架条:宽度写死,几何与真卡各行等高 */
.nm-sk { display: block; height: 14px; border-radius: 3px; }
.pill-sk { display: block; flex: 0 0 auto; width: 56px; height: 12px; border-radius: 3px; }
.amt-sk { display: block; width: 104px; height: 20px; margin: 3px 0; border-radius: 3px; }
.sub-sk { display: block; width: 62%; height: 11px; border-radius: 3px; }
</style>

<script setup lang="ts">
import Avatar from '@/components/ds/Avatar.vue'
import { usePresenceStore } from '@/stores/presence'

// 明确选期门 v3(BOOK-WORKBENCH-SPEC §5,2026-08-24 拍板):年份 tab 退场,
// 全部年份纵排一屏——每年一行 12 张月卡,点月卡才进宽表(§7-1 不变)。
// 年份增删:「＋ 补更早年份」(右上)向前补一年,「＋ 添加 {次年} 年」(底行)向后补;
// 手工添加且整年仍为空的年,行尾可「移除」(槽位常驻占宽,hover 行才显——布局稳定铁律)。
// 纯展示组件,不发请求;年份范围与 removable 判定由上层用 utils/matrixYears 组好传入。
import { computed } from 'vue'
import { Plus, X } from 'lucide-vue-next'

interface MonthCell {
  month: number
  hasData: boolean
  rowCount?: number
  cur?: boolean
  /**
   * 出账链专用（设计稿 §①）：这个月几道工序各自做没做。传了就取代行数徽标 ——
   * 一个格子只讲一件事，「12 行」和「四道工序」挤在一起谁都读不清。
   * 台账 / 附表10 / 三大报表不传，走原来的行数徽标。
   */
  pips?: boolean[]
  /** 参数改动晚于快照 → 屏上数字是旧的。只换底色，不加边框（布局稳定铁律）。 */
  stale?: boolean
}
interface YearRow {
  year: number
  months: MonthCell[]
  sub?: string          // 年标下小字:手工年 / 当前年
  removable?: boolean   // 手工年且整年为空 → 行尾显「移除」
}

const props = defineProps<{
  /** 这一格的锁作用域（如 (y,m) => S.ledger(companyId, y, m)）。不传 = 不显示在场标记。 */
  scopeOf?: (year: number, month: number) => string | null
  /**
   * 「有没有选中的东西」这一个比特 —— 组件不读它任何字段，只拿来决定
   * 渲染矩阵还是渲染「请选择账册」占位。台账/附表10 传 Book，
   * 出账链没有册的概念，传个非空对象即可（ChainMonthGate）。
   */
  book: object | null
  years: YearRow[]      // 升序;上层负责连续补满
}>()

// 只标编辑态(设计稿 §04):标记要回答的只有「我点进去改得了吗」,别人在看不挡你。
const presence = usePresenceStore()
function editorOf(year: number, month: number) {
  const sc = props.scopeOf?.(year, month)
  if (!sc) return null
  return presence.editorsUnder(sc).find((e) => !e.self) ?? null
}

const emit = defineEmits<{
  (e: 'pick', year: number, month: number): void
  (e: 'add-earlier'): void
  (e: 'add-later'): void
  (e: 'remove-year', year: number): void
}>()

const nextYear = computed(() =>
  props.years.length ? props.years[props.years.length - 1].year + 1 : new Date().getFullYear())
</script>

<template>
  <div class="bmm">
    <template v-if="book && years.length">
      <div class="bmm-top">
        <button class="bmm-addy" @click="emit('add-earlier')">
          <Plus :size="13" />补更早年份
        </button>
      </div>

      <div v-for="y in years" :key="y.year" class="bmm-yrow">
        <div class="bmm-ylabel">
          <div class="bmm-y">{{ y.year }}</div>
          <div v-if="y.sub" class="bmm-ysub">{{ y.sub }}</div>
        </div>
        <div class="bmm-cells">
          <button
            v-for="m in y.months"
            :key="m.month"
            class="bmm-card"
            :class="[m.hasData ? 'has' : 'blank', { cur: m.cur, stale: m.hasData && m.stale }]"
            :title="m.hasData && m.stale ? '参数改动晚于快照 —— 屏上数字是旧的，需重算' : undefined"
            @click="emit('pick', y.year, m.month)"
          >
            <span class="bmm-month">{{ m.month }}月</span>
            <!-- 在场标记(PRESENCE §04)。**绝对定位** —— 有人在编辑和没人在编辑,格子尺寸完全一样。
                 这里是「选哪个月进去」的决策点,也是最该标的地方。 -->
            <span v-if="editorOf(y.year, m.month)" class="bmm-who"
                  :title="`${editorOf(y.year, m.month)!.displayName} 正在编辑`">
              <Avatar :uid="editorOf(y.year, m.month)!.user"
                      :name="editorOf(y.year, m.month)!.displayName" :size="20" class="bmm-av" />
            </span>
            <!-- 出账链:四道工序点。空月不画点 —— 它本来就是一张「空」的虚线卡 -->
            <span v-if="m.hasData && m.pips" class="bmm-pips">
              <i v-for="(p, i) in m.pips" :key="i" class="bmm-pip" :class="{ on: p }" />
            </span>
            <span v-else-if="m.hasData && m.rowCount != null" class="bmm-count">{{ m.rowCount }} 行</span>
            <span v-else-if="!m.hasData" class="bmm-none">空</span>
          </button>
        </div>
        <!-- 移除槽常驻占宽:hover 行且 removable 才显,不挤动月卡网格 -->
        <span class="bmm-rm-slot">
          <button v-if="y.removable" class="bmm-rm" :title="`移除 ${y.year} 年(仅本机,录入数据后自动转正)`"
                  @click="emit('remove-year', y.year)">
            <X :size="12" />移除
          </button>
        </span>
      </div>

      <div class="bmm-yrow bmm-addrow">
        <div class="bmm-ylabel"></div>
        <button class="bmm-addbtn" @click="emit('add-later')">
          <Plus :size="13" />添加 {{ nextYear }} 年
        </button>
        <span class="bmm-rm-slot"></span>
      </div>
    </template>
    <div v-else class="bmm-placeholder">请选择账册</div>
  </div>
</template>

<style scoped>
.bmm {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.bmm-top {
  display: flex;
  justify-content: flex-end;
}

.bmm-addy {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  color: var(--text-muted);
  transition: color var(--dur-fast), border-color var(--dur-fast);
}

.bmm-addy:hover { color: var(--hue-blue); border-color: var(--hue-blue); }

/* 年行:左年标 + 12 列月卡 + 右移除槽 */
.bmm-yrow {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.bmm-ylabel {
  flex: 0 0 56px;
  text-align: right;
}

.bmm-y {
  font-family: var(--font-mono);
  font-size: 15px;
  font-weight: var(--fw-bold);
  color: var(--text-primary);
}

.bmm-ysub {
  font-size: var(--fs-micro);
  color: var(--text-disabled);
}

.bmm-cells {
  flex: 1;
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: var(--space-2);
}

.bmm-who { position:absolute; top:6px; right:6px; z-index:2; pointer-events:none; display:flex; }
.bmm-av { box-shadow:0 0 0 2px var(--surface-white), 0 0 0 3.5px var(--hue-orange); }
.bmm-card {
  position: relative;   /* 在场角标绝对定位的参照 */
  min-height: 62px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: space-between;
  gap: 2px;
  padding: 8px 10px;
  border-radius: var(--radius-md);
  cursor: pointer;
  font-family: var(--font-sans);
  text-align: left;
  transition: background var(--dur-fast), border-color var(--dur-fast);
}

.bmm-card.has {
  border: 1px solid transparent;
  background: var(--accent-blue);
}

.bmm-card.has:hover { background: var(--accent-slate); }

.bmm-card.blank {
  border: 1px dashed var(--border-strong);
  background: transparent;
}

.bmm-card.blank:hover { border-color: var(--hue-blue); }

/* 最近有数据月:描边(mockup ③) */
.bmm-card.cur { outline: 2px solid var(--hue-blue); outline-offset: -1px; }

.bmm-month {
  font-size: var(--fs-label);
  font-weight: var(--fw-semibold);
  color: var(--text-primary);
}

.bmm-card.blank .bmm-month { color: var(--text-muted); }

.bmm-count {
  font-family: var(--font-mono);
  font-size: var(--fs-micro);
  font-weight: var(--fw-semibold);
  color: var(--hue-blue);
  background: var(--surface-white);
  border-radius: var(--radius-full);
  padding: 1px 7px;
}

.bmm-none {
  font-size: var(--fs-micro);
  color: var(--text-disabled);
}

/* 出账链:四道工序点。未做的点位照样占宽 —— 做没做,格子一样大 */
.bmm-pips { display: flex; gap: 3px; align-items: center; }
.bmm-pip {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--border-strong);
}
.bmm-pip.on { background: var(--hue-blue); }

/* 需重算:只换底色。加边框会让格子跳 1px,加角标会和在场头像抢右上角 */
.bmm-card.has.stale { background: rgb(255, 247, 235); }
.bmm-card.has.stale:hover { background: rgb(253, 240, 220); }
.bmm-card.has.stale .bmm-pip.on { background: var(--hue-orange); }

/* 移除槽:常驻 44px 占位;hover 行才显按钮 */
.bmm-rm-slot { flex: 0 0 44px; display: flex; align-items: center; }
.bmm-rm {
  display: none;
  align-items: center;
  gap: 2px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
  font-family: var(--font-sans);
  font-size: var(--fs-micro);
  color: var(--hue-red);
  padding: 3px 6px;
}
.bmm-yrow:hover .bmm-rm { display: inline-flex; }
.bmm-rm:hover { background: rgb(252, 235, 233); }

.bmm-addrow { margin-top: calc(-1 * var(--space-1)); }

.bmm-addbtn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 9px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-md);
  background: transparent;
  cursor: pointer;
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  color: var(--text-muted);
  transition: color var(--dur-fast), border-color var(--dur-fast);
}

.bmm-addbtn:hover { color: var(--hue-blue); border-color: var(--hue-blue); }

.bmm-placeholder {
  padding: var(--space-8) 0;
  text-align: center;
  font-size: var(--fs-body);
  color: var(--text-disabled);
}
</style>

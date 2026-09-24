<script setup lang="ts">
import Avatar from '@/components/ds/Avatar.vue'
import { usePresenceStore } from '@/stores/presence'

// 明确选期门 v3(BOOK-WORKBENCH-SPEC §5,2026-08-24 拍板):年份 tab 退场,
// 全部年份纵排一屏——每年一行 12 张月卡,点月卡才进宽表(§7-1 不变)。
// 年份增删:「＋ 补更早年份」(右上)向前补一年,「＋ 添加 {次年} 年」(底行)向后补;
// 手工添加且整年仍为空的年,行尾可「移除」(槽位常驻占宽,hover 行才显——布局稳定铁律)。
// 纯展示组件,不发请求;年份范围与 removable 判定由上层用 utils/matrixYears 组好传入。
import { computed, ref, watchPostEffect } from 'vue'
import { Plus, X, Lock } from 'lucide-vue-next'
// type-only:这是纯展示组件,不给它加 stores/review 的运行时依赖。
import type { ReviewStatus } from '@/types/review'

// 角标悬停说人话。四档逐字照设计稿 §07-④ 的 legend —— 屏上只有一个点,
// 「橙 = 待审核」这层意思除了 title 没有第二个地方能讲。
const REVIEW_TITLE: Record<ReviewStatus, string> = {
  entered: '未交审 · 该你交了',
  submitted: '待审核 · 在审核员手上',
  approved: '已审核 · 锁了',
  returned: '已退回 · 该你改了',
}
// 模板里的 v-if 不给下面的绑定收窄类型(同 :111 那处 editorOf 要写 `!`),索引一个可选联合会红。
const titleOf = (r?: ReviewStatus | null) => (r ? REVIEW_TITLE[r] : undefined)

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
  /**
   * 徽标自由文案（三大报表在这个位置显本期净额）。给了就压过 rowCount ——
   * "N 行" 只是它的一个特例，没理由让别的屏为了显一句话去凑一个行数。
   */
  badge?: string
  /** 参数或抄表改动晚于快照 → 屏上数字是旧的。只换底色，不加边框（布局稳定铁律）。 */
  stale?: boolean
  /**
   * 这个月的审核态 → 卡右下角一枚角标（SIDEBAR-UX-REDESIGN §9.2-4）。
   * 灰点＝未交审（该你交了）· 橙点＝待审核 · 绿锁＝已审核 · 红点＝已退回。
   * 前身是只有「锁 / 不锁」两档的 `locked`，分不出「待审」和「被退回」——
   * 而分不出的恰恰是唯一需要人动手的两档。
   *
   * **独立 absolute 角标，与 pips / badge / rowCount 并存**，不进下面那条 v-else-if 互斥链 ——
   * 年份条恒传 pips，写进链里角标一次都画不出来，而那种接法接对接错屏级用例都绿。
   *
   * 一格对多把键的宿主（出账链五把 / 年份条全月十几把）先过 `monthReview.worstReview` 收成一档，
   * 别在模板里三元判 —— 聚合序是一条判据，第二份必漂移。
   * 空月（hasData 假）恒不画：本来就没有东西可交，一片虚线卡长满灰点是纯噪音。
   */
  review?: ReviewStatus | null
}
interface YearRow {
  year: number
  months: MonthCell[]
  sub?: string          // 年标下小字:手工年 / 当前年
  removable?: boolean   // 手工年且整年为空 → 行尾显「移除」
}

// ⚠ manageYears 用 withDefaults 给真默认值 —— 裸 defineProps 下,可选布尔 prop 不传时
// Vue 会把它转型成 false 而不是 undefined(runtime boolean-cast 规则),`v-if="manageYears !== false"`
// 那种写法在这条 prop 上不成立,7 个既有调用点会被静默改成 manageYears=false(bookRail.spec.ts /
// chainMonthGate.spec.ts 的增删年份用例即刻钉住并变红)。
const props = withDefaults(defineProps<{
  /** 这一格的锁作用域（如 (y,m) => S.ledger(companyId, y, m)）。不传 = 不显示在场标记。 */
  scopeOf?: (year: number, month: number) => string | null
  /**
   * 「有没有选中的东西」这一个比特 —— 组件不读它任何字段，只拿来决定
   * 渲染矩阵还是渲染「请选择账册」占位。台账/附表10 传 Book，
   * 出账链没有册的概念，传个非空对象即可（ChainMonthGate）。
   */
  book: object | null
  years: YearRow[]      // 升序;上层负责连续补满
  /** 年份增删入口（补更早 / 添加次年 / 行尾移除）。默认开；总览屏那条年份条是导航不是账册管理,传 false。 */
  manageYears?: boolean
  /**
   * S 档改成「一行 12 格 + 横滚」（每年 62px），取代默认的 4 列 × 3 行（每年 226px）。
   * **只给首页那条年份条开**（2026-09-21 用户拍板）—— 判据是这两种宿主的活不一样：
   * 别的 8 处是「进正文前必经的那道门」，门后没有别的东西要让位，吃满首屏正常；
   * 首页这条是导航，它下面压着出账链 7 行与附表 8 行，4 年 × 226 = 976px 会把它们全挤出屏
   * （§5.8 留档的回头条件「库里年数 ≥ 3」已在真库上成立）。
   * 代价是一屏只看到 4 个整月 —— 所以必须有下面那段把当前月滚进视野，否则比改之前更差。
   */
  scrollRow?: boolean
}>(), {
  manageYears: true,
  scrollRow: false,
})

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

// ── 横滚档:把当前月滚进视野 ─────────────────────────────────────────────
// 不做这一下的话横滚就是纯退步:本月常落在第 9 格,每次进门都得先滑(§5.8 否掉它时记的正是这条)。
//
// ⚠ 不用 scrollIntoView:它的 block:'nearest' 会去滚**页面**,把在折线以下的年份行拽上来 ——
//   四行各滚一次,首屏当场跳到最后一年。直接写 scrollLeft 只动这一个横向容器,页面一动不动。
// ⚠ 只在首次(格子到齐那一刻)居中,之后再不动它。两个理由,后一个更硬:
//   ① 点月之后再居中 = 手指底下的东西自己挪,而点得到的格子本来就在视野里;
//   ② 不落锁的话这个 effect 一直活着,**任何**后续重跑(年份重算、上层换了 years 数组)都会
//      把年份条横移一下 —— 那一下会落在用户正在按别处按钮的时刻(LAYOUT-STABILITY)。
//   所以只要格子在了就落锁,不管这一档滚不滚得动。
//   代价写明:先在宽窗打开、再把窗口缩进 S 档,这一次不会居中。effect 没有、也不该有
//   视口依赖(matchMedia 监听是另一套开销),换句话说「缩窗后补居中」这条路**不存在** ——
//   别照着写断言,那只能用 setProps 冒充 resize,测出来的是假的。
const root = ref<HTMLElement | null>(null)
let centered = false
watchPostEffect(() => {
  // years 是依赖:ov 回包之前一个格子都没有,量不出宽度。scrollRow 关着就整段不做。
  if (centered || !props.scrollRow || !props.years.length) return
  const cur = root.value?.querySelector<HTMLElement>('.bmm-card.cur')
  const box = cur?.parentElement
  if (!cur || !box) return
  // ⚠ 落锁的判据是「量到了真宽度」,不是「格子在了」。KeepAlive 的非活动页签是 display:none,
  //   那时 clientWidth 恒 0 —— 按「格子在了」落锁会在一个量不出东西的时刻把锁用掉,
  //   等页签真被切到前台时已经锁死,永远不居中(单测里表现为 scrollLeft 恒 0)。
  if (!box.clientWidth) return
  centered = true                                  // 量到真宽度了,这一趟就是「首次」,宽档窄档一视同仁
  if (box.scrollWidth <= box.clientWidth) return   // 宽档不溢出,没什么可滚
  // ⚠ 必须减掉 box.offsetLeft。offsetLeft 相对的是**最近的已定位祖先**,不是滚动容器 ——
  //   本组件自身 .bmm / .bmm-yrow / .bmm-cells 全是 static,首页那条落在 .dh(position: relative,
  //   padding: 24px)里,于是 cur.offsetLeft 自带 24px 的左内边距。不减就恒偏 24px
  //   (实测:错式 579 / 正式 555)。两个 offsetLeft 同一个 offsetParent,相减即得容器内坐标。
  box.scrollLeft = cur.offsetLeft - box.offsetLeft - (box.clientWidth - cur.offsetWidth) / 2
})
</script>

<template>
  <div ref="root" class="bmm">
    <template v-if="book && years.length">
      <div v-if="manageYears" class="bmm-top">
        <button class="bmm-addy" @click="emit('add-earlier')">
          <Plus :size="13" />补更早年份
        </button>
      </div>

      <div v-for="y in years" :key="y.year" class="bmm-yrow">
        <div class="bmm-ylabel">
          <div class="bmm-y">{{ y.year }}</div>
          <div v-if="y.sub" class="bmm-ysub">{{ y.sub }}</div>
        </div>
        <div class="bmm-cells" :class="{ 'bmm-scroll': scrollRow }">
          <button
            v-for="m in y.months"
            :key="m.month"
            class="bmm-card"
            :class="[m.hasData ? 'has' : 'blank', { cur: m.cur, stale: m.hasData && m.stale }]"
            :title="m.hasData && m.stale ? '参数或抄表改动晚于快照 —— 屏上数字是旧的，需重算' : undefined"
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
            <!-- 审核角标(设计稿 §07-④)。与在场标记同族的**独立 absolute 分支** ——
                 严禁并进下面那条 v-else-if 互斥链:年份条恒传 pips,进了链就一次都画不出来。 -->
            <span v-if="m.hasData && m.review" class="bmm-rv" :class="`rv-${m.review}`"
                  :title="titleOf(m.review)">
              <Lock v-if="m.review === 'approved'" :size="11" />
              <i v-else class="bmm-rvdot" />
            </span>
            <!-- 出账链:四道工序点。空月不画点 —— 它本来就是一张「空」的虚线卡 -->
            <span v-if="m.hasData && m.pips" class="bmm-pips">
              <i v-for="(p, i) in m.pips" :key="i" class="bmm-pip" :class="{ on: p }" />
            </span>
            <span v-else-if="m.hasData && m.badge" class="bmm-count">{{ m.badge }}</span>
            <span v-else-if="m.hasData && m.rowCount != null" class="bmm-count">{{ m.rowCount }} 行</span>
            <span v-else-if="!m.hasData" class="bmm-none">空</span>
          </button>
        </div>
        <!-- 移除槽常驻占宽:hover 行且 removable 才显,不挤动月卡网格 -->
        <span v-if="manageYears" class="bmm-rm-slot">
          <button v-if="y.removable" class="bmm-rm" :title="`移除 ${y.year} 年(仅本机,录入数据后自动转正)`"
                  @click="emit('remove-year', y.year)">
            <X :size="12" />移除
          </button>
        </span>
      </div>

      <div v-if="manageYears" class="bmm-yrow bmm-addrow">
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
/* 审核角标:占 .bmm-who 的**对角**,不照设计稿画在右上 —— 右上是在场头像的位,
   而 entered / returned 恰恰是可编辑、正会有人在里面改的两档,同一个角必撞。
   只换颜色不换尺寸:四档都是 absolute,加它不改月卡高度、不挤动网格(LAYOUT-STABILITY)。 */
.bmm-rv { position:absolute; bottom:6px; right:6px; z-index:2; pointer-events:none; display:flex; }
.bmm-rvdot { width:8px; height:8px; border-radius:50%; background:currentColor; }
.bmm-rv.rv-entered   { color: var(--text-disabled); }
.bmm-rv.rv-submitted { color: var(--hue-orange); }
.bmm-rv.rv-approved  { color: var(--hue-green); }
.bmm-rv.rv-returned  { color: var(--hue-red); }
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
.bmm-card.has.stale { background: var(--warn-soft); }
.bmm-card.has.stale:hover { background: rgb(253, 240, 220); }
:root[data-theme="dark"] .bmm-card.has.stale:hover { background: color-mix(in srgb, var(--warn-soft), var(--ink-900) 8%); }
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
.bmm-rm:hover { background: var(--danger-soft); }

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

/* ─── 窄档降列(RESPONSIVE-LAYOUT-SPEC §5.8)─────────────────────────────
   上面一行都不动 —— 宽档(L/XL)DOM 与像素零差异是 §9 的硬标准,本组件 9 个屏共用。

   为什么不是「把 12 列缩窄」:`repeat(12, 1fr)` 里的 `1fr` 等价于
   `minmax(auto, 1fr)`,**auto 这一侧隐含 min-width:auto**,列缩不到内容
   (月份字 + 工序点)的 min-content 以下 —— 实测 12 张月卡要 748px 而 390 上
   盒子只有 242px,右边 7~9 个月整块出屏。写 `minmax(0, 1fr)` 只是准许它缩,
   缩到读不出字;真解法是降列,所以下面两块既换 minmax 也换列数。

   ⚠ 层叠顺序铁律:960 块必须写在 600 块**之前**。写反了 S 档 4 列被 M 档 6 列
   静默盖回 —— 不报错、不告警,只有屏上能看出来。 */
@media (max-width: 960px) { /* M↓:6 列 × 2 行 */
  /* 年标从 56px 左槽挪到行上方独占一行(18 高),「移除年份」跟在年标右端。
     order 换位:源序是 年标 → 月卡 → 移除槽,这里让移除槽排到月卡之前,
     月卡整行(100%)换到第二行。 */
  .bmm-yrow { flex-wrap: wrap; }
  .bmm-ylabel {
    flex: 0 0 auto;
    display: flex;
    align-items: baseline;
    gap: 6px;
    height: 18px;
    line-height: 18px;
    text-align: left;
  }
  .bmm-rm-slot { flex: 0 0 auto; order: 1; }
  .bmm-cells { flex: 0 0 100%; order: 2; grid-template-columns: repeat(6, minmax(0, 1fr)); }
}

@media (max-width: 600px) { /* S:4 列 × 3 行;开了 scrollRow 的宿主改成一行横滚 */
  /* 4 列是能同时认出五样标记的最窄一档(§5.8):格宽 ~83 − 边框 2 − padding 20
     = 61px 内容宽;四颗工序点 4×6+3×3 = 33,「12月」~26,都装得下。
     在场头像(右上)与审核角标(右下)是 absolute,不吃这 61。
     6 列时格宽 ~53、内容宽 ~31,33px 的点条正好占满,期数胶囊没位置。 */
  .bmm-cells { grid-template-columns: repeat(4, minmax(0, 1fr)); }

  /* 横滚档:一行 12 格。年行高 92(手机)/ 107(桌面窄窗,经典滚动条多占 15),
     4 年 416 / 476 —— 原来 4 列 × 3 行是 976。只有传了 scrollRow 的宿主进这块,
     M 档(601–960)不受影响,仍是上面那条 6 列 × 2 行。
     ⚠ grid-template-columns 必须显式清掉:上面那条 repeat(4,…) 同在这一块里,
       只加 grid-auto-* 的话轨道还是 4 条、第 5 格起全换行 —— 横滚一格都滚不动。
       靠两个类的特异度(0,2,0 > 0,1,0)压住它,不靠先后顺序。 */
  .bmm-cells.bmm-scroll {
    grid-template-columns: none;
    grid-auto-flow: column;
    /* ⚠ 68 不是 76。可视宽**不是**内容带的 358:年份条在 .dh 里,而 .dh 是 padding: 24px
       (DataHomeView.vue,窄档没覆盖),390 视口下实宽 390 − 16×2 − 24×2 = 310。
       76 是照 358 倒推的,放进 310 只露 3 个整月 —— 正好是 §5.8 当初否掉横滚记的那条代价。
       68 + 8 间距 = 76/格,4×68 + 3×8 = 296 ≤ 310,4 个整月保住。
       卡内容宽 68 − 边框 2 − padding 20 = 46:四颗工序点 33、「12月」27,都还装得下。 */
    grid-auto-columns: 68px;
    overflow-x: auto;
    /* 横向甩到头别把手势传给外层(不然在 iOS 上是「返回上一页」,在 Android 上是整页横移) */
    overscroll-behavior-x: contain;
    scroll-snap-type: x proximity;
  }
  .bmm-cells.bmm-scroll .bmm-card { scroll-snap-align: center; }

  /* ⚠ overflow 容器会把画在盒外的东西裁掉,两个环都中招,都只在横滚档改,另外 8 个宿主一字不动:
       ① .bmm-card.cur 的 `outline: 2px; outline-offset: -1px` 仍有 1px 在盒外;
       ② 全局键盘焦点环(base.css `outline: 2px; outline-offset: 2px`)整圈 4px 全在盒外 ——
          在横滚容器里会被切成两条竖杠,键盘用户等于看不见焦点。
     换成 inset 阴影:画在盒内,不占布局、不被裁。 */
  .bmm-cells.bmm-scroll .bmm-card.cur {
    outline: none;
    box-shadow: inset 0 0 0 2px var(--hue-blue);
  }
  .bmm-cells.bmm-scroll .bmm-card:focus-visible {
    outline: none;
    /* 先白后蓝的双环:蓝底的有数卡与透明的空月卡上都认得出,也与上面 .cur 的单环分得开 */
    box-shadow: inset 0 0 0 2px var(--surface-white), inset 0 0 0 4px var(--hue-blue);
  }
}

/* 触屏(§6.1):hover 显形的控件常显。「移除年份」是移除手工空年的唯一入口,
   `display:none` + 行 hover 在触屏上等于这个功能整个消失。
   桌面(hover: hover)不进这一块,仍是上面那条「行 hover 才显」。 */
@media (hover: none) {
  .bmm-rm { display: inline-flex; }
}
</style>

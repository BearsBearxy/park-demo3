<script setup lang="ts">
/**
 * PvQualityGrid —— 高级分析档 L6「数据质量日历」。
 *
 * **从 13 栋 × N 天的矩阵改成日级日历(周内日为行、周为列)+ 右栏缺抄榜。**
 * 这一块要答的问题是「到底剔了哪些天」—— 那是**日**的问题。
 * 二维折叠成日历后:年档 53 列 × 7 行 ≈ 371 格(旧版 13×365 ≈ 4745,掉一个数量级),
 * 月档 5–6 列 × 7 行、格宽给到 32px,一格里塞得下数字。
 * 周内日对齐还白拿一个洞察:抄表缺口常常跟着周末走,13×N 的横条读不出这个。
 *
 * **手写 CSS Grid,不用 ECharts。** heatmap / visualMap / calendar 在本仓的
 * echartsBundle 里一个都没注册 —— 用了得到空白图 + 一句控制台警告,jsdom 测不出来。
 *
 * **代价(真丢了东西,不粉饰)：**
 * ① 丢了 (栋 × 天) 的交互项 —— 「A2 只在 3/14 缺、别人都没缺」要点开那天才有名单;
 * ② 丢了每栋慢性缺抄的时间形状 —— 塌成「缺 9 天(最长连 7 天)」两个数,
 *    最长连续把「掉线」和「偶发漏抄」分开了,但看不出那 7 连天落在几月;
 * ③ 年档 12px 格里 1/13 的黄脚只有约 1px,只诚实支持「有一点 / 缺一半 / 全缺」三档粗读。
 *    年档的岗位是「哪几周有事」,不是「那天缺几栋」。
 *
 * 四态语义不变,合并任意两个就是把不同的审计答案说成同一个:
 * 全齐 / 缺抄 n 栋(可行动,该去补录)/ 整日剔除(在网不足 minStations,全天不参与比较)/
 * 未到(投产前,或还没抄到 —— 不可行动)。**没有「补齐」这一档,本实现从不补齐**。
 * 「整日剔除」与「全园一栋没抄」是两个不同的审计答案,12px 格上只靠划痕分不开,
 * 所以剔除格另加一条顶线 —— 混了就是 3ceefe0 那个 bug 换皮。
 */
import { computed, ref } from 'vue'

type Cell = 'ok' | 'miss' | 'dropped' | 'pre'

const props = defineProps<{
  rows: { id: number; name: string; inMatrix: boolean; cells: Cell[] }[]
  dates: string[]                  // 与 cells 等长
  gran: 'month' | 'year'
  /** 当天真进了抛光矩阵的栋数。**不许从 cells 里数** —— 剔除日所有在产栋都是 'dropped' */
  onDay: Map<string, number>
  minStations: number
  tooFewStations: boolean
}>()
const emit = defineEmits<{ (e: 'pick', id: number): void }>()

const DAY = 86400000
const utc = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) }
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
/** 周一 = 0。1970-01-01 是周四 → (4+6)%7 = 3 ✓。**不许 new Date('2026-09-14')**,本地时区会差一天 */
const dow = (t: number) => (new Date(t).getUTCDay() + 6) % 7

/** 只数**在矩阵里**的栋。未装表/未录容量的栋每天都没记录,放进分母整张日历恒黄(3ceefe0 的日级形态)。 */
const inRows = computed(() => props.rows.filter(r => r.inMatrix))

/**
 * 日历要画的日子。月档**按自然月铺满**,不按 dates 铺 ——
 * 否则今天 09-03 只画 3 格,明天再打开整体位移,09-14 换了个位置(§03.8 日期位置稳定)。
 * dates 覆盖不到的日子记为「未到」。
 */
const span = computed(() => {
  if (!props.dates.length) return []
  const a = props.dates[0], b = props.dates[props.dates.length - 1]
  if (props.gran === 'month' && a.slice(0, 7) === b.slice(0, 7)) {
    const [y, m] = a.split('-').map(Number)
    const out: string[] = []
    for (let t = Date.UTC(y, m - 1, 1); new Date(t).getUTCMonth() === m - 1; t += DAY) out.push(iso(t))
    return out
  }
  const out: string[] = []
  for (let t = utc(a); t <= utc(b); t += DAY) out.push(iso(t))
  return out
})

interface Day { d: string; st: Cell; miss: number; born: number; row: number; col: number }

const days = computed<Day[]>(() => {
  const at = new Map(props.dates.map((d, i) => [d, i]))
  const t0 = span.value.length ? utc(span.value[0]) : 0
  const gridStart = t0 - dow(t0) * DAY
  return span.value.map(d => {
    const i = at.get(d)
    let miss = 0, born = 0, dropped = false
    if (i != null) {
      for (const r of inRows.value) {
        const c = r.cells[i]
        if (c === 'pre') continue
        born++
        if (c === 'miss') miss++
        else if (c === 'dropped') dropped = true
      }
    }
    const t = utc(d)
    // 优先级:整日剔除 > 未到 > 缺抄 > 全齐
    const st: Cell = dropped ? 'dropped' : born === 0 ? 'pre' : miss > 0 ? 'miss' : 'ok'
    return { d, st, miss, born, row: dow(t), col: Math.floor((t - gridStart) / DAY / 7) }
  })
})

const nCols = computed(() => (days.value.length ? days.value[days.value.length - 1].col + 1 : 0))
const cw = computed(() => (props.gran === 'month' ? 32 : 12))

/** 年档在含每月 1 号的那一列上打月标尺;月档里月标尺是废话,不打。 */
const months = computed(() => props.gran === 'month' ? [] :
  days.value.filter(x => x.d.endsWith('-01'))
    .map(x => ({ key: x.d.slice(0, 7), label: `${Number(x.d.slice(5, 7))}月`, col: x.col })))

const WD = ['一', '二', '三', '四', '五', '六', '日']
/** 年档只标 一/三/五 省宽;月档标全七个 */
const wdShown = computed(() => (props.gran === 'month' ? [0, 1, 2, 3, 4, 5, 6] : [0, 2, 4]))

const stat = computed(() => {
  let dropped = 0, missDay = 0, ok = 0, pre = 0, nobody = 0
  for (const x of days.value) {
    if (x.st === 'dropped') dropped++
    else if (x.st === 'pre') pre++
    else if (x.st === 'miss') { missDay++; if (x.miss === x.born) nobody++ }
    else ok++
  }
  return { dropped, missDay, ok, pre, nobody }
})
const droppedDates = computed(() => days.value.filter(x => x.st === 'dropped').map(x => x.d))

/** 缺抄榜:只列本段真的缺过的栋,按缺抄天数降序。缺抄天数 + **最长连续**(掉线 vs 偶发漏抄) */
const board = computed(() => inRows.value.map(r => {
  let n = 0, run = 0, best = 0
  r.cells.forEach(c => {
    if (c === 'miss') { n++; run++; best = Math.max(best, run) } else run = 0
  })
  return { id: r.id, name: r.name, days: n, run: best }
}).filter(r => r.days > 0).sort((a, b) => b.days - a.days || b.run - a.run))
const boardMax = computed(() => Math.max(1, ...board.value.map(r => r.days)))

const selDate = ref<string | null>(null)
const selDay = computed(() => days.value.find(x => x.d === selDate.value) ?? null)
/** 选中那天缺抄的栋名 —— 点开才算,不常驻 */
const selMiss = computed(() => {
  const i = selDate.value ? props.dates.indexOf(selDate.value) : -1
  return i < 0 ? [] : inRows.value.filter(r => r.cells[i] === 'miss').map(r => r.name)
})
const md = (d: string) => d.slice(5)

// 读屏拿不到颜色,这段就是这张图的全部内容 —— **被剔的日期逐个念出来**,那正是这块要回答的问题
const label = computed(() => {
  const s = stat.value, top = board.value[0]
  const dd = droppedDates.value
  return `数据质量日历，${span.value[0] ?? '—'} 至 ${span.value[span.value.length - 1] ?? '—'} 共 ${span.value.length} 天：`
    + `整日剔除 ${s.dropped} 天${dd.length ? `，分别是 ${dd.slice(0, 10).join('、')}${dd.length > 10 ? ` 等 ${dd.length} 天` : ''}` : ''}；`
    + `有缺抄 ${s.missDay} 天，其中 ${s.nobody} 天全园一栋没抄；全园齐 ${s.ok} 天；投产前或未抄到 ${s.pre} 天留空。`
    + (top ? `缺抄最多的是 ${top.name} ${top.days} 天，最长连续 ${top.run} 天。` : '没有一栋缺抄。')
})

/** 371 个格子不挂 371 个监听:事件委托,格子上带 data-d */
function onCellClick(e: MouseEvent) {
  const d = (e.target as HTMLElement | null)?.dataset?.d
  if (d) selDate.value = selDate.value === d ? null : d
}
</script>

<template>
  <div class="pqg">
    <!-- 图例常驻:不做 hover 才出的图例 -->
    <div class="pqg-legend">
      <span class="lg"><i class="sw ok" />全齐 —— 当天在产的栋都抄了</span>
      <span class="lg"><i class="sw miss" />缺抄 n 栋 —— 黄脚越高缺得越多</span>
      <span class="lg"><i class="sw dropped" />整日剔除 —— 在网不足 {{ minStations }} 栋，全天不参与比较</span>
      <!-- 留白也是一种状态:没有这条图例,用户只会以为那片空白是渲染坏了 -->
      <span class="lg"><i class="sw pre" />未到 —— 投产前，或还没抄到</span>
      <span class="lg note">没有「补齐」这一档 —— 本实现从不补齐</span>
    </div>

    <div v-if="days.length" class="pqg-body">
      <div class="pqg-cal" :style="{ '--cw': `${cw}px` }">
        <div class="pqg-scroll">
          <div v-if="months.length" class="pqg-months"
            :style="{ gridTemplateColumns: `repeat(${nCols}, var(--cw))` }">
            <span v-for="m in months" :key="m.key" :style="{ gridColumnStart: m.col + 1 }">{{ m.label }}</span>
          </div>
          <div class="pqg-grid">
            <div class="pqg-wd">
              <span v-for="(w, i) in WD" :key="w" :class="{ hid: !wdShown.includes(i) }">{{ w }}</span>
            </div>
            <div class="pqg-cells" :style="{ gridTemplateColumns: `repeat(${nCols}, var(--cw))` }"
              role="img" :aria-label="label" @click="onCellClick">
              <i v-for="x in days" :key="x.d" :class="['c', x.st, { on: x.d === selDate }]"
                :style="{ gridRow: x.row + 1, gridColumn: x.col + 1,
                          '--fill': x.st === 'miss' ? `${Math.round((x.miss / Math.max(1, x.born)) * 100)}%` : '0%' }"
                :data-d="x.d"
                :title="`${x.d} ${x.st === 'dropped' ? '整日剔除' : x.st === 'pre' ? '未到'
                  : x.st === 'miss' ? `缺抄 ${x.miss} / ${x.born} 栋` : `全齐（${x.born} 栋）`}`">
                <b v-if="gran === 'month'">{{ x.st === 'dropped' ? '剔' : x.st === 'miss' ? x.miss : md(x.d).slice(3) }}</b>
              </i>
            </div>
          </div>
        </div>
        <div class="pqg-read">
          <template v-if="!selDay">点日历里的一格，看那天缺哪几栋</template>
          <template v-else-if="selDay.st === 'dropped'">
            {{ md(selDay.d) }}　整日剔除　·　当天只有 {{ onDay.get(selDay.d) ?? 0 }} 栋抄了表，不足 {{ minStations }} 栋，全天不参与比较
          </template>
          <template v-else-if="selDay.st === 'pre'">{{ md(selDay.d) }}　还没抄到，或在产的栋当时都还没建</template>
          <template v-else-if="selDay.st === 'miss'">
            {{ md(selDay.d) }}　缺抄 {{ selDay.miss }} 栋：{{ selMiss.join('、') }}　·　其余 {{ selDay.born - selDay.miss }} 栋正常
          </template>
          <template v-else>{{ md(selDay.d) }}　{{ selDay.born }} 栋在产，全齐</template>
        </div>
      </div>

      <!-- 缺抄榜:每栋的慢性缺抄压成两个数。最长连续把「掉线」和「偶发漏抄」分开 -->
      <!-- 没有缺抄时它只有一句话,不该再占着 300px 的一栏 ——
           年档 53 列要 754px,被挤到 559px 就得横滚,而「折成日历放得下」正是它存在的理由 -->
      <div class="pqg-rank" :class="{ empty: !board.length }">
        <div class="hd">缺抄榜</div>
        <button v-for="r in board" :key="r.id" type="button" class="r" @click="emit('pick', r.id)">
          <span class="nm">{{ r.name }}</span>
          <span class="v">缺 {{ r.days }} 天（最长连 {{ r.run }} 天）</span>
          <i class="bar" :style="{ width: `${(r.days / boardMax) * 100}%` }" />
        </button>
        <div v-if="!board.length" class="none">这段 {{ inRows.length }} 栋全抄齐，没有缺抄。</div>
      </div>
    </div>
    <div v-else class="pqg-none">这一档没有可显示的日期。</div>

    <div class="pqg-fn">
      整日剔除 {{ stat.dropped }} 天、有缺抄 {{ stat.missDay }} 天，其余 {{ stat.ok }} 天全园齐；投产前或还没抄到的留空 —— 未到不是漏抄。
    </div>
    <!-- 承重墙,不是礼貌用语:tooFewStations 时 thinDays 恒空 → 一格划痕都没有 →
         日历会理直气壮地说「一天都没剔」。没有这句,它就是在撒谎。 -->
    <div v-if="tooFewStations" class="pqg-fn warn">
      全园在网不足 {{ minStations }} 栋，整日剔除这条规则本段没生效 —— 日历上没有划痕格，不等于没有该剔的天。
    </div>
  </div>
</template>

<style scoped>
.pqg { width: 100%; }

/* 四态四种画法。三种可见的按语义分,不按明度排 —— 它们不是「有序的三档」。 */
.sw.ok { background: var(--fill-sky); }
.sw.miss { background: linear-gradient(to top, var(--hue-yellow) 55%, var(--fill-sky) 55%); }
.sw.dropped { background: var(--fill-slate); }
/* 图例那颗 10px 方块要能被认出是「空的方块」,得有一圈完整的框 */
.sw.pre { background: none; box-shadow: inset 0 0 0 1px var(--ink-300); }

.pqg-legend {
  display: flex; flex-wrap: wrap; gap: 4px 14px;
  font-size: var(--fs-micro); color: var(--text-muted); margin-bottom: 6px;
}
.lg { display: inline-flex; align-items: center; gap: 5px; }
.lg.note { color: var(--text-secondary); }
.sw { display: inline-block; width: 10px; height: 10px; border-radius: 1px; }

.pqg-body { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 16px; }
/* --cw 由内联 style 按档覆盖(年 12px / 月 32px);这里给默认值 ——
   内联覆盖一个令牌是可以的,引用一个从没声明过的令牌不行(token-check 拦这个) */
.pqg-cal { flex: 1 1 420px; min-width: 0; --cw: 12px; }
.pqg-scroll { overflow-x: auto; overflow-y: hidden; }

.pqg-months {
  display: grid; height: 14px; margin-bottom: 2px;
  font-size: var(--fs-micro); color: var(--text-muted); line-height: 14px;
}
.pqg-months > span { white-space: nowrap; border-left: 1px solid var(--border-subtle); padding-left: 2px; }

.pqg-grid { display: flex; align-items: flex-start; gap: 4px; }
.pqg-wd {
  display: grid; grid-template-rows: repeat(7, var(--cw)); gap: 2px;
  font-size: var(--fs-micro); color: var(--text-muted); text-align: right;
}
.pqg-wd > span { line-height: var(--cw); }
.pqg-wd > span.hid { visibility: hidden; }

.pqg-cells {
  display: grid; grid-template-rows: repeat(7, var(--cw)); gap: 2px; cursor: pointer;
}
.c {
  position: relative; display: block; width: var(--cw); height: var(--cw);
  font-style: normal; overflow: hidden;
  --fill: 0%;   /* 黄脚高度,由内联 style 按当天缺抄比例覆盖 */
}
.c > b {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  font-size: var(--fs-micro); font-weight: 400; font-family: var(--font-mono);
  color: var(--text-secondary); pointer-events: none;
}

.c.ok { background: var(--fill-sky); }
/* 缺抄:底部黄脚,高度 = 缺抄栋数 ÷ 当天在产栋数。**长度**通道,月档另印整数 */
.c.miss { background: linear-gradient(to top, var(--hue-yellow) var(--fill), var(--fill-sky) var(--fill)); }
/* 整日剔除:填充 + 45° 划痕 + **顶线**。顶线不是装饰 ——
   「整日剔除」(模型主动剔) 与「全园一栋没抄」(满格黄) 是两个不同的审计答案,
   12px 格上只靠划痕这一路分不开,混了就是老 bug 换皮。 */
.c.dropped {
  background:
    linear-gradient(45deg, transparent 45%, var(--bg-panel) 45%, var(--bg-panel) 55%, transparent 55%),
    var(--fill-slate);
  box-shadow: inset 0 2px 0 var(--ink-700);
}
.c.dropped > b { color: var(--text-primary); }
/* 未到:**没有填充**。年档 12px 格四边描边会读成一块填充,只留底边一条极淡的线 */
.c.pre { background: none; box-shadow: inset 0 -1px 0 var(--ink-100); }
.c.pre > b { color: var(--text-muted); }
/* 选中那天用墨色描边,**不用焦点蓝** —— 蓝编码的是「队列里选中的那一栋」,
   借给「选中的日子」会把这条约定冲掉。 */
.c.on { outline: 2px solid var(--ink-900); outline-offset: -1px; }
.c:hover { outline: 1px solid var(--ink-500); outline-offset: -1px; }

.pqg-read {
  margin-top: 6px; font-size: var(--fs-micro); color: var(--text-secondary);
  min-height: 18px; line-height: 18px;
}

.pqg-rank { flex: 0 1 300px; min-width: 0; }
/* 空榜整条换行到日历下面,把宽度还给日历(.pqg-body 是 flex-wrap: wrap) */
.pqg-rank.empty { flex: 1 1 100%; }
.pqg-rank.empty .hd { display: inline; margin-right: 6px; }
.pqg-rank .hd { font-size: var(--fs-micro); color: var(--text-muted); margin-bottom: 4px; }
.pqg-rank .r {
  all: unset; box-sizing: border-box; cursor: pointer; position: relative;
  display: flex; align-items: baseline; gap: 8px; width: 100%; height: 18px;
  font-size: var(--fs-micro); color: var(--text-secondary);
}
.pqg-rank .r:hover, .pqg-rank .r:focus-visible { color: var(--text-primary); background: var(--bg-hover); }
.pqg-rank .nm {
  flex: 0 0 96px; width: 96px; text-align: right; padding-right: 6px;
  overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
}
.pqg-rank .v { font-family: var(--font-mono); white-space: nowrap; }
/* 零基条:计数有真零,长度编码合法 */
.pqg-rank .bar {
  position: absolute; left: 96px; bottom: 1px; height: 2px;
  background: var(--ink-300); max-width: calc(100% - 96px);
}
.pqg-rank .none { font-size: var(--fs-micro); color: var(--text-muted); }

.pqg-none { font-size: var(--fs-micro); color: var(--text-muted); }
.pqg-fn { margin-top: 6px; font-size: var(--fs-micro); color: var(--text-secondary); }
.pqg-fn.warn { color: var(--text-primary); }
</style>

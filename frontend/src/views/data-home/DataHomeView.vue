<script setup lang="ts">
// 数据中心首页 = 录入工作台(DATA-HOME-REDESIGN spec §2)。只回答一件事:现在该干什么。
// 2026-09-03 改名「本月出账」,出账链 5 步(SIDEBAR-UX-REDESIGN §5.1)。
//
// 2026-08-18 重设计。改版前这屏把同一批信息说了三遍:4 个 KPI 卡里 3 个是下方栏目的重复,
// 而「本期待办」本身是「完整度」的子集(后端直接遍历同一个 sources 生成 tasks)。
// 用户原话「无从下手、信息量过多、没有主次」—— 那是信息架构问题不是排版问题,所以是删不是排。
//
// 现在三级主次:① 顶部一行总览 → ② 出账链流水线 → ③ 当前步大卡 + 全页唯一主 CTA。
// 出账链有先后依赖(抄表没抄完算不了公摊,公摊没生成出不了催缴单)所以画成流水线;
// 附表互相独立、能并行做,所以画成紧凑清单。结构与真实工作的形状同构。
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useTabsStore } from '@/stores/tabs'
import { useAuthStore } from '@/stores/auth'
import { dataHomeApi } from '@/api/dataHome'
import type { DataHomeOverviewDTO } from '@/types/dataHome'
import { iconFor } from '@/components/ds/icon'
import Card from '@/components/ds/Card.vue'
import Button from '@/components/ds/Button.vue'
import Select from '@/components/ds/Select.vue'
import { useBillingPeriodStore } from '@/stores/billingPeriod'
import { usePresenceStore } from '@/stores/presence'
import { periodLink, periodOf } from '@/nav/deepLink'
import { CHAIN } from '@/nav/billingChain'

const router = useRouter()
const tabsStore = useTabsStore()
const auth = useAuthStore()
const period = useBillingPeriodStore()
const presence = usePresenceStore()
const CHAIN_VALUES = new Set(CHAIN.map(c => c.value))

/** **本标签页**(按 sid,不按 self —— 同一用户多开标签页时 self 有多个)正握着的出账链 / 抄表锁里的期… */
function myChainLockPeriods(): string[] {
  const me = presence.users.find(u => u.sid === presence.sid)
  return (me?.editScopes ?? [])
    .filter(sc => sc.startsWith('billing-chain:') || sc.startsWith('meters:'))
    .map(sc => sc.slice(sc.indexOf(':') + 1))
}

const ov = ref<DataHomeOverviewDTO | null>(null)
// 用户手动选的月;null = 跟随后端锚定月。**刻意不持久化** —— 下次打开仍按锚重算,
// 否则看过一眼历史月之后天天落在那儿(spec §2.2)。
const pickedYm = ref<string | null>(null)

// 晚到的旧回包不许覆盖新选的月(2026-09-03 对抗复查 F2)
let loadSeq = 0
async function load() {
  const seq = ++loadSeq
  const res = await dataHomeApi.getOverview(pickedYm.value ?? undefined)
  if (seq !== loadSeq) return
  ov.value = res
}
onMounted(load)
watch(pickedYm, load)

// 行点击 = 「去做事」显式导航 → 全新状态(openFresh;侧栏语义翻案是 P3 的事,这里不动)。
// 出账链五屏共读 billingPeriod store:先 pick 首页当前月再 push,目标屏的选期矩阵就被前置满足
// (SIDEBAR-UX-REDESIGN §4.1 / D2)。pick 覆盖会话里已选的期 —— 首页写着的月就是用户刚点的意图;
// 本人握着任一链锁时先确认:openFresh 重建目标屏会清掉未保存草稿(不分同月异月)。
// 链屏与收入核对带 ?p(目标屏的 parsePeriod / parsePeriodQuery 都认),附表屏本期不带参(P0b 再接)。
// 前置条「去重算」的 go 也是 params,同样走这条 pick 分支 —— 它指向的正是首页显示月的参数屏,不 pick 反而落回矩阵(评审裁定 2026-09-03)。
// 本人锁的判断读 presence.users(3 秒一拍,PING_MS):刚进首页那一拍之前看不到自己别处的锁,确认框是尽力而为不是保证。
// ponytail: window.confirm —— 与 ParamCenterView / BillNoticesView 现有 200+ 处同款,P0 之后若换 FPDrawer 一起换。
function go(v: string) {
  // 用户刚在下拉里选的月优先于服务端回包(回包在途时也按他选的走);没选过才用锚定月
  const ym = pickedYm.value ?? curYm.value
  const p = ym ? { year: +ym.slice(0, 4), month: +ym.slice(5, 7) } : null
  if (p && CHAIN_VALUES.has(v)) {
    // 只要本人握着任一出账链/抄表锁就先确认:openFresh 会重建目标屏,编辑中的草稿不分同月异月都会丢
    // (2026-09-03 对抗复查 F3;侧栏改「恢复现场」的 P3 落地后再收窄)。
    const held = myChainLockPeriods()
    if (held.length && !window.confirm(`你正在编辑出账链（${held.join('、')}）。从首页重新打开会丢失未保存的改动，继续？`)) return
    period.pick(p.year, p.month)
    // 门被前置跳过 → ChainMonthGate 不再挂载,而它是 loadChain 的唯一调用方;不补这一句,
    // 目标屏的链路条读到的是空格子,五道工序全显「未做」(2026-09-03 对抗复查 F1)。
    // loadChain 幂等:已载入直接返回,在途去重。失败不阻断跳转(矩阵那边同样只标「加载失败」)。
    void period.loadChain().catch(() => {})
  }
  tabsStore.openFresh(v)
  // 链屏与收入核对带 ?p(SIDEBAR-UX-REDESIGN §4.1「显式选月 + periodLink」):目标屏 useDeepPeriod 认得,
  // 链屏还会与上面预 pick 的期比对(相同 → 不动);附表屏本期仍裸 push(P0b 再接,别提前发死参数)。
  if (p && (CHAIN_VALUES.has(v) || v === 'reconciliation')) {
    router.push(periodLink(v, { p: periodOf(p.year, p.month) }))
    return
  }
  router.push('/' + v)
}

const curYm = computed(() =>
  ov.value?.period ? `${ov.value.period.year}-${String(ov.value.period.month).padStart(2, '0')}` : '')
const monthOpts = computed(() =>
  (ov.value?.months ?? []).map(m => ({ value: m, label: `${+m.slice(0, 4)}年${+m.slice(5, 7)}月` })))

const doneSteps = computed(() => ov.value?.chain.steps.filter(s => s.status === 'done').length ?? 0)
const curStep = computed(() => {
  const c = ov.value?.chain
  return c && c.currentIndex >= 0 ? c.steps[c.currentIndex] : null
})
// 未录在前、已录在后(组内保持后端给的契约序):该做的事排在眼睛先扫到的位置
const sortedItems = computed(() =>
  [...(ov.value?.schedules.items ?? [])].sort((a, b) => Number(a.done) - Number(b.done)))
</script>

<template>
  <!-- ⚠ 根节点 .dh **不再吊在 ov 上** —— 它此前是整页 v-if,数据到达前是一整块白屏,
       而这是登录后第一眼看到的屏(加载态设计稿 §03)。
       骨架能画准是因为两个数都是常量:出账链恒 5 步,附表恒 9 项
       (后端 DataHomeService 写死 `new Schedules(done, 9, items)`)。
       静态文案(本月出账 / 出账链 / 附表录入)直接照常渲染 —— 它们不依赖数据,
       糊成微光条反而是把已知的东西藏起来。
       fp-fluid:本屏已按 RESPONSIVE-LAYOUT-SPEC §5 迁移摘掉 base.css 的 800px 屏级地板——
       出账链/附表本就是 flex-wrap 胶囊行,横幅/大卡 S 档允许换行即可,无定宽结构。 -->
  <div class="dh fp-fluid">
    <template v-if="!ov">
      <div class="dh-head">
        <div class="dh-period">
          <span class="dh-title">本月出账</span>
          <div class="dh-msel"><span class="fp-shim" style="display:block;height:28px;border-radius:8px"></span></div>
        </div>
        <span class="fp-shim" style="display:block;width:150px;height:12px"></span>
      </div>
      <section class="dh-sec">
        <h3 class="dh-h3">出账链</h3>
        <ol class="dh-steps">
          <li v-for="i in 5" :key="i" class="dh-step" style="cursor:default">
            <span class="fp-shim" style="width:12px;height:12px;border-radius:50%;flex:0 0 auto"></span>
            <span class="fp-shim" style="display:block;width:64px;height:12px"></span>
          </li>
        </ol>
        <Card surface="white" class="dh-cur">
          <div class="dh-curmain">
            <span class="fp-shim" style="display:block;width:128px;height:16px"></span>
            <span class="fp-shim" style="display:block;width:196px;height:12px"></span>
          </div>
          <span class="fp-shim" style="display:block;width:104px;height:34px;border-radius:8px"></span>
        </Card>
      </section>
      <section class="dh-sec">
        <h3 class="dh-h3">附表录入</h3>
        <ul class="dh-items">
          <li v-for="i in 9" :key="i" class="dh-item" style="cursor:default">
            <span class="fp-shim" style="width:10px;height:10px;border-radius:50%;flex:0 0 auto"></span>
            <span class="fp-shim" style="display:block;width:76px;height:11px"></span>
          </li>
        </ul>
      </section>
    </template>

    <template v-else>
    <!-- 顶部唯一总览行:月份 + 两个进度数字。改版前这里是 4 个 KPI 卡,其中 3 个与下方重复 -->
    <div class="dh-head">
      <div class="dh-period">
        <span class="dh-title">本月出账</span>
        <div v-if="ov.period" class="dh-msel">
          <Select :options="monthOpts" :model-value="curYm" size="sm"
                  @update:model-value="pickedYm = $event" />
        </div>
      </div>
      <span v-if="ov.period" class="dh-counts">
        出账 {{ doneSteps }}/5 · 附表 {{ ov.schedules.done }}/{{ ov.schedules.total }}
      </span>
    </div>

    <!-- 全新库:一条数据都没有,只给一句引导,不摆空架子 -->
    <Card v-if="!ov.period" surface="white" class="dh-empty">
      <component :is="iconFor('gauge')" :size="16" />
      <span>还没开始出账</span>
      <Button data-primary-cta variant="filled" size="sm" @click="go('meters')">从园区抄表开始 →</Button>
    </Card>

    <template v-else>
      <!-- 前置条:blockers 为空则整条不渲染。没问题的东西不该占版面 —— 这是「有主次」的关键,
           和合同屏「待补档案」条同一原则(那条也是 v-if 有缺口才出现,补完自动消失) -->
      <div v-for="b in ov.blockers" :key="b.kind" class="dh-blocker">
        <component :is="iconFor('alert-triangle')" :size="14" />
        <span class="dh-bt">{{ b.text }}</span>
        <!-- viewer 只读:去补档/去重算都是写操作,隐藏而不是让他点了弹 403 -->
        <Button v-if="!auth.isReadonly" variant="outline" size="sm" @click="go(b.go)">{{ b.cta }}</Button>
      </div>

      <!-- ① 出账链:有先后依赖,画成流水线,一眼看出卡在哪一步 -->
      <section class="dh-sec">
        <h3 class="dh-h3">出账链</h3>
        <ol class="dh-steps">
          <li v-for="s in ov.chain.steps" :key="s.key" :data-status="s.status"
              class="dh-step" @click="go(s.go)">
            <span class="dh-dot">{{ s.status === 'done' ? '✓' : s.status === 'current' ? '●' : '○' }}</span>
            <span class="dh-slabel">{{ s.label }}</span>
            <span v-if="s.detail" class="dh-sdetail">{{ s.detail }}</span>
          </li>
        </ol>

        <!-- ② 当前步大卡:全页唯一主 CTA。打开首页第一眼就知道该点哪儿 -->
        <Card surface="white" class="dh-cur">
          <template v-if="curStep">
            <div class="dh-curmain">
              <span class="dh-curlabel">{{ curStep.label }}</span>
              <span v-if="curStep.detail" class="dh-curdetail">{{ curStep.detail }}</span>
            </div>
            <Button data-primary-cta variant="filled" @click="go(curStep.go)">
              {{ auth.isReadonly ? '查看' : '去处理' }} →
            </Button>
          </template>
          <template v-else>
            <div class="dh-curmain"><span class="dh-curlabel">本月出账已完成</span></div>
            <Button data-primary-cta variant="outline" @click="go('reconciliation')">去对账核对 →</Button>
          </template>
        </Card>
      </section>

      <!-- ③ 附表录入:互相独立、可并行,画成紧凑清单;已录淡化不抢眼 -->
      <section class="dh-sec">
        <h3 class="dh-h3">附表录入 <span class="dh-h3n">{{ ov.schedules.done }}/{{ ov.schedules.total }}</span></h3>
        <ul class="dh-items">
          <li v-for="i in sortedItems" :key="i.go + i.name" :data-done="i.done"
              class="dh-item" @click="go(i.go)">
            <span class="dh-idot">{{ i.done ? '✓' : '○' }}</span>
            <span class="dh-iname">{{ i.name }}</span>
            <span class="dh-itag">{{ i.tag }}</span>
          </li>
        </ul>
      </section>
    </template>
    </template>
  </div>
</template>

<style scoped>
.dh { display: flex; flex-direction: column; gap: 20px; padding: 24px; }
.dh-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.dh-period { display: flex; align-items: center; gap: 12px; }
.dh-title { font-size: var(--fs-h2); font-weight: var(--fw-semibold); color: var(--text-primary); }
.dh-msel { width: 140px; }
.dh-counts { font-family: var(--font-mono); font-size: var(--fs-label); color: var(--text-secondary); }

.dh-empty { display: flex; align-items: center; gap: 12px; padding: 24px; color: var(--text-secondary); }

.dh-blocker {
  display: flex; align-items: center; gap: 10px; padding: 10px 14px;
  background: color-mix(in srgb, var(--hue-orange) 8%, white);
  border: 1px solid color-mix(in srgb, var(--hue-orange) 24%, white);
  border-radius: var(--radius-sm); color: var(--hue-orange);
}
.dh-bt { flex: 1; font-size: var(--fs-label); color: var(--text-primary); }

.dh-sec { display: flex; flex-direction: column; gap: 12px; }
.dh-h3 { font-size: var(--fs-body); font-weight: var(--fw-medium); color: var(--text-primary); margin: 0; }
.dh-h3n { font-family: var(--font-mono); font-size: var(--fs-label); color: var(--text-secondary); margin-left: 8px; }

.dh-steps { display: flex; align-items: stretch; gap: 8px; list-style: none; margin: 0; padding: 0; flex-wrap: wrap; }
.dh-step {
  display: flex; align-items: center; gap: 8px; padding: 10px 14px; cursor: pointer;
  border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);
  background: var(--surface-white); transition: background var(--dur-fast) var(--ease-standard);
}
.dh-step:hover { background: var(--surface-card); }
.dh-step[data-status="done"] { color: var(--text-secondary); }
.dh-step[data-status="done"] .dh-dot { color: var(--hue-blue); }
.dh-step[data-status="current"] { border-color: var(--ink-900); background: var(--surface-card); }
.dh-step[data-status="current"] .dh-slabel { font-weight: var(--fw-semibold); color: var(--text-primary); }
.dh-step[data-status="todo"] { color: var(--text-disabled); }
.dh-dot { font-size: 12px; }
.dh-slabel { font-size: var(--fs-label); }
.dh-sdetail { font-family: var(--font-mono); font-size: var(--fs-micro); color: var(--text-secondary); }

.dh-cur { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 20px 24px; }
.dh-curmain { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.dh-curlabel { font-size: var(--fs-h3); font-weight: var(--fw-semibold); color: var(--text-primary); }
.dh-curdetail { font-family: var(--font-mono); font-size: var(--fs-label); color: var(--text-secondary); }

.dh-items { display: flex; flex-wrap: wrap; gap: 8px; list-style: none; margin: 0; padding: 0; }
.dh-item {
  display: flex; align-items: center; gap: 6px; padding: 8px 12px; cursor: pointer;
  border: 1px solid var(--border-subtle); border-radius: var(--radius-full);
  background: var(--surface-white); font-size: var(--fs-label);
  transition: background var(--dur-fast) var(--ease-standard);
}
.dh-item:hover { background: var(--surface-card); }
.dh-item[data-done="true"] { opacity: 0.45; }
.dh-idot { font-size: 11px; color: var(--hue-blue); }
.dh-iname { color: var(--text-primary); }
.dh-itag { font-family: var(--font-mono); font-size: var(--fs-micro); color: var(--text-secondary); }

/* ── S 档(≤600,RESPONSIVE-LAYOUT-SPEC §5;宽档规则在前)──
   出账链 .dh-steps / 附表 .dh-items 天生 flex-wrap,窄档自动换行,不用另写;
   横幅 .dh-bt(flex:1 无 nowrap)中文逐字换行,也不用另写。
   只有三个 space-between 行在 390 视口(内容区 ~310)会被撑破,放开换行:
   - head:标题+月份选择(~218px)+ 进度数字(~150px)装不进一行 → 数字落到第二行;
   - cur 大卡:骨架 shim 定宽 196px + 按钮 104px > 卡内宽 → 按钮落下一行(数据态同理);
   - empty 空态:文案 + CTA 同题。
   换行由视口宽度决定、同一视口内确定不变——不违反同视口交互零位移(§7)。 */
@media (max-width: 600px) {
  .dh-head, .dh-cur, .dh-empty { flex-wrap: wrap; }
}
</style>

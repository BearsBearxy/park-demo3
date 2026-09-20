<script setup lang="ts">
/**
 * 分析层手机落地页「查一个数」(响应式稿 JourneyEntry 板)。
 *
 * 为什么存在:底栏「分析」现在落 cockpit —— 7 瓦 + 9 个块,是这一层最重的一屏,
 * 而三条动线里它都只是路过,没有一条问句的答案在驾驶舱第一屏上。这页只回答
 * 「那个数是多少」:瓦上先把**值**写出来,六成问句到瓦上就结束了。
 *
 * **只在 S 档当层首页**(稿 §1 不做③):桌面进分析层仍落 cockpit —— 大屏上驾驶舱第一屏
 * 就能看到 7 瓦 + 主图,它在那里是好门厅。落点只有 MobileBottomNav / MobileNavDrawer
 * 的 goLayer(两个组件只在 tier==='s' 挂载),`navAccess.ts` 的登录落点一个字没动。
 *
 * ── 首版为什么只有三枚瓦,稿画的是六枚 ────────────────────────────────
 * 稿自己写死一条硬约束:「值全部取自各屏已有的 KPI 瓦 / 结论条,**不新算指标**」。
 * 照这条逐枚查库(2026-09-20 勘察),六枚里三枚取不到:
 *   ③ 在租租户「环比 +3 户」—— TenantPortfolioView 第 1 瓦有户数,两个候选来源都没有 delta
 *   ④ 本月发电「48.2万 kWh」—— `pvAnaV4.logic.ts:210` 那枚瓦的值是**日期**(数据到 09-12),不是电量
 *   ⑥ 本年电费「自发自用抵扣 18.3%」—— 全仓只在 `views/pv/PvView.vue`,分析层没有这个口径
 * 硬凑就是新算指标,正好撞稿自己那条。所以首版只出能取到数的三枚,缺的三枚记在
 * `RESPONSIVE-V2-PLAN-2026-09-20.md` §4。
 *
 * ── 点一枚瓦跳到哪:稿写的是「router.push + # 锚到那张卡」,两半都做不到 ──
 * 卡级锚点**全仓不存在**(只有 PvMeterAnaView 有它自己的 `#st=`);更要紧的是
 * `cockpit.logic.ts:357` 原话「落分析屏的三条 p 今天不被消费(usePeriod 单例,spec §12 遗留)」。
 * 照稿做的结果是「瓦上写本月营收,点进去看到的是你上次留在驾驶舱的那一期」—— 屏上说谎。
 * 改法是零新机制的那条:本页读**同一个** `usePeriod` 单例,瓦与目标屏按构造就是同一期。
 * 所以这里只 router.push 到屏,不带锚点,也不需要带。
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { iconFor } from '@/components/ds/icon'
import { useUiStore } from '@/stores/ui'
import { useTabsStore } from '@/stores/tabs'
import { fpAllPages } from '@/nav/fpNav'
import {
  fetchAvailableMonths, fetchPnlSummary, fetchCollectRates, fetchContracts,
  type PnlSummary, type CollectRate,
} from '@/analysis/anaData'
import { providePeriodMonths, usePeriod } from '@/analysis/usePeriod'
import { anchorMonth, atPnlPeriod, colPick, momOf, pnlYearMonths } from './cockpit.logic'
import { buildRentRoll } from './expiry.logic'
import { anaSettings } from '@/analysis/anaSettings'
import type { ContractDTO } from '@/types/contract'

const router = useRouter()
const ui = useUiStore()
const tabs = useTabsStore()
const period = usePeriod()

const ChevronRight = iconFor('chevron-right')

const pnl = ref<PnlSummary | null>(null)
const collects = ref<CollectRate[]>([])
const contracts = ref<ContractDTO[]>([])
const loaded = ref(false)

onMounted(async () => {
  // 与 AnaShell:60-61 同一步:期间单例的可用月由真实数据注入,不硬编码年份。
  // 本页不自己选期 —— 读的就是用户上次在分析层留下的那一期,点进目标屏看到的是同一期。
  const dto = await fetchAvailableMonths()
  providePeriodMonths(dto.months, dto.sources?.pnl)
  const [p, c, ct] = await Promise.all([
    fetchPnlSummary(period.sel.value.year),
    fetchCollectRates(),
    fetchContracts(),
  ])
  pnl.value = p; collects.value = c; contracts.value = ct
  loaded.value = true
})

// ── 瓦① 本月营业收入 ───────────────────────────────────────────────
// 取值链逐行抄 CockpitView.vue:136-146(isMonth → usedMi → atPnlPeriod / momOf)。
// 少的那一段是 drawnSel 冻结:那是驾驶舱为「换年在途 pnl 还是旧年」准备的,
// 本页一次性加载,没有在途这回事。四个函数都是 cockpit.logic 里的纯函数,不是第二份口径
// —— anaHomeTiles.spec.ts 有一条源码断言钉住驾驶舱那边仍走同一组函数,改了会红。
const isMonth = computed(() => period.sel.value.gran === 'month')
const usedMi = computed(() => {
  const mi = period.sel.value.month - 1
  return isMonth.value ? anchorMonth(pnl.value?.months ?? [], mi + 1) - 1 : mi
})
const rev = computed(() => atPnlPeriod(pnl.value?.revenue, isMonth.value, usedMi.value, pnlYearMonths(pnl.value)))
const revMom = computed(() => momOf(pnl.value?.revenue, isMonth.value, usedMi.value))

// ── 瓦② 收缴率 ────────────────────────────────────────────────────
// colPick 已经是纯函数,零复制。目标值读的是 **reactive 单例 anaSettings**(anaSettings.ts:36)
// 不是 ANA_SETTINGS_DEFAULT —— 那个目标在 AnaShell 的设置弹层里可改、落 localStorage,
// 读默认值的话用户把目标调成 90 之后,落地页还写「距目标 96%」而驾驶舱写 90(CockpitView.vue:394)。
// 同一个数两个屏两种说法,就是屏上说谎。2026-09-21 破坏验证抓到的。
const cp = computed(() => colPick(collects.value, isMonth.value, period.sel.value.year, period.ym.value))

// ── 瓦③ 未来 12 月到期 ────────────────────────────────────────────
// buildRentRoll 是纯函数,零复制。到期墙是**期间无关屏**(ExpiryView.vue:135 period-mode="none"),
// 所以跳过去看到的就是同一份 rentRoll —— 三枚里只有它连期间都不用对。
const asOf = new Date().toLocaleDateString('sv')
const roll = computed(() => (contracts.value.length ? buildRentRoll(contracts.value, asOf, 12) : null))

const wan = (v: number) => (v < 0 ? '−¥' : '¥') + (Math.abs(v) / 10000).toFixed(1) + '万'
const signed = (v: number) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1) + '%'

interface Tile { key: string; icon: string; label: string; value: string; sub: string; to: string }
const tiles = computed<Tile[]>(() => {
  const out: Tile[] = []
  if (rev.value != null) {
    // 副行写口径与方向,不写「点击查看」(稿 §1 蓝框第 2 条)
    const ym = isMonth.value ? `${usedMi.value + 1} 月` : `${period.sel.value.year} 年`
    out.push({
      key: 'rev', icon: 'trending-up', label: '本月营业收入', value: wan(rev.value),
      sub: revMom.value == null ? ym : `${ym} · 环比 ${signed(revMom.value)}`, to: 'cockpit',
    })
  }
  if (cp.value) {
    out.push({
      key: 'coll', icon: 'target', label: '收缴率', value: cp.value.rate.toFixed(1) + '%',
      sub: `距目标 ${anaSettings.collectTarget}%`, to: 'cockpit',
    })
  }
  if (roll.value) {
    out.push({
      key: 'exp', icon: 'calendar-clock', label: '未来12月到期', value: roll.value.expiringCount + ' 份',
      sub: `涉及 ${wan(roll.value.expiringRentSum)}/月`, to: 'expiry',
    })
  }
  return out
})

// 分析层一共几屏 —— 数出来的,不写死(加屏删屏它自己跟着变)
const anaCount = computed(() => fpAllPages().filter(p => p.layer === 'analysis').length)

function openTile(t: Tile) {
  tabs.openFresh(t.to)
  void router.push('/' + t.to)
}
</script>

<template>
  <div class="ah">
    <!-- 搜一个数:48 高 / 16px 字(S 档输入控件下限)。递一个计数给外壳开命令面板,
         与 HomeView 的搜索框同一条路(stores/ui.ts:49 paletteReq 的既有写法)。
         ⚠ placeholder 只写它真能搜的:命令面板索引的是**屏名与分组名**,没有楼栋 / 租户。
         稿写的「或搜楼栋 / 租户」要给命令面板加数据源,是另一件活(见计划 §4)。 -->
    <button type="button" class="ah-search" @click="ui.requestPalette()">
      <component :is="iconFor('search')" :size="20" />
      <span>搜一个数 —— 输入屏名或分组名…</span>
    </button>

    <h2 class="ah-h">常查的数</h2>
    <div v-if="!loaded" class="ah-grid" aria-hidden="true">
      <div v-for="i in 3" :key="i" class="ah-tile is-skel">
        <span class="fp-shim l"></span><span class="fp-shim v"></span><span class="fp-shim s"></span>
      </div>
    </div>
    <div v-else-if="tiles.length" class="ah-grid">
      <button v-for="t in tiles" :key="t.key" type="button" class="ah-tile" @click="openTile(t)">
        <span class="lb"><component :is="iconFor(t.icon)" :size="13" />{{ t.label }}</span>
        <span class="vl">{{ t.value }}</span>
        <span class="sb">{{ t.sub }}</span>
      </button>
    </div>
    <p v-else class="ah-empty">这一期还没有可读的数。进屏里选一期试试。</p>

    <!-- 全部分析:☰ 打开的是同一个抽屉,这里是它在页面上的第二个口(稿 §1 改后屏底那一行) -->
    <button type="button" class="ah-all" @click="ui.requestMobileNav()">
      <component :is="iconFor('layout-grid')" :size="16" />
      <span class="t">全部分析</span>
      <span class="n">{{ anaCount }} 屏</span>
      <component :is="ChevronRight" :size="16" class="ch" />
    </button>
  </div>
</template>

<style scoped>
.ah { display: flex; flex-direction: column; gap: 12px; padding: 4px 0 12px; }

/* 48 高 / 16px 字:S 档输入控件下限(§6);整条一个点击目标,里面没有第二个可点件 */
.ah-search {
  display: flex; align-items: center; gap: 10px;
  height: 48px; padding: 0 12px 0 16px; box-sizing: border-box;
  border: 1px solid var(--border-control); border-radius: var(--radius-full);
  background: var(--surface-card); color: var(--text-muted);
  font-family: var(--font-sans); font-size: 16px; text-align: left; cursor: pointer;
}
.ah-search span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.ah-h { margin: 4px 0 0; font-size: 14px; font-weight: var(--fw-semibold); color: var(--text-primary); }

.ah-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
/* 定高 88:骨架瓦与真瓦同几何,数据落进来零位移(同 FPWideCards 的硬条件①) */
.ah-tile {
  height: 88px; box-sizing: border-box;
  display: flex; flex-direction: column; justify-content: center; gap: 3px;
  padding: 0 12px; border: 1px solid var(--border-subtle); border-radius: 12px;
  background: var(--surface-white); font-family: var(--font-sans); text-align: left; cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard);
}
.ah-tile:active { background: var(--bg-panel); }   /* 触屏无 hover */
.ah-tile .lb { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ah-tile .vl { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 20px; line-height: 26px; font-weight: var(--fw-semibold); color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ah-tile .sb { font-size: 11px; color: var(--text-muted-tint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ah-tile.is-skel { cursor: default; }
.ah-tile .fp-shim { display: block; border-radius: 3px; }
.ah-tile .fp-shim.l { width: 56%; height: 11px; }
.ah-tile .fp-shim.v { width: 78%; height: 20px; margin: 3px 0; }
.ah-tile .fp-shim.s { width: 64%; height: 11px; }

.ah-empty { margin: 0; font-size: 12px; color: var(--text-muted); }

.ah-all {
  display: flex; align-items: center; gap: 10px;
  min-height: 48px; padding: 0 12px; box-sizing: border-box;
  border: 1px solid var(--border-subtle); border-radius: 12px;
  background: var(--surface-white); color: var(--text-primary);
  font-family: var(--font-sans); font-size: 14px; text-align: left; cursor: pointer;
}
.ah-all:active { background: var(--bg-panel); }
.ah-all .t { flex: 1; min-width: 0; }
.ah-all .n { flex: 0 0 auto; font-size: 12px; color: var(--text-muted); }
.ah-all .ch { flex: 0 0 auto; color: var(--text-disabled); }
</style>

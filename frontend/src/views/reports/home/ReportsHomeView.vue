<script setup lang="ts">
// 报表中心 hub — P2-F Task2。1:1 移植 screen-reports-home.jsx(RhStyles 逐条 scoped)。
// 目录/期间两视图共享同一 HomeData(tieout 同源);§6 加载门 + v-else 紧邻链;
// 切年/月不清 data(不闪加载门)+ seq 竞态守卫;卡/行点击 push 直达(F8);打印/导出禁用占位(F7)。
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useTabsStore } from '@/stores/tabs'
import { periodLink, periodOf } from '@/nav/deepLink'
import { loadHomeData, defaultPeriod, type HomeData } from '@/reports/reportsHome'
import { iconFor } from '@/components/ds/icon'
import Segmented from '@/components/ds/Segmented.vue'
import Badge from '@/components/ds/Badge.vue'
import Button from '@/components/ds/Button.vue'
import Card from '@/components/ds/Card.vue'
import Select from '@/components/ds/Select.vue'

const router = useRouter()
const view = ref('目录')
const year = ref(0)
const month = ref(0)
const data = ref<HomeData | null>(null)   // §6 加载信号

let seq = 0                                // 切年/月竞态守卫:只收最后一次请求
async function load() {
  const reqId = ++seq
  const d = await loadHomeData(year.value, month.value)
  if (reqId === seq) data.value = d
}

onMounted(async () => {
  const p = await defaultPeriod()          // F3 确定性默认期(不读时钟)
  year.value = p.year
  month.value = p.month
  await load()
})

function setYear(y: number) { year.value = y; load() }
// ds/Select 只吃字符串值,进出各转一次
const monthOpts = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1} 月` }))
function onMonth(v: string) { month.value = +v; load() }
// 「去做事」显式导航 → 全新状态(openFresh,复审:非侧边栏入口语义)
const tabsStore = useTabsStore()
// 点卡带上本屏选好的期(设计稿 §3.2b)。改前是干净的 push('/' + v),
// 期一跳转就丢 —— 用户在这里选定 2025 年 9 月、点开利润表,要重走公司→年→月三道门回到原地。
// openFresh 是深链协议的一半:KeepAlive 缓存实例只在 setup 消费 query,不换 epoch 就读不到。
function go(v: string) {
  tabsStore.openFresh(v)
  // 走 periodLink 带 co:'all'(SIDEBAR-UX-REDESIGN §4.2):三大报表直落「全部汇总」;损益附表 / 收入核对认得几个用几个
  router.push(periodLink(v, { p: periodOf(year.value, month.value), co: 'all' }))
}

// 目录视图三区:三大报表 / 损益附表 / 收入核对(按卡 key 分组,顺序=HOME_CARDS)
const SECTIONS = [
  { title: '三大报表', icon: 'book-marked', keys: ['is', 'bs', 'tb'] },
  { title: '损益附表', icon: 'layers', keys: ['s1', 's2', 's3', 's4', 's5'] },
  { title: '收入核对', icon: 'git-compare', keys: ['recon'] },
] as const
const sections = computed(() =>
  SECTIONS.map(s => ({
    ...s,
    cards: (data.value?.cards ?? []).filter(c => (s.keys as readonly string[]).includes(c.key)),
  })))

const okCount = computed(() => data.value?.tieout.filter(t => t.ok).length ?? 0)
</script>

<template>
  <!-- fp-fluid:本屏已按 RESPONSIVE-LAYOUT-SPEC §5 迁移摘掉 800px 屏级地板——
       头部/工具条本就 flex-wrap,卡墙 minmax 收 min(100%,·) 防窄溢(§5.5),
       勾稽表圈在 .rh-tie-wrap 内横滚(§5.4)。加载门同挂(BillNoticesView 先例):
       两个根都是 .fp-content 首子,漏一个就在加载瞬间闪 800px 横滚。 -->
  <div v-if="data" class="rh fp-fluid">
    <div class="rh-head">
      <div>
        <h2 class="rh-title">报表中心</h2>
        <p class="rh-sub">核算输出 · 单一事实来源 — 所有报表读取已录入的台账数据自动生成</p>
      </div>
      <div class="rh-actions">
        <!-- F7 禁用占位(import-center 先例) -->
        <Button variant="outline" size="sm" disabled title="打印即将上线">
          <template #leading><component :is="iconFor('printer')" :size="14" /></template>
          打印
        </Button>
        <Button variant="filled" size="sm" disabled title="导出即将上线">
          <template #leading><component :is="iconFor('download')" :size="14" /></template>
          导出 Excel
        </Button>
      </div>
    </div>

    <div class="rh-toolbar">
      <span class="fin-ypill">
        <button title="上一年" @click="setYear(year - 1)"><component :is="iconFor('chevron-left')" :size="15" /></button>
        <span class="v">{{ year }}</span>
        <button title="下一年" @click="setYear(year + 1)"><component :is="iconFor('chevron-right')" :size="15" /></button>
      </span>
      <!-- 期间选择器定宽:LIST-PAGE-SPEC §2 月 92px(触发器 width:100%,宽度全靠外层) -->
      <div style="width:92px">
        <Select size="sm" :options="monthOpts" :model-value="String(month)" @update:model-value="onMonth" />
      </div>
      <div class="rh-toolbar-right">
        <Segmented v-model="view" :options="['目录', '期间']" size="sm" />
      </div>
    </div>

    <!-- ── 目录视图:报表卡三区 + 本期勾稽瓦片条 ── -->
    <template v-if="view === '目录'">
      <div v-for="sec in sections" :key="sec.title">
        <h3 class="rh-section-t"><component :is="iconFor(sec.icon)" :size="16" />{{ sec.title }}</h3>
        <div class="rh-grid">
          <div v-for="c in sec.cards" :key="c.key" class="rh-rc" @click="go(c.go)">
            <div class="rh-rc-top">
              <span class="rh-rc-icon"><component :is="iconFor(c.icon)" :size="19" /></span>
              <span style="min-width:0;flex:1">
                <div class="rh-rc-name">{{ c.name }}</div>
                <div class="rh-rc-desc">{{ c.desc }}</div>
              </span>
              <component :is="iconFor('arrow-up-right')" :size="16" />
            </div>
            <div class="rh-rc-metric">
              <span class="rh-rc-mlabel">{{ c.metric }}</span>
              <span class="rh-rc-mval" :style="c.value === '待生成' ? { color: 'var(--text-disabled)', fontSize: '15px' } : undefined">{{ c.value }}</span>
            </div>
            <div class="rh-rc-foot">
              <span class="rh-rc-upd">数据截止 {{ c.updated }}</span>
              <span v-if="c.tie === 'ok'" class="rh-tie" style="color:var(--hue-blue)"><component :is="iconFor('check-circle-2')" :size="13" />已勾稽</span>
              <span v-else-if="c.tie === 'bad'" class="rh-tie" style="color:var(--hue-orange)"><component :is="iconFor('alert-triangle')" :size="13" />待查</span>
              <span v-else-if="c.tie === 'pending'" class="rh-tie" style="color:var(--text-disabled)"><component :is="iconFor('circle-dashed')" :size="13" />待生成</span>
              <span v-else class="rh-tie" style="color:var(--text-disabled)">—</span>
            </div>
          </div>
        </div>
      </div>

      <div>
        <h3 class="rh-section-t">
          <component :is="iconFor('git-compare')" :size="16" />本期勾稽
          <span class="rh-section-cap">{{ data.year }}年{{ data.month }}月 · {{ okCount }} / {{ data.tieout.length }} 项已平</span>
        </h3>
        <div class="rh-tie-strip">
          <div v-for="(t, i) in data.tieout" :key="i" class="rh-tie-tile">
            <span class="rh-tie-tile-l">{{ t.label }}</span>
            <span class="rh-tie-tile-v">{{ t.value }}</span>
            <div class="rh-tie-tile-foot">
              <span class="rh-tie-tile-src">{{ t.a }} ↔ {{ t.b }}</span>
              <span v-if="t.ok" class="rh-tie-ok"><component :is="iconFor('check-circle-2')" :size="13" />已平</span>
              <span v-else class="rh-tie-bad"><component :is="iconFor('alert-triangle')" :size="13" />待查</span>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- ── 期间视图:期间 hero + 勾稽检查表 + 本期报表列表 ── -->
    <template v-else>
      <div class="rh-period-hero">
        <span class="rh-hero-ic"><component :is="iconFor('calendar-check')" :size="24" /></span>
        <div style="flex:1;min-width:0">
          <div class="rh-hero-t">{{ data.year }}年{{ data.month }}月 · 期间核算</div>
          <div class="rh-sub" style="margin:2px 0 0">先锁定期间,检查三大报表与各附表之间是否勾稽一致,再逐表查看</div>
        </div>
        <Badge :tone="okCount === data.tieout.length ? 'blue' : 'orange'" dot>{{ okCount }} / {{ data.tieout.length }} 项已平</Badge>
      </div>

      <Card surface="white" :padding="0">
        <div class="rh-card-h">勾稽检查</div>
        <!-- §5.4:窄了不动列,在包裹层内横滚(列结构任何档位不变) -->
        <div class="rh-tie-wrap">
        <table class="rh-tie-table">
          <thead>
            <tr>
              <th>勾稽项</th>
              <th>来源 A</th>
              <th></th>
              <th>来源 B</th>
              <th style="text-align:right">金额</th>
              <th style="width:90px;text-align:right">结果</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(t, i) in data.tieout" :key="i">
              <td style="color:var(--text-primary);font-weight:var(--fw-medium)">{{ t.label }}</td>
              <td><span class="rh-tie-flow"><span class="rh-tie-chip">{{ t.a }}</span></span></td>
              <td style="color:var(--text-disabled);text-align:center;width:24px">=</td>
              <td><span class="rh-tie-flow"><span class="rh-tie-chip">{{ t.b }}</span></span></td>
              <td class="rh-tie-num">{{ t.value }}</td>
              <td style="text-align:right">
                <span v-if="t.ok" class="rh-tie-ok"><component :is="iconFor('check-circle-2')" :size="14" />已平</span>
                <span v-else class="rh-tie-bad"><component :is="iconFor('alert-triangle')" :size="14" />待查</span>
              </td>
            </tr>
          </tbody>
        </table>
        </div>
      </Card>

      <Card surface="white" :padding="0">
        <div class="rh-card-h">本期报表</div>
        <div>
          <button v-for="c in data.cards" :key="c.key" class="rh-row" @click="go(c.go)">
            <span class="rh-row-name">{{ c.name }}</span>
            <span class="rh-row-val" :style="c.value === '待生成' ? { color: 'var(--text-disabled)' } : undefined">{{ c.value }}</span>
            <span v-if="c.tie === 'ok'" class="rh-tie-ok rh-row-tie"><component :is="iconFor('check-circle-2')" :size="13" />已平</span>
            <span v-else-if="c.tie === 'bad'" class="rh-tie-bad rh-row-tie"><component :is="iconFor('alert-triangle')" :size="13" />待查</span>
            <span v-else class="rh-row-pend">{{ c.tie === 'none' ? '—' : '待生成' }}</span>
            <component :is="iconFor('chevron-right')" :size="15" />
          </button>
        </div>
      </Card>
    </template>
  </div>

  <!-- §6 加载门:v-else 紧邻上方状态链(DESIGN-FIDELITY §6.2) -->
  <div v-else class="page-loading fp-fluid"><span class="page-spin" /></div>
</template>

<style scoped>
/* 1:1 移植 screen-reports-home.jsx RhStyles(token 已是 demo3 系)。本组件独享。 */
.rh { display:flex; flex-direction:column; gap:20px; max-width:1640px; margin:0 auto; width:100%; }
.rh-head { display:flex; align-items:flex-end; justify-content:space-between; gap:16px; flex-wrap:wrap; }
.rh-title { margin:0; font-size:var(--fs-h2); font-weight:var(--fw-semibold); color:var(--text-primary); }
.rh-sub { margin:5px 0 0; font-size:var(--fs-label); color:var(--text-muted); }
.rh-actions { display:flex; gap:8px; align-items:center; }
.rh-toolbar { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
.rh-toolbar-right { margin-left:auto; display:flex; align-items:center; gap:10px; }

.rh-section-t { font-size:var(--fs-h4); font-weight:var(--fw-semibold); color:var(--text-primary); margin:0 0 12px; display:flex; align-items:center; gap:8px; }
.rh-section-cap { margin-left:4px; font-size:var(--fs-label); font-weight:var(--fw-regular); color:var(--text-muted); }
/* minmax 下限包 min(100%,·):容器窄于 280 时(390 视口内容区)降为撑满单列而不是溢出(§5.5);
   容器 ≥280 时 min() 取 280,与原写法逐像素一致——桌面零变化 */
.rh-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr)); gap:14px; }
.rh-rc { display:flex; flex-direction:column; gap:14px; padding:18px; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); background:var(--surface-white); cursor:pointer; transition:box-shadow var(--dur-fast) var(--ease-standard), transform var(--dur-fast) var(--ease-standard); }
.rh-rc:hover { box-shadow:0 6px 20px rgba(28,28,28,.08); transform:translateY(-1px); }
.rh-rc-top { display:flex; align-items:flex-start; gap:11px; }
.rh-rc-icon { width:38px; height:38px; border-radius:var(--radius-sm); background:var(--accent-slate); display:grid; place-items:center; color:var(--ink-900); flex:0 0 auto; }
.rh-rc-name { font-size:var(--fs-body); font-weight:var(--fw-semibold); color:var(--text-primary); }
.rh-rc-desc { font-size:var(--fs-label); color:var(--text-muted); margin-top:2px; }
.rh-rc-metric { display:flex; align-items:baseline; gap:8px; }
.rh-rc-mlabel { font-size:var(--fs-label); color:var(--text-muted); }
.rh-rc-mval { font-size:20px; font-weight:var(--fw-semibold); color:var(--text-primary); font-family:var(--font-mono); font-variant-numeric:tabular-nums; }
.rh-rc-foot { display:flex; align-items:center; justify-content:space-between; padding-top:12px; border-top:1px solid var(--divider); }
.rh-rc-upd { font-size:var(--fs-label); color:var(--text-muted); }
.rh-tie { display:inline-flex; align-items:center; gap:4px; font-size:12px; font-weight:var(--fw-semibold); }

/* 期间视图 */
.rh-period-hero { display:flex; align-items:center; gap:16px; padding:18px 20px; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); background:var(--surface-card); flex-wrap:wrap; }
.rh-hero-ic { width:46px; height:46px; border-radius:var(--radius-md); background:var(--surface-white); border:1px solid var(--border-subtle); display:grid; place-items:center; color:var(--hue-blue); flex:0 0 auto; }
.rh-hero-t { font-size:var(--fs-h4); font-weight:var(--fw-semibold); color:var(--text-primary); }
.rh-card-h { padding:14px 16px; border-bottom:1px solid var(--divider); font-size:var(--fs-h4); font-weight:var(--fw-semibold); color:var(--text-primary); }
/* 勾稽表横滚外框(§5.4):桌面表宽 ≤ 容器时不产生滚动条,零变化;窄档滚它不滚整页 */
.rh-tie-wrap { overflow-x:auto; }
.rh-tie-table { width:100%; border-collapse:separate; border-spacing:0; font-family:var(--font-sans); font-size:13px; }
.rh-tie-table th { text-align:left; font-size:12px; font-weight:var(--fw-semibold); color:var(--text-muted); padding:10px 14px; border-bottom:1px solid var(--border-subtle); }
.rh-tie-table td { padding:12px 14px; border-bottom:1px solid var(--divider); color:var(--text-secondary); }
.rh-tie-table tr:last-child td { border-bottom:none; }
.rh-tie-flow { display:inline-flex; align-items:center; gap:7px; color:var(--text-muted); font-size:12.5px; }
.rh-tie-chip { padding:1px 8px; border-radius:var(--radius-full); background:var(--surface-sunken); color:var(--text-secondary); white-space:nowrap; }
.rh-tie-num { font-family:var(--font-mono); font-variant-numeric:tabular-nums; font-weight:var(--fw-semibold); color:var(--text-primary); text-align:right; }
.rh-tie-ok { color:var(--hue-blue); display:inline-flex; align-items:center; gap:4px; font-weight:var(--fw-semibold); font-size:12.5px; }
.rh-tie-bad { color:var(--hue-orange); display:inline-flex; align-items:center; gap:4px; font-weight:var(--fw-semibold); font-size:12.5px; }

/* 本期报表列表行(原型 inline style → scoped,hover 用 CSS 替代 JS) */
.rh-row { display:flex; align-items:center; gap:12px; width:100%; padding:13px 16px; border:none; background:transparent; cursor:pointer; text-align:left; font-family:var(--font-sans); border-bottom:1px solid var(--divider); color:var(--text-muted); transition:background var(--dur-fast) var(--ease-standard); }
.rh-row:last-child { border-bottom:none; }
.rh-row:hover { background:var(--bg-hover); }
.rh-row-name { font-size:var(--fs-body); color:var(--text-primary); font-weight:var(--fw-medium); flex:1; min-width:0; white-space:nowrap; }
.rh-row-val { font-family:var(--font-mono); font-variant-numeric:tabular-nums; font-size:13px; color:var(--text-secondary); }
.rh-row-tie { width:70px; justify-content:flex-end; }
.rh-row-pend { width:70px; text-align:right; color:var(--text-disabled); font-size:12.5px; }

/* 目录视图底部:本期勾稽健康条(复用 tieout 数据,与「期间」视图同源) */
.rh-tie-strip { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,196px),1fr)); gap:14px; } /* min(100%,·) 同 .rh-grid,防窄溢(§5.5) */
.rh-tie-tile { display:flex; flex-direction:column; gap:10px; padding:16px 18px; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); background:var(--surface-white); }
.rh-tie-tile-l { font-size:var(--fs-label); color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.rh-tie-tile-v { font-size:20px; font-weight:var(--fw-semibold); font-family:var(--font-mono); font-variant-numeric:tabular-nums; color:var(--text-primary); }
.rh-tie-tile-src { font-size:var(--fs-micro); color:var(--text-disabled); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.rh-tie-tile-foot { display:flex; align-items:center; justify-content:space-between; gap:8px; padding-top:10px; border-top:1px solid var(--divider); }

/* 年份胶囊(fin-ypill scoped 复刻,同 ReconView) */
.fin-ypill { display:inline-flex; align-items:center; gap:2px; background:var(--surface-white); border:1px solid var(--border-subtle); border-radius:var(--radius-full); padding:3px; }
.fin-ypill button { width:28px; height:28px; border:none; background:transparent; border-radius:var(--radius-full); cursor:pointer; color:var(--text-secondary); display:grid; place-items:center; transition:background var(--dur-fast) var(--ease-standard); }
.fin-ypill button:hover:not(:disabled) { background:var(--bg-hover); color:var(--text-primary); }
.fin-ypill button:disabled { opacity:.4; cursor:not-allowed; }
.fin-ypill .v { font-size:13.5px; font-weight:var(--fw-semibold); color:var(--text-primary); font-family:var(--font-mono); font-variant-numeric:tabular-nums; padding:0 8px; white-space:nowrap; }

/* ── S 档(≤600,宽档规则在前)──
   勾稽表 6 列 + nowrap 胶囊的自然宽 ~600px(最长胶囊「利润表·营业收入(本月)」~170px)。
   width:100% 的 auto 表在 390 视口(内容区 ~358)会先把中文列往竖里压再溢出——
   给表保底宽,多出的由 .rh-tie-wrap 横滚消化(BillNoticesView .bn-table 同一手法)。
   限 S 档:M 档内容区 608–642 ≥ 600 本就装得下,无条件写会给 M 档凭空造滚动条。 */
@media (max-width: 600px) {
  .rh-tie-table { min-width: 600px; }
}
</style>

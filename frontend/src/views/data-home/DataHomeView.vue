<script setup lang="ts">
// 数据中心首页 — 任务驱动工作台。1:1 移植 screen-data-home.jsx 三栏布局。
// 纯只读聚合屏:overview 全派生自已建子系统真实数据。
// 套用 DESIGN-FIDELITY §6 加载门:overview 未到显 .page-loading,不假空态。
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { dataHomeApi } from '@/api/dataHome'
import type { DataHomeOverviewDTO } from '@/types/dataHome'
import { iconFor } from '@/components/ds/icon'
import Card from '@/components/ds/Card.vue'
import KpiCard from '@/components/ds/KpiCard.vue'
import Button from '@/components/ds/Button.vue'

const router = useRouter()
const overview = ref<DataHomeOverviewDTO | null>(null)   // §6 加载信号

onMounted(async () => {
  overview.value = await dataHomeApi.getOverview()
})

// 行点击 → router.push('/'+go);router.afterEach 已自动 tabs.open,勿手动。
function go(v: string) {
  router.push('/' + v)
}

// 导入 Excel:占位(导入即将上线),同其他屏。
function onImport() {
  alert('导入 Excel 即将上线')
}

// 待办严重度 → 圆点色 + 标签(1:1 from jsx DH_SEV)。
const SEV: Record<string, { c: string; t: string }> = {
  danger: { c: 'var(--hue-red)', t: '逾期' },
  warning: { c: 'var(--hue-orange)', t: '待办' },
  info: { c: 'var(--hue-cyan)', t: '进行中' },
}
// 数据源状态 → 胶囊样式(契约二态 done|missing,1:1 from jsx DH_SRC 子集)。
const SRC: Record<string, { label: string; c: string; bg: string }> = {
  done: { label: '已录入', c: 'var(--hue-blue)', bg: 'var(--accent-blue)' },
  missing: { label: '未录入', c: 'var(--hue-red)', bg: 'rgb(252,235,233)' },
}

function sevMix(c: string) {
  return 'color-mix(in srgb, ' + c + ' 12%, white)'
}
</script>

<template>
  <!-- §6 加载门:overview 到达前显转圈,不闪空态 -->
  <div v-if="overview" class="dh">
    <div class="dh-head">
      <div>
        <h2 class="dh-title">数据中心</h2>
        <p class="dh-sub">
          <span class="dh-period">
            <component :is="iconFor('calendar')" :size="13" />本期 · {{ overview.period.label }}
          </span>
          录入与维护 — 把当期数据补齐,报表与分析自动跟着更新
        </p>
      </div>
      <div class="dh-actions">
        <Button variant="outline" size="sm" @click="onImport">
          <template #leading><component :is="iconFor('upload')" :size="14" /></template>
          导入 Excel
        </Button>
        <Button variant="filled" size="sm" @click="go('ledger')">
          <template #leading><component :is="iconFor('plus')" :size="14" /></template>
          录入台账
        </Button>
      </div>
    </div>

    <div class="dh-kpis">
      <KpiCard
        v-for="k in overview.kpis"
        :key="k.label"
        :label="k.label"
        :value="k.value"
        :sub="k.sub"
        :tint="(k.tint as any)"
      >
        <template #icon><component :is="iconFor(k.icon)" :size="18" /></template>
      </KpiCard>
    </div>

    <div class="dh-cols">
      <!-- 本期待办 -->
      <div class="dh-col-tasks">
        <Card title="本期待办">
          <template #action>
            <span style="font-size:var(--fs-label);color:var(--text-muted)">{{ overview.tasks.length }} 项 · 点击直达</span>
          </template>
          <div>
            <button
              v-for="(t, i) in overview.tasks"
              :key="i"
              class="dh-task"
              @click="go(t.go)"
            >
              <span class="dh-dot" :style="{ background: SEV[t.sev].c }"></span>
              <span class="dh-task-main">
                <span class="dh-task-label">{{ t.label }}</span>
                <span class="dh-task-meta">{{ t.meta }}</span>
              </span>
              <span class="dh-sevtag" :style="{ color: SEV[t.sev].c, background: sevMix(SEV[t.sev].c) }">{{ SEV[t.sev].t }}</span>
              <span class="dh-task-cta">{{ t.cta }}<component :is="iconFor('chevron-right')" :size="13" /></span>
            </button>
          </div>
        </Card>
      </div>

      <!-- 本期数据完整度 -->
      <div class="dh-col-prog">
        <Card title="本期数据完整度">
          <div class="dh-progress">
            <div class="dh-progress-row">
              <span class="dh-progress-pct">{{ overview.pct }}%</span>
              <span class="dh-progress-cap">{{ overview.progressDone }} / {{ overview.progressTotal }} 项已就绪</span>
            </div>
            <div class="dh-progress-bar"><div class="dh-progress-fill" :style="{ width: overview.pct + '%' }"></div></div>
          </div>
          <div class="dh-src">
            <button
              v-for="s in overview.sources"
              :key="s.name"
              class="dh-src-row"
              @click="go(s.go)"
            >
              <span class="dh-src-name">{{ s.name }}</span>
              <span class="dh-src-tag">{{ s.tag }}</span>
              <span class="dh-src-time">{{ s.updated }}</span>
              <span class="dh-pill" :style="{ color: SRC[s.status].c, background: SRC[s.status].bg }">{{ SRC[s.status].label }}</span>
            </button>
          </div>
        </Card>
      </div>

      <!-- 最近动态(无"谁",灰底首字 + 文案) -->
      <div class="dh-col-recent">
        <Card title="最近动态">
          <div class="dh-recent">
            <div v-for="(r, i) in overview.recent" :key="i" class="dh-recent-row">
              <span class="dh-recent-mark">{{ r.source.slice(0, 1) }}</span>
              <span class="dh-recent-txt"><b>{{ r.source }}</b> · {{ r.period }} 更新</span>
              <span class="dh-recent-time">{{ r.time }}</span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  </div>

  <div v-else class="page-loading"><span class="page-spin" /></div>
</template>

<style scoped>
/* 1:1 移植 screen-data-home.jsx DhStyles。本组件独享,绝不复用别组件 scoped 类。 */
.dh { display:flex; flex-direction:column; gap:20px; max-width:1640px; margin:0 auto; width:100%; }
.dh-head { display:flex; align-items:flex-end; justify-content:space-between; gap:16px; flex-wrap:wrap; }
.dh-title { margin:0; font-size:var(--fs-h2); font-weight:var(--fw-semibold); color:var(--text-primary); }
.dh-sub { margin:5px 0 0; font-size:var(--fs-label); color:var(--text-muted); display:flex; align-items:center; gap:10px; }
.dh-period { display:inline-flex; align-items:center; gap:5px; padding:2px 10px; border-radius:var(--radius-full); background:var(--accent-slate); color:var(--text-secondary); font-weight:var(--fw-medium); }
.dh-actions { display:flex; gap:8px; }
.dh-kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(204px,1fr)); gap:16px; }
.dh-cols { display:flex; gap:16px; flex-wrap:wrap; align-items:flex-start; }
.dh-col-tasks { flex:1.5 1 400px; min-width:0; }
.dh-col-prog { flex:1.15 1 320px; min-width:0; }
.dh-col-recent { flex:1 1 280px; min-width:0; }

.dh-task { display:flex; align-items:center; gap:13px; width:100%; padding:14px 6px; border:none; background:transparent; cursor:pointer; text-align:left; font-family:var(--font-sans); border-bottom:1px solid var(--divider); transition:background var(--dur-fast) var(--ease-standard); border-radius:var(--radius-sm); }
.dh-task:last-child { border-bottom:none; }
.dh-task:hover { background:var(--bg-hover); }
.dh-dot { width:9px; height:9px; border-radius:50%; flex:0 0 auto; }
.dh-task-main { flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }
.dh-task-label { font-size:var(--fs-body); font-weight:var(--fw-semibold); color:var(--text-primary); }
.dh-task-meta { font-size:var(--fs-label); color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.dh-task-cta { font-size:var(--fs-label); font-weight:var(--fw-medium); color:var(--text-secondary); display:inline-flex; align-items:center; gap:3px; white-space:nowrap; flex:0 0 auto; }
.dh-task:hover .dh-task-cta { color:var(--text-primary); }
.dh-sevtag { font-size:11px; font-weight:var(--fw-semibold); padding:2px 8px; border-radius:var(--radius-full); white-space:nowrap; flex:0 0 auto; }

.dh-src { display:flex; flex-direction:column; }
.dh-src-row { display:flex; align-items:center; gap:10px; width:100%; padding:11px 6px; border:none; background:transparent; cursor:pointer; text-align:left; font-family:var(--font-sans); border-bottom:1px solid var(--divider); transition:background var(--dur-fast) var(--ease-standard); border-radius:var(--radius-sm); }
.dh-src-row:last-child { border-bottom:none; }
.dh-src-row:hover { background:var(--bg-hover); }
.dh-src-name { font-size:var(--fs-body); color:var(--text-primary); flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.dh-src-tag { font-size:10px; color:var(--text-disabled); border:1px solid var(--border-subtle); border-radius:var(--radius-full); padding:1px 6px; flex:0 0 auto; }
.dh-src-time { font-size:var(--fs-micro); color:var(--text-muted); font-family:var(--font-mono); width:40px; text-align:right; flex:0 0 auto; }
.dh-pill { font-size:11px; font-weight:var(--fw-semibold); padding:2px 9px; border-radius:var(--radius-full); white-space:nowrap; flex:0 0 auto; }

.dh-progress { display:flex; flex-direction:column; gap:8px; margin-bottom:6px; }
.dh-progress-bar { height:7px; border-radius:4px; background:var(--ink-050); overflow:hidden; }
.dh-progress-fill { height:100%; border-radius:4px; background:var(--fill-blue); }
.dh-progress-row { display:flex; align-items:baseline; justify-content:space-between; }
.dh-progress-pct { font-size:24px; font-weight:var(--fw-semibold); color:var(--text-primary); font-variant-numeric:tabular-nums; }
.dh-progress-cap { font-size:var(--fs-label); color:var(--text-muted); }

.dh-recent { display:flex; flex-direction:column; }
.dh-recent-row { display:flex; align-items:center; gap:10px; padding:10px 6px; border-bottom:1px solid var(--divider); }
.dh-recent-row:last-child { border-bottom:none; }
.dh-recent-mark { display:inline-flex; align-items:center; justify-content:center; width:24px; height:24px; flex:0 0 auto; border-radius:50%; background:var(--bg-sunken); color:var(--text-secondary); font-size:11px; font-weight:var(--fw-semibold); }
.dh-recent-txt { font-size:var(--fs-body); color:var(--text-secondary); flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.dh-recent-txt b { color:var(--text-primary); font-weight:var(--fw-semibold); }
.dh-recent-time { font-size:var(--fs-label); color:var(--text-muted); white-space:nowrap; flex:0 0 auto; }
</style>

<script setup lang="ts">
/**
 * PvLabTable —— 核对明细档「逐栋核对表」(PV-ANALYSIS-SCREEN-V4 §3.16;2026-10-06 改稿 pv-v2 m-lab / y-lab)。
 *
 * 9 列:楼栋 96 / 期别 64 / 常年水平 104 / 名次 64 / 大概落在 168 / 哪天起变了 120 / 有效月数 96 / 隔天像不像 96 / 碰巧更偏 96,
 * 行高 32,表头 sticky。后两列是「隔几天的相关柱」「打乱重算的直方图」两张卡下线后并进来的,一栋一个数。
 * 「哪天起变了」跳过并网那个月再找:找到写日子(正文色),没找到写「没找到」(不写「—」:「—」在这屏是库里没数)。
 * 表脚六条参照说清每列怎么读;不做导出(§1 #16)。
 * 行投影(名次、区间、变点只在显著时给、左侧色条、有效月数、两列)全在 pvAnaV4.logic.ts labTableRows。
 * 行只有 hover 底,无气泡、无点击。
 */
import { computed } from 'vue'
import { sgn } from '@/components/ana/anaFmt'
import { PV, PVH, pvTableRefs } from '@/components/ana/anaSentence'
import { LAB_SHUFFLES } from './pvMeterAna.logic'
import { PHASE_COLORS, PV_COLORS } from './pvAnaColors'
import { phaseName, type PvLabTableProps } from './pvAnaV4.logic'

const props = defineProps<PvLabTableProps>()

const md = (d: string) => `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`
const cpText = (from: string, to: string) => (from === to ? md(from) : `${md(from)}–${md(to)}`)
/** 负号用「−」(全屏同一个写法) */
const r2 = (v: number) => v.toFixed(2).replace('-', '−')

const hint = computed(() => PVH.table(props.cover ?? '', props.rows.length))
// 打乱的那个月没有(一栋都没进模型)时后两条不写 —— 表里那两列也全是「—」
const refs = computed(() => pvTableRefs(LAB_SHUFFLES + 1, props.winMonth ?? 0).slice(0, props.winMonth == null ? 4 : 6))
</script>

<template>
  <section class="av2-card plt">
    <div class="av2-card-h">
      <span class="t">{{ PV.card.table }}</span>
      <span class="hint">{{ hint }}</span>
    </div>
    <div class="plt-wrap">
      <table class="plt-tbl">
        <thead>
          <tr>
            <!-- 列宽写 min-width:余宽落进行末空列 .fp-fill(列宽铁律,2026-10-02),auto 布局里有它 width 会被压回内容宽 -->
            <th style="min-width: 96px">楼栋</th>
            <th class="lft" style="min-width: 64px">期别</th>
            <th style="min-width: 104px">常年水平</th>
            <th style="min-width: 64px">名次</th>
            <th style="min-width: 168px">{{ PV.table.ci }}</th>
            <th class="lft" style="min-width: 120px">哪天起变了</th>
            <th style="min-width: 96px">有效月数</th>
            <th style="min-width: 96px">{{ PV.table.acf }}</th>
            <th style="min-width: 96px">{{ PV.table.nul }}</th>
            <th class="fp-fill" aria-hidden="true"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" :data-id="r.id" :class="{ unborn: r.unborn }">
            <td class="nm">
              <span v-if="r.runDir" class="edge" :style="{ background: r.runDir < 0 ? PV_COLORS.BELOW : PV_COLORS.ABOVE }" />
              <span class="nmi"><i class="dot" :style="{ background: PHASE_COLORS[r.phase] ?? 'var(--ink-500)' }" />{{ r.name }}</span>
            </td>
            <td class="lft sub">{{ phaseName(r.phase) }}</td>
            <td v-if="r.unborn" colspan="7" class="lft sub">{{ r.shortDays != null ? `在网 ${r.shortDays} 天，不排` : '没有可算的行' }}</td>
            <template v-else>
              <td class="mono">{{ r.alphaPct == null ? PV.dash : sgn(r.alphaPct, 1, '%') }}</td>
              <td class="mono">{{ r.rank ?? PV.dash }}</td>
              <td class="mono sub">{{ r.ciLo == null || r.ciHi == null ? PV.dash : `${sgn(r.ciLo, 1, '%')} ~ ${sgn(r.ciHi, 1, '%')}` }}</td>
              <td v-if="r.cpFrom && r.cpTo" class="lft">{{ cpText(r.cpFrom, r.cpTo) }}</td>
              <td v-else class="lft sub">{{ PV.cpNone }}</td>
              <td class="mono">{{ r.validMonths == null ? PV.dash : `${r.validMonths} / ${r.monthsSoFar}` }}</td>
              <td class="mono">{{ r.rho1 == null ? PV.dash : r2(r.rho1) }}</td>
              <td class="mono">{{ r.chance ?? PV.dash }}</td>
            </template>
            <td class="fp-fill" aria-hidden="true"></td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-for="r in refs" :key="r.text" class="ana-ref">{{ r.text }}</p>
  </section>
</template>

<style scoped>
/* 表自己横向滚,不让页面横向滚;min-width:0 让网格项不被内容撑宽 */
.plt-wrap { min-width: 0; overflow-x: auto; }
.plt-tbl { width: 100%; border-collapse: separate; border-spacing: 0; }
.plt-tbl th {
  text-align: right; font-size: var(--fs-micro); font-weight: var(--fw-semibold); color: var(--text-muted);
  padding: 0 8px 8px; white-space: nowrap; border-bottom: 1px solid var(--divider);
  background: var(--surface-white); position: sticky; top: 0;
}
.plt-tbl td {
  padding: 0 8px; height: 32px; font-size: var(--fs-label); border-bottom: 1px solid var(--divider);
  text-align: right; white-space: nowrap;
}
.plt-tbl tbody tr:hover td { background: var(--surface-card); }
.plt-tbl .lft { text-align: left; }
.plt-tbl .mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.plt-tbl .sub { color: var(--text-muted); }
.plt-tbl .nm { position: relative; padding-left: 12px; }
.plt-tbl .edge { position: absolute; left: 0; top: 5px; bottom: 5px; width: 2px; border-radius: 2px; }
.plt-tbl .nmi { display: inline-flex; align-items: center; gap: 6px; }
.plt-tbl .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; flex: 0 0 auto; }
.plt-tbl tr.unborn .nm, .plt-tbl tr.unborn .sub { color: var(--text-disabled); }
</style>

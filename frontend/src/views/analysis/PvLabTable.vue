<script setup lang="ts">
/**
 * PvLabTable —— 高级分析档 L7「逐栋核对表」(PV-ANALYSIS-SCREEN-V4 §3.16;计划 §1 #16)。
 *
 * 7 列:楼栋 96 / 期别 64 / 常年水平 104 / 名次 64 / 区间 168 / 哪天起变了 120 / 有效月数 96,行高 32,表头 sticky。
 * 原来的 10 列检验表(z / p / q / N_eff / σ 怎么估…)砍掉:屏上任何档都不写统计名词(V4 §0)。
 * 表脚一句说清砍了哪些;不做导出(§1 #16)。
 * 行投影(名次、区间、变点只在显著时给、左侧色条、有效月数)全在 pvAnaV4.logic.ts labTableRows。
 * 行只有 hover 底,无气泡、无点击。
 */
import { sgn } from '@/components/ana/anaFmt'
import { PHASE_COLORS, PV_COLORS } from './pvAnaColors'
import { phaseName, type PvLabTableProps } from './pvAnaV4.logic'

defineProps<PvLabTableProps>()

const md = (d: string) => `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`
const cpText = (from: string, to: string) => (from === to ? md(from) : `${md(from)}–${md(to)}`)
</script>

<template>
  <section class="av2-card plt">
    <div class="av2-card-h">
      <span class="t">逐栋核对表</span>
      <span class="hint">上面那几张图的数，一栋一行摊开对</span>
    </div>
    <div class="plt-wrap">
      <table class="plt-tbl">
        <thead>
          <tr>
            <th style="width: 96px">楼栋</th>
            <th class="lft" style="width: 64px">期别</th>
            <th style="width: 104px">常年水平</th>
            <th style="width: 64px">名次</th>
            <th style="width: 168px">区间</th>
            <th class="lft" style="width: 120px">哪天起变了</th>
            <th style="width: 96px">有效月数</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" :data-id="r.id" :class="{ unborn: r.unborn }">
            <td class="nm">
              <span v-if="r.runDir" class="edge" :style="{ background: r.runDir < 0 ? PV_COLORS.BELOW : PV_COLORS.ABOVE }" />
              <span class="nmi"><i class="dot" :style="{ background: PHASE_COLORS[r.phase] ?? 'var(--ink-500)' }" />{{ r.name }}</span>
            </td>
            <td class="lft sub">{{ phaseName(r.phase) }}</td>
            <td v-if="r.unborn" colspan="5" class="lft sub">{{ r.shortDays != null ? `在网 ${r.shortDays} 天，不排` : '没有可算的行' }}</td>
            <template v-else>
              <td class="mono">{{ r.alphaPct == null ? '—' : sgn(r.alphaPct, 1, '%') }}</td>
              <td class="mono">{{ r.rank ?? '—' }}</td>
              <td class="mono sub">{{ r.ciLo == null || r.ciHi == null ? '—' : `${sgn(r.ciLo, 1, '%')} ~ ${sgn(r.ciHi, 1, '%')}` }}</td>
              <td v-if="r.cpFrom && r.cpTo" class="lft cp" :style="{ color: PV_COLORS.BELOW }">{{ cpText(r.cpFrom, r.cpTo) }}</td>
              <td v-else class="lft sub">—</td>
              <td class="mono">{{ r.validMonths == null ? '—' : `${r.validMonths} / ${r.monthsSoFar}` }}</td>
            </template>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="ana-ref">常年水平、名次、区间、哪天起变了、有效月数按 {{ year }} 年整年算 · 名次 1 = 常年水平最高 · 左侧色条 = 本段有连续出范围的栋（红 = 低于，琥珀 = 高于）· 砍掉了 6 列算法中间量（检验用的统计量、重算了多少遍、每次取多长、有效天数等）：那些是要复算这屏数字才用得上的</p>
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

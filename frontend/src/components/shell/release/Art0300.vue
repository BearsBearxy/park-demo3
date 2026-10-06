<script setup lang="ts">
// 0.30.0 重点「操作日志的数据修改」的配图:操作日志里两行手改记录的缩样。
// 行照 views/system/SystemLogsView.vue 的 .lg-row 抄:左侧竖轴 + 来源圆点(数据修改那一路是 --hue-yellow)、
// 动作(ACTION 字典原词)、操作人(日志里记的是登录账号)、行 · 列 + 等宽字的「改前 → 改后」(AuditQueryMapper change 分支的拼法)。
// 真屏一行放得下,这里 178 宽折行;字压到 12 / 11。行包在一个 div 里:卡片的 6px 间距不进行间,竖轴连成一条,不撑高卡片。
// 「行 · 列」的格式照真屏(PnlService 的 附表名 · 年 · 分组 · 科目 · 月;AnalysisSettingService 的 经营分析 · 项名);
// 附表1 那行的分组、科目取库里真有的(PnlApiIT 种子:一期、宿舍 / 一期租金收入),金额是同量级的编数 ——
// 不放我园真数,更新记录每个客户都翻得到(2026-10-05 文案复查 F10:原来写「一期 · 租金收入 · 50 → 55」,名和量级都对不上);
// 操作人用内置的 admin —— 原来写了两个编的账号名、行定位也删了前缀,客户会当成真账号、对不上真屏(2026-10-05 对抗复查 COPY-F13)。
// 台账那一行的定位是 公司 · 月 · 租户账面名,只能编,不画。
</script>

<template>
  <div>
    <div class="r">
      <i class="dot" />
      <div class="l1"><b>改损益附表</b><span class="who">admin</span></div>
      <div class="tg">附表1 租金损益明细 · 2025 年 · 一期、宿舍 · 一期租金收入 · 3月 <span class="dt">1128460.5 → 1135000</span></div>
    </div>
    <div class="r">
      <i class="dot" />
      <div class="l1"><b>改目标与阈值</b><span class="who">admin</span></div>
      <div class="tg">经营分析 · 收缴率目标 (%) <span class="dt">96 → 95</span></div>
    </div>
  </div>
</template>

<style scoped>
.r { position: relative; padding: 2px 0 2px 14px; border-left: 1px solid var(--divider); margin-left: 4px; white-space: nowrap; }
.dot { position: absolute; left: -5px; top: 5px; width: 9px; height: 9px; border-radius: 50%; background: var(--hue-yellow);
  box-shadow: 0 0 0 2px var(--surface-white); }
.l1 { display: flex; align-items: baseline; gap: 6px; line-height: 15px; }
.l1 b { font-size: var(--fs-label); font-weight: var(--fw-medium); color: var(--text-secondary); }
.who { font-size: var(--fs-micro); color: var(--text-muted); }
.tg { font-size: var(--fs-label); line-height: 15px; color: var(--text-primary); white-space: normal; }
.dt { font-family: var(--font-mono); font-size: var(--fs-micro); color: var(--text-muted); white-space: nowrap; }
</style>

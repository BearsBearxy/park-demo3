<script setup lang="ts">
// 三大报表的表卡(画布 09):卡头左「N 项 / 搜索 / 删除所选」(插槽 bar),右端「单位：元」;下面是表。
// 「单位：元」原来在页底那条「ⓘ 单位:元 · 口径…」说明行里,D10 把它挪到这里(口径挂到合计行名称的悬停)。
</script>

<template>
  <div class="fc">
    <div class="fc-h">
      <div class="fc-l"><slot name="bar" /></div>
      <span class="fc-unit">单位：元</span>
    </div>
    <slot />
  </div>
</template>

<style scoped>
/* 0 1 auto:行少时卡收到内容高(合计行紧跟最后一行),行多时被屏高压住、表在卡里滚(合计贴底) */
.fc {
  flex: 0 1 auto; min-height: 0; display: flex; flex-direction: column; overflow: hidden;
  border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); background: var(--surface-white);
}
.fc-h {
  flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 12px;
  min-height: 48px; padding: 8px 12px 8px 16px; box-sizing: border-box; border-bottom: 1px solid var(--divider);
}
.fc-l { display: flex; align-items: center; gap: 10px; min-width: 0; }
.fc-unit { flex: none; font-size: var(--fs-label); color: var(--text-muted); white-space: nowrap; }
</style>

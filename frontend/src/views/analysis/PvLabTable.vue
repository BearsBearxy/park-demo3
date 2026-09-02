<script setup lang="ts">
/**
 * PvLabTable —— 「高级分析」档的 L7 完整检验表。
 *
 * **全屏唯一允许出现 p / q / z / σ 的地方。** spec §05 禁止屏上出现统计量,那条对
 * L0 / L1 / 绝对水平 / 账面量 四处继续成立;这一档存在的理由就是给专业的人看这些量,
 * 所以禁词在这里是**必须有**,不是「放宽」。
 *
 * 两条不许破的:
 * ① **不给结论列。** 没有「显著 / 不显著 / 异常」这种判词列 —— 摆数,不下判断。
 *    q 旁边只有一个中性记号 †,脚注写死它的意思是「q ≤ 0.05」,不写形容词。
 * ② **zₙ 那一列不能删。** 它是同一条数据按天数 n 算出来的同一个 z,和 z 并排放着才看得见
 *    「√N 到底错了多少」—— L2 的 ACF 图是这件事的图证,这一列是它的数字证。
 *    删掉 zₙ,ACF 那张图就没有落点了。
 *
 * 列头下面那行 10px 小字是**口径**,不是说明文案:审计问「这个数怎么来的」,答案得印在表头上,
 * 不能藏在别处的方法页里 —— 当年那页被删过一次,教训就是口径要跟着数字走。
 */
import type { TestRow } from './pvMeterAna.logic'

defineProps<{ rows: TestRow[] }>()
const emit = defineEmits<{ (e: 'pick', id: number): void }>()

/** BH-FDR 的线。取 logic 里 bhFdr() 的默认 q —— 改那个默认值,这里要跟着改。 */
const BH_LINE = 0.05

/** p / q 小到 0.000 就不是数了,审计看不出是 4e-5 还是刚好压线。低于千分位改印 <0.001。 */
const p3 = (v: number) => (v < 0.0005 ? '<0.001' : v.toFixed(3))
</script>

<template>
  <div class="plt-wrap">
    <table class="ak-tbl plt">
      <thead>
        <tr>
          <th>楼栋</th>
          <th>α%<span class="cap">相对全园中位</span></th>
          <th>z<span class="cap">用 N_eff 折算</span></th>
          <th>zₙ<span class="cap">同一数按天数 n</span></th>
          <th>p<span class="cap">块自助零分布</span></th>
          <th>q<span class="cap">BH-FDR 校正后</span></th>
          <th>N_eff<span class="cap">按残差自相关折算</span></th>
          <th>有效日<span class="cap">进入计算的天数</span></th>
          <th>变点区间<span class="cap">95% 置信</span></th>
          <th class="lft">σ 怎么估的</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="t in rows" :key="t.id" tabindex="0"
          @click="emit('pick', t.id)"
          @keydown.enter="emit('pick', t.id)"
          @keydown.space.prevent="emit('pick', t.id)"
        >
          <td>{{ t.name }}</td>
          <td class="mono">{{ t.alphaPct.toFixed(1) }}</td>
          <td class="mono">{{ t.z == null ? '—' : t.z.toFixed(2) }}</td>
          <td class="mono mut">{{ t.zNaive == null ? '—' : t.zNaive.toFixed(2) }}</td>
          <td class="mono">{{ p3(t.p) }}</td>
          <td class="mono">
            {{ p3(t.q) }}<span v-if="t.q <= BH_LINE" class="bh">†</span>
          </td>
          <td class="mono">{{ Math.round(t.nEff) }}</td>
          <td class="mono">{{ t.days }}</td>
          <td class="mono mut">{{ t.cpRange }}</td>
          <td class="mut lft">{{ t.sigmaHow }}</td>
        </tr>
      </tbody>
    </table>
    <p class="plt-fn">† q ≤ {{ BH_LINE.toFixed(2) }}（BH-FDR 线）</p>
  </div>
</template>

<style scoped>
/* 表自己横向滚,不许让页面横向滚 —— 10 列在 T2/1280 档一定放不下。
   min-width:0 是必须的:本组件挂在 av2-grid 的网格项里,不写它 flex/grid 子项按内容
   撑宽,overflow-x 永远不触发,横滚条会长在页面上。 */
.plt-wrap { min-width: 0; overflow-x: auto; }
.plt { min-width: 940px; }

/* 表头两行:主标签 + 10px 口径。vertical-align:top 让所有主标签对齐在第一行,
   否则没有口径的那两列(楼栋 / σ)会掉到底部,读起来像另一层表头。 */
.plt th { vertical-align: top; }
.plt .cap {
  display: block; margin-top: 3px;
  font-size: 10px; font-weight: var(--fw-regular);
  color: var(--text-muted); letter-spacing: 0;
}
/* 文本列左对齐(ak-tbl 默认右对齐是给数字的)。 */
.plt .lft { text-align: left; }

.plt tbody tr { cursor: pointer; }
.plt tbody tr:focus-visible { outline: 2px solid var(--text-primary); outline-offset: -2px; }

/* 记号走墨阶。强调色 #9D5D17 按 §06.0 只在 L0-L1,这一档不用。 */
.bh { margin-left: 3px; color: var(--text-muted); }

.plt-fn { margin: 8px 0 0; font-size: 10px; color: var(--text-muted); }
</style>

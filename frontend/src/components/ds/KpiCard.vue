<script lang="ts">
import { nextTick, onBeforeUnmount, onMounted, onUpdated, ref, watch, type Ref } from "vue";

/**
 * 「放不下就降一档」按真宽度判(KPI-CARD-SPEC §3):先按大号排,溢出就降一档;降了还溢出 → tip = 全文(悬停看全)。
 * 量的是 el 自己(nowrap + overflow:hidden,scrollWidth > clientWidth 即放不下),单位也算在里面;
 * 宽度变了(窗口、侧栏收放)看 el 的父元素 —— 父元素的宽不随字号变,降档不会再触发自己,不会来回跳。
 * 字变了(值、插槽里的数)在宿主 onUpdated 里比一次 textContent。KpiCard 24→20、AnaKpiTile / FPStat 20→16 共用。
 */
export function useFitDown(el: Ref<HTMLElement | null>) {
  const small = ref(false);
  const tip = ref<string>();
  let text: string | null = null;
  let run = 0;
  let w = -1;
  const over = () => !!el.value && el.value.scrollWidth > el.value.clientWidth;
  async function fit() {
    const me = ++run;
    text = el.value?.textContent ?? null;
    if (small.value || tip.value) { small.value = false; tip.value = undefined; await nextTick(); }
    if (me !== run || !over()) return;
    small.value = true;
    await nextTick();
    if (me === run && over()) tip.value = el.value!.textContent!.trim();
  }
  const ro = typeof ResizeObserver === "undefined" ? null
    : new ResizeObserver(([r]) => { if (r.contentRect.width !== w) { w = r.contentRect.width; void fit(); } });
  function bind(e: HTMLElement | null, old: HTMLElement | null) {
    if (old?.parentElement) ro?.unobserve(old.parentElement);
    if (e?.parentElement) ro?.observe(e.parentElement);
    void fit();
  }
  // 字体换入会改字宽(先用回退字体排、Roboto Mono 到了再排一次):字体到了重量一次
  const fonts = typeof document === "undefined" ? undefined : document.fonts;
  const onFonts = () => void fit();
  onMounted(() => {
    bind(el.value, null);
    void fonts?.ready.then(onFonts);
    fonts?.addEventListener?.("loadingdone", onFonts);
  });
  watch(el, bind, { flush: "post" });   // 加载完数字位才出现(v-if),换了元素要重挂
  onUpdated(() => { if ((el.value?.textContent ?? null) !== text) void fit(); });
  onBeforeUnmount(() => { ro?.disconnect(); fonts?.removeEventListener?.("loadingdone", onFonts); });
  return { small, tip };
}

/**
 * 值 → [数, 单位]。单位 = 数后面那段非数字尾巴(万 / 万㎡ / 户 / 万/月),画成小一号 sans(KPI-CARD-SPEC §3)。
 * 以数字或 % 收尾的整串都算数('87.6%' '18/21'),没有数字的也整串算数('—' '停用')。
 * AnaKpiTile / FPStat 共用。
 */
export function splitUnit(v: unknown): [string, string] {
  const s = String(v ?? '')
  const m = /^(.*\d%?)([^\d%]\D*)$/.exec(s)
  return m ? [m[1], m[2]] : [s, '']
}
</script>

<script setup lang="ts">
// 列表屏大卡(KPI-CARD-SPEC §3,稿 KpiA ①④):整卡浅底、无边、右上图标 18;数 24,放不下降 20。
import { computed } from "vue";   // ref 在上面的 <script> 里已经 import(同一个模块)
import { iconFor } from "./icon";

export interface KpiCardProps {
  label?: unknown;
  value?: unknown;
  /** 涨跌(数值),画在数右边同一行:↗/↘ 跟符号走,颜色跟好坏走 */
  delta?: number | null;
  /** 涨跌后的灰字,如「环比」 */
  kind?: string;
  /** 涨跌单位 */
  unit?: string;
  /** 越低越好(成本类):跌是绿 */
  invert?: boolean;
  /** 说明行:不是涨跌的副行(「2 栋停用」「待招商」),不带箭头 */
  sub?: unknown;
  subTone?: "warn";
  /** 利润类(营业利润、净利润…):为负时数字标红。收入、增速、差额类不传 */
  profit?: boolean;
  /** 不传时按在排里的位置取 slate → blue → sky → cyan(K2);plain = 灰底 */
  tint?: "slate" | "sky" | "blue" | "cyan" | "plain";
  icon?: unknown;
  /**
   * 数据未到。**卡片盒子一模一样,只有数值位换成微光条**:数行定高 30,条高 24 居中,零位移。
   */
  loading?: boolean;
}

const props = withDefaults(defineProps<KpiCardProps>(), { unit: "%" });

const TINTS: Record<string, string> = {
  slate: "var(--accent-slate)",
  sky: "var(--accent-sky)",
  blue: "var(--accent-blue)",
  cyan: "var(--accent-cyan)",
  plain: "var(--surface-card)",
};

const parts = computed(() => splitUnit(props.value));
// 放不下 24 降 20,按卡的真宽度量(插槽里给的数也量);20 还放不下就省略号 + 悬停看全
const numEl = ref<HTMLElement | null>(null);
const { small, tip } = useFitDown(numEl);
const neg = computed(() => props.profit && /^[−-]/.test(String(props.value ?? "")));
const good = computed(() => props.delta != null && (props.invert ? props.delta <= 0 : props.delta >= 0));
</script>

<template>
  <div class="kc" :class="{ 'kc-auto': !tint }" :style="tint ? { background: TINTS[tint] } : undefined">
    <div class="kc-h">
      <span class="kc-l"><slot name="label">{{ label }}</slot></span>
      <span v-if="$slots.icon || icon" class="kc-i"><slot name="icon">{{ icon }}</slot></span>
    </div>

    <div class="kc-v">
      <span v-if="loading" class="fp-shim kc-sk" aria-hidden="true"></span>
      <span v-else ref="numEl" class="kc-n" :class="{ s20: small }" :style="neg ? { color: 'var(--delta-down-text)' } : undefined"
            :title="tip">
        <slot>{{ parts[0] }}<span v-if="parts[1]" class="u">{{ parts[1] }}</span></slot>
      </span>
      <template v-if="delta != null">
        <span v-if="loading" class="fp-shim kc-sk-d" aria-hidden="true"></span>
        <span v-else class="kc-d">
          <span class="dl" :style="{ color: good ? 'var(--delta-up-text)' : 'var(--delta-down-text)' }">
            {{ (delta >= 0 ? "+" : "−") + Math.abs(delta).toFixed(1) + unit }}<component :is="iconFor(delta >= 0 ? 'arrow-up-right' : 'arrow-down-right')" :size="14" />
          </span>
          <span v-if="kind" class="dk">{{ kind }}</span>
        </span>
      </template>
    </div>

    <div v-if="$slots.sub || sub != null" class="kc-s" :class="{ warn: subTone === 'warn' }">
      <span v-if="loading" class="fp-shim kc-sk-s" aria-hidden="true"></span>
      <slot v-else name="sub">{{ sub }}</slot>
    </div>
  </div>
</template>

<style scoped>
/* 像素照抄 gen-画板生成脚本.mjs .kc*(方向 A) */
.kc { box-sizing: border-box; min-width: 0; border-radius: var(--radius-lg); padding: 20px; display: flex; flex-direction: column; gap: 12px; }
.kc-auto:nth-child(4n + 1) { background: var(--accent-slate); }
.kc-auto:nth-child(4n + 2) { background: var(--accent-blue); }
.kc-auto:nth-child(4n + 3) { background: var(--accent-sky); }
.kc-auto:nth-child(4n) { background: var(--accent-cyan); }
.kc-h { display: flex; align-items: center; justify-content: space-between; gap: 8px; height: 20px; }
.kc-l { min-width: 0; font-size: var(--fs-body); line-height: 20px; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.kc-i { display: flex; flex: 0 0 auto; color: var(--text-secondary); }
.kc-i :deep(svg) { width: 18px; height: 18px; }
.kc-v { display: flex; align-items: center; justify-content: space-between; gap: 8px; height: 30px; }
.kc-n { min-width: 0; font-family: var(--font-mono); font-size: var(--fs-h1); line-height: 30px; font-weight: var(--fw-semibold); letter-spacing: var(--ls-tight); color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.kc-n.s20 { font-size: var(--fs-h2); }
.kc-n .u { margin-left: 2px; font-family: var(--font-sans); font-size: var(--fs-h3); font-weight: var(--fw-medium); }
.kc-d { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 4px; font-size: var(--fs-label); }
.kc-d .dl { display: inline-flex; align-items: center; gap: 2px; font-family: var(--font-mono); white-space: nowrap; }
.kc-d .dk { color: var(--text-muted-tint); }
.kc-s { min-height: 18px; font-size: var(--fs-label); line-height: 18px; color: var(--text-muted-tint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.kc-s.warn { color: var(--warn-text); }
.kc-sk { display: block; width: 96px; height: 24px; }
.kc-sk-d { display: block; flex: 0 0 auto; width: 56px; height: 12px; }
.kc-sk-s { display: block; width: 60%; height: 12px; margin-top: 3px; }
</style>

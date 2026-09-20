<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted, useId, type CSSProperties } from "vue";
import { useViewport } from "@/composables/useViewport";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  label?: string;
  options?: Array<string | SelectOption>;
  value?: string;
  modelValue?: string;
  defaultValue?: string;
  placeholder?: string;
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  /** 红框错误态。与 fp/FPTenantPicker 的 invalid 同语义同色(--status-danger) ——
   *  合同弹窗「请选择楼栋/租户」两个必填项并排,一个有红框一个没有会读成「只有那个错了」。 */
  invalid?: boolean;
  defaultOpen?: boolean;
  id?: string;
  style?: string | Record<string, string>;
}

const props = withDefaults(defineProps<SelectProps>(), {
  options: () => [],
  size: "md",
  disabled: false,
  invalid: false,
  defaultOpen: false,
});

const emit = defineEmits<{
  change: [e: { target: { value: string } }, value: string];
  "update:modelValue": [value: string];
}>();

// controlled: modelValue (v-model) or value prop; uncontrolled: inner ref
const inner = ref<string | undefined>(
  props.modelValue !== undefined
    ? props.modelValue
    : props.value !== undefined
    ? props.value
    : props.defaultValue
);

// prefer modelValue for v-model, then value for controlled, then inner
const val = computed(() =>
  props.modelValue !== undefined
    ? props.modelValue
    : props.value !== undefined
    ? props.value
    : inner.value
);

const open = ref(props.defaultOpen);
const containerRef = ref<HTMLElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
/** 键盘活动项(aria-activedescendant 指的那一项)。焦点始终留在触发器上,选项不各自可聚焦。 */
const activeIndex = ref(-1);

const autoId = useId();
const selectId = computed(() => props.id || autoId);
const panelId = computed(() => `${selectId.value}-listbox`);
const optId = (i: number) => `${selectId.value}-opt-${i}`;
const activeId = computed(() =>
  open.value && activeIndex.value >= 0 ? optId(activeIndex.value) : undefined
);

const height = computed(() => ({ sm: 32, md: 36, lg: 44 }[props.size] ?? 36));

// ── S 档底部面板(RESPONSIVE-LAYOUT-SPEC §4.4;壳同 ds/DatePicker.vue:665-685)──
// 贴附 popover 在 390 上会出屏:字段在右半屏时(工具条「全部状态」就是)面板宽 220 从 left 214
// 起算 = 右缘 434 > 视口 390,右边 44px 看不见也点不着。≤600 改成从底部升起的面板。
// 壳与定位全在 .ds-sel-sheet 的 CSS 里,**贴附分支一条不动** —— 桌面零差异(§9)。
const vp = useViewport();
const sheet = computed(() => vp.tier.value === "s");
const sheetTitle = computed(() => props.label || props.placeholder || "请选择");
// 贴附面板的定位/尺寸原先写在模板的内联 :style 里。底部面板要把它整套换掉,而内联样式只有
// !important 压得住 —— 与其在 CSS 里堆 !important,不如让 sheet 档干脆不出这套内联样式。
// 对象字面量逐字搬过来,XL 档渲染出的 style 属性与改前一致。
const popStyle = computed<CSSProperties>(() => ({
  position: "absolute",
  top: "calc(100% + 6px)",
  left: "0",
  /* 面板宽度贴内容不贴触发器:窄触发器(如 92px 月份选择)下选项文本+勾不再截断 */
  minWidth: "100%",
  width: "max-content",
  maxWidth: "280px",
  zIndex: "var(--z-popover)", /* 改前是字面量 60(PAGE-BEHAVIOR-SPEC §3:新增覆盖层一律用令牌) */
  background: "var(--surface-raised)",
  border: "1px solid var(--border-subtle)",
  borderRadius: "var(--radius-md)",
  boxShadow: "var(--shadow-pop)",
  padding: "6px",
  /* 12 项(年月选择)整列可见不滚动:12×36px 行高 + 上下 padding */
  maxHeight: "456px",
  overflowY: "auto",
  boxSizing: "border-box",
}));

const items = computed<SelectOption[]>(() =>
  props.options.map((o) =>
    typeof o === "string" ? { value: o, label: o } : { value: o.value, label: String(o.label) }
  )
);

const current = computed(() => items.value.find((it) => it.value === val.value));

function pick(v: string) {
  open.value = false;
  // 选中的还是当前这项 = 什么都没变,不发事件。原生 <select> 就是这个语义(HTML 规范:change
  // 只在值真的变了才派发),而调用方是照着原生的脾气写的:ParamCenterView 的 setExKey 重选同一项
  // 会把已填的值和楼栋清空;TemplateEditorPanel 的版本切换会走一次真写服务端的 booksApi.pin()。
  // 2026-09-20 起那两处各自挡了一道,这里是把它收到根上。
  if (v === val.value) return;
  inner.value = v;
  const e = { target: { value: v } };
  emit("change", e, v);
  emit("update:modelValue", v);
}

// ── 键盘:标准 combobox(2026-09-20 补)──
// 改前只认 Esc。原生 <select> 本来给的 ↑↓ 改值、Home/End、首字母跳转、Alt+↓ 展开全没有,
// 能用的只剩 Tab 逐个走到选项 + Enter,而且 Tab 走出去面板还不关,留一块浮层悬在内容上。
// 焦点全程留在触发器上,活动项靠 aria-activedescendant 指——这是 combobox 的标准做法,
// 选项各自可聚焦那种写法读屏软件会把它念成一堆按钮。
function scrollActiveIntoView() {
  void nextTick(() => {
    const el = panelRef.value?.querySelector<HTMLElement>("[data-active]");
    el?.scrollIntoView?.({ block: "nearest" });   // jsdom 没有这个方法,可选链兜住
  });
}

/** 打开面板,活动项落在当前选中项上(没有选中值时落第一项)。 */
function openPanel() {
  open.value = true;
  const i = items.value.findIndex((it) => it.value === val.value);
  activeIndex.value = i >= 0 ? i : 0;
  scrollActiveIntoView();
}

function moveActive(delta: number) {
  const n = items.value.length;
  if (!n) return;
  activeIndex.value = (activeIndex.value + delta + n) % n;   // 到头绕回去,同原生
  scrollActiveIntoView();
}

// 首字母跳转:600ms 内连着敲算一个串(敲 "b" "e" 找 be…),超时重新计。
// 连敲同一个字母是特例:不当成 "bb" 去搜,而是在同首字母的项之间轮转 —— 原生就是这个手感,
// 也是 ARIA APG 对 listbox typeahead 的规定。轮转要从下一项找起,否则原地不动。
let typed = "";
let typedAt = 0;
function typeahead(ch: string) {
  const now = Date.now();
  typed = now - typedAt > 600 ? ch : typed + ch;
  typedAt = now;
  const n = items.value.length;
  if (!n) return;
  const cycling = /^(.)\1*$/.test(typed);       // 全是同一个字符(含刚敲第一下)
  const needle = (cycling ? typed[0] : typed).toLowerCase();
  const from = cycling ? activeIndex.value + 1 : activeIndex.value;
  for (let k = 0; k < n; k++) {
    const i = (from + k + n) % n;
    if (items.value[i].label.toLowerCase().startsWith(needle)) {
      activeIndex.value = i;
      scrollActiveIntoView();
      return;
    }
  }
}

function onTriggerKey(e: KeyboardEvent) {
  if (props.disabled) return;
  const k = e.key;
  if (!open.value) {
    if (k === "ArrowDown" || k === "ArrowUp" || k === "Enter" || k === " ") {
      e.preventDefault();
      openPanel();
      return;
    }
  } else {
    if (k === "ArrowDown") { e.preventDefault(); moveActive(1); return; }
    if (k === "ArrowUp") { e.preventDefault(); moveActive(-1); return; }
    if (k === "Home") { e.preventDefault(); activeIndex.value = 0; scrollActiveIntoView(); return; }
    if (k === "End") { e.preventDefault(); activeIndex.value = items.value.length - 1; scrollActiveIntoView(); return; }
    if (k === "Enter" || k === " ") {
      e.preventDefault();
      const it = items.value[activeIndex.value];
      if (it) pick(it.value);
      return;
    }
    // Tab 不拦:焦点照常往后走,顺手把面板收掉(改前会留一块浮层悬在内容上)
    if (k === "Tab") { open.value = false; return; }
  }
  if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    if (!open.value) openPanel();
    typeahead(k);
  }
}

/** 焦点离开整个下拉(Tab 走掉、点到别处)就关。改前只有点外面和 Esc 会关。 */
function onFocusOut(e: FocusEvent) {
  const next = e.relatedTarget as Node | null;
  if (!next || !containerRef.value?.contains(next)) open.value = false;
}

function onDoc(e: MouseEvent) {
  const t = e.target as Node;
  // S 档面板 teleport 到 body,已不在 containerRef 里:少了 panelRef 这一判,点选项时
  // capture 阶段先把 open 置 false → 面板卸载 → click 永远派不出来,一项都选不中。
  // XL 档面板本就在 containerRef 内,这一判恒为假,行为不变。
  if (panelRef.value?.contains(t)) return;
  if (containerRef.value && !containerRef.value.contains(t)) {
    open.value = false;
  }
}

function onKey(e: KeyboardEvent) {
  // Esc 只关本下拉:不阻断的话宿主弹窗(FPDrawer 的 window keydown)会连宿主一起关,
  // 用户想收下拉、结果整个抽屉没了,录到一半的东西全丢(UI-OVERLAY-SPEC §2)
  if (e.key === "Escape") {
    e.stopPropagation();
    open.value = false;
  }
}

// ⭐capture 阶段(UI-OVERLAY-SPEC §1):宿主弹窗容器普遍带 @mousedown.stop —— FPDrawer.vue:33
// 的 .fp-dwr 就是。冒泡阶段监听在弹窗内**永远收不到**事件,于是抽屉里每一个下拉点外面都不关,
// 只能再点一次触发器或按 Esc(2026-08-15 用户报障「点开了点击别的区域不会回弹关闭」)。
// capture 先于任何 .stop 派发,不受影响。同 ds/Popover.vue 的既有做法。
onMounted(() => {
  document.addEventListener("mousedown", onDoc, true);
  document.addEventListener("keydown", onKey, true);
});

onUnmounted(() => {
  document.removeEventListener("mousedown", onDoc, true);
  document.removeEventListener("keydown", onKey, true);
});
</script>

<template>
  <div
    ref="containerRef"
    @focusout="onFocusOut"
    :style="[
      { display: 'flex', flexDirection: 'column', gap: '6px', position: 'relative' },
      props.style as any,
    ]"
  >
    <label
      v-if="label"
      :for="selectId"
      :style="{
        font: 'var(--type-label)',
        color: 'var(--text-secondary)',
        fontWeight: 'var(--fw-medium)',
      }"
    >
      {{ label }}
    </label>

    <button
      :id="selectId"
      type="button"
      class="ds-sel-trigger"
      :data-open="open ? '' : undefined"
      :data-invalid="invalid ? '' : undefined"
      :disabled="disabled"
      role="combobox"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-controls="panelId"
      :aria-activedescendant="activeId"
      @keydown="onTriggerKey"
      @click="open ? (open = false) : openPanel()"
      :style="{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '8px',
        height: height + 'px',
        padding: '0 12px',
        background: disabled ? 'var(--bg-sunken)' : 'var(--surface-white)',
        border: '1px solid var(--ds-sel-border)',
        borderRadius: 'var(--radius-sm)',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--ds-sel-fs)',
        color: current ? 'var(--text-primary)' : 'var(--text-muted)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        textAlign: 'left',
        width: '100%',
        boxSizing: 'border-box',
        transition: 'border-color var(--dur-fast) var(--ease-standard)',
        opacity: disabled ? '0.6' : '1',
      }"
    >
      <span :style="{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }">
        {{ current ? current.label : placeholder || "请选择" }}
      </span>
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        :style="{
          color: 'var(--text-muted)',
          flex: '0 0 auto',
          transform: open ? 'rotate(180deg)' : 'none',
          transition: 'transform var(--dur-fast) var(--ease-standard)',
        }"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>

    <Teleport to="body" :disabled="!sheet">
    <div v-if="open && sheet" class="ds-sel-scrim" />
    <div
      v-if="open"
      ref="panelRef"
      :id="panelId"
      class="ds-sel-panel"
      :class="{ 'ds-sel-sheet': sheet }"
      role="listbox"
      :style="sheet ? undefined : popStyle"
    >
      <!-- S 档:把手 + 标题行(左标题右 ✕),同 ds/DatePicker 的底部面板 -->
      <template v-if="sheet">
        <div class="ds-sel-hdl" />
        <div class="ds-sel-sh">
          <span>{{ sheetTitle }}</span>
          <button type="button" class="ds-sel-shx" aria-label="关闭" @click="open = false">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </template>
      <button
        v-for="(it, i) in items"
        :key="it.value"
        :id="optId(i)"
        type="button"
        role="option"
        tabindex="-1"
        class="ds-sel-opt"
        :aria-selected="it.value === val"
        :data-active="i === activeIndex ? '' : undefined"
        @mousedown.prevent
        @click="pick(it.value)"
        :style="{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          width: '100%',
          padding: '8px 10px',
          border: 'none',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--fs-body)',
          fontWeight: it.value === val ? 'var(--fw-medium)' : 'var(--fw-regular)',
          cursor: 'pointer',
          textAlign: 'left',
          transition: 'background var(--dur-fast) var(--ease-standard)',
        }"
      >
        <span :style="{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }">
          {{ it.label }}
        </span>
        <svg
          v-if="it.value === val"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          :style="{ flex: '0 0 auto' }"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </button>
    </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* 触发器边框走变量桥:展开态要区别于默认态,而内联 :style 写不了状态选择器,
   改前只能把三种情况塞进一个三元表达式。
   ⚠ 展开态原本用 --border-strong,与默认的 --border-subtle 实测只有 1.24:1 ——
   WCAG 2.4.11 要求 3:1,等于展开时边框几乎没变化(同 Input 的老问题)。
   现改 --status-info(对默认态 3.96:1)。invalid 规则放在最后,红框优先于展开蓝框。 */
.ds-sel-trigger { --ds-sel-border: var(--border-control); --ds-sel-fs: var(--fs-body); }
/* iOS 对 <16px 的输入控件聚焦会自动放大整页;字号走变量桥,因为媒体查询盖不住内联 style */
@media (max-width: 600px) {
  .ds-sel-trigger { --ds-sel-fs: var(--fs-input-m); }
}
.ds-sel-trigger[data-open] { --ds-sel-border: var(--status-info); }
.ds-sel-trigger[data-invalid] { --ds-sel-border: var(--status-danger); }

/* 面板入场。改前是 v-if 硬切,面板凭空出现。 */
.ds-sel-panel { animation: fp-pop-in var(--dur-fast) var(--ease-out); }

/* 选项 hover。改前写的是 $event.currentTarget.style.background —— 手写 DOM,
   绕过 Vue 响应式,任何重渲染都会把它冲掉;而且为此选项的内联 style 里还得写死
   background:'transparent',那条现已移除,否则内联优先级会压过这里的 :hover。 */
.ds-sel-opt { background: transparent; }
.ds-sel-opt:hover { background: var(--bg-hover); }
/* 键盘活动项:和 hover 同一个底色 —— 键盘走到哪要看得见,否则 ↑↓ 等于盲按 */
.ds-sel-opt[data-active] { background: var(--bg-hover); }

/* ── S 档:从底部升起的面板(壳同 ds/DatePicker.vue:665-685 的 .dp-sheet)── */
.ds-sel-scrim { position: fixed; inset: 0; z-index: var(--z-confirm); background: var(--scrim); opacity: 0; animation: fp-fade-in var(--dur-base) forwards; }
.ds-sel-panel.ds-sel-sheet {
  position: fixed; top: auto; left: 0; right: 0; bottom: 0; width: auto; max-width: none;
  z-index: var(--z-confirm);   /* 与 DatePicker 底部面板同档:宿主弹窗(modal/modal-2)之上 */
  background: var(--surface-raised); border: none;
  border-radius: var(--radius-lg) var(--radius-lg) 0 0; box-shadow: var(--shadow-pop);
  padding: 0 8px 34px;         /* 34 = iOS 手势条安全区,同 .dp-sheet */
  /* 选项多时内滚;不铺满整屏,下面那截还看得见「我是从哪个字段点开的」 */
  max-height: 60dvh; overflow-y: auto; box-sizing: border-box;
  animation: ds-sel-sheet-in var(--dur-base) var(--ease-out);
}
@keyframes ds-sel-sheet-in { from { transform: translateY(100%); } }
.ds-sel-hdl { width: 36px; height: 5px; margin: 8px auto 0; border-radius: 3px; background: var(--ink-300); }
/* 标题行钉在面板顶:选项超出 60dvh 时滚的是选项,✕ 不能跟着滚出去 */
.ds-sel-sh {
  position: sticky; top: 0; z-index: 1; display: flex; align-items: center; justify-content: space-between;
  height: 52px; padding: 0 4px 0 12px; background: var(--surface-raised);
  font-size: var(--fs-h3); font-weight: var(--fw-semibold); color: var(--text-primary);
}
.ds-sel-shx { width: 44px; height: 44px; display: grid; place-items: center; padding: 0; border: none; background: none; color: var(--text-secondary); cursor: pointer; }
/* 选项行:52 高(>44,一排选项要好戳)/ 16px 字。三条都盖内联 style,只有 !important 压得住。 */
.ds-sel-sheet .ds-sel-opt {
  height: 52px !important;
  padding: 0 12px !important;
  font-size: var(--fs-input-m) !important;
  border-radius: var(--radius-sm);
}
</style>

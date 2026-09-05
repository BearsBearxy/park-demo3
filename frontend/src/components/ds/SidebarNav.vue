<script lang="ts">
/**
 * SidebarNav — 本文件即标准。
 *
 * 源于 2026-06 对设计包 SidebarNav.jsx 的 1:1 移植；那份 jsx 已冻结为
 * 2026-06 基线（.claude/skills/factory-park-design/），不再跟随本文件更新。
 * v-model support added: modelValue mirrors `active`; emits "update:modelValue".
 * 2026-09-03(SIDEBAR-UX-REDESIGN §3.2):加 openTitles / toggle 做组折叠;删掉全仓零调用点的 collapsed 折叠轨道与 flyout 分支。
 */
import { defineComponent, h, ref, computed, Fragment } from "vue";
import { usePresenceStore } from '@/stores/presence'
import { NAV_SCOPE_PREFIX, scopeNote } from '@/utils/lockScopes'

// ---- shared types ---------------------------------------------------------

export interface SidebarItem {
  value: string;
  label: string;
  icon?: any;          // component constructor or VNode
  children?: SidebarItem[];
  defaultOpen?: boolean;
  shortcut?: string;
  trailing?: any;      // component constructor or VNode
  /** @deprecated */
  nested?: boolean;
  /** @deprecated */
  expandable?: boolean;
}

export interface SidebarSection {
  title?: string;
  items: SidebarItem[];
}

export interface SidebarNavProps {
  sections?: SidebarSection[];
  active?: string;
  modelValue?: string;
  /** 传了就按标题折叠:不在集合里的带标题组只画标题行;不传 = 全部展开(老行为) */
  openTitles?: string[];
}

// ---- shared row base style ------------------------------------------------

const ROW_BASE: Record<string, string> = {
  position: "relative",
  display: "flex",
  alignItems: "center",
  gap: "8px",
  height: "34px",
  border: "none",
  borderRadius: "var(--radius-sm)",
  background: "transparent",
  fontFamily: "var(--font-sans)",
  fontSize: "var(--fs-body)",
  fontWeight: "var(--fw-medium)",
  cursor: "pointer",
  textAlign: "left",
  width: "100%",
  transition: "background var(--dur-fast) var(--ease-standard)",
  boxSizing: "border-box",
};

// ---- Chevron (matches .jsx Chevron component) ------------------------------

function Chevron(open: boolean) {
  return h("svg", {
    width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
    strokeWidth: "2.5", strokeLinecap: "round", strokeLinejoin: "round",
    style: {
      color: "var(--text-muted)", flex: "0 0 auto",
      transition: "transform var(--dur-fast) var(--ease-standard)",
      transform: open ? "rotate(90deg)" : "none",
    },
  }, [h("polyline", { points: "9 18 15 12 9 6" })]);
}

// ---- collectDefaultOpen ---------------------------------------------------

function collectDefaultOpen(items: SidebarItem[] | undefined, set: Set<string>): Set<string> {
  for (const it of items || []) {
    if (it.children && it.children.length) {
      if (it.defaultOpen) set.add(it.value);
      collectDefaultOpen(it.children, set);
    }
  }
  return set;
}

// ---- renderIcon: safely render an icon prop (component or VNode) ----------
// ponytail: icon can be a component or a plain VNode; h() handles both
function renderIcon(icon: any, style?: Record<string, string>) {
  if (!icon) return null;
  try {
    return h("span", { style: { display: "inline-flex", flex: "0 0 auto", ...(style || {}) } }, [
      typeof icon === "object" && icon.render ? h(icon) : icon,
    ]);
  } catch {
    return null;
  }
}

// ---- SidebarNav component -------------------------------------------------

export default defineComponent({
  name: "SidebarNav",

  props: {
    sections:   { type: Array as () => SidebarSection[], default: () => [] },
    active:     { type: String,  default: undefined },
    modelValue: { type: String,  default: undefined },
    openTitles: { type: Array as () => string[], default: undefined },
  },

  emits: ["select", "update:modelValue", "toggle"],

  setup(props, { emit }) {
    // controlled / uncontrolled duality
    const activeValue = computed(() =>
      props.modelValue !== undefined ? props.modelValue : props.active
    );

    // expanded-tree open state
    const presence = usePresenceStore();
    const allItems = computed(() => props.sections.flatMap((s) => s.items || []));
    const openSet = ref<Set<string>>(collectDefaultOpen(allItems.value, new Set()));

    function toggle(value: string) {
      const next = new Set(openSet.value);
      next.has(value) ? next.delete(value) : next.add(value);
      openSet.value = next;
    }

    function select(value: string, ev?: MouseEvent) {
      emit("select", value, ev);
      emit("update:modelValue", value);
    }

    // ---- expanded tree (recursive) ----------------------------------------

    /**
     * 这个导航项底下有没有人在编辑 —— 有则返回提示文案，无则返回 null。
     *
     * **只标编辑态**（设计稿 §04）：标记要回答的只有「我点进去改得了吗」，
     * 别人在看不挡你。全标上的话侧栏常年一片点，一周之内就没人看了。
     */
    function editingHere(navValue: string): string | null {
      // 一个导航项可能挂多个锁根(一屏两本账:报送台账 + 运营账),逐个查再并起来
      const prefix = NAV_SCOPE_PREFIX[navValue];
      if (!prefix) return null;
      const ps = Array.isArray(prefix) ? prefix : [prefix];
      const who = ps.flatMap((p) => presence.editorsUnder(p));
      if (!who.length) return null;
      const names = who.map((e) => `${e.displayName} 正在编辑`).join("、");
      // 共占锁的屏要说清楚为什么这几个一起亮 —— 否则看着像见鬼。
      // ⚠ 喂 scopeNote 的必须是**锁**(editScopes 里命中前缀的那把)。
      //   seat.scope 在 2026-08-30 之后只是「在哪一屏」,生产里 AppShell 恒传 null ——
      //   拿它喂的话这句解释永远渲染不出来,正是 2026-08-26 用户「莫名其妙」投诉的那条回退。
      const lockSc = who[0].editScopes.find((sc) =>
        ps.some((p) => sc === p || sc.startsWith(p + ":") || sc.startsWith(p + "-"))) ?? null;
      const note = scopeNote(lockSc);
      return note ? `${names}
${note}` : names;
    }

    function renderTree(items: SidebarItem[], depth: number): any[] {
      return items.map((it) => {
        const isDir  = !!(it.children && it.children.length);
        const isOpen = openSet.value.has(it.value);
        const on     = !isDir && it.value === activeValue.value;

        const rowStyle: Record<string, string> = {
          ...ROW_BASE,
          paddingLeft:  `${12 + depth * 16}px`,
          paddingRight: "12px",
          background:   "var(--fp-sbnav-bg)",
          color:        on ? "var(--text-primary)" : "var(--text-secondary)",
        };

        const btn = h("button", {
          class: "fp-sbnav-row",
          "data-on": on ? "" : undefined,
          style: rowStyle,
          onClick: (e: MouseEvent) => isDir ? toggle(it.value) : select(it.value, e),
        }, [
          // active accent bar
          on ? h("span", { style: { position: "absolute", left: "0", top: "8px", bottom: "8px", width: "3px", borderRadius: "3px", background: "var(--text-primary)" } }) : null,
          // chevron (directories only) — leaf items go icon-first, no spacer (matches offline HTML)
          isDir ? Chevron(isOpen) : null,
          // icon
          it.icon ? renderIcon(it.icon, { color: on ? "var(--text-primary)" : "var(--text-secondary)" }) : null,
          // label
          h("span", { style: { flex: "1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, [it.label]),
          // trailing
          it.trailing ? h("span", {}, [it.trailing]) : null,
          // 在场标记(PRESENCE §04):有人正在这一屏的某一期编辑。
          // **绝对定位** —— 出现与消失都不改变行的尺寸(LAYOUT-STABILITY)。
          editingHere(it.value)
            ? h("span", {
                title: editingHere(it.value),
                style: {
                  position: "absolute", right: "10px", top: "50%", marginTop: "-3px",
                  width: "6px", height: "6px", borderRadius: "50%",
                  background: "var(--hue-orange)",
                },
              })
            : null,
        ]);

        return h(Fragment, { key: it.value }, [
          btn,
          ...(isDir && isOpen ? renderTree(it.children!, depth + 1) : []),
        ]);
      });
    }

    // ---- 组标题 ----------------------------------------------------------
    // 像素同 DESIGN-FIDELITY §2.3(--type-label / 6px 12px → 30px 行)。可折叠时是 button:
    // chevron 与折叠态的「有人在编辑」聚合点都 absolute —— 出现与消失不改行的尺寸(LAYOUT-STABILITY)。
    const TITLE_STYLE: Record<string, string> = { font: "var(--type-label)", color: "var(--text-muted)", padding: "6px 12px" };
    function renderTitle(sec: SidebarSection, foldable: boolean, open: boolean) {
      if (!foldable) return h("div", { style: TITLE_STYLE }, [sec.title]);
      // 收起的组把子项的在场提示聚到标题上:组收着也得知道里面有人在改
      const notes = open ? [] : sec.items.map((it) => editingHere(it.value)).filter((n): n is string => !!n);
      return h("button", {
        class: "fp-sbnav-title",
        type: "button",
        "aria-expanded": open ? "true" : "false",
        style: {
          ...TITLE_STYLE, color: "var(--fp-sbnav-title-c)",
          position: "relative", display: "block", width: "100%", textAlign: "left",
          border: "none", background: "transparent", cursor: "pointer", boxSizing: "border-box",
        },
        onClick: () => emit("toggle", sec.title),
      }, [
        sec.title,
        h("span", { style: { position: "absolute", right: "12px", top: "50%", marginTop: "-7px", display: "inline-flex" } }, [Chevron(open)]),
        notes.length
          ? h("span", {
              title: notes.join("\n"),
              style: {
                position: "absolute", right: "32px", top: "50%", marginTop: "-3px",
                width: "6px", height: "6px", borderRadius: "50%", background: "var(--hue-orange)",
              },
            })
          : null,
      ]);
    }

    // ---- render -----------------------------------------------------------

    return () =>
      h("nav", { style: { display: "flex", flexDirection: "column", gap: "16px" } },
        props.sections.map((sec, si) => {
          // 带标题组可折叠(SIDEBAR-UX-REDESIGN §3.2):openTitles 未传 = 老行为,全部展开
          const foldable = !!sec.title && props.openTitles !== undefined;
          const open = !foldable || props.openTitles!.includes(sec.title!);
          return h("div", { key: si, style: { display: "flex", flexDirection: "column", gap: "2px" } }, [
            sec.title ? renderTitle(sec, foldable, open) : null,
            ...(open ? renderTree(sec.items, 0) : []),
          ]);
        })
      );
  },
});
</script>

<!-- ⚠ 刻意不用 scoped:本组件是 render 函数(h())而非模板,Vue 只把 scopeId 加到根
     vnode 上,h() 创建的深层元素拿不到 data-v-*,scoped 规则会全部落空。
     改用 .fp-sbnav-* 前缀做隔离。 -->
<style>
/* 行的悬停与选中。
   改前写的是 onMouseenter 里 e.currentTarget.style.background = ... —— 手写 DOM、
   绕过 Vue 响应式,任何触发重渲染的状态变化都会把它冲掉;而且为了不让 hover 盖掉选中行,
   还得在两个回调里各写一次 if (!on) 守卫。现在背景走 --fp-sbnav-bg,
   选中与悬停各一条 CSS 规则,守卫也不需要了。 */
.fp-sbnav-row { --fp-sbnav-bg: transparent; }
.fp-sbnav-row:hover { --fp-sbnav-bg: var(--bg-hover); }
.fp-sbnav-row[data-on] { --fp-sbnav-bg: var(--bg-hover); }

/* 组标题按钮:颜色走变量,inline 的 color 才能被 :hover 盖到(与行的 --fp-sbnav-bg 同一招)。 */
.fp-sbnav-title { --fp-sbnav-title-c: var(--text-muted); }
.fp-sbnav-title:hover { --fp-sbnav-title-c: var(--text-secondary); }
</style>

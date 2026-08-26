<script lang="ts">
/**
 * SidebarNav — 本文件即标准。
 *
 * 源于 2026-06 对设计包 SidebarNav.jsx 的 1:1 移植；那份 jsx 已冻结为
 * 2026-06 基线（.claude/skills/factory-park-design/），不再跟随本文件更新。
 * v-model support added: modelValue mirrors `active`; emits "update:modelValue".
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
  collapsed?: boolean;
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
    collapsed:  { type: Boolean, default: false },
  },

  emits: ["select", "update:modelValue"],

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

    // folded-rail hover / flyout state
    const hoverVal = ref<string | null>(null);
    const flyout   = ref<string | null>(null);

    function select(value: string) {
      flyout.value = null;
      emit("select", value);
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
      const prefix = NAV_SCOPE_PREFIX[navValue];
      if (!prefix) return null;
      const who = presence.editorsUnder(prefix);
      if (!who.length) return null;
      const names = who.map((e) => `${e.displayName} 正在编辑`).join("、");
      // 共占锁的屏要说清楚为什么这几个一起亮 —— 否则看着像见鬼
      const note = scopeNote(who[0].scope);
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
          onClick: () => isDir ? toggle(it.value) : select(it.value),
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

    // ---- render -----------------------------------------------------------

    return () => {
      if (props.collapsed) {
        // ---- FOLDED RAIL --------------------------------------------------
        return h("nav", {
          style: { display: "flex", flexDirection: "column", gap: "4px", width: "56px" },
        },
          props.sections.map((sec, si) =>
            h("div", {
              key: si,
              style: { display: "flex", flexDirection: "column", gap: "4px", marginTop: si > 0 ? "8px" : "0" },
            },
              sec.items.map((it) => {
                const isDir = !!(it.children && it.children.length);
                const on    = !isDir && it.value === activeValue.value;
                const isFly = flyout.value === it.value;
                const lit   = on || isFly;

                return h("div", {
                  key: it.value,
                  style: { position: "relative", display: "flex", justifyContent: "center" },
                  onMouseenter: () => { hoverVal.value = it.value; },
                  onMouseleave: () => { if (hoverVal.value === it.value) hoverVal.value = null; },
                }, [
                  // icon button
                  h("button", {
                    "aria-label": typeof it.label === "string" ? it.label : undefined,
                    style: {
                      width: "40px", height: "40px", display: "inline-flex", alignItems: "center", justifyContent: "center",
                      border: "none", borderRadius: "var(--radius-sm)", position: "relative",
                      background: "var(--fp-sbnav-bg)",
                      color:      lit ? "var(--text-primary)" : "var(--text-secondary)",
                      cursor: "pointer", transition: "background var(--dur-fast) var(--ease-standard)",
                    },
                    class: "fp-sbnav-row",
                    "data-on": lit ? "" : undefined,
                    onClick: () => isDir
                      ? (flyout.value = flyout.value === it.value ? null : it.value)
                      : select(it.value),
                  }, [
                    // icon or first-letter fallback
                    it.icon
                      ? (typeof it.icon === "object" && it.icon.render ? h(it.icon) : it.icon)
                      : h("span", { style: { fontSize: "var(--fs-body)" } }, [String(it.label).slice(0, 1)]),
                    // active accent bar
                    on ? h("span", { style: { position: "absolute", left: "0", top: "9px", bottom: "9px", width: "3px", borderRadius: "3px", background: "var(--text-primary)" } }) : null,
                  ]),

                  // hover tooltip (hidden while flyout is open for this item)
                  hoverVal.value === it.value && !isFly
                    ? h("div", {
                        class: "fp-sbnav-tip",
                        style: {
                          position: "absolute", left: "calc(100% + 10px)", top: "50%", transform: "translateY(-50%)",
                          background: "var(--ink-900)", color: "#fff", borderRadius: "var(--radius-sm)", padding: "6px 10px",
                          fontFamily: "var(--font-sans)", fontSize: "var(--fs-label)", whiteSpace: "nowrap",
                          boxShadow: "var(--shadow-pop)", pointerEvents: "none", zIndex: "var(--z-popover)",
                          display: "flex", alignItems: "center", gap: "8px",
                        },
                      }, [
                        it.label,
                        it.shortcut
                          ? h("span", { style: { background: "rgba(255,255,255,0.16)", borderRadius: "4px", padding: "1px 6px", fontSize: "11px" } }, [it.shortcut])
                          : null,
                      ])
                    : null,

                  // directory flyout — one level, one open at a time
                  isDir && isFly
                    ? h("div", {
                        class: "fp-sbnav-flyout",
                        style: {
                          position: "absolute", left: "calc(100% + 10px)", top: "-4px", minWidth: "184px",
                          background: "var(--surface-white)", border: "1px solid var(--border-subtle)",
                          borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-pop)", padding: "6px",
                          display: "flex", flexDirection: "column", gap: "2px", zIndex: "var(--z-popover)",
                        },
                      }, [
                        h("div", { style: { font: "var(--type-label)", color: "var(--text-muted)", padding: "4px 10px" } }, [it.label]),
                        ...(it.children || []).map((c) => {
                          const con = c.value === activeValue.value;
                          return h("button", {
                            key: c.value,
                            class: "fp-sbnav-row",
                            "data-on": con ? "" : undefined,
                            style: { ...ROW_BASE, padding: "0 10px", height: "32px", color: con ? "var(--text-primary)" : "var(--text-secondary)", background: "var(--fp-sbnav-bg)" },
                            onClick: () => select(c.value),
                          }, [
                            c.icon ? h("span", { style: { display: "inline-flex", flex: "0 0 auto" } }, [typeof c.icon === "object" && c.icon.render ? h(c.icon) : c.icon]) : null,
                            h("span", { style: { flex: "1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, [c.label]),
                          ]);
                        }),
                      ])
                    : null,
                ]);
              })
            )
          )
        );
      }

      // ---- EXPANDED TREE --------------------------------------------------
      return h("nav", {
        style: { display: "flex", flexDirection: "column", gap: "16px" },
      },
        props.sections.map((sec, si) =>
          h("div", {
            key: si,
            style: { display: "flex", flexDirection: "column", gap: "2px" },
          }, [
            sec.title
              ? h("div", { style: { font: "var(--type-label)", color: "var(--text-muted)", padding: "6px 12px" } }, [sec.title])
              : null,
            ...renderTree(sec.items, 0),
          ])
        )
      );
    };
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

/* 折叠轨道的悬停提示:**延迟 400ms 才出现**。
   轨道上四个图标竖排,鼠标从顶滑到底会依次经过每一个 —— 没有延迟的话一次滑动
   就连闪四个黑色提示框,那不是提示是干扰。延迟意味着「停下来看」才出提示、
   「路过」不出;消失不延迟,鼠标一走立刻收。
   ⚠ 用 opacity:0 + forwards 而不是 both:fp-fade-in 只有 to 帧,
   both 会在延迟期间就把 opacity 应用成 1,提示框立刻可见,延迟等于白设。
   reduced-motion 下时长被压到 1ms 但 delay 不受影响 —— 这是对的,
   400ms 是交互设计(区分「停下看」与「路过」),不是动效。 */
.fp-sbnav-tip {
  opacity: 0;
  animation: fp-fade-in var(--dur-fast) var(--ease-out) 400ms forwards;
}

/* 目录浮出层:与下拉面板同规格(见 motion.css 的 fp-pop-in)。 */
.fp-sbnav-flyout { animation: fp-pop-in var(--dur-fast) var(--ease-out); }
</style>

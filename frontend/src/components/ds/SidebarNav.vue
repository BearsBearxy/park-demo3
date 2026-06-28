<script lang="ts">
/**
 * SidebarNav — 1:1 Vue 3 port of the Factory Park Design System SidebarNav.jsx
 *
 * Prop names / defaults / behaviour match the React source exactly.
 * v-model support added: modelValue mirrors `active`; emits "update:modelValue".
 */
import { defineComponent, h, ref, computed, Fragment } from "vue";

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

    function renderTree(items: SidebarItem[], depth: number): any[] {
      return items.map((it) => {
        const isDir  = !!(it.children && it.children.length);
        const isOpen = openSet.value.has(it.value);
        const on     = !isDir && it.value === activeValue.value;

        const rowStyle: Record<string, string> = {
          ...ROW_BASE,
          paddingLeft:  `${12 + depth * 16}px`,
          paddingRight: "12px",
          background:   on ? "var(--bg-hover)" : "transparent",
          color:        on ? "var(--text-primary)" : "var(--text-secondary)",
        };

        const btn = h("button", {
          style: rowStyle,
          onClick: () => isDir ? toggle(it.value) : select(it.value),
          onMouseenter: (e: MouseEvent) => {
            if (!on) (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)";
          },
          onMouseleave: (e: MouseEvent) => {
            if (!on) (e.currentTarget as HTMLElement).style.background = "transparent";
          },
        }, [
          // active accent bar
          on ? h("span", { style: { position: "absolute", left: "0", top: "8px", bottom: "8px", width: "3px", borderRadius: "3px", background: "var(--text-primary)" } }) : null,
          // chevron or spacer
          isDir ? Chevron(isOpen) : h("span", { style: { width: "14px", flex: "0 0 auto" } }),
          // icon
          it.icon ? renderIcon(it.icon, { color: on ? "var(--text-primary)" : "var(--text-secondary)" }) : null,
          // label
          h("span", { style: { flex: "1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, [it.label]),
          // trailing
          it.trailing ? h("span", {}, [it.trailing]) : null,
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
                      background: lit ? "var(--bg-hover)" : "transparent",
                      color:      lit ? "var(--text-primary)" : "var(--text-secondary)",
                      cursor: "pointer", transition: "background var(--dur-fast) var(--ease-standard)",
                    },
                    onClick: () => isDir
                      ? (flyout.value = flyout.value === it.value ? null : it.value)
                      : select(it.value),
                    onMouseenter: (e: MouseEvent) => { if (!lit) (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)"; },
                    onMouseleave: (e: MouseEvent) => { if (!lit) (e.currentTarget as HTMLElement).style.background = "transparent"; },
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
                        style: {
                          position: "absolute", left: "calc(100% + 10px)", top: "50%", transform: "translateY(-50%)",
                          background: "var(--ink-900)", color: "#fff", borderRadius: "var(--radius-sm)", padding: "6px 10px",
                          fontFamily: "var(--font-sans)", fontSize: "var(--fs-label)", whiteSpace: "nowrap",
                          boxShadow: "var(--shadow-pop)", pointerEvents: "none", zIndex: "40",
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
                        style: {
                          position: "absolute", left: "calc(100% + 10px)", top: "-4px", minWidth: "184px",
                          background: "var(--surface-white)", border: "1px solid var(--border-subtle)",
                          borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-pop)", padding: "6px",
                          display: "flex", flexDirection: "column", gap: "2px", zIndex: "40",
                        },
                      }, [
                        h("div", { style: { font: "var(--type-label)", color: "var(--text-muted)", padding: "4px 10px" } }, [it.label]),
                        ...(it.children || []).map((c) => {
                          const con = c.value === activeValue.value;
                          return h("button", {
                            key: c.value,
                            style: { ...ROW_BASE, padding: "0 10px", height: "32px", color: con ? "var(--text-primary)" : "var(--text-secondary)", background: con ? "var(--bg-hover)" : "transparent" },
                            onClick: () => select(c.value),
                            onMouseenter: (e: MouseEvent) => { if (!con) (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)"; },
                            onMouseleave: (e: MouseEvent) => { if (!con) (e.currentTarget as HTMLElement).style.background = "transparent"; },
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

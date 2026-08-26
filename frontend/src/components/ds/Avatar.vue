<script setup lang="ts">
import { computed } from "vue";

export interface AvatarProps {
  src?: string;
  name?: string;
  /** 账号名。配色取它的 hash —— 显示名会重名，账号名不会。 */
  uid?: string;
  size?: number;
  ring?: boolean;
}

const props = withDefaults(defineProps<AvatarProps>(), {
  name: "",
  size: 28,
  ring: false,
});

/**
 * 8 色，且**都是能配白字的深度**。
 *
 * 原色板里的 `--fill-cyan`(rgb 160,205,232) 配白字对比度约 1.9:1 —— 白字发虚。
 * 之前只在静态头像上用、看不太出来；在场头像组里它要和另外七个并排比，一眼就露。
 */
const PALETTE = [
  "var(--fill-blue)",
  "var(--fill-slate)",
  "var(--brand-deep)",
  "var(--brand-accent)",
  "rgb(93,150,140)",
  "rgb(163,124,178)",
  "rgb(196,124,92)",
  "rgb(90,132,178)",
];

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

/**
 * 配色取**账号名**的 hash，不取显示名首字。
 *
 * 原来是 `displayName.charCodeAt(0) % 6`：中文名下极易撞色（同姓必撞，且 6 色本就少），
 * 而在场头像组的**全部意义**就是「一眼分清是谁」。账号名唯一，逐字符 hash 散得开。
 * 回落到 name 是为了兼容没传 uid 的既有调用点（静态头像，撞不撞色无所谓）。
 */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const bg = computed(() =>
  PALETTE[hash(props.uid || props.name || "") % PALETTE.length]
);

const spanStyle = computed(() => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: `${props.size}px`,
  height: `${props.size}px`,
  flex: "0 0 auto",
  borderRadius: "50%",
  overflow: "hidden",
  background: props.src ? "var(--bg-sunken)" : bg.value,
  color: "#fff",
  fontFamily: "var(--font-sans)",
  fontSize: `${Math.max(9, Math.round(props.size * 0.38))}px`,
  fontWeight: "var(--fw-semibold)",
  boxShadow: props.ring ? "0 0 0 2px var(--surface-white)" : "none",
  userSelect: "none" as const,
}));
</script>

<template>
  <span :title="name" :style="spanStyle" v-bind="$attrs">
    <img
      v-if="src"
      :src="src"
      :alt="name"
      style="width: 100%; height: 100%; object-fit: cover"
    />
    <template v-else>{{ initials(name) }}</template>
  </span>
</template>

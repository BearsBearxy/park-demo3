<script setup lang="ts">
import { computed } from "vue";

export interface AvatarProps {
  src?: string;
  name?: string;
  /** 账号名。配色取它的 hash —— 显示名会重名，账号名不会。 */
  uid?: string;
  size?: number;
  ring?: boolean;
  /** 圆里写的字,给了就不再按名字取首字(人名头像写两个字,见 personNick)。 */
  text?: string;
}

const props = withDefaults(defineProps<AvatarProps>(), {
  name: "",
  size: 28,
  ring: false,
});

/**
 * 8 色身份色,白字对每一个都 ≥4.5(2026-09-19 DARK-MODE-SPEC §5 / M4,tokens.spec 断言)。
 *
 * 是身份色,两种外观一样 —— 所以写字面量不引令牌:原来引的 --brand-deep 暗色下变成浅灰蓝,
 * 白字只剩 1.6:1。原值多数只有 2.3–3.9:1,同色相压暗到 4.6 左右;偏紫的 rgb(163,124,178)
 * 换成绿(全站不用紫)。原 --fill-blue 压暗后和第 8 格几乎同色,色相挪向青蓝 225°。
 * 顺序不动:hash 落到第几格不变,每个人还是原来那个色相。
 */
const PALETTE = [
  "rgb(42, 126, 155)",   // 原 --fill-blue
  "rgb(97, 116, 151)",   // 原 --fill-slate
  "rgb(31, 95, 191)",    // 原 --brand-deep 的浅色值
  "rgb(79, 112, 205)",   // 原 --brand-accent
  "rgb(69, 126, 116)",
  "rgb(85, 127, 76)",    // 原偏紫 rgb(163,124,178)
  "rgb(168, 99, 67)",
  "rgb(78, 120, 165)",
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
  color: "var(--text-on-solid)",   // 身份色两种外观都是深色,字恒白
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
    <template v-else>{{ text ?? initials(name) }}</template>
  </span>
</template>

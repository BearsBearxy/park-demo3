<script setup lang="ts">
import { ref, computed, useId } from 'vue'

// ⚠ 透传属性必须落到 <input> 上,不能落在根 div。
//
// Vue 3 默认把未声明的属性挂到**根元素**——这里根元素是外层 <div>。于是调用方写的
// autocomplete / name / inputmode / maxlength 全都挂在了一个 div 上,对 <input> 毫无作用。
//
// 2026-08-22 因此出过一次安全事故:主管授权弹窗给密码框写了 autocomplete="new-password"
// 想挡掉浏览器自动填充,属性落在 div 上没生效,Chrome 照样把本机存的账号密码填进去 ——
// 「主管走过来亲手输密码」这个动作被架空,点一下确认就过了。
defineOptions({ inheritAttrs: false })

export type InputSize = 'sm' | 'md' | 'lg'

const props = withDefaults(defineProps<{
  modelValue?: string
  label?: string
  hint?: string
  error?: string
  size?: InputSize
  disabled?: boolean
  type?: string
  placeholder?: string
  id?: string
}>(), {
  size: 'md',
  disabled: false,
  type: 'text',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const focus = ref(false)
const inputId = props.id ?? useId()

const HEIGHT: Record<InputSize, number> = { sm: 32, md: 36, lg: 44 }

/**
 * 提示位要不要占地方。
 *
 * ⚠ **不是"永远占"**。首版让每个输入框都留一行,结果没有校验的表单凭空胖了一圈 ——
 * 主管授权弹窗里两个字段之间空出老大一块（用户 2026-08-23 指出:「这条提示留这么多位置干什么」）。
 *
 * 判据:调用方**有没有把 error / hint 接上**。
 *   没写            → props 是 undefined → 不占（这个框根本不会出提示）
 *   :error="err"    → 即使 err 是 ''，props 也是 ''（不是 undefined）→ 占一行
 * 这样「会出提示的字段」自动占位，「不会出的」一点不多占，调用方什么都不用记。
 */
const reserveMsg = computed(() => props.error !== undefined || props.hint !== undefined)

const borderColor = computed(() =>
  props.error ? 'var(--hue-red)' : focus.value ? 'var(--border-strong)' : 'var(--border-subtle)'
)

const wrapStyle = computed(() => ({
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  height: `${HEIGHT[props.size]}px`,
  padding: '0 12px',
  background: props.disabled ? 'var(--bg-sunken)' : 'var(--surface-white)',
  border: `1px solid ${borderColor.value}`,
  borderRadius: 'var(--radius-sm)',
  transition: 'border-color var(--dur-fast) var(--ease-standard)',
  opacity: props.disabled ? 0.6 : 1,
}))
</script>

<template>
  <div style="display:flex;flex-direction:column;gap:6px">
    <label
      v-if="label"
      :for="inputId"
      style="font:var(--type-label);color:var(--text-secondary);font-weight:var(--fw-medium)"
    >{{ label }}</label>

    <div :style="wrapStyle">
      <span v-if="$slots.leadingIcon" style="display:inline-flex;color:var(--text-muted)">
        <slot name="leadingIcon" />
      </span>
      <input
        :id="inputId"
        :type="type"
        :value="modelValue"
        :disabled="disabled"
        :placeholder="placeholder"
        v-bind="$attrs"
        style="flex:1;min-width:0;border:none;outline:none;background:transparent;font-family:var(--font-sans);font-size:var(--fs-body);color:var(--text-primary)"
        @focus="focus = true"
        @blur="focus = false"
        @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      />
      <span v-if="$slots.trailingIcon" style="display:inline-flex;color:var(--text-muted)">
        <slot name="trailingIcon" />
      </span>
    </div>

    <!-- ⚠ 接了 error/hint 的字段:这一行**常驻**(LAYOUT-STABILITY-SPEC §4.2)。
         写成 v-if 的话,校验失败时它凭空长出来,把下面的字段和按钮整体顶下去 ——
         用户正要点的「确认」按钮在他手指底下跑掉。
         没接的字段不渲染,免得整张表单平白胖一圈。 -->
    <span
      v-if="reserveMsg"
      class="ds-in-msg"
      :style="{ color: error ? 'var(--hue-red)' : 'var(--text-muted)' }"
    >{{ error || hint }}</span>
  </div>
</template>

<style scoped>
/* 常驻提示位:高度恰好一行,空着时不可见但占位。**不多留一分** —— 见 reserveMsg 注释 */
.ds-in-msg {
  display: block;
  min-height: 14px;
  font: var(--fw-regular) var(--fs-micro)/14px var(--font-sans);
}
</style>

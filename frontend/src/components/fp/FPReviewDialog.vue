<script setup lang="ts">
// 退回 / 撤销审核的理由弹卡(SIDEBAR-UX-REDESIGN §7.5;居中弹卡照 PAGE-BEHAVIOR-SPEC §2)。
//
// 两个动作共用一个组件:形状与约束逐字相同(理由必填、最长 255、确认后写 review_log),
// 只有标题与那句提示不一样。拆成两个组件的话,「必填」这条校验就有两份实现。
//
// ⚠ 理由**必填**是后端的硬约束(ReasonReq 上的 @NotBlank,空则 400)。前端这道不是装饰:
//   没有它,用户要点两下才知道得写理由,而第二下已经吃了一个 400 弹窗。
//   trim() 不能省 —— 全是空格能过 @NotBlank 吗?能不能不重要,屏上「写明理由」这四个字
//   要是被一串空格满足了,这条约束就等于没有。
import { ref, computed, watch } from 'vue'
import Button from '@/components/ds/Button.vue'

const props = defineProps<{
  /** 非空 = 打开。带着这一把键的人话名,如「2026-09 附表12」。 */
  target: string | null
  action: 'return' | 'withdraw'
  /** 提交在途(父层发请求时置真),防连点 */
  busy?: boolean
}>()
const emit = defineEmits<{ close: []; confirm: [reason: string] }>()

const reason = ref('')
// 每次打开清空 —— 留着上一次的理由,下一把键会被顺手提交上去
watch(() => props.target, () => { reason.value = '' })

const MAX = 255           // 后端 ReasonReq 的 @Size(max=255)
const trimmed = computed(() => reason.value.trim())
const ok = computed(() => trimmed.value.length > 0 && trimmed.value.length <= MAX)

const title = computed(() => (props.action === 'return' ? '退回' : '撤销审核'))
const hint = computed(() => props.action === 'return'
  ? '退回给录入方重做。理由会写进操作日志,录入方看得到。'
  : '撤销之后这张表恢复可编辑。理由会写进操作日志。')

function onConfirm() {
  if (!ok.value || props.busy) return
  emit('confirm', trimmed.value)
}
</script>

<template>
  <Teleport to="body">
    <!-- 点空白处关闭:这是一个可以放弃的动作(与 FPEvictedDialog 那种「唯一一次提示」不同)。 -->
    <div v-if="target" class="rvd-scrim" role="dialog" aria-modal="true" @mousedown.self="emit('close')">
      <div class="rvd-card">
        <div class="rvd-head">
          <h3 class="rvd-title">{{ title }} · {{ target }}</h3>
          <p class="rvd-hint">{{ hint }}</p>
        </div>
        <div class="rvd-body">
          <label class="rvd-label" for="rvd-reason">理由（必填）</label>
          <textarea id="rvd-reason" v-model="reason" class="rvd-input" rows="3"
                    :maxlength="MAX" placeholder="写清楚哪里要改，录入方照着改就行" />
          <!-- 计数常驻(不是超了才出),否则字数一超版面会跳一下 -->
          <div class="rvd-count" :data-over="trimmed.length > MAX">{{ trimmed.length }} / {{ MAX }}</div>
        </div>
        <div class="rvd-foot">
          <Button variant="outline" size="sm" @click="emit('close')">取消</Button>
          <Button variant="filled" size="sm" :disabled="!ok || busy" @click="onConfirm">
            {{ busy ? '提交中…' : `确认${title}` }}
          </Button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.rvd-scrim { position: fixed; inset: 0; z-index: var(--z-confirm); background: rgba(28, 28, 28, .34);
             display: grid; place-items: center; }
.rvd-card { width: min(432px, 92vw); background: var(--surface-white); border-radius: var(--radius-xl);
            box-shadow: 0 18px 52px rgba(28, 28, 28, .24); overflow: hidden; font-family: var(--font-sans); }
.rvd-head { padding: 20px 20px 0; }
.rvd-title { margin: 0; font-size: var(--fs-h3); font-weight: var(--fw-semibold); color: var(--text-primary); }
.rvd-hint { margin: 6px 0 0; font-size: var(--fs-label); color: var(--text-secondary); line-height: 1.5; }
.rvd-body { padding: 16px 20px 0; }
.rvd-label { display: block; font-size: var(--fs-label); color: var(--text-secondary); margin-bottom: 6px; }
.rvd-input {
  width: 100%; box-sizing: border-box; resize: vertical;
  padding: 8px 10px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md);
  font: inherit; font-size: var(--fs-body); color: var(--text-primary); background: var(--surface-white);
}
.rvd-input:focus { outline: none; border-color: var(--hue-blue); }
/* 常驻定高,超限只换色不换版面(LAYOUT-STABILITY) */
.rvd-count { height: 16px; margin-top: 4px; text-align: right;
             font-family: var(--font-mono); font-size: var(--fs-micro); color: var(--text-disabled); }
.rvd-count[data-over="true"] { color: var(--hue-red); }
.rvd-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 20px 20px; }
</style>

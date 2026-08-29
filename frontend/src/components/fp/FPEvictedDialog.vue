<script setup lang="ts">
// 「你的编辑权已被接管」—— 当面提示（CONCURRENCY-SPEC §4.3）。
//
// **必须是当面提示，不是等他保存时才 403。** 心跳是现成的通道，最迟 20 秒到。
//
// 三条不许破：
//   · 弹窗**不自动关**，也不给点外面关 —— 他必须知道发生了什么
//   · 页面数据**不刷新**（铁律：永远不刷新用户正在编辑的表格）
//   · 先给复制的路，再让他走 —— 系统不替他保存，但不能让他白干
//
// 形态照抄 import/SaveConfirmDialog.vue（同款居中卡片 + scrim），那边已经是「有 N 处改动」
// 这类对话的既有样板。
import { computed, ref } from 'vue'
import type { Eviction } from '@/api/locks'
import Button from '@/components/ds/Button.vue'
import { iconFor } from '@/components/ds/icon'

const props = defineProps<{
  /** 非空即打开。来自 useEditMode 的 evictedBy */
  eviction: Eviction | null
  /** 这一期给人看的名字，如「一泽 2025-06 月度台账」 */
  what: string
  /** 未保存的改动处数 */
  dirtyCount?: number
  /**
   * 把未保存的改动序列化成可粘贴的文本。**不给就不显示复制块** ——
   * 给一个数字却不给出路，等于告诉他「你丢了 14 处改动」然后关门。
   */
  copyText?: () => string
}>()
const emit = defineEmits<{ close: [] }>()

const open = computed(() => !!props.eviction)
const dirty = computed(() => props.dirtyCount ?? 0)
const canCopy = computed(() => dirty.value > 0 && !!props.copyText)
const copied = ref(false)

async function copy() {
  try {
    await navigator.clipboard.writeText(props.copyText!())
    copied.value = true
  } catch {
    copied.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <!-- ⚠ scrim 上**不挂** @mousedown 关闭：点空白处误关会让他错过唯一一次提示。
         只有「知道了」能关。 -->
    <div v-if="open" class="evd-scrim" role="alertdialog" aria-modal="true">
      <div class="evd-card">
        <div class="evd-h">
          <span class="evd-ic"><component :is="iconFor('alert-triangle')" :size="16" /></span>
          <h3>{{ eviction?.byDisplayName ? '你的编辑权已被接管' : '你的编辑态已失效' }}</h3>
        </div>
        <div class="evd-b">
          <p v-if="eviction?.byDisplayName" class="evd-lead">
            <b>{{ eviction.byDisplayName }}</b> 接管了「{{ what }}」的编辑权<template
              v-if="eviction.authorizerName">，由 <b>{{ eviction.authorizerName }}</b> 授权</template>。
            你已退回浏览态，从现在起这一期由他负责。
          </p>
          <!-- 失锁兜底(by 为空):锁在别的页签被还掉、或服务端重启过 —— 没有接管者,但同样不能让他
               对着假编辑态继续录。措辞不猜原因,只说事实与出路。 -->
          <p v-else class="evd-lead">
            你在「{{ what }}」的编辑锁已失效（可能在别的页签退出过，或服务端重启过），已退回浏览态。
            <!-- ⚠ 不写「即可继续」:没接 copyText 的屏(账册模板/附表页头/系数簿)重进时草稿被
                 整份重新快照 —— 那句指引等于把人引向静默丢草稿。说实话:改动需要重录。 -->
            <template v-if="!canCopy">若刚才有未保存的修改，重进编辑模式后需要<b>重新录入</b> —— 屏幕上现在是服务端的数据。</template>
          </p>

          <div v-if="canCopy" class="evd-draft">
            <span class="evd-cnt">{{ dirty }}</span>
            <div class="evd-dtxt">
              <div class="evd-dt">处未保存的修改</div>
              <div class="evd-dsub">复制成表格，粘进 Excel{{ eviction?.byDisplayName ? ` 或直接发给 ${eviction.byDisplayName}` : '，重进编辑后照着补回' }}</div>
            </div>
            <Button variant="outline" size="sm" @click="copy">{{ copied ? '已复制' : '复制我的改动' }}</Button>
          </div>

          <!-- ⚠ 措辞必须与实情一致。退出编辑态后表格渲染的是服务端数据，
               草稿**不在屏幕上**了 —— 原文案「你改的还在屏幕上」是假的。
               真实情况是：草稿还在内存里、可以复制走，而且页面数据没被刷新覆盖。 -->
          <p class="evd-note">
            <template v-if="canCopy">你未保存的改动<b>还留着</b>，复制走之后再关掉这个提示。</template>
            <template v-else>页面数据<b>没有被刷新</b>，屏幕上显示的仍是你进来时看到的那一版。</template>
          </p>
        </div>
        <div class="evd-f">
          <Button variant="filled" @click="emit('close')">知道了</Button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* z 用 --z-confirm：这条消息必须盖住一切弹窗与抽屉(他可能正开着导入窗) */
.evd-scrim { position: fixed; inset: 0; z-index: var(--z-confirm); background: rgba(28, 28, 28, .34);
             display: grid; place-items: center; }
.evd-card { width: min(432px, 92vw); background: var(--surface-white); border-radius: var(--radius-xl);
            box-shadow: 0 18px 52px rgba(28, 28, 28, .24); overflow: hidden; font-family: var(--font-sans); }
.evd-h { display: flex; align-items: center; gap: 9px; padding: 20px 22px 0; }
.evd-h h3 { margin: 0; font-size: var(--fs-h3); font-weight: var(--fw-semibold); color: var(--text-primary); }
.evd-ic { width: 30px; height: 30px; flex: 0 0 auto; border-radius: 50%; display: grid; place-items: center;
          background: rgb(255, 238, 237); color: var(--hue-red); }
.evd-b { padding: 14px 22px 4px; display: flex; flex-direction: column; gap: 12px; }
.evd-lead { margin: 0; font-size: 13.5px; line-height: 1.65; color: var(--text-primary); }
.evd-lead b { font-weight: var(--fw-semibold); }
.evd-draft { display: flex; align-items: center; gap: 11px; padding: 11px 13px;
             border: 1px solid var(--border-subtle); border-radius: 10px; background: var(--surface-card); }
.evd-cnt { font-family: var(--font-mono); font-size: 19px; font-weight: var(--fw-semibold);
           color: var(--hue-orange); font-variant-numeric: tabular-nums; }
.evd-dtxt { flex: 1; min-width: 0; }
.evd-dt { font-size: 13px; font-weight: var(--fw-medium); }
.evd-dsub { font-size: var(--fs-micro); color: var(--text-muted); margin-top: 1px; }
.evd-note { margin: 0; font-size: var(--fs-micro); line-height: 1.6; color: var(--text-muted); }
.evd-note b { font-weight: var(--fw-semibold); color: var(--text-primary); }
.evd-f { display: flex; justify-content: flex-end; padding: 16px 22px 20px; }
</style>

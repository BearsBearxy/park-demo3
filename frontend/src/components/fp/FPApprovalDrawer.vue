<script setup lang="ts">
// 批准端：等我批的授权请求（设计稿 §07 F-4）。
//
// ⚠ **中间那三行上下文是这一屏的全部意义。**
//   当场授权时主管看得见请求者的屏幕；远程批准看不见，所以「哪一屏 · 改什么 · 影响多少户」
//   必须写在请求里 —— 否则这个功能会退化成看见弹窗就点同意（MFA 疲劳攻击打的正是这一点）。
//
// 密码框在这里是**你在自己的电脑上输自己的密码** —— 那正是这条路径比当场授权更安全的地方，
// 也防「主管电脑没锁屏，路过的人替他点了同意」。
import { ref, computed, watch } from 'vue'
import { usePresenceStore } from '@/stores/presence'
import { approvalsApi, type Pending } from '@/api/approvals'
import Avatar from '@/components/ds/Avatar.vue'
import Button from '@/components/ds/Button.vue'
import Input from '@/components/ds/Input.vue'
import FPSideDrawer from '@/components/fp/FPSideDrawer.vue'
import { iconFor } from '@/components/ds/icon'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const presence = usePresenceStore()
const pending = computed(() => presence.approvals)

/** 每条请求各自的密码框 —— 两条请求同时进来时，不能共用一个输入。 */
const pw = ref<Record<string, string>>({})
const err = ref<Record<string, string>>({})
const busy = ref<string | null>(null)

// 反自动填充：与 FPElevateDialog / FPTakeoverDrawer 同一套。
// 这里输的是主管自己的密码，浏览器更想帮他填 —— 三道都得在。
const maskOk = typeof CSS !== 'undefined' && typeof CSS.supports === 'function'
  && CSS.supports('-webkit-text-security', 'disc')
const pwdType = maskOk ? 'text' : 'password'
const ro = ref<Record<string, boolean>>({})

watch(() => props.open, (o) => { if (!o) { pw.value = {}; err.value = {}; ro.value = {} } })
watch(pending, (list) => { for (const p of list) if (ro.value[p.id] === undefined) ro.value[p.id] = true })

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

async function decide(p: Pending, approve: boolean) {
  if (busy.value) return
  if (approve && !pw.value[p.id]) return
  busy.value = p.id
  err.value[p.id] = ''
  try {
    await approvalsApi.decide(p.id, approve, approve ? pw.value[p.id] : undefined)
    pw.value[p.id] = ''
    // 名单由下一拍 ping 刷新（最迟 20 秒）；先本地摘掉，别让他对着一条已处理的再点一次
    presence.approvals = presence.approvals.filter((x) => x.id !== p.id)
  } catch (e) {
    err.value[p.id] = (e as { message?: string })?.message ?? '处理失败，请重试'
    pw.value[p.id] = ''
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <FPSideDrawer :open="open" :title="`待批授权 ${pending.length}`" :width="440" @close="emit('close')">
    <div class="ap-body">
      <p v-if="!pending.length" class="ap-empty">
        现在没有等你批的请求。<br>
        同事在自己的屏幕上点「远程请求授权」并指名你之后，这里会出现一条，<b>2 分钟内有效</b>。
      </p>

      <div v-for="p in pending" :key="p.id" class="ap-card">
        <div class="ap-h">
          <Avatar :uid="p.requester" :name="p.requesterName" :size="32" />
          <div class="ap-nm">
            <div class="ap-n1">
              {{ p.requesterName }}
              <span v-if="p.requesterRole" class="ap-role">{{ p.requesterRole }}</span>
            </div>
            <div class="ap-n2">
              请求授权
              <span v-for="l in p.permLabels" :key="l" class="ap-perm">{{ l }}</span>
            </div>
          </div>
          <span class="ap-left">{{ mmss(p.leftMs) }}</span>
        </div>

        <!-- ⭐ 这三行就是这一屏存在的理由 —— 没有它，批准是闭着眼睛点的 -->
        <div class="ap-ctx">
          <div class="ap-r"><span class="k">页面</span><span class="v">{{ p.page }}</span></div>
          <div class="ap-r"><span class="k">要改</span><span class="v mono">{{ p.action }}</span></div>
          <div v-if="p.impact" class="ap-r"><span class="k">影响</span><span class="v">{{ p.impact }}</span></div>
        </div>

        <div class="ap-f">
          <div :class="['ap-pw', { 'ap-mask': maskOk }]">
            <Input v-model="pw[p.id]" :type="pwdType" placeholder="你的密码"
                   :name="`fp-approve-${p.id}`" autocomplete="off" :readonly="ro[p.id] !== false"
                   @focus="ro[p.id] = false" @keyup.enter="decide(p, true)" />
          </div>
          <Button variant="gray" size="sm" :disabled="busy === p.id" @click="decide(p, false)">拒绝</Button>
          <Button variant="filled" size="sm" :disabled="busy === p.id || !pw[p.id]" @click="decide(p, true)">
            {{ busy === p.id ? '处理中…' : '批准' }}
          </Button>
        </div>

        <!-- 错误位常驻(LAYOUT-STABILITY §7)：写成 v-if 的话输错时这行凭空长出来，把按钮顶走 -->
        <p class="ap-err">
          <template v-if="err[p.id]">
            <component :is="iconFor('alert-triangle')" :size="13" />{{ err[p.id] }}
          </template>
        </p>

        <p class="ap-note">
          批准 = 给 {{ p.requesterName }} <b>30 分钟</b>这几项权限。这段时间里他的每一次修改，
          日志都会同时记下<b>他和你</b>两个名字。
        </p>
      </div>
    </div>
  </FPSideDrawer>
</template>

<style scoped>
.ap-body { display: flex; flex-direction: column; gap: 14px; }
.ap-empty { margin: 0; font-size: 13px; line-height: 1.7; color: var(--text-muted); }
.ap-empty b { color: var(--text-primary); font-weight: var(--fw-semibold); }
.ap-card { border: 1px solid var(--border-subtle); border-radius: 12px; background: var(--surface-white);
           padding: 12px 13px 10px; }
.ap-h { display: flex; align-items: center; gap: 10px; }
.ap-nm { flex: 1; min-width: 0; }
.ap-n1 { display: flex; align-items: center; gap: 6px; font-size: 13.5px; font-weight: var(--fw-semibold); }
.ap-n2 { display: flex; align-items: center; gap: 5px; flex-wrap: wrap;
         font-size: var(--fs-micro); color: var(--text-muted); margin-top: 2px; }
.ap-role { font-size: 10px; color: var(--text-muted); border: 1px solid var(--border-subtle);
           border-radius: var(--radius-full); padding: 0 6px; line-height: 15px; font-weight: var(--fw-regular); }
.ap-perm { font-size: 10.5px; padding: 1px 8px; border-radius: var(--radius-full);
           background: rgb(255, 243, 230); color: var(--hue-orange); font-weight: var(--fw-semibold); }
.ap-left { flex: 0 0 auto; font-family: var(--font-mono); font-size: 11.5px;
           font-weight: var(--fw-semibold); color: var(--hue-red); font-variant-numeric: tabular-nums; }
.ap-ctx { margin-top: 10px; border: 1px solid var(--border-subtle); border-radius: 8px; overflow: hidden; }
.ap-r { display: grid; grid-template-columns: 44px 1fr; gap: 10px; padding: 6px 10px; font-size: 12px; }
.ap-r + .ap-r { border-top: 1px solid rgba(28, 28, 28, .06); }
.ap-r .k { color: var(--text-muted); font-size: var(--fs-micro); }
.ap-r .v { font-weight: var(--fw-medium); word-break: break-all; }
.ap-r .v.mono { font-family: var(--font-mono); font-size: 11.5px; }
.ap-f { display: flex; align-items: center; gap: 8px; margin-top: 11px; }
.ap-pw { flex: 1; min-width: 0; }
.ap-mask :deep(input) { -webkit-text-security: disc; text-security: disc; }
.ap-err { margin: 6px 0 0; min-height: 17px; display: flex; align-items: center; gap: 5px;
          font-size: var(--fs-micro); line-height: 17px; color: var(--status-danger); }
.ap-note { margin: 4px 0 0; font-size: var(--fs-micro); line-height: 1.6; color: var(--text-muted); }
.ap-note b { color: var(--text-primary); font-weight: var(--fw-semibold); }
</style>

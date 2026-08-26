<script setup lang="ts">
// 接管本期的编辑锁（CONCURRENCY-SPEC §4.3）。两条路径**按持有人状态自动分流** ——
// 用户不需要知道自己走的是哪条，界面替他判断：
//
//   持有人空闲 ≥20 分钟 → 直接接管，不需要主管，绝大多数真实场景走这条
//   持有人活跃中        → 财务主管及以上当场输账号密码
//
// ⚠ 锁转给**请求者**，不是转给授权人。主管授权的是「这件事可以发生」，不是「我来接手」。
//   初版转给主管，结果请求者还是进不去，除非主管接管后立刻退出、他抢在别人前点进去 ——
//   荒唐的竞态，SPEC 里已经把它记成教训。
import { ref, computed, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { locksApi, type LockHolder } from '@/api/locks'
import Button from '@/components/ds/Button.vue'
import Input from '@/components/ds/Input.vue'
import FPDrawer from '@/components/fp/FPDrawer.vue'
import { iconFor } from '@/components/ds/icon'

const props = defineProps<{
  /** 非空即打开。来自 useEditMode 的 lockedBy */
  holder: LockHolder | null
  /** 要接管哪一期的锁 */
  scope: string
  /** 给人看的一句话，如「一泽 2025-06 月度台账」 */
  what: string
}>()
const emit = defineEmits<{ close: []; taken: [] }>()

const auth = useAuthStore()
const open = computed(() => !!props.holder)
const account = ref('')
const password = ref('')
const err = ref('')
const busy = ref(false)

// 空闲 = 免授权那条路。判定在服务端算好（客户端的钟不可信，也不该各算各的）
const idle = computed(() => !!props.holder?.idle)

const heldText = computed(() => fmt(props.holder?.heldMs ?? 0))
const idleText = computed(() => fmtLoose(props.holder?.idleMs ?? 0))

/** mm:ss —— 「已持有 12:41」要的是时长，不是时刻 */
function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
/** 人话的粗粒度：「2 分钟前」比「02:07 前」好读 */
function fmtLoose(ms: number): string {
  const m = Math.floor(ms / 60000)
  return m < 1 ? '刚刚' : `${m} 分钟前`
}

// ── 反浏览器自动填充：与 FPElevateDialog 同一套三道防线 ──
// 这个窗的全部意义是「主管本人走过来亲手输一次」。浏览器把密码填好，这个动作就被架空了。
//   ① autocomplete="off" + 字段名不用 username/password（Chrome 的启发式认名字）
//   ② readonly 直到聚焦 —— 自动填充跳过 readonly 字段
//   ③ 不用 type="password"，改 text + CSS 遮罩 —— 只要页面上有密码框，Chrome 的密码管理器
//      就无条件弹候选列表，前两道都拦不住它。不支持遮罩的浏览器退回 password：
//      宁可被自动填充，不可明文。
const acctRO = ref(true)
const pwdRO = ref(true)
const maskOk = typeof CSS !== 'undefined' && typeof CSS.supports === 'function'
  && CSS.supports('-webkit-text-security', 'disc')
const pwdType = maskOk ? 'text' : 'password'

watch(open, (o) => {
  if (!o) return
  account.value = ''; password.value = ''; err.value = ''
  acctRO.value = true; pwdRO.value = true
})

async function submit() {
  if (busy.value) return
  if (!idle.value && (!account.value.trim() || !password.value)) return
  busy.value = true
  err.value = ''
  try {
    await locksApi.takeover(props.scope,
      idle.value ? undefined : account.value.trim(),
      idle.value ? undefined : password.value)
    password.value = ''
    emit('taken')
  } catch (e) {
    err.value = (e as { message?: string })?.message ?? '接管失败，请重试'
    password.value = ''
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <FPDrawer :open="open" title="本期正被他人编辑" icon="lock" :width="452" @close="emit('close')">
    <div class="tk-body">
      <div class="tk-who">
        <span class="tk-av" :class="{ dim: idle }">{{ (holder?.displayName ?? '?').slice(0, 1) }}</span>
        <div>
          <div class="tk-nm">{{ holder?.displayName }}</div>
          <div class="tk-sc">已持有 {{ heldText }} · 最后操作 {{ idleText }}</div>
        </div>
      </div>

      <!-- 空闲：免授权 -->
      <template v-if="idle">
        <p class="tk-lead">
          他的页面还开着，但<b>已经 {{ idleText.replace('前', '') }}没有任何操作</b>。
          你可以直接接管，<b>不需要主管授权</b>。
        </p>
        <div class="tk-warn">
          <p class="tk-note strong">
            {{ holder?.displayName }} 会在 20 秒内收到当面提示，并被退回浏览态。
            <b>他未保存的内容需要他自己复制走</b> —— 系统不会替他保存。
          </p>
        </div>
        <p class="tk-note">这一下会写进操作日志：接管人 {{ auth.displayName || auth.me }} · 无授权人 · 理由「持有人空闲」。</p>
      </template>

      <!-- 活跃：须主管当场授权 -->
      <template v-else>
        <p class="tk-lead">
          他<b>正在操作</b>，直接接管会打断他。接管「{{ what }}」需要<b>财务主管及以上</b>在这台电脑上当场授权。
        </p>
        <Input v-model="account" label="授权人账号" placeholder="主管 / 管理员的登录账号"
               name="fp-lock-grantor" autocomplete="off" :readonly="acctRO"
               @focus="acctRO = false" @keyup.enter="submit" />
        <!-- ⚠ 包一层才够得着 Input 内部那个 <input>：父组件的 scoped 选择器只作用到子组件根元素 -->
        <div :class="{ 'tk-mask': maskOk }">
          <Input v-model="password" label="授权人密码" :type="pwdType" placeholder="请授权人本人输入"
                 name="fp-lock-secret" autocomplete="off" :readonly="pwdRO"
                 @focus="pwdRO = false" @keyup.enter="submit" />
        </div>
        <p class="tk-note">
          锁会转给<b>你（{{ auth.displayName || auth.me }}）</b>，不是转给授权人。
          操作日志会同时记下接管人和授权人两个名字。
        </p>
      </template>

      <!-- ⚠ 错误位常驻（LAYOUT-STABILITY §7）：写成 v-if 的话输错时这行凭空长出来，
           把「确认接管」按钮从用户指头底下顶走。 -->
      <p class="tk-err">
        <template v-if="err">
          <component :is="iconFor('alert-triangle')" :size="14" />{{ err }}
        </template>
      </p>
    </div>
    <template #footer>
      <Button variant="gray" size="sm" @click="emit('close')">只看不改</Button>
      <Button variant="filled" size="sm"
              :disabled="busy || (!idle && (!account.trim() || !password))" @click="submit">
        {{ busy ? '接管中…' : '确认接管' }}
      </Button>
    </template>
  </FPDrawer>
</template>

<style scoped>
.tk-body { display: flex; flex-direction: column; gap: 14px; }
.tk-who { display: flex; gap: 12px; align-items: center; padding: 12px;
          border: 1px solid var(--border-subtle); border-radius: 10px; background: var(--surface-card); }
.tk-av { width: 40px; height: 40px; flex: 0 0 auto; border-radius: 50%; display: grid; place-items: center;
         background: var(--fill-blue); color: #fff; font-weight: var(--fw-semibold); font-size: 16px;
         box-shadow: 0 0 0 2px var(--surface-white), 0 0 0 3.5px var(--hue-orange); }
.tk-av.dim { opacity: .55; box-shadow: 0 0 0 2px var(--surface-white), 0 0 0 3.5px var(--text-disabled); }
.tk-nm { font-size: 14.5px; font-weight: var(--fw-semibold); }
.tk-sc { font-size: 11.5px; color: var(--text-muted); font-family: var(--font-mono);
         font-variant-numeric: tabular-nums; margin-top: 2px; }
.tk-lead { margin: 0; font-size: 13.5px; line-height: 1.65; color: var(--text-primary); }
.tk-warn { border: 1px solid var(--border-subtle); border-left: 3px solid var(--hue-orange);
           border-radius: 10px; padding: 11px 13px; background: var(--surface-card); }
.tk-note { margin: 0; font-size: 11.5px; line-height: 1.6; color: var(--text-muted); }
.tk-note.strong { color: var(--text-primary); }
.tk-note b, .tk-lead b { font-weight: var(--fw-semibold); color: var(--text-primary); }
.tk-mask :deep(input) { -webkit-text-security: disc; text-security: disc; }
.tk-err { margin: 0; min-height: 18px; display: flex; align-items: center; gap: 6px;
          font-size: var(--fs-label); line-height: 18px; color: var(--status-danger); }
</style>

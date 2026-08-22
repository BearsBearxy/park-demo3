<script setup lang="ts">
// 主管当场授权（ELEVATION-SPEC）。
//
// 场景是**主管走到专员的座位上**，在专员已登录的界面里输自己的账号密码。所以：
//  · 不切换会话 —— 做事的仍然是专员，审计记 actor=专员 / authorizer=主管
//  · 密码框永远空着进来，成功后立刻清掉，不给浏览器记
//  · 文案要说清「你在替谁背书」，主管才知道自己按下去意味着什么
import { ref, computed, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import Button from '@/components/ds/Button.vue'
import Input from '@/components/ds/Input.vue'
import FPDrawer from '@/components/fp/FPDrawer.vue'
import { iconFor } from '@/components/ds/icon'
import { permLabel, loadPermDict } from '@/api/perms'

const props = defineProps<{
  /** 要补齐的权限点；非空即打开 */
  perms: string[] | null
  /** 这次操作是什么，给主管看的一句话，如「修改计费口径」 */
  what?: string
}>()
const emit = defineEmits<{ close: []; elevated: [] }>()

const auth = useAuthStore()
const open = computed(() => !!props.perms?.length)
const account = ref('')
const password = ref('')
const err = ref('')
const busy = ref(false)

const permNames = computed(() => (props.perms ?? []).map(permLabel))

// 每次打开都重置：上一次残留的账号/密码/报错留在框里，主管会以为自己已经输过了
watch(open, (o) => { if (o) { account.value = ''; password.value = ''; err.value = ''; void loadPermDict() } })

async function submit() {
  if (!account.value.trim() || !password.value || busy.value) return
  busy.value = true
  err.value = ''
  try {
    await auth.requestElevation(props.perms ?? [], account.value.trim(), password.value)
    password.value = ''
    emit('elevated')
  } catch (e) {
    err.value = (e as { message?: string })?.message ?? '授权失败，请重试'
    password.value = ''      // 失败后清空：下一次是重新输，不是在错的基础上改
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <FPDrawer :open="open" title="需要主管授权" icon="shield-check" :width="480" @close="emit('close')">
    <div class="ev-body">
      <p class="ev-lead">
        当前账号（{{ auth.displayName || auth.me }}）没有<template v-if="what">{{ what }}</template>的权限。
        请有权限的同事在这台电脑上输入自己的账号密码 —— 授权 <b>30 分钟</b>，期间的每一次修改都会同时记下两个人的名字。
      </p>

      <div class="ev-perms">
        <div class="ev-permstitle">本次要授权的权限</div>
        <div class="ev-permlist">
          <span v-for="n in permNames" :key="n" class="ev-permchip">{{ n }}</span>
        </div>
      </div>

      <Input v-model="account" label="授权人账号" placeholder="主管 / 管理员的登录账号" autocomplete="off"
             @keyup.enter="submit" />
      <Input v-model="password" label="授权人密码" type="password" placeholder="请授权人本人输入" autocomplete="new-password"
             @keyup.enter="submit" />

      <p v-if="err" class="ev-err">
        <component :is="iconFor('alert-triangle')" :size="14" />
        {{ err }}
      </p>

      <p class="ev-note">
        授权是给<b>这台电脑上的这个账号</b>的，不是替他登录。做事的人仍然是
        {{ auth.displayName || auth.me }}，操作日志里会写明由谁授权。
      </p>
    </div>
    <template #footer>
      <Button variant="outline" size="sm" @click="emit('close')">取消</Button>
      <Button variant="filled" size="sm" :disabled="!account.trim() || !password || busy" @click="submit">
        {{ busy ? '验证中…' : '确认授权' }}
      </Button>
    </template>
  </FPDrawer>
</template>

<style scoped>
.ev-body { display: flex; flex-direction: column; gap: 14px; }
.ev-lead { margin: 0; font-size: var(--fs-body); line-height: 1.65; color: var(--text-primary); }
.ev-perms { border: 1px solid var(--border-subtle); border-radius: 8px; padding: 10px 12px; background: var(--surface-subtle); }
.ev-permstitle { font-size: var(--fs-micro); color: var(--text-muted); margin-bottom: 6px; }
.ev-permlist { display: flex; flex-wrap: wrap; gap: 6px; }
.ev-permchip {
  font-size: var(--fs-label); padding: 2px 9px; border-radius: 999px;
  background: var(--surface-white); border: 1px solid var(--border-strong); color: var(--text-primary);
}
.ev-err {
  margin: 0; display: flex; align-items: center; gap: 6px;
  font-size: var(--fs-label); color: var(--status-danger);
}
.ev-note { margin: 0; font-size: var(--fs-micro); line-height: 1.6; color: var(--text-muted); }
</style>

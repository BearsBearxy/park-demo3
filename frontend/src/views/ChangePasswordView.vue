<script setup lang="ts">
// 修改密码(RBAC-SPEC 拍板 #3:管理员设初始密码 + 首次登录强制改密)。
// 独立页,不进导航、不进外壳 —— 强制态下侧边栏点哪儿都会被守卫弹回来,给了反而像页面坏了。
// 「退出登录」是必须留的逃生口:忘了当前密码的人否则会被自己锁死在这一屏。
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { Lock, AlertCircle } from 'lucide-vue-next'
import api from '@/api'
import { useAuthStore } from '@/stores/auth'
import { landingPath } from '@/nav/navAccess'

const router = useRouter()
const auth = useAuthStore()

const current = ref('')
const next = ref('')
const confirm = ref('')
const errorMsg = ref('')
const loading = ref(false)

const forced = computed(() => auth.mustChangePassword)

// 提交前的本地校验;后端仍会自己校一遍(当前密码对不对只有它知道)
function validate(): string {
  if (!current.value) return '请输入当前密码'
  if (next.value.length < 8) return '新密码至少 8 位'
  if (next.value === current.value) return '新密码不能与当前密码相同'
  if (confirm.value !== next.value) return '两次输入的新密码不一致'
  return ''
}

async function submit() {
  const bad = validate()
  if (bad) { errorMsg.value = bad; return }
  errorMsg.value = ''
  loading.value = true
  try {
    await api.post('/auth/change-password', { currentPassword: current.value, newPassword: next.value })
    auth.clearMustChangePassword()
    router.replace(landingPath(auth.navLayers, auth.can('system:view')))
  } catch (e: any) {
    errorMsg.value = e?.message || e?.msg || '修改失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

function onLogout() {
  auth.logout()
  router.replace('/login')
}
</script>

<template>
  <div class="cp-root">
    <form class="cp-card" @submit.prevent="submit">
      <div class="cp-badge"><Lock :size="20" /></div>
      <h1 class="cp-title">{{ forced ? '请先修改初始密码' : '修改密码' }}</h1>
      <p class="cp-sub">
        {{ forced ? '这是管理员分配的初始密码，改掉之后才能进入系统。' : '修改后当前登录状态保持不变。' }}
      </p>

      <label class="cp-field">
        <span class="cp-lbl">当前密码</span>
        <input v-model="current" type="password" autocomplete="current-password" :disabled="loading">
      </label>
      <label class="cp-field">
        <span class="cp-lbl">新密码</span>
        <input v-model="next" type="password" autocomplete="new-password" :disabled="loading" placeholder="至少 8 位">
      </label>
      <label class="cp-field">
        <span class="cp-lbl">确认新密码</span>
        <input v-model="confirm" type="password" autocomplete="new-password" :disabled="loading">
      </label>

      <!-- 提示位常驻(LAYOUT-STABILITY-SPEC §4.2):红字冒出来不许把「确认修改」顶走 -->
      <p class="cp-err"><template v-if="errorMsg"><AlertCircle :size="14" />{{ errorMsg }}</template></p>

      <button type="submit" class="cp-submit" :disabled="loading">{{ loading ? '提交中…' : '确认修改' }}</button>
      <button type="button" class="cp-logout" @click="onLogout">退出登录</button>
    </form>
  </div>
</template>

<style scoped>
.cp-root {
  height: 100dvh;
  overflow-y: auto;
  display: grid;
  place-items: center;
  padding: 24px;
  box-sizing: border-box;
  background: var(--surface-sunken);
}
.cp-card {
  width: min(400px, 100%);
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 32px 28px;
  box-sizing: border-box;
  background: var(--surface-white);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-md);
}
.cp-badge {
  width: 44px; height: 44px;
  border-radius: var(--radius-md);
  background: var(--surface-card);
  color: var(--text-secondary);
  display: grid; place-items: center;
}
.cp-title { margin: 0; font: var(--type-h2); color: var(--text-primary); }
.cp-sub { margin: -6px 0 4px; font-size: var(--fs-label); line-height: 18px; color: var(--text-muted); }

.cp-field { display: flex; flex-direction: column; gap: 6px; }
.cp-lbl { font: var(--type-label); font-weight: var(--fw-medium); color: var(--text-secondary); }
.cp-field input {
  height: 36px;
  box-sizing: border-box;
  padding: 0 12px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface-white);
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  transition: border-color var(--dur-fast) var(--ease-standard);
}
.cp-field input:focus { outline: none; border-color: var(--border-strong); }
.cp-field input:disabled { background: var(--bg-sunken); opacity: 0.6; }

/* 常驻一行:空着也占位,错误出现时下面的按钮不动 */
.cp-err { display: flex; align-items: center; gap: 6px; margin: 0; min-height: 18px; line-height: 18px; font-size: var(--fs-label); color: var(--hue-red); }

.cp-submit {
  height: 40px;
  margin-top: 4px;
  border: 1px solid transparent;
  border-radius: var(--radius-full);
  background: var(--ink-900);
  color: var(--control-solid-text);
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  font-weight: var(--fw-medium);
  cursor: pointer;
}
.cp-submit:disabled { opacity: 0.6; cursor: default; }
.cp-logout {
  border: none;
  background: none;
  padding: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  color: var(--text-muted);
  cursor: pointer;
}
.cp-logout:hover { color: var(--text-secondary); text-decoration: underline; }
</style>

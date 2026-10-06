<script setup lang="ts">
// 修改密码(RBAC-SPEC 拍板 #3:管理员设初始密码 + 首次登录强制改密)。
// 独立页,不进导航、不进外壳 —— 强制态下侧边栏点哪儿都会被守卫弹回来,给了反而像页面坏了。
// 「退出登录」是必须留的逃生口:忘了当前密码的人否则会被自己锁死在这一屏。
// 自己来改的从账号菜单进(IconRail / MobileNavDrawer,用户 2026-10-04「现在自己改不了自己的密码」),给「返回」不给「退出登录」。
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { Lock, AlertCircle } from 'lucide-vue-next'
import api from '@/api'
import { useAuthStore } from '@/stores/auth'
import { receipt } from '@/utils/receipt'

const router = useRouter()
const auth = useAuthStore()

const current = ref('')
const next = ref('')
const confirm = ref('')
const errorMsg = ref('')
const loading = ref(false)

// 进页时定下来:改完那一拍标志就清了,标题、说明和底下那颗按钮不该在「提交中…」时翻成另一套
const forced = auth.mustChangePassword

// 从别的页点进来的回原页;直接打开这个地址的(没有上一页)落首页
function goBack() {
  if (window.history.state?.back) router.back()
  else void router.replace(auth.landing)
}

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
  // 改密与导航分两个错误域(动效稿 C4-02):await router.replace,按钮停在「提交中…」直到落地确认;
  // 落地懒块加载失败写自己的话,不冒充「修改失败」—— 密码其实已经改掉了。
  let target: string | undefined
  try {
    const r = await api.post<{ token?: string | null } | null>('/auth/change-password', { currentPassword: current.value, newPassword: next.value })
    // 服务端开了新会话:本机换上新令牌接着用,手上这张旧的连同别处的都已作废(用户 2026-10-04 拍板)。
    // 不换的话下一个请求就 401,刚改完又被弹回登录页
    if (r?.token) auth.setToken(r.token)
    auth.clearMustChangePassword()
    target = auth.landing
  } catch (e: any) {
    errorMsg.value = e?.message || e?.msg || '修改失败，请稍后重试'
    return
  } finally {
    if (!target) loading.value = false
  }
  receipt.ok('密码已修改')
  // 自己来改的回原页;强制改密的落首页
  if (!forced && window.history.state?.back) { router.back(); return }
  try {
    await router.replace(target)
  } catch {
    errorMsg.value = '页面加载失败，请刷新重试'
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
        {{ forced ? '这是管理员分配的初始密码，改掉之后才能进入系统。' : '修改后这台设备保持登录。' }}
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
      <button v-if="forced" type="button" class="cp-logout" @click="onLogout">退出登录</button>
      <button v-else type="button" class="cp-logout" :disabled="loading" @click="goBack">返回</button>
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
  border: 1px solid var(--border-control);
  border-radius: var(--radius-sm);
  background: var(--surface-white);
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  transition: border-color var(--dur-fast) var(--ease-standard);
}
.cp-field input:focus { outline: none; border-color: var(--border-control-strong); }
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

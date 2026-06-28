<script setup lang="ts">
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import Input from '@/components/ds/Input.vue'
import Button from '@/components/ds/Button.vue'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

const username = ref('')
const password = ref('')
const errorMsg = ref('')
const loading = ref(false)

async function submit() {
  errorMsg.value = ''
  loading.value = true
  try {
    await auth.login({ username: username.value, password: password.value })
    const redirect = (route.query.redirect as string) || 'data-home'
    router.push('/' + redirect)
  } catch (e: any) {
    errorMsg.value = e?.msg || e?.message || '登录失败，请检查用户名和密码'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div style="
    min-height:100vh;
    display:flex;
    align-items:center;
    justify-content:center;
    background:var(--bg-app);
  ">
    <div style="
      width:360px;
      background:var(--surface-white);
      border:1px solid var(--border-subtle);
      border-radius:var(--radius-md);
      padding:40px 32px 32px;
      display:flex;
      flex-direction:column;
      gap:24px;
    ">
      <div style="text-align:center">
        <span style="font:var(--type-title-lg);color:var(--text-primary);font-weight:var(--fw-semibold)">
          Factory Park
        </span>
        <p style="margin:4px 0 0;font:var(--type-body);color:var(--text-secondary)">财务管理平台</p>
      </div>

      <form style="display:flex;flex-direction:column;gap:16px" @submit.prevent="submit">
        <Input
          v-model="username"
          label="用户名"
          placeholder="请输入用户名"
          :disabled="loading"
          autocomplete="username"
        />
        <Input
          v-model="password"
          label="密码"
          type="password"
          placeholder="请输入密码"
          :disabled="loading"
          autocomplete="current-password"
        />

        <span
          v-if="errorMsg"
          style="font:var(--type-label);color:var(--hue-red)"
        >{{ errorMsg }}</span>

        <Button
          type="submit"
          variant="filled"
          size="lg"
          :full-width="true"
          :disabled="loading"
        >
          {{ loading ? '登录中…' : '登录' }}
        </Button>
      </form>
    </div>
  </div>
</template>

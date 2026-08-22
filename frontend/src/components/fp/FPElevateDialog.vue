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

// ── 反浏览器自动填充 ──
//
// 这个弹窗的**全部意义**是「主管本人走过来，亲手输一次自己的密码」。
// 浏览器把本机存的账号密码自动填进去，这个动作就被架空了 —— 专员不用叫人，
// 直接点「确认授权」就过。2026-08-22 用户实测截图抓到：两个框都被填满了。
//
// 两道防线，缺一不可：
//   ① autocomplete —— Chrome 对普通登录框会**无视 autocomplete="off"**，
//      但对密码框认 "new-password"（它理解成"设新密码"，不填旧的）。
//   ② readonly 直到聚焦 —— 自动填充跳过 readonly 字段。用户点进来才解锁，
//      这一条挡得住 autocomplete 挡不住的情况。
//
// 字段 name 也不用 username/password 这种词：Chrome 的启发式认名字。
const acctRO = ref(true)
const pwdRO = ref(true)

/**
 * ⚠ **第三道防线,而且是唯一真正管用的那道。**
 *
 * 前两道（autocomplete / readonly）挡住了「页面一加载就自动填好」，但挡不住
 * 「点进密码框，浏览器弹出一列存好的账号让你挑」——用户 2026-08-23 截图正是这个：
 * 弹出 admin / caiwu111 / viewer 三个候选，点一下就填进去了；提交后浏览器还问
 * 「要保存密码吗」。
 *
 * 根因是 <input type="password"> 本身：只要页面上有密码框，Chrome 的密码管理器就
 * 无条件介入，autocomplete 写什么都没用。
 *
 * 所以这里**不用 type="password"**，改用 type="text" + CSS 遮罩（-webkit-text-security）。
 * 浏览器认不出这是登录表单 → 不弹候选、不问保存。视觉上仍是圆点。
 *
 * ⚠ 兜底很重要:遮罩要靠 CSS 支持。不支持的浏览器上明文显示密码是**更严重**的问题,
 *   所以先 feature-detect,不支持就退回 type="password"（宁可被自动填充,不可明文）。
 */
const maskOk = typeof CSS !== 'undefined' && typeof CSS.supports === 'function'
  && CSS.supports('-webkit-text-security', 'disc')
const pwdType = maskOk ? 'text' : 'password'

const permNames = computed(() => (props.perms ?? []).map(permLabel))

// 每次打开都重置：上一次残留的账号/密码/报错留在框里，主管会以为自己已经输过了。
// readonly 也要重新上锁 —— 否则第二次打开时字段是解锁状态，自动填充又能进来。
watch(open, (o) => {
  if (!o) return
  account.value = ''; password.value = ''; err.value = ''
  acctRO.value = true; pwdRO.value = true
  void loadPermDict()
})

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

      <Input v-model="account" label="授权人账号" placeholder="主管 / 管理员的登录账号"
             name="fp-grantor-id" autocomplete="off" :readonly="acctRO"
             @focus="acctRO = false" @keyup.enter="submit" />
      <!-- ⚠ 包一层是为了让 :deep(input) 够得着 —— 遮罩样式要落在 Input 组件**内部**那个
           <input> 上,而父组件的 scoped 选择器只作用到子组件的根元素(本仓踩过这个坑)。 -->
      <div :class="{ 'ev-mask': maskOk }">
        <Input v-model="password" label="授权人密码" :type="pwdType" placeholder="请授权人本人输入"
               name="fp-grantor-secret" autocomplete="off" :readonly="pwdRO"
               @focus="pwdRO = false" @keyup.enter="submit" />
      </div>

      <!-- ⚠ 错误位**常驻**(LAYOUT-STABILITY-SPEC §7)。写成 v-if 的话密码输错时
           这行凭空长出来,把下面的说明和「确认授权」按钮一起顶下去 ——
           用户正要重点一次的按钮在他手指底下跑掉。2026-08-22 用户截图指出。 -->
      <p class="ev-err">
        <template v-if="err">
          <component :is="iconFor('alert-triangle')" :size="14" />
          {{ err }}
        </template>
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
/* 遮罩:用 text 型输入 + CSS 打点,避开浏览器密码管理器。见上方 maskOk 注释 */
.ev-mask :deep(input) {
  -webkit-text-security: disc;
  text-security: disc;
}
.ev-err {
  /* 常驻占位：min-height 恰好一行，空着时不可见但占着地方 */
  margin: 0; min-height: 18px;
  display: flex; align-items: center; gap: 6px;
  font-size: var(--fs-label); line-height: 18px; color: var(--status-danger);
}
.ev-note { margin: 0; font-size: var(--fs-micro); line-height: 1.6; color: var(--text-muted); }
</style>

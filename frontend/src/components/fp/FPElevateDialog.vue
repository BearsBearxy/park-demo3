<script setup lang="ts">
// 主管当场授权（ELEVATION-SPEC）。
//
// 场景是**主管走到专员的座位上**，在专员已登录的界面里输自己的账号密码。所以：
//  · 不切换会话 —— 做事的仍然是专员，审计记 actor=专员 / authorizer=主管
//  · 密码框永远空着进来，成功后立刻清掉，不给浏览器记
//  · 文案要说清「你在替谁背书」，主管才知道自己按下去意味着什么
import { ref, computed, watch, onUnmounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import Button from '@/components/ds/Button.vue'
import Input from '@/components/ds/Input.vue'
import FPDrawer from '@/components/fp/FPDrawer.vue'
import { iconFor } from '@/components/ds/icon'
import { permLabel, loadPermDict } from '@/api/perms'
import { approvalsApi, type Authorizer } from '@/api/approvals'
import { usePresenceStore } from '@/stores/presence'
import Avatar from '@/components/ds/Avatar.vue'

const props = defineProps<{
  /** 要补齐的权限点；非空即打开 */
  perms: string[] | null
  /** 这次操作是什么，给主管看的一句话，如「修改计费口径」 */
  what?: string
  /**
   * 远程授权要带的上下文（设计稿 §07）。**不传就不显示远程那条路** ——
   * 主管远程批准时看不见请求者的屏幕，没有上下文他就是在闭眼点同意。
   */
  page?: string
  action?: string
  impact?: string
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
// ── 第二条路：远程授权（设计稿 §07） ──
//
// ⚠ **补充，不是替代。** 主管不在电脑前时请求者会干等 ——
//   所以等待态一直挂着「改为请人走过来」的逃生口
//   （CONCURRENCY-SPEC §4.3 当初否掉远程批准的第二条理由，今天依然成立）。
const presence = usePresenceStore()
/** 只有带齐上下文的调用点才给远程那条路。 */
const canRemote = computed(() => !!props.page && !!props.action)
const tab = ref<'onsite' | 'remote'>('onsite')
const candidates = ref<Authorizer[] | null>(null)
const picked = ref<string | null>(null)
const waiting = ref(false)
const leftMs = ref(0)
let tick: ReturnType<typeof setInterval> | null = null

async function loadCandidates() {
  candidates.value = null
  try {
    candidates.value = await approvalsApi.candidates(props.perms ?? [])
    picked.value = candidates.value.find((c) => c.online)?.username ?? candidates.value[0]?.username ?? null
  } catch {
    candidates.value = []
  }
}

async function send() {
  if (!picked.value || busy.value) return
  busy.value = true; err.value = ''
  try {
    const p = await approvalsApi.request({
      perms: props.perms ?? [], approver: picked.value,
      page: props.page!, action: props.action!, impact: props.impact,
    })
    myId.value = p.id
    waiting.value = true
    leftMs.value = p.leftMs
    startTick()
  } catch (e) {
    err.value = (e as { message?: string })?.message ?? '发送失败，请重试'
  } finally { busy.value = false }
}

function startTick() {
  stopTick()
  tick = setInterval(() => {
    leftMs.value = Math.max(0, leftMs.value - 1000)
    if (leftMs.value === 0) { waiting.value = false; err.value = '请求已超时。请改为请人走过来，或重发一次。'; stopTick() }
  }, 1000)
}
function stopTick() { if (tick) { clearInterval(tick); tick = null } }

const pickedName = computed(() =>
  candidates.value?.find((c) => c.username === picked.value)?.displayName ?? '')
const mmss = computed(() => {
  const s = Math.floor(leftMs.value / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
})
/** 环:直径 84 / 描边 5 / r=38 / 周长 238.8;弧 186、缺口 53,rotate(130) 把缺口摆到正下方 */
const ARC = 186
const dash = computed(() => {
  const on = Math.max(0, Math.min(ARC, (leftMs.value / 120_000) * ARC))
  return `${on.toFixed(0)} ${(239 - on).toFixed(0)}`
})
const tone = computed(() => (leftMs.value > 60_000 ? 'rs-b' : leftMs.value > 20_000 ? 'rs-o' : 'rs-r'))

/** 我这次请求的 id —— **只认领自己的结果**。每个可编辑屏都挂着一个本组件的实例，
 *  不按 id 认的话，结果会被某个没打开的弹窗吃掉（那正是「批了却没进编辑模式」的原因）。 */
const myId = ref<string | null>(null)

// 结果顺着在场那条唯一的 ping 回来 —— 不开第二条通道。
watch(() => presence.outcome, async (o) => {
  if (!o || !myId.value || o.id !== myId.value) return
  myId.value = null
  stopTick(); waiting.value = false
  if (!o.approved) { err.value = `${o.approverName} 拒绝了这次请求。`; return }
  // ⚠ **必须先把服务端的授权拉回来。**
  //   授权的真身在服务端；当场授权那条路由 requestElevation() 顺带写进 auth store，
  //   远程这条路没人写 —— 不补这一次 refreshElevation 的话 auth.can() 还是 false，
  //   useEditMode 那道「权限不齐就退出编辑态」的守卫会当场把人弹回来。
  //   症状：主管批了，请求者这边窗口关掉了，却进不去编辑模式。
  await auth.refreshElevation()
  emit('elevated')
})

watch(open, (o) => {
  if (!o) { stopTick(); waiting.value = false; myId.value = null; return }
  account.value = ''; password.value = ''; err.value = ''
  acctRO.value = true; pwdRO.value = true
  tab.value = 'onsite'; candidates.value = null; picked.value = null
  void loadPermDict()
})
watch([open, tab], ([o, t]) => { if (o && t === 'remote' && candidates.value === null) void loadCandidates() })
onUnmounted(stopTick)

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

      <!-- 两条路（设计稿 §07）：远程只在调用点带齐上下文时才给 —— 主管远程批准看不见你的屏幕 -->
      <div v-if="canRemote" class="ev-seg">
        <span :class="{ on: tab === 'onsite' }" @click="tab = 'onsite'">请人走过来</span>
        <span :class="{ on: tab === 'remote' }" @click="tab = 'remote'">远程请求授权</span>
      </div>

      <!-- 远程 · 挑一个人 -->
      <template v-if="canRemote && tab === 'remote' && !waiting">
        <p class="ev-note">有这些权限的同事 —— <b>在线的排在前面</b>：</p>
        <div v-if="candidates === null" class="ev-loading">正在找…</div>
        <p v-else-if="!candidates.length" class="ev-note">没有别的同事持有这几项权限，只能请人走过来。</p>
        <div v-else class="ev-cands">
          <label v-for="c in candidates" :key="c.username"
                 :class="['ev-cand', { on: picked === c.username, off: !c.online }]">
            <input type="radio" :value="c.username" v-model="picked" :disabled="!c.online" />
            <Avatar :uid="c.username" :name="c.displayName" :size="26" />
            <span class="ev-cnm">
              <span class="n1">{{ c.displayName }}<span :class="['dot', c.online ? 'live' : 'gone']" /></span>
              <span class="n2">{{ c.role || '—' }} · {{ c.online ? '在线' : '不在线' }}</span>
            </span>
          </label>
        </div>
        <p class="ev-note">
          请求会出现在他顶栏的通知里，<b>2 分钟内有效</b>。他不在电脑前的话，随时可以切回「请人走过来」。
        </p>
      </template>

      <!-- 远程 · 等待 -->
      <div v-else-if="canRemote && tab === 'remote' && waiting" class="ev-wait">
        <div class="ev-ring">
          <svg width="84" height="84" viewBox="0 0 84 84" role="img" :aria-label="`剩余 ${mmss}`">
            <circle class="rs-track" cx="42" cy="42" r="38" fill="none" stroke-width="5"
                    stroke-dasharray="186 53" transform="rotate(130 42 42)" />
            <circle :class="tone" cx="42" cy="42" r="38" fill="none" stroke-width="5"
                    stroke-linecap="round" :stroke-dasharray="dash" transform="rotate(130 42 42)" />
          </svg>
          <Avatar :uid="picked ?? ''" :name="pickedName" :size="40" class="ev-ringav" />
          <span class="ev-pill">{{ mmss }}</span>
        </div>
        <div class="ev-wt">请求已发出</div>
        <div class="ev-ws">
          {{ pickedName }} 的顶栏已经亮起。你可以留在这一页等 ——
          <b>不用刷新，批准到了会自动进编辑模式</b>。
        </div>
      </div>

      <!-- 当场 · 主管走过来 -->
      <Input v-if="!canRemote || tab === 'onsite'" v-model="account" label="授权人账号" placeholder="主管 / 管理员的登录账号"
             name="fp-grantor-id" autocomplete="off" :readonly="acctRO"
             @focus="acctRO = false" @keyup.enter="submit" />
      <!-- ⚠ 包一层是为了让 :deep(input) 够得着 —— 遮罩样式要落在 Input 组件**内部**那个
           <input> 上,而父组件的 scoped 选择器只作用到子组件的根元素(本仓踩过这个坑)。 -->
      <div v-if="!canRemote || tab === 'onsite'" :class="{ 'ev-mask': maskOk }">
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

      <p v-if="!canRemote || tab === 'onsite'" class="ev-note">
        授权是给<b>这台电脑上的这个账号</b>的，不是替他登录。做事的人仍然是
        {{ auth.displayName || auth.me }}，操作日志里会写明由谁授权。
      </p>
    </div>
    <template #footer>
      <!-- ⚠ 等待态的逃生口必须一直挂着：主管不在电脑前时请求者会干等，
           这是当初否掉远程批准的第二条理由，今天依然成立。 -->
      <template v-if="canRemote && tab === 'remote' && waiting">
        <Button variant="gray" size="sm" @click="waiting = false">取消请求</Button>
        <Button variant="outline" size="sm" @click="tab = 'onsite'; waiting = false">改为请人走过来</Button>
      </template>
      <template v-else-if="canRemote && tab === 'remote'">
        <Button variant="gray" size="sm" @click="emit('close')">取消</Button>
        <Button variant="filled" size="sm" :disabled="!picked || busy" @click="send">
          {{ busy ? '发送中…' : '发送请求' }}
        </Button>
      </template>
      <template v-else>
        <Button variant="outline" size="sm" @click="emit('close')">取消</Button>
        <Button variant="filled" size="sm" :disabled="!account.trim() || !password || busy" @click="submit">
          {{ busy ? '验证中…' : '确认授权' }}
        </Button>
      </template>
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
.ev-note b { color: var(--text-primary); font-weight: var(--fw-semibold); }

/* 两条路的分段控件 */
.ev-seg { display: grid; grid-template-columns: 1fr 1fr; gap: 2px; padding: 3px;
          background: var(--surface-sunken); border-radius: var(--radius-full); }
.ev-seg > span { height: 28px; display: grid; place-items: center; border-radius: var(--radius-full);
                 font-size: 12.5px; color: var(--text-muted); cursor: pointer; }
.ev-seg > span.on { background: var(--surface-white); color: var(--text-primary);
                    font-weight: var(--fw-semibold); box-shadow: var(--shadow-pill); }

/* 候选授权人 */
.ev-loading { font-size: 12px; color: var(--text-muted); padding: 8px 2px; }
.ev-cands { border: 1px solid var(--border-subtle); border-radius: 10px; overflow: hidden; }
.ev-cand { display: flex; align-items: center; gap: 10px; padding: 9px 11px;
           background: var(--surface-white); cursor: pointer; }
.ev-cand + .ev-cand { border-top: 1px solid rgba(28, 28, 28, .06); }
.ev-cand.on { background: var(--accent-blue); }
.ev-cand.off { opacity: .45; cursor: not-allowed; }
.ev-cand input { accent-color: var(--hue-blue); }
.ev-cnm { display: flex; flex-direction: column; min-width: 0; }
.ev-cnm .n1 { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: var(--fw-medium); }
.ev-cnm .n2 { font-size: var(--fs-micro); color: var(--text-muted); margin-top: 1px; }
.ev-cnm .dot { width: 7px; height: 7px; border-radius: 50%; }
.ev-cnm .dot.live { background: var(--hue-green); }
.ev-cnm .dot.gone { background: var(--text-disabled); }

/* 等待态：环的配方取自 finBalance 的比率仪表（纯弧、底部留缺口、按阈值换语义色） */
.ev-wait { display: flex; flex-direction: column; align-items: center; gap: 9px;
           padding: 14px 6px 2px; text-align: center; }
.ev-ring { position: relative; width: 84px; height: 84px; }
.ev-ring svg { display: block; }
.ev-ringav { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); }
.ev-pill { position: absolute; bottom: -3px; left: 50%; transform: translateX(-50%);
           font-family: var(--font-mono); font-size: 11px; font-weight: var(--fw-semibold);
           font-variant-numeric: tabular-nums; background: var(--ink-900); color: #fff;
           border-radius: var(--radius-full); padding: 2px 8px; white-space: nowrap;
           box-shadow: 0 0 0 2px var(--surface-white); }
.ev-wt { font-size: 14.5px; font-weight: var(--fw-semibold); }
.ev-ws { font-size: 12px; color: var(--text-muted); max-width: 36ch; line-height: 1.6; }
.rs-track { stroke: rgba(28, 28, 28, .08); }
.rs-b { stroke: var(--hue-blue); }
.rs-o { stroke: var(--hue-orange); }
.rs-r { stroke: var(--hue-red); }
</style>

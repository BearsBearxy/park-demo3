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
import { useRouter } from 'vue-router'
import { reviewApi } from '@/api/review'
import type { PendingItem } from '@/types/review'
import { screenOfKind } from '@/views/data-home/monthClose.logic'
import { periodLink } from '@/nav/deepLink'
import { useTabsStore } from '@/stores/tabs'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const presence = usePresenceStore()
const tabs = useTabsStore()
const pending = computed(() => presence.approvals)

// ── 审核两段(R2 T8/T9;2026-09-08 补明细) ──────────────────
//
// 心跳只发个数(§7.4:3 秒一拍,发清单等于每 3 秒推一遍全月审核态)—— 那条没变。
// 变的是抽屉**打开时**自己去取一趟明细:改前只有「有 N 张表等你审」,
// 而那个「去审核」按钮推的是不带期的裸 /data-home,首页落在它自己锚定的月上。
// 待审的键不在那个月时,人点进去看到的是「暂无待审」,只能自己在年份条上逐月翻 ——
// 铃铛说有、屏上说没有,两句话打架。
//
// 开一次打一趟,不挂在心跳上:抽屉是浮层,不常开;而心跳那条通道只该带一个号。
const router = useRouter()
const toReview = computed(() => presence.pendingReviews)
const returned = computed(() => presence.myReturned)

const rows = ref<PendingItem[]>([])
const loading = ref(false)
watch(() => props.open, async (on) => {
  if (!on || !toReview.value) return
  loading.value = true
  // 取不到就退回改前的样子(只有个数 + 一个去处),不把抽屉整段藏起来:
  // 明细是锦上添花,数字才是那句「有事等你」。
  try { rows.value = await reviewApi.pending() } catch { rows.value = [] }
  finally { loading.value = false }
}, { immediate: true })

function goDataHome() {
  emit('close')
  // 裸路径不带 ?p —— 待审的键可能分散在好几个月,硬指一个月反倒把人送错地方。
  // 要落到具体某一张表,走下面 goItem 那条(它知道是哪个月)。
  void router.push('/data-home')
}

/**
 * 点一条 → 直达那张表所在的屏与月。
 *
 * kind → 屏走 monthClose.logic 的 screenOfKind(从清单那张表反推,不另列一份);
 * scope → co:台账是 companyId、附10 是期区号、报表是 companyId,都能直接当 co 传;
 * 附13/14 的 scope 是 office|phase3,不是 co —— periodLink 的 co 只收数字或 'all',
 * 所以那种走 extra.tab(与首页 chip 同一套口径)。
 * 认不出屏就只跳首页 —— 不猜,猜错比不跳更坏。
 */
function goItem(r: PendingItem) {
  emit('close')
  const v = screenOfKind(r.kind)
  if (!v) { void router.push('/data-home'); return }
  const co = r.scope != null && /^\d+$/.test(r.scope) ? Number(r.scope) : undefined
  const tab = r.scope === 'office' || r.scope === 'phase3' ? r.scope : undefined
  tabs.openDeep(v)
  void router.push(periodLink(v, { p: r.period, co, extra: tab ? { tab } : undefined }))
}

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
  <FPSideDrawer :open="open" :title="`通知 ${pending.length + toReview + returned}`" :width="440" @close="emit('close')">
    <div class="ap-body">
      <!-- 审核两段在最上面:它们是「今天要做的事」,而授权请求是「别人在等你」——
           两者都得有,但前者是常态,后者是偶发。零条时整段不渲染(这里不是定高常驻的条,
           是抽屉里的段落,空段落只会让人多滚一屏)。 -->
      <div v-if="toReview" class="ap-note">
        <component :is="iconFor('clipboard-check')" :size="16" />
        <span>有 <b>{{ toReview }}</b> 张表等你审</span>
        <Button variant="outline" size="sm" @click="goDataHome">去审核</Button>
      </div>
      <!-- 明细:点一条直达那张表所在的屏与月。取不到就只剩上面那行数字(改前的样子),
           不把整段藏起来 —— 数字才是那句「有事等你」,明细是锦上添花。 -->
      <ul v-if="toReview && rows.length" class="ap-rvlist">
        <li v-for="r in rows" :key="r.key">
          <button type="button" class="ap-rvitem" @click="goItem(r)">
            <span class="nm">{{ r.label }}</span>
            <span class="who">{{ r.submittedBy ?? '—' }} 交</span>
            <component :is="iconFor('chevron-right')" :size="14" class="arw" />
          </button>
        </li>
      </ul>
      <div v-if="returned" class="ap-note ap-note-warn">
        <component :is="iconFor('rotate-ccw')" :size="16" />
        <span>你交的 <b>{{ returned }}</b> 张表被退回了</span>
        <Button variant="outline" size="sm" @click="goDataHome">去看看</Button>
      </div>

      <h4 v-if="toReview || returned" class="ap-seg">待批授权 {{ pending.length }}</h4>
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
/* 待审明细。一条一行,整行可点 —— 只把表名做成链接的话点击区太小(这是浮层里的密排列表)。 */
.ap-rvlist { list-style: none; margin: 0 0 10px; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.ap-rvitem {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 7px 10px; border: none; border-radius: 8px; cursor: pointer;
  background: transparent; font-family: var(--font-sans); font-size: 12.5px;
  color: var(--text-primary); text-align: left;
}
.ap-rvitem:hover { background: var(--bg-hover); }
.ap-rvitem .nm { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ap-rvitem .who { flex: 0 0 auto; font-size: 11.5px; color: var(--text-secondary); }
.ap-rvitem .arw { flex: 0 0 auto; color: var(--text-disabled); }

/* 审核两段:与授权卡片同一栏宽,一行说清「几件 + 去处」。 */
.ap-note {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px; margin-bottom: 10px;
  border: 1px solid var(--border-subtle); border-radius: var(--radius-md);
  background: var(--surface-card); color: var(--text-primary); font-size: var(--fs-body);
}
.ap-note > span { flex: 1; min-width: 0; }
.ap-note-warn { border-color: var(--hue-orange); color: var(--hue-orange); }
.ap-seg { margin: 16px 0 8px; font-size: var(--fs-label); color: var(--text-secondary); font-weight: var(--fw-semibold); }

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

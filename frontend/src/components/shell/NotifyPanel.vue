<script setup lang="ts">
// 铃铛面板(画布 06-F;PAGE-BEHAVIOR-SPEC §5.1;UI-OVERLAY-SPEC §7.1)。
//
// 三组:等你处理 → 有结果了 → 系统。一行一件事,点整行跳到那张表那个月 —— 铃铛是外壳上的入口,
// 和命令面板一样在当前页签打开(TAB-BAR-SPEC §2 例外)。授权请求当场处理,不跳。
// 贴附浮层:点外面关、Esc 只关自己;桌面 420 宽贴铃铛,手机贴顶栏下方满宽;最高 70vh,超出在面板里滚。
// 明细、错误槽、看过与否都在 bell store;这里只管画和点。
//
// 授权行从原来的 FPApprovalDrawer 搬来(那个抽屉已删):每条请求各自一个密码框、三道反自动填充、decide。
// 照 06-F 压成两行(实现规范 §2 第 11 条):原来的「要改」一行和权限点胶囊去掉,要改什么并进标题。
// 密码框在这里是**你在自己的电脑上输自己的密码** —— 防「主管电脑没锁屏,路过的人替他点了同意」。
import { ref, computed, onMounted, onUnmounted, type CSSProperties } from 'vue'
import { useRouter } from 'vue-router'
import { useBellStore } from '@/stores/bell'
import { usePresenceStore } from '@/stores/presence'
import { useUpdateStore } from '@/stores/update'
import { useAuthStore } from '@/stores/auth'
import { useTabsStore } from '@/stores/tabs'
import { approvalsApi, type Pending } from '@/api/approvals'
import type { Notice } from '@/api/notices'
import { parseReviewKey, type PendingItem } from '@/types/review'
import { screenOfKind } from '@/views/data-home/monthClose.logic'
import { useViewGate } from '@/composables/useViewGate'
import { periodLink } from '@/nav/deepLink'
import { BRAND } from '@/brand'
import Avatar from '@/components/ds/Avatar.vue'
import Button from '@/components/ds/Button.vue'
import Input from '@/components/ds/Input.vue'
import FPEmpty from '@/components/fp/FPEmpty.vue'
import { iconFor } from '@/components/ds/icon'

const props = defineProps<{
  /** 手机:贴顶栏下方、占满宽(06-F 底注)。桌面:贴铃铛右沿、顶栏下沿线下 6px,420 宽。 */
  mobile?: boolean
  /** 桌面按它摆:宿主 NotifyBell 的 .nb(铃铛)。 */
  anchor?: HTMLElement | null
}>()
const emit = defineEmits<{ close: [] }>()

const bell = useBellStore()
const presence = usePresenceStore()
const update = useUpdateStore()
const auth = useAuthStore()
const tabs = useTabsStore()
const router = useRouter()

/** 关 = 告诉宿主(NotifyBell 接到后 bell.closePanel(),本次新来的行由它变灰)。 */
const close = () => emit('close')

// ── 摆在哪 ──
// 桌面手机都挂到 body、position:fixed(同 ShellTip.place):顶栏带 backdrop-filter,自成层叠上下文,
// 面板留在里面的话 z 只在顶栏内部算,出了顶栏整块按 0 画 —— 内容区里 sticky 表头 / 固定列、带定位的块
// 全盖到面板上面,授权行的密码框和「批准」被压住(2026-10-01 对抗复查)。
// 上沿取顶栏下沿 +6(06-F;DS .nf-pop margin-top 6),右沿对齐铃铛右沿。
function place(): CSSProperties {
  const a = props.anchor
  if (props.mobile || !a) return {}
  const r = a.getBoundingClientRect()
  const bar = (a.closest('header') ?? a).getBoundingClientRect()
  return { top: `${bar.bottom + 6}px`, right: `${window.innerWidth - r.right}px` }
}
const pos = ref(place())
const reposition = () => { pos.value = place() }

// ── 点外面关 / Esc 只关自己(UI-OVERLAY-SPEC §7.1)──
// 挂 capture:宿主容器常有 @mousedown.stop,冒泡阶段收不到(ds/Popover 同一条理由)。
// 按在铃铛上也算外面:先关,紧跟的那次 click 由 NotifyBell 认出是同一下、不再重开。
const root = ref<HTMLElement | null>(null)
function onDoc(e: MouseEvent) {
  if (!root.value?.contains(e.target as Node)) close()
}
function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  e.stopPropagation()   // 只关自己:底下的抽屉 / 弹窗也听 Esc
  close()
}
onMounted(() => {
  document.addEventListener('mousedown', onDoc, true)
  document.addEventListener('keydown', onKey, true)
  window.addEventListener('resize', reposition)
})
onUnmounted(() => {
  document.removeEventListener('mousedown', onDoc, true)
  document.removeEventListener('keydown', onKey, true)
  window.removeEventListener('resize', reposition)
})

// ── 等你处理 ──
// 明细没到(还在取 / 没取到)时退回一行「几件 + 一个去处」:数字才是那句「有事等你」,明细是锦上添花,
// 不能因为明细取不到就把整段藏起来(原 FPApprovalDrawer 的同一条)。
const reviewFallback = computed(() => !bell.reviews.length && presence.pendingReviews > 0)
const returnedFallback = computed(() => !bell.returned.length && presence.myReturned > 0)
const hasTodo = computed(() => presence.approvals.length > 0 || bell.reviews.length > 0 || bell.returned.length > 0
  || reviewFallback.value || returnedFallback.value)
/**
 * 清单还没取回来过(第一次打开、正在取)。这时空清单不等于没有:蓝点正叫人来看,先说「加载中…」,
 * 不能先说「现在没有通知」再换成清单 —— 那句是假话,版式也跳一下。
 */
const resultsPending = computed(() => !bell.noticesLoaded && !bell.noticesErr)
const hasResults = computed(() => bell.notices.length > 0 || !!bell.noticesErr
  || (resultsPending.value && presence.unseenResults > 0))
const hasSystem = computed(() => !!bell.newVersion || bell.changelogUnread)

const { blocked } = useViewGate()

/**
 * 点一行 → 那张表所在的屏与月,在当前页签打开、换一个新实例(深链才读得到 ?p)。
 * 看不了那一屏(只勾了审核和部分屏查看的自建审核角色)就说一句缺哪一项、不跳,面板不关(RBAC-SPEC §15.1 第 4 条)。
 * kind → 屏走 monthClose.logic 的 screenOfKind(不另列一份);scope 是数字的当 co 传(台账公司 / 附10 期区 /
 * 报表公司),附13/14 的 office|phase3 走 extra.tab。认不出屏就去本月出账 —— 不猜,猜错比不跳更坏。
 */
function go(kind: string, scope: string | null, period: string) {
  const v = screenOfKind(kind)
  if (!v) { goDataHome(); return }
  if (blocked('/' + v)) return
  close()
  const co = scope != null && /^\d+$/.test(scope) ? Number(scope) : undefined
  const tab = scope === 'office' || scope === 'phase3' ? scope : undefined
  tabs.openFresh(v)
  void router.push(periodLink(v, { p: period, co, extra: tab ? { tab } : undefined }))
}
function goDataHome() {
  if (blocked('/data-home')) return
  close()
  tabs.open('data-home')
  void router.push('/data-home')
}
/** 有结果了的一行跳去哪:ref 是审核键(`ledger:7:2026-08`)或 `bill-notices:2026-09`;解不出(授权、权限类)就不跳。 */
const targetOf = (n: Notice) => (n.ref ? parseReviewKey(n.ref) : null)
function goNotice(n: Notice) {
  const k = targetOf(n)
  if (k) go(k.kind, k.scope, k.period)
}

const pad2 = (n: number) => String(n).padStart(2, '0')
/** 「10 分钟前」「1 小时前」「09:12」「昨天」「09-28」(06-F 的几种写法):越近写得越细。 */
function ago(iso: string | null | undefined): string {
  if (!iso) return ''
  const t = new Date(iso)
  if (Number.isNaN(+t)) return ''
  const now = new Date()
  const min = Math.floor((+now - +t) / 60_000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  if (t.toDateString() === now.toDateString())
    return min < 180 ? `${Math.floor(min / 60)} 小时前` : `${pad2(t.getHours())}:${pad2(t.getMinutes())}`
  const y = new Date(now)
  y.setDate(now.getDate() - 1)
  if (t.toDateString() === y.toDateString()) return '昨天'
  return `${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`
}
const join = (...xs: (string | null | undefined)[]) => xs.filter(Boolean).join(' · ')

/** 「李出纳交 · 10 分钟前」。显示名由后端补(PendingItemDTO.submittedByName),没有就退回账号名。 */
function pendingSub(r: PendingItem & { submittedByName?: string | null }) {
  const who = r.submittedByName ?? r.submittedBy
  return join(who && `${who}交`, ago(r.submittedAt))
}
/** 「李审：B座 3 块表读数比上月小 · 09:12」 */
function returnedSub(r: { reviewedByName: string | null; reviewedBy: string | null; reason: string | null; reviewedAt: string | null }) {
  const who = r.reviewedByName ?? r.reviewedBy
  return join(who && r.reason ? `${who}：${r.reason}` : who || r.reason, ago(r.reviewedAt))
}
/** 审核类第二行先写审核人(「李审 · 1 小时前」「李审：理由 · 昨天」);别的类谁做的已在标题里。 */
function noticeSub(n: Notice) {
  const who = n.kind.startsWith('review_') ? n.actorName : null
  return join(who && n.detail ? `${who}：${n.detail}` : who || n.detail, ago(n.createdAt))
}
const KIND_ICON: Record<string, [string, 'ok' | '']> = {
  review_approved: ['check-circle-2', 'ok'], approval_approved: ['check-circle-2', 'ok'],
  review_withdrawn: ['rotate-ccw', ''], approval_rejected: ['x-circle', ''], approval_timeout: ['clock', ''],
  bill_unconfirmed: ['x', ''], bill_voided: ['x', ''], perms_changed: ['shield-check', ''],
}
const iconOf = (n: Notice) => KIND_ICON[n.kind] ?? ['info', '']

// ── 系统 ──
/** 「新增 3 项 · 改进 2 项」。重点卡(feature)也是一条新增。 */
const noteCounts = computed(() => {
  const n = update.note
  if (!n) return ''
  const c: [number, string][] = [[n.added.length + (n.feature ? 1 : 0), '新增'], [n.improved.length, '改进'], [n.fixed.length, '修复']]
  return c.filter(([k]) => k > 0).map(([k, w]) => `${w} ${k} 项`).join(' · ')
})
function seeHistory() {
  close()
  update.openHistory()
}
function reload() { location.reload() }

// ── 授权请求:每条各自的密码框 —— 两条请求同时进来时不能共用一个输入 ──
const pw = ref<Record<string, string>>({})
const err = ref<Record<string, string>>({})
const busy = ref<string | null>(null)
// 反自动填充:与 FPElevateDialog / FPTakeoverDrawer 同一套三道 —— autocomplete=off、readonly 直到聚焦、
// type=text + CSS 遮罩(只要页面上有 type=password,Chrome 就弹存好的账号;不支持遮罩的浏览器退回 password,
// 宁可被自动填充,不可明文)。这里输的是主管自己的密码,浏览器更想帮他填。
const maskOk = typeof CSS !== 'undefined' && typeof CSS.supports === 'function'
  && CSS.supports('-webkit-text-security', 'disc')
const pwdType = maskOk ? 'text' : 'password'
const ro = ref<Record<string, boolean>>({})

/** 「1:42」:剩下的有效期。心跳 3 秒一拍刷新 leftMs。 */
const mss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${pad2(s % 60)}`
}

async function decide(p: Pending, approve: boolean) {
  if (busy.value) return
  if (approve && !pw.value[p.id]) return
  busy.value = p.id
  err.value[p.id] = ''
  try {
    await approvalsApi.decide(p.id, approve, approve ? pw.value[p.id] : undefined)
    pw.value[p.id] = ''
    // 名单由下一拍心跳刷新(3 秒);先本地摘掉,别让他对着一条已处理的再点一次
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
  <!-- 挂到 body:桌面、手机顶栏都带 backdrop-filter,自成层叠上下文,面板留在里面会被页面里定位的东西盖住 -->
  <Teleport to="body">
  <div ref="root" :class="['np', { 'np-m': mobile }]" :style="mobile ? undefined : pos" role="dialog" aria-label="通知">
    <template v-if="hasTodo || hasResults || hasSystem">
      <section v-if="hasTodo" class="np-grp">
        <h4 class="np-gh">等你处理<span class="np-n">{{ bell.red }}</span></h4>

        <div v-for="p in presence.approvals" :key="p.id" class="np-row np-ap">
          <Avatar class="np-av" :uid="p.requester" :name="p.requesterName" :size="28" />
          <div class="np-main">
            <div class="np-line">
              <span class="np-txt">
                <span class="np-t">{{ p.requesterName }}请你授权{{ p.action }}</span>
                <span class="np-s">{{ join(p.page, p.impact) }}</span>
              </span>
              <span class="np-left">{{ mss(p.leftMs) }}</span>
            </div>
            <div class="np-f">
              <div :class="['np-pw', { 'np-mask': maskOk }]">
                <Input v-model="pw[p.id]" size="sm" :type="pwdType" placeholder="你的密码"
                       :name="`fp-approve-${p.id}`" autocomplete="off" :readonly="ro[p.id] !== false"
                       @focus="ro[p.id] = false" @keyup.enter="decide(p, true)" />
              </div>
              <Button variant="outline" size="sm" :disabled="busy === p.id" @click="decide(p, false)">拒绝</Button>
              <Button variant="filled" size="sm" :disabled="busy === p.id || !pw[p.id]" @click="decide(p, true)">
                {{ busy === p.id ? '处理中…' : '批准' }}
              </Button>
            </div>
            <!-- 后果一句与报错同一行位:输错时这行换成红字,不长出新行把按钮顶走(LAYOUT-STABILITY §7) -->
            <p :class="['np-note', { err: err[p.id] }]">{{ err[p.id] || '批准后他 30 分钟内能改，日志同时记你们两人' }}</p>
          </div>
        </div>

        <button v-for="r in bell.reviews" :key="r.key" type="button" class="np-row np-go" @click="go(r.kind, r.scope, r.period)">
          <span class="np-ic"><component :is="iconFor('file-text')" :size="16" /></span>
          <span class="np-txt"><span class="np-t">{{ r.label }} 等你审</span><span class="np-s">{{ pendingSub(r) }}</span></span>
          <component :is="iconFor('chevron-right')" :size="12" class="np-arw" />
        </button>
        <button v-if="reviewFallback" type="button" class="np-row np-go" @click="goDataHome">
          <span class="np-ic"><component :is="iconFor('file-text')" :size="16" /></span>
          <span class="np-txt"><span class="np-t">有 {{ presence.pendingReviews }} 张表等你审</span><span class="np-s">去本月出账看</span></span>
          <component :is="iconFor('chevron-right')" :size="12" class="np-arw" />
        </button>

        <button v-for="r in bell.returned" :key="r.key" type="button" class="np-row np-go" @click="go(r.kind, r.scope, r.period)">
          <span class="np-ic warn"><component :is="iconFor('rotate-ccw')" :size="16" /></span>
          <span class="np-txt"><span class="np-t">你交的{{ r.label }} 被退回</span><span class="np-s">{{ returnedSub(r) }}</span></span>
          <component :is="iconFor('chevron-right')" :size="12" class="np-arw" />
        </button>
        <button v-if="returnedFallback" type="button" class="np-row np-go" @click="goDataHome">
          <span class="np-ic warn"><component :is="iconFor('rotate-ccw')" :size="16" /></span>
          <span class="np-txt"><span class="np-t">你交的 {{ presence.myReturned }} 张表被退回了</span><span class="np-s">去本月出账看</span></span>
          <component :is="iconFor('chevron-right')" :size="12" class="np-arw" />
        </button>
      </section>

      <section v-if="hasResults" class="np-grp">
        <h4 class="np-gh">有结果了</h4>
        <div v-if="bell.noticesErr && !bell.notices.length" class="np-row">
          <span class="np-txt"><span class="np-s">没取到：{{ bell.noticesErr }}</span></span>
          <button type="button" class="np-act" @click="bell.loadNotices()">重试</button>
        </div>
        <div v-else-if="resultsPending && !bell.notices.length" class="np-row">
          <span class="np-txt"><span class="np-s">加载中…</span></span>
        </div>
        <component :is="targetOf(n) ? 'button' : 'div'" v-for="n in bell.notices" :key="n.id"
                   v-bind="targetOf(n) ? { type: 'button' } : {}"
                   :class="['np-row', { 'np-go': targetOf(n), read: n.seen }]" @click="goNotice(n)">
          <!-- 上次打开之后新来的行挂小蓝点;看过的标题变灰,关掉面板后这一批也变灰(06-G 规则第 5 行) -->
          <i v-if="!n.seen" class="np-dot" aria-hidden="true" />
          <span :class="['np-ic', iconOf(n)[1]]"><component :is="iconFor(iconOf(n)[0])" :size="16" /></span>
          <span class="np-txt"><span class="np-t">{{ n.title }}</span><span class="np-s">{{ noticeSub(n) }}</span></span>
          <component :is="iconFor('chevron-right')" v-if="targetOf(n)" :size="12" class="np-arw" />
        </component>
      </section>

      <section v-if="hasSystem" class="np-grp">
        <h4 class="np-gh">系统</h4>
        <div v-if="bell.newVersion" :class="['np-row', { read: bell.newVersionRead }]">
          <span class="np-ic"><component :is="iconFor('refresh-cw')" :size="16" /></span>
          <span class="np-txt">
            <span class="np-t">{{ BRAND.name }}已更新到 v{{ bell.newVersion }}</span>
            <span class="np-s">{{ auth.editing ? '你正在编辑，保存后再刷新' : '刷新后生效' }}</span>
          </span>
          <button type="button" class="np-act" @click="reload">刷新</button>
        </div>
        <div v-if="bell.changelogUnread" :class="['np-row', { read: bell.changelogRead }]">
          <span class="np-ic"><component :is="iconFor('info')" :size="16" /></span>
          <span class="np-txt"><span class="np-t">v{{ update.version }} 更新了什么</span><span class="np-s">{{ noteCounts }}</span></span>
          <button type="button" class="np-act" @click="seeHistory">看看</button>
        </div>
      </section>

      <div v-if="hasResults || hasSystem" class="np-foot">
        <button type="button" class="np-act" @click="bell.markAllRead()">全部标为已读</button>
      </div>
    </template>
    <p v-else-if="resultsPending" class="np-wait">加载中…</p>
    <FPEmpty v-else size="sm">现在没有通知</FPEmpty>
  </div>
  </Teleport>
</template>

<style scoped>
/* 桌面的 top / right 由 place() 按铃铛算好写在内联样式里 */
.np {
  position: fixed; z-index: var(--z-popover);
  box-sizing: border-box; width: 420px; max-width: calc(100vw - 16px);
  max-height: 70vh; overflow-y: auto; overscroll-behavior: contain;
  padding: 8px;
  background: var(--surface-raised);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-pop);
  text-align: left;
  animation: fp-pop-in var(--dur-fast) var(--ease-out);
}
/* 手机:贴顶栏下方、占满宽(06-F 底注)。挂在 body 上按视口定位;顶栏 52 + 刘海,与 MobileTopBar 同一个数 */
.np-m {
  position: fixed; top: calc(52px + env(safe-area-inset-top)); left: 0; right: 0;
  width: auto; max-width: none;
  border-width: 0 0 1px; border-radius: 0 0 var(--radius-md) var(--radius-md);
}

.np-grp + .np-grp { margin-top: 4px; }
.np-gh {
  margin: 0; padding: 8px 12px 4px;
  font-size: var(--fs-label); line-height: 18px; font-weight: var(--fw-semibold); color: var(--text-secondary);
}
.np-n { margin-left: 6px; font-weight: var(--fw-regular); color: var(--text-muted); }

/* 两行字的行:图标格顶对齐(06-F;DS .nf-row align-items:flex-start),› 和行尾按钮自己居中 */
.np-row {
  position: relative; box-sizing: border-box; width: 100%;
  display: flex; align-items: flex-start; gap: 10px;
  padding: 8px 10px 8px 12px;
  border: none; border-radius: var(--radius-sm); background: transparent;
  font: inherit; color: var(--text-primary); text-align: left;
}
.np-go { cursor: pointer; transition: background var(--dur-fast) var(--ease-standard); }
.np-go:hover { background: var(--bg-hover); }
.np-go:active { background: var(--ink-100); transition-duration: 0ms; }

.np-ic {
  flex: none; display: grid; place-items: center; width: 28px; height: 28px;
  border-radius: var(--radius-sm); background: var(--surface-sunken); color: var(--text-secondary);
}
.np-ic.ok { background: var(--ok-soft); color: var(--ok-text); }
.np-ic.warn { background: var(--warn-soft); color: var(--hue-orange); }
/* 小蓝点和图标格同一条中线(行上内边距 8 + 图标格 28/2 = 22;DS .nf-row .u top 19) */
.np-dot {
  position: absolute; left: 2px; top: 19px;
  width: 6px; height: 6px; border-radius: var(--radius-full); background: var(--hue-blue);
}

/* 字一律折行,不截断、不省略 */
.np-txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.np-t { font-size: var(--fs-body); line-height: 20px; overflow-wrap: anywhere; }
.np-s { font-size: var(--fs-label); line-height: 18px; color: var(--text-muted); overflow-wrap: anywhere; }
/* 看过的行标题变灰(06-F;DS .nf-row.read .nf-t) */
.np-row.read .np-t { color: var(--text-secondary); }
.np-arw { flex: none; align-self: center; color: var(--text-muted); }
.np-wait { margin: 0; padding: 8px 12px; font-size: var(--fs-label); line-height: 18px; color: var(--text-muted); }

.np-act {
  flex: none; align-self: center; padding: 4px 6px; border: none; border-radius: var(--radius-sm); background: transparent;
  font: inherit; font-size: var(--fs-label); color: var(--text-link); cursor: pointer;
}
.np-act:hover { background: var(--bg-hover); }

/* 授权请求:头像 + 两行字 + 倒计时;下面一排密码 / 拒绝 / 批准;再下面一句后果 */
.np-main { flex: 1; min-width: 0; }
.np-line { display: flex; align-items: center; gap: 8px; }
.np-left {
  flex: none; font-family: var(--font-mono); font-size: var(--fs-label); font-weight: var(--fw-semibold);
  color: var(--orange-text); font-variant-numeric: tabular-nums;
}
/* 头像照 06-F 是 28 方块、圆角 8,和别的行的图标格同形;ds/Avatar 的圆角、字号写在内联样式里,只能 !important 盖 */
.np-av { border-radius: var(--radius-sm) !important; font-size: var(--fs-label) !important; }
.np-f { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.np-pw { flex: 1; min-width: 0; }
/* 06-F 的密码框是胶囊形、28 高(和两颗 sm 按钮一样高);Input 的圆角、高度写在内联样式里,只能 !important 盖 */
.np-pw :deep(.ds-in-field) { height: 28px !important; border-radius: var(--radius-full) !important; }
/* 字 12(DS .field)。窄屏不压:Input 在 ≤600 换 16 是防 iOS 聚焦时整页放大 */
@media (min-width: 601px) {
  .np-pw :deep(.ds-in-field) { --ds-in-fs: var(--fs-label); }
}
/* 掩码点不能走自托管子集(iOS 上是一排黑竖条),见 tokens.css 的 --font-ui。
   这里是 type="text",选不中 base.css 那条 input[type="password"],得自己写。 */
.np-mask :deep(input) { -webkit-text-security: disc; text-security: disc; font-family: var(--font-ui); }
.np-note { margin: 6px 0 0; min-height: 18px; font-size: var(--fs-label); line-height: 18px; color: var(--text-muted); }
.np-note.err { color: var(--delta-down-text); }

.np-foot { margin-top: 8px; padding: 8px 6px 0; border-top: 1px solid var(--divider); }
</style>

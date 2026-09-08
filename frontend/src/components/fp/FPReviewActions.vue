<script setup lang="ts">
// 审核动作簇 —— **全站唯一的一份**(per-screen-review §01/§02;SIDEBAR-UX-REDESIGN §9.2)。
//
// 立成一个组件而不是让 15 个屏各画一遍,理由与 FPEditModeButton 那次事故逐字相同:
// 九个屏抄了同一段模板,加锁时只有两处跟着改 —— 其余七屏锁真的挡住了、界面却一个字不变。
// 这一簇有四态 × 两角色 = 八格,抄 15 遍必漂移,而漂移的表现是同一张表在附表屏和台账屏上
// 给出两套不同的按钮。
//
// 位置铁律(§01):它长在编辑按钮**左边**,同高 28px、同胶囊圆角,四态换内容不换版。
// 不做成横幅(顶版,EDIT-MODE-SPEC 已经因为这个理由删过一条同款提示条),
// 不做成「更多」菜单(交审是这张表做完之后唯一要做的事,藏进二级菜单等于说它不重要)。
//
// 判据只有这一份(铁律 5):状态取 stores/review.ts 的 statusOf,写入走它的 *All,
// 屏里不许再推一遍。本组件是那「一份」,不是第 16 份 —— 它替掉的正是 15 份。
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import Button from '@/components/ds/Button.vue'
import FPReviewDialog from '@/components/fp/FPReviewDialog.vue'
import { iconFor } from '@/components/ds/icon'
import { useAuthStore } from '@/stores/auth'
import { useReviewStore } from '@/stores/review'
import { periodOfKey, type ReviewRow, type ReviewStatus } from '@/types/review'

const props = withDefaults(defineProps<{
  /** 这一屏此刻**看得见**的那几把键。null / 空 = 整簇不渲染。
   *  「看得见」是字面意思:附10 挂 4 把期区键,用户一次只看一把,按钮就只作用于那一把(§03-B4)。 */
  keys: string[] | null
  /** 弹卡标题里的人话名,如「附表12 · 2025-06」。屏自己拼 —— 前端没有 kind→人话名的映射表,
   *  新开一份会与后端 ReviewKind.label() 形成第二份。 */
  label: string
  /** 按月进屏的屏传「6 月」→ 按钮写「交审 6 月」;整年模式不传(改传 year)。 */
  monthText?: string | null
  /**
   * **整年模式**(2026-09-08 拍板):四个年表屏(附6/7·8/11/13·14)一屏一整年、12 行同时摆着,
   * 没有「当前月」这一维 —— 一颗按钮管整年,写「交审 2025 年（3 个月）」。传的是年份数字本身。
   *
   * 为什么是一个 prop 而不是从键里自动推:自动推的判据只能是「多把键、同 kind+scope、跨月」,
   * 而**一年只剩一个月够格时 keys 就只有一把**,那个形状当场消失 —— 该写「交审 6 月」的地方
   * 会退回光秃秃一颗「交审」,而这四屏一屏十二行,光秃秃的「交审」交的是哪个月全靠猜(§03-B2)。
   * (顺带确认过:今天的多键场景都不是「同 kind 跨月」—— 公共电核算是同月两把不同 kind,
   *  台账/报表是同月同 kind 不同 scope —— 所以自动推**今天**不会误伤,是上面那条边界否掉了它。)
   *
   * 与 monthText 二选一:年表屏传 year,单月屏传 monthText。
   */
  year?: number | null
  /** 这一屏的编辑入口画不画(= FPEditModeButton 的 canEnter)。假 ⇒ 整簇不渲染:
   *  只读账号 / 园区股东本来就没有编辑按钮,单给他看一句「已审核」是凭空多一条用不上的信息
   *  —— 与 FPEditModeButton 的现行口径一致。 */
  canEdit?: boolean
  /**
   * 宿主此刻在不在编辑态。真 ⇒ **动作按钮一颗都不画**,但「已退回」那颗 chip 留着。
   *
   * 守的是「交审」这一颗。屏是草稿式编辑(MeterView 的 draft/dirtyIds、催缴单的行内备注、
   * 报表屏的 draft),而交审交的是**库里那一份**:在编辑态那一位置画一颗「交审」,
   * 等于请人把还没保存的东西交出去 —— 交完后端把这个键翻成 submitted,
   * useEditMode:267 那条守卫当场强退编辑态,手上的草稿静默消失。
   *
   * 撤回 / 通过 / 退回 / 撤销这四颗看着也被挡住了,其实挡了个空:它们只在 submitted /
   * approved 态出现,而那两态本来就锁编辑、根本进不了编辑态。**这条 prop 实际只挡「交审」**——
   * 写在这里免得后人读到「全挡」以为是冗余判断顺手删掉。
   *
   * chip 反过来必须留:人正是照着那句退回理由在改,改的时候把理由抽走是反的(§04 那句
   * 「这句话人要边改边看几分钟」)。
   *
   * 判据收在组件里,不在 7 个宿主各挂一遍 v-if —— 各挂一遍必漂移(本仓栽过三次),
   * 而漂移的表现是同一颗按钮在报表屏藏了、在抄表屏没藏。
   */
  edit?: boolean
}>(), { monthText: null, year: null, canEdit: true, edit: false })

const auth = useAuthStore()
const review = useReviewStore()

const keys = computed(() => props.keys ?? [])

// 键一变就自取那一年的闸道数据。宿主大多已经 ensure 过(SchedHeader / useEditMode 都有),
// 但四个年表屏(附6/7·8/11/13·14)根本没给 SchedHeader 传 review-key,而切 tab = 换 scope = 换键。
// 自己 ensure 一次,这一簇就不依赖每个宿主都记得取 —— ensureYear 命中已有的年是直接 return,不多打请求。
watch(() => keys.value.join('|'), () => { void review.ensureFor(keys.value) }, { immediate: true })

/**
 * 「还不知道」必须与「未交审」分开画。
 *
 * blockOf 在年份数据没到手时**故意**回 null(拿不准不挡,D-R2-7),那条口径不能照搬到这里:
 * 挡不挡编辑最坏是白录一次,而这里画错的后果是给一张已审核的表画一颗「交审」——
 * 用户点下去吃一个 409,以为界面坏了。拿不准就一颗都不画。
 */
const ready = computed(() => keys.value.length > 0 && keys.value.every((k) => {
  const p = periodOfKey(k)
  return !!p && review.yearLoaded(+p.slice(0, 4))
}))
const show = computed(() => !!props.canEdit && ready.value)

const rowOf = (k: string): ReviewRow | null => review.rowOf(k)
/** 态的判据(含「库里没这行 = 派生 entered」)在 store.statusOf 那一份,这里只筛。
 *  null = 年数据还没到手 —— 那一档本来就被 ready 挡在渲染外了,这里回 false 是第二道保险。 */
const inState = (...ss: ReviewStatus[]) =>
  keys.value.filter((k) => { const s = review.statusOf(k); return !!s && ss.includes(s) })

const isReviewer = computed(() => auth.can('review:approve'))

// 每个动作各自作用于「此刻正处在对应态的那几把键」,不先把多键折成一个态再统一发。
// 折的话公共电核算屏(alloc + alloc-loss)一把 entered 一把 submitted 时,submitAll 会把
// 已交审的那把再交一次 —— 吃一个 409,而屏上看不出是哪把出的错。
const toSubmit = computed(() => inState('entered', 'returned'))
const toApprove = computed(() => (isReviewer.value ? inState('submitted') : []))
const toWithdraw = computed(() => (isReviewer.value ? inState('approved') : []))
/**
 * 撤回只对**自己交的**画(§07-③:别人交的表你撤不了,那是审核员的「退回」)。
 *
 * 这是**显示门不是判据门**(铁律 7):本人判定的准话由后端出,前端只决定画不画这颗按钮,
 * 不画成禁用 + tooltip —— 那是在前端重算一份后端判据。
 * ⚠ 后端 submitted_by 存的是 Authentication.getName() = **登录名**,对应 auth.me;
 *   auth.displayName 是展示名,拿它比会恒不相等,这颗按钮就永远不出。
 */
const toRecall = computed(() =>
  inState('submitted').filter((k) => rowOf(k)?.submittedBy === auth.me))

/** 被退回的那一把(多键时取第一把)。红 chip 与理由浮层都读它。 */
const returned = computed(() => keys.value.map(rowOf).find((r) => r?.status === 'returned') ?? null)
const chipText = computed(() => {
  const r = returned.value
  if (!r) return ''
  // 与 reviewNoteOf 同形(「已审核 · 李审 03-05」):日期只取月日,年在屏上别处已经写着了
  const who = r.reviewedBy ?? ''
  const day = r.reviewedAt ? r.reviewedAt.slice(5, 10) : ''
  return `已退回${who ? ' · ' + who : ''}${day ? ' ' + day : ''}`
})
const returnedAt = computed(() => (returned.value?.reviewedAt ?? '').slice(0, 16).replace('T', ' '))

/** 多键时按钮带项数,「交审」→「交审（2 项）」。单键不带 —— 括号里写「1 项」是噪音。 */
const nSuffix = (n: number) => (n > 1 ? `（${n} 项）` : '')

/**
 * 一颗按钮的文案。两种模式走同一根,免得年表屏那半再抄一份 nSuffix 出去漂移。
 *
 * · 整年模式(props.year 非空)——「交审 2025 年（3 个月）」。括号里那个数是**这一颗此刻真的会
 *   发出去**的月数,不是屏上有几个月:交审看 entered/returned、通过看 submitted,同一屏两颗
 *   本来就不一样(8 已审 · 2 待审 · 1 待交 的年,「交审」是 1 个月、「通过」是 2 个月)。
 *   只剩一个月时写「交审 6 月」——「2025 年（1 个月）」读着别扭,而它就是一个月的事。
 * · 按月模式 —— 原样不动:只有「交审」带 monthText,其余几颗仍是「通过（2 项）」这种。
 *   这里不顺手给它们也加上月份:那会改到附10/12/台账三屏现有的按钮文案,不在本轮里。
 */
function actText(verb: string, ks: string[], withMonth = false) {
  if (props.year == null) {
    return `${verb}${withMonth && props.monthText ? ' ' + props.monthText : ''}${nSuffix(ks.length)}`
  }
  const p = ks.length === 1 ? periodOfKey(ks[0]) : null
  return p ? `${verb} ${+p.slice(5, 7)} 月` : `${verb} ${props.year} 年（${ks.length} 个月）`
}

const submitText = computed(() =>
  actText(returned.value ? '重新交审' : '交审', toSubmit.value, true))

/** 确认卡里那句代价。整年模式必须点明「这一年的 N 个月一起锁」—— 一颗按钮管整年,
 *  说成「这个月」是漏报代价(用户 2026-09-08 明确要求的那一半)。 */
const confirmHint = computed(() =>
  props.year == null
    ? '交出去之后这张表这个月就锁了，你改不了，要等审核员通过或退回。'
    : `交出去之后这张表 ${props.year} 年的 ${toSubmit.value.length} 个月一起锁了，你改不了，要等审核员通过或退回。`)

// ── 动作 ────────────────────────────────────────────────
const acting = ref(false)          // 在途,防连点

/**
 * 报错分流。**423 / 409 / 403 不许合成一句** —— 三者要用户去做的事完全不同:
 *   409 = 上游没审完(或还没录完) → 去催上游 / 先把表录完
 *   403 = 你没有这张表的权限 → 去找有权限的人
 *   其余(含 423)= 后端已经写好了准话,原样弹
 * 这份口径与 DataHomeView.runAction 同源,照抄不新写 —— 两处给出两套说法,用户分不出该找谁。
 */
async function run(fn: () => Promise<unknown>) {
  if (acting.value) return
  acting.value = true
  try {
    await fn()
  } catch (e) {
    const err = e as { code?: number; message?: string }
    const msg = err?.message ?? '操作失败'
    alert(err?.code === 409 ? `上游还没审完：${msg}`
        : err?.code === 403 ? `你没有这张表的权限：${msg}`
        : msg)
  } finally {
    acting.value = false
  }
}

const confirming = ref(false)                            // D1 交审确认卡
const dlg = ref<'return' | 'withdraw' | null>(null)      // D2 复用 FPReviewDialog

async function doSubmit() {
  const ks = toSubmit.value
  confirming.value = false
  await run(() => review.submitAll(ks))
}
const onApprove = () => run(() => review.approveAll(toApprove.value))
// 撤回不要确认卡、不要理由(§07-③):撤的是自己刚交的东西,撤错了再交一次就是。
const onRecall = () => run(() => review.recallAll(toRecall.value))
async function onDialogConfirm(reason: string) {
  const a = dlg.value
  if (!a) return
  const ks = a === 'return' ? toApprove.value : toWithdraw.value
  await run(() => (a === 'return' ? review.returnAll(ks, reason) : review.withdrawAll(ks, reason)))
  dlg.value = null
}

// ── 理由浮层(§04) ──────────────────────────────────────
// 浮层规矩(UI-OVERLAY-SPEC):点外关走 document capture(带 open 守卫),Esc 自关并 stopPropagation
// (内层浮层赢,宿主弹窗听 bubble);无 <Transition>(repo 禁令)。与 FPMoreMenu 同一份写法。
const reasonOpen = ref(false)
const chipRoot = ref<HTMLElement | null>(null)
function onDocDown(e: MouseEvent) {
  if (!reasonOpen.value) return
  if (chipRoot.value && !chipRoot.value.contains(e.target as Node)) reasonOpen.value = false
}
function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape' || !reasonOpen.value) return
  e.stopPropagation()
  reasonOpen.value = false
}
watch(reasonOpen, (v) => {
  if (v) {
    document.addEventListener('mousedown', onDocDown, true)
    document.addEventListener('keydown', onKey, true)
  } else {
    document.removeEventListener('mousedown', onDocDown, true)
    document.removeEventListener('keydown', onKey, true)
  }
})
// 重新交审后 chip 自己消失(status 翻回 submitted),浮层要跟着关 —— 否则它挂在一个已经不存在的 chip 上
watch(returned, (r) => { if (!r) reasonOpen.value = false })
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocDown, true)
  document.removeEventListener('keydown', onKey, true)
})
</script>

<template>
  <!-- 不套外层 div:宿主的工具行本来就是 flex + gap,多一层容器会让这几颗按钮的间距与旁边的不一样。 -->
  <template v-if="show">
    <!-- 已退回的红 chip(§04)。常驻在动作位左边,点开是完整理由 + 谁 + 什么时候。
         不用横幅(顶版)、不用 toast(会消失)—— 这句话人要边改边看几分钟。 -->
    <span v-if="returned" ref="chipRoot" class="rva-chipwrap">
      <button type="button" class="rva-chip" :class="{ on: reasonOpen }"
              :aria-expanded="reasonOpen" @click="reasonOpen = !reasonOpen">
        <component :is="iconFor('rotate-ccw')" :size="13" />{{ chipText }}
      </button>
      <div v-if="reasonOpen" class="rva-pop">
        <div class="rva-pop-h">{{ returned.reviewedBy ?? '审核员' }}{{ returnedAt ? ' · ' + returnedAt : '' }} 退回</div>
        <p class="rva-pop-b">{{ returned.reason || '（没有写理由）' }}</p>
      </div>
    </span>

    <!-- 编辑态里动作按钮一颗不画(chip 在上面,故意留在外面)—— 理由见 script 里 `edit` 那段:
         交审交的是库里那一份,而编辑态手上是没保存的草稿。 -->
    <template v-if="!edit">
      <!-- 交审永远可点:「录完了没有」的判据在后端 isDone(),前端重算一份必漂移(铁律 7)。
           没录完时后端回 409,原样弹给他。 -->
      <Button v-if="toSubmit.length" variant="filled" size="sm" :disabled="acting"
              @click="confirming = true">
        <template #leading><component :is="iconFor('upload')" :size="14" /></template>
        {{ submitText }}
      </Button>
      <Button v-if="toRecall.length" variant="outline" size="sm" :disabled="acting" @click="onRecall">
        <template #leading><component :is="iconFor('rotate-ccw')" :size="14" /></template>
        {{ actText('撤回', toRecall) }}
      </Button>
      <!-- 「通过」同样不预判上游前置:上游没审完时后端 409,弹「上游还没审完：计费参数」。 -->
      <Button v-if="toApprove.length" variant="filled" size="sm" :disabled="acting" @click="onApprove">
        <template #leading><component :is="iconFor('check')" :size="14" /></template>
        {{ actText('通过', toApprove) }}
      </Button>
      <Button v-if="toApprove.length" variant="danger" size="sm" :disabled="acting" @click="dlg = 'return'">
        {{ actText('退回', toApprove) }}
      </Button>
      <Button v-if="toWithdraw.length" variant="danger" size="sm" :disabled="acting" @click="dlg = 'withdraw'">
        <template #leading><component :is="iconFor('rotate-ccw')" :size="14" /></template>
        {{ actText('撤销审核', toWithdraw) }}
      </Button>
    </template>

    <!-- D1 交审确认(§07-①)。清单屏的「交审」不确认 —— 那是一屏专门做审核的地方,人是奔着交审去的;
         而这颗紧挨着「编辑模式」,误点的代价是把自己锁在外面。撤回做了之后这张卡仍然留着:
         误交出去会惊动审核员,让他白核对一遍。 -->
    <Teleport to="body">
      <div v-if="confirming" class="rva-scrim" role="dialog" aria-modal="true"
           @mousedown.self="confirming = false">
        <div class="rva-card">
          <h3 class="rva-title">交审：{{ label }}</h3>
          <p class="rva-hint">{{ confirmHint }}</p>
          <div class="rva-foot">
            <Button variant="outline" size="sm" @click="confirming = false">取消</Button>
            <Button variant="filled" size="sm" :disabled="acting" @click="doSubmit">交审</Button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- D2 退回 / 撤销:直接复用清单屏那张卡(理由必填 ≤255 的校验只此一份)。 -->
    <FPReviewDialog :target="dlg ? label : null" :action="dlg ?? 'return'" :busy="acting"
                    @close="dlg = null" @confirm="onDialogConfirm" />
  </template>
</template>

<style scoped>
/* chip 逐项对齐 ds/Button 的 size="sm"(height 28 / padding 0 12px / fs-label / radius-full)——
   数字不是拍的,见 Button.vue 的 SIZES.sm。与 FPEditModeButton 的审核药丸同一份。 */
.rva-chipwrap { position: relative; display: inline-flex; flex: none; }
.rva-chip {
  height: 28px; padding: 0 12px; box-sizing: border-box;
  display: inline-flex; align-items: center; gap: 6px;
  border: 1px solid var(--hue-red); border-radius: var(--radius-full);
  background: var(--surface-white); color: var(--hue-red);
  font-family: inherit; font-size: var(--fs-label); line-height: 1; white-space: nowrap; cursor: pointer;
}
.rva-chip:hover, .rva-chip.on { background: rgb(253, 240, 240); }
.rva-pop {
  position: absolute; top: calc(100% + 4px); left: 0; z-index: var(--z-popover);
  width: 320px; padding: 10px 12px;
  background: var(--surface-white); border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md); box-shadow: var(--shadow-pop);
  text-align: left; white-space: normal;
}
.rva-pop-h { font-size: var(--fs-micro); color: var(--text-muted); margin-bottom: 6px; }
.rva-pop-b { margin: 0; font-size: var(--fs-label); color: var(--text-primary); line-height: 1.6; }

/* 确认卡:与 FPReviewDialog 同一套尺寸/阴影,只是没有输入框(DESIGN-FIDELITY §七 居中弹卡)。 */
.rva-scrim { position: fixed; inset: 0; z-index: var(--z-confirm); background: rgba(28, 28, 28, .34);
             display: grid; place-items: center; }
.rva-card { width: min(432px, 92vw); padding: 20px; box-sizing: border-box;
            background: var(--surface-white); border-radius: var(--radius-xl);
            box-shadow: 0 18px 52px rgba(28, 28, 28, .24); font-family: var(--font-sans); }
.rva-title { margin: 0; font-size: var(--fs-h3); font-weight: var(--fw-semibold); color: var(--text-primary); }
.rva-hint { margin: 8px 0 0; font-size: var(--fs-label); color: var(--text-secondary); line-height: 1.6; }
.rva-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
</style>

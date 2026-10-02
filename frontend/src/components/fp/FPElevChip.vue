<script setup lang="ts">
// 临时授权胶囊 + 授权卡片(ELEVATION-SPEC §4.5,画布 08 ElevChip / ElevStates)。
// 原来是 App.vue 顶上一条 fixed 满宽横条(盖在页签条上),2026-10-03 换成这一枚:
//   bar    桌面顶栏右区(✦ 与铃铛之间)28 高蓝描边胶囊:钥匙 + 剩余 m:ss,多份时尾部带份数
//   mobile 手机顶栏只留钥匙圆钮;卡片贴顶栏下占满宽,时间写在卡里
//   dialog 系数簿 / 收款簿 / 催缴单明细弹窗标题旁同一枚(遮罩盖住了顶栏)
// 点开贴着胶囊弹卡片,页面不变暗;点外面、Esc 收起。最后 1 分钟胶囊和卡里的钥匙、时间变橙。
// 卡片挂 body + fixed(同 NotifyPanel):顶栏带 backdrop-filter 自成层叠上下文,留在里面会被内容区的 sticky 表头压住。
// 层级取 --z-modal-2:弹窗头上那一枚点开时要盖得住弹窗。
import { computed, onUnmounted, ref, watch, type CSSProperties } from 'vue'
import { KeyRound } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { ask } from '@/utils/ask'
import { fpBuildRoutes } from '@/nav/fpNav'
import { LAST_MIN_MS, fmtLeft, grantBatches, hhmm } from '@/utils/elevation'
import Avatar from '@/components/ds/Avatar.vue'
import Badge from '@/components/ds/Badge.vue'
import Button from '@/components/ds/Button.vue'

const props = withDefaults(defineProps<{ variant?: 'bar' | 'mobile' | 'dialog' }>(), { variant: 'bar' })

const auth = useAuthStore()
const batches = computed(() => grantBatches(auth.grants))
const one = computed(() => (batches.value.length === 1 ? batches.value[0] : null))
const warn = computed(() => auth.elevationLeftMs > 0 && auth.elevationLeftMs <= LAST_MIN_MS)
const leftOf = (expiresAt: number) => expiresAt - auth.nowMs
/** 「两份一起结束」:2 写汉字,和稿一样;更多写数字 */
const nText = computed(() => (batches.value.length === 2 ? '两份' : `${batches.value.length} 份`))

// ── 开合 ──
const open = ref(false)
const root = ref<HTMLElement | null>(null)
const card = ref<HTMLElement | null>(null)
const pos = ref<CSSProperties>({})
const EDGE = 8
/** 顶栏:上沿 = 顶栏下沿 +6,右沿对齐胶囊右沿(稿 ElevChip)。弹窗头:胶囊下沿 +8,左沿对齐胶囊 —— 胶囊贴着标题在弹窗左边,
 *  右对齐会伸出弹窗外。放不下换另一边,再夹在屏内 */
function place() {
  const el = root.value
  if (!el || props.variant === 'mobile') { pos.value = {}; return }
  const r = el.getBoundingClientRect()
  const bar = props.variant === 'bar'
  const top = bar ? (el.closest('header') ?? el).getBoundingClientRect().bottom + 6 : r.bottom + 8
  const vw = window.innerWidth
  const w = Math.min(420, vw - 2 * EDGE)
  let x = bar ? r.right - w : r.left
  if (bar && x < EDGE) x = r.left
  if (!bar && x + w > vw - EDGE) x = r.right - w
  pos.value = { top: `${top}px`, left: `${Math.max(EDGE, Math.min(x, vw - EDGE - w))}px` }
}
// 挂 capture:弹窗容器有 @mousedown.stop,冒泡阶段收不到(ds/Popover 同一条理由)。按在胶囊上不算外面,交给 click 开合
function onDoc(e: MouseEvent) {
  const t = e.target as Node
  if (!root.value?.contains(t) && !card.value?.contains(t)) open.value = false
}
function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  e.stopPropagation()   // 只收卡片:底下的弹窗也听 Esc
  open.value = false
}
function unlisten() {
  document.removeEventListener('mousedown', onDoc, true)
  document.removeEventListener('keydown', onKey, true)
  window.removeEventListener('resize', place)
}
watch(open, (o) => {
  if (!o) return unlisten()
  place()
  document.addEventListener('mousedown', onDoc, true)
  document.addEventListener('keydown', onKey, true)
  window.addEventListener('resize', place)
})
// 授权没了(到期 / 结束 / 完成)胶囊整个不在,下次再有授权时不该一出来就开着
watch(() => auth.grants.length, (n) => { if (!n) open.value = false })
onUnmounted(unlisten)

// ── 结束授权:有没保存的改动先问(画布 08「结束前先问」) ──
const ROUTES = fpBuildRoutes()
async function endNow() {
  open.value = false
  const ds = auth.dirtyScreens()
  if (ds.length) {
    const who = ds.map((d) => ROUTES[d.screen]?.page || '这页').join('、') + (ds.length > 1 ? '共' : '')
    const n = ds.reduce((a, d) => a + d.count, 0)
    const body = ds.some((d) => d.approx)
      ? `${who}有改动还没保存。结束授权会退出编辑，这些改动不会保存。`
      : `${who}有 ${n} 处改动还没保存。结束授权会退出编辑，这 ${n} 处改动不会保存。`
    if (!(await ask({ title: '结束授权？', body, action: '放弃改动并结束授权', cancel: '继续编辑', danger: true }))) return
  }
  void auth.endElevation(true)
}
</script>

<template>
  <span v-if="auth.grants.length" ref="root" class="ec" :class="`ec-${props.variant}`">
    <button v-if="props.variant === 'mobile'" type="button" class="ec-mbtn" aria-label="临时授权"
            aria-haspopup="dialog" :aria-expanded="open" @click="open = !open">
      <span class="ec-dot" :class="{ warn }"><KeyRound :size="14" /></span>
    </button>
    <button v-else type="button" class="ec-chip" :class="{ warn }" aria-label="临时授权"
            aria-haspopup="dialog" :aria-expanded="open" @click="open = !open">
      <KeyRound :size="props.variant === 'dialog' ? 11 : 12" />
      <span class="ec-t">{{ fmtLeft(auth.elevationLeftMs) }}</span>
      <span v-if="batches.length > 1" class="ec-n">{{ batches.length }}</span>
    </button>

    <Teleport to="body">
      <div v-if="open" ref="card" class="ec-card" :class="{ 'ec-card-m': props.variant === 'mobile' }"
           :style="pos" role="dialog" aria-label="临时授权">
        <div class="ec-h">
          <span class="ec-ic" :class="{ warn }"><KeyRound :size="15" /></span>
          <b class="ec-title">临时授权<template v-if="!one"> · {{ batches.length }} 份</template></b>
          <span class="ec-left" :class="{ warn }">
            <small>{{ one ? '剩余' : '先到期的剩' }}</small><b>{{ fmtLeft(auth.elevationLeftMs) }}</b>
          </span>
        </div>

        <!-- 一份 -->
        <template v-if="one">
          <!-- 最后 1 分钟只剩卡头和卡底(画布 08「最后 1 分钟 · 卡片」) -->
          <div v-if="!warn" class="ec-b">
            <dl class="ec-kv">
              <dt>授权人</dt>
              <dd><Avatar class="ec-av" :name="one.authorizerName" :uid="one.authorizer" :size="22" />{{ one.authorizerName }}<span v-if="one.remote" class="ec-mute">远程批准</span></dd>
              <dt>可修改</dt>
              <dd>
                <Badge v-for="l in one.labels" :key="l" tone="blue" :dot="false" class="ec-tag">{{ l }}</Badge>
                <span v-if="props.variant !== 'mobile'" class="ec-mute">所有页面都能改</span>
              </dd>
              <dt>时间</dt>
              <dd class="ec-time">
                <b>{{ hhmm(one.grantedAt) }}</b>{{ one.remote ? '批准' : '授权' }}<span class="ec-arw">→</span><b>{{ hhmm(one.expiresAt) }}</b>到期
              </dd>
            </dl>
            <!-- 稿上是「期间的每一次修改，操作日志里都会同时记下你和{授权人}的名字」—— 不成立:授权人只落在计费参数改动和
                 auth_audit_log 两处,台账格、抄表读数这类写入根本不进操作日志。成立的是授权本身那条(elevate.grant,带授权人) -->
            <p v-if="props.variant !== 'mobile'" class="ec-note">这次授权已记进操作日志，写明由{{ one.authorizerName }}授权。</p>
          </div>
          <div class="ec-f">
            <p v-if="warn">到期后，用到这份授权的页面会退出编辑</p>
            <p v-else-if="props.variant === 'mobile'">结束后，用到它的页面会退出编辑</p>
            <p v-else>结束后，用到这份授权的页面会退出编辑<br>点「完成」退出最后一个编辑页时，授权一并结束</p>
            <Button variant="outline" size="sm" @click="endNow">结束授权</Button>
          </div>
        </template>

        <!-- 多份:每份一行 -->
        <template v-else>
          <div class="ec-rows">
            <div v-for="b in batches" :key="b.key" class="ec-row">
              <Badge v-for="l in b.labels" :key="l" tone="blue" :dot="false" class="ec-tag">{{ l }}</Badge>
              <Avatar class="ec-av" :name="b.authorizerName" :uid="b.authorizer" :size="22" />
              <span class="ec-who">{{ b.authorizerName }}</span>
              <span class="ec-exp"><b>{{ hhmm(b.expiresAt) }}</b>到期</span>
              <b class="ec-cd" :class="{ warn: leftOf(b.expiresAt) <= LAST_MIN_MS }">{{ fmtLeft(leftOf(b.expiresAt)) }}</b>
            </div>
            <p class="ec-note">哪一份到期，用到它的页面就退出编辑。</p>
          </div>
          <div class="ec-f">
            <p>{{ nText }}一起结束</p>
            <Button variant="outline" size="sm" @click="endNow">结束授权</Button>
          </div>
        </template>
      </div>
    </Teleport>
  </span>
</template>

<style scoped>
.ec { position: relative; display: inline-flex; flex: none; }

/* 胶囊:28 高、和按钮同高(FPAlertChip 同尺寸);蓝描边 + 浅蓝底,最后 1 分钟换橙 */
.ec-chip {
  display: inline-flex; align-items: center; gap: 5px;
  height: 28px; padding: 0 10px;
  border: 1px solid var(--hue-blue); border-radius: var(--radius-full);
  background: var(--info-soft); color: var(--hue-blue);
  font-family: var(--font-mono); font-size: var(--fs-label); font-weight: var(--fw-semibold);
  font-variant-numeric: tabular-nums; white-space: nowrap;
  cursor: pointer;
  transition: background var(--dur-fast), border-color var(--dur-fast), color var(--dur-fast);
}
.ec-chip:hover { background: color-mix(in srgb, var(--info-soft), var(--hue-blue) 8%); }
.ec-chip.warn { border-color: var(--status-warning); background: var(--warn-soft); color: var(--status-warning); }
.ec-chip.warn:hover { background: color-mix(in srgb, var(--warn-soft), var(--hue-orange) 8%); }
.ec-n { margin-left: 3px; font-size: var(--fs-micro); }
/* 弹窗标题旁:22 高,不撑高标题行(h3 16px) */
.ec-dialog .ec-chip { height: 22px; padding: 0 8px; gap: 4px; font-size: var(--fs-micro); }

/* 手机:44×44 触达里一颗 28 的钥匙圆钮(与 MobileTopBar .mtb-btn 同尺寸) */
.ec-mbtn {
  width: 44px; height: 44px; padding: 0;
  border: none; border-radius: var(--radius-md); background: transparent;
  display: grid; place-items: center; cursor: pointer;
}
.ec-dot {
  width: 28px; height: 28px; box-sizing: border-box; border-radius: var(--radius-full);
  display: grid; place-items: center;
  border: 1px solid var(--hue-blue); background: var(--info-soft); color: var(--hue-blue);
}
.ec-dot.warn { border-color: var(--status-warning); background: var(--warn-soft); color: var(--status-warning); }

/* 卡片:贴附浮层(NotifyPanel / FPAlertPanel 同一套面、边、影、入场) */
.ec-card {
  position: fixed; z-index: var(--z-modal-2);
  box-sizing: border-box; width: 420px; max-width: calc(100vw - 16px);
  background: var(--surface-raised);
  border: 1px solid var(--border-subtle); border-radius: var(--radius-md);
  box-shadow: var(--shadow-pop);
  font-family: var(--font-sans); text-align: left;
  animation: fp-pop-in var(--dur-fast) var(--ease-out);
}
/* 手机:贴顶栏下方占满宽(与 NotifyPanel .np-m 同一个数:顶栏 52 + 刘海) */
.ec-card-m {
  top: calc(52px + env(safe-area-inset-top)); left: 0; right: 0;
  width: auto; max-width: none;
  border-width: 0 0 1px; border-radius: 0 0 var(--radius-md) var(--radius-md);
}

.ec-h { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--divider); }
.ec-ic {
  flex: none; width: 28px; height: 28px; border-radius: var(--radius-sm);
  display: grid; place-items: center;
  background: var(--info-soft); color: var(--hue-blue);
}
.ec-ic.warn { background: var(--warn-soft); color: var(--status-warning); }
.ec-title { flex: 1; min-width: 0; font-size: var(--fs-body); font-weight: var(--fw-semibold); color: var(--text-primary); }
.ec-left { display: inline-flex; align-items: baseline; gap: 6px; color: var(--text-primary); white-space: nowrap; }
.ec-left small { font-size: var(--fs-label); color: var(--text-muted); }
.ec-left b { font-family: var(--font-mono); font-size: var(--fs-h3); font-weight: var(--fw-semibold); font-variant-numeric: tabular-nums; }
.ec-left.warn b { color: var(--status-warning); }

.ec-b { padding: 12px 16px; }
.ec-kv { display: grid; grid-template-columns: 76px 1fr; align-items: center; row-gap: 10px; margin: 0; }
.ec-kv dt { font-size: var(--fs-label); color: var(--text-muted); }
.ec-kv dd { margin: 0; min-width: 0; display: flex; align-items: center; flex-wrap: wrap; gap: 8px; font-size: var(--fs-body); color: var(--text-primary); }
/* ds/Avatar 的圆角、字号写在内联样式里,只能 !important 盖(NotifyPanel .np-av 同款) */
.ec-av { border-radius: var(--radius-xs) !important; font-size: var(--fs-micro) !important; }
.ec-tag { height: 20px !important; padding: 0 6px !important; }
.ec-mute { font-size: var(--fs-label); color: var(--text-muted); }
.ec-kv dd.ec-time { gap: 6px; }
.ec-time b, .ec-exp b { font-family: var(--font-mono); font-weight: var(--fw-medium); font-variant-numeric: tabular-nums; }
.ec-arw { margin: 0 6px; color: var(--text-muted); }
.ec-note { margin: 10px 0 0; font-size: var(--fs-label); line-height: 18px; color: var(--text-secondary); }

.ec-rows { padding: 4px 16px 12px; }
.ec-row { display: flex; align-items: center; gap: 8px; padding: 10px 0; border-bottom: 1px solid var(--divider); }
.ec-who { flex: 1; min-width: 0; font-size: var(--fs-label); color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ec-exp { display: inline-flex; gap: 6px; font-size: var(--fs-label); color: var(--text-muted); white-space: nowrap; }
.ec-cd { min-width: 44px; text-align: right; font-family: var(--font-mono); font-size: var(--fs-body); font-weight: var(--fw-semibold); font-variant-numeric: tabular-nums; color: var(--text-primary); }
.ec-cd.warn { color: var(--status-warning); }

.ec-f { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-top: 1px solid var(--divider); }
.ec-f p { flex: 1; min-width: 0; margin: 0; font-size: var(--fs-label); line-height: 18px; color: var(--text-muted); }
</style>

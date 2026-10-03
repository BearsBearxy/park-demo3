<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { shellOf, staleShellNames } from '@/composables/useTabShells'
import { useRoute } from 'vue-router'
import { useTabsStore } from '@/stores/tabs'
import { useAuthStore } from '@/stores/auth'
import { usePresenceStore } from '@/stores/presence'
import { useUiStore } from '@/stores/ui'
import { sessionState } from '@/api'
import { receipt, receipts } from '@/utils/receipt'
import { grantBatches, LAST_MIN_MS } from '@/utils/elevation'
import AppShell from './components/shell/AppShell.vue'
import FPEvictedDialog from '@/components/fp/FPEvictedDialog.vue'
import Button from '@/components/ds/Button.vue'
import { iconFor } from '@/components/ds/icon'

const route = useRoute()
const tabs = useTabsStore()
const auth = useAuthStore()
// 自带整屏布局、不进外壳的两页:登录 + 强制改密
// (改密是强制态,外壳的侧边栏点哪儿都被守卫弹回来,给了反而像页面坏了)
const isBare = computed(() => route.path === '/login' || route.path === '/change-password')
// 路由 value = tab value:path 恒为 '/'+value(router/index.ts)
const routeValue = computed(() => route.path.slice(1))
// KeepAlive 按页签卸载:关掉 / 重新加载的页签当场卸掉旧实例(composables/useTabShells.ts)
const staleShells = computed(() => staleShellNames(tabs.epoch))
// 模板里拿不到全局 location,显式暴露
const reload = () => window.location.reload()
// 哪一种漂移:别人登了,还是别处登出了。两句话,按钮都是「刷新」。
const driftKind = computed(() => sessionState())
// 弹窗一出来焦点就落在「刷新」上:它是这一页唯一还能做的事
const driftEl = ref<HTMLElement | null>(null)
watch(() => auth.drifted, async (d) => {
  if (!d) return
  await nextTick()
  driftEl.value?.querySelector('button')?.focus()
})

// ── 临时授权(ELEVATION-SPEC) ──
// 胶囊和卡片在顶栏(components/fp/FPElevChip,2026-10-03 起替掉这里原来那条 fixed 满宽横条);这里只管取回授权和几句回执。
// 刷新页面后授权在服务端还活着(30 分钟内存态),顶栏胶囊要跟着回来 ——
// 否则用户以为授权没了,又去叫一次主管。
// refreshMe:管理员改了我的角色,铃铛说「刷新后生效」,刷新了就得真的生效(06-E)
onMounted(() => { void auth.refreshElevation(); void auth.refreshMe() })

// ── 当场出现、不进铃铛(PAGE-BEHAVIOR-SPEC §5.2,画布 06-E) ──
const presence = usePresenceStore()
const ui = useUiStore()
/**
 * 临时授权到期 / 被提前收回时底部那一句(画布 08 ElevStates,EDIT-MODE §6.2 三句分开写)。
 * 靠这份授权编辑的屏会因权限不齐当场退出编辑(useEditMode / useEditLock 的守卫)。
 * 「已退出编辑」只在**确实有屏退出了**时说:人在别的屏用自己的权限编辑,授权到期那张表什么都没退,
 * 照 auth.editing 判就成了假话(EDIT-MODE §6.2「编辑中」指靠这份授权编辑的那一屏)。
 * 所以比到期前后登记的编辑器个数:前一个在守卫跑之前数,后一个在守卫跑完之后数。
 */
const exitedSince = (editorsBefore: number) => (auth.editorCount < editorsBefore ? '，已退出编辑' : '')
// 按时到期:授权掉出有效期。自己点「完成」「结束授权」、退出登录清掉的,到期时刻还没到,不说 —— 「完成」后胶囊消失、不出回执。
// 全到期说「授权已到期」;多份里先到期一份说「「权限名」的授权已到期」,别的份还在。
// 两拍:sync 那个在到期的同一刻(各屏 pre 级守卫还没跑)记下编辑器个数;post 那个等这一轮守卫都跑完再比、再说。
// 只在真到期时记 —— 守卫退出编辑后 endElevation() 会再清一次 grants,那一下没有到期的项,不会把记下的冲掉。
let expired: { labels: string[]; all: boolean; editors: number } | null = null
watch(() => auth.grants, (now, before) => {
  const gone = before.filter((g) => g.expiresAt <= Date.now() && !now.includes(g))
  if (gone.length) expired = { labels: [...new Set(gone.map((g) => g.permLabel))], all: !now.length, editors: auth.editorCount }
}, { flush: 'sync' })
watch(() => auth.grants, () => {
  if (!expired) return
  receipt.warn((expired.all ? '授权已到期' : `「${expired.labels.join('、')}」的授权已到期`) + exitedSince(expired.editors))
  expired = null
}, { flush: 'post' })
// 被系统提前收回:心跳从「还在」跳成「没了」,本页却还握着授权 → 清掉、说一句,各屏随之退出编辑。
// 只认 true → false 这一跳:刚拿到授权时,在途的那一拍是授权之前发的,会带回 false,那不是收回。
// 这个回调本身跑在 pre 队列里:nextTick 等的是这一轮 flush 跑完,清授权触发的各屏守卫也在这一轮里。
watch(() => presence.elevated, (now, before) => {
  if (now !== false || before !== true || !auth.grants.length) return
  const n = auth.editorCount
  void auth.endElevation(true)
  void nextTick(() => receipt.warn('授权提前失效了' + exitedSince(n)))
})
// 最后 1 分钟:每份授权进最后 1 分钟时说一次「授权还剩 1 分钟」(警告回执本就不自收)。
// 没有哪份在最后 1 分钟了(到期了 / 结束了 / 点了完成)就把它收掉 —— 留着就成了假话。
const LAST_MIN_TEXT = '授权还剩 1 分钟'
const warnedLastMin = new Set<string>()
watch(() => grantBatches(auth.grants).filter((b) => b.expiresAt - auth.nowMs <= LAST_MIN_MS).map((b) => b.key), (keys) => {
  if (!keys.length) {
    warnedLastMin.clear()
    const r = receipts.find((x) => x.text === LAST_MIN_TEXT)
    if (r) receipt.dismiss(r.id)
    return
  }
  if (keys.some((k) => !warnedLastMin.has(k))) receipt.warn(LAST_MIN_TEXT)
  keys.forEach((k) => warnedLastMin.add(k))
})
// 远程授权批下来时,请求者的弹窗可能已经关了(06-E「弹窗关着时批下来,本页不知道」):
// 没人认领这次结果,横幅和写入口就都不知道。这里补拉一次;弹窗开着时它自己也拉,多拉一次无妨。
watch(() => presence.outcome, (o) => { if (o?.approved) void auth.refreshElevation() })
</script>

<template>
  <!-- 跨标签页身份漂移。api 层已经拒发请求，这里让用户看见发生了什么。
       刻意**不自动刷新** —— CONCURRENCY-SPEC 铁律「永远不刷新用户正在编辑的表格」，
       未保存的草稿得留给用户自己处置。

       2026-09-12:文案按**实测到的那一种**分开写。改前只有一句「已在别的标签页登录为
       另一个账号」,而触发它的三种情况里有两种不是那回事 —— 别的标签页**登出**也会触发,
       用户看到的是一句假话。屏上只陈述实测,不替用户断定原因。

       2026-10-01 用户拍板(画布 06-E):顶部红色满宽横幅换成居中弹窗,只有「刷新」。
       点外面、Esc 都不关(UI-OVERLAY-SPEC §3.5 例外)—— 这时本页请求都发不出去,关掉只剩一页死界面。
       所以遮罩上**不挂** mousedown、也不听 Esc。 -->
  <div v-if="auth.drifted" class="app-dlg-scrim">
    <div ref="driftEl" class="app-dlg" role="alertdialog" aria-modal="true" aria-labelledby="app-dlg-t" aria-describedby="app-dlg-d">
      <div class="app-dlg-h">
        <span class="app-dlg-ic"><component :is="iconFor('alert-triangle')" :size="16" /></span>
        <h3 id="app-dlg-t">{{ driftKind === 'signed-out' ? '此浏览器已在别的标签页退出登录' : '此浏览器已在别的标签页登录为另一个账号' }}</h3>
      </div>
      <p v-if="driftKind === 'signed-out'" id="app-dlg-d" class="app-dlg-b">本页还停在登录后的界面，操作已被拦下。刷新后回到登录页。</p>
      <p v-else id="app-dlg-d" class="app-dlg-b">本页显示的还是上一个身份，操作已被拦下 —— 否则做的事会记在对方头上。刷新后换成当前账号。</p>
      <div class="app-dlg-f">
        <Button variant="filled" @click="reload">刷新</Button>
      </div>
    </div>
  </div>

  <!-- 正在编辑的表被别人交审 / 审核通过(06-E 当场出现组):各屏退出编辑前报到 ui.editStop,全站一个弹窗说谁做的 -->
  <FPEvictedDialog :eviction="null" :review="ui.editStop" @close="ui.editStop = null" />

  <!-- /login 与 /change-password 各自拥有整屏布局 -->
  <router-view v-if="isBare" />
  <!-- all other routes render inside the two-card shell -->
  <!-- KeepAlive per tab:key = value:epoch。TabStrip 点击=命中缓存,恢复浏览状态;
       openFresh(核对跳转/关闭重开/换层)递增 epoch → key 变 → 全新实例走 onMounted。
       共用同一组件的兄弟路由(充电桩汽车/电动车)value 不同 → key 天然不同,切换必重建,原「陈旧数据」防线不回归
       不设 max:缓存里只有开着的页签(关掉 / 换掉的屏按纪元 exclude 当场卸载,useTabShells),
       同一屏只开一份,上限就是全站屏数。设 max 的话它会按最久没看挤掉页签 —— 连正在编辑的也挤(TAB-BAR-SPEC §1)。 -->
  <AppShell v-else>
    <router-view v-slot="{ Component }">
      <keep-alive :exclude="staleShells">
        <component
          :is="Component && shellOf(routeValue + ':' + tabs.epochOf(routeValue), Component)"
          :key="routeValue + ':' + tabs.epochOf(routeValue)"
        />
      </keep-alive>
    </router-view>
  </AppShell>
</template>

<style>
/* 身份漂移弹窗:形态同 FPEvictedDialog(居中卡片 + 遮罩)。z 照原横幅 9999,盖住一切弹窗 */
.app-dlg-scrim {
  position: fixed; inset: 0; z-index: 9999;
  display: grid; place-items: center;
  background: var(--scrim);
  opacity: 0; animation: fp-fade-in var(--dur-base) var(--ease-out) forwards;
}
.app-dlg {
  width: min(432px, 92vw); box-sizing: border-box;
  background: var(--surface-raised); border-radius: var(--radius-xl); box-shadow: var(--shadow-dialog);
  font-family: var(--font-sans);
  animation: fp-rise-in var(--dur-base) var(--ease-out) both;
}
.app-dlg-h { display: flex; align-items: center; gap: 9px; padding: 20px 22px 0; }
.app-dlg-h h3 { margin: 0; font-size: var(--fs-h3); font-weight: var(--fw-semibold); color: var(--text-primary); }
.app-dlg-ic {
  width: 30px; height: 30px; flex: 0 0 auto; border-radius: 50%;
  display: grid; place-items: center;
  background: var(--danger-soft); color: var(--hue-red);
}
.app-dlg-b { margin: 0; padding: 14px 22px 4px; font-size: 13.5px; line-height: 1.65; color: var(--text-primary); }
.app-dlg-f { display: flex; justify-content: flex-end; padding: 16px 22px 20px; }

#app {
  width: 100%;
  height: 100%;
}
</style>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useTabsStore } from '@/stores/tabs'
import { useAuthStore } from '@/stores/auth'
import AppShell from './components/shell/AppShell.vue'

const route = useRoute()
const tabs = useTabsStore()
const auth = useAuthStore()
// 自带整屏布局、不进外壳的两页:登录 + 强制改密
// (改密是强制态,外壳的侧边栏点哪儿都被守卫弹回来,给了反而像页面坏了)
const isBare = computed(() => route.path === '/login' || route.path === '/change-password')
// 路由 value = tab value:path 恒为 '/'+value(router/index.ts)
const routeValue = computed(() => route.path.slice(1))
// 模板里拿不到全局 location,显式暴露
const reload = () => window.location.reload()

// ── 提权横幅(ELEVATION-SPEC) ──
// 刷新页面后授权在服务端还活着(30 分钟内存态),横幅要跟着回来 ——
// 否则用户以为授权没了,又去叫一次主管。
onMounted(() => { void auth.refreshElevation() })
const elevMin = computed(() => Math.floor(auth.elevationLeftMs / 60000))
const elevSec = computed(() => Math.floor((auth.elevationLeftMs % 60000) / 1000))
const elevBy = computed(() => [...new Set(auth.grants.map((g) => g.authorizerName))].join('、'))
const elevWhat = computed(() => auth.grants.map((g) => g.permLabel).join('、'))
</script>

<template>
  <!-- 跨标签页身份漂移：别的标签页登了另一个账号（localStorage 按域名共享、不分标签页），
       本页界面还是旧身份。api 层已经拒发请求，这里让用户看见发生了什么。
       刻意**不自动刷新** —— CONCURRENCY-SPEC 铁律「永远不刷新用户正在编辑的表格」，
       未保存的草稿得留给用户自己处置。 -->
  <div v-if="auth.drifted" class="app-drift" role="alert">
    <span class="app-drift-t">此浏览器已在别的标签页登录为另一个账号</span>
    <span class="app-drift-d">本页显示的还是上一个身份，操作已被拦下 —— 否则做的事会记在对方头上。</span>
    <button type="button" class="app-drift-b" @click="reload">重新载入</button>
  </div>

  <!-- 提权横幅：授权期间必须一直看得见 —— 谁授权的、还剩多久、怎么提前结束。
       没有它,用户不知道自己正握着一份别人担责的权限。 -->
  <div v-if="auth.elevationLeftMs > 0" class="app-elev" role="status">
    <span class="app-elev-t">由 {{ elevBy }} 授权</span>
    <span class="app-elev-d">可修改：{{ elevWhat }}</span>
    <span class="app-elev-c">剩余 {{ elevMin }}:{{ String(elevSec).padStart(2, '0') }}</span>
    <button type="button" class="app-elev-b" @click="auth.endElevation(true)">结束授权</button>
  </div>

  <!-- /login 与 /change-password 各自拥有整屏布局 -->
  <router-view v-if="isBare" />
  <!-- all other routes render inside the two-card shell -->
  <!-- KeepAlive per tab:key = value:epoch。TabStrip 点击=命中缓存,恢复浏览状态;
       openFresh(侧边栏点击/核对跳转/关闭重开)递增 epoch → key 变 → 全新实例走 onMounted。
       共用同一组件的兄弟路由(充电桩汽车/电动车)value 不同 → key 天然不同,切换必重建,原「陈旧数据」防线不回归 -->
  <AppShell v-else>
    <router-view v-slot="{ Component }">
      <keep-alive :max="10">
        <component :is="Component" :key="routeValue + ':' + tabs.epochOf(routeValue)" />
      </keep-alive>
    </router-view>
  </AppShell>
</template>

<style>
/* 身份漂移横幅：固定在顶部盖住一切,它比任何页面内容都要紧 */
.app-drift {
  position: fixed; top: 0; left: 0; right: 0; z-index: 9999;
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  padding: 10px 18px; box-sizing: border-box;
  background: var(--warn-bg, #FAEDE7); border-bottom: 1px solid var(--hue-red);
  font-family: var(--font-sans); font-size: var(--fs-label);
}
.app-drift-t { font-weight: var(--fw-semibold); color: var(--hue-red); }
.app-drift-d { color: var(--text-secondary); }
.app-drift-b {
  margin-left: auto; border: 1px solid var(--hue-red); background: var(--surface-white);
  color: var(--hue-red); border-radius: var(--radius-full); padding: 4px 14px;
  font-family: var(--font-sans); font-size: var(--fs-label); cursor: pointer;
}
.app-drift-b:hover { background: var(--hue-red); color: #fff; }

/* 提权横幅：和漂移横幅同一层，但语气不同 —— 那个是出事了，这个是「你现在有一份临时权限」。
   用中性的蓝而不是警示色：它不是错误，只是一个必须一直看得见的状态。 */
.app-elev {
  position: fixed; top: 0; left: 0; right: 0; z-index: 9998;
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  padding: 8px 18px; box-sizing: border-box;
  background: var(--surface-subtle); border-bottom: 1px solid var(--hue-blue);
  font-family: var(--font-sans); font-size: var(--fs-label);
}
.app-elev-t { font-weight: var(--fw-semibold); color: var(--hue-blue); }
.app-elev-d { color: var(--text-secondary); }
.app-elev-c { color: var(--text-secondary); font-variant-numeric: tabular-nums; }
.app-elev-b {
  margin-left: auto; border: 1px solid var(--hue-blue); background: var(--surface-white);
  color: var(--hue-blue); border-radius: var(--radius-full); padding: 3px 14px;
  font-family: var(--font-sans); font-size: var(--fs-label); cursor: pointer;
}
.app-elev-b:hover { background: var(--hue-blue); color: var(--surface-white); }

#app {
  width: 100%;
  height: 100%;
}
</style>

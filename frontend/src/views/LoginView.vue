<script setup lang="ts">
// 登录页(2026-08-16 重设计):左暗右亮双栏 —— 左侧品牌区带两层 canvas 动效,右侧白卡表单。
// · 背景网格:全屏 canvas 画小方格阵,鼠标移过把附近方格「撑开」(径向位移+放大+提亮),
//   参考 deepseek.com/harness 的手法:桌面(pointer:fine)才挂鼠标,触屏只有微光呼吸。
// · 粒子 logo:把 factory-park-mark.svg 栅格化后按非透明像素采样成白色方点粒子,
//   进场自中心向外逐颗显影成型;悬停时鼠标影响圈内的粒子缓慢游走,移开后自动归位。
// · 整页入场由暗到亮(黑色遮罩淡出,见样式区 lg-dawn)。
// · prefers-reduced-motion:两层都只静态画一帧,不跑 rAF、不挂鼠标、遮罩不显示。
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { landingPath } from '@/nav/navAccess'
import { User as UserIcon, Lock, Eye, EyeOff, AlertCircle } from 'lucide-vue-next'
// 粒子 logo 素材:换 logo 直接替换这个 svg 文件(或改这里的 import 指向任意 png/svg)。
// 引擎按「alpha>140 的像素」采样、颜色取自像素本身,任何形状/配色都能直接成粒子。
import logoUrl from '@/assets/factory-park-mark.svg'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

const username = ref('')
const password = ref('')
const showPwd = ref(false)
const remember = ref(true)
const errorMsg = ref('')
const forgotHint = ref(false)
const loading = ref(false)
const unameEl = ref<HTMLInputElement | null>(null)

// 重新输入即清错(错误提示对应的是上一次提交,留着会误导)
watch([username, password], () => { errorMsg.value = '' })

async function submit() {
  if (!username.value.trim() || !password.value) {
    errorMsg.value = '请输入账号与密码'
    return
  }
  errorMsg.value = ''
  loading.value = true
  try {
    await auth.login({ username: username.value.trim(), password: password.value }, remember.value)
    // 强制改密优先于一切落点(含 redirect):初始密码没改掉之前哪儿都不该进
    if (auth.mustChangePassword) {
      router.push('/change-password')
      return
    }
    // 落地页按 navLayers 定(与 router 守卫共用 landingPath):园区股东看不到数据层,落驾驶舱
    const redirect = (route.query.redirect as string) || landingPath(auth.navLayers, auth.can('system:view'))
    router.push(redirect)
  } catch (e: any) {
    errorMsg.value = e?.msg || e?.message || '登录失败，请检查账号和密码'
  } finally {
    loading.value = false
  }
}

/* ============ canvas 动效 ============ */
/* ===== 手动调参区(存盘后 vite 热更新即时生效) ===== */
const TUNE = {
  /* --- 背景网格 --- */
  gridPush: 50,      // 方格被鼠标撑开的最大位移(px):越大弧度越夸张
  gridRadius: 300,   // 鼠标影响半径(px)
  gridFollow: 0.1,  // 力场跟手程度 0~1:1=完全跟手(停下即停);越小拖尾越长,停下后会有「回弹归位」感
  /* --- 粒子 logo --- */
  logoCount: 500,    // 粒子数量上限:引擎自动放大采样步长压到这个数以内
  logoAlpha: 0.45,   // 最亮一档粒子的透明度(三档按 1 / 0.72 / 0.45 递减)
  logoAgitate: 0.9,  // 圈内游走强度:鼠标影响圈内粒子被噪声推着缓慢漂移,越大动得越欢
  logoStir: 200,      // 鼠标搅动半径(px,画布内部坐标)
  logoDrift: 0.95,   // 惯性 0~1:越接近 1 动作越慢越飘(它同时决定进场归位的弹性)
  logoBob: 5,        // 水面漂浮:整个 logo 缓慢晃动的幅度(px),0=关
  logoBobSpeed: 1,   // 水面漂浮的速度倍率
  logoBloomHold: 800, // 进场:显影开始前的暗场停留 ms(与整页由暗到亮衔接)
  logoBloomMs: 1000,  // 显影窗口 ms:粒子在原位逐颗淡入,出生波前从中心向外扩散(对照视频的成型方式)
  logoBox: 500,      // logo 图案本身的大小(px):mark 自带留白,300 不会裁;要更大先放大 CSS .lg-plogo
}
const bgEl = ref<HTMLCanvasElement | null>(null)
const logoEl = ref<HTMLCanvasElement | null>(null)
let raf = 0
const cleanups: Array<() => void> = []

/** 背景:大节距网格线 + 交点小方块,鼠标把附近的线/交点「撑开」(线会平滑弯曲)。
 *  对照 deepseek.com/harness 实测:节距 ~100px、底近黑、线极淡、交点略亮。
 *  线不是直线段:每 25px 采样一次位移场再连线,鼠标推开时整条线鼓出弧形。 */
function initBg(el: HTMLCanvasElement | null, interactive: boolean) {
  const ctx = el?.getContext('2d')
  if (!el || !ctx) return null
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  let w = 0, h = 0, cols = 0, rows = 0, gap = 100
  let phases = new Float32Array(0)
  function layout() {
    w = window.innerWidth; h = window.innerHeight
    el!.width = Math.round(w * dpr); el!.height = Math.round(h * dpr)
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
    gap = Math.max(88, Math.min(120, w / 14)) // 大屏 ~100px 节距,窄屏不小于 88
    cols = Math.ceil(w / gap) + 1; rows = Math.ceil(h / gap) + 1
    phases = new Float32Array(cols * rows)
    // 每交点一个固定相位做呼吸闪烁;整数哈希代替 Math.random,resize 后同点同相位不跳变
    for (let i = 0; i < phases.length; i++) phases[i] = (((i * 2654435761) >>> 0) % 4096) / 4096 * Math.PI * 2
  }
  layout()
  let tx = -9e3, ty = -9e3, mx = tx, my = ty, str = 0, inside = false
  const onMove = (e: MouseEvent) => { tx = e.clientX; ty = e.clientY; inside = true }
  const onLeave = () => { inside = false }
  window.addEventListener('resize', layout)
  cleanups.push(() => window.removeEventListener('resize', layout))
  if (interactive) {
    window.addEventListener('mousemove', onMove, { passive: true })
    document.documentElement.addEventListener('mouseleave', onLeave)
    cleanups.push(() => {
      window.removeEventListener('mousemove', onMove)
      document.documentElement.removeEventListener('mouseleave', onLeave)
    })
  }
  const R = TUNE.gridRadius, R2 = R * R, PUSH = TUNE.gridPush, STEP = 25 // STEP=线的采样步长:够密才弯得平滑
  // 位移场:鼠标附近的点沿径向被推开,平方衰减
  function fx(x: number, y: number): number {
    if (str < 0.01) return x
    const dx = x - mx, dy = y - my, d2 = dx * dx + dy * dy
    if (d2 > R2) return x
    const d = Math.sqrt(d2) || 1
    return x + (dx / d) * (1 - d / R) ** 2 * str * PUSH
  }
  function fy(x: number, y: number): number {
    if (str < 0.01) return y
    const dx = x - mx, dy = y - my, d2 = dx * dx + dy * dy
    if (d2 > R2) return y
    const d = Math.sqrt(d2) || 1
    return y + (dy / d) * (1 - d / R) ** 2 * str * PUSH
  }
  function draw(t: number) {
    // 力场追踪:gridFollow 越接近 1 越跟手,鼠标停下后没有滞后的「回弹」动作
    mx += (tx - mx) * TUNE.gridFollow; my += (ty - my) * TUNE.gridFollow
    str += ((inside ? 1 : 0) - str) * 0.06
    ctx!.clearRect(0, 0, w, h)
    // 1) 网格线(横+竖),逐段过位移场
    ctx!.strokeStyle = 'rgba(126, 160, 215, 0.09)'
    ctx!.lineWidth = 1
    ctx!.beginPath()
    for (let j = 0; j < rows; j++) {
      const y = j * gap
      ctx!.moveTo(fx(0, y), fy(0, y))
      for (let x = STEP; x <= w + STEP; x += STEP) ctx!.lineTo(fx(x, y), fy(x, y))
    }
    for (let i = 0; i < cols; i++) {
      const x = i * gap
      ctx!.moveTo(fx(x, 0), fy(x, 0))
      for (let y = STEP; y <= h + STEP; y += STEP) ctx!.lineTo(fx(x, y), fy(x, y))
    }
    ctx!.stroke()
    // 2) 交点小方块:略亮于线,呼吸闪烁,近鼠标放大提亮
    ctx!.fillStyle = '#a4c4f0'
    const tw = t * 0.0009
    for (let j = 0; j < rows; j++) {
      const py = j * gap
      for (let i = 0; i < cols; i++) {
        const px = i * gap
        let a = 0.22 + Math.sin(tw + phases[j * cols + i]) * 0.07
        let s = 3
        if (str > 0.01) {
          const dx = px - mx, dy = py - my, d2 = dx * dx + dy * dy
          if (d2 < R2) {
            const f = (1 - Math.sqrt(d2) / R) ** 2 * str
            s += f * 2.5; a += f * 0.35
          }
        }
        ctx!.globalAlpha = a
        const X = fx(px, py), Y = fy(px, py)
        ctx!.fillRect(X - s * 0.5, Y - s * 0.5, s, s)
      }
    }
    ctx!.globalAlpha = 1
  }
  return { draw }
}

/** 粒子 logo:图片非透明像素 → 白色方点(疏一点,点阵感),弹簧归位。
 *  进场:显影式成型(对照 harness 录屏逐帧) —— 粒子一直在原位,按「中心先、边缘后」的
 *  次序逐颗淡入,淡入时从小偏移漂回原位;是出生波前在向外扩散,不是粒子在飞。
 *  平时:整体像浮在水面缓慢晃动(logoBob) + 水波微纹掠过。
 *  悬停:鼠标影响圈内的粒子被噪声推着缓慢游走(logoAgitate),无环无圈,
 *  弹簧放松让它们游得开(可越过 logo 边界),移开鼠标弹簧恢复、全部归位。 */
function initLogo(el: HTMLCanvasElement | null, interactive: boolean, animate: boolean) {
  const ctx = el?.getContext('2d')
  if (!el || !ctx) return null
  const LW = 340, LH = 280 // 内部坐标系;CSS 缩放由 toLocal 换算
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  el.width = LW * dpr; el.height = LH * dpr
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  type P = { x: number; y: number; vx: number; vy: number; hx: number; hy: number; ph: number; d0: number; fd: number; ox: number; oy: number }
  // 纯白粒子,按透明度三档分桶(有明暗层次又不用逐粒切 fillStyle)
  const buckets: Array<{ color: string; ps: P[] }> = []
  let ready = false
  const img = new Image()
  img.onload = () => {
    const box = TUNE.logoBox
    const ratio = img.width && img.height ? img.width / img.height : 1
    const dw = ratio >= 1 ? box : box * ratio
    const dh = ratio >= 1 ? box / ratio : box
    const off = document.createElement('canvas')
    off.width = LW; off.height = LH
    const octx = off.getContext('2d')
    if (!octx) return
    octx.drawImage(img, (LW - dw) / 2, (LH - dh) / 2, dw, dh)
    const data = octx.getImageData(0, 0, LW, LH).data
    // 自适应采样步长:粒子压在 TUNE.logoCount 内,疏密接近参考站的点阵质感
    let step = 4
    for (; step < 16; step++) {
      let n = 0
      for (let y = 0; y < LH; y += step) for (let x = 0; x < LW; x += step) if (data[(y * LW + x) * 4 + 3] > 140) n++
      if (n <= TUNE.logoCount) break
    }
    const tiers: P[][] = [[], [], []]
    let idx = 0
    for (let y = 0; y < LH; y += step) {
      for (let x = 0; x < LW; x += step) {
        if (data[(y * LW + x) * 4 + 3] <= 140) continue
        tiers[idx++ % 3].push({
          // 进场是「显影」不是位移(对照视频逐帧):粒子一直在原位,按出生次序逐颗淡入,
          // 淡入时从 ±9px 的随机小偏移轻轻漂回原位。x/y 始终从原位开始
          hx: x, hy: y, x, y,
          vx: 0, vy: 0, ph: Math.random() * Math.PI * 2,
          d0: 0, fd: 350 + Math.random() * 450, // 每颗自己的淡入时长
          ox: (Math.random() - 0.5) * 18, oy: (Math.random() - 0.5) * 18,
        })
      }
    }
    // 出生次序 = 离中心距离(归一化)×70% + 随机 30%:显影波前从中心向外扩散,边缘略有零星早现
    let maxD = 1
    for (const ps of tiers) for (const p of ps) {
      const d = Math.hypot(p.hx - LW / 2, p.hy - LH / 2)
      if (d > maxD) maxD = d
    }
    for (const ps of tiers) for (const p of ps) {
      const bd = Math.hypot(p.hx - LW / 2, p.hy - LH / 2) / maxD
      p.d0 = (bd * 0.7 + Math.random() * 0.3) * TUNE.logoBloomMs
    }
    const a0 = TUNE.logoAlpha
    const alphas = [a0, +(a0 * 0.72).toFixed(3), +(a0 * 0.45).toFixed(3)]
    tiers.forEach((ps, i) => buckets.push({ color: `rgba(255,255,255,${alphas[i]})`, ps }))
    ready = true
    if (!animate) draw(0) // 静帧模式:就绪后画一次即止
  }
  img.src = logoUrl
  let lmx = -9e3, lmy = -9e3, over = false
  function toLocal(e: MouseEvent) {
    const r = el!.getBoundingClientRect()
    lmx = (e.clientX - r.left) * (LW / r.width)
    lmy = (e.clientY - r.top) * (LH / r.height)
  }
  const onEnter = (e: MouseEvent) => { over = true; toLocal(e) }
  const onMove = (e: MouseEvent) => toLocal(e)
  const onLeave = () => { over = false }
  if (interactive) {
    el.addEventListener('mouseenter', onEnter)
    el.addEventListener('mousemove', onMove, { passive: true })
    el.addEventListener('mouseleave', onLeave)
    cleanups.push(() => {
      el!.removeEventListener('mouseenter', onEnter)
      el!.removeEventListener('mousemove', onMove)
      el!.removeEventListener('mouseleave', onLeave)
    })
  }
  const K = 0.05, SZ = 2.4
  let born = -1 // 进场基准帧:暗场停留 logoBloomHold → 显影 logoBloomMs+淡入尾巴 → 交回物理引擎
  function draw(t: number) {
    if (!ready) return
    if (animate && born < 0) born = t
    const tb = animate ? t - born : Infinity // 进场时间轴;reduced-motion 直接成品态
    const entrance = animate && tb < TUNE.logoBloomHold + TUNE.logoBloomMs + 850 // 850≈最长单粒淡入
    const MR = TUNE.logoStir, MR2 = MR * MR
    ctx!.clearRect(0, 0, LW, LH)
    // 水面漂浮:整个 logo 用两个不可通约周期的正弦做利萨茹式缓慢晃动(translate 一次,零逐粒开销)
    const bt = t * 0.0004 * TUNE.logoBobSpeed
    ctx!.save()
    ctx!.translate(Math.sin(bt) * TUNE.logoBob, Math.sin(bt * 1.37 + 1.2) * TUNE.logoBob * 0.6)
    const tw = t * 0.0012
    for (const b of buckets) {
      ctx!.fillStyle = b.color
      for (const p of b.ps) {
        const ripple = Math.sin(tw + p.hx * 0.025 + p.ph * 0.3) * 0.8 // 水波微纹:涟漪从左往右掠过
        if (entrance) {
          // 显影阶段(对照视频):粒子在原位逐颗淡入,没出生的不画;
          // 淡入同时从 ox/oy 的小偏移轻轻漂回原位,亮度 0→满,无任何弹道
          const u0 = (tb - TUNE.logoBloomHold - p.d0) / p.fd
          if (u0 <= 0) continue
          const u = u0 >= 1 ? 1 : u0
          const e = 1 - (1 - u) ** 3 // easeOutCubic:先快后柔地显出来
          ctx!.globalAlpha = e
          ctx!.fillRect(p.x + p.ox * (1 - e) - SZ / 2, p.y + ripple + p.oy * (1 - e) - SZ / 2, SZ, SZ)
          continue
        }
        let k = K
        if (over) {
          const dx = p.x - lmx, dy = p.y - lmy, d2 = dx * dx + dy * dy
          if (d2 < MR2) {
            const f = 1 - Math.sqrt(d2) / MR
            // 圈内只做缓慢游走:噪声推动 + 高惯性(logoDrift)=慢漂移,没有任何环/圈结构。
            // 弹簧放到 12% 让粒子游得开(可越过 logo 边界),移开鼠标弹簧恢复拉回原位
            p.vx += (Math.random() - 0.5) * TUNE.logoAgitate * f
            p.vy += (Math.random() - 0.5) * TUNE.logoAgitate * f
            k = K * 0.12
          }
        }
        p.vx += (p.hx - p.x) * k; p.vy += (p.hy - p.y) * k
        p.vx *= TUNE.logoDrift; p.vy *= TUNE.logoDrift
        p.x += p.vx; p.y += p.vy
        ctx!.fillRect(p.x - SZ / 2, p.y + ripple - SZ / 2, SZ, SZ)
      }
      ctx!.globalAlpha = 1 // 显影阶段逐粒改过 globalAlpha,按桶恢复
    }
    ctx!.restore()
  }
  return { draw }
}

onMounted(() => {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  const fine = window.matchMedia?.('(pointer: fine)').matches ?? false
  if (fine) unameEl.value?.focus() // 触屏不自动聚焦,避免一进页就弹键盘
  const bg = initBg(bgEl.value, fine && !reduced)
  const lg = initLogo(logoEl.value, fine && !reduced, !reduced)
  if (reduced) { bg?.draw(0); return } // logo 静帧由 ready 回调自画
  if (!bg && !lg) return
  const tick = (t: number) => { bg?.draw(t); lg?.draw(t); raf = requestAnimationFrame(tick) }
  raf = requestAnimationFrame(tick)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  for (const fn of cleanups) fn()
})
</script>

<template>
  <div class="lg-root">
    <canvas ref="bgEl" class="lg-bg" aria-hidden="true" />
    <div class="lg-frame">
      <aside class="lg-brand">
        <div class="lg-brandtop">
          <span class="lg-mark"><img :src="logoUrl" alt="" width="20" height="20"></span>
          <span class="lg-brandname">园区管理系统</span>
        </div>
        <div class="lg-hero">
          <canvas ref="logoEl" class="lg-plogo" aria-hidden="true" />
          <h1 class="lg-headline">园区运营<br>一个后台管到底</h1>
          <p class="lg-sub">楼栋、租户、合同、价目与月度台账共用同一套数据，出账链路可追溯。</p>
        </div>
        <div class="lg-chips">
          <span v-for="c in ['楼栋管理', '租户管理', '合同管理', '月度台账']" :key="c" class="lg-chip">{{ c }}</span>
        </div>
      </aside>

      <section class="lg-panel">
        <form class="lg-form" @submit.prevent="submit">
          <h2 class="lg-welcome">欢迎回来</h2>
          <p class="lg-hint">使用园区分配的账号进入管理后台</p>

          <label class="lg-field">
            <UserIcon :size="18" class="lg-ficon" />
            <input
              ref="unameEl"
              v-model="username"
              placeholder="账号 / 工号"
              autocomplete="username"
              :disabled="loading"
            >
          </label>
          <label class="lg-field">
            <Lock :size="18" class="lg-ficon" />
            <input
              v-model="password"
              :type="showPwd ? 'text' : 'password'"
              placeholder="密码"
              autocomplete="current-password"
              :disabled="loading"
            >
            <button
              type="button"
              class="lg-eye"
              :aria-label="showPwd ? '隐藏密码' : '显示密码'"
              tabindex="-1"
              @click="showPwd = !showPwd"
            >
              <Eye v-if="!showPwd" :size="18" />
              <EyeOff v-else :size="18" />
            </button>
          </label>

          <!-- 错误位常驻(LAYOUT-STABILITY-SPEC §4.2):红字长出来不许把「登录」按钮顶走 -->
          <p class="lg-err"><template v-if="errorMsg"><AlertCircle :size="14" />{{ errorMsg }}</template></p>

          <div class="lg-row">
            <label class="lg-remember">
              <input v-model="remember" type="checkbox" class="lg-cb">
              <span class="lg-cbbox" aria-hidden="true">
                <svg viewBox="0 0 10 8" width="10" height="8"><path d="M1 4l2.5 2.5L9 1" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </span>
              记住登录状态
            </label>
            <button type="button" class="lg-forgot" @click="forgotHint = !forgotHint">忘记密码?</button>
          </div>
          <p class="lg-forgothint"><template v-if="forgotHint">账号密码由园区统一分配，请联系管理员重置。</template></p>

          <button type="submit" class="lg-submit" :disabled="loading">
            {{ loading ? '登录中…' : '登录' }}
          </button>
        </form>
      </section>
    </div>
  </div>
</template>

<style scoped>
.lg-root {
  --lg-blue: #4c98fd;
  position: relative;
  /* App 壳把 html/body 的滚动锁死了(overflow:hidden,页面内各自滚),
     登录页内容超高(窄屏纵排)时必须自己当滚动容器,否则白卡下半截被裁且滚不动 */
  height: 100dvh;
  overflow-y: auto;
  overflow-x: hidden;
  color: #fff;
  background:
    radial-gradient(1100px 700px at 18% 30%, rgba(31, 95, 191, 0.16), transparent 60%),
    radial-gradient(900px 600px at 85% 90%, rgba(76, 152, 253, 0.07), transparent 55%),
    #060a13;
}
.lg-bg { position: fixed; inset: 0; width: 100vw; height: 100vh; pointer-events: none; }

/* 入场:整页由暗到亮 —— 顶层黑色遮罩淡出。
   不用 filter/opacity 动画整个 .lg-root:filter 会把 .lg-bg 的 fixed 定位劫持成相对自己 */
.lg-root::after {
  content: '';
  position: fixed;
  inset: 0;
  background: #000;
  pointer-events: none;
  z-index: 40;
  animation: lg-dawn 1.1s ease-out 0.1s forwards;
}
@keyframes lg-dawn {
  from { opacity: 1; }
  to { opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .lg-root::after { display: none; }
}

.lg-frame {
  position: relative; z-index: 1;
  display: flex; gap: 14px;
  min-height: 100dvh; padding: 14px;
  box-sizing: border-box;
}

/* ---- 左:品牌区 ---- */
.lg-brand { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; padding: 24px 20px 24px 34px; }
.lg-brandtop { display: flex; align-items: center; gap: 12px; }
.lg-mark {
  width: 38px; height: 38px; border-radius: 12px; background: #fff;
  display: grid; place-items: center;
  box-shadow: 0 4px 18px rgba(76, 152, 253, 0.25);
}
.lg-brandname { font-size: 15px; font-weight: var(--fw-semibold); letter-spacing: 0.02em; }
/* hero 撑满品牌区宽,logo 才能落在暗区正中轴;文本自身限宽保持左对齐版式 */
.lg-hero { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 18px; }
.lg-headline, .lg-sub { max-width: 620px; }
.lg-plogo { width: 340px; height: 280px; align-self: center; margin: 0 0 -6px; }
.lg-headline { margin: 0; font-size: clamp(30px, 3.4vw, 44px); line-height: 1.3; font-weight: var(--fw-bold); letter-spacing: 0.01em; }
.lg-sub { margin: 0; font-size: 15px; line-height: 1.9; color: rgba(255, 255, 255, 0.62); }
.lg-chips { display: flex; gap: 10px; flex-wrap: wrap; }
.lg-chip {
  padding: 8px 16px; border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.05);
  font-size: 13px; color: rgba(255, 255, 255, 0.78);
}

/* ---- 右:白卡 ---- */
.lg-panel {
  flex: 0 0 clamp(400px, 34vw, 500px);
  display: flex; align-items: center; justify-content: center;
  background: #fff; border-radius: 40px;
  padding: 48px 24px; box-sizing: border-box;
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.45);
}
.lg-form { width: min(330px, 100%); display: flex; flex-direction: column; }
.lg-welcome { margin: 0; font-size: 27px; font-weight: var(--fw-bold); color: #0f1420; }
.lg-hint { margin: 8px 0 32px; font-size: 13.5px; color: rgba(15, 20, 32, 0.45); }

.lg-field { position: relative; display: block; margin-bottom: 14px; }
.lg-field input {
  width: 100%; height: 52px; box-sizing: border-box;
  border: 1.5px solid transparent; border-radius: 14px;
  background: #f2f4f8; color: #0f1420;
  padding: 0 46px 0 44px;
  font-size: 14.5px; font-family: var(--font-sans);
  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
}
.lg-field input::placeholder { color: rgba(15, 20, 32, 0.35); }
.lg-field input:focus {
  outline: none; background: #fff;
  border-color: var(--lg-blue);
  box-shadow: 0 0 0 4px rgba(76, 152, 253, 0.14);
}
.lg-ficon { position: absolute; left: 15px; top: 50%; transform: translateY(-50%); color: rgba(15, 20, 32, 0.35); pointer-events: none; }
.lg-eye {
  position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
  border: 0; background: none; padding: 8px; border-radius: 10px;
  display: grid; place-items: center;
  color: rgba(15, 20, 32, 0.35); cursor: pointer;
}
.lg-eye:hover { color: rgba(15, 20, 32, 0.7); background: rgba(15, 20, 32, 0.05); }

/* min-height=line-height=恰好一行:空着也占位,出错不位移 */
.lg-err { display: flex; align-items: center; gap: 6px; margin: 2px 0 0; min-height: 18px; line-height: 18px; font-size: 13px; color: var(--hue-red, #e5484d); }

.lg-row { display: flex; align-items: center; justify-content: space-between; margin: 14px 0 26px; }
.lg-remember { display: flex; align-items: center; gap: 9px; font-size: 13.5px; color: #2a3040; cursor: pointer; user-select: none; }
.lg-cb { position: absolute; opacity: 0; width: 1px; height: 1px; }
.lg-cbbox {
  width: 19px; height: 19px; border-radius: 6px;
  border: 1.5px solid rgba(15, 20, 32, 0.3);
  display: grid; place-items: center; box-sizing: border-box;
  transition: background 0.12s, border-color 0.12s;
}
.lg-cbbox svg { opacity: 0; transition: opacity 0.12s; }
.lg-cb:checked + .lg-cbbox { background: #10151f; border-color: #10151f; }
.lg-cb:checked + .lg-cbbox svg { opacity: 1; }
.lg-cb:focus-visible + .lg-cbbox { box-shadow: 0 0 0 3px rgba(76, 152, 253, 0.3); }
.lg-forgot { border: 0; background: none; padding: 0; font-size: 13.5px; color: var(--lg-blue); cursor: pointer; font-family: var(--font-sans); }
.lg-forgot:hover { text-decoration: underline; }
.lg-forgothint { margin: -16px 0 18px; min-height: 16px; line-height: 16px; font-size: 12.5px; color: rgba(15, 20, 32, 0.5); }

.lg-submit {
  height: 54px; border: 0; border-radius: 15px;
  background: #10151f; color: #fff;
  font-size: 15.5px; font-weight: var(--fw-semibold); letter-spacing: 0.5em; text-indent: 0.5em;
  font-family: var(--font-sans); cursor: pointer;
  transition: transform 0.12s, box-shadow 0.12s, opacity 0.12s;
}
.lg-submit:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 10px 26px rgba(16, 21, 31, 0.35); }
.lg-submit:active:not(:disabled) { transform: translateY(0); box-shadow: none; }
.lg-submit:disabled { opacity: 0.6; cursor: default; letter-spacing: 0.1em; text-indent: 0.1em; }

/* ---- 响应式:窄屏纵排,白卡居中 ---- */
@media (max-width: 1080px) {
  .lg-frame { flex-direction: column; gap: 0; padding: 12px; }
  .lg-brand { padding: 16px 8px 24px; align-items: center; text-align: center; }
  .lg-hero { align-items: center; gap: 12px; }
  .lg-plogo { width: 220px; height: 181px; margin: 0; }
  .lg-headline { font-size: clamp(24px, 5vw, 32px); }
  .lg-sub { font-size: 13.5px; max-width: 34em; }
  .lg-chips { justify-content: center; margin-top: 22px; }
  .lg-panel { flex: 0 0 auto; width: min(460px, 100%); margin: 8px auto 20px; border-radius: 30px; padding: 40px 22px; }
}
@media (max-width: 560px) {
  .lg-plogo { width: 180px; height: 148px; }
  .lg-chip { padding: 6px 12px; font-size: 12px; }
}
</style>

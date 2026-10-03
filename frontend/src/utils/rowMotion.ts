// 表格展开 / 收起时行的位移动画(FLIP)。main.ts 装一次,全站所有 <table> 生效,不用逐张改。
// 2026-10-03 用户:「全部表格的这个下拉打开的，增加动画平滑移开，现在是硬切」
// (压过 2026-09-05 动效稿 C5-04 把「折叠高度动画」列进不做、组体瞬显瞬隐的那条)。
//
// 怎么动:点击(或回车 / 空格)发生在某张表里 → 先记下这张表每一行相对表格的位置;
// 随后这张表 tbody 里的行**有增有留** → 留下来的行从旧位置滑到新位置(下面的行平滑让开 / 合拢),新插进来的行淡入。
// 不动的情况:行集合没变(排序、进编辑、改字)、一行都没留下(整片换数据)、没有点击(数据自己刷新)、
// 离视口一屏以外的行、系统开了「减少动态效果」。
// ponytail: 收起时被收掉的行不做淡出 —— 要先克隆被删的行再盖回去,不值;下面的行往上合拢那一下已经不是硬切。

/** 点下去之后多久内的行增减算这一下点的(展开时异步拉子项也算) */
const WINDOW_MS = 1000

type Snap = { rows: Map<Element, number>; at: number }
const snaps = new WeakMap<HTMLTableElement, Snap>()
const observers = new WeakMap<HTMLTableElement, MutationObserver>()

const bodyRows = (t: HTMLTableElement) => Array.from(t.querySelectorAll<HTMLElement>(':scope > tbody > tr'))
const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const token = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback

function snapshot(t: HTMLTableElement) {
  const top = t.getBoundingClientRect().top
  const rows = new Map<Element, number>()
  for (const r of bodyRows(t)) rows.set(r, r.getBoundingClientRect().top - top)
  snaps.set(t, { rows, at: performance.now() })
  let mo = observers.get(t)
  if (!mo) { mo = new MutationObserver(() => settle(t)); observers.set(t, mo) }
  mo.disconnect()
  mo.observe(t, { childList: true, subtree: true })
}

function done(t: HTMLTableElement) {
  snaps.delete(t)
  observers.get(t)?.disconnect()
}

function settle(t: HTMLTableElement) {
  const s = snaps.get(t)
  if (!s) return
  if (performance.now() - s.at > WINDOW_MS) { done(t); return }
  const now = bodyRows(t)
  const kept = now.filter((r) => s.rows.has(r))
  if (kept.length === now.length && kept.length === s.rows.size) return   // 行集合没变:接着等窗口里真正的增减
  done(t)
  if (!kept.length) return   // 一行都没留下 = 整片换数据,不是展开
  const top = t.getBoundingClientRect().top
  const vh = window.innerHeight
  const dur = parseFloat(token('--dur-base', '200ms')) || 200
  const move = token('--ease-both', 'ease-in-out')
  const enter = token('--ease-out', 'ease-out')
  for (const r of now) {
    if (typeof r.animate !== 'function') continue
    const rc = r.getBoundingClientRect()
    if (rc.bottom < -vh || rc.top > 2 * vh) continue
    const old = s.rows.get(r)
    if (old === undefined) {
      r.animate([{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], { duration: dur, easing: enter })
    } else {
      const dy = Math.round(old - (rc.top - top))
      if (Math.abs(dy) >= 1) r.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: dur, easing: move })
    }
  }
}

/** 装上全站监听(捕获阶段,先于表格里的点击处理);返回卸载函数(测试用) */
export function installRowMotion(): () => void {
  const onEv = (e: Event) => {
    if (e.type === 'keydown') {
      const k = (e as KeyboardEvent).key
      if (k !== 'Enter' && k !== ' ') return
    }
    if (reduced()) return
    const t = (e.target as Element | null)?.closest?.('table')
    if (t) snapshot(t as HTMLTableElement)
  }
  document.addEventListener('click', onEv, true)
  document.addEventListener('keydown', onEv, true)
  return () => {
    document.removeEventListener('click', onEv, true)
    document.removeEventListener('keydown', onEv, true)
  }
}

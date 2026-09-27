// 校验 live/pNN.js:在两个 node:vm 里分别装原 chunk01..05 与 live/p01..pNN,比 exe / ops / sum 完全一致。
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ctx = () => {
  const store = {}
  const localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v) }, removeItem: k => { delete store[k] } }
  const w = { localStorage, sessionStorage: localStorage, console, fetch: () => { throw new Error('no fetch') } }
  w.window = w
  return vm.createContext(w)
}
const load = (files) => {
  const c = ctx()
  let last
  for (const f of files) last = vm.runInContext(fs.readFileSync(f, 'utf8'), c)
  return { cx: c.window.__cx, last }
}
const orig = load([1, 2, 3, 4, 5].map(i => path.join(HERE, `executor.chunk0${i}.js`)))
const live = fs.readdirSync(path.join(HERE, 'live')).filter(f => /^p\d+\.js$/.test(f)).sort()
const neu = load(live.map(f => path.join(HERE, 'live', f)))
const a = JSON.stringify(orig.cx.ops), b = JSON.stringify(neu.cx.ops)
console.log(JSON.stringify({
  parts: live.length, origLast: orig.last, liveLast: neu.last,
  exe: [orig.cx.exe, neu.cx.exe], sum: [orig.cx.sum, neu.cx.sum], ops: [orig.cx.ops.length, neu.cx.ops.length],
  opsEqual: a === b, sealed: [orig.cx.sealed, neu.cx.sealed],
  fnsEqual: Object.keys(orig.cx).sort().join() === Object.keys(neu.cx).sort().join(),
}))

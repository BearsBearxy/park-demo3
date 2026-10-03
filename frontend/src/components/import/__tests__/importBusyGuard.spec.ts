// 导入中关不掉(D14,UI-OVERLAY-SPEC §8)不只是弹窗自己的 ×/遮罩/Esc:屏收写浮层的两条路 ——
// 编辑态转假的 watch(被接管 / 授权到期 / 换期)与页签停用的 onDeactivated —— 也不许把在跑的导入窗收走。
// 收了 runner 照样写完(附表10 还会接着发剩下的段),只是人看不到写进去多少、断在哪。
// 这里扫全部源码:这两条路里凡是 `importing.value = false`,都得是 `if (!importBusy.value) importing.value = false`。
// 现在和将来的屏一次管住(动作在关窗函数 closeImport / goView 里的不算,那是人点的「知道了」)。
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const SRC = join(process.cwd(), 'src')
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) return n === '__tests__' ? [] : walk(p)
    return /\.(vue|ts)$/.test(n) && !/\.spec\.ts$/.test(n) ? [p] : []
  })
}

/** 每处「收导入窗」所在的那段:往回找最近的 watch( / onDeactivated( / function,谁离得近算谁 */
function sites() {
  const out: { at: string; owner: string; line: string }[] = []
  for (const f of walk(SRC)) {
    const src = readFileSync(f, 'utf8')
    let i = src.indexOf('importing.value = false')
    while (i >= 0) {
      const before = src.slice(0, i)
      const owner = (['watch(', 'onDeactivated(', 'function '] as const)
        .map(t => [t, before.lastIndexOf(t)] as const).sort((a, b) => b[1] - a[1])[0][0]
      const ls = before.lastIndexOf('\n') + 1
      const le = src.indexOf('\n', i)
      out.push({ at: `${relative(SRC, f).replace(/\\/g, '/')}:${before.split('\n').length}`, owner, line: src.slice(ls, le < 0 ? undefined : le).trim() })
      i = src.indexOf('importing.value = false', i + 1)
    }
  }
  return out
}

describe('屏收写浮层时不收在跑的导入窗', () => {
  // 破坏验证:任一屏(如 MeterView 的 watch(editMode)、PvMeterView 的 onDeactivated)把 if (!importBusy.value) 删掉 → 该处列进来 → 红
  it('❗编辑态转假 watch / 页签停用 onDeactivated 里收导入窗,一律先看 importBusy', () => {
    const all = sites()
    const auto = all.filter(s => s.owner !== 'function ')
    expect(auto.length, '前置:扫到了这两条路(附表族共用层 + 抄表 / 光伏 / 充电桩 / 电费 / 工资 / 附表10)').toBeGreaterThanOrEqual(11)
    expect(auto.filter(s => !s.line.includes('if (!importBusy.value) importing.value = false')).map(s => `${s.at} ${s.line}`)).toEqual([])
  })
})

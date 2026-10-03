// 「钱那一列」三屏同形(实现规范 §2-29;画布 03-A / 04-A / 05-A 逐像素取样一致:数据格与合计格 (241,247,254)、
// 分组行那一格 (246,248,252))。三屏的表各自在自己的 <style scoped> 里声明这两个变量,值必须逐字相同 ——
// 改了一屏忘了另两屏,钱列就又是三种底(对抗复查 spec-6 抓到的就是这个)。
// 破坏验证:任一屏把 --money-cell 改回 --info-soft 那一式 / 把 --money-cell-grp 的 40% 改掉 → 红
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SCREENS = {
  公共电核算: 'alloc/PoolLedgerView.vue',
  园区抄表: 'meters/MeterLedgerGrid.vue',
  催缴单: 'bills/BillNoticesView.vue',
}
const decl = (css: string, name: string) =>
  [...css.matchAll(new RegExp(`${name}:\\s*([^;]+);`, 'g'))].map(m => m[1].trim())

describe('钱那一列:三屏同一组式子', () => {
  it.each(Object.entries(SCREENS))('%s', (_, f) => {
    const css = readFileSync(join(__dirname, '..', f), 'utf8')
    expect(decl(css, '--money-cell')).toEqual(['color-mix(in srgb, var(--accent-blue) 60%, var(--surface-white))'])
    expect(decl(css, '--money-cell-grp')).toEqual(['color-mix(in srgb, var(--money-cell) 40%, var(--surface-card))'])
  })
})

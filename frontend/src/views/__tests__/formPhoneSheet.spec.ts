// 带输入控件的居中弹卡 → S 档全屏 sheet(RESPONSIVE-LAYOUT-SPEC §4.4;壳见 styles/form-sheet.css)。
//
// 规范 §4.4 原先只覆盖三个标准件(fp/FPDrawer、import/FpImportModal、fp/FPSideDrawer),
// 各屏自带的居中弹卡还是居中小卡 —— 而输入控件在 390 宽的居中小卡里装不下 44 高 / 16px 字。
// 判据不是「是不是弹窗」,是里面有没有输入控件:
//   有输入 → S 档全屏 sheet
//   只有一句话 + 两个钮(import/SaveConfirmDialog 这类)→ 仍是居中小卡
//
// 两档都断:只断 S 的话,把 XL 档也一起全屏掉同样是绿的(桌面零差异 §9 会被悄悄破掉)。
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPinia, setActivePinia } from 'pinia'
import FPReviewDialog from '@/components/fp/FPReviewDialog.vue'
import BuildingNewDialog from '@/views/buildings/BuildingNewDialog.vue'
import { _resetViewportForTest } from '@/composables/useViewport'

const SRC_ROOT = join(__dirname, '..', '..')
const read = (...p: string[]) => readFileSync(join(SRC_ROOT, ...p), 'utf8')
const SHEET_CSS = read('styles', 'form-sheet.css')

let w: VueWrapper | null = null

function setTier(tier: 's' | 'xl') {
  vi.stubGlobal('matchMedia', (q: string) => ({
    media: q,
    matches: tier === 's' ? q.includes('max-width') : false,
    addEventListener() {},
    removeEventListener() {},
  }))
  _resetViewportForTest()
}

beforeEach(() => setActivePinia(createPinia()))
afterEach(() => {
  w?.unmount(); w = null
  _resetViewportForTest()
  vi.unstubAllGlobals()
})

// ─────────────────────────────────────────────────────────────
// 1. 渲染出来的档位差异(两档都断)
// ─────────────────────────────────────────────────────────────
describe('弹卡档位 · FPReviewDialog(必填理由,带 textarea)', () => {
  async function mk(tier: 's' | 'xl') {
    setTier(tier)
    w = mount(FPReviewDialog, {
      props: { target: '2026-09 附表12', action: 'return' as const },
      attachTo: document.body,
    })
    await nextTick()
    return document.body.querySelector<HTMLElement>('.rvd-scrim')!
  }

  it('❗S 档:遮罩挂上 .fp-fsheet,体/脚带标记类', async () => {
    const scrim = await mk('s')
    expect(scrim.classList.contains('fp-fsheet')).toBe(true)
    expect(scrim.querySelector('.rvd-body')!.classList.contains('fp-fsheet-bd')).toBe(true)
    expect(scrim.querySelector('.rvd-foot')!.classList.contains('fp-fsheet-ft')).toBe(true)
  })

  it('❗XL 档:仍是居中小卡 —— 遮罩上没有 .fp-fsheet(标记类不挂 = 全屏那套规则一条都不命中)', async () => {
    const scrim = await mk('xl')
    expect(scrim.classList.contains('fp-fsheet')).toBe(false)
  })
})

describe('弹卡档位 · BuildingNewDialog(新建/编辑楼栋)', () => {
  async function mk(tier: 's' | 'xl') {
    setTier(tier)
    w = mount(BuildingNewDialog, { props: { existingNames: [] }, attachTo: document.body })
    await nextTick()
    return document.body.querySelector<HTMLElement>('.lg-dlg-mask')!
  }

  it('❗S 档:.fp-fsheet 挂在遮罩上,卡是遮罩的独子(全屏规则靠 `> *` 命中它)', async () => {
    const mask = await mk('s')
    expect(mask.classList.contains('fp-fsheet')).toBe(true)
    expect(mask.children.length, '遮罩下只能有一个孩子').toBe(1)
    expect(mask.children[0].classList.contains('lg-dlg')).toBe(true)
    expect(mask.querySelector('.lg-dlg-b')!.classList.contains('fp-fsheet-bd')).toBe(true)
    expect(mask.querySelector('.lg-dlg-f')!.classList.contains('fp-fsheet-ft')).toBe(true)
  })

  it('❗XL 档:没有 .fp-fsheet;nested 那档(编辑态压过抽屉)不受影响', async () => {
    const mask = await mk('xl')
    expect(mask.classList.contains('fp-fsheet')).toBe(false)
    expect(mask.classList.contains('lg-dlg-mask')).toBe(true)
  })

  it('❗脚里正好两颗钮:取消在前、主按钮在后(CSS 按位置派 108 / flex:1)', async () => {
    const mask = await mk('s')
    const foot = mask.querySelector<HTMLElement>('.fp-fsheet-ft')!
    expect(foot.children.length).toBe(2)
    expect(foot.children[0].textContent!.trim()).toBe('取消')
    expect(foot.children[1].textContent!.trim()).toBe('创建')
  })
})

// ─────────────────────────────────────────────────────────────
// 2. sheet 壳的形状(CSS 字面量;照抄 FPDrawer.vue:185-199 的 ≤600 分支)
// ─────────────────────────────────────────────────────────────
describe('sheet 壳 · styles/form-sheet.css', () => {
  const rule = (sel: string) =>
    SHEET_CSS.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{[^}]*\\}'))![0]

  it('❗遮罩:去掉 24 内边距、不再居中', () => {
    expect(rule('.fp-fsheet')).toMatch(/padding:\s*0\s*!important/)
    expect(rule('.fp-fsheet')).toMatch(/display:\s*block\s*!important/)
  })

  it('❗卡:铺满 100%×100%、无圆角无边框、自己不滚', () => {
    const r = rule('.fp-fsheet > *')
    expect(r).toMatch(/width:\s*100%\s*!important/)
    expect(r).toMatch(/height:\s*100%\s*!important/)
    expect(r).toMatch(/max-height:\s*none\s*!important/)
    expect(r).toMatch(/border-radius:\s*0\s*!important/)
    expect(r).toMatch(/overflow:\s*hidden\s*!important/)
    expect(r).toMatch(/flex-direction:\s*column\s*!important/)
  })

  it('❗体 flex:1 内滚,头/脚不压缩', () => {
    expect(rule('.fp-fsheet .fp-fsheet-bd')).toMatch(/flex:\s*1 1 auto\s*!important/)
    expect(rule('.fp-fsheet .fp-fsheet-bd')).toMatch(/overflow-y:\s*auto\s*!important/)
    expect(rule('.fp-fsheet > * > *')).toMatch(/flex:\s*0 0 auto/)
  })

  it('❗脚贴底:padding 10px 16px 34px、底色 --surface-raised、顶边一条 divider', () => {
    const r = rule('.fp-fsheet .fp-fsheet-ft')
    expect(r).toMatch(/padding:\s*10px 16px 34px\s*!important/)
    expect(r).toMatch(/background:\s*var\(--surface-raised\)/)
    expect(r).toMatch(/border-top:\s*1px solid var\(--divider\)/)
  })

  it('❗主按钮 flex:1 撑满、取消定宽 108(拇指够得着的是右边)', () => {
    expect(SHEET_CSS).toMatch(/:first-child:nth-last-child\(2\)\s*\{\s*flex:\s*0 0 108px/)
    expect(SHEET_CSS).toMatch(/~ :last-child\s*\{\s*flex:\s*1 1 auto/)
  })

  it('❗输入控件 44 高 / 16px 字', () => {
    const r = SHEET_CSS.match(/\.fp-fsheet input[\s\S]*?\{[^}]*\}/)![0]
    expect(r).toMatch(/min-height:\s*44px\s*!important/)
    expect(r).toMatch(/font-size:\s*var\(--fs-input-m\)\s*!important/)
    expect(r).toContain('textarea')
    expect(r).toContain('.ds-sel-trigger')
  })

  it('❗断点只有 600 这一个来源:本文件不写第四个断点值(档位由 useViewport 给)', () => {
    expect(SHEET_CSS).not.toMatch(/@media/)
    expect(read('composables', 'useFormSheet.ts')).toContain("vp.tier.value === 's'")
  })
})

// ─────────────────────────────────────────────────────────────
// 3. 名单:哪些弹卡在里面、哪些按判据留在外面
// ─────────────────────────────────────────────────────────────
describe('名单 · 带输入的居中弹卡', () => {
  // 勘察出来的全部十三处。少接一处 = 那一屏在 390 上还是居中小卡。
  const ROSTER = [
    ['views', 'buildings', 'BuildingNewDialog.vue'],
    ['views', 'contracts', 'ContractNewDialog.vue'],
    ['views', 'tenants', 'TenantNewDialog.vue'],
    ['views', 'ledger', 'LedgerNewCompanyDialog.vue'],
    ['views', 'ledger', 'LedgerDeleteCompanyDialog.vue'],
    ['views', 'system', 'SystemUsersView.vue'],
    ['views', 'buildings', 'BuildingDrawer.vue'],
    ['views', 'meters', 'MeterView.vue'],
    ['views', 'elec', 'ElecCostView.vue'],
    ['views', 'pv', 'PvMeterView.vue'],
    ['views', 'charging', 'CpMeterView.vue'],
    ['components', 'fin', 'FinDialogs.vue'],
    ['components', 'fp', 'FPReviewDialog.vue'],
  ]

  // 每个文件**应有几处**接线。一个文件里有两处弹卡时(SystemUsersView 的新建账号 / 重置密码、
  // FinDialogs 的 company / addrow),文件级 substring 漏接其中一处不会红 ——
  // 2026-09-20 对抗复查实跑验证。所以断计数,不断存在。
  // 一个文件里有几处**带输入的弹卡**就该有几处体/脚标记。SystemUsersView 两处(新建账号 /
  // 重置密码)、FinDialogs 两处(company / addrow,共用同一个 .fin-mask,所以壳类只写一次)。
  // 文件级 substring 在这两个文件上漏接其中一处不会红 —— 2026-09-20 对抗复查实跑验证。
  // MeterView 第二处是 §5.10 给 S 档新开的「筛选 / 更多」底部面板(段控 ×2 + 下拉 ×3),
  // 按本条自己的口径「一个文件里有几处带输入的弹卡就该有几处体/脚标记」,它现在就是 2 处。
  const DIALOGS: Record<string, number> = { 'SystemUsersView.vue': 2, 'FinDialogs.vue': 2, 'MeterView.vue': 2 }
  it.each(ROSTER)('❗%s/%s/%s 接上了 useFormSheet,体/脚两个标记类逐个弹卡都在', (...p) => {
    const src = read(...p)
    const n = DIALOGS[p[p.length - 1] as string] ?? 1
    expect(src).toContain("useFormSheet } from '@/composables/useFormSheet'")
    // 壳类挂在遮罩上,一个遮罩可以套几个弹卡(FinDialogs 就是),所以只断「至少一处」
    expect((src.match(/'fp-fsheet': sheet/g) ?? []).length).toBeGreaterThanOrEqual(1)
    expect((src.match(/fp-fsheet-bd/g) ?? []).length, '体标记少接了一处').toBe(n)
    expect((src.match(/fp-fsheet-ft/g) ?? []).length, '脚标记少接了一处').toBe(n)
  })

  it('❗只有一句话 + 两个钮的确认卡不动:SaveConfirmDialog 仍是居中小卡', () => {
    expect(read('components', 'import', 'SaveConfirmDialog.vue')).not.toContain('fp-fsheet')
  })

  it('❗同一个遮罩下的无输入态排除掉:FinDialogs 的 delco、SystemUsersView 的停用确认', () => {
    expect(read('components', 'fin', 'FinDialogs.vue'))
      .toContain("'fp-fsheet': sheet && dlg.type !== 'delco'")
    const su = read('views', 'system', 'SystemUsersView.vue')
    // 停用/启用确认那个遮罩(tgTarget)整条不带 fp-fsheet
    const tg = su.match(/<div v-if="tgTarget" class="fin-mask"[^>]*>/)![0]
    expect(tg).not.toContain('fp-fsheet')
  })

  it('❗已有 S 档全屏分支的三个标准件不重复做', () => {
    for (const p of [
      ['components', 'fp', 'FPDrawer.vue'],
      ['components', 'import', 'FpImportModal.vue'],
    ]) expect(read(...p), p.join('/')).not.toContain('fp-fsheet')
  })
})

// ─────────────────────────────────────────────────────────────
// 4. 反向断言:错误行的预留位一条都不许删
// ─────────────────────────────────────────────────────────────
describe('反向断言 · 错误位仍然常驻(LAYOUT-STABILITY-SPEC §4.2)', () => {
  // 稿说「一次性表单出错时整块下移可接受」—— 本轮推翻它:撞 §4.2,而且改后 sheet 的主按钮
  // 正是贴底那一颗,ds/Input.vue:104 那条注释写的就是这个场景。现状全都有 min-height = 零改动。
  it.each([
    ['components/ds/Input.vue', ['components', 'ds', 'Input.vue'], '.ds-in-msg'],
    ['views/buildings/BuildingNewDialog.vue', ['views', 'buildings', 'BuildingNewDialog.vue'], '.lg-dlg-erm'],
    ['views/contracts/ContractNewDialog.vue', ['views', 'contracts', 'ContractNewDialog.vue'], '.ct-erm'],
    ['views/buildings/BuildingDrawer.vue', ['views', 'buildings', 'BuildingDrawer.vue'], '.bd-erm'],
  ])('❗%s 的 %s 仍有 min-height', (_label, p, sel) => {
    const src = read(...(p as string[]))
    const rule = src.match(new RegExp('\\' + sel + '\\s*\\{[^}]*\\}'))
    expect(rule, `${sel} 规则不见了`).not.toBeNull()
    expect(rule![0]).toMatch(/min-height:\s*\d/)
  })
})

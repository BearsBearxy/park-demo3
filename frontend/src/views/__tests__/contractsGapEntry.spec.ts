// src/views/__tests__/contractsGapEntry.spec.ts — 合同管理「待补档案」(画布 01-B / 01-A 卡1,T12)。
// 整条黄条撤掉,入口收成工具条上的「待补档案 ▾」胶囊:不写总数,点开列三项及件数,点一项就筛;
// 筛选生效胶囊变实底「缺起止日期 N ×」,点 × 回全部;缺起止日期的行就地挂「● 缺起止日期」。
// 另钉本屏的机械替换(T13):导入失败走回执带重试、手写空态换 FPEmpty、本批 5 个文件无原生 title / confirm / alert。
//
// 夹具口径:四份合同,三类缺口各自命中不同的合同(缺起止日期 2 / 无租金计费行 1 / 租金行未绑单元 1),
// 「缺起止日期」两份里一份两头都缺、一份只缺结束日 —— 判据写成只看 startDate 也会红。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, KeepAlive, ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ContractDTO } from '@/types/contract'

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {}, fullPath: '/contracts' }),
  useRouter: () => ({ push: vi.fn() }),
  RouterLink: { name: 'RouterLink', template: '<a><slot /></a>' },
}))
vi.mock('@/api/contract', () => ({
  contractApi: { list: vi.fn(), summary: vi.fn(), detail: vi.fn(() => new Promise(() => {})) },
}))
vi.mock('@/utils/importRegistry', () => ({ parserProps: () => ({}), runImport: vi.fn() }))

import ContractsView from '@/views/contracts/ContractsView.vue'
import { contractApi } from '@/api/contract'
import { runImport } from '@/utils/importRegistry'
import { receipts } from '@/utils/receipt'

const base = {
  tenantId: 1, buildingId: 1, buildingName: '二期 三车间', unitId: null, floorInfo: '4F-401',
  rentArea: 1680, monthlyRent: 4911, deposit: 0, signDate: '2023-01-01', termMonths: 36, remark: null,
  parentContractId: null, linkType: null, kind: 'normal' as const,
}
const ROWS: ContractDTO[] = [
  { ...base, id: 1, contractNo: 'S10-0158', tenantName: '火炬园邓宇峰', startDate: '2023-01-01', endDate: '2026-12-31',
    status: 'active', daysToEnd: 400, billingLineCount: 3, unboundTermCount: 0 },
  { ...base, id: 2, contractNo: 'S10-0162', tenantName: '广联', startDate: null, endDate: null,
    status: 'draft', daysToEnd: null, billingLineCount: 0, unboundTermCount: 0 },
  { ...base, id: 3, contractNo: 'S10-0163', tenantName: '氙明', startDate: '2024-03-01', endDate: '2027-02-28',
    status: 'active', daysToEnd: 700, billingLineCount: 2, unboundTermCount: 1 },
  { ...base, id: 4, contractNo: 'S10-0078#1', tenantName: 'SENAN', startDate: '2023-06-01', endDate: null,
    status: 'active', daysToEnd: null, billingLineCount: 1, unboundTermCount: 0 },
]
const SUMMARY = { total: 4, active: 3, expiring: 0, terminated: 0 }

async function mountView(rows: ContractDTO[] = ROWS) {
  vi.mocked(contractApi.list).mockResolvedValue(rows as never)
  vi.mocked(contractApi.summary).mockResolvedValue(SUMMARY as never)
  const w = mount(ContractsView, { global: { stubs: { Teleport: true, RouterLink: true, 'router-link': true, ImportResultToast: true } } })
  await flushPromises()
  return w
}
const names = (w: VueWrapper) => w.findAll('.cl-item .cl-name').map((n) => n.text())
const chip = (w: VueWrapper) => w.find('.mx-toolbar .fac')
const menuRows = (w: VueWrapper) => w.findAll('.mx-gapitem').map((b) => b.findAll('span').map((s) => s.text()).join(' '))

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  receipts.splice(0)
})

describe('合同管理 · 待补档案入口(画布 01-B)', () => {
  // 破坏验证:FPAlertChip 的 showCount 不起作用(去掉 v-if="props.showCount")→ 胶囊变「待补档案 4」→ 红;
  //           把黄条 .mx-gapbar 加回来 → 红
  it('❗有缺口时没有黄条;工具条上是「待补档案 ▾」胶囊,不写总数', async () => {
    const w = await mountView()
    expect(w.find('.mx-gapbar').exists(), '黄条还在').toBe(false)
    expect(chip(w).text()).toBe('待补档案')
    expect(chip(w).find('.dd').exists(), '点开出面板的胶囊带 ▾').toBe(true)
    // 位置:工具条右侧「按某天查看」的左边
    const right = w.find('.mx-toolbar-right').element
    const kids = [...right.children]
    const chipAt = kids.findIndex((k) => k.contains(chip(w).element))
    const dateAt = kids.findIndex((k) => k.querySelector('[aria-label="按某天查看"]') || k.getAttribute('aria-label') === '按某天查看')
    expect(chipAt).toBeGreaterThanOrEqual(0)
    expect(chipAt, '胶囊要在「按某天查看」左边').toBeLessThan(dateAt)
    w.unmount()
  })

  // 破坏验证:gapCounts 的 filter(g.hit) 改成 filter(() => true) → 三行都是 4 → 红
  it('❗点胶囊出弹层:三项各带件数', async () => {
    const w = await mountView()
    expect(w.find('.mx-gapmenu').exists()).toBe(false)
    await chip(w).trigger('click')
    expect(menuRows(w)).toEqual(['缺起止日期 2', '无租金计费行 1', '租金行未绑单元 1'])
    w.unmount()
  })

  // 破坏验证:gapRows 去掉 filter(件数 > 0)→ 多出「租金行未绑单元 0」→ 红
  it('件数为 0 的那项不进弹层(01-A 卡2 只有两项时就两行)', async () => {
    const w = await mountView(ROWS.map((r) => ({ ...r, unboundTermCount: 0 })))
    await chip(w).trigger('click')
    expect(menuRows(w)).toEqual(['缺起止日期 2', '无租金计费行 1'])
    w.unmount()
  })

  // 破坏验证:pickGap 里不写 gap.value = k → 列表不筛 → 红;不关 gapOpen → 弹层还在 → 红
  it('❗点「缺起止日期」:列表只剩命中的合同,胶囊变实底「缺起止日期 2 ×」,弹层收起', async () => {
    const w = await mountView()
    expect(names(w)).toHaveLength(4)
    await chip(w).trigger('click')
    await w.findAll('.mx-gapitem')[0].trigger('click')
    expect(names(w).sort()).toEqual(['SENAN', '广联'])
    expect(chip(w).classes()).toContain('on')
    expect(chip(w).text()).toContain('缺起止日期 2')
    expect(chip(w).find('.x').exists(), '筛选生效要有 ×').toBe(true)
    expect(w.find('.mx-gapmenu').exists(), '点一项后弹层要收起').toBe(false)
    w.unmount()
  })

  // 破坏验证:@clear="gap = ''" 去掉 → 点 × 列表不回 → 红
  it('❗点 × 回到全部,胶囊回「待补档案」', async () => {
    const w = await mountView()
    await chip(w).trigger('click')
    await w.findAll('.mx-gapitem')[1].trigger('click')
    expect(names(w)).toEqual(['广联'])
    await chip(w).find('.x').trigger('click')
    expect(names(w)).toHaveLength(4)
    expect(chip(w).classes()).not.toContain('on')
    expect(chip(w).text()).toBe('待补档案')
    w.unmount()
  })

  // 破坏验证:open-change 去掉「&& gapTotal > 0」→ 静默态点了也开出空弹层 → 红
  it('没有缺口:胶囊照样占位,写「无待补档案」,点了不开空弹层', async () => {
    const w = await mountView([{ ...ROWS[0] }])
    expect(chip(w).exists(), '静默态也要渲染(不留空洞不挪版)').toBe(true)
    expect(chip(w).classes()).toContain('quiet')
    expect(chip(w).text()).toBe('无待补档案')
    await chip(w).trigger('click')
    expect(w.find('.ds-popover-panel').exists()).toBe(false)
    w.unmount()
  })
})

describe('合同管理 · 待补档案入口的三处连带(打开含历史 / 翻页复位 / 切走收起)', () => {
  // 一条两期的续签链:旧期(id 5)缺结束日、已被续签取代;新期(id 6)日期齐。默认折叠到生效段,旧期看不见
  const CHAIN: ContractDTO[] = [
    { ...base, id: 5, contractNo: 'S10-0090', tenantName: '恒达', startDate: '2021-01-01', endDate: null,
      status: 'renewed', daysToEnd: null, billingLineCount: 2, unboundTermCount: 0 },
    { ...base, id: 6, contractNo: 'S10-0090#1', tenantName: '恒达', startDate: '2024-01-01', endDate: '2026-12-31',
      status: 'active', daysToEnd: 400, billingLineCount: 2, unboundTermCount: 0, parentContractId: 5, linkType: 'renew' },
  ]
  const nos = (w: VueWrapper) => w.findAll('.cl-item .cl-no').map((n) => n.text())

  // 破坏验证:pickGap 里 `showHistory.value = true` 删掉 → 旧期还折叠着 → 红
  it('❗点「缺起止日期」顺带打开含历史续签:被续签取代的旧期缺日期也列出来', async () => {
    const w = await mountView([...ROWS, ...CHAIN])
    expect(nos(w), '前置:默认折叠到生效段,旧期不在列表里').not.toContain('S10-0090')
    await chip(w).trigger('click')
    await w.findAll('.mx-gapitem')[0].trigger('click')
    expect(nos(w).sort()).toEqual(['S10-0078#1', 'S10-0090', 'S10-0162'])
    expect(w.find('.mx-hist-toggle').classes(), '含历史续签开关是开的').toContain('on')
    w.unmount()
  })

  // 先把含历史打开(pickGap 里那一句不再引起变化),只剩 gap 本身能把页码拉回 1
  // 破坏验证:翻页复位的 watch 列表里去掉 gap → 页码停在 2 → 红
  it('❗翻到第 2 页再选缺口:页码回到 1', async () => {
    const w = await mountView()
    await w.find('.mx-hist-toggle input').setValue(true)
    const vm = w.vm as unknown as { page: number }
    vm.page = 2
    await flushPromises()
    await chip(w).trigger('click')
    await w.findAll('.mx-gapitem')[0].trigger('click')
    await flushPromises()
    expect(vm.page).toBe(1)
    w.unmount()
  })

  // 破坏验证:onDeactivated 里的 gapOpen = false 删掉 → 切回来弹层还开着 → 红
  it('❗弹层开着切走页签再切回:弹层已收起', async () => {
    vi.mocked(contractApi.list).mockResolvedValue(ROWS as never)
    vi.mocked(contractApi.summary).mockResolvedValue(SUMMARY as never)
    const alive = ref(true)
    const w = mount(defineComponent({
      setup: () => () => h(KeepAlive, null, { default: () => (alive.value ? h(ContractsView) : null) }),
    }), { global: { stubs: { Teleport: true, RouterLink: true, 'router-link': true, ImportResultToast: true } } })
    await flushPromises()
    await chip(w).trigger('click')
    expect(w.find('.mx-gapmenu').exists(), '前置:弹层开着').toBe(true)
    alive.value = false; await flushPromises()
    alive.value = true; await flushPromises()
    expect(w.find('.mx-gapmenu').exists()).toBe(false)
    w.unmount()
  })
})

describe('合同列表 · 缺起止日期就地标记(01-A 卡1)', () => {
  // 破坏验证:FPMark 的 v-if 改成 v-if="!c.startDate"(只看开始日)→ SENAN 那行没标 → 红
  it('❗缺起止日期的行挂「● 缺起止日期」,日期齐的不挂', async () => {
    const w = await mountView()
    const marked = w.findAll('.cl-item').filter((r) => r.find('.fp-mark').exists())
      .map((r) => [r.find('.cl-name').text(), r.find('.fp-mark').text()])
    expect(marked.sort()).toEqual([['SENAN', '缺起止日期'], ['广联', '缺起止日期']])
    w.unmount()
  })
})

describe('合同管理 · 机械替换(T13)', () => {
  // 破坏验证:FPEmpty 换回 <div class="cl-empty"> → 红
  it('❗搜不到:列表区是 FPEmpty「没有匹配的合同」', async () => {
    const w = await mountView()
    await w.find('.mx-search input').setValue('不存在的合同')
    const empty = w.find('.cl-scroll .fp-empty')
    expect(empty.exists()).toBe(true)
    expect(empty.text()).toContain('没有匹配的合同')
    w.unmount()
  })

  // 2026-10-03 起导入失败在导入弹窗原地出失败卡(「返回修改」再导),onImport 是弹窗的 runner,错误要抛给弹窗
  // 破坏验证:onImport 改回 try/catch + 回执(吞掉错误)→ rejects 那句红
  it('❗导入失败:错误交给导入弹窗的失败卡,不再出底部回执', async () => {
    vi.mocked(runImport).mockRejectedValueOnce(new Error('第 3 页表头对不上'))
    const w = await mountView()
    const vm = w.vm as unknown as { onImport: (p: unknown[], f: string) => Promise<unknown> }
    await expect(vm.onImport([], '租金.xlsx')).rejects.toThrow('第 3 页表头对不上')
    expect(receipts).toHaveLength(0)
    w.unmount()
  })

  // 门禁(规范 §5 的本批切片):本批 5 个文件里没有浏览器自带的 confirm / alert,模板里没有原生 title=
  // 破坏验证:任一文件模板里加回 title="x" 或脚本里加回 alert('x') → 红;
  //           加在属性值里带 > 的标签上(FPContractChain 根 div,v-if="props.chain.length > 1")也红
  it('❗合同目录 5 个文件:confirm / alert / 原生 title= 为 0', () => {
    const dir = join(__dirname, '..', 'contracts')
    for (const f of ['ContractsView.vue', 'ContractDrawer.vue', 'ContractNewDialog.vue', 'FPContractChain.vue', 'FPContractTimeline.vue']) {
      const src = readFileSync(join(dir, f), 'utf8')
      const tpl = src.slice(src.indexOf('<template>'), src.lastIndexOf('</template>'))
      expect(src, `${f} 还有 confirm/alert`).not.toMatch(/(^|[^\w.])(window\.)?(confirm|alert)\(/m)
      // FpImportModal / DatePicker 声明了 title prop(不是原生 title),白名单;DatePicker 的只落触发器 .dp-box
      // 引号里的属性值整段跳过:值里的 >(v-if="n > 1"、@x="v => …")不算标签结束
      const titles = [...tpl.matchAll(/<([\w-]+)(?:"[^"]*"|'[^']*'|[^>"'])*?\s:?title=/g)].map((m) => m[1]).filter((t) => t !== 'FpImportModal' && t !== 'DatePicker')
      expect(titles, `${f} 模板里还有原生 title=`).toEqual([])
    }
  })
})

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { defineComponent, h, KeepAlive } from 'vue'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

import MeterDetailDrawer from '@/views/meters/MeterDetailDrawer.vue'
import MeterAssignDialog from '@/views/meters/MeterAssignDialog.vue'
import MeterStatusDialog from '@/views/meters/MeterStatusDialog.vue'
import MeterDeleteDialog from '@/views/meters/MeterDeleteDialog.vue'
import Select from '@/components/ds/Select.vue'
import Segmented from '@/components/ds/Segmented.vue'
import DatePicker from '@/components/ds/DatePicker.vue'
import FPTenantPicker from '@/components/fp/FPTenantPicker.vue'
import FPDrawer from '@/components/fp/FPDrawer.vue'
import {
  metersApi,
  type MeterDTO, type MeterTimelineDTO, type MeterBindingRowDTO, type MeterStatusImpactDTO,
  type MeterArchiveLogRow, type MeterStatusRow, type MeterDeleteImpactDTO,
} from '@/api/meters'
import type { WorkbenchRow } from '@/composables/useMeterWorkbench'
import type { TenantDTO } from '@/types/tenant'
import { useAuthStore } from '@/stores/auth'
import { rangeText, untilOf, logLines, revertedBatches, type LogFmt } from '@/views/meters/meterTimeline'

/**
 * 表档案抽屉按月写(METER-TIMELINE-SPEC §3.3–§3.6,PLAN C2)。
 *   资产列(倍率/编码…)照旧 PUT /{id},只带资产列;归属/位置/租户/合同绑定站在查看月 V 写一行,
 *   F<V 时二选一并写明影响哪几个月,有不能改的月份的选项灰掉;在册状态按段加/改月/撤回;
 *   变更记录里每次导入一颗「撤销」;编辑态就地转假时弹框关、写函数自守。
 */

vi.mock('@/api/meters', async (orig) => {
  const real = await orig<typeof import('@/api/meters')>()
  return {
    ...real,
    metersApi: {
      meterReadings: vi.fn(), timeline: vi.fn(), update: vi.fn(), assign: vi.fn(), clearManual: vi.fn(),
      setStatus: vi.fn(), deleteStatus: vi.fn(), statusImpact: vi.fn(), revertImport: vi.fn(),
      createReading: vi.fn(), updateReading: vi.fn(), deleteReading: vi.fn(), bind: vi.fn(), remove: vi.fn(),
      deleteImpact: vi.fn(),
    },
  }
})

const V = '2025-03'

const M: MeterDTO = {
  id: 1, kind: 'elec', zone: 'p1', name: '一车间总电', area: 'A座', spot: '三楼东侧',
  floorLabel: '三楼', side: '东侧', roomNo: '301室', locManual: 0,
  tenantName: '力灏电子', tenantId: 7, buildingId: 13, buildingZone: 'p1', ownership: 'tenant', ownerManual: 0,
  meterType: null, deviceType: 'three', subName: '电表①', code: 'E-001', factor: 500,
  status: 'active', statusFrom: '2024-01', statusUntil: null, assignFrom: '2024-01', assignUntil: null,
  assignSrc: 'import', changedThisMonth: false, tenantManual: 0, suspect: null, sortNo: 1, readingCount: 0,
}
type DrawerRow = Pick<WorkbenchRow, 'm' | 'bind' | 'tenantLabel' | 'pending'>
const rowOf = (m: Partial<MeterDTO> = {}, bind: MeterBindingRowDTO | null = null): DrawerRow =>
  ({ m: { ...M, ...m }, bind, tenantLabel: '力灏电子', pending: false })

const ASSIGN: MeterTimelineDTO['assign'][number] = {
  id: 101, meterId: 1, fromYm: '2024-01', tenantId: 7, tenantName: '力灏电子', buildingId: 13, ownership: 'tenant',
  area: 'A座', spot: '三楼东侧', floorLabel: '三楼', side: '东侧', roomNo: '301室', subName: '电表①',
  contractId: null, tenantManual: 0, ownerManual: 0, locManual: 0, src: 'import', batchId: 'b-1',
}
const STATUS: MeterStatusRow[] = [
  { id: 201, meterId: 1, fromYm: '2024-01', status: 'active', src: 'migrate', batchId: null },
  { id: 202, meterId: 1, fromYm: '2025-06', status: 'retired', src: 'manual', batchId: null },
]
/** 缺省:查看月 V 落在自 2024-01 起那一段里(F<V),「更正」那一段含一个已审核月。 */
const tlOf = (over: Partial<MeterTimelineDTO> = {}): MeterTimelineDTO => ({
  assign: [ASSIGN],
  status: STATUS,
  log: [],
  impact: {
    correct: { from: '2024-01', until: null, locked: [{ ym: '2024-02', reason: '园区抄表已审核' }] },
    from: { from: V, until: null, locked: [] },
    migrateCopies: 0,
  },
  siblings: [],
  ...over,
})
/** F = V:当前这一段正好从查看月起,且没有不能改的月份。 */
const TL_SAME = tlOf({
  impact: { correct: { from: V, until: null, locked: [] }, from: { from: V, until: null, locked: [] }, migrateCopies: 0 },
})

const tenant = (id: number, companyName: string): TenantDTO => ({
  id, companyName, contactName: null, contactPhone: null, businessType: '', status: 1, categoryId: null,
  phase: 1, since: null, monthlyRent: 0, leasedArea: 0, primaryBuilding: null, contractCount: 1,
  parentId: null, parentName: null,
})
const TENANTS = [tenant(7, '力灏电子'), tenant(8, '新租户科技')]

beforeEach(() => {
  setActivePinia(createPinia())
  useAuthStore().permissions = ['meter-reading:edit', 'meter-master:edit']
  vi.clearAllMocks()
  vi.mocked(metersApi.meterReadings).mockResolvedValue([])
  vi.mocked(metersApi.assign).mockResolvedValue([])
  vi.mocked(metersApi.update).mockResolvedValue({ ...M })
  vi.mocked(metersApi.bind).mockResolvedValue()
  vi.mocked(metersApi.clearManual).mockResolvedValue()
  vi.mocked(metersApi.setStatus).mockResolvedValue()
  vi.mocked(metersApi.deleteStatus).mockResolvedValue()
  vi.mocked(metersApi.revertImport).mockResolvedValue(3)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  vi.spyOn(window, 'alert').mockImplementation(() => {})
})

async function mountDrawer(o: { row?: DrawerRow; tl?: MeterTimelineDTO; edit?: boolean } = {}) {
  vi.mocked(metersApi.timeline).mockResolvedValue(o.tl ?? tlOf())
  const w = mount(MeterDetailDrawer, {
    props: {
      row: (o.row ?? rowOf()) as never, editMode: o.edit ?? true, defaultYm: V,
      tenants: TENANTS, buildings: [], bindAvailable: true,
      areaOpts: [], floorOpts: ['三楼', '四楼'], sideOpts: ['东侧', '西侧'],
    },
    global: { stubs: { teleport: true } },
  })
  await flushPromises()
  return w
}
const floorSelect = (w: VueWrapper) => w.findAllComponents(Select)
  .find(s => (s.props('options') as { label: string }[]).some(o => o.label === '—(跨层/不适用)'))!
const btn = (w: VueWrapper, text: string) => w.findAll('button').find(b => b.text().trim() === text)
// DatePicker 是泛型组件(generic="T"),findComponent 的重载推不出 VueWrapper
const datePicker = (w: VueWrapper) => w.findComponent(DatePicker as never) as unknown as VueWrapper
const toTab = async (w: VueWrapper, t: string) => {
  w.findComponent(Segmented).vm.$emit('update:modelValue', t)
  await flushPromises()
}

describe('meterTimeline 纯函数', () => {
  it('区间与变更记录的说法', () => {
    expect(rangeText('2024-03', '2024-08')).toBe('2024-03 ~ 2024-08')
    expect(rangeText('2024-03', null)).toBe('2024-03 起')
    expect(rangeText('2024-03', '2024-03')).toBe('2024-03')
    expect(rangeText('1900-01', null)).toBe('各月')
    expect(rangeText('1900-01', '2023-12')).toBe('2023-12 及以前')
    expect(untilOf(['2024-01', '2024-03'], 0)).toBe('2024-02')
    expect(untilOf(['2024-01', '2024-03'], 1)).toBeNull()

    const f: LogFmt = { tenant: id => ({ 7: '力灏电子', 8: '新租户科技' } as Record<number, string>)[id], building: () => undefined, ownership: o => o }
    const e = (x: Partial<MeterArchiveLogRow>): MeterArchiveLogRow => ({
      id: 1, meterId: 1, tbl: 'assign', fromYm: V, action: 'update', beforeJson: null, afterJson: null,
      src: 'manual', batchId: null, fileName: null, rowRef: null, operator: 'admin', at: '2026-09-24T10:00:00', ...x,
    })
    expect(logLines(e({ tbl: 'status', beforeJson: '{"status":"active"}', afterJson: '{"status":"retired"}' }), f))
      .toEqual(['在用 → 停用'])
    expect(logLines(e({
      beforeJson: JSON.stringify({ ...ASSIGN }),
      afterJson: JSON.stringify({ ...ASSIGN, tenantId: 8, tenantName: '新租户科技', tenantManual: 1, locManual: 4 }),
    }), f)).toEqual([
      '企业名称:力灏电子 → 新租户科技', '租户:力灏电子 → 新租户科技', '租户:按册子 → 人工设定', '楼层/方位/房号:按册子 → 人工设定 房号',
    ])
    expect([...revertedBatches([e({ rowRef: '撤销导入 b-9' }), e({ rowRef: 'Sheet1!3' })])]).toEqual(['b-9'])
  })
})

describe('表档案页签 · 资产列与按月写', () => {
  it('倍率走 PUT /{id},请求里只有资产列(不带任何归属/位置/状态字段)', async () => {
    const w = await mountDrawer()
    const inp = w.find('input[type="number"]')
    ;(inp.element as HTMLInputElement).value = '600'
    await inp.trigger('change')
    expect(metersApi.update).toHaveBeenCalledTimes(1)
    const req = vi.mocked(metersApi.update).mock.calls[0][1]
    expect(Object.keys(req).sort()).toEqual(['code', 'deviceType', 'factor', 'kind', 'meterType', 'name', 'zone'])
    expect(req.factor).toBe(600)
    expect(metersApi.assign).not.toHaveBeenCalled()
  })

  it('F<V 改楼层:弹两选一,缺省「从 V 起」;「更正」那一段含已审核月 → 灰掉并写明;确认写 V 那一行', async () => {
    const w = await mountDrawer()
    floorSelect(w).vm.$emit('update:modelValue', '四楼')
    await flushPromises()
    const dlg = w.findComponent(MeterAssignDialog)
    expect(dlg.exists()).toBe(true)
    const opts = dlg.findAll('.ad-opt')
    expect(opts.map(o => o.find('.t').text())).toEqual([`从 ${V} 起变更`, '更正自 2024-01 起的这一段'])
    expect(opts[0].attributes('aria-checked')).toBe('true')
    expect(opts[0].text()).toContain(`影响 ${V} 起`)
    expect(opts[1].attributes('disabled')).toBeDefined()
    expect(opts[1].text()).toContain('这几个月不能改:2024-02 园区抄表已审核')
    expect(dlg.text()).toContain('楼层:三楼 → 四楼')
    await btn(dlg, '确认修改')!.trigger('click')
    await flushPromises()
    expect(metersApi.assign).toHaveBeenCalledWith({
      ym: V, mode: 'from', meterIds: [1], patch: { floorLabel: '四楼' }, alsoMigrateCopies: false,
    })
    expect(w.findComponent(MeterAssignDialog).exists()).toBe(false)
    expect(metersApi.timeline).toHaveBeenCalledTimes(2)      // 写完重拉分段
    expect(w.emitted('reload')).toHaveLength(1)
  })

  it('F=V、没有同房间的表、没有上线复制段、没有不能改的月:不弹框,直接写这一行', async () => {
    const w = await mountDrawer({ tl: TL_SAME })
    const inp = w.find('input[title^="单元/房号"]')
    ;(inp.element as HTMLInputElement).value = '302室'
    await inp.trigger('change')
    await flushPromises()
    expect(w.findComponent(MeterAssignDialog).exists()).toBe(false)
    expect(metersApi.assign).toHaveBeenCalledWith({
      ym: V, mode: 'from', meterIds: [1], patch: { roomNo: '302室' }, alsoMigrateCopies: false,
    })
  })

  it('换租户:写明整月算给谁;同房间的表缺省勾上一起写;从一户换到另一户企业名称一并写成新户', async () => {
    const w = await mountDrawer({
      tl: { ...TL_SAME, siblings: [{ meterId: 2, name: '三楼水表', kind: 'water', tenantName: '力灏电子' }] },
    })
    w.findComponent(FPTenantPicker).vm.$emit('update:modelValue', 8)
    await flushPromises()
    const dlg = w.findComponent(MeterAssignDialog)
    expect(dlg.text()).toContain('水电按月抄表，2025年3月整月算给 新租户科技。')
    const ck = dlg.find('.ad-sibs input[type="checkbox"]')
    expect((ck.element as HTMLInputElement).checked).toBe(true)
    await btn(dlg, '确认修改')!.trigger('click')
    await flushPromises()
    expect(metersApi.assign).toHaveBeenCalledWith({
      ym: V, mode: 'from', meterIds: [1, 2], patch: { tenantId: 8, tenantName: '新租户科技' }, alsoMigrateCopies: false,
    })
  })

  it('编辑态就地转假:改归属的弹框关掉;弹框里留下的写函数自守,不发请求', async () => {
    const w = await mountDrawer()
    floorSelect(w).vm.$emit('update:modelValue', '四楼')
    await flushPromises()
    const run = w.findComponent(MeterAssignDialog).props('run') as (c: unknown) => Promise<unknown>
    await w.setProps({ editMode: false })
    await flushPromises()
    expect(w.findComponent(MeterAssignDialog).exists()).toBe(false)
    await run({ mode: 'from', siblingIds: [], alsoMigrate: false })
    expect(metersApi.assign).not.toHaveBeenCalled()
  })

  it('分段重拉失败:归属/位置退回只读并写出原因,资产列照常可改', async () => {
    const w = await mountDrawer()
    vi.mocked(metersApi.timeline).mockRejectedValueOnce({ message: '网络断了' })
    floorSelect(w).vm.$emit('update:modelValue', '四楼')
    await flushPromises()
    await btn(w.findComponent(MeterAssignDialog), '确认修改')!.trigger('click')
    await flushPromises()
    expect(metersApi.assign).toHaveBeenCalledTimes(1)
    expect(w.text()).toContain('网络断了 归属和位置暂时只能看。')
    expect(w.find('input[title^="单元/房号"]').exists()).toBe(false)
    expect(w.findComponent(FPTenantPicker).exists()).toBe(false)
    expect(w.find('input[type="number"]').exists()).toBe(true)
  })

  it('「改回按册子」清的是查看月那一段;那一段有不能改的月份时按钮灰掉并写明', async () => {
    const locked = await mountDrawer({ row: rowOf({ tenantManual: 1 }) })
    expect(locked.text()).toContain('租户 · 这一段导入时不按册子覆盖')
    expect(btn(locked, '改回按册子')!.attributes('disabled')).toBeDefined()
    expect(locked.text()).toContain('这几个月不能改:2024-02 园区抄表已审核')

    const w = await mountDrawer({ row: rowOf({ tenantManual: 1 }), tl: TL_SAME })
    await btn(w, '改回按册子')!.trigger('click')
    await flushPromises()
    expect(metersApi.clearManual).toHaveBeenCalledWith(1, V)
  })
})

describe('历史读数 · 早于第一条在册状态补读数', () => {
  it('先确认「这块表将从 M 起在册」;不确认就不写', async () => {
    const w = await mountDrawer({ tl: tlOf() })
    await toTab(w, 'history')
    await btn(w, '新增读数')!.trigger('click')
    datePicker(w).vm.$emit('update:modelValue', '2023-11')
    const curr = w.findAll('input.md-din.num')[1]
    await curr.setValue('100')
    vi.mocked(window.confirm).mockReturnValue(false)
    await w.find('button[title="保存"]').trigger('click')
    await flushPromises()
    expect(window.confirm).toHaveBeenCalledWith('这块表将从 2023-11 起在册。确认保存这条读数?')
    expect(metersApi.createReading).not.toHaveBeenCalled()
  })

  it('在册分段没加载出来:先重拉;还是拉不到就不存并说明原因(不许悄悄跳过在册确认)', async () => {
    const w = await mountDrawer({ tl: tlOf() })
    vi.mocked(metersApi.timeline).mockRejectedValue({ message: '网络断了' })
    await w.setProps({ defaultYm: '2025-04' })        // 换查看月 → 分段重拉,失败
    await flushPromises()
    await toTab(w, 'history')
    await btn(w, '新增读数')!.trigger('click')
    datePicker(w).vm.$emit('update:modelValue', '2023-11')
    await w.findAll('input.md-din.num')[1].setValue('100')
    const calls = vi.mocked(metersApi.timeline).mock.calls.length
    await w.find('button[title="保存"]').trigger('click')
    await flushPromises()
    expect(metersApi.timeline, '存之前先重拉一次').toHaveBeenCalledTimes(calls + 1)
    expect(vi.mocked(window.alert).mock.calls.at(-1)?.[0]).toContain('在册状态没加载出来(网络断了)')
    expect(metersApi.createReading).not.toHaveBeenCalled()

    vi.mocked(metersApi.timeline).mockResolvedValue(tlOf())
    await w.find('button[title="保存"]').trigger('click')
    await flushPromises()
    expect(window.confirm).toHaveBeenCalledWith('这块表将从 2023-11 起在册。确认保存这条读数?')
    expect(metersApi.createReading).toHaveBeenCalledTimes(1)
  })
})

describe('合同绑定页签 · 带月写', () => {
  const BIND: MeterBindingRowDTO = {
    meterId: 1, status: 'manual', bucket: 'ambiguous', contractId: null, contractNo: null, locations: [],
    candidates: [{ contractId: 55, contractNo: 'C-055', buildingName: 'A座', startDate: '2025-01-01', endDate: '2025-12-31' }],
    hasReading: true,
    suggestion: { tenantId: 8, tenantName: '新租户科技', contractId: 66, contractNo: 'C-066' },
  }
  it('点候选合同:选「从 V 起」后按查看月写绑定', async () => {
    const w = await mountDrawer({ row: rowOf({}, BIND) })
    await toTab(w, 'bind')
    await w.find('.bc-item').trigger('click')
    await flushPromises()
    const dlg = w.findComponent(MeterAssignDialog)
    expect(dlg.text()).toContain('合同:未绑定 → C-055')
    await btn(dlg, '确认修改')!.trigger('click')
    await flushPromises()
    expect(metersApi.bind).toHaveBeenCalledWith(1, 55, V, 'from')
  })

  it('建议「从本月起改归 X」:写明整月算给 X,改租户与企业名称', async () => {
    const w = await mountDrawer({ row: rowOf({}, BIND), tl: TL_SAME })
    await toTab(w, 'bind')
    await btn(w, '从本月起改归 新租户科技')!.trigger('click')
    await flushPromises()
    const dlg = w.findComponent(MeterAssignDialog)
    expect(dlg.text()).toContain('水电按月抄表，2025年3月整月算给 新租户科技。')
    await btn(dlg, '确认修改')!.trigger('click')
    await flushPromises()
    expect(metersApi.assign).toHaveBeenCalledWith({
      ym: V, mode: 'from', meterIds: [1], patch: { tenantId: 8, tenantName: '新租户科技' }, alsoMigrateCopies: false,
    })
  })

  it('钉的是别户的合同(没采用、自动也定不出):原因写实,不说「本月还没生效」', async () => {
    const w = await mountDrawer({
      row: rowOf({}, { meterId: 1, status: 'override_stale', bucket: null, contractId: null, contractNo: null,
        pinnedContractNo: 'C-001', locations: [], candidates: [], hasReading: true, suggestion: null }),
    })
    await toTab(w, 'bind')
    expect(w.text()).toContain('人工绑定的是 C-001,它不是这一段租户的合同,没有采用;该户本月也没有别的有效合同')
    expect(w.text()).not.toContain('本月还没生效')
  })

  it('编辑态里分段没加载出来:写明为什么改不了并给重试,不叫人「进入编辑模式」', async () => {
    const w = await mountDrawer({
      row: rowOf({ tenantId: null }, { meterId: 1, status: 'pending', bucket: null, contractId: null, contractNo: null,
        locations: [], candidates: [], hasReading: true, suggestion: null }),
    })
    vi.mocked(metersApi.timeline).mockRejectedValue({ message: '网络断了' })
    await w.setProps({ defaultYm: '2025-04' })
    await flushPromises()
    await toTab(w, 'bind')
    expect(w.text()).toContain('网络断了 暂时不能改绑定、挂租户。')
    expect(w.text()).not.toContain('进入编辑模式后可挂租户')
    const calls = vi.mocked(metersApi.timeline).mock.calls.length
    await btn(w, '重试')!.trigger('click')
    await flushPromises()
    expect(metersApi.timeline).toHaveBeenCalledTimes(calls + 1)
  })
})

describe('档案变更页签', () => {
  const log = (x: Partial<MeterArchiveLogRow>): MeterArchiveLogRow => ({
    id: 1, meterId: 1, tbl: 'assign', fromYm: V, action: 'update', beforeJson: '{}', afterJson: '{}',
    src: 'import', batchId: null, fileName: '三月抄表.xlsx', rowRef: null, operator: 'admin', at: '2026-09-24T10:00:00', ...x,
  })
  it('第一行状态不给撤回;撤回第二行;撤销导入每批一颗按钮,撤过的写「已撤销」', async () => {
    const w = await mountDrawer({
      tl: tlOf({
        log: [
          log({ id: 9, src: 'import', rowRef: '撤销导入 b-1' }),     // 撤 b-1 那一次写下的
          log({ id: 8, batchId: 'b-2' }),
          log({ id: 7, batchId: 'b-2', tbl: 'status' }),
          log({ id: 6, batchId: 'b-1' }),
        ],
      }),
    })
    await toTab(w, 'timeline')
    expect(w.findAll('button[title="撤回这一行"]')).toHaveLength(1)
    await w.find('button[title="撤回这一行"]').trigger('click')
    await flushPromises()
    expect(metersApi.deleteStatus).toHaveBeenCalledWith(1, '2025-06')

    const reverts = w.findAll('button').filter(b => b.text() === '撤销这次导入的档案改动')
    expect(reverts).toHaveLength(1)
    expect(w.findAll('.tp-done').map(x => x.text())).toEqual(['这次导入的档案改动已撤销'])
    await reverts[0].trigger('click')
    await flushPromises()
    expect(metersApi.revertImport).toHaveBeenCalledWith('b-2')
    expect(w.text()).toContain('已还原 3 行档案,读数没有动。')
  })
  it('顶部那一句(SPEC §10.4):本月册子出自哪个文件、什么时候;册子里没有这块表就直说', async () => {
    const seen = { ...rowOf({ bookSeen: true, bookFile: '三月抄表.xlsx', bookAt: '2026-09-24T10:30:00' }), book: 'seen' }
    const w = await mountDrawer({ row: seen as DrawerRow })
    await toTab(w, 'timeline')
    expect(w.find('.md-book').text()).toBe('本月册子:三月抄表.xlsx · 2026-09-24 10:30')
    await w.setProps({ row: { ...rowOf(), book: 'missing' } as never })
    await flushPromises()
    expect(w.find('.md-book').text()).toBe('这个月导入的册子里没有这块表')
  })
})

describe('在册状态弹框', () => {
  const impact = (x: Partial<MeterStatusImpactDTO> = {}): MeterStatusImpactDTO => ({
    from: V, until: '2025-05', locked: [], readings: [], pools: [], contractNo: null, ...x,
  })
  const mountStatus = async (row: MeterStatusRow | null) => {
    const w = mount(MeterStatusDialog, {
      props: { edit: true, meterId: 1, meterName: '一车间总电', ym: V, rows: STATUS, row },
      global: { stubs: { teleport: true } },
    })
    await flushPromises()
    return w
  }

  it('加一行停用:数出不再计费的读数月;拆除问最后抄表月,写它的次月并提示所在公摊池', async () => {
    vi.mocked(metersApi.statusImpact).mockResolvedValue(impact({
      readings: [{ ym: '2025-04', usage: 120 }, { ym: '2025-05', usage: 98 }],
      pools: [{ id: 3, name: 'A座公摊' }],
    }))
    const w = await mountStatus(null)
    expect(metersApi.statusImpact).toHaveBeenCalledWith(1, V, 'retired')
    expect(w.text()).toContain('这 2 个月的读数将不再计费')
    await btn(w, '确认,这 2 个月不再计费')!.trigger('click')
    await flushPromises()
    expect(metersApi.setStatus).toHaveBeenLastCalledWith(1, { fromYm: V, status: 'retired' })

    w.findComponent(Select).vm.$emit('update:modelValue', 'removed')
    await flushPromises()
    expect(w.text()).toContain('最后一次抄表是哪个月')
    expect(metersApi.statusImpact).toHaveBeenLastCalledWith(1, '2025-04', 'removed')
    expect(w.text()).toContain('自 2025-04 起已拆,2025-03 的读数照收。')
    expect(w.text()).toContain('这块表在公摊池 A座公摊 里')
    await btn(w, '确认,这 2 个月不再计费')!.trigger('click')
    await flushPromises()
    expect(metersApi.setStatus).toHaveBeenLastCalledWith(1, { fromYm: '2025-04', status: 'removed' })
  })

  it('区间里有不能改的月份:确认灰掉并写明是哪个月、为什么', async () => {
    vi.mocked(metersApi.statusImpact).mockResolvedValue(impact({ locked: [{ ym: '2025-04', reason: '含这块表的催缴单已导出' }] }))
    const w = await mountStatus(null)
    expect(w.text()).toContain('这几个月不能改:2025-04 含这块表的催缴单已导出')
    expect(btn(w, '确认')!.attributes('disabled')).toBeDefined()
  })

  it('第一行往后改月:原来那几个月不在册,按不计费数这几个月的读数;写的是挪月', async () => {
    vi.mocked(metersApi.statusImpact).mockImplementation(async (_id, from) => (from === '2024-01'
      ? impact({ from: '2024-01', until: '2025-05', readings: [{ ym: '2024-03', usage: 50 }, { ym: '2024-08', usage: 70 }] })
      : impact({ from, until: '2025-05' })))
    const w = await mountStatus(STATUS[0])
    datePicker(w).vm.$emit('update:modelValue', '2024-06')
    await flushPromises()
    expect(metersApi.statusImpact).toHaveBeenCalledWith(1, '2024-01', 'retired')
    expect(w.text()).toContain('2024-01 ~ 2024-05 不在册')
    expect(w.text()).toContain('这 1 个月的读数将不再计费')
    await btn(w, '确认,这 1 个月不再计费')!.trigger('click')
    await flushPromises()
    expect(metersApi.setStatus).toHaveBeenCalledWith(1, { fromYm: '2024-06', status: 'active', replaceFromYm: '2024-01' })
  })

  it('改月只能在前后两行之间:月份框限在两行之间;越过相邻行不数影响、确认灰掉', async () => {
    const rows: MeterStatusRow[] = [
      { id: 1, meterId: 1, fromYm: '2024-01', status: 'active', src: 'migrate', batchId: null },
      { id: 2, meterId: 1, fromYm: '2024-03', status: 'retired', src: 'manual', batchId: null },
      { id: 3, meterId: 1, fromYm: '2024-06', status: 'active', src: 'manual', batchId: null },
    ]
    vi.mocked(metersApi.statusImpact).mockResolvedValue(impact({ from: '2024-03', until: '2024-05' }))
    const w = mount(MeterStatusDialog, {
      props: { edit: true, meterId: 1, meterName: '一车间总电', ym: V, rows, row: rows[1] },
      global: { stubs: { teleport: true } },
    })
    await flushPromises()
    const dp = datePicker(w).props() as { min?: string; max?: string }
    expect(dp.min).toBe('2024-02')
    expect(dp.max).toBe('2024-05')
    expect(w.text()).toContain('只能挪到 2024-01 之后、2024-06 之前')
    datePicker(w).vm.$emit('update:modelValue', '2024-08')
    await flushPromises()
    expect(w.text()).toContain('这个月越过了相邻的那一行,不能这样挪。')
    expect(btn(w, '确认')!.attributes('disabled')).toBeDefined()
    datePicker(w).vm.$emit('update:modelValue', '2024-04')
    await flushPromises()
    await btn(w, '确认')!.trigger('click')
    await flushPromises()
    expect(metersApi.setStatus).toHaveBeenCalledWith(1, { fromYm: '2024-04', status: 'retired', replaceFromYm: '2024-03' })
  })

  it('保存途中不许取消 / 关闭(关了弹框卸载,写完了屏上也不刷新)', async () => {
    vi.mocked(metersApi.statusImpact).mockResolvedValue(impact())
    let resolve!: () => void
    vi.mocked(metersApi.setStatus).mockImplementation(() => new Promise<void>((r) => { resolve = r }))
    const w = await mountStatus(null)
    await btn(w, '确认')!.trigger('click')
    expect(btn(w, '取消')!.attributes('disabled')).toBeDefined()
    w.findComponent(FPDrawer).vm.$emit('close')
    expect(w.emitted('close')).toBeUndefined()
    resolve()
    await flushPromises()
    expect(w.emitted('done')).toHaveLength(1)
  })
})

describe('改归属弹框', () => {
  const IMP: MeterTimelineDTO['impact'] = {
    correct: { from: '2024-01', until: null, locked: [] }, from: { from: V, until: null, locked: [] }, migrateCopies: 0,
  }
  const mountAssign = (run: () => Promise<unknown>) => mount(MeterAssignDialog, {
    props: {
      title: '改租户', meterName: '一车间总电', ym: V, lines: [], impact: IMP, withMigrate: false, tenantTo: null, run,
      siblings: [{ meterId: 2, name: '三楼水表', kind: 'water', tenantName: '力灏电子' }],
    },
    global: { stubs: { teleport: true } },
  })

  it('同房间的表和这块表用同一个起始月写:选哪种改法就写明从哪个月起', async () => {
    const w = mountAssign(() => Promise.resolve())
    expect(w.text()).toContain(`勾上的表也自 ${V} 起一起改,各改到它自己的下一次变更之前。`)
    await w.findAll('.ad-opt')[1].trigger('click')
    expect(w.text()).toContain('勾上的表也自 2024-01 起一起改')
  })

  it('保存途中不许取消 / 关闭(关了弹框卸载,写完的刷新就丢了,输入却被复位成旧值)', async () => {
    let resolve!: () => void
    const w = mountAssign(() => new Promise<void>((r) => { resolve = r }))
    await btn(w, '确认修改')!.trigger('click')
    expect(btn(w, '取消')!.attributes('disabled')).toBeDefined()
    w.findComponent(FPDrawer).vm.$emit('close')
    expect(w.emitted('close')).toBeUndefined()
    resolve()
    await flushPromises()
    expect(w.emitted('done')).toHaveLength(1)
  })
})

describe('删除表确认框', () => {
  // 用户 2026-09-24「为什么删除南盛物流要去计费参数重新生成」:只挂在草稿单里时,确认框列单、勾上一步删完
  const IMPACT = (x: Partial<MeterDeleteImpactDTO> = {}): MeterDeleteImpactDTO => ({
    readings: 0, poolBindings: [], notices: [], draftCount: 0, lockedCount: 0, ...x,
  })
  const NS: MeterDeleteImpactDTO['notices'] = [
    { noticeId: 11, ym: '2023-08', tenantName: '南盛物流', status: 'draft', lines: 5 },
    { noticeId: 12, ym: '2024-02', tenantName: '南盛物流', status: 'draft', lines: 2 },
  ]
  const openDelete = async (imp: MeterDeleteImpactDTO) => {
    vi.mocked(metersApi.deleteImpact).mockResolvedValue(imp)
    vi.mocked(metersApi.remove).mockResolvedValue()
    const w = await mountDrawer()
    await btn(w, '删除表')!.trigger('click')
    await flushPromises()
    return { w, dlg: w.findComponent(MeterDeleteDialog) }
  }

  it('没挂任何单:不用原生 confirm,确认框里直接删,不带连删单参数;删完刷新并关抽屉', async () => {
    const { w, dlg } = await openDelete(IMPACT())
    expect(window.confirm).not.toHaveBeenCalled()
    expect(metersApi.deleteImpact).toHaveBeenCalledWith(1)
    expect(dlg.text()).toContain('删掉「一车间总电」?删了不能恢复。')
    expect(dlg.find('input[type="checkbox"]').exists()).toBe(false)
    await btn(dlg, '删除')!.trigger('click')
    await flushPromises()
    expect(metersApi.remove).toHaveBeenCalledWith(1, false)
    expect(w.findComponent(MeterDeleteDialog).exists()).toBe(false)
    expect(w.emitted('reload')).toHaveLength(1)
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('只挂在草稿单里:列出月份 · 户名 · 行数;默认不勾、不勾删不了;勾上删,带连删单参数', async () => {
    useAuthStore().permissions = ['meter-master:edit', 'billing-run:edit']
    const { dlg } = await openDelete(IMPACT({ notices: NS, draftCount: 2 }))
    expect(dlg.findAll('.dd-list li').map(l => l.text())).toEqual(['2023-08 · 南盛物流 · 草稿 5 行', '2024-02 · 南盛物流 · 草稿 2 行'])
    const ck = dlg.find('input[type="checkbox"]')
    expect(dlg.find('.dd-ck').text()).toBe('同时删掉这 2 张草稿催缴单(这几个月会显示需重算,重算后按现在的读数重出)')
    expect((ck.element as HTMLInputElement).checked).toBe(false)
    expect(btn(dlg, '删除')!.attributes('disabled')).toBeDefined()
    await ck.setValue(true)
    expect(btn(dlg, '删除')!.attributes('disabled')).toBeUndefined()
    await btn(dlg, '删除')!.trigger('click')
    await flushPromises()
    expect(metersApi.remove).toHaveBeenCalledWith(1, true)
  })

  it('里面有已作废的单:勾选项写「草稿/已作废」,与列表一致', async () => {
    useAuthStore().permissions = ['meter-master:edit', 'billing-run:edit']
    const { dlg } = await openDelete(IMPACT({
      notices: [NS[0], { noticeId: 14, ym: '2024-02', tenantName: '南盛物流', status: 'void', lines: 2 }], draftCount: 2,
    }))
    expect(dlg.findAll('.dd-list li').map(l => l.text())[1]).toBe('2024-02 · 南盛物流 · 已作废 2 行')
    expect(dlg.find('.dd-ck').text()).toContain('同时删掉这 2 张草稿/已作废催缴单(')
  })

  it('只挂在草稿单里、没有出账运行权限:不给勾,写明要谁来删,确认灰掉', async () => {
    useAuthStore().permissions = ['meter-reading:edit', 'meter-master:edit']
    const { dlg } = await openDelete(IMPACT({ notices: NS, draftCount: 2 }))
    expect(dlg.find('input[type="checkbox"]').exists()).toBe(false)
    expect(dlg.text()).toContain('删这些草稿单要有「出账运行」权限')
    expect(btn(dlg, '删除')!.attributes('disabled')).toBeDefined()
  })

  it('有已确认 / 已导出的单:一起列出,不给勾,确认灰掉,指到催缴单屏作废', async () => {
    useAuthStore().permissions = ['meter-master:edit', 'billing-run:edit']
    const { dlg } = await openDelete(IMPACT({
      notices: [NS[0], { noticeId: 13, ym: '2024-05', tenantName: '南盛物流', status: 'exported', lines: 1 }],
      draftCount: 1, lockedCount: 1,
    }))
    expect(dlg.findAll('.dd-list li.lk').map(l => l.text())).toEqual(['2024-05 · 南盛物流 · 已导出 1 行'])
    expect(dlg.find('input[type="checkbox"]').exists()).toBe(false)
    expect(dlg.text()).toContain('其中 1 张已确认、已导出或已签发,不能跟着删。先到催缴单屏作废这些单')
    expect(btn(dlg, '删除')!.attributes('disabled')).toBeDefined()
    // 只挂在锁定单里(没有草稿可勾):确认照样灰掉
    const only = await openDelete(IMPACT({
      notices: [{ noticeId: 13, ym: '2024-05', tenantName: '南盛物流', status: 'exported', lines: 1 }], lockedCount: 1,
    }))
    expect(btn(only.dlg, '删除')!.attributes('disabled')).toBeDefined()
  })

  it('编辑态就地转假:确认框关掉;写函数自守,直接调也不删', async () => {
    const { w } = await openDelete(IMPACT())
    await w.setProps({ editMode: false })
    await flushPromises()
    expect(w.findComponent(MeterDeleteDialog).exists()).toBe(false)
    const d = mount(MeterDeleteDialog, {
      props: { edit: false, meterId: 1, meterName: '一车间总电', run: (drop: boolean) => metersApi.remove(1, drop) },
      global: { stubs: { teleport: true } },
    })
    await flushPromises()
    await (d.vm as unknown as { confirm: () => Promise<void> }).confirm()
    expect(metersApi.remove).not.toHaveBeenCalled()
  })

  it('删到一半编辑态转假(确认框被卸载):删完照样刷新列表、关抽屉', async () => {
    const { w, dlg } = await openDelete(IMPACT())
    let resolve!: () => void
    vi.mocked(metersApi.remove).mockImplementation(() => new Promise<void>((r) => { resolve = r }))
    await btn(dlg, '删除')!.trigger('click')
    await w.setProps({ editMode: false })
    await flushPromises()
    expect(w.findComponent(MeterDeleteDialog).exists()).toBe(false)
    resolve()
    await flushPromises()
    expect(w.emitted('reload')).toHaveLength(1)
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('切走页签(KeepAlive 停用)再切回:确认框不留在屏上', async () => {
    vi.mocked(metersApi.deleteImpact).mockResolvedValue(IMPACT())
    vi.mocked(metersApi.timeline).mockResolvedValue(tlOf())
    const props = {
      row: rowOf() as never, editMode: true, defaultYm: V, tenants: TENANTS, buildings: [], bindAvailable: true,
      areaOpts: [], floorOpts: [], sideOpts: [],
    }
    const Host = defineComponent({
      props: { on: Boolean },
      setup: (p) => () => h(KeepAlive, null, p.on ? h(MeterDetailDrawer, props) : h('i')),
    })
    const w = mount(Host, { props: { on: true }, global: { stubs: { teleport: true } } })
    await flushPromises()
    await btn(w, '删除表')!.trigger('click')
    await flushPromises()
    expect(w.findComponent(MeterDeleteDialog).exists()).toBe(true)
    await w.setProps({ on: false })
    await w.setProps({ on: true })
    await flushPromises()
    expect(w.findComponent(MeterDeleteDialog).exists()).toBe(false)
  })

  it('影响没查出来:错误常驻、确认灰掉;重试成功才清', async () => {
    vi.mocked(metersApi.deleteImpact).mockRejectedValueOnce({ message: '网络断了' })
    const { dlg } = await openDelete(IMPACT())
    // openDelete 里的 mockResolvedValue 在 Once 之后才生效:第一次失败,重试成功
    expect(dlg.find('.dd-err').text()).toContain('网络断了')
    expect(btn(dlg, '删除')!.attributes('disabled')).toBeDefined()
    await btn(dlg, '重试')!.trigger('click')
    await flushPromises()
    expect(dlg.find('.dd-err').text()).toBe('')
    expect(btn(dlg, '删除')!.attributes('disabled')).toBeUndefined()
  })
})

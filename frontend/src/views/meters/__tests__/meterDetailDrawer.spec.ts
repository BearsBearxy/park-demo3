import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
import { askQueue, answer } from '@/utils/ask'
import { receipts } from '@/utils/receipt'

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
  useAuthStore().permissions = ['meters:edit', 'meters:archive']
  vi.clearAllMocks()
  vi.mocked(metersApi.meterReadings).mockResolvedValue([])
  vi.mocked(metersApi.assign).mockResolvedValue([])
  vi.mocked(metersApi.update).mockResolvedValue({ ...M })
  vi.mocked(metersApi.bind).mockResolvedValue()
  vi.mocked(metersApi.clearManual).mockResolvedValue()
  vi.mocked(metersApi.setStatus).mockResolvedValue()
  vi.mocked(metersApi.deleteStatus).mockResolvedValue()
  vi.mocked(metersApi.revertImport).mockResolvedValue(3)
  askQueue.splice(0)
  receipts.splice(0)
})
/** 答复队头那一条确认(FPConfirmHost 挂在 AppShell,这里直接答) */
const reply = async (ok: boolean) => { answer(ok); await flushPromises() }

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
    const inp = w.find('input[aria-label^="单元/房号"]')
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
    expect(w.find('input[aria-label^="单元/房号"]').exists()).toBe(false)
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
    expect(askQueue[0].title).toBe(`清掉 ${V} 起 这一段的人工设定？`)
    await reply(true)
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
    await w.find('button[aria-label="保存"]').trigger('click')
    await flushPromises()
    expect(askQueue.map(a => a.title)).toEqual(['这块表将从 2023-11 起在册，保存这条读数？'])
    await reply(false)
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
    await w.find('button[aria-label="保存"]').trigger('click')
    await flushPromises()
    expect(metersApi.timeline, '存之前先重拉一次').toHaveBeenCalledTimes(calls + 1)
    expect(receipts.at(-1)?.tone).toBe('fail')
    expect(receipts.at(-1)?.text).toContain('在册状态没加载出来(网络断了)')
    expect(askQueue, '不许悄悄跳过在册确认').toHaveLength(0)
    expect(metersApi.createReading).not.toHaveBeenCalled()

    vi.mocked(metersApi.timeline).mockResolvedValue(tlOf())
    await w.find('button[aria-label="保存"]').trigger('click')
    await flushPromises()
    expect(askQueue.map(a => a.title)).toEqual(['这块表将从 2023-11 起在册，保存这条读数？'])
    await reply(true)
    expect(metersApi.createReading).toHaveBeenCalledTimes(1)
  })
})

describe('历史读数 · 挪月的用量预览', () => {
  // 挪到别的月份 = 在那个月新录一条,后端按当前表倍率重新快照(2026-10-04 安全修复)。预览和提示得跟着,
  // 不然屏上说「按原倍率快照计」、存进去的却是当前倍率。破坏验证:previewFactor 恒取原快照 → 第二句断言红。
  it('月份没改按原快照预览;挪到别的月份按当前表倍率', async () => {
    vi.mocked(metersApi.meterReadings).mockResolvedValue([{
      id: 9, meterId: 1, ym: '2025-02', prevTotal: 0, currTotal: 1,
      prevSharp: null, prevPeak: null, prevFlat: null, prevValley: null,
      currSharp: null, currPeak: null, currFlat: null, currValley: null,
      factorSnap: 100, usageTotal: 100, usageSharp: null, usagePeak: null, usageFlat: null, usageValley: null,
      note: null, source: 'manual',
    }])
    const w = await mountDrawer()
    await toTab(w, 'history')
    await w.findAll('button.mt-iop').find(b => !b.classes('danger'))!.trigger('click')
    await flushPromises()
    const preview = () => w.find('tr.editing td.ro').text()
    expect(preview()).toBe('100')
    datePicker(w).vm.$emit('update:modelValue', '2025-01')
    await flushPromises()
    expect(preview(), '挪月按当前表倍率 500').toBe('500')
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
    // 写在挂租户的位置上(原页签顶上那条满宽红条撤掉,2026-10-03 横条收尾)
    expect(w.find('.md-bpend .md-bhint.bad').text()).toBe('网络断了 暂时不能挂租户。重试')
    expect(w.find('.fp-note').exists(), '页签顶上不再有满宽红条').toBe(false)
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
    expect(w.findAll('button[aria-label="撤回这一行"]')).toHaveLength(1)
    await w.find('button[aria-label="撤回这一行"]').trigger('click')
    await flushPromises()
    expect(metersApi.deleteStatus, '先问').not.toHaveBeenCalled()
    expect(askQueue[0].title).toBe('撤回「停用 · 2025-06 起」这一行？')
    await reply(true)
    expect(metersApi.deleteStatus).toHaveBeenCalledWith(1, '2025-06')

    const reverts = w.findAll('button').filter(b => b.text() === '撤销这次导入的档案改动')
    expect(reverts).toHaveLength(1)
    expect(w.findAll('.tp-done').map(x => x.text())).toEqual(['这次导入的档案改动已撤销'])
    await reverts[0].trigger('click')
    await flushPromises()
    await reply(true)
    expect(metersApi.revertImport).toHaveBeenCalledWith('b-2')
    expect(receipts.map(r => [r.tone, r.text])).toContainEqual(['ok', '已还原 3 行档案,读数没有动。'])
    expect(w.text(), '结果不再是流内一行字').not.toContain('已还原')
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

describe('T19 · 抽屉里的提示件(机械替换)', () => {
  const READ = (id: number, ym: string) => ({
    id, meterId: 1, ym, prevTotal: 100, currTotal: 120,
    prevSharp: null, prevPeak: null, prevFlat: null, prevValley: null,
    currSharp: null, currPeak: null, currFlat: null, currValley: null,
    factorSnap: 500, usageTotal: 10000, usageSharp: null, usagePeak: null, usageFlat: null, usageValley: null,
    note: null, source: 'manual' as const,
  })

  it('标识名清空 / 倍率填负数:字段下面写原因(常驻 18 高那一行),不发请求、不出回执', async () => {
    const w = await mountDrawer()
    const name = w.find('input[aria-label^="同分区同类唯一"]')
    ;(name.element as HTMLInputElement).value = '  '
    await name.trigger('change')
    const fac = w.find('input[type="number"]')
    ;(fac.element as HTMLInputElement).value = '-2'
    await fac.trigger('change')
    expect(w.findAll('.fp-field-err').map(p => p.text())).toEqual(['标识名不能为空', '倍率需为正数'])
    expect(metersApi.update).not.toHaveBeenCalled()
    expect(receipts).toHaveLength(0)
  })

  it('保存失败走失败回执(不自收),原因原样', async () => {
    vi.mocked(metersApi.update).mockRejectedValueOnce({ message: '与已有表重名' })
    const w = await mountDrawer()
    const name = w.find('input[aria-label^="同分区同类唯一"]')
    ;(name.element as HTMLInputElement).value = '二车间总电'
    await name.trigger('change')
    await flushPromises()
    expect(receipts.map(r => [r.tone, r.text])).toEqual([['fail', '与已有表重名']])
  })

  it('删读数是删除类确认(红钮、焦点在取消):不答就不删,答了才删', async () => {
    vi.mocked(metersApi.meterReadings).mockResolvedValue([READ(31, '2025-02')])
    const w = await mountDrawer()
    await toTab(w, 'history')
    await w.find('button[aria-label="删除"]').trigger('click')
    await flushPromises()
    expect(askQueue.map(a => [a.title, a.action, a.danger])).toEqual([['删除 2025-02 的读数？', '删除', true]])
    expect(metersApi.deleteReading).not.toHaveBeenCalled()
    await reply(true)
    expect(metersApi.deleteReading).toHaveBeenCalledWith(31)
  })

  it('认领为独立表先问;答了才写 suspect 清空', async () => {
    const w = await mountDrawer({ row: rowOf({ suspect: 'shadow' }) })
    await btn(w, '认领为独立表(解除存疑)')!.trigger('click')
    await flushPromises()
    expect(askQueue.map(a => a.title)).toEqual(['把「一车间总电」认领为独立的一块表？'])
    expect(metersApi.update).not.toHaveBeenCalled()
    await reply(true)
    expect(vi.mocked(metersApi.update).mock.calls[0][1]).toMatchObject({ suspect: '' })
  })

  it('历史读数 / 合同绑定没东西可显示:空状态件占住页签内容区(不是灰字一行)', async () => {
    const w = await mountDrawer()
    await toTab(w, 'history')
    expect(w.find('.fp-empty .t').text()).toBe('该表暂无读数')
    expect(w.find('.fp-empty .sub').text()).toContain('「新增读数」')
    await toTab(w, 'bind')
    expect(w.find('.fp-empty:not(.error)').text()).toBe('该表不在本月绑定报表中')
    await w.setProps({ bindAvailable: false })
    expect(w.find('.fp-empty.error .t').text()).toBe('本月的绑定数据没读到')
    // 页面那趟还在路上:加载中,不出失败态。破坏验证:抽屉里删掉 bindLoading 那一支 → 红
    await w.setProps({ bindAvailable: true, bindLoading: true })
    expect(w.find('.fp-empty.error').exists(), '在途不是没读到').toBe(false)
    expect(w.find('.md-empty').text()).toBe('加载中…')
    const pub = await mountDrawer({ row: rowOf({ ownership: 'share' }) })
    await toTab(pub, 'bind')
    expect(pub.find('.fp-empty .t').text()).toMatch(/^非租户表\(.+\)无合同绑定$/)
    expect(pub.find('.md-empty').exists()).toBe(false)
  })

  it('历史读数没读到:整块换成加载失败件(role=alert),唯一的钮「重试」重拉', async () => {
    vi.mocked(metersApi.meterReadings).mockRejectedValueOnce({ message: '历史读数没读到' })
    const w = await mountDrawer()
    await toTab(w, 'history')
    const fail = w.find('[role="alert"]')
    expect(fail.text()).toContain('历史读数没读到')
    expect(w.find('.md-htable').exists()).toBe(false)
    const calls = vi.mocked(metersApi.meterReadings).mock.calls.length
    await fail.find('button').trigger('click')
    await flushPromises()
    expect(metersApi.meterReadings).toHaveBeenCalledTimes(calls + 1)
  })

  it('抽屉 / 抄表格 / 档案变更 / 本 spec 四个文件:没有原生确认与提示框,模板里没有原生 title', () => {
    const dir = join(__dirname, '..')
    const files = ['MeterDetailDrawer.vue', 'MeterLedgerGrid.vue', 'MeterTimelinePane.vue', '__tests__/meterDetailDrawer.spec.ts']
    const native = new RegExp(['window\\.(confirm|alert)\\b', '(?<![.\\w])(confirm|alert)\\('].join('|'))
    // 小写原生标签,或透传到原生的 ds 组件(Select / Button 没有声明 title prop)上的 title= / :title=
    const titled = /<([a-z][\w-]*|Select|Button)\b[^>]*?\s:?title=/
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8')
      expect(native.test(src), `${f} 里还有原生确认 / 提示框`).toBe(false)
      if (f.endsWith('.vue')) {
        const tpl = src.slice(src.indexOf('<template>'), src.lastIndexOf('</template>'))
        expect(tpl.match(titled)?.[0] ?? null, `${f} 模板里还有原生 title`).toBeNull()
      }
    }
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

  it('没挂任何单:不另弹确认,确认框里直接删,不带连删单参数;删完刷新并关抽屉', async () => {
    const { w, dlg } = await openDelete(IMPACT())
    expect(askQueue).toHaveLength(0)
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
    useAuthStore().permissions = ['meters:archive', 'bill-notices:edit']
    const { dlg } = await openDelete(IMPACT({ notices: NS, draftCount: 2 }))
    expect(dlg.findAll('.dd-list li').map(l => l.text())).toEqual(['2023-08 · 南盛物流 · 草稿 5 行', '2024-02 · 南盛物流 · 草稿 2 行'])
    const ck = dlg.find('input[type="checkbox"]')
    expect(dlg.find('.dd-ck').text()).toBe('同时删掉这 2 张草稿催缴单(这几张单上的是上个月的水电,那几个抄表月会显示需重算,重算后按现在的读数重出)')
    expect((ck.element as HTMLInputElement).checked).toBe(false)
    expect(btn(dlg, '删除')!.attributes('disabled')).toBeDefined()
    await ck.setValue(true)
    expect(btn(dlg, '删除')!.attributes('disabled')).toBeUndefined()
    await btn(dlg, '删除')!.trigger('click')
    await flushPromises()
    expect(metersApi.remove).toHaveBeenCalledWith(1, true)
  })

  it('里面有已作废的单:勾选项写「草稿/已作废」,与列表一致', async () => {
    useAuthStore().permissions = ['meters:archive', 'bill-notices:edit']
    const { dlg } = await openDelete(IMPACT({
      notices: [NS[0], { noticeId: 14, ym: '2024-02', tenantName: '南盛物流', status: 'void', lines: 2 }], draftCount: 2,
    }))
    expect(dlg.findAll('.dd-list li').map(l => l.text())[1]).toBe('2024-02 · 南盛物流 · 已作废 2 行')
    expect(dlg.find('.dd-ck').text()).toContain('同时删掉这 2 张草稿/已作废催缴单(')
  })

  it('只挂在草稿单里、没有出账运行权限:不给勾,写明要谁来删,确认灰掉', async () => {
    useAuthStore().permissions = ['meters:edit', 'meters:archive']
    const { dlg } = await openDelete(IMPACT({ notices: NS, draftCount: 2 }))
    expect(dlg.find('input[type="checkbox"]').exists()).toBe(false)
    expect(dlg.text()).toContain('删这些草稿单要有「催缴单 · 编辑」权限')
    expect(btn(dlg, '删除')!.attributes('disabled')).toBeDefined()
  })

  it('有已确认 / 已导出的单:一起列出,不给勾,确认灰掉,指到催缴单屏作废', async () => {
    useAuthStore().permissions = ['meters:archive', 'bill-notices:edit']
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

// ── 对抗复查(asserts-2):原生确认框换成异步 ask() 之后,「问着的时候编辑权被接管 / 提权到期,答了是也不写」成了新防线 ──
// 每条:触发写操作 → 确认排上 → 编辑态打假(setProps editMode:false)→ 答「是」→ 对应接口一次都不调
describe('对抗复查 · 问着的时候退出了编辑态,答了也不写', () => {
  const READ1 = {
    id: 31, meterId: 1, ym: '2025-02', prevTotal: 100, currTotal: 120,
    prevSharp: null, prevPeak: null, prevFlat: null, prevValley: null,
    currSharp: null, currPeak: null, currFlat: null, currValley: null,
    factorSnap: 500, usageTotal: 10000, usageSharp: null, usagePeak: null, usageFlat: null, usageValley: null,
    note: null, source: 'manual' as const,
  }
  // 破坏验证:delReading 里 ask 之后的 `!editReading.value ||` 删掉 → 红
  it('删读数', async () => {
    vi.mocked(metersApi.meterReadings).mockResolvedValue([READ1])
    const w = await mountDrawer()
    await toTab(w, 'history')
    await w.find('button[aria-label="删除"]').trigger('click')
    await flushPromises()
    expect(askQueue[0]?.title).toBe('删除 2025-02 的读数？')
    await w.setProps({ editMode: false })
    await reply(true)
    expect(metersApi.deleteReading).not.toHaveBeenCalled()
  })

  // 破坏验证:保存读数时在册确认之后的 `!editReading.value ||` 删掉 → 红
  it('补早于在册的读数(「这块表将从 M 起在册」)', async () => {
    const w = await mountDrawer({ tl: tlOf() })
    await toTab(w, 'history')
    await btn(w, '新增读数')!.trigger('click')
    datePicker(w).vm.$emit('update:modelValue', '2023-11')
    await w.findAll('input.md-din.num')[1].setValue('100')
    await w.find('button[aria-label="保存"]').trigger('click')
    await flushPromises()
    expect(askQueue.map(a => a.title)).toEqual(['这块表将从 2023-11 起在册，保存这条读数？'])
    await w.setProps({ editMode: false })
    await reply(true)
    expect(metersApi.createReading).not.toHaveBeenCalled()
  })

  // 破坏验证:clearManual 里 ask 之后的 `!canAssign.value ||` 删掉 → 红
  it('改回按册子', async () => {
    const w = await mountDrawer({ row: rowOf({ tenantManual: 1 }), tl: TL_SAME })
    await btn(w, '改回按册子')!.trigger('click')
    await flushPromises()
    expect(askQueue[0]?.title).toBe(`清掉 ${V} 起 这一段的人工设定？`)
    await w.setProps({ editMode: false })
    await reply(true)
    expect(metersApi.clearManual).not.toHaveBeenCalled()
  })

  // 破坏验证:clearSuspect 里 ask 之后的 `!editProfile.value ||` 删掉 → 红
  it('认领为独立表(解除存疑)', async () => {
    const w = await mountDrawer({ row: rowOf({ suspect: 'shadow' }) })
    await btn(w, '认领为独立表(解除存疑)')!.trigger('click')
    await flushPromises()
    expect(askQueue[0]?.title).toBe('把「一车间总电」认领为独立的一块表？')
    await w.setProps({ editMode: false })
    await reply(true)
    expect(metersApi.update).not.toHaveBeenCalled()
  })
})

// ── 横条收尾(2026-10-03,实现规范 §2「横条盘点」MeterDetailDrawer 四行 + MeterAssignDialog) ──
describe('抽屉里的说明都落在受影响的那一处,不再是满宽条', () => {
  const tipOf = (el: Element) => (el as HTMLElement & { _tip?: { text: string } })._tip?.text
  /** 先正常加载出分段,改一次楼层,写完重拉分段失败 —— 手上留着上次那份(同「分段重拉失败」那条的走法) */
  async function staleDrawer(row?: DrawerRow) {
    const w = await mountDrawer({ row })
    vi.mocked(metersApi.timeline).mockRejectedValue({ message: '网络断了' })
    floorSelect(w).vm.$emit('update:modelValue', '四楼')
    await flushPromises()
    await btn(w.findComponent(MeterAssignDialog), '确认修改')!.trigger('click')
    await flushPromises()
    return w
  }

  // 破坏验证:.md-tlerr 那段删掉 / 把 .md-note 满宽条加回来 → 红
  it('❗表档案:被锁原因 + 重试标在「区域」格下面;表单顶上没有满宽红条;这格常驻占位', async () => {
    for (const edit of [true, false]) {
      const ok = await mountDrawer({ edit })
      const slot = ok.find('.md-grid .md-fld .md-tlslot')
      expect(slot.exists(), '常驻占位(浏览态也在),出错 / 进出编辑态都不把下面的格子顶下去').toBe(true)
      expect(slot.text()).toBe('')
    }

    const w = await staleDrawer()
    const err = w.find('.md-grid .md-fld .md-tlslot')
    expect(err.element.parentElement!.querySelector('label')!.textContent).toBe('区域(楼栋/车间)')
    expect(err.text()).toBe('网络断了 归属和位置暂时只能看。重试')
    expect(w.find('.md-grid .fp-note').exists(), '满宽红条不许回来').toBe(false)
    const calls = vi.mocked(metersApi.timeline).mock.calls.length
    await err.find('button').trigger('click')
    await flushPromises()
    expect(metersApi.timeline).toHaveBeenCalledTimes(calls + 1)
  })

  // 破坏验证:候选合同那一处的 v-else-if 删掉 → 红
  it('❗合同绑定(非待核):原因 + 重试写在候选合同 / 解绑那一处', async () => {
    const BIND: MeterBindingRowDTO = {
      meterId: 1, status: 'manual', bucket: 'ambiguous', contractId: null, contractNo: null, locations: [],
      candidates: [{ contractId: 55, contractNo: 'C-055', buildingName: 'A座', startDate: '2025-01-01', endDate: '2025-12-31' }],
      hasReading: true, suggestion: null,
    }
    const w = await staleDrawer(rowOf({}, BIND))
    await toTab(w, 'bind')
    const err = w.find('.md-bcands + .md-bhint')
    expect(err.classes()).toContain('bad')
    expect(err.text()).toBe('网络断了 暂时不能改绑定。重试')
    expect(w.findAll('.fp-note')).toHaveLength(0)
  })

  // 破坏验证:.md-sugg 外壳去掉(FPNote 直接 v-if)/ min-height 改小 → 红
  it('❗改归建议:块内提示常驻 32px 预留位,有没有建议下面的块都在同一处', async () => {
    const base: MeterBindingRowDTO = { meterId: 1, status: 'manual', bucket: 'ambiguous', contractId: null, contractNo: null,
      locations: [], candidates: [], hasReading: true, suggestion: null }
    const without = await mountDrawer({ row: rowOf({}, base) })
    await toTab(without, 'bind')
    const withS = await mountDrawer({ row: rowOf({}, { ...base, suggestion: { tenantId: 8, tenantName: '新租户科技', contractId: 66, contractNo: 'C-066' } }) })
    await toTab(withS, 'bind')
    // 两种情况下 body 的子块序列一样:建议那一格都在,只是空着
    const seq = (w: VueWrapper) => [...w.find('.fp-dwr-body').element.children].map(e => e.className)
    expect(seq(without)).toEqual(seq(withS))
    expect(without.find('.md-sugg').text()).toBe('')
    expect(withS.find('.md-sugg .fp-note').text()).toContain('本月在租、合同场地的房号对得上这块表的:新租户科技 · C-066')
    const css = readFileSync(join(__dirname, '../MeterDetailDrawer.vue'), 'utf8')
    expect(css).toMatch(/\.md-sugg\s*\{\s*min-height:\s*32px/)
  })

  // 破坏验证:标题旁那枚签删掉 / FPNote 红条加回档案变更页签 → 红
  it('❗档案变更:重新加载失败、手上有旧数据 → 标题旁「旧数据 · 只读」,悬停写原因,旁边带重试;旧时间线照常显示', async () => {
    const w = await staleDrawer()
    await toTab(w, 'timeline')
    const tag = w.find('.fp-dwr-hd .md-stale')
    expect(tag.text()).toBe('旧数据 · 只读')
    expect(tipOf(tag.element)).toBe('网络断了 下面是上次加载的样子,暂时不能改。')
    expect(w.find('.fp-dwr-body .fp-note').exists(), '正文不再有满宽红条').toBe(false)
    expect(w.findComponent({ name: 'MeterTimelinePane' }).exists(), '旧数据照常只读显示').toBe(true)
    const calls = vi.mocked(metersApi.timeline).mock.calls.length
    await w.find('.fp-dwr-hd .md-stale + .md-link').trigger('click')
    await flushPromises()
    expect(metersApi.timeline).toHaveBeenCalledTimes(calls + 1)
    await toTab(w, 'profile')
    expect(w.find('.fp-dwr-hd .md-stale').exists(), '只挂在档案变更页签').toBe(false)
  })

  // 破坏验证:选项副句里那一句删掉 / FPNote 加回来 → 红
  it('❗改归属换租户:「整月算给谁」写在每个选项自己的副句里,选项组下面没有满宽说明', async () => {
    const BIND: MeterBindingRowDTO = {
      meterId: 1, status: 'manual', bucket: 'ambiguous', contractId: null, contractNo: null, locations: [], candidates: [],
      hasReading: true, suggestion: { tenantId: 8, tenantName: '新租户科技', contractId: 66, contractNo: 'C-066' },
    }
    const w = await mountDrawer({ row: rowOf({}, BIND) })
    await toTab(w, 'bind')
    await btn(w, '从本月起改归 新租户科技')!.trigger('click')
    await flushPromises()
    const dlg = w.findComponent(MeterAssignDialog)
    const subs = dlg.findAll('.ad-opt').map(o => o.findAll('.s').map(x => x.text()))
    expect(subs).toEqual([
      ['影响 2025-03 起', '水电按月抄表，2025年3月整月算给 新租户科技。'],
      ['影响 2024-01 起', '水电按月抄表，2024年1月整月算给 新租户科技。'],
    ])
    expect(dlg.find('.fp-note').exists()).toBe(false)
  })
})

// S4 · T26 机械替换 M7(楼栋 / 租户):提示件换成十件标准件后的行为。钉五条会真出事的:
// ① 删除类确认走 ask(danger),只有答「删除…」才发请求 / 上抛;
// ② 写失败报回执(不自收)、带「重试」,重试钉住当时那一条(回执挂着时抽屉可能已换了一栋);
// ③ 表单错误贴在字段下的 .fp-field-err,不走回执;
// ④ 列表筛空换 FPEmpty;⑤ 图标钮的悬停说明顺带补 aria-label(原生 title 给的可读名不能丢)。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { askQueue, answer } from '@/utils/ask'
import { receipts } from '@/utils/receipt'
import { useAuthStore } from '@/stores/auth'
import type { BuildingDTO, BuildingDetailDTO, BuildingSummaryDTO, UnitDTO } from '@/types/building'
import type { TenantDTO, TenantDetailDTO, TenantSummaryDTO } from '@/types/tenant'

vi.mock('@/api/building', () => ({
  buildingApi: {
    list: vi.fn(), summary: vi.fn(), detail: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(),
    addUnit: vi.fn(), updateUnit: vi.fn(), removeUnit: vi.fn(),
  },
}))
vi.mock('@/api/tenant', () => ({
  tenantApi: {
    list: vi.fn(), summary: vi.fn(), categories: vi.fn(), detail: vi.fn(),
    create: vi.fn(), update: vi.fn(), remove: vi.fn(),
  },
}))
vi.mock('@/api/zones', () => ({ zonesApi: { list: vi.fn(() => Promise.resolve([])) } }))
vi.mock('@/analysis/anaData', () => ({ invalidateAnaCache: vi.fn() }))

import { buildingApi } from '@/api/building'
import { tenantApi } from '@/api/tenant'
import BuildingDrawer from '@/views/buildings/BuildingDrawer.vue'
import BuildingsView from '@/views/buildings/BuildingsView.vue'
import BuildingCard from '@/views/buildings/BuildingCard.vue'
import BuildingNewDialog from '@/views/buildings/BuildingNewDialog.vue'
import TenantDrawer from '@/views/tenants/TenantDrawer.vue'
import TenantNewDialog from '@/views/tenants/TenantNewDialog.vue'
import TenantsView from '@/views/tenants/TenantsView.vue'
import FPUnitMap from '@/components/fp/FPUnitMap.vue'

const B: BuildingDTO = {
  id: 11, name: '三期 G 栋', phase: 3, phaseName: '三期', zone: 'p3', kind: '厂房',
  floorCount: 2, totalArea: 6000, rentableArea: 5600, status: 1,
  unitCount: 4, occupiedCount: 1, vacantCount: 3, expiringCount: 0, reservedCount: 0, leasedArea: 1400,
  occRate: 25, monthlyRent: 42000, tenantIds: [5], tenantBuildingArea: 1400, remark: null,
}
const U: UnitDTO = {
  id: 101, floor: 1, unitNo: '101', area: 1400, status: 'occupied',
  tenantId: 5, tenantName: '苏州甲精密', companyName: '苏州甲精密', businessType: '智能制造',
  contractNo: 'HT-2025-001', monthlyRent: 42000,
}
const D: BuildingDetailDTO = { building: B, units: [U] }
const BS: BuildingSummaryDTO = { buildingCount: 1, stoppedCount: 0, rentableArea: 5600, occRate: 25, vacantCount: 3, unitCount: 4 }

const T: TenantDTO = {
  id: 5, companyName: '苏州甲精密', contactName: '李经理', contactPhone: '13800000000',
  businessType: '智能制造', status: 1, categoryId: null, phase: 3, since: '2023-04',
  monthlyRent: 42000, leasedArea: 1400, primaryBuilding: '三期 G 栋', contractCount: 1,
  parentId: 3, parentName: '苏州甲集团', aliases: null,
}
const TD: TenantDetailDTO = {
  tenant: T,
  contracts: [{ contractNo: 'HT-2025-001', buildingName: '三期 G 栋', floorInfo: '1F-101', startDate: '2025-01-01',
    endDate: '2027-12-31', signDate: '2024-12-20', monthlyRent: 42000, rentArea: 1400, status: 'active' }],
}
const TS: TenantSummaryDTO = { tenantActive: 1, occRate: 25, monthlyRent: 42000, expiringTenants: 0 }

const btn = (text: string) => [...document.body.querySelectorAll('button')].find(b => b.textContent?.trim() === text)!

let w: VueWrapper | null = null
beforeEach(() => {
  setActivePinia(createPinia())
  useAuthStore().permissions = ['master:edit', 'contract:edit']
  askQueue.splice(0)
  receipts.splice(0)
  localStorage.clear()
  vi.mocked(buildingApi.detail).mockResolvedValue(D)
  vi.mocked(tenantApi.categories).mockResolvedValue([])
  vi.mocked(tenantApi.detail).mockResolvedValue(TD)
  vi.mocked(tenantApi.list).mockResolvedValue([])
})
afterEach(() => {
  w?.unmount()
  w = null
  vi.clearAllMocks()
  document.body.innerHTML = ''
})

describe('楼栋抽屉', () => {
  it('❗删楼栋走 ask(danger):问句标题、正文给单元数;答「取消」不上抛,答「删除楼栋」才上抛', async () => {
    w = mount(BuildingDrawer, { props: { open: true, building: B, detail: D }, attachTo: document.body })
    await flushPromises()
    btn('删除').click()
    await flushPromises()
    expect(askQueue).toHaveLength(1)
    expect(askQueue[0]).toMatchObject({ title: '删除「三期 G 栋」？', action: '删除楼栋', danger: true })
    expect(askQueue[0].body).toContain('4 个单元')
    answer(false)
    await flushPromises()
    expect(w.emitted('delete')).toBeUndefined()
    btn('删除').click()
    await flushPromises()
    answer(true)
    await flushPromises()
    expect(w.emitted('delete')).toHaveLength(1)
  })

  it('❗删单元:ask(danger) 答是才删;失败报回执带「重试」,重试删的仍是那一块', async () => {
    w = mount(BuildingDrawer, { props: { open: true, building: B, detail: D }, attachTo: document.body })
    await flushPromises()
    w.findComponent(FPUnitMap).vm.$emit('pick', U)
    await flushPromises()
    btn('删除单元').click()
    await flushPromises()
    expect(askQueue[0]).toMatchObject({ title: '删除单元「1F-101」？', action: '删除单元', danger: true })
    vi.mocked(buildingApi.removeUnit).mockRejectedValueOnce({ message: '存在合同记录' })
    answer(true)
    await flushPromises()
    const r = receipts.at(-1)!
    expect(r).toMatchObject({ tone: 'fail', text: '删除单元失败：存在合同记录' })
    expect(r.action?.label).toBe('重试')
    vi.mocked(buildingApi.removeUnit).mockResolvedValueOnce(undefined as never)
    r.action!.run()
    await flushPromises()
    expect(vi.mocked(buildingApi.removeUnit).mock.calls).toEqual([[101], [101]])
  })

  it('❗编辑单元:单元号空着保存 → 红字在 .fp-field-err,不发请求', async () => {
    w = mount(BuildingDrawer, { props: { open: true, building: B, detail: D }, attachTo: document.body })
    await flushPromises()
    w.findComponent(FPUnitMap).vm.$emit('pick', U)
    await flushPromises()
    btn('编辑单元').click()
    await flushPromises()
    const no = document.body.querySelector<HTMLInputElement>('.bd-dlg .bd-in')!
    no.value = '  '
    no.dispatchEvent(new Event('input'))
    await flushPromises()
    btn('保存').click()
    await flushPromises()
    expect(document.body.querySelector('.bd-dlg .fp-field-err')?.textContent).toBe('请输入单元号')
    expect(buildingApi.updateUnit).not.toHaveBeenCalled()
    expect(receipts).toHaveLength(0)
  })
})

describe('楼栋管理屏', () => {
  async function mountView(list: BuildingDTO[]) {
    vi.mocked(buildingApi.list).mockResolvedValue(list)
    vi.mocked(buildingApi.summary).mockResolvedValue(BS)
    w = mount(BuildingsView, { attachTo: document.body })
    await flushPromises()
    return w
  }

  it('❗删楼栋失败报回执带「重试」;抽屉关了再点重试,删的仍是那一栋', async () => {
    const v = await mountView([B])
    v.findComponent(BuildingCard).vm.$emit('open', B)
    await flushPromises()
    vi.mocked(buildingApi.remove).mockRejectedValueOnce({ message: '楼内有合同' })
    v.findComponent(BuildingDrawer).vm.$emit('delete')
    await flushPromises()
    const r = receipts.at(-1)!
    expect(r).toMatchObject({ tone: 'fail', text: '删除楼栋失败：楼内有合同' })
    v.findComponent(BuildingDrawer).vm.$emit('close')
    await flushPromises()
    vi.mocked(buildingApi.remove).mockResolvedValueOnce(undefined as never)
    r.action!.run()
    await flushPromises()
    expect(vi.mocked(buildingApi.remove).mock.calls).toEqual([[11], [11]])
  })

  it('❗筛空了是 FPEmpty,不是手写灰字', async () => {
    const v = await mountView([])
    expect(v.find('.fp-empty').text()).toBe('没有匹配的楼栋')
  })

  // 台账列表视图是另一处 FPEmpty(表格下面那条),卡片墙那条测不到它
  it('❗台账列表视图筛空了也是 FPEmpty', async () => {
    localStorage.setItem('fp-bd-layout', '台账列表')
    const v = await mountView([])
    expect(v.find('.mx-tablewrap .fp-empty').text()).toBe('没有匹配的楼栋')
  })
})

describe('新建楼栋弹窗', () => {
  it('❗名称空着提交 → 红字在 .fp-field-err,不上抛', async () => {
    w = mount(BuildingNewDialog, { props: { existingNames: [] }, attachTo: document.body })
    await flushPromises()
    btn('创建').click()
    await flushPromises()
    expect(document.body.querySelector('.lg-dlg .fp-field-err')?.textContent).toBe('请输入楼栋名称')
    expect(w.emitted('create')).toBeUndefined()
  })
})

describe('租户抽屉', () => {
  it('❗删租户:ask(danger) 答是才删;失败报回执带「重试」,重试成功才上抛 deleted', async () => {
    w = mount(TenantDrawer, { props: { open: true, tenant: T }, attachTo: document.body })
    await flushPromises()
    btn('删除').click()
    await flushPromises()
    expect(askQueue[0]).toMatchObject({ title: '删除「苏州甲精密」？', action: '删除租户', danger: true })
    vi.mocked(tenantApi.remove).mockRejectedValueOnce({ message: '有台账记录' })
    answer(true)
    await flushPromises()
    const r = receipts.at(-1)!
    expect(r).toMatchObject({ tone: 'fail', text: '删除租户失败：有台账记录' })
    expect(w.emitted('deleted')).toBeUndefined()
    vi.mocked(tenantApi.remove).mockResolvedValueOnce(undefined as never)
    r.action!.run()
    await flushPromises()
    expect(vi.mocked(tenantApi.remove).mock.calls).toEqual([[5], [5]])
    expect(w.emitted('deleted')).toHaveLength(1)
  })
})

describe('新增 / 编辑租户弹窗', () => {
  it('❗企业名称空着提交 → 红字在 .fp-field-err,不发请求', async () => {
    w = mount(TenantNewDialog, { attachTo: document.body })
    await flushPromises()
    btn('创建').click()
    await flushPromises()
    expect(document.body.querySelector('.fin-dlg .fp-field-err')?.textContent).toBe('请输入企业名称')
    expect(tenantApi.create).not.toHaveBeenCalled()
  })

  it('❗「清除关联」图标钮:悬停说明补上 aria-label(原生 title 给的可读名不能丢)', async () => {
    w = mount(TenantNewDialog, { props: { initial: T }, attachTo: document.body })
    await flushPromises()
    const x = document.body.querySelector('.fin-clear')!
    expect(x.getAttribute('aria-label')).toBe('清除关联(不关联)')
    expect(x.hasAttribute('title')).toBe(false)
  })
})

describe('租户管理屏', () => {
  it('❗筛空了是 FPEmpty,不是手写灰字', async () => {
    vi.mocked(tenantApi.list).mockResolvedValue([])
    vi.mocked(tenantApi.summary).mockResolvedValue(TS)
    w = mount(TenantsView, { attachTo: document.body })
    await flushPromises()
    expect(w.find('.mx-tablewrap .fp-empty').text()).toBe('没有匹配的租户')
  })
})

// 列宽铁律(LIST-PAGE §4 / §7,2026-10-02):名称列按整列全部数据定宽(余宽归行末空列)。
// 屏只把当前页(paged)交给 FPSortableTable,auto 布局按可见行排 —— 名称列不给宽的话翻页 / 搜索时宽跟着变,
// 右边一排定宽列左右平移。jsdom 每页 10 行(useFitRows 的兜底),长名放第 11 条 = 第 2 页。
describe('名称列按全部数据定宽(不按当前页)', () => {
  const thStyle = (v: VueWrapper) => (v.find('.mx-tablewrap thead th').element as HTMLElement).style

  // 破坏验证:nameColW 改成按 paged 算 → 第 1 页只有短名,72 + 39 = 111px,红;width 去掉 → '',红
  it('❗楼栋:名称列 = 图标 40 + 最长名(含第 2 页)+ 内边距 32', async () => {
    localStorage.setItem('fp-bd-layout', '台账列表')
    const LONG = '三期西区十二号综合厂房'
    const list = Array.from({ length: 11 }, (_, i) => ({ ...B, id: i + 1, name: i === 10 ? LONG : `${i + 1}号楼` }))
    vi.mocked(buildingApi.list).mockResolvedValue(list)
    vi.mocked(buildingApi.summary).mockResolvedValue(BS)
    w = mount(BuildingsView, { attachTo: document.body })
    await flushPromises()
    expect(w.find('.mx-tablewrap tbody').text(), '前置:长名在第 2 页').not.toContain(LONG)
    // 11 字 × 14 = 154 + 2 = 156(类型副行「厂房」11px 只有 24);32 + 40 + 156
    expect(thStyle(w).width).toBe('228px')
    expect(thStyle(w).minWidth).toBe('228px')
  })

  // 破坏验证:nameColW 改成按 paged / filtered 算 → 第 1 页只有「阿01」这类短名,40 + 编号副行 62 + 32 = 134px,红
  it('❗租户:企业名称列 = 头像 40 + 最长名(含第 2 页)+ 内边距 32,封顶 240 照旧', async () => {
    const LONG = '苏州某某精密机械有限公司'
    const list: TenantDTO[] = Array.from({ length: 11 }, (_, i) => ({
      ...T, id: i + 1, parentId: null, parentName: null, companyName: i === 10 ? LONG : `阿${String(i + 1).padStart(2, '0')}`,   // 族间按 zh 序:阿(a)在苏(s)前
    }))
    vi.mocked(tenantApi.list).mockResolvedValue(list)
    vi.mocked(tenantApi.summary).mockResolvedValue(TS)
    w = mount(TenantsView, { attachTo: document.body })
    await flushPromises()
    expect(w.find('.mx-tablewrap tbody').text(), '前置:长名在第 2 页').not.toContain(LONG)
    // 12 字 × 14 = 168 + 2 = 170;40 + 170 = 210 < 240 不封顶;+ 32
    expect(thStyle(w).width).toBe('242px')
    expect(thStyle(w).minWidth).toBe('242px')
  })
})

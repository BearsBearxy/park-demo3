// 结构与续约(TenantPortfolioView)的加载失败与空清单(S4 T25,画布 06-B ⑦ / 06-D 右格):
// 加载失败 → FPLoadError(按钮恒为「重试」,接上 reload);清单没有可列的户 → FPEmpty 换掉清单本身。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { ContractDTO } from '@/types/contract'
import type { TenantDTO } from '@/types/tenant'

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))
vi.mock('@/components/ana/AnaEChart.vue', () => ({
  default: { name: 'AnaEChart', props: ['option', 'height', 'entrance'], template: '<div class="stub-chart" />' },
}))
vi.mock('@/analysis/anaData', () => ({
  fetchAvailableMonths: vi.fn(),
  fetchTenants: vi.fn(),
  fetchContracts: vi.fn(),
  invalidateAnaCache: vi.fn(),
}))

import * as ana from '@/analysis/anaData'
import TenantPortfolioView from '@/views/analysis/TenantPortfolioView.vue'

// 夹具:两期、租金各异,有一份合同缺日期(续约风险那块照常走它的占位)
const ct = (id: number, tenantId: number, buildingId: number, rent: number): ContractDTO => ({
  id, contractNo: 'HT' + id, tenantId, tenantName: `租户${tenantId}`, buildingId, buildingName: '', unitId: null, floorInfo: '',
  rentArea: 100 + id, monthlyRent: rent, deposit: 0,
  startDate: id === 3 ? null : '2025-01-01', endDate: id === 3 ? null : '2027-01-01', signDate: null,
  status: 'active', kind: 'normal', termMonths: 24, daysToEnd: null, remark: null, billingLineCount: 1,
})
const CONTRACTS = [ct(1, 1, 1, 5000), ct(2, 2, 1, 3000), ct(3, 3, 2, 1200)]
const tenant = (c: ContractDTO, rent: number): TenantDTO => ({
  id: c.tenantId, companyName: c.tenantName, contactName: null, contactPhone: null, businessType: '', status: 1,
  categoryId: null, phase: c.buildingId, since: null, monthlyRent: rent, leasedArea: c.rentArea,
  primaryBuilding: `P${c.buildingId}栋`, contractCount: 1, parentId: null, parentName: null,
})
const TENANTS = CONTRACTS.map((c) => tenant(c, c.monthlyRent))

const mounted: VueWrapper[] = []
beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  vi.mocked(ana.fetchAvailableMonths).mockResolvedValue({ months: ['2026-08'], sources: { pnl: ['2026-08'], report: ['2026-08'] } })
  vi.mocked(ana.fetchTenants).mockResolvedValue(TENANTS)
  vi.mocked(ana.fetchContracts).mockResolvedValue(CONTRACTS)
})
afterEach(() => { while (mounted.length) mounted.pop()!.unmount() })

async function open() {
  const w = mount(TenantPortfolioView, { global: { stubs: { RouterLink: true, teleport: true } } })
  mounted.push(w)
  await flushPromises()
  return w
}

describe('结构与续约 · 加载失败 / 空清单', () => {
  it('❗读不到:FPLoadError(带「重试」)换掉内容;点重试再拉一次,拉到了出图表', async () => {
    vi.mocked(ana.fetchTenants).mockRejectedValueOnce(new Error('租户接口 502'))
    const w = await open()
    const err = w.find('.fp-empty.error')
    expect(err.text()).toContain('租户和合同数据没读到')
    expect(err.text()).toContain('租户接口 502')
    expect(err.find('button').text()).toBe('重试')
    expect(w.find('.av2-grid').exists()).toBe(false)
    await err.find('button').trigger('click')
    await flushPromises()
    expect(ana.fetchTenants).toHaveBeenCalledTimes(2)
    expect(w.find('.fp-empty.error').exists()).toBe(false)
    expect(w.find('.av2-grid').exists()).toBe(true)
  })

  it('❗在租户都没录月租:清单那块是 FPEmpty,不是一行灰字', async () => {
    vi.mocked(ana.fetchTenants).mockResolvedValue(CONTRACTS.map((c) => tenant(c, 0)))
    const w = await open()
    const list = w.find('.tp-list')
    expect(list.find('.fp-empty').text()).toContain('该期区暂无有月租金的租户')
    expect(list.find('.ak-tbl').exists(), '空状态换掉表本身').toBe(false)
    expect(w.find('.tp2-none').exists()).toBe(false)
  })
})

// 期区取楼栋真实字段,不由 phase 猜(见 CoefBookWindow.vue 顶部 zoneOf 注释)。
// 靶场景:三期楼栋 zone 未标注(NULL,V113 迁移故意留空)——旧实现按 `p${phase}` 猜成 'p3',
// 会误命中一条本不该生效的 p3 专属价;修复后应落全园价,并在格子上点出「未标注期区」。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import CoefBookWindow from '@/views/bills/CoefBookWindow.vue'
import type { BuildingDTO } from '@/types/building'
import type { ContractDTO } from '@/types/contract'
import type { ParamRowDTO } from '@/api/params'

vi.mock('@/api', () => ({
  default: {
    get: vi.fn(() => Promise.resolve([])),
    post: vi.fn(() => Promise.resolve({ granted: true, holder: null })),
    put: vi.fn(() => Promise.resolve({ users: [], evicted: null, approvals: [], outcome: null })),
    delete: vi.fn(() => Promise.resolve()),
  },
  readToken: vi.fn(() => 'test-token'),
  bindSession: vi.fn(),
  sessionDrifted: vi.fn(() => false),
}))
const priceRows: ParamRowDTO[] = []
vi.mock('@/api/params', () => ({ paramsApi: { list: vi.fn(() => Promise.resolve(priceRows)) } }))
vi.mock('@/api/alloc', () => ({
  allocApi: {
    pools: vi.fn(() => Promise.resolve({ generated: false, rows: [] })),
    rules: vi.fn(() => Promise.resolve([])),
  },
}))

function bld(p: Partial<BuildingDTO>): BuildingDTO {
  return {
    id: 1, name: 'X栋', phase: 1, phaseName: '一期', zone: null, kind: '标准',
    floorCount: 1, totalArea: 100, rentableArea: 100, status: 1,
    unitCount: 0, occupiedCount: 0, vacantCount: 0,
    expiringCount: 0, reservedCount: 0, leasedArea: 0,
    occRate: null, monthlyRent: 0, tenantIds: [],
    tenantBuildingArea: 0, ...p,
  }
}
function ct(p: Partial<ContractDTO>): ContractDTO {
  return {
    id: 1, contractNo: 'HT1', tenantId: 1, tenantName: '甲租户',
    buildingId: 1, buildingName: 'X栋', unitId: null, floorInfo: '1F',
    rentArea: 100, monthlyRent: 1000, deposit: 0,
    startDate: null, endDate: null, signDate: null,
    status: 'active', termMonths: 12, daysToEnd: null, remark: null, ...p,
  }
}
function prow(p: Partial<ParamRowDTO>): ParamRowDTO {
  return {
    key: 'mgmt_fee', label: '电力管理费', unit: '元/度', group: 'constant',
    scope: '', scopeLabel: '全园', value: 0.16, valueText: '0.16 元/度',
    mode: 'from', acctMonth: '', rangeText: '长期', sourceChain: ['全园:0.16'],
    formula: null, hint: null, editable: true, monthlyCheck: false,
    hasMonthRow: false, rowId: null, note: null, ...p,
  }
}

type Vm = { curMap: Map<number, { text: string; zoneUnset?: boolean }> }
const settle = async (w: ReturnType<typeof mount>) => {
  await new Promise((r) => setTimeout(r, 0))
  await w.vm.$nextTick()
}

describe('系数簿 · 期区取楼栋真实字段', () => {
  beforeEach(() => {
    localStorage.clear(); sessionStorage.clear()
    localStorage.setItem('token', 'test-token')
    setActivePinia(createPinia())
    vi.clearAllMocks()
    priceRows.length = 0
    priceRows.push(
      prow({ scope: 'p3', scopeLabel: '三期', value: 0.30, valueText: '0.30 元/度', sourceChain: ['三期:0.30'] }),
      prow({ scope: '', scopeLabel: '全园', value: 0.16, valueText: '0.16 元/度', sourceChain: ['全园:0.16'] }),
    )
  })

  it('三期楼栋 zone=NULL(未标注)→ 落全园价,不误命中 p3 专属价,且格子点出未标注', async () => {
    const w = mount(CoefBookWindow, {
      props: {
        open: false, ym: '2026-07', phase: '3',
        contracts: [ct({})], buildings: [bld({ phase: 3, zone: null })], years: [2026],
      },
      global: { stubs: { Teleport: true } },
    })
    await w.setProps({ open: true })   // watch(props.open) 起手落 phase.value=props.phase 并 load()
    await settle(w)

    const cell = (w.vm as unknown as Vm).curMap.get(1)
    expect(cell?.text, '未标注期区必须落全园价,不能误吃 p3 专属价').toBe('0.16 元/度')
    expect(cell?.zoneUnset, '必须能让用户看出这是全园价的兜底,不是三期专属价').toBe(true)
  })

  it('三期楼栋 zone=p3(已标注)→ 命中三期专属价,不标未标注', async () => {
    const w = mount(CoefBookWindow, {
      props: {
        open: false, ym: '2026-07', phase: '3',
        contracts: [ct({})], buildings: [bld({ phase: 3, zone: 'p3' })], years: [2026],
      },
      global: { stubs: { Teleport: true } },
    })
    await w.setProps({ open: true })
    await settle(w)

    const cell = (w.vm as unknown as Vm).curMap.get(1)
    expect(cell?.text).toBe('0.30 元/度')
    expect(cell?.zoneUnset).toBeFalsy()
  })
})

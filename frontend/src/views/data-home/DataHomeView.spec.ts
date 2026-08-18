import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { DataHomeOverviewDTO, DataHomeStepDTO } from '@/types/dataHome'

// 锁 DATA-HOME-REDESIGN spec §2/§5:三级主次(总览行 → 流水线 → 当前步大卡 + 唯一主 CTA),
// 以及「没问题的东西不占版面」(blockers 空 → 整条不渲染)。
// 改版前这屏把同一批信息说了三遍(KPI 3/4 与下方重复、待办是完整度的子集),那组断言已随契约删除。

beforeEach(() => setActivePinia(createPinia()))

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))

const getOverview = vi.fn()
vi.mock('@/api/dataHome', () => ({ dataHomeApi: { getOverview: (ym?: string) => getOverview(ym) } }))

import DataHomeView from './DataHomeView.vue'

const step = (key: string, label: string, status: DataHomeStepDTO['status'], detail = ''): DataHomeStepDTO =>
  ({ key, label, status, detail, go: key })

const STEPS_3DONE: DataHomeStepDTO[] = [
  step('meters', '园区抄表', 'done', '已抄 1088 块'),
  step('alloc', '公共电核算', 'done'),
  step('alloc-loss', '楼栋损耗', 'done'),
  step('bill-notices', '催缴单', 'current', '未生成'),
]
const STEPS_ALLDONE: DataHomeStepDTO[] = STEPS_3DONE.map((s, i) =>
  i === 3 ? step('bill-notices', '催缴单', 'done', '102 户 · ¥2474138.88 · 66 户带警告') : s)

const BLOCKER_CONTRACT = {
  kind: 'contract-gap' as const,
  text: '219 份合同无租金计费行，会让公摊/催缴单算不准',
  cta: '去补档', go: 'contracts',
}

function overview(patch: Partial<DataHomeOverviewDTO> = {}): DataHomeOverviewDTO {
  return {
    period: { year: 2024, month: 2, label: '2024年2月' },
    months: ['2023-08', '2024-02', '2025-06'],
    blockers: [],
    chain: { currentIndex: 3, steps: STEPS_3DONE },
    schedules: {
      done: 2, total: 9,
      items: [
        { name: '月度台账', tag: '凭证', done: false, go: 'ledger' },
        { name: '办公水电', tag: '附13', done: true, go: 'utilities' },
        { name: '光伏发电', tag: '附6', done: true, go: 'pv-income' },
      ],
    },
    ...patch,
  }
}

async function mountWith(patch: Partial<DataHomeOverviewDTO> = {}, opts: { role?: string } = {}) {
  if (opts.role) localStorage.setItem('role', opts.role)
  else localStorage.removeItem('role')
  setActivePinia(createPinia())
  getOverview.mockResolvedValue(overview(patch))
  const w = mount(DataHomeView)
  await flushPromises()
  return w
}

describe('数据中心首页 · 两段式工作台', () => {
  it('blockers 为空时前置条整条不渲染', async () => {
    const w = await mountWith({ blockers: [] })
    expect(w.find('.dh-blocker').exists()).toBe(false)
    expect(w.text()).not.toContain('去补档')
  })

  it('blockers 非空时才出现,且带 CTA', async () => {
    const w = await mountWith({ blockers: [BLOCKER_CONTRACT] })
    expect(w.find('.dh-blocker').exists()).toBe(true)
    expect(w.text()).toContain('219 份合同无租金计费行')
    expect(w.text()).toContain('去补档')
  })

  it('当前步出大卡,且全页只有一个主 CTA', async () => {
    const w = await mountWith({ chain: { currentIndex: 3, steps: STEPS_3DONE } })
    expect(w.text()).toContain('催缴单')
    expect(w.findAll('[data-primary-cta]')).toHaveLength(1)
    expect(w.text()).toContain('去处理')
  })

  it('4 步全 done 时大卡换成去对账', async () => {
    const w = await mountWith({ chain: { currentIndex: -1, steps: STEPS_ALLDONE } })
    expect(w.text()).toContain('本月出账已完成')
    expect(w.text()).toContain('去对账核对')
    expect(w.findAll('[data-primary-cta]')).toHaveLength(1)
  })

  it('period 为 null 时显示空库引导', async () => {
    const w = await mountWith({ period: null })
    expect(w.text()).toContain('还没开始出账')
    expect(w.find('.dh-steps').exists()).toBe(false)   // 空库不摆流水线空架子
  })

  it('viewer 只读:主 CTA 改「查看」,前置条的写操作按钮隐藏', async () => {
    const w = await mountWith({ blockers: [BLOCKER_CONTRACT] }, { role: 'viewer' })
    expect(w.text()).toContain('查看')
    expect(w.text()).not.toContain('去处理')
    // 前置条文案照出(他该知道有缺口),但「去补档」是写操作,不给点
    expect(w.text()).toContain('219 份合同无租金计费行')
    expect(w.text()).not.toContain('去补档')
  })

  it('附表未录在前、已录在后', async () => {
    const w = await mountWith()
    const names = w.findAll('.dh-item .dh-iname').map(n => n.text())
    expect(names[0]).toBe('月度台账')          // 未录
    expect(names.slice(1)).toEqual(['办公水电', '光伏发电'])   // 已录靠后
  })

  it('不传 ym 首载走锚定月(后端定)', async () => {
    await mountWith()
    expect(getOverview).toHaveBeenCalledWith(undefined)
  })
})

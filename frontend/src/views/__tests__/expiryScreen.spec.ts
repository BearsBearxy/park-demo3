// src/views/__tests__/expiryScreen.spec.ts — 合约租金带挂载测(Task 7,D1 可执行形式)。
//
// D1(用户 2026-09-10 拍板):业务屏可以印概率,条件是同屏也印样本量与回测命中数。
// expiry.logic.spec.ts 管算得对不对(纯函数),这里管**屏上真的印出来了没有** ——
// 照 pvMeterAnaScreen.spec.ts 的 bodyText 扫描写法加一条(task-7-brief §Step4)。
//
// asOf 用真实时钟(ExpiryView 内部 `today = new Date()`,与既有 buildExpiryWall/
// buildExpiringSoon 同一个 today),所以固定测试日期会随时间失效 —— 合同的起止日期
// 改用相对「今天」现算,而不是写死的年份字符串。
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ContractDTO } from '@/types/contract'

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))
vi.mock('@/components/ana/AnaEChart.vue', () => ({
  default: { name: 'AnaEChart', props: ['option', 'height'], template: '<div class="stub-chart" />' },
}))

const today = new Date()
const iso = (d: Date) => d.toLocaleDateString('sv')
const pastDate = iso(new Date(today.getFullYear() - 1, today.getMonth(), 1))       // 已到期、结果已知
const futureDate = iso(new Date(today.getFullYear(), today.getMonth() + 8, 1))     // 仍在租、视界内到期

let seq = 0
function ct(p: Partial<ContractDTO>): ContractDTO {
  seq++
  return {
    id: seq, contractNo: 'HT' + seq, tenantId: seq, tenantName: '租户' + seq,
    buildingId: 1, buildingName: 'A栋', unitId: seq, floorInfo: '1F',
    rentArea: 0, monthlyRent: 1000, deposit: 0,
    startDate: null, endDate: null, signDate: null,
    status: 'active', termMonths: 0, daysToEnd: null, remark: null, ...p,
  }
}

// 5 份已到期、结果已知(2 续签命中,3 未续签)→ 回测 n=5、hits=2;1 份仍在租、到期日落在
// 未来 12 月视界内 → 续签抽样池非空,带子有内容可画。
//
// C1(对抗复查):命中判据改成「后继合同的 linkType === 'renew'」,`status='renewed'` 不再算一条
// 路径(拆链脚本给中间价格档也打这个状态)。所以这里给前两份各挂一个真的续签子期。
// 子期无止日、零租金:不进分母(结果未知)、不进抽样池(止日为空)、不改锁定线,只当那根链指针。
const CONTRACTS: ContractDTO[] = [
  ...[...Array(5)].map((_, i) => ct({ id: 100 + i, endDate: pastDate, status: i < 2 ? 'renewed' : 'active' })),
  ...[...Array(2)].map((_, i) => ct({ parentContractId: 100 + i, linkType: 'renew', monthlyRent: 0 })),
  ct({ endDate: futureDate, monthlyRent: 8000, startDate: iso(new Date(today.getFullYear() - 3, 0, 1)) }),
]

vi.mock('@/analysis/anaData', () => ({
  fetchAvailableMonths: vi.fn(async () => ({ months: ['2026-08', '2026-09'], sources: { pnl: ['2026-08', '2026-09'] } })),
  fetchContracts: vi.fn(async () => CONTRACTS),
  invalidateAnaCache: vi.fn(),
}))

// mock 之后再 import 目标组件(vi.mock 提升到文件顶部,顺序不影响,这里只是保持可读顺序)
import ExpiryView from '@/views/analysis/ExpiryView.vue'

describe('ExpiryView · 合约租金带挂载测(D1 可执行形式)', () => {
  it('❗屏上必须同屏印续签统计的样本量(n)与命中数,不是只印一个孤零零的概率数字', async () => {
    const w = mount(ExpiryView)
    await flushPromises()
    await flushPromises()
    const text = w.text()
    // renewalN=5、renewalHits=2(见上面 CONTRACTS 构造)。F1(修复轮1)之后这两个数按真实身份
    // (续签统计,不是回测)写在 rentRollRefText 里 ——「过去 5 份到期中 2 份续签」,同屏可见。
    // ⚠ 不断言整屏不含 '%':本屏另有 Top10 集中度等无关的百分比 KPI,那些不受 D1 约束
    // (样本量已经同屏印着)。这条测的是"合约租金带这张卡自己不写百分比"。
    expect(text).toMatch(/过去\s*5\s*份到期中\s*2\s*份续签/)
    const rollCard = w.findAll('.av2-card').find((c) => c.text().includes('合约租金带'))
    expect(rollCard, '没找到合约租金带卡').toBeTruthy()
    // 用户 2026-09-12 拆掉 ⓘ 浮层之后,这张卡不再有折叠态——整张卡任何状态下都不印 %,
    // 断言随之变成无条件的(改前它只管收起态,浮层里那个 80% 是判给自己的例外)。
    expect(rollCard!.text()).not.toMatch(/%/)
    // 卡头必须仍写着「是下界」——浮层拆掉时这句从浮层挪进了卡头 hint,它是这张卡唯一
    // 防止读者把下界当预测读的装置,挪丢了没人会发现。
    expect(rollCard!.text()).toContain('是下界')
    // 读数句/参照系小字同样一个 % 都不许有。
    expect(w.find('.ana-ref').text()).not.toMatch(/%/)
    if (w.find('.ana-read').exists()) expect(w.find('.ana-read').text()).not.toMatch(/%/)
  })

  it('❗图与句子受同一个条件门控(F5:decided/pool 是独立过滤,结构上可能只有一边有数据)', () => {
    const src = readFileSync(join(__dirname, '../analysis/ExpiryView.vue'), 'utf8')
    // 2026-09-12:这张图从 ECharts 换成自绘的 AnaRentBandChart(照设计稿实现,用户拍板)。
    // 判据不变 —— 图与句子必须受同一个 v-if 门控,只是元素名换了。
    const chartTag = src.match(/<AnaRentBandChart[^>]*\/>/)?.[0]
    const sentenceTag = src.match(/<p[^>]*class="ana-read"[^>]*>\{\{ rentRollText \}\}<\/p>/)?.[0]
    expect(chartTag, '合约租金带图元素未找到').toBeTruthy()
    expect(sentenceTag, '合约租金带句子元素未找到').toBeTruthy()
    expect(chartTag).toMatch(/v-if="rentRollText"/)
    expect(sentenceTag).toMatch(/v-if="rentRollText"/)
  })
})

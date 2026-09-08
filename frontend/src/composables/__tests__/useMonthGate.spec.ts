import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

import { useMonthGate } from '@/composables/useMonthGate'

/**
 * 通用月门（2026-08-29「两本账」设计稿 §③）。
 *
 * 出账链那道门（`ChainMonthGate` + `stores/billingPeriod`）是**五屏共一个期**的特例。
 * 三个运营账屏（分栋抄表 / 分桩明细 / 电费成本总览）各有各的期，但踩的是同一个坑：
 * 期若存屏内 ref，侧栏点击走 `tabs.openFresh()` → epoch 递增 → 组件全新重建 → 期被清掉，
 * 每次进来都得重选。所以期按 key 存进 store。
 *
 * **只记会话内**：不写 localStorage、不进 URL —— 与出账链同一条规矩（用户 2026-08-29 拍板）。
 * 手工年是另一回事，它记本机（`utils/matrixYears`），因为那是「这台机器上我想看到哪些年」。
 */

const NOW = 2025

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  vi.setSystemTime(new Date(`${NOW}-06-15T00:00:00`))
})

const mk = (months: string[], key = 'pv-meter') =>
  useMonthGate({ key, store: ['pv-meter', 'all'], months: () => months })

describe('通用月门', () => {
  describe('期（会话内）', () => {
    it('一开始没有期 —— 落到矩阵', () => {
      const g = mk(['2025-01'])
      expect(g.picked.value).toBe(false)
      expect(g.ym.value).toBe(null)
    })

    it('选过之后 ym 是零填充的 YYYY-MM', () => {
      const g = mk(['2025-01'])
      g.pick(2025, 3)
      expect(g.picked.value).toBe(true)
      expect(g.ym.value).toBe('2025-03')
      expect(g.year.value).toBe(2025)
      expect(g.month.value).toBe(3)
    })

    it('❗期存 store —— 新建实例(模拟 openFresh 重建)照样拿得到', () => {
      mk(['2025-01']).pick(2025, 3)
      const again = mk(['2025-01'])
      expect(again.picked.value, '重建后期还在,不该再撞矩阵').toBe(true)
      expect(again.ym.value).toBe('2025-03')
    })

    it('不同 key 各记各的 —— 汽车桩与电动车桩是两个屏', () => {
      const car = useMonthGate({ key: 'cp:car', store: ['cp-meter', 'car'], months: () => [] })
      const ebike = useMonthGate({ key: 'cp:ebike', store: ['cp-meter', 'ebike'], months: () => [] })
      car.pick(2025, 3)
      expect(ebike.picked.value, '电动车屏不该被汽车屏的选择带走').toBe(false)
      ebike.pick(2024, 7)
      expect(car.ym.value).toBe('2025-03')
      expect(ebike.ym.value).toBe('2024-07')
    })

    it('「换月」清掉期,回矩阵', () => {
      const g = mk(['2025-01'])
      g.pick(2025, 3)
      g.clear()
      expect(g.picked.value).toBe(false)
    })

    it('只记会话内 —— 绝不写 localStorage(手工年除外,它是另一回事)', () => {
      mk(['2025-01']).pick(2025, 3)
      expect(localStorage.length, '期不许落盘').toBe(0)
    })
  })

  describe('矩阵年份行', () => {
    it('数据年 ∪ 当前自然年,连续补满', () => {
      const g = mk(['2022-04', '2022-09'])
      expect(g.rows.value.map(r => r.year)).toEqual([2022, 2023, 2024, 2025])
    })

    it('有数据的月实底,其余空', () => {
      const g = mk(['2025-01', '2025-03'])
      const y25 = g.rows.value.find(r => r.year === 2025)!
      expect(y25.months.map(m => m.hasData).slice(0, 4)).toEqual([true, false, true, false])
    })

    it('当前年标「当前年」,补位空年标「手工年」', () => {
      const g = mk(['2023-04'])
      const by = Object.fromEntries(g.rows.value.map(r => [r.year, r.sub]))
      expect(by[2023]).toBeUndefined()
      expect(by[2024]).toBe('手工年')
      expect(by[NOW]).toBe('当前年')
    })

    it('最近一个有数据的月描边', () => {
      const g = mk(['2024-11', '2025-02'])
      const y25 = g.rows.value.find(r => r.year === 2025)!
      expect(y25.months[1].cur).toBe(true)
      const y24 = g.rows.value.find(r => r.year === 2024)!
      expect(y24.months.some(m => m.cur), '只标全范围内最后那一个').toBe(false)
    })

    it('badgeOf 给格子加徽标 —— 各屏想显条数还是金额自己定', () => {
      const g = useMonthGate({
        key: 'k', store: ['pv-meter', 'all'], months: () => ['2025-01'],
        badgeOf: (ym) => (ym === '2025-01' ? '13 站' : undefined),
      })
      const y25 = g.rows.value.find(r => r.year === 2025)!
      expect(y25.months[0].badge).toBe('13 站')
      expect(y25.months[1].badge).toBeUndefined()
    })

    // 破坏验证:rows 里那行 `review: opts.reviewOf?.(key)` 删掉 → 恒 undefined → 红
    it('❗reviewOf 给格子喂审核态 —— 角标那一档从这里进来', () => {
      const g = useMonthGate({
        key: 'k', store: ['pv-meter', 'all'], months: () => ['2025-01'],
        reviewOf: (ym) => (ym === '2025-01' ? 'returned' : null),
      })
      const y25 = g.rows.value.find(r => r.year === NOW)!
      expect(y25.months[0].review).toBe('returned')
      expect(y25.months[1].review, 'null = 还不知道 —— 与「未交审」不是一回事').toBe(null)
    })

    it('❗不传 reviewOf 的屏一格都不画 —— 用这道门的三屏里有两屏不进审核', () => {
      // 名字必须是 reviewOf,不能叫 reviewKey:那两屏(PvMeterView / CpMeterView)在
      // views/__tests__/reviewGateCoverage.spec.ts 的白名单里,而那份门禁有一条反向断言
      //「白名单里的屏确实没有声明审核键」—— 起错名字会让它当场红,红的样子还像是白名单写错了。
      const g = mk(['2025-01'])
      expect(g.rows.value[0].months.every(m => m.review === undefined)).toBe(true)
    })

    it('一条数据都没有时也给出当前年一行 —— 否则没地方点进去录第一笔', () => {
      const g = mk([])
      expect(g.rows.value.map(r => r.year)).toEqual([NOW])
      expect(g.rows.value[0].months.every(m => !m.hasData)).toBe(true)
    })
  })

  describe('手工年（记本机）', () => {
    it('补更早年份 / 添加次年,写进 localStorage 的屏+册键', () => {
      const g = mk(['2025-01'])
      g.addEarlier()
      expect(g.rows.value.map(r => r.year)).toEqual([2024, 2025])
      g.addLater()
      expect(g.rows.value.map(r => r.year)).toEqual([2024, 2025, 2026])
      expect(JSON.parse(localStorage.getItem('bw-extra-years:pv-meter:all') ?? '[]'))
        .toEqual([2024, 2026])
    })

    it('手工加的空年可移除;有数据的年不给移除钮', () => {
      const g = mk(['2025-01'])
      g.addLater()
      const removable = g.rows.value.filter(r => r.removable).map(r => r.year)
      expect(removable).toEqual([2026])
      g.removeYear(2026)
      expect(g.rows.value.map(r => r.year)).toEqual([2025])
    })

    it('手工年录进数据后自动转正 —— 不再可移除', () => {
      const months = ref(['2025-01'])
      const g = useMonthGate({ key: 'k', store: ['pv-meter', 'all'], months: () => months.value })
      g.addLater()
      expect(g.rows.value.find(r => r.year === 2026)!.removable).toBe(true)
      months.value = ['2025-01', '2026-02']
      expect(g.rows.value.find(r => r.year === 2026)!.removable).toBe(false)
    })
  })
})

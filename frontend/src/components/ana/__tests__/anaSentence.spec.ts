// 句型库：闭嘴条件和几个写法的门（规范 S-44 表）。整库逐字对过画布五屏 879 句（画布出稿脚本直接跑本文件），这里只钉住容易被改坏的边。
import { describe, expect, it } from 'vitest'
import * as S from '../anaSentence'
import { axisLabels, tenantEnergyReads, tenantLedger } from '../tenantEnergyChart'

describe('anaSentence', () => {
  it('变动最大：最大一项变动不到上期合计的 5% 闭嘴；上期整体没数改出数据不足', () => {
    const items = [{ name: '租金', prev: 100, cur: 104 }, { name: '物业', prev: 50, cur: 50 }]
    expect(S.movers({ items, prevLabel: '11月', table: '损益表' })).toBeNull()   // 4 < 0.05 × 150
    expect(S.movers({ items: [{ name: '租金', prev: 100, cur: 120 }, { name: '物业', prev: 50, cur: 50 }], prevLabel: '11月', table: '损益表' })?.text)
      .toBe('租金 100.0→120.0；其余 1 项 50.0→50.0')
    expect(S.movers({ items: [{ name: '租金', prev: null, cur: 1 }], prevLabel: '5月', table: '销售收入表' })?.text).toBe('销售收入表没有5月，做不了和5月比')
  })

  it('钱的写法：园区「¥X.X万」、户级整元、负号「−」', () => {
    expect(S.yuan(-63.605)).toBe('−¥63.6万')
    expect(S.yi(-1130894.4)).toBe('−¥1,130,894')
    expect(S.yuan(-0.04)).toBe('¥0.0万')   // 四舍五入到 0 不带负号
  })

  it('区间位置：落在中间一半闭嘴；高于时给中位数倍数', () => {
    const band = { p25: 100, p75: 500 }
    expect(S.band({ ym: '2025-12', value: 300, band })).toBeNull()
    expect(S.band({ ym: '2025-12', value: 101646, band, median: 933.4 })?.text).toBe('12月电费 ¥101,646，是全园中位数的 108.9 倍')
  })

  it('实收：最后一期收齐且期末不欠才闭嘴（哪怕前面没收齐）', () => {
    expect(S.collect({ periods: [{ ym: '2025-09', recv: 10, coll: 0 }, { ym: '2025-10', recv: 10, coll: 10 }] })).toBeNull()
    expect(S.collect({ periods: [{ ym: '2025-10', recv: 38218, coll: 0 }] })?.text).toBe('10月应收 ¥38,218，实收 ¥0')
    // 收齐了但期末还欠（一家公司当月应收为负）：照说期末欠多少
    expect(S.collect({ periods: [{ ym: '2025-10', recv: 246869, coll: 277113 }], balEnd: 170756 })?.text).toBe('10月实收不少于应收，期末仍欠 ¥170,756')
  })

  it('缺月：连成段，跨年的段写年', () => {
    expect(S.gapsText(['2025-01', '2025-02', '2025-06', '2025-07', '2025-10'], '2025-01', '2025-12')).toBe('3–5月、8–9月、11–12月')
    expect(S.gapsText(['2025-02'], '2024-12', '2025-02')).toBe('2024年12月–2025年1月')
  })

  it('变动最大：只有一项两期都有数时只写前半句，不出「其余 0 项」', () => {
    expect(S.movers({ items: [{ name: '光伏收益', prev: 16.9, cur: 12.2 }, { name: '售电收益', prev: null, cur: 5 }], prevLabel: '12月', table: '销售收入表' })?.text).toBe('光伏收益 16.9→12.2')
  })

  it('风险分参照两行都 ≤28 字（10–12 月都试；这句超长会让异常提醒中心整屏抛错）', () => {
    for (const ym of ['2025-10', '2025-11', '2025-12']) for (const s of S.scoreNote({ pay: 0.4, rev: 0.3, energy: 0.3 }, ym)) expect(S.vlen(s)).toBeLessThanOrEqual(S.LIMIT.ref)
  })

  it('缺月：整张表都没有的月和只有这户缺的月分开说', () => {
    expect(S.thin({ table: '台账', gaps: '2024年5–9月', ownGaps: '3月', nGap: 6 }).text).toBe('台账里没有2024年5–9月，这户另缺3月')
    expect(S.thin({ table: '台账', ownGaps: '3月', nGap: 1 }).text).toBe('台账里这户没有3月')
    expect(S.thin({ table: '台账', gaps: '5–9月', nGap: 5 }).text).toBe('台账里没有5–9月')
  })

  it('行内「最近一次」：同年只写月；公司收缴率最近一次就是台账最新那期时写「10月收了 67.1%」', () => {
    expect(S.coLatest('2025-10', '67.1%', '2025-10')).toBe('10月收了 67.1%')
    expect(S.coLatest('2025-08', '81.0%', '2025-10')).toBe('最近一次 8月 81.0%')
    expect(S.latest('2026-01', '−100.0%', '2025-12')).toBe('最近一次 2026年1月 −100.0%')
  })

  it('超长在开发和测试里直接抛错', () => {
    expect(() => S.hint('一二三四五六七八九十一二三四五六七八九十一二三四五')).toThrow(/卡头超长/)
  })
})

// 光伏分栋分析首屏：逐字对画板 pv-v2 清单（manifest.json）里 m-ledger / y-ledger 的句子
describe('anaSentence · 光伏分栋分析', () => {
  it('卡头、KPI 名、工具条', () => {
    expect(S.PVH.dev(11, '天')).toBe('判了 11 栋楼 · 和全园中间那栋比 · 天')
    expect(S.PVH.perKwM(13, '11月')).toBe('全部 13 栋楼 · 和11月、去年同月比 · kWh')
    expect(S.PVH.perKwY(13, 2024)).toBe('13 栋楼 · 按在网天数平均 · 和2024年比 · kWh')
    expect(S.PV.tile.dev(3, '个月')).toBe('连着 3 个月偏离的楼栋')
    expect(S.PV.card.dev('天')).toBe('各栋发电偏离平时的天数')
    expect(S.PV.card.dev('个月')).toBe('各栋发电偏离平时的月数')
    expect(S.pvMeterAsof(2025, 1, 12, '2026-01')).toBe('分栋抄表 2025年1–12月 · 光伏月账到 2026年1月')
    expect(S.pvMeterAsof(2025, 12, 12, null)).toBe('分栋抄表 2025年12月')
  })

  it('KPI 副行：涨跌带方向，没数写「—」；每行 ≤ 16 字', () => {
    expect(S.PVK.pct(46.8, 53.43)).toEqual({ val: '−12.4%', dir: 'dn' })
    expect(S.PVK.pt(77.3, 73.3)).toEqual({ val: '+4.0 个点', dir: 'up' })
    expect(S.PVK.wan(36.3, 41.1)).toEqual({ val: '−4.8万', dir: 'dn' })
    expect(S.PVK.vsSame(11, '11月')).toBe('同 11 栋楼比11月')
    expect(S.PVK.vsLY(12)).toBe('比去年12月')
    expect(S.PVK.vsY(2024)).toBe('比2024年')
    expect(S.PVK.row({ val: null, key: S.PVK.vsLY(12) })).toBe('— 比去年12月')
    expect(S.PVK.over(2)).toBe('另 2 栋楼每千瓦日均超 24 kWh')
    expect(S.PVK.dev(11, 2)).toBe('判了 11 栋楼，2 栋历史不够')
    expect(S.PVK.dev(5, 0), '0 栋历史不够不写后半句(S-28)').toBe('判了 5 栋楼')
    expect(() => S.PVK.row({ val: '−19.4%', key: '同 11 栋楼比去年11月的同一批' })).toThrow(/KPI 副行超长/)
  })

  it('主卡：计数句 0 栋不出；历史不够两种写法；事实句零散 / 连着分开说', () => {
    expect(S.pvRunCount('12月', 0, 3, '天')).toBeNull()
    expect(S.pvRunCount('12月', 2, 3, '天')).toEqual({ type: 'count', text: '12月有 2 栋楼连着 3 天偏离平时' })
    expect(S.pvShortRef({ names: ['创业大厦', '工业大厦'], first: '2025-12-01', days: 31, minDays: 90 })?.text)
      .toBe('创业大厦、工业大厦读数从12月1日起，还差 59 天满 90 天')
    expect(S.pvShortRef({ names: ['创业大厦', '工业大厦'], months: 1, needMonths: 6 })?.text).toBe('创业大厦、工业大厦只有 1 个月读数，满 6 个月才判')
    expect(S.pvShortRef({ names: [] })).toBeNull()
    expect(S.pvDevFact(6, '天', 0, 6, 31, 0)).toBe('零散 6 天高于平时')
    expect(S.pvDevFact(5, '天', 5, 0, 31, 1)).toBe('5 天低于平时，1 段连着')
    expect(S.pvDevFact(4, '天', 1, 3, 31, 0)).toBe('零散 4 天偏离平时（低 1、高 3）')
    expect(S.pvDevFact(0, '个月', 0, 0, 12, 0)).toBe('12 个月都在平时范围')
    const base = { from: '2025-06-01', to: '11-30', n: 183, unit: '天', relaxed: ['不限同批在网', '含并网初期'] }
    expect(S.pvBaseNote(base, '2025-06-01', '2025-01-01')).toBe('平时范围按 6月1日–11月30日 的 183 天算，含这栋刚并网那段')
    expect(S.pvBaseNote({ from: '2025-01', to: '12', n: 12, unit: '个月', relaxed: ['不限同批在网', '含并网初期'] }, '2025-01-01', '2025-01-01'))
      .toBe('平时范围按 1–12月 的 12 个月算，含别的楼刚并网的月份')
  })

  it('新卡：有楼超 24 kWh 说超限（数和 kWh 不拆行），都没超说最高最低；「—」一句说完', () => {
    const rows = [{ name: '8栋', perDay: 4.01 }, { name: 'B座', perDay: 2.52 }, { name: '创业大厦', perDay: 31.54 }, { name: '工业大厦', perDay: 31.54 }]
    const r = S.pvPerKwRead(rows)!
    expect(r.type).toBe('baseline')
    expect(r.text.replace(/ /g, ' ')).toBe('创业大厦、工业大厦每千瓦日均 31.5 kWh，超过 24 kWh')
    expect(S.pvPerKwRead(rows.slice(0, 2))?.text.replace(/\u00a0/g, ' ')).toBe('每千瓦日均最高 8栋 4.0 kWh，最低 B座 2.5 kWh')
    // 各栋按一位小数都一样(模拟数据 3 月只有一期 5 栋、一样的数)不出句;对照:差 0.1 就出
    expect(S.pvPerKwRead([{ name: 'B座', perDay: 2.12 }, { name: 'E座', perDay: 2.08 }])).toBeNull()
    expect(S.pvPerKwRead([{ name: 'B座', perDay: 2.16 }, { name: 'E座', perDay: 2.08 }])?.type).toBe('extremes')
    expect(S.pvDashRef([S.pvDashNew(12, '11月'), S.pvDashPast(2024)]).text).toBe('—：12月才并网的楼没有11月；2024年还没有分栋读数')
    // 早有读数、只是上一期没抄的楼只写测量;几份连起来放不下 28 字时只说比的那一期没读数,不抛错
    expect(S.pvDashRef([S.pvDashGap('6栋', '11月'), S.pvDashLy('去年12月')]).text).toBe('—：6栋11月没有读数；去年12月没有分栋读数')
    expect(S.pvDashRef([S.pvDashNew(12, '11月'), S.pvDashGap('6栋', '11月'), S.pvDashPast(2024)]).text).toBe('—：比的那一期没有这几栋的读数')
    // 边界:长楼名 + 三位数放不下 30 字时先改说栋数、再去掉楼名(开发里超长会抛错,一句让整屏崩)
    const nb = (t?: string) => t?.replace(/\u00a0/g, ' ')
    expect(nb(S.pvPerKwRead([{ name: '创业大厦', perDay: 12.5 }, { name: '8栋', perDay: 3 }, { name: '工业大厦', perDay: 1.9 }])?.text)).toBe('每千瓦日均最高 12.5 kWh，最低 1.9 kWh')
    expect(nb(S.pvPerKwRead([{ name: 'C、D座', perDay: 13.5 }, { name: '工业大厦', perDay: 1.9 }])?.text)).toBe('每千瓦日均最高 13.5 kWh，最低 1.9 kWh')
    const all13 = Array.from({ length: 13 }, (_, i) => ({ name: i ? `${i}栋` : '创业大厦', perDay: i ? 30 : 112.4 }))
    expect(nb(S.pvPerKwRead(all13)?.text)).toBe('13 栋楼每千瓦日均超过 24 kWh，最高 112.4 kWh')
    expect(nb(S.pvPerKwRead(all13.slice(0, 3))?.text), '放得下就照旧点名').toBe('3 栋楼每千瓦日均超过 24 kWh，最高 创业大厦 112.4 kWh')
    expect(S.pvLimitRef(2)?.text).toBe('每千瓦一天最多发 24 kWh（一天只有 24 小时）')
    expect(S.pvLimitRef(0)).toBeNull()
    expect(S.pvAnchorLine(807.5, 807.5 / 365)).toBe('合格线 2.21（一年 807.5）')
  })

  // 档内卡片(按装机比 / 去向和收益):逐字对 manifest 里 m-abs / y-abs / m-ledger / y-ledger / m-trail-over
  it('按装机比:卡头、分母与压顶参照、合格线卡三句;放不下 28 字改说栋数,不抛错', () => {
    expect(S.PVH.trail('13栋', '每天')).toBe('选中 13栋 · 每天 · 和全园中间一半比 · kWh')
    expect(S.PVH.trail('B座', '每月')).toBe('选中 B座 · 每月 · 和全园中间一半比 · kWh')
    expect(S.PVH.anchor(11, S.pvYearCover(2025))).toBe('2025年全年 · 11 栋楼 · 和合格线比 · kWh')
    expect(S.PVH.ledger(13)).toBe('全部 13 栋楼 · 和台账比 · kWp')
    expect(S.pvDenomRef(13)?.text).toBe('按台账装机算，全部 13 栋楼都没录板数')
    expect(S.pvDenomRef(8, 11)?.text).toBe('8 栋楼没录板数，这几栋按台账装机算')
    expect(S.pvDenomRef(0, 11)).toBeNull()
    expect(S.pvTrailCapRef().text).toBe('虚线段：这天每千瓦超过 24 kWh，画到 24 为止')
    expect(S.pvTrailCapRef(true).text, '按年一个点是一个月').toBe('虚线段：这个月每千瓦日均超 24 kWh，画到 24 × 天数')
    // 不满一年的卡头覆盖写读数的首末月(写「全年」会和工具条对不上)
    expect([S.pvYearCover(2026, 1, 1), S.pvYearCover(2026, 1, 6), S.pvYearCover(2025, 1, 12)]).toEqual(['1月', '1–6月', '2025年全年'])
    expect(S.PVH.anchor(11, S.pvYearCover(2026, 10, 12))).toBe('10–12月 · 11 栋楼 · 和合格线比 · kWh')
    expect(S.pvAnchorBadge(2024)).toBe('2024年没有分栋读数')
    const refs = S.pvAnchorRefs({ anchor: 807.5, anchorDay: 807.5 / 365, phaseDays: [[1, 365, 365], [2, 214, 214]], short: [{ name: '创业大厦', days: 31 }, { name: '工业大厦', days: 31 }], minDays: 90 })
    expect(refs.map((r) => r.text)).toEqual(['合格线一年 807.5 kWh，摊到每天 2.21 kWh', '一期按 365 天、二期按 214 天平均', '创业大厦、工业大厦在网 31 天，不画'])
    expect(refs.map((r) => r.type)).toEqual(['口径', '口径', 'thin'])
    // 一期内天数不一样写范围;三期范围写不下 28 字 → 改说每栋按自己的天数;不画的楼天数不一样、楼名太长 → 栋数
    const long = S.pvAnchorRefs({ anchor: 807.5, anchorDay: 2.21, phaseDays: [[1, 300, 365], [2, 200, 214], [3, 90, 120]], short: [{ name: '创业大厦', days: 31 }, { name: '工业大厦', days: 40 }, { name: '研发中心大楼', days: 12 }, { name: '仓储物流中心', days: 5 }], minDays: 90 })
    expect(long.map((r) => r.text).slice(1)).toEqual(['每栋按自己有读数的天数平均', '4 栋楼在网不到 90 天，不画'])
    expect(S.pvAnchorRefs({ anchor: 807.5, anchorDay: 2.21, phaseDays: [[1, 300, 365]], short: [], minDays: 90 }).map((r) => r.text)[1]).toBe('一期按 300–365 天平均')
  })

  it('去向和收益:卡头、读数句、参照、柱顶气泡;按年哪几栋不是整年(两栋以内写楼名、整期写期)', () => {
    expect(S.PVH.cons(13)).toBe('全部 13 栋楼合计 · 万kWh')
    expect(S.PVH.cons(5, 13), '这段有楼没读数:不写「全部」,和参照「按 5 栋楼…」同一个数').toBe('5 栋楼合计 · 万kWh')
    expect(S.PVH.rev(13)).toBe('全部 13 栋楼 · 按合计排 · 万元')
    expect(S.PVH.rev(11, 13)).toBe('11 栋楼 · 按合计排 · 万元')
    expect(S.pvConsGrowth({ m: '12月', pm: '11月', a: 100, b: 72.9 })?.text).toBe('11月→12月 上网电量下降 27.1%')
    expect(S.pvSampleRef(13, 403).text).toBe('按全部 13 栋楼 403 条抄表算')
    expect(S.pvSampleRef(11, 330, 13).text).toBe('按 11 栋楼 330 条抄表算')
    expect(S.pvLossRef().text).toBe('损耗是发电减去自用和上网剩下的，没记原因')
    const y = S.pvConsYear([{ label: '1月', value: 128000 }, { label: '8月', value: 701000 }, { label: '5月', value: 400000 }])!
    expect(y.text).toBe('发电最高 8月 70.1万kWh，最低 1月 12.8万kWh')
    expect([S.pvConsMark(y.hi.label, y.hi.value), S.pvConsMark(y.lo.label, y.lo.value)]).toEqual(['8月 70.1万kWh', '1月 12.8万kWh'])
    expect(S.pvRevRead([{ name: 'C、D座', total: 46600 }, { name: '8栋', total: 34200 }, { name: '创业大厦', total: 5900 }])?.text).toBe('收益最高 C、D座 ¥4.7万，最低 创业大厦 ¥0.6万')
    expect(S.pvRevRefs(0.453).map((r) => r.text)).toEqual(['上网按系统里的上网单价 ¥0.453/kWh 算', '自用按录入时的单价算'])
    expect(S.pvRevRefs([0.453, 0.5, 0.453])[0].text, '几个月不同价').toBe('上网按每月的系统上网单价 ¥0.453–0.5/kWh 算')
    expect(S.pvRevRefs([0.453], true)[0].text, '有月份没读到:不拿常数顶').toBe('上网单价没读到，这几个月的上网收益没算')
    expect(S.pvRevShortRef([{ who: '创业大厦、工业大厦', from: 12, to: 12, n: 2 }, { who: '二期', from: 6, to: 12, n: 6 }])?.text).toBe('创业大厦、工业大厦只有12月，二期只有 6–12月')
    expect(S.pvRevShortRef([])).toBeNull()
    expect(S.pvRevShortRef([{ who: '研发中心大楼、仓储物流中心', from: 11, to: 12, n: 2 }, { who: '二期', from: 6, to: 12, n: 6 }, { who: '3 栋楼', from: 3, to: 12, n: 3 }])?.text).toBe('11 栋楼不是全年都有读数')
    expect(S.PV.ledgerEmpty(13)).toBe('全部 13 栋楼都没录板数，录了才画得出和台账对不对得上')
  })

  // 核对明细档与单栋抽屉：逐字对 manifest 里 m-lab / y-lab / drawer 的句子;画板没画的状态(没人挪名次、并网月格子超长、年档明细)各补一条
  it('核对明细：常年水平、每月和常年的差、抄表齐不齐、核对表', () => {
    expect(S.PVH.alpha(S.pvYearCover(2025))).toBe('2025年全年 · 和全园中间那栋比 · %')
    expect(S.PVH.alpha(S.nB(11))).toBe('11 栋楼 · 和全园中间那栋比 · %')
    const alpha = [{ name: '9栋', alpha: 2.4 }, { name: '13栋', alpha: -4.3 }, { name: 'E座', alpha: -38.5 }]
    expect(S.pvAlphaRead(alpha)?.text).toBe('常年水平最高 9栋 +2.4%，最低 E座 −38.5%')
    expect(S.pvAlphaRefs(11, 7).map((r) => r.text)).toEqual(['按 11 栋楼全年每天的抄表算', '同一批数换种算法，11 栋楼里 7 栋名次会变'])
    expect(S.pvAlphaRefs(11, 0).map((r) => r.text), '没有挪名次的不出那句').toEqual(['按 11 栋楼全年每天的抄表算'])
    expect(S.PVH.heat(S.nB(11))).toBe('11 栋楼 · 扣掉全园涨落，和自己常年比 · %')
    expect(S.pvHeatNote(2)).toBe('2 栋楼在网太短，没算')
    expect(S.pvHeatRef(6, 2, 1, 5, 477.43, 566.12).text).toBe('6月二期并网，一期 5 栋楼在 +477.4% 到 +566.1%')
    // 四位数的百分比放不下 28 字:退成只写最高那格,不抛错
    expect(S.pvHeatRef(6, 2, 1, 5, 977.4, 1066.1).text).toBe('6月二期并网，一期最高 +1066.1%')
    expect(S.pvHeatCapRef(7.71).text).toBe('颜色到 ±7.7% 就是最深一档，再大也一样深')
    expect(S.PVH.cal(13)).toBe('全部 13 栋楼 · 每天缺抄的栋数 · 栋')
    expect(S.pvCalFew(3)).toBe('全园在网不足 3 栋，「这天不算」这条规则本段没生效')
    expect(S.PVH.table(S.pvYearCover(2025), 13)).toBe('2025年全年 · 全部 13 栋楼')
    expect(S.PVH.table('', 13)).toBe('全部 13 栋楼')
    expect(S.pvTableRefs(1000, 12).map((r) => r.text)).toEqual([
      '名次 1 是常年水平最高；左边色条是连着偏离的楼', '「大概落在」按每栋全年每天的抄表估', '「哪天起变了」跳过并网那个月再算',
      '「隔天像不像」：近 1 同涨同落，近 0 不相干，负是一涨一落', '「碰巧更偏」：12月日子打乱重算 1000 次里更偏的次数',
      '次数越少，12月越不像碰巧；几百次就是常有的事',
    ])
    expect(S.pvAlphaExcl(['12栋']).text).toBe('12栋台账装机和板数对不上，不排')
    expect(S.pvAlphaExcl(['创业大厦', '工业大厦', '一号厂房南楼', '二号厂房北楼']).text).toBe('4 栋楼台账装机和板数对不上，不排')
  })

  it('抽屉：四块的卡头、参照;明细表按月 / 按年两种', () => {
    expect(S.PVH.drift(S.pvYearCover(2025))).toBe('2025年全年 · 扣掉全园涨落，和常年比 · 倍')
    expect(S.PVH.drift(S.pvYearCover(2026, 10, 12))).toBe('10–12月 · 扣掉全园涨落，和常年比 · 倍')
    expect(S.pvDriftRefs().map((r) => r.text)).toEqual(['纵轴是常年水平的几倍（扣掉全园当天涨落）；缺抄的天断开', '跳过并网那个月再找，没找到水平变了的那天'])
    expect([S.pvTimesLabel(1), S.pvTimesLabel(0), S.pvTimesLabel(-1)]).toEqual(['×2.7', '×1', '×0.37'])
    expect(S.PVH.ctrl(S.pvYearCover(2025), 214)).toBe('2025年全年 · 和在网的 214 天比 · 倍')
    expect(S.PVH.ctrl(S.pvYearCover(2025), 36, false), '只拿水平变之前那段估').toBe('2025年全年 · 和水平变之前的 36 天比 · 倍')
    expect(S.PV.ctrlWin('6月1日', '12月31日')).toBe('这两道线拿 6月1日–12月31日 全部的天估')
    expect(S.PVH.beta()).toBe('12 个月 · 和全园比 · 倍')
    expect(S.pvBetaRef().text).toBe('大于 1 是全园多发时它更多')
    expect(S.PVH.rows('13栋', 12, 31)).toBe('13栋 · 12月 31 天 · kWh')
    expect(S.PVH.rowsY('B座', 12)).toBe('B座 · 12 个月 · kWh')
    expect(S.pvRowsRef(23, '天').text).toBe('表内上下滚看其余 23 天；空行是那天没抄表')
    expect(S.pvRowsRef(4, '个月').text).toBe('表内上下滚看其余 4 个月；空行是那个月没抄表')
    expect(S.pvRowsRef(0, '天').text, '一屏放得下就不说滚').toBe('空行是那天没抄表')
  })
})

describe('tenantEnergyChart', () => {
  it('横轴从末格往前隔格标：末格一定有字，第一格带年份', () => {
    const xs = ['2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12']
    const wide = axisLabels(xs, 900)
    expect(wide.interval).toBe(0)
    expect(wide.labels[0]).toBe('25年1月')
    const narrow = axisLabels(xs, 160)
    const show = narrow.interval as (i: number) => boolean
    expect(show(11)).toBe(true)
    expect(xs.filter((_, i) => show(i)).length).toBeLessThan(12)
  })

  it('读数句：有突变挑最大那次；全是 0 写数据不足；缺月进参照', () => {
    const months = ['2025-01', '2025-02', '2025-06']
    const r = tenantEnergyReads({ xs: ['2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06'], months, elec: [100, 200, 210], water: [10, 10, 10],
      raw: [{ series: 'elec', idx: 1, chg: 100 }], band: {}, table: '销售收入表' })
    expect(r.read?.text).toBe('电费 2月 ¥200，比 1月 +100.0%')
    expect(r.ref?.text).toBe('销售收入表里这户没有3–5月')
    const z = tenantEnergyReads({ xs: months, months, elec: [0, 0, 0], water: [0, 0, 0], raw: [], band: {}, table: '销售收入表' })
    expect(z.read?.text).toBe('电费、水费 3 个月都是 0')
  })

  it('应收和实收：最后一期没收齐时那一期两根柱标数；几家公司相加', () => {
    const t = tenantLedger({ width: 620, rows: [
      { ym: '2025-09', co: 'A', recv: 100, coll: 100 }, { ym: '2025-10', co: 'A', recv: 300, coll: 0 }, { ym: '2025-10', co: 'B', recv: 100, coll: 50 }] })
    expect(t.read?.text).toBe('10月应收 ¥400，实收 ¥50')
    expect(t.hint).toBe('2 期台账 · 2 家公司台账相加 · 元')
    const series = (t.option as { series: { data: unknown[] }[] }).series
    expect(series[0].data[0]).toBe(100)
    expect((series[0].data[1] as { value: number }).value).toBe(400)
  })

  it('应收和实收：实收柱比应收高时，应收的标数挪到实收柱右边（不压柱）；应收高时照旧标在柱顶', () => {
    const lab = (recv: number, coll: number) => {
      const t = tenantLedger({ width: 320, rows: [{ ym: '2025-09', co: 'A', recv: 1, coll: 1 }, { ym: '2025-10', co: 'A', recv, coll, end: 100 }] })
      return (t.option as { series: { data: { label?: { position: unknown } }[] }[] }).series[0].data[1].label!.position
    }
    expect(Array.isArray(lab(246869, 277113))).toBe(true)
    expect(lab(300000, 100)).toBe('top')
  })

  it('应收和实收缺月：整张台账都没有的月不算「这户」缺', () => {
    const rows = [{ ym: '2025-01', co: 'A', recv: 1, coll: 1 }, { ym: '2025-04', co: 'A', recv: 1, coll: 1 }]
    expect(tenantLedger({ rows, width: 620, tableYms: ['2025-01', '2025-04'] }).refs[0]).toBe('台账里没有2–3月')
    expect(tenantLedger({ rows, width: 620, tableYms: ['2025-01', '2025-02', '2025-03', '2025-04'] }).refs[0]).toBe('台账里这户没有2–3月')
    expect(tenantLedger({ rows, width: 620, tableYms: ['2025-01', '2025-02', '2025-04'] }).refs[0]).toBe('台账里没有3月，这户另缺2月')
  })
})

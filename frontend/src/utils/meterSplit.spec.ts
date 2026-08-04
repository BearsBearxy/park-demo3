import { describe, it, expect } from 'vitest'
import { splitTenantSpot, classifyOwnership, buildingIdFor, inSubSigma, ownershipLabel } from './meterSplit'

// §6.2 全部例子:1-3楼（力灏）/邓宇峰（高区）/桑尼号西侧/邓宇峰多命中待核
const LIB = ['力灏', '邓宇峰', '桑尼号', '锂朋科技']

describe('splitTenantSpot — 括号「X（Y）」', () => {
  it('租户在括号内:1-3楼（力灏）→ 租户力灏 + 方位1-3楼(全半角括号均认)', () => {
    expect(splitTenantSpot('1-3楼（力灏）', LIB)).toEqual({ tenant: '力灏', spot: '1-3楼', multi: false })
    expect(splitTenantSpot('1-3楼(力灏)', LIB)).toEqual({ tenant: '力灏', spot: '1-3楼', multi: false })
  })
  it('方位在括号内:邓宇峰（高区）→ 租户邓宇峰 + 方位高区', () => {
    expect(splitTenantSpot('邓宇峰（高区）', LIB)).toEqual({ tenant: '邓宇峰', spot: '高区', multi: false })
  })
  it('都命中取 X', () => {
    expect(splitTenantSpot('力灏（桑尼号）', LIB)).toEqual({ tenant: '力灏', spot: '桑尼号', multi: false })
  })
  it('都不命中:方位正则判方位段,余段跑优先级匹配(1-3楼（锂朋）→ 唯一包含 锂朋科技)', () => {
    expect(splitTenantSpot('1-3楼（锂朋）', LIB)).toEqual({ tenant: '锂朋科技', spot: '1-3楼', multi: false })
  })
})

describe('splitTenantSpot — 无括号连写 & 优先级', () => {
  it('桑尼号西侧 → 从尾部剥方位后缀', () => {
    expect(splitTenantSpot('桑尼号西侧', LIB)).toEqual({ tenant: '桑尼号', spot: '西侧', multi: false })
  })
  it('库名唯一包含候选:锂朋 → 锂朋科技', () => {
    expect(splitTenantSpot('锂朋', LIB)).toEqual({ tenant: '锂朋科技', spot: null, multi: false })
  })
  it('候选唯一包含库名:桑尼号分店 → 桑尼号', () => {
    expect(splitTenantSpot('桑尼号分店', LIB)).toEqual({ tenant: '桑尼号', spot: null, multi: false })
  })
  it('多命中不自动挂:邓宇峰×3 → tenant 空 + multi 待核(方位仍拆出)', () => {
    const lib3 = ['邓宇峰（一）', '邓宇峰（二）', '邓宇峰（三）']
    expect(splitTenantSpot('邓宇峰（高区）', lib3)).toEqual({ tenant: null, spot: '高区', multi: true })
    expect(splitTenantSpot('邓宇峰3栋', lib3)).toEqual({ tenant: null, spot: '3栋', multi: true })
  })
  it('未命中/空串:tenant 空不待核,原文保留由调用方兜底', () => {
    expect(splitTenantSpot('消防', LIB)).toEqual({ tenant: null, spot: null, multi: false })
    expect(splitTenantSpot('', LIB)).toEqual({ tenant: null, spot: null, multi: false })
  })
})

describe('classifyOwnership — §6.3 关键词', () => {
  it('表类含 总|变压器 或名称含 连接|馈 → infra 配电总表', () => {
    expect(classifyOwnership('总电表', '二期总电', false)).toBe('infra')
    expect(classifyOwnership('公共用电/已分摊', '连接二车间', false)).toBe('infra')
    expect(classifyOwnership(undefined, '一车间馈线', false)).toBe('infra')
  })
  it('表类含 户内 或租户匹配成功 → tenant', () => {
    expect(classifyOwnership('户内用电', '力灏电', false)).toBe('tenant')
    expect(classifyOwnership(undefined, '某表', true)).toBe('tenant')
  })
  it('公摊显式标记先于租户命中(2026-07-28 修):一期「公共用电/租户名」跟户公摊表不得挂租户', () => {
    expect(classifyOwnership('公共用电/已分摊', '可莱恩B201东侧公共电 公共用电/可莱恩', true)).toBe('share')
    expect(classifyOwnership(undefined, '欧培仪东侧公共电 公共用电/雷莱', true)).toBe('share')
  })
  // V68 园区自担(依据一期册专表「创显承担电费」):园区自己吃,不收租户也不进公摊池
  it('创显/物业部办公室/门岗/监控室/人才港/消防中控室 → park,先于 share 与 tenant 判定', () => {
    expect(classifyOwnership('户内用电', '创显办公室 创显办公室', false)).toBe('park')
    expect(classifyOwnership('公共用电/未分摊', '门岗 2号门岗', false)).toBe('park')
    expect(classifyOwnership('公共用电/未分摊', '消防中控室 消防中控室', false)).toBe('park')
    expect(classifyOwnership('公共用电/未分摊', '监控室 监控室', false)).toBe('park')
    expect(classifyOwnership('户内用电', '人才港电 人才港', true)).toBe('park')
    expect(classifyOwnership('户内用电', '231 创显公司', true)).toBe('park')
  })
  it('同专表标注「已分摊」的表是真公摊,park 让位 share(车库照明/生活加压泵/大堂/招商中心电2)', () => {
    expect(classifyOwnership('公共用电/已分摊', '车库照明', false)).toBe('share')
    expect(classifyOwnership('公共用电/已分摊', '生活加压泵', false)).toBe('share')
    expect(classifyOwnership('公共用电/已分摊', 'A座一楼大堂', false)).toBe('share')
    expect(classifyOwnership('公共用电/已分摊', '招商中心电2', false)).toBe('share')
    // 普通消防表不受 park 规则波及(只吃「消防中控室」全词)
    expect(classifyOwnership('公共用电/未分摊', '一车间消防', false)).toBe('share')
  })
  // 刀H §H2(V79):计度寄存器最先判 —— 名字里带租户名会先被租户匹配吃掉(永龙反向有功 15527 度曾进分表Σ)
  it('反向有功/正向无功/反向无功/需量/最大需量 → register,先于 tenant 与 infra 判定', () => {
    expect(classifyOwnership('户内用电', '永龙反向有功', true)).toBe('register')
    expect(classifyOwnership(undefined, '某表正向无功', false)).toBe('register')
    expect(classifyOwnership(undefined, '某表反向无功', false)).toBe('register')
    expect(classifyOwnership('总电表', '二期总电最大需量', false)).toBe('register')
    expect(classifyOwnership(undefined, '三车间需量', false)).toBe('register')
    // 不误伤真表:关键词是电表寄存器的标准叫法,不出现在普通表名里
    expect(classifyOwnership('户内用电', '永龙电', true)).toBe('tenant')
  })
  it('公共关键词:消防→share,水泵→ops;其余公共默认 share', () => {
    expect(classifyOwnership('公共用电/已分摊', '一车间消防', false)).toBe('share')
    expect(classifyOwnership('公共用水', '生活水泵', false)).toBe('ops')
    expect(classifyOwnership('公共用电/已分摊', '未知公共表', false)).toBe('share')
  })
})

describe('buildingIdFor — §6.3 区域→楼栋映射(楼栋重建后逐栋细分)', () => {
  const B = [
    { id: 1, name: '一期 A座' }, { id: 2, name: '一期 B座' }, { id: 3, name: '一期 G座' },
    { id: 4, name: '一期 空地' }, { id: 5, name: '二期 一车间' }, { id: 6, name: '二期 五车间' },
    { id: 7, name: '三期 创业大厦' }, { id: 8, name: '三期 工业大厦' },
    { id: 9, name: '一期 宿舍一栋' }, { id: 10, name: '一期 宿舍三栋' }, { id: 11, name: '散租宿舍' },
  ]
  it('一期:A-G 逐座/空地;B-G座总表(跨栋)不挂', () => {
    expect(buildingIdFor('p1', 'A座', B)).toBe(1)
    expect(buildingIdFor('p1', 'A座自装总电表', B)).toBe(1)
    expect(buildingIdFor('p1', 'B座', B)).toBe(2)
    expect(buildingIdFor('p1', 'G座', B)).toBe(3)
    expect(buildingIdFor('p1', 'B-G座', B)).toBeNull()
    expect(buildingIdFor('p1', '空地', B)).toBe(4)
  })
  it('二期:逐车间;钢构车间不吃车间规则', () => {
    expect(buildingIdFor('p2', '一车间', B)).toBe(5)
    expect(buildingIdFor('p2', '五车间', B)).toBe(6)
    expect(buildingIdFor('p2', '钢构车间', B)).toBeNull()
  })
  it('宿舍中文数字栋(修 v1 只认阿拉伯数字缺陷):仅 zone=dorm;跨栋/无栋号不挂', () => {
    expect(buildingIdFor('dorm', '一栋', B)).toBe(9)
    expect(buildingIdFor('dorm', '三栋', B)).toBe(10)
    expect(buildingIdFor('dorm', '三/四栋', B)).toBeNull()
    expect(buildingIdFor('dorm', '一、二栋宿舍路边路灯', B)).toBeNull()
    expect(buildingIdFor('dorm', '宿舍', B)).toBeNull()
    expect(buildingIdFor('dorm', '三期工地工人宿舍', B)).toBeNull()
    expect(buildingIdFor('p2', '一栋', B)).toBeNull()   // 非 dorm 不吃栋规则
  })
  it('三期:创业大厦/工业大厦;裸「三期」无信号不挂', () => {
    expect(buildingIdFor('p2', '三期创业大厦', B)).toBe(7)
    expect(buildingIdFor('p2', '工业大厦', B)).toBe(8)
    expect(buildingIdFor('p1', '三期项目工地', B)).toBeNull()
  })
  it('未命中 → null(二期园区变压器/招商中心/空区域)', () => {
    expect(buildingIdFor('p2', '二期园区变压器', B)).toBeNull()
    expect(buildingIdFor('p1', '招商中心', B)).toBeNull()
    expect(buildingIdFor('p2', undefined, B)).toBeNull()
  })
})

describe('inSubSigma — §8.2 分表Σ成员 + §F7 shadow 排除', () => {
  it('tenant/share/park 计入,infra/ops 不计', () => {
    expect(inSubSigma({ ownership: 'tenant' })).toBe(true)
    expect(inSubSigma({ ownership: 'share' })).toBe(true)
    expect(inSubSigma({ ownership: 'park' })).toBe(true)
    expect(inSubSigma({ ownership: 'infra' })).toBe(false)
    expect(inSubSigma({ ownership: 'ops' })).toBe(false)
    // 刀H §H2(V79):计度寄存器不是用电量,不进任何Σ
    expect(inSubSigma({ ownership: 'register' })).toBe(false)
  })
  it('suspect=shadow 一律排除(疑似重复建档,与后端 AllocService.inSubSigma 同口径)', () => {
    expect(inSubSigma({ ownership: 'tenant', suspect: 'shadow' })).toBe(false)
    expect(inSubSigma({ ownership: 'share', suspect: 'shadow' })).toBe(false)
    expect(inSubSigma({ ownership: 'park', suspect: 'shadow' })).toBe(false)
  })
  it('suspect=incomplete 照算(5 块挂栋 p2 临电在这一档,排掉会让 E=D−C 长期偏低)', () => {
    expect(inSubSigma({ ownership: 'share', suspect: 'incomplete' })).toBe(true)
    expect(inSubSigma({ ownership: 'tenant', suspect: null })).toBe(true)
  })
})

describe('ownershipLabel — infra 展示名按表类分流(2026-08-04 报障:水表挂"配电总表"徽标)', () => {
  it('infra:电=配电总表,水=供水总表;其余归属不受表类影响', () => {
    expect(ownershipLabel('infra', 'elec')).toBe('配电总表')
    expect(ownershipLabel('infra', 'water')).toBe('供水总表')
    expect(ownershipLabel('infra')).toBe('配电总表')
    expect(ownershipLabel('tenant', 'water')).toBe('租户')
    expect(ownershipLabel('share', 'water')).toBe('园区公摊')
  })
})

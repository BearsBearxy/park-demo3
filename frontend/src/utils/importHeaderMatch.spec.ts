import { describe, it, expect } from 'vitest'
import { matchByHeader, normalizeHeader, isGarbageTenantName, type ColumnMapEntry } from './importHeaderMatch'

// 真实二期表 factory 子集列
const COLS: ColumnMapEntry[] = [
  { label: '厂房租金', key: 'factoryRent' },
  { label: '企业管理服务费', key: 'factoryMgmtFee' },
  { label: '其他费用', key: 'otherFee' },
  { label: '基本用电费', key: 'elecBasic' },
  { label: '水维护费', key: 'waterMaint' },
]
const NAME = ['租户', '租户名称']

describe('matchByHeader — 真实 Excel 容错(二期结构)', () => {
  // 真实结构:租户表头在 r0col0、数据租户在 col1(col0=车间分类列)、叶子在 r2、其他费用在 r1分组行、尾部合计/备注、小计行
  const cols = (a: (string | number)[]) => a.map(String)
  const matrix: string[][] = [
    cols(['租户', '', '项目', '', '', '', '', '合计', '备注']),                               // r0:租户表头在col0
    cols(['', '', '租金', '', '其他费用', '1月电费', '1月水费', '', '']),                       // r1:分组行,其他费用在 col4
    cols(['', '', '厂房租金', '企业管理服务费', '', '基本用电费', '水维护费', '', '']),           // r2:叶子表头行
    cols(['一至四车间', '火炬创新创业园', '1808871', '100', '5', '50', '7', '1809033', '']),     // data:车间col0+租户col1
    cols(['', '锂朋', '0', '0', '3', '30', '2', '35', '']),
    cols(['五、六车间', '力灏', '200017', '200', '9', '90', '8', '200324', '']),
    cols(['一至四车间合计：', '', '2008888', '300', '17', '170', '17', '2009422', '']),          // 小计行(col1空)
    cols(['二期园区总计：', '', '2008888', '300', '17', '170', '17', '2009422', '']),
  ]

  it('租户表头在别行/数据租户在col1 也能找到租户列', () => {
    const { records, error } = matchByHeader(matrix, COLS, NAME)
    expect(error).toBeUndefined()
    expect(records.map(r => r.tenantName)).toEqual(['火炬创新创业园', '锂朋', '力灏'])
  })

  it('前置车间列被忽略,首租户不丢', () => {
    const { records } = matchByHeader(matrix, COLS, NAME)
    expect(records.map(r => r.tenantName)).not.toContain('一至四车间')
    expect(records[0].tenantName).toBe('火炬创新创业园')
  })

  it('落在分组行的「其他费用」标签也被捕获', () => {
    const { records } = matchByHeader(matrix, COLS, NAME)
    expect(records[0].otherFee).toBe(5)
    expect(records[0].factoryRent).toBe(1808871)
    expect(records[0].factoryMgmtFee).toBe(100)
  })

  it('合计列不落到任何字段', () => {
    const { records } = matchByHeader(matrix, COLS, NAME)
    const vals = Object.entries(records[0]).filter(([k]) => k !== '__preview' && k !== 'tenantName').map(([, v]) => v)
    expect(vals).not.toContain(1809033)
  })

  it('小计/总计行被跳过', () => {
    const { records } = matchByHeader(matrix, COLS, NAME)
    expect(records.length).toBe(3) // 火炬/锂朋/力灏,不含两条小计
    expect(records.some(r => /合计|总计/.test(r.tenantName as string))).toBe(false)
  })

  it('列乱序仍按名字匹配', () => {
    const reordered: string[][] = [
      cols(['', '租户', '基本用电费', '厂房租金', '企业管理服务费']),
      cols(['', '甲租户', '50', '999', '111']),
    ]
    const { records } = matchByHeader(reordered, COLS, NAME)
    expect(records[0].tenantName).toBe('甲租户')
    expect(records[0].factoryRent).toBe(999)
    expect(records[0].elecBasic).toBe(50)
  })

  it('表头命中过少 → 报错', () => {
    const junk: string[][] = [['a', 'b', 'c'], ['1', '2', '3']]
    const { error } = matchByHeader(junk, COLS, NAME)
    expect(error).toContain('无法识别表头')
  })

  it('normalizeHeader 去标点/空格', () => {
    expect(normalizeHeader('土地使用税、房产税')).toBe('土地使用税房产税')
    expect(normalizeHeader(' 厂房 租金 ')).toBe('厂房租金')
  })

  // 关键列为纯数字(如办公水电的月份"1"/"2") → 数据内容法找不到,须按 nameLabels 表头定位
  it('纯数字关键列按 nameLabels 表头定位(办公水电月份)', () => {
    const COLS2: ColumnMapEntry[] = [
      { label: '用电量', key: 'elecQty' },
      { label: '用水量', key: 'waterQty' },
    ]
    const m: string[][] = [
      cols(['月份', '用电量', '用水量']),
      cols(['1', '3000', '50']),
      cols(['2', '3200', '55']),
      cols(['合计', '6200', '105']),
    ]
    const { records, error } = matchByHeader(m, COLS2, ['月份', '所属月'])
    expect(error).toBeUndefined()
    expect(records.map(r => r.tenantName)).toEqual(['1', '2']) // 月份列(纯数字)被正确识别,合计行跳过
    expect(records[0].elecQty).toBe(3000)
  })

  // 前缀匹配:真实列头带单位后缀(用电量(千瓦)/应出勤（天)),标签是裸前缀
  it('单位后缀列头前缀命中裸标签', () => {
    const COLS3: ColumnMapEntry[] = [
      { label: '用电量', key: 'elecQty' },
      { label: '基准用电单价', key: 'elecPrice' },
    ]
    const m: string[][] = [
      cols(['月份', '用电量(千瓦）', '基准用电单价（千瓦/元）', '电费金额（元）']),
      cols(['1', '1284.8', '0.79', '1020']),
    ]
    const { records, error } = matchByHeader(m, COLS3, ['月份'])
    expect(error).toBeUndefined()
    expect(records[0].elecQty).toBe(1284.8)
    expect(records[0].elecPrice).toBe(0.79)
  })

  // 最长匹配优先:基本 不得吞掉 基本工资/基本用电费(短标签若存在也只在精确/更长前缀让位)
  it('多标签前缀命中同列头时取最长标签', () => {
    const COLS4: ColumnMapEntry[] = [
      { label: '应出勤', key: 'shouldDays' },
      { label: '请假', key: 'leaveDays' },
    ]
    const m: string[][] = [
      cols(['姓名', '应出勤（天）', '请假（天）']),
      cols(['冯谨', '18', '0.5']),
    ]
    const { records, error } = matchByHeader(m, COLS4, ['姓名'])
    expect(error).toBeUndefined()
    expect(records[0].shouldDays).toBe(18)
    expect(records[0].leaveDays).toBe(0.5)
  })

  // 填充型分组列(充电桩类别合并列):仅组首行有值,组内其余空,各行 __groups 都拿到组值;小计/总计跳过且不污染填充
  it('分组列向下填充,组内空行继承组值', () => {
    const COLS_C: ColumnMapEntry[] = [
      { label: '充电电量', key: 'kwh' },
      { label: '充电成本', key: 'cost' },
    ]
    const m: string[][] = [
      cols(['充电桩类别', '月份', '充电电量（千瓦时）', '充电成本（元）']),
      cols(['叮叮充', '2025-01-01', '1205.49', '895.01']),   // 组首:类别有值
      cols(['', '2025-02-01', '1404.15', '1013.49']),        // 组内:类别空,继承叮叮充
      cols(['', '小计', '2609.64', '1908.5']),               // 小计行跳过,不重置填充
      cols(['电信', '2025-01-01', '839.63', '699.41']),      // 新组首
      cols(['', '2025-02-01', '572.87', '481.17']),          // 继承电信
      cols(['总计', '', '5026.13', '3989.08']),              // 总计行跳过
    ]
    const { records, error } = matchByHeader(m, COLS_C, ['月份'], ['充电桩类别'])
    expect(error).toBeUndefined()
    expect(records.map(r => r.tenantName)).toEqual(['2025-01-01', '2025-02-01', '2025-01-01', '2025-02-01'])
    expect(records.map(r => r.__groups?.['充电桩类别'])).toEqual(['叮叮充', '叮叮充', '电信', '电信'])
    expect(records[0].kwh).toBe(1205.49)
    expect(records[3].cost).toBe(481.17)
  })

  it('无 groupLabels 时不附 __groups(默认不影响现有调用)', () => {
    const { records } = matchByHeader(matrix, COLS, NAME)
    expect(records[0].__groups).toBeUndefined()
  })

  // meta:成功时回传 关键列/表头块末行 位置(台账拆段公司识别用);纯增量
  it('meta 返回 nameCol/headerEnd', () => {
    const { meta } = matchByHeader(matrix, COLS, NAME)
    expect(meta).toEqual({ nameCol: 1, headerEnd: 2 })
  })

  // ── 列名别名(aliases):主 label + 别名全体参与匹配,模板/预览列不受影响 ──
  const COLS_AL: ColumnMapEntry[] = [
    { label: '商铺、宿舍租金', key: 'shopRent', aliases: ['商铺租金'] },
    { label: '宿舍配套费', key: 'dormFacilitiesFee', aliases: ['宿舍配套设施费'] },
    { label: '宿舍租金', key: 'dormRent' },
  ]
  it('别名命中(10月表变体列名)', () => {
    const m = [cols(['租户', '商铺租金', '宿舍配套设施费', '宿舍租金']), cols(['甲', '100', '20', '30'])]
    const { records, error } = matchByHeader(m, COLS_AL, ['租户'])
    expect(error).toBeUndefined()
    expect(records[0].shopRent).toBe(100)
    expect(records[0].dormFacilitiesFee).toBe(20)
    expect(records[0].dormRent).toBe(30)
  })
  it('主 label 仍命中(1月表回归,别名不干扰)', () => {
    const m = [cols(['租户', '商铺、宿舍租金', '宿舍配套费']), cols(['甲', '11', '22'])]
    const { records, error } = matchByHeader(m, COLS_AL, ['租户'])
    expect(error).toBeUndefined()
    expect(records[0].shopRent).toBe(11)
    expect(records[0].dormFacilitiesFee).toBe(22)
  })
  it('长标签优先:别名比他键短主 label 长时先命中', () => {
    const C: ColumnMapEntry[] = [
      { label: '宿舍配套', key: 'shortKey' },
      { label: '宿舍配套费', key: 'dormFee', aliases: ['宿舍配套设施费'] },
      { label: '水维护费', key: 'waterMaint' },
    ]
    const m = [cols(['租户', '宿舍配套设施费', '水维护费']), cols(['甲', '9', '1'])]
    const { records } = matchByHeader(m, C, ['租户'])
    expect(records[0].dormFee).toBe(9)
    expect(records[0]).not.toHaveProperty('shortKey')
  })

  // ── skipName 收行过滤(规范§九 v4):第5参可选,缺省零行为变化 ──
  it('isGarbageTenantName:纯数字/6位数字开头命中,正常租户名不命中', () => {
    expect(isGarbageTenantName('0')).toBe(true)
    expect(isGarbageTenantName('123.45')).toBe(true)
    expect(isGarbageTenantName('202510二期')).toBe(true)
    expect(isGarbageTenantName('万众宿舍')).toBe(false)
    expect(isGarbageTenantName('3号厂房')).toBe(false)   // 数字开头但不足 6 位且非纯数字
  })

  const skipMatrix: string[][] = [
    cols(['租户', '厂房租金', '企业管理服务费']),
    cols(['甲', '100', '10']),
    cols(['202510二期', '100', '10']),   // 未标「合计」的段合计行
    cols(['0', '0', '0']),               // 伪租户行
  ]
  it('skipName 生效:命中的数据行被跳过', () => {
    const { records, error } = matchByHeader(skipMatrix, COLS, NAME, undefined, { skipName: isGarbageTenantName })
    expect(error).toBeUndefined()
    expect(records.map(r => r.tenantName)).toEqual(['甲'])
  })
  it('缺省不传 skipName → 不过滤(零行为变化,办公水电纯数字月份保命线)', () => {
    const { records } = matchByHeader(skipMatrix, COLS, NAME)
    expect(records.map(r => r.tenantName)).toEqual(['甲', '202510二期', '0'])
  })

  // 文本列:职种/职务 存原始字符串,不被 cleanNum 变 0
  it('text 列存原始字符串(职种/职务)', () => {
    const COLS5: ColumnMapEntry[] = [
      { label: '职种/职务', key: 'role', text: true },
      { label: '基本工资', key: 'base' },
    ]
    const m: string[][] = [
      cols(['姓名', '职种/职务', '基本工资']),
      cols(['冯谨', '总经理', '33000']),
      cols(['黄琦', '见习经理（03）', '1900']),
    ]
    const { records, error } = matchByHeader(m, COLS5, ['姓名'])
    expect(error).toBeUndefined()
    expect(records[0].role).toBe('总经理')        // 非 0
    expect(records[1].role).toBe('见习经理（03）') // 含括号数字也整串保留
    expect(records[0].base).toBe(33000)
  })
})

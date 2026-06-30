import { describe, it, expect } from 'vitest'
import { splitSalarySections } from './importSalarySections'
import type { ColumnMapEntry } from './importHeaderMatch'

// 真实工资表叶子标签子集(text=role)
const COLS: ColumnMapEntry[] = [
  { label: '职种/职务', key: 'role', text: true },
  { label: '基本工资', key: 'base' },
  { label: '岗位工资', key: 'post' },
  { label: '应出勤', key: 'shouldDays' },
  { label: '请假', key: 'leaveDays' },
]
const NAME = ['姓名']
const c = (a: (string | number)[]) => a.map(String)

// 仿真实文件:三行表头(标题|分组|叶子)+ 序号列 + 职种/职务文本列 + 分组小计行,两月堆叠。
const matrix: string[][] = [
  c(['', '2025年1月工资表(总表）']),
  c(['', '序号', '姓名', '职种/职务', '月工资', '', '出勤', '']),
  c(['', '', '', '', '基本工资', '岗位工资', '应出勤（天）', '请假（天）']),
  c(['', '1', '冯谨', '总经理', '33000', '', '', '']),
  c(['', '2', '黄琦', '见习经理（03）', '1900', '3000', '18', '0.5']),
  c(['', '办公室人员合计', '', '', '85000', '23600', '194', '0.5']),
  c([]),
  c(['', '2025年2月工资表(总表）']),
  c(['', '序号', '姓名', '职种/职务', '月工资', '', '出勤', '']),
  c(['', '', '', '', '基本工资', '岗位工资', '应出勤（天）', '请假（天）']),
  c(['', '1', '冯谨', '总经理', '33000', '', '', '']),
  c(['', '3', '符俊熙', '见习经理（03）', '2080', '3000', '20', '2.8']),
  c(['', '创显总计', '', '', '118000', '53100', '600', '12.735']),
]

describe('splitSalarySections — 工资多月分段', () => {
  it('按标题切成 2 段并识别年/月', () => {
    const secs = splitSalarySections(matrix, COLS, NAME)
    expect(secs.length).toBe(2)
    expect(secs[0]).toMatchObject({ year: 2025, month: 1 })
    expect(secs[1]).toMatchObject({ year: 2025, month: 2 })
  })

  it('逐段解析记录,小计行被跳过', () => {
    const secs = splitSalarySections(matrix, COLS, NAME)
    expect(secs[0].records.map(r => r.tenantName)).toEqual(['冯谨', '黄琦'])
    expect(secs[1].records.map(r => r.tenantName)).toEqual(['冯谨', '符俊熙'])
    // 小计/总计行不入
    expect(secs[0].records.some(r => /合计|总计/.test(r.tenantName as string))).toBe(false)
  })

  it('role 文本列与金额/考勤列正确入库', () => {
    const secs = splitSalarySections(matrix, COLS, NAME)
    const huangqi = secs[0].records[1]
    expect(huangqi.role).toBe('见习经理（03）')   // 文本非 0
    expect(huangqi.base).toBe(1900)
    expect(huangqi.post).toBe(3000)
    expect(huangqi.shouldDays).toBe(18)
    expect(huangqi.leaveDays).toBe(0.5)           // 小数保留(后端取整)
  })

  it('0 标题 → 整表 1 段,年/月 undefined', () => {
    const single: string[][] = [
      c(['', '序号', '姓名', '职种/职务', '基本工资', '岗位工资']),
      c(['', '1', '甲', '保洁', '1900', '1600']),
    ]
    const secs = splitSalarySections(single, COLS, NAME)
    expect(secs.length).toBe(1)
    expect(secs[0].year).toBeUndefined()
    expect(secs[0].month).toBeUndefined()
    expect(secs[0].records[0].tenantName).toBe('甲')
    expect(secs[0].records[0].role).toBe('保洁')
  })
})

import { describe, it, expect, vi } from 'vitest'
import type { SalaryYearMonthDTO } from '../types/salary'

// capture the AOA passed to aoa_to_sheet without writing a file
const aoaSpy = vi.fn((rows: unknown[][]) => ({ rows }))
vi.mock('xlsx', () => ({
  utils: {
    aoa_to_sheet: (rows: unknown[][]) => aoaSpy(rows),
    book_new: () => ({}),
    book_append_sheet: () => {},
  },
  writeFile: () => {},
}))

import { exportSalaryMonth } from './salaryExcel'

const dto: SalaryYearMonthDTO = {
  year: 2026, month: 5,
  rows: [
    {
      id: 1, acctMonth: '2026-05', empIdx: 1, name: '周明', role: '总经理',
      base: 12000, post: 6000, perf: 4200, attend: 300, skill: 1200, edu: 800, other: 0,
      lunch: 400, heat: 0, commission: 0, shouldDays: 21, leaveDays: 0,
      social: 1860, tax: 1040, otherDeduct: 0, sign: false,
      wageTotal: 24500, gross: 24900, deduct: 2900, net: 22000, actualDays: 21, fullAttend: true,
      note: 'x', source: 'seed',
    },
  ],
  total: {
    base: 12000, post: 6000, perf: 4200, attend: 300, skill: 1200, edu: 800, other: 0,
    lunch: 400, heat: 0, commission: 0, wageTotal: 24500, gross: 24900,
    social: 1860, tax: 1040, otherDeduct: 0, deduct: 2900, net: 22000,
  },
}

describe('exportSalaryMonth', () => {
  it('lays out header / row / footer with server-derived columns echoed, not recomputed', async () => {
    await exportSalaryMonth(dto)
    const [header, row, footer] = aoaSpy.mock.calls[0][0]
    expect(header).toEqual([
      '序号', '姓名', '职务',
      '基本', '岗位', '绩效奖金', '全勤奖', '技能津贴', '学历津贴', '其它津贴', '合计工资',
      '午餐补助', '高温及其他', '招商提成',
      '应出勤', '请假', '实出勤', '全勤',
      '应发工资', '社保', '上月个税', '其他扣款', '实发金额', '签收', '备注',
    ])
    // wageTotal/gross/net/actualDays/fullAttend are server-derived; row echoes them
    expect(row).toEqual([
      1, '周明', '总经理',
      12000, 6000, 4200, 300, 1200, 800, 0, 24500,
      400, 0, 0,
      21, 0, 21, '全勤',
      24900, 1860, 1040, 0, 22000, '待签', 'x',
    ])
    expect(footer).toEqual([
      '合计', '1 人', '',
      12000, 6000, 4200, 300, 1200, 800, 0, 24500,
      400, 0, 0,
      '', '', '', '',
      24900, 1860, 1040, 0, 22000, '', '',
    ])
  })
})

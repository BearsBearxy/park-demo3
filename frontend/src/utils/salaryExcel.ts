// 附表12 工资明细 Excel 导出(SheetJS)。列序对齐屏宽表(screen-schedule12.jsx 表头):
// 序号·姓名·职务 + 月工资大类8(基本/岗位/绩效/全勤奖/技能/学历/其它/合计工资) + 补贴2 + 招商提成
// + 考勤4(应出勤/请假/实出勤/全勤) + 应发 + 代缴代扣3 + 实发 + 签收 + 备注 + 末行本月合计。
import type { SalaryYearMonthDTO } from '../types/salary'

export async function exportSalaryMonth(dto: SalaryYearMonthDTO): Promise<void> {
  // 懒加载 SheetJS(~200KB):仅在用户点「导出」时才拉(对齐 pvExcel)。
  const XLSX = await import('xlsx')

  const header = [
    '序号', '姓名', '职务',
    '基本', '岗位', '绩效奖金', '全勤奖', '技能津贴', '学历津贴', '其它津贴', '合计工资',
    '午餐补助', '高温及其他', '招商提成',
    '应出勤', '请假', '实出勤', '全勤',
    '应发工资', '社保', '上月个税', '其他扣款', '实发金额', '签收', '备注',
  ]

  const body = dto.rows.map((r, i) => [
    i + 1, r.name, r.role ?? '',
    r.base, r.post, r.perf, r.attend, r.skill, r.edu, r.other, r.wageTotal,
    r.lunch, r.heat, r.commission,
    r.shouldDays, r.leaveDays, r.actualDays, r.fullAttend ? '全勤' : '—',
    r.gross, r.social, r.tax, r.otherDeduct, r.net, r.sign ? '已签' : '待签', r.note ?? '',
  ])

  const t = dto.total
  const footer = [
    '合计', `${dto.rows.length} 人`, '',
    t.base, t.post, t.perf, t.attend, t.skill, t.edu, t.other, t.wageTotal,
    t.lunch, t.heat, t.commission,
    '', '', '', '',
    t.gross, t.social, t.tax, t.otherDeduct, t.net, '', '',
  ]

  const ws = XLSX.utils.aoa_to_sheet([header, ...body, footer])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, `${dto.year}年${dto.month}月`)
  XLSX.writeFile(wb, `附表12-工资明细-${dto.year}年${dto.month}月.xlsx`)
}

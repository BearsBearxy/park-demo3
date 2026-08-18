import { describe, it, expect, vi } from 'vitest'

// 出流验证只关心「写出的 xlsx 回读一致」,不关心浏览器下载动作 —— 把 downloadBlob 换成收字节的桩。
const written = vi.fn()
vi.mock('./billExcel', () => ({ downloadBlob: (blob: Blob, name: string) => written(blob, name) }))

import { writeAoaWorkbook, readAoaWorkbook } from './sheet'

// 真写真读一遍 exceljs(~500KB import + zip 编解码);单跑 <1s,并发抢 CPU 时给足余量。
describe('sheet 适配层', { timeout: 30_000 }, () => {
  it('写出的 workbook 回读得回同样的表名/AOA,数字仍是数字', async () => {
    await writeAoaWorkbook('回读.xlsx', [
      { name: '一期/园区电', aoa: [['表头', '数值', ''], ['甲', 1234.5, ''], ['合计', 1234.5, '']] },
      { name: '明细', aoa: [['只有一行']] },
    ])
    const [blob, name] = written.mock.calls[0]
    expect(name).toBe('回读.xlsx')
    // jsdom 25 没实现 Blob.arrayBuffer(),只能走 FileReader 把字节要回来
    const buf = await new Promise<ArrayBuffer>(res => {
      const fr = new FileReader()
      fr.onload = () => res(fr.result as ArrayBuffer)
      fr.readAsArrayBuffer(blob)
    })
    const sheets = await readAoaWorkbook(buf)
    // sheet 名的 '/' 是 Excel 禁用字符,适配层剥掉(否则 exceljs 直接抛)
    expect(sheets.map(s => s.name)).toEqual(['一期园区电', '明细'])
    expect(sheets[0].matrix).toEqual([['表头', '数值', ''], ['甲', '1234.5', ''], ['合计', '1234.5', '']])
  })

  it('合并从属格出空串、日期出 yyyy-mm-dd、公式出缓存值、全空行剔除', async () => {
    const Workbook = (await import('exceljs')).Workbook
    const wb = new Workbook()
    const ws = wb.addWorksheet('s')
    ws.addRow(['区域', '月份', '金额'])
    ws.addRow(['一车间', new Date(Date.UTC(2024, 1, 1)), 100])
    ws.addRow([null, null, null])                                   // 全空行 → 应被剔除
    ws.addRow(['', '', { formula: 'SUM(C2:C2)', result: 100 }])
    ws.mergeCells('A2:A4')   // A3/A4 成为从属格:SheetJS 给空,exceljs 会回主格值「一车间」
    const buf = await wb.xlsx.writeBuffer()

    const [{ matrix }] = await readAoaWorkbook(buf as ArrayBuffer)
    expect(matrix).toEqual([
      ['区域', '月份', '金额'],
      ['一车间', '2024-02-01', '100'],
      ['', '', '100'],   // 合并从属格 A4 必须是空串 —— 否则 meterExcel 的空行判定会把合并区整片当真数据
    ])
  })

  // 回归护栏(2026-08-18 审计):公式格缓存结果为 0 时必须出 '0',不能出 ''。
  // exceljs 的 FormulaValue._copyModel 拷字段用真值判断,result===0 会从 cell.value 上整个消失;
  // 适配层若读 cell.value.result 就把 0 读成空串。下游 meterExcel 的 cleanNum 把 '' 当漏抄(null)、
  // 把 '0' 当真读数 0 —— 上月止度 0 变 null,本月用量整行派生成 null,那户水电费凭空消失且不报错。
  // 上一版用例只测了 result:100(真值)所以没抓到,这条专测 0。
  it('公式缓存值为 0 必须读成 "0" 而不是空串', async () => {
    const Workbook = (await import('exceljs')).Workbook
    const wb = new Workbook()
    const ws = wb.addWorksheet('s')
    ws.addRow(['上月止度', '本月止度'])
    ws.addRow([{ formula: 'A1*0', result: 0 }, { formula: 'B1*1', result: 12 }])
    const buf = await wb.xlsx.writeBuffer()

    const [{ matrix }] = await readAoaWorkbook(buf as ArrayBuffer)
    expect(matrix[1]).toEqual(['0', '12'])
    expect(matrix[1][0]).not.toBe('')   // 说清失败时的含义:空串 = 被下游当成漏抄
  })
})

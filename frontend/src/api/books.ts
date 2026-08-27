import http from './index'
import type { Book, BookDef, TemplateSaveResult, TemplateVersion } from '../types/book'

// 账册与模板(BOOK-WORKBENCH-SPEC)。http unwraps Result envelope.
export const booksApi = {
  list: (screen: 'ledger' | 's10'): Promise<Book[]> =>
    http.get('/books', { params: { screen } }),
  // 从 year/month 那版改起,存成链尾+1 并只把该月切过去(spec P4/P5:任何保存都升版);
  // 标准列删除 → 409;该月已录入 → 409(P6 冻结)
  saveTemplate: (bookId: number, definition: BookDef, year: number, month: number, note?: string): Promise<TemplateSaveResult> =>
    http.put(`/books/${bookId}/template`, { definition, note, year, month }),
  // 带 year/month:current 标的是该月生效版,而不是链尾(否则面板头部下拉与右侧列表互相矛盾)
  versions: (bookId: number, year?: number, month?: number): Promise<{ versions: TemplateVersion[] }> =>
    http.get(`/books/${bookId}/template/versions`, { params: { year, month } }),
  // 历史版本定义(只读预览列名与布局;GET 读全开,查看不需要 book-template:edit)
  versionDefinition: (bookId: number, ver: number): Promise<BookDef> =>
    http.get(`/books/${bookId}/template/versions/${ver}`),
  // 某月生效的模板(按 pin 解析:本月 → 最近更早月 → 链尾)
  templateAt: (bookId: number, year: number, month: number): Promise<Book> =>
    http.get(`/books/${bookId}/template/at/${year}/${month}`),
  // 钉本月的版本(不造版本;该月已录入 → 409)
  pin: (bookId: number, ver: number, year: number, month: number): Promise<Book> =>
    http.post(`/books/${bookId}/template/pin`, { ver, year, month }),
}

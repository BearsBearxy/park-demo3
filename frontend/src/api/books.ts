import http from './index'
import type { Book, BookDef, TemplateSaveResult, TemplateVersion } from '../types/book'

// 账册与模板(BOOK-WORKBENCH-SPEC)。http unwraps Result envelope.
export const booksApi = {
  list: (screen: 'ledger' | 's10'): Promise<Book[]> =>
    http.get('/books', { params: { screen } }),
  // 轻改动原版就地更新;结构改动升版;标准列删除 → 409
  saveTemplate: (bookId: number, definition: BookDef, note?: string): Promise<TemplateSaveResult> =>
    http.put(`/books/${bookId}/template`, { definition, note }),
  versions: (bookId: number): Promise<{ versions: TemplateVersion[] }> =>
    http.get(`/books/${bookId}/template/versions`),
  // 历史版本定义(只读预览列名与布局;GET 读全开,查看不需要 book-template:edit)
  versionDefinition: (bookId: number, ver: number): Promise<BookDef> =>
    http.get(`/books/${bookId}/template/versions/${ver}`),
  // 切本册的模板版本指针(不造新版本;缺列且该册有数据 → 409)
  adopt: (bookId: number, ver: number): Promise<Book> =>
    http.post(`/books/${bookId}/template/adopt`, { ver }),
}

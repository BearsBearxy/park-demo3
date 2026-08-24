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
  // 回滚=复制历史版为新版本(版本号只前进)
  rollback: (bookId: number, ver: number): Promise<Book> =>
    http.post(`/books/${bookId}/template/rollback`, { ver }),
}

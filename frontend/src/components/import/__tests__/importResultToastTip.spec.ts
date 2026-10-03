// 导入结果弹层:档案变化清单里表名的悬停说明(十件 ⑩,2026-10-01)走 v-tip,不再是浏览器 title。
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import ImportResultToast from '../ImportResultToast.vue'
import type { ImportResultDTO } from '@/types/import'

vi.mock('@/api/building', () => ({ buildingApi: { list: vi.fn(() => Promise.resolve([])) } }))

const RESULT: ImportResultDTO = {
  imported: 3,
  skipped: 0,
  errors: [],
  changes: [
    { meterId: 7, label: 'A座 3F 东 · 301 电表', field: 'roomNo', before: '301', after: '302', from: '2026-08', until: null },
  ],
}

describe('ImportResultToast · 档案变化的表名', () => {
  it('表名太长被截时悬停看全,走 v-tip', async () => {
    const w = mount(ImportResultToast, { props: { result: RESULT } })
    await w.find('.ir-chg .ir-errs-toggle').trigger('click')
    const label = w.get('.ir-chg .ir-errs-label')
    expect((label.element as HTMLElement & { _tip?: { text: string } })._tip?.text).toBe('A座 3F 东 · 301 电表')
    expect(label.attributes('title')).toBeUndefined()
  })
})

import { describe, it, expect } from 'vitest'
import { suggestBind, oneCharDiff } from './tenantSuggest'

// V105 问题面板候选引擎:精确命中(含退租/别名) → 前缀父租户 → 剥后缀 → 一字之差
const T = (id: number, companyName: string, status = 1, aliases: string | null = null, parentId: number | null = null) =>
  ({ id, companyName, status, aliases, parentId })

describe('suggestBind', () => {
  it('精确命中唯一档案 → auto(含退租户,说明导入月当时可能在租)', () => {
    const r = suggestBind('黄路生', [T(7, '黄路生', 2)])
    expect(r.auto?.id).toBe(7)
    expect(r.auto?.reason).toContain('已退租')
  })

  it('别名命中同权(V86)', () => {
    const r = suggestBind('李富全', [T(3, '鑫皇', 1, '李富全')])
    expect(r.auto?.id).toBe(3)
  })

  it('同名多档不给 auto,降级为候选让人工选', () => {
    const r = suggestBind('曼克维', [T(1, '曼克维', 2), T(2, '曼克维', 1)])
    expect(r.auto).toBeNull()
    expect(r.candidates.map(c => c.id).sort()).toEqual([1, 2])
  })

  it('前缀父租户:「王柱宿舍」→ 王柱', () => {
    const r = suggestBind('王柱宿舍', [T(5, '王柱')])
    expect(r.auto).toBeNull()
    expect(r.candidates[0].id).toBe(5)
  })

  it('一字之差抓错别字:黄路升 → 黄路生', () => {
    const r = suggestBind('黄路升', [T(7, '黄路生')])
    expect(r.candidates.some(c => c.id === 7)).toBe(true)
  })

  it('毫无关联的名字:无 auto 无候选(文案层兜底)', () => {
    const r = suggestBind('完全无关公司', [T(1, '鑫皇'), T(2, '广联')])
    expect(r.auto).toBeNull()
    expect(r.candidates).toEqual([])
  })
})

describe('oneCharDiff', () => {
  it('等长一位替换 / 差一位插入 → true;全等或差两位 → false', () => {
    expect(oneCharDiff('黄路生', '黄路升')).toBe(true)
    expect(oneCharDiff('广联', '广联达')).toBe(true)
    expect(oneCharDiff('广联', '广联')).toBe(false)
    expect(oneCharDiff('张三', '李四')).toBe(false)
  })
})

// useCompare 单测:localStorage 'fp-ana-compare' 持久化 / 模块级单例跨屏共享 /
// 支持集外回退 none(原始选择保留)/ set 越权忽略 / 启动恢复(损坏值回 none)。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetCompareForTest, useCompare } from './useCompare'

beforeEach(() => {
  __resetCompareForTest()
  localStorage.clear()
})

describe('useCompare', () => {
  it('默认 none;set 持久化并跨屏共享(模块级单例)', () => {
    const a = useCompare(['mom', 'budget'])
    expect(a.mode.value).toBe('none')
    a.set('mom')
    expect(a.mode.value).toBe('mom')
    expect(localStorage.getItem('fp-ana-compare')).toBe('mom')
    const b = useCompare(['mom', 'yoy'])
    expect(b.mode.value).toBe('mom')
  })

  it('持久化值不在本屏支持集 → 本屏读 none;原始选择保留,支持屏不受影响', () => {
    const full = useCompare(['mom', 'yoy', 'budget'])
    full.set('yoy')
    const limited = useCompare(['mom'])
    expect(limited.mode.value).toBe('none')
    expect(full.mode.value).toBe('yoy')
  })

  it('set 不在支持集的模式被忽略;none 总是允许', () => {
    const s = useCompare(['mom'])
    s.set('budget')
    expect(s.mode.value).toBe('none')
    expect(localStorage.getItem('fp-ana-compare')).toBeNull()
    s.set('mom')
    s.set('none')
    expect(s.mode.value).toBe('none')
    expect(localStorage.getItem('fp-ana-compare')).toBe('none')
  })

  it('启动从 localStorage 恢复;损坏值回退 none', async () => {
    localStorage.setItem('fp-ana-compare', 'yoy')
    vi.resetModules()
    const fresh = await import('./useCompare')
    expect(fresh.useCompare(['yoy']).mode.value).toBe('yoy')

    localStorage.setItem('fp-ana-compare', 'garbage')
    vi.resetModules()
    const broken = await import('./useCompare')
    expect(broken.useCompare(['yoy']).mode.value).toBe('none')
  })
})

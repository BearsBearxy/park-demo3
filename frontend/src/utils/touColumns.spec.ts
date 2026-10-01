import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadTouPref, saveTouPref, touColsOn, touMode } from './touColumns'

afterEach(() => { localStorage.clear(); vi.restoreAllMocks() })

describe('touMode 按比例出列(04-C 三张卡)', () => {
  it('宿舍 0/299=none、一期 49/184=row、二期 63/69=cols、恰好一半=row', () => {
    expect(touMode(0, 299)).toBe('none')
    expect(touMode(49, 184)).toBe('row')
    expect(touMode(63, 69)).toBe('cols')
    expect(touMode(50, 100)).toBe('row')
  })
})

describe('touColsOn 开关记住上次选择', () => {
  it('没选过:过半默认开、少数默认关', () => {
    expect(touColsOn('cols', 'meter')).toBe(true)
    expect(touColsOn('row', 'meter')).toBe(false)
  })
  it('选过就按上次:二期关掉后仍关,一期打开后仍开;两屏各记各的', () => {
    saveTouPref('meter', false)
    expect(touColsOn('cols', 'meter')).toBe(false)
    saveTouPref('pool', true)
    expect(touColsOn('row', 'pool')).toBe(true)
    expect(loadTouPref('pool')).toBe(true)
    expect(loadTouPref('meter')).toBe(false)
  })
  it('none 恒关,记过开也不出', () => {
    saveTouPref('pool', true)
    expect(touColsOn('none', 'pool')).toBe(false)
  })
  it('localStorage 抛错:读回 null(调用方按比例走),写不抛', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    expect(() => saveTouPref('pool', false)).not.toThrow()
    expect(loadTouPref('pool')).toBe(null)
  })
})

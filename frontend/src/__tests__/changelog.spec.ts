// 更新内容(src/changelog.ts)的门禁:这些字会原样上屏,写错了没人报错。
import { describe, it, expect, vi } from 'vitest'
import { CHANGELOG, APP_VERSION, noteOf } from '@/changelog'
import { isTabValue } from '@/stores/tabs'
import { iconFor } from '@/components/ds/icon'

describe('changelog', () => {
  it('第一段就是当前构建的版本(发版时改了版本号却忘了写内容,这条会红)', () => {
    expect(CHANGELOG[0].version).toBe(APP_VERSION)
    expect(noteOf(APP_VERSION)).toBeDefined()
  })

  it('版本按日期从新到旧排', () => {
    const dates = CHANGELOG.map((n) => n.date)
    expect(dates).toEqual([...dates].sort().reverse())
  })

  it('版本号不重复', () => {
    const vs = CHANGELOG.map((n) => n.version)
    expect(new Set(vs).size).toBe(vs.length)
  })

  it('日期一律 YYYY-MM-DD', () => {
    for (const n of CHANGELOG) expect(n.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  // 页签能开的屏都算:侧栏里的屏 + 首页(0.14.0 起登录落在首页)
  it('每条「去看看」都指向真实存在的屏', () => {
    for (const n of CHANGELOG) {
      for (const it of [n.feature, ...n.added, ...n.improved].filter(Boolean)) {
        if (it!.to) expect(isTabValue(it!.to), `${n.version} / ${it!.title} 指向不存在的屏 ${it!.to}`).toBe(true)
      }
    }
  })

  it('图标名都在 icon.ts 的表里(写错会回落成问号)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const n of CHANGELOG) {
      for (const it of [n.feature, ...n.added, ...n.improved].filter(Boolean)) iconFor(it!.icon)
    }
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('标题与说明不为空,且不写开发用语', () => {
    // 屏上文案三条(screen-copy-no-jargon-no-overlay):不提设计稿、不写行话。
    const BAN = ['重构', '门禁', '口径', 'refactor', 'commit', '提交记录', '设计稿', 'chunk', 'store']
    for (const n of CHANGELOG) {
      expect(n.headline.trim()).not.toBe('')
      for (const it of [n.feature, ...n.added, ...n.improved].filter(Boolean)) {
        expect(it!.title.trim()).not.toBe('')
        for (const word of BAN) {
          expect(`${it!.title}${it!.desc}`.includes(word), `${n.version} / ${it!.title} 里出现了「${word}」`).toBe(false)
        }
      }
      for (const f of n.fixed) {
        expect(f.trim()).not.toBe('')
        for (const word of BAN) expect(f.includes(word), `${n.version} 的修复条目里出现了「${word}」`).toBe(false)
      }
    }
  })
})

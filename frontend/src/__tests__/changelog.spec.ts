// 更新内容(src/changelog.ts)的门禁:这些字会原样上屏,写错了没人报错。
import { describe, it, expect, vi } from 'vitest'
import { CHANGELOG, APP_VERSION, noteOf, cmpVersion as cmp } from '@/changelog'
import { isTabValue } from '@/stores/tabs'
import { iconFor } from '@/components/ds/icon'
import type { ReleaseItem, ReleaseNote } from '@/types/changelog'
import { RELEASE_ART } from '@/components/shell/release/art'

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

// ── 更新公告规范的自动检查(docs/design/RELEASE-NOTES-SPEC.md §9)────────────────
// 只查 0.14.0 及以后:更早的版本写在这份规范之前,不回头改。人工才判得了的(标题是不是屏名、
// 改进有没有写「原来 …，现在 …」、配图画得对不对)不在这里,归文案复查。
const num = (v: string) => v.split('-')[0].split('.').map(Number)
const RULED = CHANGELOG.filter((n) => cmp(n.version, '0.14.0') >= 0)
/** 字数:中文、英文字母、数字、标点各算 1 个,空格不算(§4)。 */
const len = (s: string) => [...s.replace(/\s/g, '')].length
const itemsOf = (n: ReleaseNote): ReleaseItem[] => [n.feature, ...n.added, ...n.improved].filter(Boolean) as ReleaseItem[]
/** 一版里所有会上屏的字。 */
const textsOf = (n: ReleaseNote) =>
  [n.headline, ...itemsOf(n).flatMap((i) => [i.title, i.desc, i.toLabel ?? '']), ...n.fixed].filter(Boolean)
const inRange = (s: string, lo: number, hi: number) => len(s) >= lo && len(s) <= hi

describe('更新公告规范(RELEASE-NOTES-SPEC §9)', () => {
  it('规范管得到的版本不是空的(否则下面全是空断言)', () => {
    expect(RULED.length).toBeGreaterThan(0)
  })

  it('版本号是纯 X.Y.Z,不带预发布后缀', () => {
    for (const n of RULED) expect(n.version, n.version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('版本号按语义从大到小', () => {
    for (let i = 1; i < CHANGELOG.length; i++) {
      expect(cmp(CHANGELOG[i - 1].version, CHANGELOG[i].version),
        `${CHANGELOG[i - 1].version} 应比 ${CHANGELOG[i].version} 大`).toBeGreaterThan(0)
    }
  })

  // 小调整版不自动弹(只亮 ✦ 蓝点),所以不许藏新增在里面:有新增就是功能更新,中间一位要涨
  it('小调整版(最后一位不是 0):没有重点卡、没有新增,改进 + 修复至少一条', () => {
    for (const n of RULED.filter((x) => num(x.version)[2] !== 0)) {
      expect(n.feature, `${n.version} 是小调整却有重点卡`).toBeUndefined()
      expect(n.added.length, `${n.version} 是小调整却有新增 —— 有新增就是功能更新`).toBe(0)
      expect(n.improved.length + n.fixed.length, `${n.version} 一条内容都没有`).toBeGreaterThan(0)
    }
  })

  it('功能更新版(最后一位是 0):至少一条内容', () => {
    for (const n of RULED.filter((x) => num(x.version)[2] === 0)) {
      expect(itemsOf(n).length + n.fixed.length, `${n.version} 一条内容都没有`).toBeGreaterThan(0)
    }
  })

  // §3:重点卡 = 最重要的那条新增,其余新增进 added。只有一条新增时 added 为空、只有重点卡(0.15.0 暗色外观)。
  it('有新增就必须有重点卡;没有重点卡就不许有新增(重点卡的标签写死是「新增」)', () => {
    for (const n of RULED.filter((x) => num(x.version)[2] === 0)) {
      if (!n.feature) expect(n.added, `${n.version}:没有重点卡却有新增`).toEqual([])
      if (n.added.length) expect(!!n.feature, `${n.version}:新增 ${n.added.length} 条,没有重点卡`).toBe(true)
    }
  })

  it('各段字数在 §4 的范围内', () => {
    for (const n of RULED) {
      expect(inRange(n.headline, 8, 20), `${n.version} 一句话标题 ${len(n.headline)} 字(8–20)`).toBe(true)
      if (n.feature) {
        expect(inRange(n.feature.title, 2, 12), `${n.version} 重点卡标题 ${len(n.feature.title)} 字(2–12)`).toBe(true)
        expect(inRange(n.feature.desc, 40, 100), `${n.version} 重点卡说明 ${len(n.feature.desc)} 字(40–100)`).toBe(true)
      }
      for (const it of [...n.added, ...n.improved]) {
        expect(inRange(it.title, 2, 12), `${n.version} / ${it.title}:标题 ${len(it.title)} 字(2–12)`).toBe(true)
        expect(inRange(it.desc, 10, 45), `${n.version} / ${it.title}:说明 ${len(it.desc)} 字(10–45)`).toBe(true)
      }
      for (const it of itemsOf(n)) {
        if (it.toLabel) expect(inRange(it.toLabel, 2, 6), `${n.version} / ${it.title}:跳转字 ${len(it.toLabel)} 字(2–6)`).toBe(true)
      }
      for (const f of n.fixed) expect(inRange(f, 15, 45), `${n.version} 修复「${f}」${len(f)} 字(15–45)`).toBe(true)
    }
  })

  it('条数:新增 + 改进 ≤ 6(不算重点卡),修复 ≤ 5', () => {
    for (const n of RULED) {
      expect(n.added.length + n.improved.length, `${n.version} 新增 + 改进`).toBeLessThanOrEqual(6)
      expect(n.fixed.length, `${n.version} 修复`).toBeLessThanOrEqual(5)
    }
  })

  it('整版总字数 ≤ 450', () => {
    for (const n of RULED) {
      const total = len(n.headline) + itemsOf(n).reduce((s, i) => s + len(i.title) + len(i.desc), 0)
        + n.fixed.reduce((s, f) => s + len(f), 0)
      expect(total, `${n.version} 整版 ${total} 字`).toBeLessThanOrEqual(450)
    }
  })

  it('按 ，。；：！？（） 切开后每一段 ≤ 30 字(顿号不切)', () => {
    for (const n of RULED) {
      for (const t of textsOf(n)) {
        for (const seg of t.split(/[，。；：！？（）]/)) {
          expect(len(seg), `${n.version}「${seg}」${len(seg)} 字`).toBeLessThanOrEqual(30)
        }
      }
    }
  })

  it('扩充的禁词、感叹号、emoji', () => {
    const BAN2 = ['优化', '若干', '已知问题', '全新', '重磅', '大幅']
    for (const n of RULED) {
      for (const t of textsOf(n)) {
        for (const w of BAN2) expect(t.includes(w), `${n.version}「${t}」里有「${w}」`).toBe(false)
        expect(/bug/i.test(t), `${n.version}「${t}」里有 bug`).toBe(false)
        expect(/[！!]/.test(t), `${n.version}「${t}」里有感叹号`).toBe(false)
        expect(/\p{Extended_Pictographic}/u.test(t), `${n.version}「${t}」里有 emoji`).toBe(false)
      }
    }
  })

  it('一句话标题:没有句号,最多一个逗号', () => {
    for (const n of RULED) {
      expect(n.headline.includes('。'), `${n.version} 标题有句号`).toBe(false)
      expect((n.headline.match(/，/g) ?? []).length, `${n.version} 标题的逗号`).toBeLessThanOrEqual(1)
    }
  })

  it('中文和英文、数字之间有空格', () => {
    for (const n of RULED) {
      for (const t of textsOf(n)) {
        expect(/[\u4e00-\u9fa5][A-Za-z0-9]|[A-Za-z0-9][\u4e00-\u9fa5]/.test(t), `${n.version}「${t}」中英文 / 数字之间少空格`).toBe(false)
      }
    }
  })

  it('修复条目不以「修复」「解决」开头(写原来的现象)', () => {
    for (const n of RULED) {
      for (const f of n.fixed) expect(/^(修复|解决)/.test(f), `${n.version}「${f}」`).toBe(false)
    }
  })

  it('同一版里标题不重复', () => {
    for (const n of RULED) {
      const titles = itemsOf(n).map((i) => i.title)
      expect(new Set(titles).size, `${n.version} 标题有重复:${titles.join(' / ')}`).toBe(titles.length)
    }
  })
})

// 配图按版本登记(RELEASE-NOTES-SPEC §5):有重点卡的版本忘了画图,弹窗和更新记录里那张卡就只剩字
describe('重点卡配图', () => {
  it('0.13.0 起有重点卡的版本都登记了配图', () => {
    for (const n of CHANGELOG.filter((x) => x.feature && cmp(x.version, '0.13.0') >= 0)) {
      expect(RELEASE_ART[n.version], `v${n.version} 有重点卡却没登记配图(components/shell/release/art.ts)`).toBeDefined()
    }
  })

  it('登记了配图的版本都在更新记录里、而且有重点卡(没重点卡的图没处放)', () => {
    for (const v of Object.keys(RELEASE_ART)) {
      const n = CHANGELOG.find((x) => x.version === v)
      expect(n, `配图登记了 v${v},更新记录里没有这一版`).toBeDefined()
      expect(n!.feature, `v${v} 没有重点卡`).toBeDefined()
    }
  })
})

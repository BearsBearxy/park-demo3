// 十件标准件里的 ⑦ 空状态 · 加载失败、⑥ 页面状态、④ 块内提示、① 就地标记、⑤ 字段报错（画布 06-B / 06-D / 01-A）。
// 实现规范 docs/superpowers/specs/2026-10-01-hint-widetable-bell-impl-design.md §1.4 / §1.5。
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import FPEmpty from '../FPEmpty.vue'
import FPLoadError from '../FPLoadError.vue'
import FPStateTag from '../FPStateTag.vue'
import FPNote from '../FPNote.vue'
import FPMark from '../FPMark.vue'
import AnaEmpty from '@/components/ana/AnaEmpty.vue'

const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8').replace(/\r\n/g, '\n')
const styleOf = (src: string) => [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n')
/** 某条规则（选择器原样）的声明块 */
const rule = (css: string, sel: string) => css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}'))?.[1] ?? ''

describe('⑦ 空状态 · 加载失败', () => {
  it('FPLoadError:role=alert、一句 + 副句、唯一按钮「重试」点了 emit retry；不再是 .fp-lderr 流内条', async () => {
    const w = mount(FPLoadError, { props: { sub: '屏上不显示上个月的数字' }, slots: { default: '2023 年 8 月的数据没读到' } })
    expect(w.attributes('role')).toBe('alert')
    expect(w.classes()).toEqual(expect.arrayContaining(['fp-empty', 'error']))
    expect(w.classes()).not.toContain('fp-lderr')
    expect(w.find('.t').text()).toBe('2023 年 8 月的数据没读到')
    expect(w.find('.sub').text()).toBe('屏上不显示上个月的数字')
    const btns = w.findAll('button')
    expect(btns.map((b) => b.text())).toEqual(['重试'])
    await btns[0].trigger('click')
    expect(w.emitted('retry')).toHaveLength(1)
  })

  it('FPLoadError 兼容旧的 retryText；不传 sub 就没有副句', () => {
    const w = mount(FPLoadError, { props: { retryText: '重新加载' }, slots: { default: 'x' } })
    expect(w.find('button').text()).toBe('重新加载')
    expect(w.find('.sub').exists()).toBe(false)
  })

  it('FPEmpty tone=empty:不报警，按钮写动作本身，点了 emit action；不给 action 就没有按钮', async () => {
    const w = mount(FPEmpty, { props: { action: '生成本月' }, slots: { default: '2023-09 的催缴单还没生成' } })
    expect(w.attributes('role')).toBeUndefined()
    expect(w.classes()).toContain('empty')
    await w.find('button').trigger('click')
    expect(w.emitted('action')).toHaveLength(1)
    expect(mount(FPEmpty, { slots: { default: 'x' } }).find('button').exists()).toBe(false)
  })

  it('FPEmpty 只长不缩：定高 flex 列里挤的时候，字不被压出自己的盒子（旧位置放在表格上方也不叠到表上）', () => {
    const d = rule(styleOf(read('FPEmpty.vue')), '.fp-empty')
    expect(d).toMatch(/flex:\s*1 0 auto/)
    expect(d).toMatch(/min-height:\s*200px/)
  })

  it('AnaEmpty 换成 FPEmpty 的 sm 档：label 是那一句、hint 是副句', () => {
    setActivePinia(createPinia())
    const w = mount(AnaEmpty, { props: { label: '合同日期未录入', hint: '去补录' } })
    expect(w.classes()).toEqual(expect.arrayContaining(['fp-empty', 'sm', 'ana-empty']))
    expect(w.find('.t').text()).toBe('合同日期未录入')
    expect(w.find('.sub').text()).toBe('去补录')
  })
})

describe('⑥ 页面状态 · ④ 块内提示 · ① 就地标记 · ⑤ 字段报错', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('FPMark tone=danger:6px 圆点 + 字', () => {
    const w = mount(FPMark, { props: { tone: 'danger' }, slots: { default: '比上月少 1.43' } })
    expect(w.classes()).toContain('danger')
    expect(w.find('.dot').exists()).toBe(true)
    expect(w.text()).toBe('比上月少 1.43')
    expect(rule(styleOf(read('FPMark.vue')), '.dot')).toMatch(/width:\s*6px;\s*height:\s*6px/)
  })

  it('FPNote tone=warn:根类含 warn；样式里没有竖条、没有虚线', () => {
    const w = mount(FPNote, { props: { tone: 'warn' }, slots: { default: '租金行还没绑单元' } })
    expect(w.classes()).toContain('warn')
    const css = styleOf(read('FPNote.vue'))
    expect(css).not.toMatch(/border-left|dashed|inset\s+\d/)
    expect(rule(css, '.fp-note')).toMatch(/border-radius:\s*var\(--radius-sm\)/)   // 8px
  })

  it('FPNote #action:行尾按钮，点了 emit action；没有插槽就没有按钮', async () => {
    const w = mount(FPNote, { props: { tone: 'warn' }, slots: { default: '租金行还没绑单元', action: '去绑定' } })
    const b = w.find('button')
    expect(b.text()).toBe('去绑定')
    await b.trigger('click')
    expect(w.emitted('action')).toHaveLength(1)
    expect(mount(FPNote, { props: { tone: 'info' }, slots: { default: 'x' } }).find('button').exists()).toBe(false)
  })

  it('FPStateTag:22 高；warn 带点、edit 带笔、muted 什么都不带', () => {
    expect(rule(styleOf(read('FPStateTag.vue')), '.fp-state')).toMatch(/height:\s*22px/)
    const tag = (tone: 'warn' | 'edit' | 'muted') => mount(FPStateTag, { props: { tone }, slots: { default: 't' } })
    expect(tag('warn').find('.dot').exists()).toBe(true)
    expect(tag('edit').find('svg').exists()).toBe(true)
    expect(tag('edit').find('.dot').exists()).toBe(false)
    const m = tag('muted')
    expect(m.find('.dot').exists() || m.find('svg').exists()).toBe(false)
    expect(m.text()).toBe('t')
  })

  it('base.css 有 .fp-field-err:12px 红字，行高与常驻占位都是 18px', () => {
    const d = rule(readFileSync(join(__dirname, '..', '..', '..', 'styles', 'base.css'), 'utf8'), '.fp-field-err')
    expect(d).toMatch(/min-height:\s*18px/)
    expect(d).toMatch(/line-height:\s*18px/)
    expect(d).toMatch(/font-size:\s*var\(--fs-label\)/)
  })

  it('暗色:这几件的颜色一律走令牌,不写死色值', () => {
    const css = ['FPEmpty.vue', 'FPLoadError.vue', 'FPStateTag.vue', 'FPNote.vue', 'FPMark.vue'].map((f) => styleOf(read(f)))
      .concat(styleOf(read('..', 'ana', 'AnaEmpty.vue')))
      .concat(rule(readFileSync(join(__dirname, '..', '..', '..', 'styles', 'base.css'), 'utf8'), '.fp-field-err'))
      .join('\n')
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|oklch\(|hsla?\(/i)
  })
})

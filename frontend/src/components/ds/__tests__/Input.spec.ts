import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import Input from '../Input.vue'

/**
 * `ds/Input.vue` 的两条**会静默烂掉**的性质。
 *
 * 两条都在 2026-08-22 出过事，而且都是「写了、看起来对、其实没生效、没人发现」那一类：
 * 单看调用方的代码一切正常，只有真在浏览器里点开才会露馅。所以钉在这里。
 */
describe('ds/Input —— 透传属性必须落到 <input> 上', () => {
  /**
   * ⚠ **这条是安全护栏，不是洁癖。**
   *
   * Vue 3 默认把未声明的属性挂到组件的**根元素**。本组件的根元素是外层 <div>，
   * 于是调用方写的 autocomplete / name / readonly 全挂在 div 上，对真正的 <input> 毫无作用。
   *
   * 真实后果：主管授权弹窗（FPElevateDialog）给密码框写了 autocomplete="new-password"
   * 想挡住浏览器自动填充 —— 属性落在 div 上，Chrome 照样把本机存的账号密码填了进去。
   * 「主管走过来亲手输一次密码」这个动作被架空，专员点一下确认就过。
   * 用户实测截图抓到的。
   *
   * 谁要是哪天把 `inheritAttrs: false` 或 `v-bind="$attrs"` 拿掉，这条必须红。
   */
  it('autocomplete / name / readonly 落在 input 而不是根 div', () => {
    const w = mount(Input, {
      props: { modelValue: '', type: 'password' },
      attrs: { autocomplete: 'new-password', name: 'fp-grantor-secret', readonly: true },
    })

    const input = w.get('input')
    expect(input.attributes('autocomplete')).toBe('new-password')
    expect(input.attributes('name')).toBe('fp-grantor-secret')
    expect(input.attributes('readonly')).toBeDefined()

    // 反向断言：根元素上**不该**再有这些属性（否则说明只是两边都挂了，问题没真修）
    expect(w.element.getAttribute('autocomplete')).toBeNull()
    expect(w.element.getAttribute('name')).toBeNull()
  })

  it('声明过的 props 不会被当成透传属性重复挂到 input 上', () => {
    const w = mount(Input, { props: { modelValue: 'x', placeholder: 'p', disabled: true } })
    const input = w.get('input')
    expect(input.attributes('placeholder')).toBe('p')
    expect(input.attributes('disabled')).toBeDefined()
  })
})

describe('ds/Input —— 提示位必须常驻（LAYOUT-STABILITY-SPEC §4.2）', () => {
  /**
   * 提示行原来是 `v-if="error || hint"`：校验失败时凭空长出一行，
   * 把下面的字段和提交按钮整体顶下去 —— 用户正要重点一次的按钮在他手指底下跑掉。
   */
  it('⚠ 没接 error/hint 的字段不留槽 —— 否则整张表单平白胖一圈', () => {
    // 首版让每个输入框都留一行，主管授权弹窗两个字段之间空出老大一块。
    // 用户 2026-08-23：「这条提示留这么多位置干什么」
    const w = mount(Input, { props: { modelValue: '' } })
    expect(w.find('.ds-in-msg').exists()).toBe(false)
  })

  it('接了 error（哪怕当前是空串）就留槽，位置常驻', () => {
    // :error="err" 且 err='' —— 这正是「现在没错，但随时可能出错」的字段
    const w = mount(Input, { props: { modelValue: '', error: '' } })
    const msg = w.find('.ds-in-msg')
    expect(msg.exists()).toBe(true)      // 元素在
    expect(msg.text()).toBe('')          // 只是没内容
  })

  it('error 从空变成有内容，元素个数不变（没有东西是「长出来」的）', () => {
    const empty = mount(Input, { props: { modelValue: '', error: '' } })
    const filled = mount(Input, { props: { modelValue: '', error: '账号或密码错误' } })
    expect(filled.findAll('*').length).toBe(empty.findAll('*').length)
    expect(filled.get('.ds-in-msg').text()).toBe('账号或密码错误')
  })

  it('error 优先于 hint', () => {
    const w = mount(Input, { props: { modelValue: '', hint: '提示', error: '错误' } })
    expect(w.get('.ds-in-msg').text()).toBe('错误')
  })
})

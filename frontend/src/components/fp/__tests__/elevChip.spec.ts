// 临时授权胶囊 + 授权卡片(ELEVATION-SPEC §4.5,画布 08 ElevChip / ElevStates):
// 顶栏 28 高蓝描边胶囊(钥匙 + 剩余 m:ss,多份带份数);点开 420 宽卡片,页面不变暗,点外面 / Esc 收起;
// 最后 1 分钟变橙、卡片只剩卡头卡底;手机卡片少两句;结束授权前有未保存改动先问。
// 「❗」开头的做过破坏验证。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'

vi.mock('@/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(() => Promise.resolve()) },
  readToken: () => 'test-token',
  bindSession: vi.fn(),
  sessionDrifted: () => false,
}))

import api from '@/api'
import FPElevChip from '../FPElevChip.vue'
import { useAuthStore, type Grant } from '@/stores/auth'
import { askQueue, answer } from '@/utils/ask'
import { fmtLeft, grantBatches, hhmm } from '@/utils/elevation'

// 14:03:19 —— 14:32 到期的那份剩 28:41,授权时刻 14:02(到期 − 30 分钟),和画板 ElevChip 一字不差
const NOW = new Date(2026, 9, 3, 14, 3, 19)
const at = (h: number, m: number, s = 0) => new Date(2026, 9, 3, h, m, s).getTime()
const g = (perm: string, permLabel: string, authorizer: string, authorizerName: string, expiresAt: number): Grant =>
  ({ perm, permLabel, authorizer, authorizerName, expiresAt })
/** 一份:张经理一次批了两项 */
const ONE = [g('param-monthly:edit', '月度计费录入', 'zhang', '张经理', at(14, 32)), g('param-policy:edit', '计费口径', 'zhang', '张经理', at(14, 32))]
/** 两份:张经理 14:32 一份,李主管 14:47 一份 */
const TWO = [g('param-monthly:edit', '月度计费录入', 'zhang', '张经理', at(14, 32)), g('param-policy:edit', '计费口径', 'li', '李主管', at(14, 47))]

let w: VueWrapper | null = null
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(NOW)
  localStorage.clear(); sessionStorage.clear()
  localStorage.setItem('token', 'test-token')
  setActivePinia(createPinia())
  vi.mocked(api.delete).mockClear()
  askQueue.splice(0)
})
afterEach(() => {
  while (askQueue.length) answer(false)
  w?.unmount(); w = null
  vi.useRealTimers()
  document.body.innerHTML = ''
})

async function chip(grants: Grant[], variant?: 'bar' | 'mobile' | 'dialog') {
  vi.mocked(api.get).mockResolvedValueOnce(grants as never)
  const auth = useAuthStore()
  await auth.refreshElevation()
  w = mount(FPElevChip, { props: variant ? { variant } : {}, attachTo: document.body })
  await nextTick()
  return auth
}
const card = () => document.body.querySelector<HTMLElement>('.ec-card')
const txt = (sel: string) => card()?.querySelector(sel)?.textContent?.replace(/\s+/g, '') ?? null
async function openCard() {
  await w!.find('button').trigger('click')
  await nextTick()
  expect(card(), '卡片开了').not.toBeNull()
}

describe('格式', () => {
  it('剩余 m:ss 分不补零、秒补零;时刻 hh:mm;同一次批的几项算一份', () => {
    expect(fmtLeft(1_721_000)).toBe('28:41')
    expect(fmtLeft(42_900)).toBe('0:42')
    expect(fmtLeft(-1)).toBe('0:00')
    expect(hhmm(at(9, 5))).toBe('09:05')
    expect(grantBatches([...TWO].reverse()).map((b) => [b.authorizerName, b.labels])).toEqual([['张经理', ['月度计费录入']], ['李主管', ['计费口径']]])
    expect(grantBatches(ONE)).toHaveLength(1)
  })
})

describe('一份授权', () => {
  it('没有授权:什么都不渲染', async () => {
    await chip([])
    expect(w!.find('.ec').exists()).toBe(false)
  })

  // 破坏验证:卡片时间行把「到期 − 30 分钟」改成直接写到期 → 红;删掉「所有页面都能改」→ 红;操作日志那句换个说法 → 红
  it('❗胶囊写剩余 28:41、不带份数;点开卡片逐字照稿', async () => {
    await chip(ONE)
    expect(w!.find('.ec-chip').text()).toBe('28:41')
    expect(w!.find('.ec-n').exists(), '一份不带份数').toBe(false)
    expect(w!.find('.ec-chip').classes()).not.toContain('warn')
    await openCard()
    expect(txt('.ec-title')).toBe('临时授权')
    expect(txt('.ec-left')).toBe('剩余28:41')
    expect([...card()!.querySelectorAll('.ec-kv dt')].map((e) => e.textContent)).toEqual(['授权人', '可修改', '时间'])
    expect(txt('.ec-kv dd:nth-of-type(1)')).toBe('张张经理')   // 头像「张」+ 名
    expect(txt('.ec-kv dd:nth-of-type(2)')).toBe('月度计费录入计费口径所有页面都能改')
    expect(txt('.ec-time')).toBe('14:02授权→14:32到期')
    // 稿上那句「期间的每一次修改，操作日志里都会同时记下你和张经理的名字」是假话:台账格、抄表读数这类写入根本不进操作日志,
    // 授权人只落在计费参数改动和 auth_audit_log 两处。真的是:这次授权本身记进了操作日志、带授权人(ElevationService elevate.grant)
    expect(card()!.querySelector('.ec-note')!.textContent).toBe('这次授权已记进操作日志，写明由张经理授权。')
    const foot = card()!.querySelector('.ec-f p')!
    expect(foot.querySelector('br'), '两行').not.toBeNull()
    expect([...foot.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent!.trim()).filter(Boolean))
      .toEqual(['结束后，用到这份授权的页面会退出编辑', '点「完成」退出最后一个编辑页时，授权一并结束'])
    expect(card()!.querySelector('.ec-f button')!.textContent!.trim()).toBe('结束授权')
  })

  // 画布 08 ElevStates「远程批准」格:授权人名后「远程批准」,时间行「hh:mm 批准 → hh:mm 到期」;时刻取后端的 grantedAt
  // 破坏验证:FPElevChip 不看 remote(恒写「授权」、不出「远程批准」)→ 第一条红;grantBatches 不用 grantedAt、一律到期 − 30 分钟 → 第二条红
  //          (第一条批准 → 到期恰好 30 分钟,推算也对得上);没 grantedAt 时不推算 → 上面「逐字照稿」那条红
  it('❗远程批准:名后「远程批准」,时间行写「批准」,时刻取 grantedAt', async () => {
    await chip([{ ...g('param-monthly:edit', '抄表', 'wang', '王主管', at(14, 11)), grantedAt: at(13, 41), source: 'remote' }])
    await openCard()
    expect(txt('.ec-kv dd:nth-of-type(1)')).toBe('王王主管远程批准')
    expect(txt('.ec-time')).toBe('13:41批准→14:11到期')
  })

  it('❗当场授权带了 grantedAt 就用它(不再拿到期 − 30 分钟推);不出「远程批准」', async () => {
    await chip([{ ...g('param-monthly:edit', '抄表', 'zhang', '张经理', at(14, 32)), grantedAt: at(14, 0), source: 'onsite' }])
    await openCard()
    expect(txt('.ec-kv dd:nth-of-type(1)')).toBe('张张经理')
    expect(txt('.ec-time')).toBe('14:00授权→14:32到期')
  })

  // 破坏验证:onDoc 里不判 card.contains → 点卡片里面也收起 → 红;onKey 删掉 → Esc 不收 → 红
  it('❗点外面、Esc 收起;点卡片里面不收;页面不变暗(没有遮罩)', async () => {
    await chip(ONE)
    await openCard()
    expect(document.body.querySelector('[class*="scrim"], [class*="backdrop"]'), '页面不变暗').toBeNull()
    card()!.querySelector('.ec-h')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await nextTick()
    expect(card(), '点卡片里面不收').not.toBeNull()
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await nextTick()
    expect(card(), '点外面收起').toBeNull()
    await openCard()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(card(), 'Esc 收起').toBeNull()
  })

  // 破坏验证:warn 阈值改成 < 30_000 → 红;卡片最后 1 分钟不收掉卡身 → 红
  it('❗最后 1 分钟:胶囊、卡里的钥匙和时间变橙;卡片只剩卡头和「到期后…」那句', async () => {
    await chip([g('param-monthly:edit', '月度计费录入', 'zhang', '张经理', NOW.getTime() + 42_000)])
    expect(w!.find('.ec-chip').text()).toBe('0:42')
    expect(w!.find('.ec-chip').classes()).toContain('warn')
    await openCard()
    expect(card()!.querySelector('.ec-ic')!.classList).toContain('warn')
    expect(card()!.querySelector('.ec-left')!.classList).toContain('warn')
    expect(card()!.querySelector('.ec-b'), '授权人 / 可修改 / 时间不出').toBeNull()
    expect(txt('.ec-f p')).toBe('到期后，用到这份授权的页面会退出编辑')
  })

  it('胶囊每秒走一格', async () => {
    await chip(ONE)
    vi.advanceTimersByTime(1000)
    await nextTick()
    expect(w!.find('.ec-chip').text()).toBe('28:40')
  })
})

describe('多份', () => {
  // 破坏验证:grantBatches 按 perm 不按「授权人 + 到期」归组 → ONE 也成两份 → 上一组红;这里的份数 / 先到期的剩 写错 → 红
  it('❗胶囊尾部带份数、时间取先到期那份;卡头「临时授权 · 2 份 / 先到期的剩」;每份一行;「两份一起结束」', async () => {
    await chip(TWO)
    expect(w!.find('.ec-t').text()).toBe('28:41')
    expect(w!.find('.ec-n').text()).toBe('2')
    await openCard()
    expect(txt('.ec-title')).toBe('临时授权·2份')
    expect(txt('.ec-left')).toBe('先到期的剩28:41')
    expect([...card()!.querySelectorAll('.ec-row')].map((r) => r.textContent!.replace(/\s+/g, '')))
      .toEqual(['月度计费录入张张经理14:32到期28:41', '计费口径李李主管14:47到期43:41'])
    expect(card()!.querySelector('.ec-note')!.textContent).toBe('哪一份到期，用到它的页面就退出编辑。')
    expect(txt('.ec-f p')).toBe('两份一起结束')
  })
})

describe('手机', () => {
  // 破坏验证:手机卡片也出「所有页面都能改」/ 操作日志那句 → 红
  it('❗只留钥匙圆钮;卡片贴顶栏下满宽,少「所有页面都能改」、操作日志那句和「完成」那句', async () => {
    await chip(ONE, 'mobile')
    expect(w!.find('.ec-dot').exists()).toBe(true)
    expect(w!.find('.ec-chip').exists(), '不写时间').toBe(false)
    await openCard()
    expect(card()!.classList).toContain('ec-card-m')
    expect(txt('.ec-kv dd:nth-of-type(2)')).toBe('月度计费录入计费口径')
    expect(txt('.ec-time')).toBe('14:02授权→14:32到期')
    expect(card()!.querySelector('.ec-note')).toBeNull()
    expect(txt('.ec-f p')).toBe('结束后，用到它的页面会退出编辑')
  })

  it('最后 1 分钟钥匙变橙', async () => {
    await chip([g('p', '抄表', 'wang', '王主管', NOW.getTime() + 42_000)], 'mobile')
    expect(w!.find('.ec-dot').classes()).toContain('warn')
  })
})

describe('结束授权', () => {
  // 破坏验证:endNow 不查 dirtyScreens 直接结束 → 红;「继续编辑」那支也结束 → 红;正文页名 / 处数写错 → 红
  it('❗有没保存的改动先问:正文给页名和处数,「继续编辑」不结束,「放弃改动并结束授权」才结束', async () => {
    const auth = await chip(ONE)
    auth.openEditor(Symbol('meters'), 'meters', () => 3)
    await openCard()
    card()!.querySelector<HTMLButtonElement>('.ec-f button')!.click()
    await flushPromises()
    expect(card(), '先收卡片再问').toBeNull()
    expect(askQueue[0]).toMatchObject({
      title: '结束授权？',
      body: '园区抄表有 3 处改动还没保存。结束授权会退出编辑，这 3 处改动不会保存。',
      action: '放弃改动并结束授权', cancel: '继续编辑', danger: true,
    })
    answer(false)
    await flushPromises()
    expect(auth.grants, '继续编辑:授权还在').toHaveLength(2)
    expect(api.delete).not.toHaveBeenCalled()

    await openCard()
    card()!.querySelector<HTMLButtonElement>('.ec-f button')!.click()
    await flushPromises()
    answer(true)
    await flushPromises()
    expect(auth.grants).toHaveLength(0)
    expect(api.delete).toHaveBeenCalledWith('/auth/elevate')
  })

  it('两屏都有改动:页名顿号连起来,处数合计', async () => {
    const auth = await chip(ONE)
    auth.openEditor(Symbol('meters'), 'meters', () => 3)
    auth.openEditor(Symbol('params'), 'params', () => 1)
    await openCard()
    card()!.querySelector<HTMLButtonElement>('.ec-f button')!.click()
    await flushPromises()
    expect(askQueue[0].body).toBe('园区抄表、计费参数共有 4 处改动还没保存。结束授权会退出编辑，这 4 处改动不会保存。')
  })

  // 破坏验证:dirtyScreens 不看登记的权限点(全列)→ 红;权限点里有一项不是自己的也当「不靠授权」→ 第二支红
  it('❗结束授权后它不退出编辑的屏不列:登记的权限点全是自己角色给的', async () => {
    const auth = await chip(ONE)
    auth.permissions = ['meter-reading:edit']
    auth.openEditor(Symbol('meters'), 'meters', () => 3, ['meter-reading:edit'])
    auth.openEditor(Symbol('params'), 'params', () => 1, ['param-policy:edit'])
    await openCard()
    card()!.querySelector<HTMLButtonElement>('.ec-f button')!.click()
    await flushPromises()
    expect(askQueue[0].body).toBe('计费参数有 1 处改动还没保存。结束授权会退出编辑，这 1 处改动不会保存。')
    answer(false)
    await flushPromises()

    auth.openEditor(Symbol('meters2'), 'meters', () => 2, ['meter-reading:edit', 'meter-master:edit'])
    await openCard()
    card()!.querySelector<HTMLButtonElement>('.ec-f button')!.click()
    await flushPromises()
    expect(askQueue[0].body, '缺一项要靠授权:列').toBe('园区抄表、计费参数共有 3 处改动还没保存。结束授权会退出编辑，这 3 处改动不会保存。')
  })

  // 破坏验证:没带权限点的那条(锁)不认同屏同函数的「带了的」那条 → 照旧列出、弹框 → 红
  it('❗同一屏同一个改动数函数:锁那条没带权限点,听带了的那条;只剩自己权限的改动 → 不问,直接结束', async () => {
    const auth = await chip(ONE)
    auth.permissions = ['meter-reading:edit']
    const n = () => 3
    auth.openEditor(Symbol('edit-mode'), 'meters', n, ['meter-reading:edit'])
    auth.openEditor(Symbol('edit-lock'), 'meters', n)
    await openCard()
    card()!.querySelector<HTMLButtonElement>('.ec-f button')!.click()
    await flushPromises()
    expect(askQueue).toHaveLength(0)
    expect(auth.grants).toHaveLength(0)
  })

  it('没有没保存的改动(编辑中 0 处也算):不问,直接结束', async () => {
    const auth = await chip(ONE)
    auth.openEditor(Symbol('meters'), 'meters', () => 0)
    await openCard()
    card()!.querySelector<HTMLButtonElement>('.ec-f button')!.click()
    await flushPromises()
    expect(askQueue).toHaveLength(0)
    expect(auth.grants).toHaveLength(0)
  })
})

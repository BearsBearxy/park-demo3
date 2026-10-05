// 操作日志屏。钉三条会真出事的契约:
// ① 三路来源(计费参数/导入/账号与角色)必须各自渲染出可区分的徽标 —— 归一只发生在展示层,
//    三路语义完全不同,糊成一个样子这屏就白做了;
// ② authorizer 有值时「由 XXX 授权」必须出现在那一行里 —— 代他人执行的动作要记两个人,
//    只显示操作人的话「谁批准的」就白记了;
// ③ 改筛选 / 翻页都要**重新发请求并带上参数** —— 这屏是服务端分页,不是前端切片。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import Select from '@/components/ds/Select.vue'
import FPPager from '@/components/fp/FPPager.vue'

const ROWS = [
  { source: 'param', ts: '2026-08-20T10:12:00', actor: 'zhang.kj', action: 'set',
    target: 'p1 · price_flat · 2025-06', detail: '0.83 → 0.91  按物业通知调价', authorizer: null },
  { source: 'import', ts: '2026-08-19T16:40:00', actor: 'li.cw', action: 'complete',
    target: '附表10 销售收入 · 2025-06 · 一泽', detail: 'xxx.xlsx  120/125 行 · 5 警告', authorizer: null },
  // 代他人执行:接管别人手上的编辑锁,主管授权
  { source: 'auth', ts: '2026-08-18T09:05:00', actor: 'wang.zg', action: 'lock.takeover',
    target: 'user:zhangsan', detail: '接管计费参数编辑锁', authorizer: '李主管' },
  // 第 4 路(R1 落库 / R2 上屏):review_log。authorizer 恒 null —— 审核不走提权。
  { source: 'review', ts: '2026-08-17T14:00:00', actor: 'li.sh', action: 'approve',
    target: 'salary:2026-07', detail: null, authorizer: null },
  // 第 5 路(METER-TIMELINE-SPEC §5):meter_archive_log。action = 表.动作,target/detail 后端拼好
  { source: 'meter', ts: '2026-08-16T11:20:00', actor: 'zhao.cb', action: 'assign.update',
    target: 'B座3楼·电表② · 2024-02', detail: '旧户甲 → 新户乙 · 导入 · 2024-02抄表.xlsx', authorizer: null },
  // 第 6 路(V138 value_change_log):action = 表名,target =「行 · 列」,detail =「改前 → 改后」,后端拼好
  { source: 'change', ts: '2026-08-15T09:30:00', actor: 'li.cw', action: 'salary_record',
    target: '2025-06 · 张三 · 基本工资', detail: '4500 → 4800', authorizer: null },
]

const logs = vi.fn()
vi.mock('@/api/system', () => ({ systemApi: { logs: (...a: unknown[]) => logs(...a) } }))

import SystemLogsView from './SystemLogsView.vue'

const page = (over: Record<string, unknown> = {}) =>
  Promise.resolve({ rows: ROWS, total: 3, page: 1, size: 10, actors: ['li.cw', 'wang.zg', 'zhang.kj'],
    tables: ['monthly_ledger', 'salary_record'], ...over })

function mountView() {
  setActivePinia(createPinia())
  return mount(SystemLogsView)
}

beforeEach(() => {
  logs.mockReset()
  logs.mockImplementation(() => page())
})

describe('SystemLogsView', () => {
  // ❗第 4 路(R2 T11)。不改也不炸 —— SRC 有 OTHER 兜底,只是会显示成「其他」,
  //   而「其他」在一屏审计日志上等于「不知道这是什么」。
  //   破坏验证:把 SRC.review 删掉 → 红(退回 OTHER 的「其他」);
  //             把 ACTION 里那四条删掉 → 「通过审核」变成裸的 approve,也红。
  it('❗审核那一路显「审核 / 通过审核」,不是「其他 / approve」', async () => {
    const w = mountView()
    await flushPromises()
    const row = w.findAll('.lg-row').find(r => r.text().includes('salary:2026-07'))!
    expect(row.text()).toContain('审核')
    expect(row.text()).not.toContain('其他')
    expect(row.text()).toContain('通过审核')
    expect(row.text()).not.toContain('approve')
  })

  // 破坏验证:把 SRC_OPTS 里那条删掉 → 红。筛不出来 = 这一路在筛选器里不存在。
  it('❗来源筛选里有「审核」这一项', () => {
    const w = mountView()
    const opts = w.findAllComponents(Select)[0].props('options') as { value: string; label: string }[]
    expect(opts.map(o => o.value)).toContain('review')
  })

  // 第 5 路。破坏验证:删 SRC.meter → 退回「其他」红;删 ACTION 里 'assign.update' → 露出裸码红;
  //   删 SRC_OPTS 的 meter → 最后一条红。
  it('❗表档案那一路显「表档案 / 改归属」,不是「其他 / assign.update」,且筛得出来', async () => {
    const w = mountView()
    await flushPromises()
    const row = w.get('[data-src="meter"]')
    expect(row.text()).toContain('表档案')
    expect(row.text()).not.toContain('其他')
    expect(row.text()).toContain('改归属')
    expect(row.text()).not.toContain('assign.update')
    expect(row.text()).toContain('B座3楼·电表② · 2024-02')
    expect(row.text()).toContain('旧户甲 → 新户乙 · 导入')
    const opts = w.findAllComponents(Select)[0].props('options') as { value: string; label: string }[]
    expect(opts.find(o => o.value === 'meter')?.label).toBe('表档案')
  })

  // 第 6 路(用户 2026-10-05 拍板的数据修改记录)。破坏验证:删 SRC.change → 退回「其他」红;
  //   删 ACTION 里 salary_record → 露出裸表名红。
  it('❗数据修改那一路显「数据修改 / 改工资 / 改前 → 改后」,不是「其他 / salary_record」', async () => {
    const w = mountView()
    await flushPromises()
    const row = w.get('[data-src="change"]')
    expect(row.text()).toContain('数据修改')
    expect(row.text()).not.toContain('其他')
    expect(row.text()).toContain('改工资')
    expect(row.text()).not.toContain('salary_record')
    expect(row.get('.lg-target').text()).toBe('2025-06 · 张三 · 基本工资')
    expect(row.get('.lg-detail').text()).toBe('4500 → 4800')
  })

  // 按人 / 表 / 时间筛(同日拍板)。表只列后端回的 tables —— 那是按这个账号的查看权算的,
  // 看不见工资的人下拉里就没有「改工资」。破坏验证:srcOpts 不并 tables → 选项缺红;
  //   load 不拆 change:<表> → 请求里 src 是 'change:salary_record'、没有 tbl,红。
  it('❗按表筛:下拉只列后端给的表,选中后请求带 src=change + tbl', async () => {
    const w = mountView()
    await flushPromises()
    const opts = () => w.findAllComponents(Select)[0].props('options') as { value: string; label: string }[]
    expect(opts().filter(o => o.value.startsWith('change:'))).toEqual([
      { value: 'change:monthly_ledger', label: '改台账' },
      { value: 'change:salary_record', label: '改工资' },
    ])
    expect(opts().find(o => o.value === 'change')?.label).toBe('数据修改')
    await w.findAllComponents(Select)[0].setValue('change:salary_record')
    await flushPromises()
    expect(logs.mock.calls.at(-1)![0]).toMatchObject({ src: 'change', tbl: 'salary_record', page: 1 })
    await w.findAllComponents(Select)[0].setValue('auth')
    await flushPromises()
    expect(logs.mock.calls.at(-1)![0]).toMatchObject({ src: 'auth', tbl: undefined })
  })

  // 来源也按查看权:后端 sources 里没有的那几路不列(只有系统查看的账号看不到计费参数 / 导入 / 表档案 / 数据修改)。
  // 破坏验证:srcOpts 不按 sources 过滤 → 红
  it('❗来源下拉只列后端给的 sources', async () => {
    logs.mockImplementation(() => page({ tables: [], sources: ['auth', 'review'] }))
    const w = mountView()
    await flushPromises()
    const opts = w.findAllComponents(Select)[0].props('options') as { value: string; label: string }[]
    expect(opts.map(o => o.value)).toEqual(['', 'auth', 'review'])
  })

  it('登录成败显「登录 / 登录失败」,不是裸码', async () => {
    logs.mockImplementation(() => page({ rows: [
      { source: 'auth', ts: '2026-10-05T08:00:00', actor: 'li.cw', action: 'login', target: '10.0.0.8', detail: null, authorizer: null },
      { source: 'auth', ts: '2026-10-05T07:59:00', actor: 'li.cw', action: 'login.fail', target: '10.0.0.8', detail: '密码不对', authorizer: null },
    ] }))
    const w = mountView()
    await flushPromises()
    const [ok, bad] = w.findAll('.lg-row')
    expect(ok.get('.lg-act').text()).toBe('登录')
    expect(bad.get('.lg-act').text()).toBe('登录失败')
    expect(bad.get('.lg-detail').text()).toBe('密码不对')
  })

  it('三路来源各自渲染出可区分的徽标', async () => {
    const w = mountView()
    await flushPromises()

    // 每路一行,来源标在行上(不是三行长一个样)
    expect(w.findAll('[data-src="param"]')).toHaveLength(1)
    expect(w.findAll('[data-src="import"]')).toHaveLength(1)
    expect(w.findAll('[data-src="auth"]')).toHaveLength(1)

    // 徽标文案是人话,不是 param/import/auth 三个英文码
    const paramRow = w.get('[data-src="param"]')
    const importRow = w.get('[data-src="import"]')
    const authRow = w.get('[data-src="auth"]')
    expect(paramRow.text()).toContain('计费参数')
    expect(importRow.text()).toContain('导入')
    expect(authRow.text()).toContain('账号与角色')

    // 三种语义色确实不同(时间线左侧圆点):同色就等于没区分
    const colors = [paramRow, importRow, authRow].map(r => r.get('.lg-dot').attributes('style'))
    expect(new Set(colors).size).toBe(3)

    // 一行读起来像一句话:谁 · 什么时候 · 对什么 · 做了什么(动作码翻成人话)
    expect(paramRow.text()).toContain('zhang.kj')
    expect(paramRow.text()).toContain('2026-08-20 10:12')
    expect(paramRow.text()).toContain('设置')
    expect(paramRow.text()).toContain('p1 · price_flat · 2025-06')
    expect(paramRow.text()).toContain('0.83 → 0.91')
  })

  it('authorizer 有值时「由 XXX 授权」必须出现在那一行里', async () => {
    const w = mountView()
    await flushPromises()

    // 就在接管编辑锁那一行上,不是页脚某处的泛泛说明
    const authRow = w.get('[data-src="auth"]')
    expect(authRow.text()).toContain('由 李主管 授权')
    expect(authRow.text()).toContain('wang.zg')       // 操作人与授权人两个都在
    expect(authRow.text()).toContain('接管编辑锁')

    // 没有授权人的行不许凭空长出「授权」字样
    expect(w.get('[data-src="param"]').text()).not.toContain('授权')
  })

  it('服务端分页:改筛选与翻页都重新发请求并带上参数', async () => {
    const w = mountView()
    await flushPromises()
    expect(logs).toHaveBeenCalledTimes(1)
    expect(logs.mock.calls[0][0]).toMatchObject({ page: 1 })

    // 改「来源」筛选 → 回第一页 + 重新请求(前端切片的话这里不会有第二次调用)
    await w.findAllComponents(Select)[0].setValue('auth')
    await flushPromises()
    expect(logs).toHaveBeenCalledTimes(2)
    expect(logs.mock.calls[1][0]).toMatchObject({ src: 'auth', page: 1 })

    // 翻页 → 再请求一次,且把筛选条件一起带上(否则第 2 页会退回全部来源)
    w.findComponent(FPPager).vm.$emit('page', 2)
    await flushPromises()
    expect(logs).toHaveBeenCalledTimes(3)
    expect(logs.mock.calls[2][0]).toMatchObject({ src: 'auth', page: 2 })
  })

  // 2026-09-19:起 / 止两个原生日期框合成一颗 ds/DatePicker 区间胶囊。两头同一拍写入,只重拉一次。
  it('❗起止区间胶囊:两头一起进请求参数,只多发一次;清空两头都撤', async () => {
    const w = mountView()
    await flushPromises()
    const dp = w.findComponent({ name: 'DatePicker' })
    expect(dp.props('mode')).toBe('range')
    dp.vm.$emit('update:modelValue', ['2026-09-01', '2026-09-19'])
    await flushPromises()
    expect(logs).toHaveBeenCalledTimes(2)
    expect(logs.mock.calls[1][0]).toMatchObject({ from: '2026-09-01', to: '2026-09-19', page: 1 })
    dp.vm.$emit('update:modelValue', ['', ''])
    await flushPromises()
    expect(logs).toHaveBeenCalledTimes(3)
    expect(logs.mock.calls[2][0]).toMatchObject({ from: undefined, to: undefined })
  })

  it('❗加载失败换掉整条时间线(FPLoadError,和行互斥);点重试重拉,成功后行回来', async () => {
    logs.mockImplementationOnce(() => Promise.reject({ message: '网关超时' }))
    const w = mountView()
    await flushPromises()
    const err = w.find('.lg-wrap .fp-empty.error')
    expect(err.text()).toContain('操作日志没读到')
    expect(err.text()).toContain('网关超时')
    expect(w.findAll('.lg-row')).toHaveLength(0)
    await err.find('button').trigger('click')
    await flushPromises()
    expect(logs).toHaveBeenCalledTimes(2)
    expect(w.find('.fp-empty.error').exists()).toBe(false)
    expect(w.findAll('.lg-row')).toHaveLength(ROWS.length)
  })

  it('❗先发后到的旧页不盖新页(seq 守卫)', async () => {
    let first!: (v: unknown) => void
    logs.mockImplementationOnce(() => new Promise((r) => { first = r }))
    const w = mountView()
    await w.findAllComponents(Select)[0].setValue('auth')               // 第二次请求,立刻回整页
    await flushPromises()
    first({ rows: ROWS.slice(0, 1), total: 1, page: 1, size: 10, actors: [] })   // 旧的第一次这时才到
    await flushPromises()
    expect(w.findAll('.lg-row')).toHaveLength(ROWS.length)
  })

  it('❗空了是 FPEmpty:无筛选说「还没有」,有筛选说「这个筛选条件下没有」并给换法', async () => {
    logs.mockImplementation(() => page({ rows: [], total: 0 }))
    const w = mountView()
    await flushPromises()
    expect(w.find('.lg-wrap .fp-empty').text()).toBe('还没有任何操作记录')
    await w.findAllComponents(Select)[0].setValue('auth')
    await flushPromises()
    expect(w.find('.lg-wrap .fp-empty').text()).toContain('这个筛选条件下没有操作记录')
    expect(w.find('.lg-wrap .fp-empty').text()).toContain('换个来源、操作人或日期范围试试')
  })

  it('❗一行的全文走悬停说明(含授权人)', async () => {
    const w = mountView()
    await flushPromises()
    const row = w.get('[data-src="auth"]').element as HTMLElement & { _tip?: { text: string } }
    expect(row._tip?.text).toContain('由 李主管 授权')
    expect(row.hasAttribute('title')).toBe(false)
  })
})

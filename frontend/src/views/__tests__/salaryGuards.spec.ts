import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

import SalaryView from '@/views/salary/SalaryView.vue'
import { salaryApi } from '@/api/salary'
import { useAuthStore } from '@/stores/auth'
import { usePresenceStore, type Seat } from '@/stores/presence'
import type {
  SalaryOverviewDTO, SalaryYearMonthDTO, SalaryRecordDTO, SalaryTotal,
} from '@/types/salary'
import type { ImportRec } from '@/components/import/FpImportModal.vue'

/**
 * 附表12(SalaryView)刚落地的取数/写口守卫 —— 钉住 2026-08-29 这批未提交改动(git diff 可见)。
 * 既有 salaryMonthGate.spec.ts 只盖选期动线,这里逐条盖守卫:
 *
 *   ① reloadOverview try/catch(SalaryView.vue:82-85)+ 硬失败面(:367-371):
 *      overview 挂了不许整屏永久转圈 —— 矩阵是唯一入口,转圈死等 = 整本账不可达
 *   ② loadMonth catch(:65-71):换月失败 → monthData 清空 + readErr 失败条(:353-358)。
 *      不许旧月的行顶着新月期标 —— 改前胶囊/期标/计数全是新月而行是旧月的,
 *      进编辑批删「新月多余的人」删的是旧月真实记录。readErr 只在成功时清(:64)
 *   ③ pickCell 首次选月就失败 → 同一条失败分支,不是死转圈;「返回选月」回矩阵(:133-137)
 *   ④ watch(edit)(:117):编辑态**就地**转假(被接管/提权到期)→ 新增抽屉与导入窗跟着关
 *   ⑤ onDeactivated(:119):KeepAlive 停用收抽屉 —— FPDrawer Teleport to body,子树没了它不会没
 *   ⑥ 浏览态写口自守:onImportSections(:190)/onCreate(:204)/onDelete(:221)/onNote(:227),
 *      以及 useSchedScreen.ts 的 onBatchDelete(:107)/onClearImported(:117)
 *   ⑦ onCreate 写与刷新分开兜(:203-218):create 成功 refresh 失败不许谎报「新增工资失败」;
 *      跳期后 selectedIds 清空(:215)—— 残留 id 会喂给「删除选中」批删另一个月的行
 *   ⑧ 换期在途(veil 亮)宽表 SalaryTable 带 fp-stale(:314)—— pointer-events:none 挡住旧行
 *   ⑨ BookMonthMatrix 在场角标 .bmm-who:seed presence.users 的月级 editScopes,
 *      只有对应月格出角标(BookMonthMatrix.vue:53-57 editorOf / :96-100)—— 全仓此前零断言
 *
 * ⚠ 浏览态直呼写函数的用例(⑥),前置状态必须做足(选期已进表、selectedIds 有值、
 *   importedCount>0、confirm 恒真),否则函数在自己原有的早退分支就 return,
 *   守卫删掉照样绿 —— poolWriteGuards.spec 记过的同一条教训。
 */

vi.mock('@/api/salary', () => ({
  salaryApi: {
    overview: vi.fn(), records: vi.fn(),
    create: vi.fn(), updateNote: vi.fn(), remove: vi.fn(),
    importRows: vi.fn(), clearImported: vi.fn(), batchDelete: vi.fn(),
  },
}))

// 锁 mock 照 paramCenterView.spec:69:不 mock 的话 locksApi 走真 axios,jsdom 里抛错 →
// 被「拿不准就不进」兜住 → 编辑态永远进不去,④⑤⑦ 的前置全立不起来。
vi.mock('@/api/locks', () => ({
  locksApi: {
    acquire: () => Promise.resolve({ granted: true, holder: null }),
    release: () => Promise.resolve(),
    heartbeat: () => Promise.resolve({ evicted: null }),
    takeover: () => Promise.resolve({ granted: true, holder: null }),
    releaseOnUnload: () => {},
  },
}))

// ── 夹具:按真实 DTO 声明(src/types/salary.ts),喂 mock 时再 as never ──
const REC = (p: Partial<SalaryRecordDTO> & Pick<SalaryRecordDTO, 'id' | 'name' | 'acctMonth'>): SalaryRecordDTO => ({
  empIdx: 1, role: '文员', base: 3000, post: 1000, perf: 0, attend: 0, skill: 0, edu: 0, other: 0,
  lunch: 0, heat: 0, commission: 0, shouldDays: 22, leaveDays: 0, social: 0, tax: 0, otherDeduct: 0,
  sign: false, wageTotal: 4000, gross: 4000, deduct: 0, net: 4000, actualDays: 22, fullAttend: true,
  note: null, source: 'import', ...p,
})
const TOTAL: SalaryTotal = {
  base: 0, post: 0, perf: 0, attend: 0, skill: 0, edu: 0, other: 0, lunch: 0, heat: 0,
  commission: 0, wageTotal: 0, gross: 0, social: 0, tax: 0, otherDeduct: 0, deduct: 0, net: 0,
}
const OVERVIEW: SalaryOverviewDTO = {
  currentYear: 2025,
  years: [{ year: 2025, hasData: true, count: 3, netTotal: 12000, months: [1, 2, 3] }],
}
/** 2025-03:一行 source=import(⑥ 的 importedCount>0 前置就靠它)。 */
const M3: SalaryYearMonthDTO = {
  year: 2025, month: 3, rows: [REC({ id: 1, name: '张三', acctMonth: '2025-03', source: 'import' })], total: TOTAL,
}
const M2: SalaryYearMonthDTO = {
  year: 2025, month: 2, rows: [REC({ id: 2, name: '李四', acctMonth: '2025-02', source: 'manual' })], total: TOTAL,
}
const M1: SalaryYearMonthDTO = { year: 2025, month: 1, rows: [], total: TOTAL }

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  localStorage.clear()
  vi.setSystemTime(new Date('2025-06-15T00:00:00'))
  // SchedHeader 的门:perm="entry:edit"。缺了它编辑按钮点不进去,④⑤⑦ 全测不到
  useAuthStore().permissions = ['entry:edit']
  vi.spyOn(window, 'alert').mockImplementation(() => {})
  vi.mocked(salaryApi.overview).mockResolvedValue(OVERVIEW as never)
  vi.mocked(salaryApi.records).mockResolvedValue(M3 as never)
  vi.mocked(salaryApi.create).mockResolvedValue(REC({ id: 9, name: '王五', acctMonth: '2025-01', source: 'manual' }) as never)
  vi.mocked(salaryApi.updateNote).mockResolvedValue(M3.rows[0] as never)
  vi.mocked(salaryApi.remove).mockResolvedValue(undefined as never)
  vi.mocked(salaryApi.importRows).mockResolvedValue({ imported: 1, skipped: 0, errors: [] } as never)
  vi.mocked(salaryApi.batchDelete).mockResolvedValue({ deleted: 1, skipped: 0 } as never)
  vi.mocked(salaryApi.clearImported).mockResolvedValue({ deleted: 1, skipped: 0 } as never)
})

/** vm 直呼用(script setup 顶层绑定挂在实例代理上,poolWriteGuards 同款) */
interface Vm {
  edit: boolean
  reloading: boolean
  selectedIds: Set<number>
  importedCount: number
  onCreate: (req: { acctMonth: string; name: string; base?: number }) => Promise<void>
  onImportSections: (picks: { year?: number; month?: number; records: ImportRec[] }[], fileName: string) => Promise<void>
  onDelete: (row: SalaryRecordDTO) => Promise<void>
  onNote: (row: SalaryRecordDTO, text: string) => Promise<void>
  onBatchDelete: () => Promise<void>
  onClearImported: () => Promise<void>
}
const vmOf = (w: { vm: unknown }) => w.vm as Vm

async function open() {
  const w = mount(SalaryView, { global: { stubs: { Teleport: true } } })
  await flushPromises()
  return w
}
/** 矩阵点 2025-03(cells[2])进宽表。 */
async function toTable() {
  const w = await open()
  await w.findAll('.bmm-card')[2].trigger('click')
  await flushPromises()
  expect(w.find('.s12-page').exists(), '前置:进了宽表').toBe(true)
  return w
}
async function enterEdit(w: Awaited<ReturnType<typeof open>>) {
  await w.findAll('button').find(b => b.text().includes('编辑模式'))!.trigger('click')
  await flushPromises()
  expect(w.findAll('button').some(b => b.text() === '完成'), '前置:占锁成功进了编辑态').toBe(true)
}

describe('附表12 · 取数失败守卫', () => {
  it('① overview 挂了 → 硬失败面 + 重试,不永久转圈', async () => {
    // 红线:SalaryView.vue:82-85 reloadOverview 退回裸 await → overview 恒 null →
    // 模板只剩 .page-loading,.s12-fail 永远出不来 → 前两条断言红。
    vi.mocked(salaryApi.overview).mockRejectedValue(new Error('后端挂了'))
    const w = await open()
    expect(w.find('.s12-fail').exists(), 'overview 挂了要说出来').toBe(true)
    expect(w.find('.page-loading').exists(), '不许永久转圈').toBe(false)
    expect(w.text()).toContain('工资总览加载失败')

    vi.mocked(salaryApi.overview).mockResolvedValue(OVERVIEW as never)
    await w.find('.s12-fail button').trigger('click')   // 重试
    await flushPromises()
    expect(w.findAll('.bmm-card').length, '重试成功要落回矩阵').toBe(12)
    expect(w.find('.s12-fail').exists()).toBe(false)
  })

  it('② pickMonth 换月失败 → 旧行清掉 + readErr 失败条;readErr 只在成功时清', async () => {
    // 红线一:SalaryView.vue:65-71 catch 分支删掉(退回改前)→ monthData 还是 3 月的
    //   「张三」,顶着 2 月的期标与计数 —— 下面「旧行不许留」两条断言红。
    // 红线二::64 的 `readErr.value = null` 挪到 loadMonth 开头(清在开头)→
    //   重试在途失败条消失、整段窗口门全敞开 —— 「在途失败条还在」那条断言红。
    const w = await toTable()
    expect(w.text(), '前置:3 月的行在屏上').toContain('张三')

    vi.mocked(salaryApi.records).mockRejectedValue(new Error('后端 500'))
    await w.findAll('.lc-mpill')[1].trigger('click')   // 换到 2 月
    await flushPromises()
    expect(w.find('.s12-table').exists(), '旧月的行不许顶着新月期标').toBe(false)
    expect(w.text(), '3 月的「张三」必须随失败一起退场').not.toContain('张三')
    expect(w.find('.s12-fail').exists(), '要落失败分支,不是转圈').toBe(true)
    expect(w.text()).toContain('2025年2月工资加载失败')
    expect(w.text()).toContain('后端 500')

    // 重试在途:readErr 只在成功时清 —— 失败条要一直站到新数据真的落位
    let resolveRecords!: (v: SalaryYearMonthDTO) => void
    vi.mocked(salaryApi.records).mockImplementation(() => new Promise(r => { resolveRecords = r as never }) as never)
    await w.find('.s12-fail button').trigger('click')   // 重试
    await nextTick()
    expect(w.find('.s12-fail').exists(), '重试在途失败条不许先消失(只在成功清)').toBe(true)

    resolveRecords(M2)
    await flushPromises()
    expect(salaryApi.records).toHaveBeenLastCalledWith(2025, 2)
    expect(w.find('.s12-fail').exists(), '成功了才清').toBe(false)
    expect(w.text(), '2 月的行落位').toContain('李四')
  })

  it('③ pickCell 首次选月就失败 → 同样落失败分支;「返回选月」回矩阵', async () => {
    // 红线:同 ② 的 catch;改前 pickCell 先 clearData,monthData 恒 null → 永久转圈、
    // 无重试、无返回口,用户被锁死。「返回选月」断言另钉 backToMonths(:133-137)接线。
    vi.mocked(salaryApi.records).mockRejectedValue(new Error('挂了'))
    const w = await open()
    await w.findAll('.bmm-card')[1].trigger('click')   // 2025-02,首次进
    await flushPromises()
    expect(w.find('.s12-fail').exists(), '首次选月失败也要落失败分支').toBe(true)
    expect(w.find('.page-loading').exists(), '不是死转圈').toBe(false)

    const back = w.find('.s12-fail').findAll('button').find(b => b.text().includes('返回选月'))
    expect(back, '失败条上要有回矩阵的口').toBeTruthy()
    await back!.trigger('click')
    await flushPromises()
    expect(w.findAll('.bmm-card').length, '回到选期矩阵').toBe(12)
  })
})

describe('附表12 · 编辑态收口', () => {
  it('④ edit 就地转假(被接管/提权到期)→ 新增抽屉与导入窗跟着关', async () => {
    // 红线:SalaryView.vue:117 watch(edit) 删掉 → 浮层的 v-if 只判自己的 ref,
    // 失锁后留在屏上,「保存」「导入」照样落库(后端写口不校验锁)→ 两段断言各自红。
    const w = await toTable()
    await enterEdit(w)
    await w.findAll('button').find(b => b.text().includes('新增工资'))!.trigger('click')
    await flushPromises()
    expect(w.find('.fp-dwr-backdrop').exists(), '前置:新增抽屉开着').toBe(true)

    vmOf(w).edit = false   // SchedHeader 被接管走的就是这一句:emit toggle-edit → edit 就地翻假
    await flushPromises()
    expect(w.find('.fp-dwr-backdrop').exists(), '失锁后抽屉必须收').toBe(false)

    await enterEdit(w)
    await w.findAll('button').find(b => b.text().includes('导入 Excel'))!.trigger('click')
    await flushPromises()
    expect(w.find('.fpimp-scrim').exists(), '前置:导入窗开着').toBe(true)

    vmOf(w).edit = false
    await flushPromises()
    expect(w.find('.fpimp-scrim').exists(), '失锁后导入窗必须收').toBe(false)
  })

  it('⑤ KeepAlive 停用收抽屉 —— FPDrawer Teleport to body,子树没了它不会没', async () => {
    // 红线:SalaryView.vue:119 onDeactivated 删掉 → 切回来抽屉还开着
    // (真实站点里它 Teleport to body,停用时就飘在下一个屏顶上;stub Teleport 后表现为切回仍渲染)。
    const Host = defineComponent({
      components: { SalaryView },
      props: { on: { type: Boolean, default: true } },
      template: '<KeepAlive><SalaryView v-if="on" /></KeepAlive>',
    })
    const w = mount(Host, { global: { stubs: { Teleport: true } } })
    await flushPromises()
    await w.findAll('.bmm-card')[2].trigger('click')
    await flushPromises()
    await enterEdit(w as never)
    await w.findAll('button').find(b => b.text().includes('新增工资'))!.trigger('click')
    await flushPromises()
    expect(w.find('.fp-dwr-backdrop').exists(), '前置:抽屉开着').toBe(true)

    await w.setProps({ on: false })   // KeepAlive 停用 = 切到别的页签
    await flushPromises()
    await w.setProps({ on: true })
    await flushPromises()
    expect(w.find('.fp-dwr-backdrop').exists(), '切回来抽屉还开着').toBe(false)
  })
})

describe('附表12 · 浏览态写口自守(前置做足,守卫删掉必须红)', () => {
  it('⑥a-1 浏览态直呼 onCreate:零 API', async () => {
    // 红线:SalaryView.vue:204 `if (!edit.value) return` 删掉 → create 被打出去 → 红。
    // req 合法齐全 —— 守卫之后没有任何早退分支。
    const w = await toTable()
    expect(vmOf(w).edit, '前置:浏览态').toBe(false)
    await vmOf(w).onCreate({ acctMonth: '2025-03', name: '王五', base: 3000 })
    await flushPromises()
    expect(salaryApi.create).not.toHaveBeenCalled()
  })

  it('⑥a-2 浏览态直呼 onImportSections:零 API', async () => {
    // 红线:SalaryView.vue:190 守卫删掉 → runImport('salary') → salaryApi.importRows 被打出去 → 红。
    // 前置做足:已进表(year 非空)、picks 带年月与非空 records。
    const w = await toTable()
    expect(vmOf(w).edit, '前置:浏览态').toBe(false)
    await vmOf(w).onImportSections(
      [{ year: 2025, month: 3, records: [{ tenantName: '张三', base: 3000 } as ImportRec] }], '工资.xlsx')
    await flushPromises()
    expect(salaryApi.importRows).not.toHaveBeenCalled()
  })

  it('⑥a-3 浏览态直呼 onDelete:零 API', async () => {
    // 红线:SalaryView.vue:221 守卫删掉 → remove(1) 被打出去 → 红。
    const w = await toTable()
    expect(vmOf(w).edit, '前置:浏览态').toBe(false)
    await vmOf(w).onDelete(M3.rows[0])
    await flushPromises()
    expect(salaryApi.remove).not.toHaveBeenCalled()
  })

  it('⑥a-4 浏览态直呼 onNote:零 API', async () => {
    // 红线:SalaryView.vue:227 守卫删掉 → updateNote 被打出去 → 红。
    const w = await toTable()
    expect(vmOf(w).edit, '前置:浏览态').toBe(false)
    await vmOf(w).onNote(M3.rows[0], '补一句备注')
    await flushPromises()
    expect(salaryApi.updateNote).not.toHaveBeenCalled()
  })

  it('⑥b-1 浏览态直呼 onBatchDelete(selectedIds 有值):零 API', async () => {
    // 红线:useSchedScreen.ts:107 `if (!edit.value) return` 删掉 → batchDelete([1]) 被打出去 → 红。
    // 前置做足:selectedIds 非空 —— ids.length 的早退(:103)不拦路。
    const w = await toTable()
    const vm = vmOf(w)
    vm.selectedIds = new Set([1])
    await nextTick()
    expect(vm.selectedIds.size, '前置:勾着一行').toBe(1)
    expect(vm.edit, '前置:浏览态').toBe(false)
    await vm.onBatchDelete()
    await flushPromises()
    expect(salaryApi.batchDelete).not.toHaveBeenCalled()
  })

  it('⑥b-2 浏览态直呼 onClearImported(importedCount>0 + confirm 恒真):零 API', async () => {
    // 红线:useSchedScreen.ts:117 守卫删掉 → confirm(true)→ clearImported 被打出去 → 两条断言红。
    // 前置做足:M3 那行 source=import → importedCount=1;confirm 恒真 —— 守卫后无人拦路。
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const w = await toTable()
    const vm = vmOf(w)
    expect(vm.importedCount, '前置:本月有导入行').toBe(1)
    expect(vm.edit, '前置:浏览态').toBe(false)
    await vm.onClearImported()
    await flushPromises()
    expect(confirmSpy, '浏览态连确认框都不该弹').not.toHaveBeenCalled()
    expect(salaryApi.clearImported).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })
})

describe('附表12 · onCreate 写与刷新分开兜', () => {
  it('⑦a 新增跳期后 selectedIds 清空 —— 残留 id 会批删另一个月的行', async () => {
    // 红线:SalaryView.vue:215 `selectedIds.value = new Set()` 删掉 → 勾选残留 → 红。
    const w = await toTable()
    await enterEdit(w)
    const vm = vmOf(w)
    vm.selectedIds = new Set([1])   // 3 月勾着「张三」
    await nextTick()
    expect(vm.selectedIds.size, '前置:勾着 3 月的行').toBe(1)

    vi.mocked(salaryApi.records).mockResolvedValue(M1 as never)
    await vm.onCreate({ acctMonth: '2025-01', name: '王五', base: 3000 })
    await flushPromises()
    expect(salaryApi.create).toHaveBeenCalled()
    expect(salaryApi.records, '归入 1 月并拉 1 月').toHaveBeenLastCalledWith(2025, 1)
    expect(w.find('.s12-count').text(), '期标跳到 1 月').toContain('2025年1月')
    expect(vm.selectedIds.size, '跳期必须清勾选').toBe(0)
    expect(window.alert, '写与刷新都成功,一个 alert 都不该有').not.toHaveBeenCalled()
  })

  it('⑦b create 成功但 refresh 失败 → alert 不许说「新增工资失败」(写成功不谎报)', async () => {
    // 红线:SalaryView.vue:203-218 退回改前的 guard('新增工资失败') 一锅兜
    // (连同 loadMonth 恢复上抛)→ create 已落库却弹「新增工资失败」,用户重录出重复行 → 红。
    const w = await toTable()
    await enterEdit(w)
    vi.mocked(salaryApi.records).mockRejectedValue(new Error('拉库挂了'))
    await vmOf(w).onCreate({ acctMonth: '2025-01', name: '王五', base: 3000 })
    await flushPromises()
    expect(salaryApi.create, '前置:写确实成功了').toHaveBeenCalled()
    const said = vi.mocked(window.alert).mock.calls.flat().map(String)
    expect(said.some(s => s.includes('新增工资失败')), '写成功不许谎报成写失败').toBe(false)
    expect(w.find('.s12-fail').exists(), '刷新失败走失败条(带重试),不是谎话').toBe(true)
  })
})

describe('附表12 · 换期在途退让', () => {
  it('⑧ veil 亮时宽表带 fp-stale(200ms 防闪后)', async () => {
    // 红线:SalaryView.vue:314 `:class="{ \'fp-stale\': veil }"` 删掉 → 260ms 后仍无该类 → 红。
    // fp-stale 带 pointer-events:none —— 换期在途旧行不许被点、被删(同族 6 屏都有,本屏此前漏)。
    const w = await toTable()
    const vm = vmOf(w)
    vm.reloading = true
    await nextTick()
    expect(w.find('.s12-tablewrap').classes(), '200ms 内不亮(防闪)').not.toContain('fp-stale')

    await new Promise(r => setTimeout(r, 260))   // useDeferredFlag 熬 200ms
    await flushPromises()
    expect(w.find('.s12-tablewrap').classes(), '在途要退一步').toContain('fp-stale')
    expect(w.find('.s12-tablewrap').attributes('aria-busy')).toBe('true')

    vm.reloading = false
    await nextTick()
    expect(w.find('.s12-tablewrap').classes(), '退场立刻灭').not.toContain('fp-stale')
  })
})

describe('附表12 · 矩阵在场角标(全仓此前零断言)', () => {
  it('⑨ editScopes 带 salary 月锁的人,只亮对应那一个月格的 .bmm-who', async () => {
    // 红线:BookMonthMatrix.vue:53-57 editorOf 改成恒 null / :96 的 v-if 删掉 → 角标全灭 → 红;
    // 或 scopeOf 接线退化成按年 → 12 格全亮 → 「只有一个」那条红。
    const w = await open()
    const seat = (p: Partial<Seat> & Pick<Seat, 'sid' | 'user' | 'editScopes' | 'self'>): Seat => ({
      displayName: p.user!, role: null, scope: 'sched:salary', label: '附表12',
      mode: 'edit', sinceMs: 1000, idleMs: 0, ...p,
    } as Seat)
    usePresenceStore().users = [
      seat({ sid: 's1', user: 'lisi', displayName: '李四', editScopes: ['sched:salary:2025-03'], self: false }),
      // 自己握的锁不标 —— editorOf 的 `!e.self` 过滤(「我点进去改得了吗」问的是别人)
      seat({ sid: 's2', user: 'me', displayName: '我', editScopes: ['sched:salary:2025-02'], self: true }),
    ]
    await nextTick()

    const cells = w.findAll('.bmm-card')
    expect(cells.length, '前置:一年 12 格').toBe(12)
    const marked = cells.filter(c => c.find('.bmm-who').exists())
    expect(marked.length, '只有李四那把月锁对应的格出角标').toBe(1)
    expect(cells[2].find('.bmm-who').exists(), '亮的是 2025-03(cells[2])').toBe(true)
    expect(cells[2].find('.bmm-who').attributes('title')).toBe('李四 正在编辑')
    expect(cells[1].find('.bmm-who').exists(), '自己的 2025-02 锁不标').toBe(false)
  })
})

describe('附表12 · 收口复查两洞', () => {
  it('❗同 scope 的刷新失败也要退编辑态 —— 失败面卸载 SchedHeader 会把锁还掉', async () => {
    // 危险路径是**不换期**的失败:删一行成功、refresh 的 records() 失败(换月路径有
    // SchedHeader 的 scope-watch 兜底,这条没有)。monthData 清空 → 宽表分支卸载 →
    // SchedHeader onUnmounted 还锁;edit 留 true 的话,点「重试」成功后 SchedHeader
    // 以 :edit="true" 重挂却不重新占锁 —— 完整编辑态、没有锁,别人 acquire 显示
    // 「无人编辑」,两人同改同月。
    const w = await toTable()
    await enterEdit(w)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(salaryApi.remove).mockResolvedValue(undefined as never)
    vi.mocked(salaryApi.records).mockRejectedValue(new Error('挂了'))   // 只挂重取

    await vmOf(w).onDelete(M3.rows[0])          // 删除成功 → refresh 失败,期没变
    await flushPromises()

    expect(w.find('.s12-fail').exists(), '前提:落进失败面').toBe(true)
    expect((w.vm as unknown as { edit: boolean }).edit, '失败面必须是浏览态').toBe(false)
  })

  it('❗一次失败之后换期,在途该给转圈 —— 不许旧失败面顶着新期标', async () => {
    const w = await toTable()
    vi.mocked(salaryApi.records).mockRejectedValue(new Error('挂了'))
    await (w.vm as unknown as { pickMonth: (m: number) => Promise<void> }).pickMonth(4)
    await flushPromises()
    expect(w.find('.s12-fail').exists(), '前提:失败面在').toBe(true)

    let settle!: (v: unknown) => void
    vi.mocked(salaryApi.records).mockReturnValueOnce(new Promise(r => { settle = r }) as never)
    const p = (w.vm as unknown as { pickMonth: (m: number) => Promise<void> }).pickMonth(5)
    await nextTick()
    expect(w.find('.s12-fail').exists(), '在途不许拿 4 月的旧错误面冒充 5 月').toBe(false)
    expect(w.find('.page-spin').exists(), '在途该给转圈').toBe(true)
    settle(M3)
    await p
    await flushPromises()
    expect(w.find('.s12-fail').exists()).toBe(false)
  })
})

// 弹窗里的定宽轨在窄档的两种收法(RESPONSIVE-LAYOUT-SPEC §5.6 第 2、3 类;
// 体检证据 MOBILE-390-AUDIT-2026-09-21 §1-A 末两行)。
//
//   第 2 类 TemplateEditorPanel:`.te-vers` 232 定宽 → 390 上主区只剩 133。
//     版本链是**纵向历史**,平铺成 chips 会把先后丢掉 → 折成「现行 vN · 共 M 版」一行摘要
//     + 底部面板,链在面板里顺序不动。顺带修 §11.1「只读兜底」判据① —— `.te-dlg` 的
//     `overflow: hidden` 把内容裁掉且没有任何方向的滚动条。
//   第 3 类 CompanyBookWindow:216 公司轨 + 右内容并置,S 档弹窗已全屏 390,右边只剩 116。
//     → 先选公司、再进内容,两级不并置;返回上一级挂弹窗顶栏(§5.10 判据四)。
//
// **两档都断**(照抄 ds/__tests__/selectSheetS.spec.ts 的教训):只断 S 一头的话,
// 判据可以悄悄放宽成「非 xl」或干脆写死,宽档被改坏照样绿。这里另外钉住 L 档(1280)——
// §5.6 收的是 M/S 两档,L 不收;第 3 类只收 S,M 档(平板 722 宽)照旧并置。
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import TemplateEditorPanel from '../TemplateEditorPanel.vue'
import CompanyBookWindow from '@/views/bills/CompanyBookWindow.vue'
import { companyBookApi, type CompanyFullDTO } from '@/api/billDelivery'
import { _resetViewportForTest } from '@/composables/useViewport'
import type { Book, BookDef, TemplateVersion } from '@/types/book'

vi.mock('@/api/books', () => ({ booksApi: { versionDefinition: vi.fn() } }))
// 面板走 useEditLock:不挡住 locksApi 就是一发真 axios,编辑态永远进不去(同 templateEditor.spec)
vi.mock('@/api/locks', () => ({
  locksApi: {
    acquire: vi.fn(() => Promise.resolve({ granted: true, holder: null })),
    release: vi.fn(() => Promise.resolve()),
    heartbeat: vi.fn(() => Promise.resolve({ evicted: null })),
    takeover: vi.fn(() => Promise.resolve({ granted: true, holder: null })),
    releaseOnUnload: vi.fn(),
  },
}))
// 收款公司模块还导出 ACCOUNT_KINDS / ACCOUNT_KIND_LABEL(组件常挂着要用),只换 api 对象
vi.mock('@/api/billDelivery', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/billDelivery')>(),
  companyBookApi: { list: vi.fn(), create: vi.fn(), update: vi.fn() },
}))

const TE_SRC = readFileSync(join(__dirname, '..', 'TemplateEditorPanel.vue'), 'utf8')
const CW_SRC = readFileSync(
  join(__dirname, '..', '..', '..', 'views', 'bills', 'CompanyBookWindow.vue'), 'utf8')

/** 档位靠 matchMedia 喂(同 selectSheetS.spec:27)。三条 max-width 查询对应 600/960/1280。 */
function setTier(tier: 's' | 'm' | 'l' | 'xl') {
  const hit = (q: string) =>
    tier === 's' ? q.includes('max-width')
      : tier === 'm' ? (q.includes('960') || q.includes('1280'))
        : tier === 'l' ? q.includes('1280')
          : false
  vi.stubGlobal('matchMedia', (q: string) => ({
    media: q, matches: hit(q), addEventListener() {}, removeEventListener() {},
  }))
  _resetViewportForTest()
}

let w: VueWrapper | null = null
beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks() })
afterEach(() => {
  w?.unmount(); w = null
  _resetViewportForTest()
  vi.unstubAllGlobals()
})

// ─────────────────────────── 第 2 类:TemplateEditorPanel ───────────────────────────

const makeDef = (): BookDef => ({
  groups: [{
    id: 'g1', label: '租金类',
    cols: [{ id: 'rent', std: true, label: '租金', aliases: ['厂房租金'], slot: 'rent', hidden: false, w: 120 }],
  }],
})
// 夹具刻意三个数互不相等:本月生效 v7、链尾 v12、共 4 版。
// 写死 / 拿 latestVer 充「共几版」/ 拿版本数充「现行」,三种偷懒各挡一道。
const BOOK: Book = {
  id: 1, screen: 'ledger', companyId: 1, phase: null,
  name: '公司A台账', ver: 7, latestVer: 12, definition: makeDef(),
}
// 链序 = 宿主给的数组序(新→旧),版本号故意不连号:被 sort/reverse 动过一下就对不上
const CHAIN: TemplateVersion[] = [
  { id: 12, ver: 12, note: '加税费列', createdBy: 'admin', createdAt: '2026-09-12T10:00:00', current: false },
  { id: 9, ver: 9, note: null, createdBy: 'li', createdAt: '2026-09-09T10:00:00', current: false },
  { id: 7, ver: 7, note: '拆开维护费', createdBy: 'admin', createdAt: '2026-09-07T10:00:00', current: true },
  { id: 3, ver: 3, note: '初版', createdBy: 'admin', createdAt: '2026-08-03T10:00:00', current: false },
]

function mountPanel(tier: 's' | 'm' | 'l' | 'xl') {
  setTier(tier)
  return mount(TemplateEditorPanel, {
    props: {
      open: true, book: BOOK, versions: CHAIN, saving: false,
      canEdit: true, canSwitch: true, monthHasData: false, year: 2026, month: 3,
    },
    global: { stubs: { teleport: true } },
  })
}

const chainVers = (wr: VueWrapper) => wr.findAll('.te-vers .te-vitem .te-vline b').map(n => n.text())

describe('§5.6 第 2 类 · TemplateEditorPanel 版本链(有序 → 摘要 + 面板,不套 chips)', () => {
  it('❗S 档:初始只有一行摘要,232 纵向链不在 DOM 里', () => {
    w = mountPanel('s')
    expect(w.find('.te-vers').exists(), 'S 档初始不该并一条定宽链').toBe(false)
    const sum = w.find('button.te-versum')
    expect(sum.exists(), 'S 档要有摘要行').toBe(true)
    // 两个数都来自组件数据:现行 = book.ver(7),共几版 = versions.length(4),都不是 latestVer(12)
    expect(sum.text()).toBe('现行 v7 · 共 4 版')
  })

  it('❗S 档:点摘要展开面板,面板里版本顺序与桌面逐条相同', async () => {
    w = mountPanel('s')
    await w.find('button.te-versum').trigger('click')
    const sOrder = chainVers(w)
    // 先断真的选到了东西 —— 选择器写错时 findAll 恒为空,下面两条就成了恒真
    expect(sOrder.length, '面板里要真的有版本项').toBe(4)
    expect(sOrder).toEqual(['v12', 'v9', 'v7', 'v3'])
    expect(sOrder).not.toEqual([...sOrder].reverse())   // 链被翻过来也算丢了先后

    // 桌面那一份:同一个数组、同一个顺序
    const desktop = mountPanel('xl')
    expect(chainVers(desktop)).toEqual(sOrder)
    desktop.unmount()

    expect(w.find('.te-vers').classes(), 'S 档的链要走底部面板壳').toContain('sheet')
  })

  it('❗S 档:面板里点一版 → 面板收起,主区进历史版预览', async () => {
    w = mountPanel('s')
    await w.find('button.te-versum').trigger('click')
    const v3 = w.findAll('.te-vers .te-vitem').find(n => n.text().includes('v3'))!
    await v3.trigger('click')
    await flushPromises()
    await nextTick()
    expect(w.find('.te-vers').exists(), '选完要把面板收起来,不然挡着预览').toBe(false)
    expect(w.find('.te-histbar').text()).toContain('正在查看 v3')
  })

  it('❗XL 档:仍是右侧纵向链,没有摘要行;定宽 232 原样', () => {
    w = mountPanel('xl')
    expect(w.find('button.te-versum').exists(), '宽档不该出摘要行').toBe(false)
    expect(w.find('aside.te-vers').exists()).toBe(true)
    expect(chainVers(w)).toEqual(['v12', 'v9', 'v7', 'v3'])
    // 反向:宽档定宽值一个字没动(§9 桌面零差异)
    expect(TE_SRC).toMatch(/\.te-vers \{\s*\n\s*flex: 0 0 232px;/)
  })

  it('❗L 档(961–1280)也不收 —— 判据是「m 或 s」,不是「非 xl」', () => {
    w = mountPanel('l')
    expect(w.find('button.te-versum').exists(), 'L 档不该折成摘要').toBe(false)
    expect(chainVers(w), 'L 档仍是整条纵向链').toEqual(['v12', 'v9', 'v7', 'v3'])
    expect(TE_SRC).toMatch(
      /const versSheet = computed\(\(\) => vp\.tier\.value === 'm' \|\| vp\.tier\.value === 's'\)/)
  })

  it('❗M 档(601–960)收成摘要 —— §5.6「M:左轨收成顶部选择器」那条', () => {
    w = mountPanel('m')
    expect(w.find('button.te-versum').exists()).toBe(true)
    expect(w.find('.te-vers').exists()).toBe(false)
  })
})

describe('§11.1 只读兜底判据① · .te-dlg 在 S 档该滚的方向有滚动条', () => {
  it('❗S 档把横向从 hidden 改成 auto(纵向仍由 .te-main 自己滚 = 判据② 不劫持整页)', () => {
    const sBlock = TE_SRC.match(/@media \(max-width: 600px\) \{[\s\S]*?\n\}/)![0]
    expect(sBlock).toMatch(/\.te-dlg \{ overflow-x: auto; \}/)
    expect(sBlock).not.toMatch(/overflow: hidden/)
    expect(TE_SRC).toMatch(/\.te-main \{[^}]*overflow-y: auto/)
  })

  it('❗宽档 .te-dlg 仍是 overflow: hidden(§9 零差异),且 600 块排在 960 块之后', () => {
    expect(TE_SRC).toMatch(/\.te-dlg \{[^}]*overflow: hidden;/)
    // CSS 顺序铁律:宽档在前,窄档在后。写反是静默的 —— S 档会被 960 块盖回去
    expect(TE_SRC.indexOf('@media (max-width: 960px)'))
      .toBeLessThan(TE_SRC.indexOf('@media (max-width: 600px)'))
  })
})

// ─────────────────────────── 第 3 类:CompanyBookWindow ───────────────────────────

const acct = (id: number, companyId: number) => ({
  id, companyId, kind: 'bank' as const, accountName: '户名' + id, accountNo: '62' + id,
  bankName: '工行', isDefault: id === 1, sortNo: 0, remark: null,
})
// 两家公司,名字/账户数都不同:只渲染出一块时也分得清渲染的是哪一块
const COMPANIES: CompanyFullDTO[] = [
  { id: 11, name: '一泽科技', short: '一泽', sortNo: 1, fullName: '佛山一泽科技有限公司', status: 1, accounts: [acct(1, 11), acct(2, 11)] },
  { id: 22, name: '二源置业', short: '二源', sortNo: 2, fullName: null, status: 1, accounts: [] },
]

async function openWindow(tier: 's' | 'm' | 'xl') {
  setTier(tier)
  vi.mocked(companyBookApi.list).mockResolvedValue(COMPANIES)
  const wr = mount(CompanyBookWindow, {
    props: { open: false },
    global: { stubs: { teleport: true } },
  })
  await wr.setProps({ open: true })   // load() 挂在 watch(open) 上,不是 immediate
  await flushPromises()
  await nextTick()
  return wr
}

describe('§5.6 第 3 类 · CompanyBookWindow 两级推进(弹窗内部不并置)', () => {
  it('❗S 档第一级:只渲染公司列表,内容区一块都不在', async () => {
    w = await openWindow('s')
    expect(w.findAll('.cw-list .cw-item').length, '公司列表要真的渲染出来').toBeGreaterThanOrEqual(2)
    expect(w.find('.cw-pane').exists(), 'S 档第一级不渲染内容区').toBe(false)
    expect(w.find('.cw-back').exists(), '第一级没有上一级可返回').toBe(false)
  })

  it('❗S 档第二级:选一家之后才渲染内容,且列表让位;返回钮在弹窗顶栏里', async () => {
    w = await openWindow('s')
    const second = w.findAll('.cw-list .cw-item').find(n => n.text().includes('二源置业'))!
    await second.trigger('click')
    await nextTick()
    expect(w.find('.cw-pane').exists(), '选中后才有内容区').toBe(true)
    expect(w.find('.cw-pane input').element).toBeTruthy()
    expect((w.find('.cw-pane input').element as HTMLInputElement).value).toBe('二源置业')
    expect(w.find('.cw-list').exists(), '第二级不并置列表').toBe(false)
    // 返回入口在弹窗自己的顶栏(FPDrawer 头部 badge 槽),不在正文里另画一行
    const back = w.find('.cw-back')
    expect(back.exists()).toBe(true)
    expect(back.element.closest('.fp-dwr-hd'), '返回钮要长在弹窗顶栏里').not.toBeNull()
    await back.trigger('click')
    await nextTick()
    expect(w.find('.cw-list').exists(), '返回回到第一级').toBe(true)
    expect(w.find('.cw-pane').exists()).toBe(false)
  })

  it('❗XL 档:两块并置,开窗即选中第一家,216 + 1fr 原样', async () => {
    w = await openWindow('xl')
    expect(w.find('.cw-list').exists()).toBe(true)
    expect(w.find('.cw-pane').exists(), '宽档开窗就并置着内容区').toBe(true)
    expect((w.find('.cw-pane input').element as HTMLInputElement).value).toBe('一泽科技')
    expect(w.find('.cw-back').exists(), '宽档没有两级,不出返回钮').toBe(false)
    // 反向:宽档定宽值一个字没动(§9)
    expect(CW_SRC).toMatch(/\.cw-split \{[^}]*grid-template-columns: 216px 1fr;/)
  })

  it('❗M 档(平板 722 宽)仍并置 —— 判据是「s」一档,不是「非 xl」', async () => {
    w = await openWindow('m')
    expect(w.find('.cw-list').exists()).toBe(true)
    expect(w.find('.cw-pane').exists(), 'M 档不该进两级').toBe(true)
    expect(CW_SRC).toMatch(/const stepped = computed\(\(\) => vp\.tier\.value === 's'\)/)
  })

  it('❗S 档栅格降成一列(宽档那条留在前面)', () => {
    const sBlock = CW_SRC.match(/@media \(max-width: 600px\) \{[\s\S]*?\n\}/)![0]
    expect(sBlock).toMatch(/\.cw-split \{ grid-template-columns: 1fr; \}/)
    expect(CW_SRC.indexOf('grid-template-columns: 216px 1fr'))
      .toBeLessThan(CW_SRC.indexOf('@media (max-width: 600px)'))
  })
})

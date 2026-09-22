// 催缴单告警文案(BILL-NOTICE-WARN-SPEC §5.1)。**全站唯一事实源,后端一个字都不拼。**
//
// 为什么集中到一张表:病根 B 是「告警文案这条链上没有验收」—— 数字算错了有人对账发现,
// 字写歪了没有任何机器或人会发现。出过三起事故:
//   · 「场地未定:544.00」 拼的是 meter.name(导入原串,水表那批带 .00),用户读成金额
//   · 「缺价 elec_sharp」  价目键原样上屏
//   · 「rent_office」      字典缺词条时 ?? 回落把原始 key 吐上屏
// 散在产地的字没法扫;集中成一张表之后 billNoticeWarnCopy.spec.ts 的 G1–G6 才有东西可盯。
//
// ⚠ 标签与值**只由 fmt 一处出**,不设 itemLabel 字段:标签有两个出处就会拼成「房号 房号 544」,
//   而 W_PRICE_MISSING 的条目(一个价目名)根本没有「标签+值」结构,一个必填的 itemLabel 会逼它编词。
// ⚠ payload/hint 是**实例数据不是文案**(房号、价目键、计费行 id、表名),可以含中文、可以含小数点。
//   规矩是:它们永远由 fmt 加标签之后才上屏。
import { billFeeLabel } from './billNoticeLogic'
import { paramDef } from './paramRegistry'

// 顺序 = 屏上组序。与后端 WarnCode.java 的常量双向全等(门禁 G2 直接读那个文件核对)。
export const WARN_CODES = [
  'W_METER_NO_CONTRACT',
  'W_ROOM_MISMATCH',
  'W_CONTRACT_NO_DATES',
  'W_TERM_NO_PARAMS',
  'W_RENT_FREE_BAD',
  'W_PACKAGE_NO_POOL',
  'W_PRICE_MISSING',
  'W_TOTAL_NEGATIVE',
] as const
export type WarnCode = typeof WARN_CODES[number]

export interface WarnCopy {
  /** 屏上块头 */
  title: string
  /** 这是什么、不处理会怎样(FPAlertPanel §6-3 要求) */
  desc: string
  /** 条目整行的字:标签与值都由它出 */
  fmt: (payload: string, hint: string) => string
  /** 组动作跳哪一屏(导航 value,核对 nav/fpNav.ts) */
  route: string
  actionLabel: string
  /** 进不进右侧告警抽屉 */
  drawer: boolean
  /** drawer:false 时必填:为什么不进(§6-3 只报不给动作的不许进来) */
  why?: string
}

export const WARN_COPY: Record<WarnCode, WarnCopy> = {
  W_METER_NO_CONTRACT: {
    title: '表没挂上合同',
    // 「没能定出」不写「找不到」:四种触发档里 ambiguous 那一档是**候选不止一份、选不出该用哪份**
    // (MeterBindingService.java:144),写「找不到」对这一档是假的(对抗复查 2026-09-23)。
    desc: '这些表在出单时没能定出归属合同,量照算进这张单,但没留下合同快照,位置也落不上。不处理的话事后按合同对账时这几块表的钱找不到出处。',
    fmt: (payload, hint) => hint || `表 #${payload}`,
    route: 'meters',
    actionLabel: '去园区抄表',
    drawer: true,
  },
  W_ROOM_MISMATCH: {
    // 只写测量:表上有房号、合同上也有房号、对不上。不写「房间不在合同内」那种定性 ——
    // 判据分不出是合同漏录还是表挂错人,写成定性会把用户推去给合同加房间,
    // 而对挂错表那一类照做就是给这户多收一间房的租金。
    title: '房号两边对不上',
    desc: '表上写着这几个房号,合同的计费行里没有。可能是合同少录了房间,也可能是这块表挂在了别人名下 —— 两边都要看一眼。位置只能退回合同级的一长串,金额不变。',
    fmt: (payload, hint) => `房号 ${payload}${hint ? `(表 ${hint})` : ''}`,
    route: 'meters',
    actionLabel: '去园区抄表',
    drawer: true,
  },
  W_CONTRACT_NO_DATES: {
    title: '合同没有起止日期',
    desc: '这些合同没填起止日期,整份合同的租金行一条都没派生出来。不处理的话这几户的单子上整份租金是缺的。',
    fmt: (payload) => `合同 ${payload || '(无编号)'}`,
    route: 'contracts',
    actionLabel: '去合同管理',
    drawer: true,
  },
  W_TERM_NO_PARAMS: {
    title: '计费行参数不全',
    desc: '这些计费行少了算钱要用的参数(按㎡缺面积或单价、按间缺单价或间数、按容量缺合同 kVA、其余缺固定金额),这一行的租金没派生;同一份合同里其他行照出。不处理的话单子上少这一笔。',
    fmt: (payload, hint) => `合同 ${hint || `#${payload}`}`,
    route: 'contracts',
    actionLabel: '去合同管理',
    drawer: true,
  },
  W_RENT_FREE_BAD: {
    title: '免租期没读出来',
    desc: '这些合同的免租期这次没能读出来,本月租金按没有免租算。不处理的话这几户的租金会比该收的高。',
    fmt: (payload) => `合同 ${payload || '(无编号)'}`,
    route: 'contracts',
    actionLabel: '去合同管理',
    drawer: true,
  },
  W_PACKAGE_NO_POOL: {
    // desc 写后果(池的差额虚高),不复述判据里的内部词「公摊池锚点」
    title: '包干行没挂上池',
    desc: '这些包干费按固定价收了,但没记进任何一个公摊池的已分摊里。不处理的话对应池的未分摊差额会比实际高,池账本上对不上。',
    fmt: (payload) => `包干 ${billFeeLabel(payload)}`,
    route: 'alloc',
    actionLabel: '去公共电核算',
    drawer: true,
  },
  W_PRICE_MISSING: {
    title: '这个月缺价',
    // fmt 刻意不加固定前缀:这样 paramDef 查不到中文名时返回的就是裸键,G5「输出必须含中文」会红。
    // 闭集由 G6 逐键钉死(PRICE_KEYS),两层都在盯这件事 —— 它是三起事故里的两起的机制。
    desc: '这几个价目这个月没有可用的单价,对应的费用整项没出。不处理的话单子上少这几项。',
    fmt: (payload) => paramDef(payload)?.label ?? payload,
    route: 'params',
    actionLabel: '去计费参数',
    drawer: true,
  },
  W_TOTAL_NEGATIVE: {
    title: '本期合计为负',
    desc: '这张单的各项加起来是负数。负值本身合法,不一定是错。',
    fmt: () => '本期合计为负',
    route: '',
    actionLabel: '',
    drawer: false,
    // §6-3:只报不给动作的告警不许进抽屉。这一条给不出清除路径 —— 它不是数据缺口而是一个结论,
    // 而且是唯一按**单**算的一类(其余七类按户算),塞进户级抽屉会被读成「这户有八类问题」。
    // 落点保持今天的样子:列表行尾「!」与明细抽屉横幅。
    why: '它不是数据缺口而是一个结论,清除路径不存在,给不出可执行动作;而且它按单算,其余七类按户算。',
  },
}

// ── 闭集:门禁 G6 逐键断言「查得到中文名且不等于键本身」 ─────────────────────
//
// 这是整套门禁里唯一会为真实事故变红的判据。三起事故里的两起(缺价 elec_sharp、rent_office)
// 机制相同:字典查不到时 ?? 回落把原始键原样吐上屏,而回落本身要留(引擎加费项不丢行)。
// 所以用闭集把「能产出的键」逐个钉死。

/** W_PRICE_MISSING 能产出的价目键。闭集来源:BillNoticeService 的 missPrice 三个调用点。 */
export const PRICE_KEYS = [
  'elec_sharp', 'elec_peak', 'elec_flat', 'elec_valley',
  'elec_resident', 'elec_commercial', 'water',
] as const

/** W_PACKAGE_NO_POOL 能产出的费项键。闭集来源:BillNoticeService 的 packageLine 三个调用点。 */
export const PACKAGE_FEE_KEYS = ['share_elec_floor', 'share_green_water', 'share_elec_fire'] as const

export const warnCopy = (code: string): WarnCopy | undefined =>
  (WARN_COPY as Record<string, WarnCopy>)[code]

/** 一条告警在屏上的那行字;未知 code 原样回落(引擎加类别不丢条目,由 G2 保证不会长期停在这) */
export function warnItemText(code: string, payload: string, hint: string): string {
  const c = warnCopy(code)
  return c ? c.fmt(payload, hint) : `${code} ${payload}`.trim()
}

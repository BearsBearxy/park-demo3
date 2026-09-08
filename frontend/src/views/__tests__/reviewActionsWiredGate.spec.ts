// 审核动作簇的**接线**门禁(per-screen-review §01/§02;SIDEBAR-UX-REDESIGN §9.2)。
//
// 为什么要有这一份:§7.5 的审核药丸刚栽过一次一模一样的坑 —— FPEditModeButton 上
// reviewNote / reviewTip 两个 prop 写好了,12 个使用点一个都没传值,那一支从上线到发现
// 一次都没渲染过。既有的 useEditMode.spec 断的是 composable 的返回值,那一半一直是对的,
// 漏的是**组件有没有拿到它**。reviewPillWiredGate 补上了药丸那一支,这一份补动作簇。
//
// 动作簇比药丸更容易复发:它长在四条**互不相干**的编辑入口上(useEditMode 5 屏 /
// SchedHeader 7 屏 / LedgerWideTable / useFinStatementScreen 3 屏)。少接一条,
// 那一整族屏就没有交审入口 —— 而每一族单看都自洽,不会有人在别处发现异样。
//
// 判据从**源码**推导,不手写清单(stage-review 2026-08-31 新1 的教训:手写清单会跟着代码烂)。
// 三条不许省:
//   ① 任何一步解析不出来一律 fail() 并点名是哪个文件,不许 continue
//   ② 扫到的文件数有下限断言,防空扫
//   ③ 白名单写死并断言理由非空 —— 且理由长在**产品代码**里,不在这张表里
//
// 判据落在源码而不是渲染:这十几个屏挂载一次要铺一大堆 API 桩,而「新写的屏也不许漏」
// 这件事本来就只有源码层看得见(与 reviewPillWiredGate 同一条理由)。
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join, resolve, relative } from 'node:path'

const SRC = resolve(__dirname, '../..')

function collect(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === '__tests__' || name === 'node_modules') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) collect(p, out)
    else if (p.endsWith('.vue')) out.push(p)
  }
  return out
}

// components 也要扫:两个宿主里有一个(SchedHeader)在那边,只扫 views 会把它整族漏掉。
const FILES = collect(join(SRC, 'views')).concat(collect(join(SRC, 'components')))
const TEXT = new Map(FILES.map((f) => [f, readFileSync(f, 'utf8')]))
const rel = (f: string) => relative(SRC, f).replace(/\\/g, '/')
const textOf = (f: string) => TEXT.get(f) as string

/** 屏「声明了一把审核键」的四种写法 —— 与 reviewGateCoverage 认的是同一批形状。
 *  ⚠ reviewKinds 那条是 `[^\n]*\[` 不是 `\s*\[`:附7·8 写的是三元
 *  (`reviewKinds: no.value === 7 ? ['charging-car'] : [...]`),盯着紧挨的 `[` 会**静默漏掉**它。 */
const DECLARES = [/reviewKey:\s*\(\)\s*=>/, /:review-key=/, /reviewKinds:[^\n]*\[/, /reviewKind:\s*'/]
const declares = (s: string) => DECLARES.some((re) => re.test(s))

/** 动作簇的使用点。 */
const RENDERS = /<FPReviewActions\b/

/**
 * 宿主 = **接**审核键的组件(prop 签名上有 reviewKey),今天是 SchedHeader 与 LedgerWideTable。
 * 它们各自罩着一族屏:屏自己不画动作簇,把键交给宿主,宿主画那一颗。
 *
 * ⚠ 从 prop 签名认,不从「谁渲染了动作簇」认。后者在宿主那颗被删掉的那一刻会连宿主身份
 *   一起消失,于是 7 个**完全正确**的消费屏一起变红,而真正该点名的只有宿主那一个文件。
 */
const HOST_PROP = /^\s*reviewKey\??:\s*string/m
const HOSTS = FILES.filter((f) => HOST_PROP.test(textOf(f)))
const hostTag = (h: string) => new RegExp(`<${basename(h, '.vue')}\\b`)

/** 接上了 = 自己画,或者把活交给了某个接键的宿主。 */
const wired = (s: string) => RENDERS.test(s) || HOSTS.some((h) => hostTag(h).test(s))

/**
 * 不进审核的屏(对应后端的 @NoReviewGuard)。**理由写在产品代码里**,这里只检查那句话存在且非空 ——
 * 白名单跟着代码走,理由跟着屏走。上限 4 条:例外一多就说明这套机制该重想,不是继续往表里加。
 */
const EXEMPT: Record<string, string> = {
  'views/pv/PvMeterView.vue': '光伏分栋抄表 —— 后端 @NoReviewGuard,这一屏不进审核',
  'views/charging/CpMeterView.vue': '充电桩分栋抄表 —— 同上',
}

/**
 * 四条编辑入口。每一条都要有屏真的接上动作簇 —— 少一条 = 那一整族屏没有交审入口。
 * 探针认的是**调用点 / 使用点**,不是 import(import 留在文件里而调用被删掉,是最容易的假绿)。
 */
const ENTRIES: { name: string; detect: RegExp; who: string }[] = [
  { name: '① useEditMode 工具行屏', detect: /useEditMode\(\s*\[/, who: '计费参数 / 园区抄表 / 公共电核算 / 催缴单 / 电费成本' },
  { name: '② SchedHeader 页头', detect: /<SchedHeader\b/, who: '附表族 7 屏' },
  { name: '③ 月度台账宽表', detect: /<LedgerWideTable\b/, who: '月度台账' },
  { name: '④ useFinStatementScreen', detect: /useFinStatementScreen\(/, who: '利润表 / 资产负债表 / 科目余额表' },
]

describe('审核动作簇的接线门禁(§9.2)', () => {
  it('扫到的文件数量像话,宿主也认得出来', () => {
    expect(FILES.length, '扫出来的 .vue 太少 —— 多半是路径写错了在空扫,那样下面每条都恒绿')
      .toBeGreaterThan(60)
    // 宿主认丢了不会让下面哪条直接红,而是让「屏交给宿主画」这一支静悄悄失效 —— 必须单独断。
    expect(HOSTS.map(rel), `没认出接审核键的宿主(prop 签名 \`reviewKey?: string\` 变了?)——` +
      '认丢了的话,SchedHeader / LedgerWideTable 罩着的那 8 个屏会被误判成漏接')
      .toHaveLength(2)
  })

  // ❗破坏验证:删掉任一屏模板里的 <FPReviewActions> → 红并点名那一屏。
  it('❗声明了审核键的屏,必须接上动作簇(自己画,或交给接键的宿主画)', () => {
    const declaring = FILES.filter((f) => declares(textOf(f)))
    // 防空扫:四条正则哪天全失配了,下面那条 bad 恒等于空数组,门禁一声不吭地全绿。
    expect(declaring.length, '一处审核键声明都没扫到 —— 是正则失配了,不是真的没有')
      .toBeGreaterThanOrEqual(10)

    const bad = declaring.filter((f) => !wired(textOf(f))).map(rel)
    expect(bad,
      '这些屏声明了审核键,却没有交审入口 —— 表现是:表做完了,屏上没有任何地方能把它交出去,\n' +
      '而待审清单那边永远等不到这一张。改法:在编辑按钮**左边**同一条 flex 行插一颗\n' +
      '<FPReviewActions :keys="…" :label="…" :can-edit="…" />(全站唯一那一份,别自己画按钮)。\n' +
      `${bad.join('\n')}`).toEqual([])
  })

  // ❗破坏验证:删掉 SchedHeader 里的那颗 → 红并只点名 SchedHeader,不会牵连 7 个消费屏。
  it('❗接键的宿主自己必须画那一颗 —— 宿主漏了就是它罩着的一整族屏一起没入口', () => {
    const bad = HOSTS.filter((h) => !RENDERS.test(textOf(h))).map(rel)
    expect(bad,
      '这些组件接了 reviewKey 这个 prop,却没画动作簇 —— 键传进来喂给了空气。\n' +
      '它罩着的每一个消费屏都会跟着没有交审入口,而那些屏自己一个字都没错。\n' +
      `${bad.join('\n')}`).toEqual([])
  })

  it('❗每个宿主都要有屏往里喂 :review-key —— 没人喂,宿主里那颗就是死代码', () => {
    // 这正是 §7.5 药丸那次事故的形状:组件那一半写好了,没有一个调用方传值。
    for (const h of HOSTS) {
      const fed = FILES.filter((f) => f !== h && hostTag(h).test(textOf(f)) && /:review-key=/.test(textOf(f)))
      expect(fed.length,
        `没有任何屏给 ${rel(h)} 传 :review-key —— 它里面那颗动作簇 keys 恒为 null,\n` +
        '整簇不渲染,从上线到发现一次都不会出现在屏上(§7.5 药丸的原样复刻)。').toBeGreaterThan(0)
    }
  })

  // ❗破坏验证:删掉任一年表屏模板里的 :review-keys → 红并点名那一屏。
  it('❗年表屏必须把整年那串月键喂给宿主 —— 不喂就退回「有键、没入口」那个状态', () => {
    // 年表屏 = 声明了 reviewKinds 的那四屏(附6 / 附7·8 / 附11 / 附13·14)。从源码认,不手写清单。
    // 它们不传 :review-key(一屏一整年,没有「当前月」这一维),所以上面那条「每个宿主都要有屏
    // 往里喂 :review-key」照不到它们 —— 它们四个 2026-09-08 之前就是这样整簇不渲染了半轮。
    const yearly = FILES.filter((f) => /reviewKinds:[^\n]*\[/.test(textOf(f)))
    expect(yearly.length, '一个年表屏都没扫到 —— 探针失配了,这一条从此恒绿')
      .toBeGreaterThanOrEqual(4)
    const bad = yearly.filter((f) => !/:review-keys=/.test(textOf(f))).map(rel)
    expect(bad,
      '这些年表屏声明了按月的审核 kind(行上已经按月上锁了),却没有把整年那串键交给页头 —— \n' +
      '表现是:12 行都锁得住,可屏上一颗「交审 2025 年（N 个月）」都没有,这一年永远交不出去。\n' +
      '改法:从 useSchedScreen 解构 reviewKeys,给 <SchedHeader> 传 :review-keys="reviewKeys"。\n' +
      `${bad.join('\n')}`).toEqual([])
  })

  it('❗四条编辑入口每一条都接上了 —— 少一条就是那一整族屏没入口', () => {
    for (const e of ENTRIES) {
      const fam = FILES.filter((f) => e.detect.test(textOf(f)))
      // 探针失配 = 这一条恒绿,和「这一族真的没接」长得一模一样,所以必须先断族里有人。
      expect(fam.length, `${e.name} 一个屏都没扫到(应有:${e.who})—— 探针失配了,这一条从此恒绿`)
        .toBeGreaterThan(0)
      const bad = fam.filter((f) => !wired(textOf(f)) && !(rel(f) in EXEMPT)).map(rel)
      expect(bad,
        `${e.name}(${e.who})这一族里,这些屏没有交审入口:\n${bad.join('\n')}\n` +
        '真的不该进审核,就把它加进本文件的 EXEMPT 并在屏里写 `// no-review: 理由`。').toEqual([])
    }
  })

  // ❗破坏验证:把某处的 :keys 传值删掉 → 红并点名那一处。
  it('❗渲染了动作簇的地方,keys 与 label 一个都不能少', () => {
    const tags: { f: string; text: string }[] = []
    for (const f of FILES) for (const m of textOf(f).matchAll(/<FPReviewActions\b[^>]*>/g)) tags.push({ f, text: m[0] })
    // 下限贴着现值 10(5 工具行屏 + SchedHeader + LedgerWideTable + 三大报表),没留余量:
    // 少一颗就该有人来读这份门禁,而不是把数字往下调。真要减屏,连同这里一起改。
    expect(tags.length, '动作簇的使用点少于现值 10 —— 组件改名/某一屏的那颗被删了?').toBeGreaterThanOrEqual(10)

    for (const t of tags) {
      // 解析不出来一律 fail,不许 continue:属性值里真出现 `>` 会把标签在那里截断,
      // 截断之后下面两条断言看的是半截标签,漏传就成了假绿。
      expect(t.text.endsWith('/>'),
        `${rel(t.f)} 的 <FPReviewActions> 标签没解析全(属性值里有 \`>\`?)——` +
        '解析不出来就不能假装检查过了').toBe(true)
      expect(/:keys=/.test(t.text),
        `${rel(t.f)} 的动作簇没传 :keys —— keys 是必填 prop,不传的话 Vue 只在 dev 台上警告一句,\n` +
        '屏上表现为整簇不渲染(组件里 props.keys ?? [] 兜住了),和「这屏没接」一模一样。').toBe(true)
      expect(/:label=/.test(t.text),
        `${rel(t.f)} 的动作簇没传 :label —— 弹卡标题会是空的,人不知道自己正在交哪一张表。`).toBe(true)
      // ⚠ :edit 是**丢草稿**那条,不是样式:不传的话组件按默认 false 当成浏览态,
      //   编辑态里照画一颗「交审」;点下去后端 submit 成功 → 键翻 submitted →
      //   useEditMode 那条守卫强退编辑态 → 手上没保存的草稿静默消失。
      //   宿主没有编辑态这回事(将来真有这种屏)就显式传 :edit="false",别靠默认值糊过去。
      expect(/:edit=/.test(t.text),
        `${rel(t.f)} 的动作簇没传 :edit —— 编辑态里会画出「交审」,而交审交的是**库里那一份**:\n` +
        '人一点就把没保存的草稿丢了(交审 → 该键 submitted → 守卫强退编辑态 → 草稿没了)。\n' +
        '判据在组件内一份,宿主只负责把自己的编辑态告诉它。').toBe(true)
    }
  })

  it('❗白名单里每一屏都在自己代码里写明了理由,且确实没有声明审核键', () => {
    expect(Object.keys(EXEMPT).length, '例外多到两位数就该重想这套机制,不是继续往白名单里加')
      .toBeLessThanOrEqual(4)
    for (const [r, what] of Object.entries(EXEMPT)) {
      const s = TEXT.get(join(SRC, r))
      expect(s, `${r}(${what})在白名单里,却不在扫描范围内 —— 屏改名或挪走了,白名单跟着烂了`).toBeTruthy()
      // ⚠ 横向空白只能用 [ \t],不能用 \s —— \s 含换行,`// no-review:` 后面留空时
      //   `\s*` 会跨行吃到注释的下一行,「理由删空」这个破坏当场变成假绿(reviewGateCoverage 实测过)。
      const m = (s as string).match(/\/\/[ \t]*no-review:[ \t]*(.*)/)
      expect(m, `${r}(${what})在白名单里,但代码里没有 \`// no-review: 理由\` 那一行 —— ` +
        '理由要长在产品代码上,不是长在测试的常量表里').toBeTruthy()
      expect((m?.[1] ?? '').trim().length, `${r} 的 no-review 理由是空的 —— 空理由等于没写`).toBeGreaterThan(6)
      expect(declares(s as string),
        `${r} 既在白名单里、又声明了审核键,两个说法对不上 —— 声明了就得有入口`).toBe(false)
    }
  })
})

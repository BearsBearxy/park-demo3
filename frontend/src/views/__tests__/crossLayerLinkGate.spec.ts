// 分析屏跨层链接的源码门禁(SIDEBAR-UX-REDESIGN §6 AnaEmpty 那一行的补漏,2026-09-08)。
//
// P5 把「去录入」按目标屏所在层显隐这件事收进了 AnaEmpty,覆盖 17 处调用点。
// 验收时才发现还有两条**手写**的 RouterLink 绕过了它(ParkView / TenantPortfolioView),
// 园区股东照样点得进数据层的屏 —— 路由读全开,屏打得开,但侧栏里没有那一层的入口,
// 他自己回不来。改完那两处只是把今天的洞堵上;这份门禁堵的是**明天再写一条**。
//
// 为什么只扫 views/analysis:能被「送进回不来的屏」的前提是本人的可见层比目标窄,
// 而 7 个预置角色里只有园区股东(nav_layers='analysis')少于三层 —— 他能看到的正是这 19 屏。
// ⚠ 客户可以自建别的窄组合(如只给 reports),那时别的层的屏也需要同样的门。
//   真出现了就把 ROOT 放宽到 views/,判据不用改(它已经是「源屏层 ≠ 目标屏层就要问」)。
//
// 三条照抄 reviewGateCoverage.spec 的规矩:
//   ① 解析不出来一律 fail 并点名文件,不许 continue
//   ② 扫到的文件数有下限,防空扫
//   ③ 正则找到的链接数要与笨办法数出来的一致 —— 正则哪天不匹配了必须报出来,不许静默变绿
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, relative } from 'node:path'
import { fpBuildRoutes } from '@/nav/fpNav'

const SRC = resolve(__dirname, '../..')                 // frontend/src
const ROOT = join(SRC, 'views/analysis')
const ROUTES = fpBuildRoutes()

function collect(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === '__tests__') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) collect(p, out)
    else if (p.endsWith('.vue')) out.push(p)
  }
  return out
}

/** 一条手写链接:哪个文件、第几行、去哪、那一行原文。 */
interface Link { file: string; line: number; to: string; text: string }

/** `<RouterLink ... to="/x">` —— 只认写死的站内路径。`[^>]` 吃换行,属性折行也认得。 */
const TAG = /<(?:RouterLink|router-link)\b[^>]*?\bto="(\/[^"]*)"/g

function linksOf(file: string): { links: Link[]; tagCount: number } {
  const src = readFileSync(file, 'utf8')
  const lines = src.split('\n')
  const links: Link[] = []
  for (const m of src.matchAll(TAG)) {
    const line = src.slice(0, m.index).split('\n').length          // 1-based
    // 上下文取「往上一行 ~ 标签所在行的下一行」:守卫要么写在标签自己的 v-if 上,
    // 要么写在紧贴着它的 <template v-if> 上,两种都落在这个窗口里。
    // ⚠ 天花板:守卫写得离标签更远(隔两行以上、或挂在外层 div 上)本门禁看不见 → 误报。
    //   误报是红的、有人会来看;漏报才致命,所以窗口宁可开小。
    links.push({ file, line, to: m[1], text: lines.slice(Math.max(0, line - 2), line + 1).join('\n') })
  }
  // ③ 笨办法数一遍开标签。对不上 = 上面那条正则漏了一种写法(:to 动态绑定、拼接路径),
  //    那正是这份门禁最危险的失效方式:它会一声不吭地全绿。
  const tagCount = (src.match(/<(?:RouterLink|router-link)\b/g) ?? []).length
  return { links, tagCount }
}

/** 目标屏所在层。查不到 = 不是导航表里的屏(外链 / 未登记),不归这道门管。 */
const layerOf = (to: string): string | null =>
  ROUTES[to.replace(/^\//, '').split(/[?#]/)[0]]?.layer ?? null

describe('分析屏的跨层链接必须问过 canReach', () => {
  const files = collect(ROOT)

  // ② 防空扫
  it('确实扫到了分析屏', () => {
    expect(files.length, `${ROOT} 下没扫到几个 .vue,这份门禁等于没跑`).toBeGreaterThanOrEqual(15)
  })

  // ③ 正则自证
  it('❗正则认得出文件里每一个 RouterLink —— 认不出就该红,不许静默全绿', () => {
    const bad: string[] = []
    for (const f of files) {
      const { links, tagCount } = linksOf(f)
      // 只在「笨办法数出来更多」时报:多出来的那些是本正则不认识的写法(:to 绑定、属性换行、
      // 动态路径)。它们可能是跨层链接而本门禁看不见 —— 必须有人来看一眼。
      if (tagCount > links.length) {
        bad.push(`${relative(SRC, f)}:数出 ${tagCount} 个 RouterLink,正则只认出 ${links.length} 个`)
      }
    }
    expect(bad, `有 RouterLink 是这份门禁读不懂的写法。把它改成 to="/x" 的写法,\n`
      + `或者(若确实是动态目标)在那一行用 canReach 自己判并在此处豁免:\n${bad.join('\n')}`).toEqual([])
  })

  // ❗主判据。破坏验证:把 ParkView / TenantPortfolioView 那两处的 canReach 去掉 → 红并点名。
  it('❗去别的层的手写链接,必须由 canReach 决定画不画', () => {
    const offenders: string[] = []
    let crossLayer = 0
    for (const f of files) {
      for (const L of linksOf(f).links) {
        const layer = layerOf(L.to)
        if (layer == null || layer === 'analysis') continue   // 外链 / 同层:回得来,不归这道门管
        crossLayer++
        if (!L.text.includes('canReach')) {
          offenders.push(`${relative(SRC, f)}:${L.line} → ${L.to}(${layer} 层)未问 canReach\n    ${L.text.trim()}`)
        }
      }
    }
    expect(offenders,
      `分析屏上有通往别的层的链接没问过「这个人回得来吗」。园区股东只有经营分析层,\n`
      + `点进去之后侧边栏里没有那一层的入口,他自己回不来。\n`
      + `改法:v-if 里加 canReach('<目标>', auth.navLayers, auth.can('system:view'))。\n${offenders.join('\n')}`)
      .toEqual([])
    // 一条跨层链接都没有也是合法状态(全改用 AnaEmpty 了),所以这里不设下限;
    // 空扫由上面「扫到了几个文件」与「正则自证」两条挡着。
    expect(crossLayer, '(仅记录)本次扫到的跨层链接条数').toBeGreaterThanOrEqual(0)
  })

  // ❗句子读得通。链接嵌在一句话中间时,只摘走 <RouterLink> 会剩下「…改按期区呈现;。」这种断句 ——
  //   分隔符必须跟链接一起进 v-if。这里判的是「把条件块整段拿掉之后,那一行还通不通」。
  //   破坏验证:把 TenantPortfolioView 那个 <template v-if> 挪到分号后面(只包链接)→ 红。
  it('❗链接被隐掉之后,它所在的那句话不能剩下孤零零的标点', () => {
    const DANGLING = /[;;,,、]\s*[。.]/                      // 「呈现;。」这类
    const bad: string[] = []
    for (const f of files) {
      for (const L of linksOf(f).links) {
        if (!L.text.includes('canReach')) continue           // 无条件渲染的不存在"隐掉"这回事
        // 条件块整段拿掉 = 这条链接不画时那一行的样子。
        // ⚠ 先剥 HTML 注释:注释里往往正举着「呈现;。」这种反例(本文件旁边那条就是),
        //   不剥的话门禁会拿注释当渲染结果,红在一个根本不上屏的字符串上(实测栽过一次)。
        const hidden = L.text.replace(/<!--[\s\S]*?-->/g, '')
                             .replace(/<template\s+v-if="[^"]*canReach[^"]*"[\s\S]*?<\/template>/g, '')
                             .replace(/<(?:RouterLink|router-link)\b[^>]*v-if="[^"]*canReach[^"]*"[\s\S]*?<\/(?:RouterLink|router-link)>/g, '')
        if (DANGLING.test(hidden)) {
          bad.push(`${relative(SRC, f)}:${L.line} 链接隐掉后剩下断句:\n    ${hidden.trim()}`)
        }
      }
    }
    expect(bad, `把分隔符(分号 / 逗号 / 顿号)也放进 v-if,跟链接一起收:\n${bad.join('\n')}`).toEqual([])
  })
})

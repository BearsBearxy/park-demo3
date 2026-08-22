import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// 「一次交互把整页内容顶下去」的回归门禁 —— LAYOUT-STABILITY-SPEC §6 要求的那一个。
//
// 2026-08-22 用户抓到：提权功能往页面里插了一条
//
//     <div v-if="lockedPerms.length" class="xx-lockbar">本页有 N 项需要主管权限 [请主管授权]</div>
//
// 的流内横条。点一下「编辑模式」再取消，这条出现又消失，底下整张表上下跳一截，
// 用户的眼睛要重新找行。规范 §1 铁律：**用户的一次交互，不得改变屏幕上已渲染内容的位置。**
//
// 这类问题 typecheck / build / 组件单测全都抓不到（模板合法、类型正确、断言也照样通过，
// 只是画面在跳）。所以在源码层把这个**形状**掐死：
//
//     流内块级元素 + v-if 引用交互态变量 + 该元素的 class 不是 absolute/fixed
//
// 写法参照同目录的 readonlyHasNoWriteButtons.spec.ts（同类的源码形状门禁）。
//
// ⚠ 门禁只抓源码形状，抓不到「看起来没动其实动了」。真正的验收还是打开页面点一下。

const SRC = join(__dirname, '..', '..')
const ROOTS = [join(SRC, 'views'), join(SRC, 'components')]

function vueFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name !== '__tests__') out.push(...vueFiles(p))
    } else if (name.endsWith('.vue')) out.push(p)
  }
  return out
}

const rel = (f: string) => f.replace(/\\/g, '/').split('/src/')[1]

/**
 * 只看**流内块级**原生标签。
 * - 组件标签（大写开头，FPModal / FPDrawer / DsToast …）不看：定位是它自己内部的事。
 * - span / b / small 这类行内元素不看：它们不独占一行，不会把下文顶走。
 */
const INFLOW_BLOCK = /^(?:div|section|aside|header|footer|main|article|p|ul|ol|dl|table|form|nav|fieldset|details|h[1-6])$/

/**
 * 「用户能改的状态」变量名。规范 §3 的判据：这条的显隐只要由用户动作决定，就不是首屏加载条。
 * 覆盖四类：编辑态、保存/请求态、选中态、提权/提示态。
 */
const INTERACTIVE_STATE =
  /\b(?:editMode|editing|isEditing|edit|okMsg|okMessage|okText|errMsg|saving|savingAll|submitting|busy|loadingBtn|dirty|cfgDirty|selected|selection|selectedIds|checked|asking|askPolicy|askMonthly|lockedPerms|missingPerms|needPerms|flash|toast|copied|justSaved)\b/

/** v-if / v-else-if 同一个形状，一起抓。前面必须是空白，免得别的属性名尾巴误命中 */
const VIF_TAG = /<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)\sv-(?:else-)?if="([^"]*)"((?:"[^"]*"|'[^']*'|[^>"'])*)>/g

/** 条件里的字符串字面量要先抠掉：auth.can('master:edit') 里的 edit 是权限码，不是编辑态 */
const stripLiterals = (s: string) => s.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, "''")

/**
 * 本文件 <style> 里所有「让元素脱离文档流」的规则，各返回一组**必须同时具备**的 class。
 *
 * ⚠ 必须整组匹配，不能把选择器里出现过的 class 拆开各算一个。PoolLedgerView 写的是
 *   `.pl-bar.pl-float { position: absolute }` —— 拆开的话 `class="pl-bar ok"`（真·流内条）
 *   会被误判成浮层放过去。本文件第一版就是这么漏的。
 * 只取选择器**最右一段**：`.a .b { position:absolute }` 浮起来的是 .b，不是 .a。
 * sticky 不算 —— sticky 元素照样占文档流的位置，出现/消失一样顶人。
 */
function positionedSelectors(src: string): string[][] {
  const out: string[][] = []
  const styles = src.slice(src.indexOf('<style'))
  const rule = /([^{}]+)\{([^{}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = rule.exec(styles))) {
    if (!/position:\s*(?:absolute|fixed)/.test(m[2])) continue
    for (const sel of m[1].split(',')) {
      const last = sel.trim().split(/[\s>+~]+/).pop() ?? ''
      const classes = (last.match(/\.[-\w]+/g) ?? []).map(c => c.slice(1))
      if (classes.length) out.push(classes)
    }
  }
  return out
}

/**
 * 豁免条目的 key。三种写法，越靠后越精确，按需要挑一个：
 *   `路径 .class`          单个 class
 *   `路径 .a.b`            整串 class（同屏同前缀的两条条要分开豁免时用，如 .pl-bar.warn 与 .pl-bar.ok）
 *   `路径 v-if="原条件"`   元素压根没有 class 时
 */
const keysOf = (path: string, classes: string[], cond: string) => [
  ...classes.map(c => `${path} .${c}`),
  `${path} .${classes.join('.')}`,
  `${path} v-if="${cond.trim()}"`,
]

/**
 * 白名单 —— 规范 §6：**只收 §5「编辑态主体工作区」和 §3「首屏加载期」两类**。
 * 每条都要写清「为什么它不算位移」，没理由的不许进。存量违规不许往这里塞（那些进 KNOWN_DEBT）。
 */
const WHITELIST: Record<string, string> = {
  // ── §5 编辑态的「主体工作区」────────────────────────────────────
  // 进编辑模式多出一整排工具（批量条、勾选列、操作列）必然改变布局。这是模式切换不是提示，
  // 用户预期就是换一副面孔。允许的前提：变化局限在编辑区自身、列宽行高两态不变、退出原样还原。

  'views/bills/CoefBookWindow.vue .cb-unibar':
    '§5 编辑态批量操作条（选中 N 户 → 批量改管理费/层份）：是编辑态的主体工作区，不是提示条',
  'views/bills/PayBookWindow.vue .pb-unibar':
    '§5 编辑态批量操作条（批量确认 / 批量改收款账户）：同上，编辑态的主体工作区',
  'views/params/ParamCenterView.vue .pm-cardops':
    '§5 编辑态才出现的参数卡操作区（新增/删除行），长在卡片自己肚子里，不顶卡外的上下文',
  'views/alloc/PoolLedgerView.vue .pl-bar.warn':
    '§5+§2-3：`editMode || cfgDirty` 的「配置已变请重新生成」条。它已经按 §2 优先级 3 做了预留位'
    + '（:class="{ ghost: !cfgDirty }" → visibility:hidden 占着高度），编辑态内 cfgDirty 翻转不动一格；'
    + '只有「进/出编辑模式」这一次模式切换会带它进出，属 §5 允许',

  // ── 二选一，不是新增 ────────────────────────────────────────────
  // v-if / v-else 成对，任何时刻恰好渲染一个，没有「多出一条」这回事。

  'views/sales-income/S10Table.vue v-if="edit"':
    '空态卡里的按钮二选一（编辑态「新增租户」/ 浏览态「编辑模式」），v-else 兜底，永远只渲染一个',

  // ── master-detail 的详情栏：它就是这一屏的主体工作区 ─────────────
  // 点左侧清单 → 右侧详情整块换内容。右栏是 flex:1 的固定分栏，左清单一格不动，
  // 换的是栏**内**的内容，不存在「已渲染内容被顶走」。

  'views/reports/recon/ReconWorkbench.vue .rc-detail':
    'master-detail 右栏本体：左清单定宽不动，右栏 flex:1 恒定占位，变的是栏内内容',
  'views/reports/recon/ReconWorkbench.vue .rc-banner':
    '长在 .rc-detail 右栏内部，随 selected 整块重绘；栏外布局不受影响',
  'views/reports/recon/ReconWorkbench.vue .rc-cocard':
    '长在 .rc-detail 右栏内部，随 selected 整块重绘；栏外布局不受影响',
}

/**
 * 存量债 —— 立门禁那天（2026-08-22）就已经违规、但**不是本次改动引入**的。
 * 冻结在这里，只为「拦住新增」；**只许减不许加**，新写的代码一律不准进这张表。
 * 每条都写明按 §2 优先级表该怎么改。
 */
const KNOWN_DEBT: Record<string, string> = {
  // ✅ 2026-08-22 清空：原有 5 条「保存成功」okMsg 流内绿条已全部收编进 `fp/FPToast.vue`。
  //    组件是浮层（absolute/fixed），门禁本就不看组件标签，故自然合规。
  //    PoolLedgerView 走 card 模式贴 .pl-tablearea **底**边（顶上是 .pl-float 告警条，一上一下不叠）；
  //    另外 4 处走 page 模式贴屏幕底部 —— 它们要么没有 relative 容器（BillNoticesView），
  //    要么宿主是 overflow:auto 的弹窗 body（三个 Window），absolute 贴底会跟着内容滚走。
  //    **这张表现在是空的，请保持空的。** 新写的代码一律不准进。
}

/** 扫一遍全部 .vue，返回违规清单 + 实际命中过的豁免 key（后者用来揪已经过期的豁免条目） */
function scan() {
  const bad: string[] = []
  const usedKeys = new Set<string>()

  for (const root of ROOTS) {
    for (const file of vueFiles(root)) {
      const src = readFileSync(file, 'utf8')
      const head = src.indexOf('<template>')
      if (head < 0) continue
      const tpl = src.slice(head, src.lastIndexOf('</template>') + 11)
      const positioned = positionedSelectors(src)
      const path = rel(file)

      VIF_TAG.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = VIF_TAG.exec(tpl))) {
        const [, tag, pre, cond, post] = m
        if (!INFLOW_BLOCK.test(tag)) continue

        const state = stripLiterals(cond).match(INTERACTIVE_STATE)
        if (!state) continue

        const attrs = pre + post
        // 元素自己写死 style="position:absolute" 的，也算浮层
        if (/position:\s*(?:absolute|fixed)/.test(attrs)) continue

        const classes = (attrs.match(/\sclass="([^"]*)"/)?.[1] ?? '').split(/\s+/).filter(Boolean)
        if (positioned.some(need => need.every(c => classes.includes(c)))) continue

        const hit = keysOf(path, classes, cond).find(k => WHITELIST[k] || KNOWN_DEBT[k])
        if (hit) { usedKeys.add(hit); continue }

        const line = src.slice(0, head + m.index).split('\n').length
        bad.push(
          `${path}:${line}  <${tag} class="${classes.join(' ') || '(无 class)'}">`
            + `  v-if="${cond.trim()}"  ← 交互态「${state[0]}」`,
        )
      }
    }
  }
  return { bad, usedKeys }
}

const RESULT = scan()

describe('交互不得改变已渲染内容的位置（LAYOUT-STABILITY-SPEC）', () => {
  it('v-if 引用交互态的流内块级元素，必须是浮层（或列入白名单）', () => {
    const bad = RESULT.bad
    expect(
      bad,
      '这些流内块由用户交互决定显隐，一出现就把它下面**已经渲染好的内容**整体顶走 —— '
        + 'LAYOUT-STABILITY-SPEC §1 铁律禁止。\n'
        + '按 §2 优先级表挑一个做法（从上往下选，越靠上越好）：\n'
        + '  1. 不加：塞进已有位置（徽标 / 按钮文案 / tooltip / 工具栏 chip）。绝大多数提示条其实不必存在\n'
        + '  2. 浮层：position:absolute 覆在内容上（照抄 PoolLedgerView 的 .pl-float），容器给 position:relative\n'
        + '  3. 预留位：容器恒定高度，空着也占位。只在「几乎总会出现、只是内容变」时用\n'
        + '  4. 流内条：仅限首屏加载期（§3），显隐只由首次加载结果决定，不由任何用户动作决定\n'
        + '如果它确属 §5「编辑态主体工作区」，加进本文件 WHITELIST 并写明理由。\n\n'
        + bad.join('\n'),
    ).toEqual([])
  })

  // 豁免表会烂：class 改名、条子删掉，条目留在这里就成了一张糊住门禁的贴纸。
  // 拿「本轮扫描真的命中过谁」对一遍，没命中的一律清掉。
  it('豁免表不许留过期条目，且每条都得写理由', () => {
    const stale = [...Object.keys(WHITELIST), ...Object.keys(KNOWN_DEBT)]
      .filter(k => !RESULT.usedKeys.has(k))
    expect(stale, '这些豁免条目本轮一个都没命中（class 改名了？条子已经删了？）请从表里清掉：\n'
      + stale.join('\n')).toEqual([])

    for (const [key, why] of Object.entries({ ...WHITELIST, ...KNOWN_DEBT })) {
      expect(why.length, `豁免条目 ${key} 没写理由`).toBeGreaterThan(10)
    }
  })
})

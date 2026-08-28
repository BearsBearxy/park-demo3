import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 门禁：**版式已知的屏不许用居中转圈**（加载态设计稿 §07「精确占位」）。
 *
 * 判据用 `useFitRows` —— 它不是随手挑的标志物，而是「这一屏的版式在数据到达前就算得出来」
 * 这件事本身的证据：它的三个输入全是布局常量（`--mx-row-h: 56px` 等高铁律、thead 样式常量、
 * `.mx-listcard { flex: 1 1 auto }` 挂在 height:100% 链上），与行数、与数据一律无关。
 * 它自己的注释把这条钉死了：
 *
 *   「与渲染内容零耦合：严禁测量 tbody 行高，否则形成 pageSize→内容→尺寸→pageSize 反馈回路」
 *
 * 既然算得出该画几行，就没有理由先塞一个 `min-height: 240px` 的转圈、
 * 等数据到了再把整屏撑开。实测租户管理这一下是 **134px → 317px，位移 183px**。
 *
 * ⚠ 这条抓的是**源码形状**，抓不到「看起来没动其实动了」。真正的验收还是打开页面点一下 ——
 *   与 LAYOUT-STABILITY-SPEC §6 同一句免责。它能保证的是**不回潮**：
 *   谁把转圈加回这几屏，这里当场红。
 */

const VIEWS = join(__dirname, '..')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === '__tests__' || name === 'node_modules') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (name.endsWith('.vue')) out.push(p)
  }
  return out
}

const files = walk(VIEWS).map((p) => ({
  path: p.slice(VIEWS.length).replace(/\\/g, '/'),
  src: readFileSync(p, 'utf8'),
}))

/** 版式已知 = 这屏在用 useFitRows 算「该显示几行」。 */
const exact = files.filter((f) => /\buseFitRows\s*\(/.test(f.src))

/**
 * 例外。**每条都要写明理由**（与 noInteractionLayoutShift.spec.ts 同一惯例）。
 *
 * 收的只有一类：**外壳本来就常驻，转圈关在定高盒子里，压根不位移**。
 * 不收「改起来麻烦」「以后再说」。
 */
const WHITELIST: Record<string, string> = {
  '/system/SystemLogsView.vue':
    '外壳(工具栏/卡片/wrap/分页条)从挂载起就在，转圈只在 wrap 内部替换内容 —— ' +
    'wrap 是 useFitRows 的量高锚点，高度由布局链撑满、与内容无关，所以本来就零位移。' +
    '组件自己的注释把这条写死了：「空/加载/失败三态都留在 wrap 内，v-if 掉整块会让每页行数失去测量锚点」。' +
    '换成骨架行是锦上添花（能显出内容形状），但不是本门禁要防的那个缺陷。',
}

describe('精确占位门禁', () => {
  it('确实存在这样一批屏 —— 判据本身不能因为改名而静默失效', () => {
    // 没有这条的话，将来谁把 useFitRows 改名，下面那条会变成「零个文件全部通过」的空断言。
    expect(exact.length, '一个用 useFitRows 的屏都没扫到，判据大概率已经失效').toBeGreaterThanOrEqual(5)
  })

  it('白名单里的每条都要有理由，而且指向真实存在的文件', () => {
    // 没有这条的话，白名单会变成「把不想改的都塞进去」的垃圾桶。
    for (const [path, why] of Object.entries(WHITELIST)) {
      expect(files.some((f) => f.path === path), `白名单里的 ${path} 已经不存在了`).toBe(true)
      expect(why.length, `${path} 的理由太短，说不清为什么可以例外`).toBeGreaterThan(40)
    }
  })

  it('版式已知的屏不许再用 .page-loading 居中转圈', () => {
    const bad = exact
      .filter((f) => /page-loading/.test(f.src) && !WHITELIST[f.path])
      .map((f) => f.path)

    expect(bad, [
      '',
      '这些屏用 useFitRows 算得出该画几行，却仍然先塞一个 min-height:240px 的转圈：',
      ...bad.map((p) => '  · ' + p),
      '',
      '改法（加载态设计稿 §07）：外壳不卸载，只在叶子上放骨架 ——',
      '  · KpiCard 传 :loading，值位换成微光条',
      '  · FPSortableTable 传 :skeleton-rows="pageSize"，行数与真表一致',
      '  · 去掉 <template v-if="summary"> / <div v-else class="page-loading">',
      '零位移由「外壳从不卸载」这个结构保证，不是靠两份版式对齐出来的。',
      '',
    ].join('\n')).toEqual([])
  })
})

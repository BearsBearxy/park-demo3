// 宽表 spec 共用桩(useWideTable 与台账 / 附表10 / 工资 / 损益 / 楼栋损耗五个消费方)。
// ① ResizeObserver 按元素登记:fire 只叫「observe 着表格区」的回调 —— 漏了 ro.observe(el) 就量不到,会红
//    (旧桩不管 observe 调没调,一律全叫)。
// ② 表格区(按类名认)的 clientWidth / clientHeight 由 size / fire 设定,别的元素量到 0。
// ③ injectCss 把组件 <style> 原文塞进 document,读 getComputedStyle(vitest 默认不加载 SFC 样式)。
// restore 只还原自己打的桩:不用 vi.restoreAllMocks() —— 它会把 vi.mock 工厂里
// vi.fn().mockResolvedValue 的实现一起抹成 undefined,后面的用例报 Unhandled Rejection。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { nextTick } from 'vue'
import { vi } from 'vitest'

interface Obs { cb: () => void; els: Set<Element>; disconnected: boolean }

/**
 * 最右空列(LIST-PAGE §4 列宽铁律):按 rowspan / colspan 把整张表(表头、表体、合计)摊成格子网,
 * 每一行最右那一格都得是 .fp-fill + aria-hidden。返回不是的行(「第 i 行 tr 的 class」),全是返回 []。
 * 撑高行、窗口化 spacer 这类整行 aria-hidden 的行跨满整行,不算。
 */
export function rowsNotEndingInFill(table: Element): string[] {
  const trs = [...(table as HTMLTableElement).rows]
  const grid: (HTMLTableCellElement | undefined)[][] = trs.map(() => [])
  trs.forEach((tr, r) => {
    let c = 0
    for (const td of [...tr.cells]) {
      while (grid[r][c]) c++
      for (let dr = 0; dr < td.rowSpan; dr++) for (let dc = 0; dc < td.colSpan; dc++) if (grid[r + dr]) grid[r + dr][c + dc] = td
      c += td.colSpan
    }
  })
  const hidden = (tr: HTMLTableRowElement) => tr.getAttribute('aria-hidden') === 'true'
  // 表宽按真行算:撑高行写的是 colspan="99" 这种「跨到底」,拿它算会多出几十根空列
  const n = Math.max(...grid.filter((_, r) => !hidden(trs[r])).map(g => g.length))
  return trs.flatMap((tr, r) => {
    if (hidden(tr)) return []
    const last = grid[r][n - 1]
    return last?.classList.contains('fp-fill') && last.getAttribute('aria-hidden') === 'true'
      ? [] : [`第 ${r} 行 ${tr.parentElement!.tagName.toLowerCase()} tr.${tr.className}`]
  })
}

export function stubWideTable(wrapCls: string) {
  let W = 0
  let H = 0
  const all: Obs[] = []
  vi.stubGlobal('ResizeObserver', class {
    private o: Obs
    constructor(cb: () => void) {
      this.o = { cb, els: new Set(), disconnected: false }
      all.push(this.o)
    }
    observe(el: Element) { this.o.els.add(el) }
    unobserve(el: Element) { this.o.els.delete(el) }
    disconnect() { this.o.els.clear(); this.o.disconnected = true }
  })
  const isWrap = (el: Element) => el.classList.contains(wrapCls)
  const spies = [
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
      return isWrap(this) ? W : 0
    }),
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function (this: Element) {
      return isWrap(this) ? H : 0
    }),
  ]
  const styles: HTMLStyleElement[] = []
  return {
    /** 挂载前预设表格区宽高(onMounted 那一次量) */
    size(w: number, h: number) { W = w; H = h },
    /** 表格区变成 w × h:只叫 observe 着表格区的回调 */
    async fire(w: number, h: number) {
      W = w
      H = h
      for (const o of all) if ([...o.els].some(isWrap)) o.cb()
      await nextTick()
    },
    /** 眼下被 observe 着的元素 */
    observed: (): Element[] => all.flatMap(o => [...o.els]),
    /** 调过 disconnect 的观察者个数 */
    disconnected: (): number => all.filter(o => o.disconnected).length,
    /** src 下的 .vue 相对路径,如 'views/salary/SalaryTable.vue';.css 整个文件塞进去(如 'styles/base.css')。
     *  组件得挂在 document 上才读得到 */
    injectCss(srcRel: string) {
      const s = document.createElement('style')
      const src = readFileSync(join(__dirname, '../..', srcRel), 'utf8')
      // 只认顶格的 <style>:脚本注释里写着「<style scoped>」的(附表10)会被当成开头,整张表解析失败、一条都不生效。
      // :deep(X) 照 scoped 编译后的样子换成后代选择器 X(不换的话整条规则是非法选择器,一条都不生效)
      s.textContent = srcRel.endsWith('.css') ? src
        : [...src.matchAll(/^<style[^>]*>([\s\S]*?)^<\/style>/gm)].map(m => m[1]).join('\n').replace(/:deep\(([^)]*)\)/g, '$1')
      document.head.appendChild(s)
      styles.push(s)
    },
    restore() {
      spies.forEach(s => s.mockRestore())
      styles.forEach(s => s.remove())
      vi.unstubAllGlobals()
    },
  }
}

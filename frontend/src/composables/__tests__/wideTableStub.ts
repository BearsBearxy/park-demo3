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
    /** src 下的 .vue 相对路径,如 'views/salary/SalaryTable.vue'。组件得挂在 document 上才读得到 */
    injectCss(srcRel: string) {
      const s = document.createElement('style')
      // 只认顶格的 <style>:脚本注释里写着「<style scoped>」的(附表10)会被当成开头,整张表解析失败、一条都不生效
      s.textContent = [...readFileSync(join(__dirname, '../..', srcRel), 'utf8')
        .matchAll(/^<style[^>]*>([\s\S]*?)^<\/style>/gm)].map(m => m[1]).join('\n')
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

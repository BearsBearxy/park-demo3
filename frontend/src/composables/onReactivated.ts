import { onActivated } from 'vue'

/** KeepAlive 页签切回时执行(跳过首次 mounted 后紧跟的 activated,避免主数据 mount 双拉)。
 *  用途:页签切换命中缓存实例保留浏览状态,但主数据清单(租户/楼栋等)须回拉——
 *  否则改名/加单元后切回页签显示旧清单(全站派生审计 2026-08-03 病根 A)。 */
export function onReactivated(fn: () => void) {
  let first = true
  onActivated(() => {
    if (first) { first = false; return }
    fn()
  })
}

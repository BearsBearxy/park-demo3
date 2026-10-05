// 部署配置(stores/appConfig)在 spec 里不会自己到:外壳不一定挂,接口是 mock 的。配置没到时按客户园区算 ——
// 更新记录一条都不算、模拟填充按钮不显。测我园原有行为的 spec 建完 pinia 先调 ourPark(),当作「我园生产,配置已到」。
import { useAppConfigStore } from '@/stores/appConfig'

/** 我园生产:后端默认值(PARK_TOOLS_ENABLED / RELEASE_BASELINE 都不设)。 */
export function ourPark(): void {
  useAppConfigStore().cfg = { parkTools: true, releaseBaseline: '0.0.0' }
}

/** 客户园区:gen-env.sh 写的那两行,baseline = 装机那一版。 */
export function customerPark(baseline: string): void {
  useAppConfigStore().cfg = { parkTools: false, releaseBaseline: baseline }
}

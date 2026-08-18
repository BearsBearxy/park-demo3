import http from './index'
import type { DataHomeOverviewDTO } from '../types/dataHome'

export const dataHomeApi = {
  // 不传 ym = 后端锚定月(出账链最新有数据月,spec §2.2);顶部下拉切月时传具体账期。
  // 一个往返拿齐 period+months+chain+schedules,前端不需要先拉月份列表再决定看哪个月。
  getOverview: (ym?: string): Promise<DataHomeOverviewDTO> =>
    http.get('/data-home/overview', { params: { ym } }),
}

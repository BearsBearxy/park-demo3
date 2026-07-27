import http from './index'

// 价目管理(PRICE-CFG-SPEC §4)DTO — 逐字对齐后端 dto/PriceCfg*。
// 派生引擎取价的单一事实源:GET=已登录可读,写=ADMIN。
// GET 整表全量(行数<100),版本链解析与历史展示归前端(utils/priceCfgLogic.resolvePrice)。

export interface PriceCfgDTO {
  id: number
  scope: string              // ''=全园 | p1|p2|dorm 分区 | tenant:{id} 户级
  cfgKey: string             // 受控白名单(priceCfgLogic.PRICE_KEYS 镜像)
  acctMonth: string          // 版本生效起点 'YYYY-MM' | ''=初始版本(自始生效)
  value: number
  note: string | null        // 数值来源锚点(如 "2024-02 代理购电价表")
  updatedAt: string          // 该版本变更时间戳(MySQL ON UPDATE)
  tenantName: string | null  // 仅 tenant: scope 非空;租户已删显"已删租户#id"
}

export interface PriceCfgUpsertReq {
  scope: string              // ^(|p1|p2|dorm|tenant:\d+)$
  cfgKey: string
  acctMonth?: string | null  // 版本生效起点;null→''=初始版本(月变键必填非空,后端 400)
  value: number | null       // null=删该版本行(有行删、无行零操作)
  note?: string | null
}

export interface PriceCfgCopyResultDTO {
  copied: number
  skipped: number            // 目标月已有版本的键跳过(幂等)
}

export const priceCfgApi = {
  // 整表全量(含全部 scope 与版本行),排序 scope,cfg_key,acct_month
  list: (): Promise<PriceCfgDTO[]> => http.get('/price-cfg'),
  // 单行 upsert;value=null 删该版本行
  save: (req: PriceCfgUpsertReq): Promise<void> => http.put('/price-cfg', req),
  // 仅复制月变键(电价6键)的 fromYm 版本到 toYm,已存在跳过(幂等)="复制上月电价"
  copy: (fromYm: string, toYm: string): Promise<PriceCfgCopyResultDTO> =>
    http.post('/price-cfg/copy', { fromYm, toYm }),
}

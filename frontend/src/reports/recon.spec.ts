import { describe, it, expect } from 'vitest'
import { filterEntities, segCounts, statusColor } from './recon'
import type { ReconEntity } from '@/types/recon'

// 合成实体:输入序打乱(ok/miss/diff/已核实diff/ok),验证过滤+排序
const ent = (over: Partial<ReconEntity>): ReconEntity => ({
  tenantId: null,
  tenantName: '',
  status: 'ok',
  ledgerTotal: 0,
  s10Total: 0,
  diff: 0,
  marked: false,
  markNote: null,
  fees: [],
  ledgerCards: [],
  s10Cards: [],
  ...over,
})

const ENTITIES: ReconEntity[] = [
  ent({ tenantName: '甲公司', status: 'ok' }),
  ent({ tenantName: '乙食品', status: 'miss', diff: 500 }),
  ent({ tenantName: '丙科技', status: 'diff', diff: 12.3 }),
  ent({ tenantName: '丁食品', status: 'diff', diff: 8, marked: true, markNote: '已电话核实' }),
  ent({ tenantName: '戊物流', status: 'ok', marked: true }),
]

const names = (rows: ReconEntity[]) => rows.map(r => r.tenantName)

describe('filterEntities 四档过滤', () => {
  it('all=全部,排序:未核实 diff→miss→ok,已核实排最后', () => {
    expect(names(filterEntities(ENTITIES, 'all', ''))).toEqual([
      '丙科技', '乙食品', '甲公司', '丁食品', '戊物流',
    ])
  })

  it('diff/miss/ok 按 status 过滤;已核实仍在其档内(灰显不剔除)', () => {
    expect(names(filterEntities(ENTITIES, 'diff', ''))).toEqual(['丙科技', '丁食品'])
    expect(names(filterEntities(ENTITIES, 'miss', ''))).toEqual(['乙食品'])
    expect(names(filterEntities(ENTITIES, 'ok', ''))).toEqual(['甲公司', '戊物流'])
  })
})

describe('filterEntities 搜索', () => {
  it('tenantName 含 query;与档位叠加;首尾空白忽略', () => {
    expect(names(filterEntities(ENTITIES, 'all', '食品'))).toEqual(['乙食品', '丁食品'])
    expect(names(filterEntities(ENTITIES, 'diff', '食品'))).toEqual(['丁食品'])
    expect(names(filterEntities(ENTITIES, 'all', ' 食品 '))).toEqual(['乙食品', '丁食品'])
  })

  it('无命中返回空;query 空不过滤', () => {
    expect(filterEntities(ENTITIES, 'all', '不存在')).toEqual([])
    expect(filterEntities(ENTITIES, 'all', '')).toHaveLength(5)
  })
})

describe('filterEntities 排序稳定', () => {
  it('同档同 marked 保输入序;已核实组内仍按 diff→miss→ok', () => {
    const twoOk = [
      ent({ tenantName: 'A', status: 'ok' }),
      ent({ tenantName: 'B', status: 'ok' }),
      ent({ tenantName: 'C', status: 'ok', marked: true }),
      ent({ tenantName: 'D', status: 'diff', marked: true }),
    ]
    expect(names(filterEntities(twoOk, 'all', ''))).toEqual(['A', 'B', 'D', 'C'])
  })
})

describe('segCounts', () => {
  it('四档计数:all=全部,各档按 status(含已核实)', () => {
    expect(segCounts(ENTITIES)).toEqual({ all: 5, diff: 2, miss: 1, ok: 2 })
  })

  it('空数组全 0', () => {
    expect(segCounts([])).toEqual({ all: 0, diff: 0, miss: 0, ok: 0 })
  })
})

describe('statusColor', () => {
  it('ok→蓝 diff→橙 miss→红 token 名', () => {
    expect(statusColor('ok')).toBe('--hue-blue')
    expect(statusColor('diff')).toBe('--hue-orange')
    expect(statusColor('miss')).toBe('--hue-red')
  })
})

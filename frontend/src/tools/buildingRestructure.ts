// 楼栋重建 P1(BUILDING-RESTRUCTURE-SPEC):8 粗栋 → 按真实结构逐栋细分(A-G座/宿舍一~四栋/一~六车间/创业·工业大厦)。
// 运行: npx vite-node src/tools/buildingRestructure.ts -- <dry|plan|apply|verify>
//   dry    只统计信号覆盖,不写库不落盘
//   plan   生成 ../restructure-plan.csv(合同映射清单,MANUAL 行=无信号/多义,保留旧栋等人工)
//   apply  建 18 新栋 + 自动合同重挂(新栋建单元) + meter.building_id 按区域刷挂;幂等可重跑
//   verify 锚点核对:栋数/合同 282 无悬空/phase 月租等式/meter 挂栋数
// 信号(§3.3):①名称直配(A座/空地/散租宿舍原地不动) ③抄表租户×区域(候选限定在旧栋拆出的新栋内,
// 表数最多者胜,并列=MANUAL)。信号②附表10 分组经 dry 实测为合并组(一至四车间/五、六车间),无逐车间粒度,
// 二期 79 份合同全部走③。三期无任何信号 → 全量 MANUAL 留在旧「三期」栋。
// 旧栋(11/12/15/16/17)不删不改名不停用,等 MANUAL 人工清零后再处置(§3.5)。
// 回滚:apply 前先 mysqldump(demo3/backup-building-restructure-*.sql);plan CSV 即逆映射。
// 运行前须设管理员账号环境变量(口令不落仓库,免明文随 git 外泄):
//   PowerShell: $env:ADMIN_USER='admin'; $env:ADMIN_PASSWORD='<口令>'
//   bash:       export ADMIN_USER=admin ADMIN_PASSWORD='<口令>'
/* eslint-disable no-console */
import { writeFileSync } from 'node:fs'
import { buildingIdFor } from '@/utils/meterSplit'

const API = 'http://localhost:8181/api'
const MODE = process.argv[process.argv.length - 1]

// 新栋清单(name-keyed;phase 继承旧栋;from=承载合同的旧栋名)
const NEW_BUILDINGS: { name: string; phase: number; from: string }[] = [
  { name: '一期 B座', phase: 1, from: '一期 B-G座' },
  { name: '一期 C座', phase: 1, from: '一期 B-G座' },
  { name: '一期 D座', phase: 1, from: '一期 B-G座' },
  { name: '一期 E座', phase: 1, from: '一期 B-G座' },
  { name: '一期 F座', phase: 1, from: '一期 B-G座' },
  { name: '一期 G座', phase: 1, from: '一期 B-G座' },
  { name: '一期 宿舍一栋', phase: 1, from: '一期 宿舍区' },
  { name: '一期 宿舍二栋', phase: 1, from: '一期 宿舍区' },
  { name: '一期 宿舍三栋', phase: 1, from: '一期 宿舍区' },
  { name: '一期 宿舍四栋', phase: 1, from: '一期 宿舍区' },
  { name: '二期 一车间', phase: 2, from: '二期 一至四车间' },
  { name: '二期 二车间', phase: 2, from: '二期 一至四车间' },
  { name: '二期 三车间', phase: 2, from: '二期 一至四车间' },
  { name: '二期 四车间', phase: 2, from: '二期 一至四车间' },
  { name: '二期 五车间', phase: 2, from: '二期 五、六车间' },
  { name: '二期 六车间', phase: 2, from: '二期 五、六车间' },
  { name: '三期 创业大厦', phase: 3, from: '三期' },
  { name: '三期 工业大厦', phase: 3, from: '三期' },
]
const KEEP = ['一期 A座', '一期 空地', '散租宿舍']   // 信号①:原地保留零迁移

// ── API 通道(仿 realDataMigrate) ─────────────────────────
let token = ''
async function call<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = (await res.json()) as { code: number; message: string; data: T }
  if (data.code !== 0) throw new Error(`${method} ${path} → code ${data.code}: ${data.message}`)
  return data.data
}
async function login() {
  // 缺环境变量直接炸,不回退默认口令:静默兜底等于口令照样写死在代码里
  const username = process.env.ADMIN_USER
  const password = process.env.ADMIN_PASSWORD
  if (!username || !password) {
    throw new Error('缺少管理员凭据环境变量 ADMIN_USER / ADMIN_PASSWORD。'
      + "PowerShell: $env:ADMIN_USER='admin'; $env:ADMIN_PASSWORD='<口令>'  |  bash: export ADMIN_USER=admin ADMIN_PASSWORD='<口令>'")
  }
  const res = await fetch(API + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const d = (await res.json()) as { code: number; data: { token: string } }
  if (d.code !== 0) throw new Error('登录失败')
  token = d.data.token
}

interface B { id: number; name: string; phase: number; status: number }
interface C {
  id: number; contractNo: string; tenantId: number; tenantName: string
  buildingId: number; buildingName: string; unitId: number | null
  buildingArea: number | null; rentArea: number | null; unitPrice: number | null
  monthlyRent: number; deposit: number
  startDate: string | null; endDate: string | null; signDate: string | null
  status: string; remark: string | null; rentFree: string | null
}
interface M {
  id: number; kind: string; zone: string; name: string; area: string | null; spot: string | null
  tenantName: string | null; tenantId: number | null; buildingId: number | null
  ownership: string | null; meterType: string | null; subName: string | null; code: string | null
  factor: number | null
}

// ── 合同映射计算(信号①/③;plan 与 apply 共用同一确定性结果) ──
interface PlanRow { c: C; target: string | null; signal: string; note: string }

function computePlan(contracts: C[], meters: M[]): PlanRow[] {
  // 信号③底表:候选新栋以「合同旧栋拆出的新栋」为限;区域→新栋名用生产同款 buildingIdFor(单一事实源)
  const synth = NEW_BUILDINGS.map((b, i) => ({ id: i + 1, name: b.name }))
  const nameOf = new Map(synth.map(s => [s.id, s.name]))
  // tenantId → (新栋名 → 表数)
  const tenantAreas = new Map<number, Map<string, number>>()
  for (const m of meters) {
    if (!m.tenantId || !m.area) continue
    const bid = buildingIdFor(m.zone, m.area, synth)
    if (bid == null) continue
    const name = nameOf.get(bid)!
    const mm = tenantAreas.get(m.tenantId) ?? new Map<string, number>()
    mm.set(name, (mm.get(name) ?? 0) + 1)
    tenantAreas.set(m.tenantId, mm)
  }
  const fromSet = new Map<string, Set<string>>()   // 旧栋名 → 拆出的新栋名集合
  for (const nb of NEW_BUILDINGS) {
    const s = fromSet.get(nb.from) ?? new Set<string>()
    s.add(nb.name); fromSet.set(nb.from, s)
  }
  return contracts.map((c): PlanRow => {
    if (KEEP.includes(c.buildingName)) return { c, target: null, signal: 'KEEP', note: '名称直配原地保留' }
    if (NEW_BUILDINGS.some(nb => nb.name === c.buildingName)) return { c, target: null, signal: 'DONE', note: '已在新栋' }
    const candidates = fromSet.get(c.buildingName)
    if (!candidates) return { c, target: null, signal: 'MANUAL', note: `未知旧栋 ${c.buildingName}` }
    const counts = [...(tenantAreas.get(c.tenantId) ?? new Map<string, number>())]
      .filter(([name]) => candidates.has(name))
      .sort((a, b) => b[1] - a[1])
    if (!counts.length) return { c, target: null, signal: 'MANUAL', note: '无抄表区域信号' }
    if (counts.length > 1 && counts[0][1] === counts[1][1])
      return { c, target: null, signal: 'MANUAL', note: `多区域并列:${counts.map(([n, k]) => `${n}×${k}`).join('/')}` }
    return { c, target: counts[0][0], signal: 'AUTO', note: `表数 ${counts[0][1]}${counts.length > 1 ? `(次选 ${counts[1][0]}×${counts[1][1]})` : ''}` }
  })
}

function summarize(plan: PlanRow[]) {
  const n = (s: string) => plan.filter(p => p.signal === s).length
  console.log(`合同 ${plan.length}:KEEP ${n('KEEP')} / AUTO ${n('AUTO')} / MANUAL ${n('MANUAL')} / DONE ${n('DONE')}`)
  const byOld = new Map<string, { auto: number; manual: number }>()
  for (const p of plan) {
    if (p.signal !== 'AUTO' && p.signal !== 'MANUAL') continue
    const e = byOld.get(p.c.buildingName) ?? { auto: 0, manual: 0 }
    p.signal === 'AUTO' ? e.auto++ : e.manual++
    byOld.set(p.c.buildingName, e)
  }
  for (const [old, e] of byOld) console.log(`  ${old}: 自动 ${e.auto} / MANUAL ${e.manual}`)
}

async function load() {
  await login()
  const buildings = await call<B[]>('GET', '/buildings')
  const contracts = await call<C[]>('GET', '/contracts')
  const meters = await call<M[]>('GET', '/meters')
  return { buildings, contracts, meters }
}

// ── dry / plan ───────────────────────────────────────────
async function dry() {
  const { contracts, meters } = await load()
  summarize(computePlan(contracts, meters))
  // meter 刷挂预估(对全部楼栋=新栋清单模拟)
  const synth = NEW_BUILDINGS.map((b, i) => ({ id: i + 1, name: b.name })).concat(KEEP.map((n, i) => ({ id: 100 + i, name: n })))
  const target = meters.filter(m => buildingIdFor(m.zone, m.area ?? undefined, synth) != null).length
  console.log(`meter ${meters.length} 块,新规则可挂 ${target}(现挂 ${meters.filter(m => m.buildingId != null).length})`)
}

async function plan() {
  const { contracts, meters } = await load()
  const rows = computePlan(contracts, meters)
  summarize(rows)
  const csv = ['contractId,contractNo,tenant,oldBuilding,newBuilding,signal,note']
  for (const p of rows) {
    if (p.signal === 'KEEP' || p.signal === 'DONE') continue
    csv.push([p.c.id, p.c.contractNo, p.c.tenantName, p.c.buildingName, p.target ?? '', p.signal, p.note]
      .map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
  }
  writeFileSync('../restructure-plan.csv', '﻿' + csv.join('\n'), 'utf8')
  console.log(`plan CSV → demo3/restructure-plan.csv(${csv.length - 1} 行,MANUAL 行留旧栋等人工)`)
}

// ── apply ────────────────────────────────────────────────
async function apply() {
  const { buildings, contracts, meters } = await load()
  // 1) 建新栋(同名跳过;phase 继承;层1/面积0 占位,P2 房间层级再补真实值)
  const byName = new Map(buildings.map(b => [b.name, b]))
  for (const nb of NEW_BUILDINGS) {
    if (byName.has(nb.name)) { console.log('楼栋已存在跳过', nb.name); continue }
    const created = await call<B>('POST', '/buildings', {
      name: nb.name, phase: nb.phase, floorCount: 1, totalArea: 0, rentableArea: 0, perFloor: 0,
      remark: `楼栋重建 P1 由「${nb.from}」拆分;楼层/面积待 P2 补录`,
    })
    byName.set(nb.name, created)
    console.log('楼栋 ✓', nb.name, 'id', created.id)
  }
  // 2) 合同重挂(AUTO 行:新栋建占位单元 → PUT 全字段;MANUAL/KEEP 不动)
  const rows = computePlan(contracts, meters)
  summarize(rows)
  let moved = 0
  for (const p of rows) {
    if (p.signal !== 'AUTO') continue
    const nb = byName.get(p.target!)
    if (!nb) { console.log('  ✗ 目标栋缺失', p.target); continue }
    const unit = await call<{ id: number }>('POST', `/buildings/${nb.id}/units`, { floor: 1 })
    const c = p.c
    await call('PUT', `/contracts/${c.id}`, {
      contractNo: c.contractNo, tenantId: c.tenantId, buildingId: nb.id, unitId: unit.id,
      buildingArea: c.buildingArea, rentArea: c.rentArea, unitPrice: c.unitPrice,
      monthlyRent: c.monthlyRent, deposit: c.deposit,
      startDate: c.startDate, endDate: c.endDate, signDate: c.signDate,
      status: c.status, remark: c.remark, rentFree: c.rentFree,
    })
    moved++
  }
  console.log(`合同重挂 ✓ ${moved}`)
  // 3) meter 刷挂:新规则命中且不同才 PUT(未命中保持原挂,旧栋仍在不悬空)
  const allB = await call<B[]>('GET', '/buildings')
  let flushed = 0
  for (const m of meters) {
    const bid = buildingIdFor(m.zone, m.area ?? undefined, allB)
    if (bid == null || bid === m.buildingId) continue
    await call('PUT', `/meters/${m.id}`, {
      kind: m.kind, zone: m.zone, name: m.name, area: m.area, spot: m.spot,
      tenantName: m.tenantName, tenantId: m.tenantId, buildingId: bid,
      ownership: m.ownership, meterType: m.meterType, subName: m.subName, code: m.code, factor: m.factor,
    })
    flushed++
  }
  console.log(`meter 刷挂 ✓ ${flushed}`)
}

// ── verify ───────────────────────────────────────────────
// 迁移前锚点(2026-07-21 实测):phase 月租合计,重挂只换栋不改租金,必须逐分不动
const PHASE_RENT: Record<number, number> = { 1: 1498753.32, 2: 3048509.24, 3: 75528.73, 4: 48910.92 }

async function verify() {
  const { buildings, contracts, meters } = await load()
  const missing = NEW_BUILDINGS.filter(nb => !buildings.some(b => b.name === nb.name))
  console.log(`楼栋 ${buildings.length} 栋;新栋 ${NEW_BUILDINGS.length - missing.length}/${NEW_BUILDINGS.length}${missing.length ? ' 缺:' + missing.map(b => b.name).join(',') : ''}`)
  // 合同:总数/悬空 unit/单元归属
  const unitToBuilding = new Map<number, number>()
  for (const b of buildings) {
    const d = await call<{ units: { id: number }[] }>('GET', `/buildings/${b.id}`)
    for (const u of d.units) unitToBuilding.set(u.id, b.id)
  }
  const noUnit = contracts.filter(c => c.unitId == null)
  const badUnit = contracts.filter(c => c.unitId != null && unitToBuilding.get(c.unitId!) !== c.buildingId)
  console.log(`合同 ${contracts.length}(期望 282);unitId 空 ${noUnit.length};单元不属其栋 ${badUnit.length}`)
  // phase 月租锚点
  const phaseOf = new Map(buildings.map(b => [b.id, b.phase]))
  const sums: Record<number, number> = {}
  for (const c of contracts) {
    const p = phaseOf.get(c.buildingId)!
    sums[p] = Math.round(((sums[p] ?? 0) + Number(c.monthlyRent || 0)) * 100) / 100
  }
  for (const [p, want] of Object.entries(PHASE_RENT)) {
    const got = sums[Number(p)] ?? 0
    console.log(`  phase ${p} 月租 ${got} ${got === want ? '✓' : `✗ 期望 ${want}`}`)
  }
  // 合同按栋分布 + meter 挂栋
  const cnt = new Map<string, number>()
  const bName = new Map(buildings.map(b => [b.id, b.name]))
  for (const c of contracts) cnt.set(c.buildingName, (cnt.get(c.buildingName) ?? 0) + 1)
  console.log('合同分布:', JSON.stringify([...cnt].sort((a, b) => b[1] - a[1])))
  const linked = meters.filter(m => m.buildingId != null)
  console.log(`meter ${meters.length} 块,挂栋 ${linked.length}`)
  const mb = new Map<string, number>()
  for (const m of linked) { const n = bName.get(m.buildingId!) ?? `悬挂id${m.buildingId}`; mb.set(n, (mb.get(n) ?? 0) + 1) }
  console.log('meter 挂栋分布:', JSON.stringify([...mb].sort((a, b) => b[1] - a[1])))
}

const main = { dry, plan, apply, verify }[MODE]
if (!main) { console.error('用法: vite-node src/tools/buildingRestructure.ts -- <dry|plan|apply|verify>'); process.exit(1) }
main().then(() => console.log('DONE ' + MODE)).catch(e => { console.error('FAILED:', e); process.exit(1) })

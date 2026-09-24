// 告警文案门禁(BILL-NOTICE-WARN-SPEC §5.2)。骨架抄 paramRegistry.spec.ts,
// 三个手法抄 anaCopyLint.spec.ts:[...s].length 数码点、基线写死并注明只许改小、钉住尺子的元断言。
//
// 病根 B:告警文案这条链上没有验收。出过三起事故 —— 逐个代入下面六条判据核过:
//
// | 事故                    | G1 | G5 | G6 | 谁为它变红 |
// |-------------------------|----|----|----|-----------|
// | 缺价 elec_sharp 上屏    | 绿 | 绿 | 红 | G6        |
// | rent_office / rent_dorm | 绿 | 绿 | 红 | G6        |
// | 场地未定:544.00         | 绿 | 绿 | 绿 | BillNoticeApiIT:payload/hint 分列断言 |
//
// 所以 G6 是这里唯一会为真实事故变红的判据,不是附属条。前两起的机制是同一个:
// 字典查不到时 ?? 回落把原始键原样吐上屏(billNoticeLogic.ts:17-18 的注释白纸黑字记着),
// 回落本身要留(引擎加费项不丢行),所以用**闭集**把能产出的键逐个钉死。
// 第三起的机制是「标签说的是场地、塞进去的是表名」—— 前端门禁看不见,
// 钉它的是那条断言 payload/hint 分两列存、不拼串的 IT。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  PACKAGE_FEE_KEYS, PRICE_KEYS, WARN_CODES, WARN_COPY, type WarnCode,
} from './billNoticeWarnCopy'
import { billFeeLabel } from './billNoticeLogic'
import { paramDef } from './paramRegistry'

// 跨端清单走「前端直接读 Java 源码」,不走人工拷 fixture ——
// reviewGateCoverage.spec.ts 已经这么干了。人工拷 fixture 那条路后端改了忘拷就没有任何东西变红。
const WARN_CODE_JAVA = join(__dirname, '..', '..', '..',
  'backend', 'src', 'main', 'java', 'com', 'park', 'demo3', 'service', 'WarnCode.java')

function backendCodes(): string[] {
  const src = readFileSync(WARN_CODE_JAVA, 'utf-8')   // 读不到直接抛,不返回空清单
  const out: string[] = []
  for (const line of src.split(/\r?\n/)) {
    const m = /^ {4}(W_[A-Z_]+)\s*[,;]\s*$/.exec(line)
    if (m) out.push(m[1])
  }
  return out
}

// 原始标识符:下划线是英文 key 的指纹;冒号前缀那几个抄 ParamRegistryTest 的 FORBIDDEN。
const FORBIDDEN = /(building:|rule:|meter:|tenant:|_)/
// 连续 ≥3 个 ASCII 小写字母 = 英文词漏上屏。白名单只放单位。
const ASCII_RUN = /[a-z]{3,}/
const UNIT_OK = /kVA|kWh|m²/g
const cp = (s: string) => [...s].length
const hasCJK = (s: string) => /[一-龥]/.test(s)

// 每个 code 的合法探针值(G5 用)。写死而不是随便给一个串:
// paramDef('544.00') 会返回 undefined,拿它当探针会把正常实现判红。
const PROBE: Record<WarnCode, [string, string]> = {
  W_METER_NO_CONTRACT: ['798', '六楼 4-636 水表①'],
  W_METER_BIND_STALE: ['193', '旭化成电表3'],
  W_METER_BILLED_ELSEWHERE: ['2201', '次生代620电'],
  W_ROOM_MISMATCH: ['544', ''],
  W_CONTRACT_NO_DATES: ['S10-0145#1', ''],
  W_TERM_NO_PARAMS: ['3312', 'S10-0145#1 · 厂房租金'],
  W_RENT_FREE_BAD: ['S10-0094', ''],
  W_PACKAGE_NO_POOL: ['share_green_water', ''],
  W_PRICE_MISSING: ['elec_sharp', ''],
  W_TOTAL_NEGATIVE: ['', ''],
}

describe('告警文案门禁', () => {
  it('元断言:尺子本身没坏(扫描面下限)', () => {
    expect(WARN_CODES.length).toBe(10)
    expect(backendCodes().length).toBeGreaterThanOrEqual(10)
    expect(PRICE_KEYS.length).toBe(7)          // 闭集空了的话 G6 会退化成空循环、永远绿
    expect(PACKAGE_FEE_KEYS.length).toBe(3)
    // 尺子自身可信:FORBIDDEN 抓得住下划线,ASCII_RUN 抓得住英文词
    expect(FORBIDDEN.test('elec_sharp')).toBe(true)
    expect(ASCII_RUN.test('rent_office')).toBe(true)
    expect(hasCJK('尖段电价')).toBe(true)
  })

  // ── G1 不许出现原始标识符 ────────────────────────────────────────────
  it('G1 文案里不许出现原始标识符', () => {
    for (const code of WARN_CODES) {
      const c = WARN_COPY[code]
      for (const [field, v] of Object.entries({
        title: c.title, desc: c.desc, actionLabel: c.actionLabel, why: c.why ?? '',
      })) {
        expect(FORBIDDEN.test(v), `${code}.${field} 含原始标识符:${v}`).toBe(false)
        expect(ASCII_RUN.test(v.replace(UNIT_OK, '')), `${code}.${field} 含英文词:${v}`).toBe(false)
      }
    }
  })

  // ── G2 与后端枚举双向全等 ────────────────────────────────────────────
  it('G2 每一类都有词条,且没有孤儿词条', () => {
    const be = backendCodes()
    expect([...WARN_CODES]).toEqual(be)                       // 顺序也全等:它就是屏上组序
    expect(Object.keys(WARN_COPY).sort()).toEqual([...be].sort())
  })

  // ── G3 FPAlertPanel §6-3 契约 ────────────────────────────────────────
  it('G3 进抽屉的必须给得出动作,不进的必须写明为什么', () => {
    for (const code of WARN_CODES) {
      const c = WARN_COPY[code]
      if (c.drawer) {
        expect(cp(c.desc), `${code} 进抽屉但 desc 太短`).toBeGreaterThan(0)
        expect(c.actionLabel, `${code} 进抽屉但没给动作`).not.toBe('')
        expect(c.route, `${code} 进抽屉但没给落点屏`).not.toBe('')
      } else {
        expect(cp(c.why ?? ''), `${code} 不进抽屉就必须写明为什么(§6-3)`).toBeGreaterThanOrEqual(6)
      }
    }
  })

  // ── G4 分字段长度(有下限:光有上限挡不住写敷衍) ──────────────────────
  it('G4 文案长度在区间内', () => {
    for (const code of WARN_CODES) {
      const c = WARN_COPY[code]
      expect(cp(c.title), `${code}.title`).toBeGreaterThanOrEqual(4)
      expect(cp(c.title), `${code}.title`).toBeLessThanOrEqual(12)
      expect(cp(c.desc), `${code}.desc`).toBeGreaterThanOrEqual(24)
      expect(cp(c.desc), `${code}.desc`).toBeLessThanOrEqual(140)
      expect(cp(c.actionLabel), `${code}.actionLabel`).toBeLessThanOrEqual(12)
    }
  })

  // ── G5 fmt 不许退化成「原样吐出 payload」──────────────────────────────
  it('G5 条目的字必须带标签,不能是裸的实例数据', () => {
    for (const code of WARN_CODES) {
      const c = WARN_COPY[code]
      if (!c.drawer) continue                    // drawer:false 的条目不上抽屉,无 payload 结构
      const [payload, hint] = PROBE[code]
      const out = c.fmt(payload, hint)
      expect(out, `${code}.fmt 原样吐出了 payload`).not.toBe(payload)
      expect(out.startsWith(payload), `${code}.fmt 以裸 payload 开头`).toBe(false)
      expect(hasCJK(out), `${code}.fmt 的输出里一个中文都没有:${out}`).toBe(true)
    }
  })

  // ── G6 闭集:能产出的键必须查得到中文名 ───────────────────────────────
  //
  // 这一条是整套门禁里唯一会为真实事故变红的判据。删掉 paramRegistry 里 elec_sharp 的 label,
  // 或删掉 BILL_FEE_LABEL 里 share_green_water 的词条,这里立刻红。
  it('G6 缺价的 7 个价目键都查得到中文名', () => {
    for (const k of PRICE_KEYS) {
      const label = paramDef(k)?.label
      expect(label, `价目键 ${k} 在 paramRegistry 里查不到中文名,它会原样上屏`).toBeTruthy()
      expect(label).not.toBe(k)
      const out = WARN_COPY.W_PRICE_MISSING.fmt(k, '')
      expect(ASCII_RUN.test(out), `缺价条目印出了英文:${out}`).toBe(false)
      expect(hasCJK(out), `缺价条目里没有中文:${out}`).toBe(true)
    }
  })

  it('G6 包干的 3 个费项键都查得到中文名', () => {
    for (const k of PACKAGE_FEE_KEYS) {
      expect(billFeeLabel(k), `费项键 ${k} 在字典里查不到中文名,它会原样上屏`).not.toBe(k)
      const out = WARN_COPY.W_PACKAGE_NO_POOL.fmt(k, '')
      expect(ASCII_RUN.test(out), `包干条目印出了英文:${out}`).toBe(false)
      expect(hasCJK(out), `包干条目里没有中文:${out}`).toBe(true)
    }
  })
})

// METER-TIMELINE-SPEC §3.6 之后 override_stale 有两种成因:指错了期、钉的是别户的合同(后端不采用,单上不挂合同)。
// 只写前一种的话,后一种的户看到的是「挂的是一份本月不作数的合同」—— 单上其实没挂合同,钉的那份也可能正在租期内
describe('W_METER_BIND_STALE 两种成因都说', () => {
  it('desc 写出「不在租期」与「不是这一段租户的合同」;块头不再说「没生效」', () => {
    const c = WARN_COPY.W_METER_BIND_STALE
    expect(c.desc).toContain('不在它的租期内')
    expect(c.desc).toContain('不是这一段租户的合同')
    expect(c.title).not.toContain('没生效')
  })
})

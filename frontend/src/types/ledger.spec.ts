import { describe, it, expect } from 'vitest'
import { saveRowIdentity, overwriteTargets, ledgerRowKey } from './ledger'

// 2026-08-27 线上撞到的两处:导入后保存整包被拒、每次导入都弹覆盖确认。
// 两者的共同前提都是「结转虚行」—— 读层为显示合成的行,库里没有对应数据。
describe('saveRowIdentity — 保存包的身份三件套', () => {
  it('未绑定的结转虚行:id 与 tenantId 双空,身份只能靠账面名', () => {
    // 这正是导入落下未绑定行之后,下个月看到的那种行
    const r = { id: null, tenantId: null, tenantName: '锐通电子', carried: true }
    expect(saveRowIdentity(r)).toEqual({ id: undefined, tenantId: null, tenantName: '锐通电子' })
  })

  it('三个身份字段不能全空 —— 全空后端会以「缺少身份」拒收整包', () => {
    const r = { id: null, tenantId: null, tenantName: '锐通电子' }
    const idy = saveRowIdentity(r)
    expect(idy.id ?? idy.tenantId ?? idy.tenantName).toBeTruthy()
  })

  it('绑定行:带 tenantId,账面名照样透传(后端据它改快照)', () => {
    expect(saveRowIdentity({ id: 7, tenantId: 3, tenantName: '新元材料' }))
      .toEqual({ id: 7, tenantId: 3, tenantName: '新元材料' })
  })

  it('无账面名时不硬造空串 —— 让后端的身份校验照常拦下', () => {
    expect(saveRowIdentity({ id: null, tenantId: null }).tenantName).toBeUndefined()
  })
})

describe('overwriteTargets — 导入前「会覆盖几家」', () => {
  const rows = [
    { tenantName: '有数据的户', carried: false },
    { tenantName: '只是结转过来的户', carried: true },   // 库里没有数据行
  ]

  it('结转虚行不算「已有数据」—— 算进去会让每次导入都弹覆盖确认', () => {
    expect(overwriteTargets(rows, ['只是结转过来的户'])).toBe(0)
  })

  it('真有数据的户才算', () => {
    expect(overwriteTargets(rows, ['有数据的户'])).toBe(1)
  })

  it('两种混在一起时只数真的那些', () => {
    expect(overwriteTargets(rows, ['有数据的户', '只是结转过来的户', '文件里的新户'])).toBe(1)
  })

  it('去重 + 去空白:同名多行只算一家,空名不算', () => {
    expect(overwriteTargets(rows, ['  有数据的户  ', '有数据的户', null, undefined, ''])).toBe(1)
  })
})

describe('ledgerRowKey — 与身份三件套同源(回归护栏)', () => {
  it('id/tenantId 双空的行按账面名取键,不同名不撞键', () => {
    const a = ledgerRowKey({ id: null, tenantId: null, tenantName: '甲' })
    const b = ledgerRowKey({ id: null, tenantId: null, tenantName: '乙' })
    expect(a).not.toBe(b)
  })
})

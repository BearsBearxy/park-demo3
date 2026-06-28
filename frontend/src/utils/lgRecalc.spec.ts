import { describe, it, expect } from 'vitest'
import { lgRecalc } from './lgRecalc'
import type { LedgerRowDTO } from '../types/ledger'

function blankRow(over: Partial<LedgerRowDTO> = {}): LedgerRowDTO {
  return {
    tenantId: 1, tenantName: 'T', balancePrev: 0, totalCollected: 0, note: null,
    totalReceivable: 0, balanceEnd: 0,
    factoryRent: 0, factoryMgmtFee: 0, shopRent: 0, dormRent: 0, dormFacilitiesFee: 0, shopMgmtFee: 0,
    factoryInfraMaint: 0, shopInfraMaint: 0, dormInfraMaint: 0,
    elevatorMaint: 0, transformerMaint: 0, landUseTax: 0, networkFee: 0, accessCtrlMaint: 0, officeOtherFee: 0,
    dormOtherFee: 0, basicElectricity: 0, standardElectricity: 0, electricityMaint: 0,
    standardWater: 0, waterMaint: 0,
    ...over,
  }
}

describe('lgRecalc', () => {
  it('totalReceivable = Σ21 fees', () => {
    const row = blankRow({ factoryRent: 100, factoryMgmtFee: 50, basicElectricity: 25.5 })
    lgRecalc(row)
    expect(row.totalReceivable).toBe(175.5)
  })

  it('balanceEnd = balancePrev + receivable − collected', () => {
    const row = blankRow({ balancePrev: 200, factoryRent: 1000, totalCollected: 800 })
    lgRecalc(row)
    expect(row.totalReceivable).toBe(1000)
    expect(row.balanceEnd).toBe(400) // 200 + 1000 − 800
  })

  it('rounds to 2 decimals', () => {
    const row = blankRow({ factoryRent: 0.1, factoryMgmtFee: 0.2 })
    lgRecalc(row)
    expect(row.totalReceivable).toBe(0.3) // not 0.30000000000000004
  })

  it('handles negative balanceEnd', () => {
    const row = blankRow({ balancePrev: -100, factoryRent: 500, totalCollected: 600 })
    lgRecalc(row)
    expect(row.balanceEnd).toBe(-200) // −100 + 500 − 600
  })

  it('all-empty row stays zero', () => {
    const row = blankRow()
    lgRecalc(row)
    expect(row.totalReceivable).toBe(0)
    expect(row.balanceEnd).toBe(0)
  })
})

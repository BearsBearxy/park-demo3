import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/api/importLog', () => ({ importLogApi: { record: vi.fn().mockResolvedValue({}) } }))
import { deriveStatus, runImport, IMPORT_TYPES } from './importRegistry'
import { importLogApi } from '@/api/importLog'

describe('deriveStatus', () => {
  it('rejected when nothing imported', () => expect(deriveStatus({ imported: 0, skipped: 0, errors: [] })).toBe('rejected'))
  it('partial when some skipped', () => expect(deriveStatus({ imported: 5, skipped: 1, errors: [] })).toBe('partial'))
  it('partial when some errors', () => expect(deriveStatus({ imported: 5, skipped: 0, errors: [{ rowIndex: 1, label: 'x', reason: 'y' }] })).toBe('partial'))
  it('complete when clean', () => expect(deriveStatus({ imported: 5, skipped: 0, errors: [] })).toBe('complete'))
})

describe('IMPORT_TYPES catalog', () => {
  it('has the 9 expected keys', () => {
    expect(IMPORT_TYPES.map(t => t.key).sort()).toEqual(
      ['charging_7', 'charging_8', 'elec', 'ledger', 'office_13', 'office_14', 'pv', 's10', 'salary'].sort())
  })
  it('only ledger needs context', () => {
    expect(IMPORT_TYPES.filter(t => t.context === 'ledger').map(t => t.key)).toEqual(['ledger'])
  })
})

describe('runImport', () => {
  beforeEach(() => vi.clearAllMocks())

  it('runs entry then records log with resolved status, returns result', async () => {
    const salary = IMPORT_TYPES.find(t => t.key === 'salary')!
    const spy = vi.spyOn(salary, 'run').mockResolvedValue({ imported: 9, skipped: 1, errors: [] })
    const res = await runImport('salary', [], { year: 2026, month: 5 }, 's.xlsx')
    expect(res).toEqual({ imported: 9, skipped: 1, errors: [] })
    expect(importLogApi.record).toHaveBeenCalledWith(expect.objectContaining({
      dataType: 'salary', fileName: 's.xlsx', ok: 9, warn: 1, status: 'partial',
    }))
    spy.mockRestore()
  })

  it('does not throw when log record fails', async () => {
    vi.mocked(importLogApi.record).mockRejectedValueOnce(new Error('net'))
    const pv = IMPORT_TYPES.find(t => t.key === 'pv')!
    const spy = vi.spyOn(pv, 'run').mockResolvedValue({ imported: 3, skipped: 0, errors: [] })
    await expect(runImport('pv', [], {}, 'p.xlsx')).resolves.toMatchObject({ imported: 3 })
    spy.mockRestore()
  })

  it('throws on unknown type', async () => {
    await expect(runImport('bogus', [], {}, 'x.xlsx')).rejects.toThrow('unknown import type')
  })
})

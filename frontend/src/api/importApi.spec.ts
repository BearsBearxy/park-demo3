import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock the shared axios instance so we assert URL/params/body shape without hitting the network.
// Guards the route zero-drift trap (IMPORT-GUIDE §四.5): salary import is /salary/*, office is /utilities/*.
vi.mock('@/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

import http from '@/api'
import { salaryApi } from './salary'
import { utilitiesApi } from './utilities'

const mock = http as unknown as {
  post: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
}

beforeEach(() => vi.clearAllMocks())

describe('salaryApi import/delete shapes', () => {
  it('importRows POSTs /salary/import with year+month query and {rows} body', () => {
    salaryApi.importRows(2025, 3, { rows: [{ tenantName: '张三', base: 8000 }] })
    expect(mock.post).toHaveBeenCalledWith(
      '/salary/import',
      { rows: [{ tenantName: '张三', base: 8000 }] },
      { params: { year: 2025, month: 3 } },
    )
  })

  it('clearImported DELETEs /salary/imported with year+month query', () => {
    salaryApi.clearImported(2025, 3)
    expect(mock.delete).toHaveBeenCalledWith('/salary/imported', { params: { year: 2025, month: 3 } })
  })

  it('batchDelete DELETEs /salary/batch with {ids} body', () => {
    salaryApi.batchDelete([1, 2, 3])
    expect(mock.delete).toHaveBeenCalledWith('/salary/batch', { data: { ids: [1, 2, 3] } })
  })
})

describe('utilitiesApi import/delete shapes', () => {
  it('importRows POSTs /utilities/{no}/import with year query and {rows} body', () => {
    utilitiesApi.importRows(13, 2025, { rows: [{ tenantName: '1月', elecQty: 1000 }] })
    expect(mock.post).toHaveBeenCalledWith(
      '/utilities/13/import',
      { rows: [{ tenantName: '1月', elecQty: 1000 }] },
      { params: { year: 2025 } },
    )
  })

  it('clearImported DELETEs /utilities/{no}/imported with year query', () => {
    utilitiesApi.clearImported(14, 2025)
    expect(mock.delete).toHaveBeenCalledWith('/utilities/14/imported', { params: { year: 2025 } })
  })

  it('batchDelete DELETEs /utilities/batch with {ids} body', () => {
    utilitiesApi.batchDelete([7, 8])
    expect(mock.delete).toHaveBeenCalledWith('/utilities/batch', { data: { ids: [7, 8] } })
  })
})

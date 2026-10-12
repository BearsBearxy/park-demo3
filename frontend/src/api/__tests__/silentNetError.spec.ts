/* Copyright (c) 2026 Junyang. All rights reserved. 版权所有，未经授权禁止复制、出售、抄袭。⁠​‌​​‌​‌​​‌‌‌​‌​‌​‌‌​‌‌‌​​‌‌‌‌​​‌​‌‌​​​​‌​‌‌​‌‌‌​​‌‌​​‌‌‌⁠ */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'

// 断网 / 5xx 的底部全局提示(拦截器 → ui.reportNetError → 外壳回执)。
// 导入写口失败时导入弹窗的失败卡已经写了原因,底部再弹一条等于说两遍:请求带 silentNetError 就不弹。
const reportNetError = vi.fn()
vi.mock('@/stores/ui', () => ({ useUiStore: () => ({ reportNetError }) }))

import http from '../index'

const fail = (status?: number) => (config: InternalAxiosRequestConfig) => Promise.reject(new AxiosError('fail', 'ERR', config, null,
  status == null ? undefined : { status, statusText: '', headers: {}, config, data: { code: status, message: '服务器内部错误' } }))

describe('silentNetError', () => {
  beforeEach(() => { reportNetError.mockClear(); localStorage.clear(); sessionStorage.clear() })

  it('❗带 silentNetError 的请求 5xx / 断网都不出底部全局提示,错误照样抛给调用方', async () => {
    await expect(http.post('/x/import', {}, { adapter: fail(500), silentNetError: true })).rejects.toMatchObject({ code: 500 })
    await expect(http.post('/x/import', {}, { adapter: fail(), silentNetError: true })).rejects.toBeInstanceOf(AxiosError)
    expect(reportNetError).not.toHaveBeenCalled()
  })

  it('不带的照旧出(读路径普遍不 catch,靠它兜底)', async () => {
    await expect(http.get('/x', { adapter: fail(500) })).rejects.toMatchObject({ code: 500 })
    expect(reportNetError).toHaveBeenCalledWith('服务器内部错误')
  })

  // 写口清单见勘察 dialog.json failToast:各域 api 的导入口 + registry 直调 + 记导入记录
  it('❗导入写口一律带上(各域 api 的 /import、registry 直调的几条、记导入记录)', () => {
    const SRC = join(__dirname, '..', '..')
    const files = ['ledger', 's10', 'pv', 'charging', 'elec', 'salary', 'utilities', 'report', 'pnl', 'budget', 'contract', 'importLog']
      .map(f => `api/${f}.ts`).concat('utils/importRegistry.ts')
    const lines = files.flatMap(f => readFileSync(join(SRC, f), 'utf8').split('\n')
      .filter(l => /['`][^'`]*\/import(-full|-log)?['`]/.test(l) && !/http\.(get|delete)/.test(l) && !/^\s*(import\s|\/\/)/.test(l))
      .map(l => `${f}: ${l.trim()}`))
    expect(lines.length).toBeGreaterThanOrEqual(17)
    expect(lines.filter(l => !/silentNetError|SILENT/.test(l))).toEqual([])
  })
})

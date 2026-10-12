/* Copyright (c) 2026 Junyang. All rights reserved. 版权所有，未经授权禁止复制、出售、抄袭。⁠​‌​​‌​‌​​‌‌‌​‌​‌​‌‌​‌‌‌​​‌‌‌‌​​‌​‌‌​​​​‌​‌‌​‌‌‌​​‌‌​​‌‌‌⁠ */
import http from './index'
import type { ImportLogReq, ImportLogDTO, ImportCoverageDTO, ImportLogPageDTO, ImportLogPageQuery } from '../types/importLog'

// paths per backend ImportLogController:/api/import-log。http unwraps Result envelope。
export const importLogApi = {
  // 导入写完才记(或整单被拒时记被拒):失败也不出底部全局提示 —— 记不上不影响导入,runImport 自己吞掉
  record: (req: ImportLogReq): Promise<ImportLogDTO> => http.post('/import-log', req, { silentNetError: true }),
  coverage: (ym: string): Promise<ImportCoverageDTO[]> => http.get('/import-log/coverage', { params: { ym } }),
  // dataType 列表拼成逗号串(Spring List<String> 认;axios 默认会发成 dataType[]=)
  page: (q: ImportLogPageQuery = {}): Promise<ImportLogPageDTO> =>
    http.get('/import-log/page', { params: { ...q, dataType: q.dataType?.length ? q.dataType.join(',') : undefined } }),
}

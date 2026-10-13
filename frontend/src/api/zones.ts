/* Copyright (c) 2026 Junyang. All rights reserved. */
import http from './index'

export interface ZoneDTO { code: string; name: string; sortNo: number }

export const zonesApi = {
  list: (): Promise<ZoneDTO[]> => http.get('/zones'),
}

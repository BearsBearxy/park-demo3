import http from './index'

// 外部天气与太阳辐射(PV-ANALYSIS-SPEC §03)—— 逐字对齐后端 dto/WeatherDayDTO。
// 只有读:导入走 importRegistry 的 key='weather' 直调 POST /weather/import(同 pvMeter 模式)。
// GET = 任何已登录账号可读;写 = meter-reading:edit。

export interface WeatherDayDTO {
  date: string          // YYYY-MM-DD
  ghiKwh: number        // 日累计 kWh/m2(后端 SUM(ghi)/1000)
  rainMm: number | null
  tMax: number | null
  tMin: number | null
  isRain: boolean
  hours: number         // 当日有几个小时的数据
  hourMask: number      // 24 位:第 h 位 = 该整点有记录。剔日看的是它连不连续,不是 hours 的个数
}

export const weatherApi = {
  // month 无参:整年一次取回,与 /pv-meter/readings?year= 同节奏(分析屏一次算一年)
  daily: (year: number) => http.get<WeatherDayDTO[]>('/weather/daily', { params: { year } }),
}

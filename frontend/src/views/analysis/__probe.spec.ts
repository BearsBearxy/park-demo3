import { describe, it } from 'vitest'
import { buildSnapshot, buildLab, type StationCfg, type WeatherDay } from './pvMeterAna.logic'

const dateOf = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`
const span = (from: number, to: number) =>
  Array.from({length: to-from+1}, (_,k)=>1<<(k+from)).reduce((a,b)=>a|b,0)

// 13 站 × 2026 全年
function make(weatherMode: 'full'|'hole'|'gap7'|'daily1h'|'none') {
  const n = 13
  const stations: StationCfg[] = Array.from({length:n},(_,i)=>({id:i+1,name:`S${i+1}`,capKwp:100,metered:true}))
  const rows: any[] = []
  const weather: WeatherDay[] = []
  for (let m=1;m<=12;m++){
    const dim = new Date(2026,m,0).getDate()
    for(let d=1;d<=dim;d++){
      const date = dateOf(2026,m,d)
      const doy = weather.length+1
      if (weatherMode!=='none') {
        const base = {date, ghiKwh: 4+(d%5)*0.4, rainMm:0, isRain: d%10===0}
        if (weatherMode==='full') weather.push({...base, hours:13, hourMask: span(6,18)})
        else if (weatherMode==='hole') weather.push({...base, hours:12, hourMask: span(6,18) & ~(1<<14)})
        else if (weatherMode==='gap7') { if (doy%7!==0) weather.push({...base, hours:13, hourMask: span(6,18)}) }
        else if (weatherMode==='daily1h') weather.push({...base, ghiKwh: 6.37, hours:1, hourMask: 1})
      }
      for(let i=0;i<n;i++){
        // S1 从 7/19 起掉 25% —— 要被检出的那栋
        const bad = i===0 && date >= '2026-07-19' ? 0.75 : 1
        const g = 400*(1+(i-6)*0.01)*(1+(d%5)*0.1)*bad
        rows.push({stationId:i+1,date,gen:g,selfUse:g*0.7,gridFeed:g*0.3,revenue:g*0.7*0.86,priceSnap:0.86})
      }
    }
  }
  return {stations, rows, weather}
}

function report(tag: string, mode: any) {
  const {stations, rows, weather} = make(mode)
  const input = {year:2026, stations, rows, weather, gridPrice:0.391}
  const s = buildSnapshot(input as any)
  const l = buildLab(s, input as any)
  console.log(`\n########## ${tag} (weather rows=${weather.length}, reading days=${new Set(rows.map(r=>r.date)).size})`)
  console.log('quality:', JSON.stringify(s.quality))
  console.log('park:', JSON.stringify({revenue:Math.round(s.park.revenue), gap:Math.round(s.park.gap), gapKwh:Math.round(s.park.gapKwh), gapPct:s.park.gapPct, counts:s.park.counts}))
  console.log('beta.size=', s.polish.beta.size, 'alpha.size=', s.polish.alpha.size, 'health.len=', s.health.length)
  console.log('kt:', JSON.stringify({suspect:l.kt.suspect, reason:l.kt.reason, months:l.kt.byMonth.length}))
  console.log('S1:', JSON.stringify({status:s.stations[0].status, label:s.stations[0].statusLabel, days:s.stations[0].days, shape:s.stations[0].shape, situation:s.stations[0].situation, advice:s.stations[0].advice, gapMoney:Math.round(s.stations[0].gapMoney)}))
  const shapes = s.stations.map(x=>x.shape)
  console.log('shapes:', JSON.stringify(shapes))
  console.log('monthly.due-last:', s.monthly.due.slice(-1).map(Math.round), 'actual-last:', s.monthly.actual.slice(-1).map(Math.round))
}

describe('probe', () => {
  it('runs', () => {
    report('A 正常:白天13行连续', 'full')
    report('B 每天14点有洞(免费档锁正午行)', 'hole')
    report('C 每7天整日缺天气行(逐日表免费档锁1/7)', 'gap7')
    report('D 逐日源硬塞成1行/天', 'daily1h')
    report('E 完全没有天气', 'none')
  })
})

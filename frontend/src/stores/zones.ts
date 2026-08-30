import { defineStore } from 'pinia'
import { ref } from 'vue'
import { zonesApi, type ZoneDTO } from '@/api/zones'

export const useZonesStore = defineStore('zones', () => {
  const list = ref<ZoneDTO[]>([])
  let inflight: Promise<void> | null = null

  // 拉不到就留空数组 —— 各屏自己回落到「本屏已有数据里出现过的期区」,
  // 不能让整屏卡在骨架上(P1-6 那条教训:主数据没兜底,接口一挂整页停在转圈)
  async function ensure() {
    if (list.value.length) return
    inflight ??= zonesApi.list().then(z => { list.value = z }).catch(() => {}).finally(() => { inflight = null })
    return inflight
  }
  return { list, ensure }
})

// 导入结果的读法(结果弹层 ImportResultToast 与导入弹窗原地结果卡 ImportResultCard 共用一份):
// 抄表身份匹配分档、档案变化逐条的「旧 → 新 · 影响哪几个月」、提示与未导入分开。
import { ref, computed } from 'vue'
import type { ImportResultDTO, ImportChange } from '@/types/import'
import { buildingApi } from '@/api/building'
import { OWNERSHIP_LABEL } from '@/utils/meterSplit'

// 抄表导入的身份匹配分档(METER-IMPORT-SPEC §4);其余导入器无 matches 即不显示。
// 「新建」是异常放大器:重导老文件时应≈0,暴涨=身份判错。
const MATCH_LABEL: Record<string, string> = { code: '按编码命中', addr: '按位置命中', name: '按标识命中', new: '新建' }
export const FIELD_LABEL: Record<string, string> = {
  tenant: '企业名称', buildingId: '楼栋', ownership: '归属', area: '区域', spot: '位置', floorLabel: '楼层',
  side: '方位', roomNo: '房号', subName: '表名称', contractId: '钉的合同', status: '状态',
}
const STATUS_LABEL: Record<string, string> = { active: '在用', retired: '停用', removed: '已拆' }

export function useImportResult(result: ImportResultDTO) {
  // 刀G:提示(归属被钉住/位置被冻结/疑似重复)与错误分开 —— 这些行已成功导入,不能算「未导入」也不该出警告三角
  const notices = computed(() => result.notices ?? [])
  // 抄表导入的档案变化(METER-TIMELINE-SPEC §3.2):表 · 字段 · 旧 → 新 · 影响哪几个月。其余导入器不给
  const changes = computed(() => result.changes ?? [])
  // 楼栋在变化里是 id:有楼栋变化才去拉一次楼栋名(拉不到就留 id)
  const bldName = ref(new Map<string, string>())
  if (changes.value.some(c => c.field === 'buildingId'))
    buildingApi.list().then(bs => { bldName.value = new Map(bs.map(b => [String(b.id), b.name])) }).catch(() => {})
  function chgVal(c: ImportChange, v: string | null): string {
    if (v == null || v === '') return c.field === 'status' ? '不在册' : '空'
    if (c.field === 'status') return STATUS_LABEL[v] ?? v
    if (c.field === 'ownership') return OWNERSHIP_LABEL[v as keyof typeof OWNERSHIP_LABEL] ?? v
    if (c.field === 'buildingId') return bldName.value.get(v) ?? `楼栋 #${v}`
    if (c.field === 'contractId') return `合同 #${v}`
    return v
  }
  const chgSpan = (c: ImportChange) => (c.until ? `影响 ${c.from} ~ ${c.until}` : `影响 ${c.from} 起`)

  const matchStats = computed(() => {
    const ms = result.matches
    if (!ms?.length) return null
    return Object.entries(MATCH_LABEL)
      .map(([k, label]) => ({ label, n: ms.filter(m => m.matchBy === k).length, warn: k === 'new' }))
      .filter(x => x.n > 0)
  })
  return { notices, changes, chgVal, chgSpan, matchStats }
}

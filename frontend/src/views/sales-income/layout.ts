// 附表10 列版面 — 移植 _handoff/schedule10-data.js 的 OFFICE/FACTORY 分组结构。
// 原型 leaf-id → 契约 camelCase colId 已按契约映射表落定（见下注释）。
// 两版面：office（phase 1 一期 / phase 4 宿舍，25 叶子=全部 25 列并集）、factory（phase 2 二期 / phase 3 三期，20 叶子）。
// 纯 TS 常量,不引重型库。表头/单元格列序 = 各组叶子展平顺序。
import type { S10ColId } from '@/types/s10'

export interface Leaf { colId: S10ColId; label: string }
// 组:有 label 即两级表头分组（leaves 多叶子）；无 label（leaf 单列）= 跨两行的独立叶子列。
export interface Group { label?: string; elec?: boolean; water?: boolean; leaves: Leaf[] }

// office 版面（一期 / 宿舍）：含办公室列 + 保障房。
// 原型映射:officeMgmt→officeMgmtFee, factoryMgmt→factoryMgmtFee, dormFacility→dormFacilityFee,
//   shopMgmt→shopMgmtFee, elevator→elevatorMaint, transformer→transformerMaint,
//   landTax→landUseTax, network→networkFee, access→accessMaint。
const OFFICE: Group[] = [
  { label: 'A座租金', leaves: [
    { colId: 'officeRent', label: '办公室租金' },
    { colId: 'officeMgmtFee', label: '办公室企业管理服务费' },
  ] },
  { label: 'B-G座租金', leaves: [
    { colId: 'factoryRent', label: '厂房租金' },
    { colId: 'factoryMgmtFee', label: '厂房企业管理服务费' },
  ] },
  { leaves: [{ colId: 'landRent', label: '空地租金' }] },
  { label: '宿舍区租金', leaves: [
    { colId: 'shopRent', label: '商铺租金' },
    { colId: 'dormRent', label: '宿舍租金' },
    { colId: 'dormFacilityFee', label: '宿舍配套设施费' },
    { colId: 'shopMgmtFee', label: '商铺企业管理服务费' },
  ] },
  { label: '基础设施维护费', leaves: [
    { colId: 'infraOffice', label: '办公室基础设施维护费' },
    { colId: 'infraFactory', label: '厂房基础设施维护费' },
    { colId: 'infraShop', label: '商铺基础设施维护费' },
    { colId: 'infraDorm', label: '宿舍基础设施维护费' },
  ] },
  { label: '办公室、厂房费用', leaves: [
    { colId: 'elevatorMaint', label: '电梯维护费' },
    { colId: 'transformerMaint', label: '变压器维护费' },
    { colId: 'landUseTax', label: '土地使用税' },
  ] },
  { label: '宿舍费用', leaves: [
    { colId: 'networkFee', label: '网络通讯费' },
    { colId: 'accessMaint', label: '门禁设施维护费' },
  ] },
  { leaves: [{ colId: 'otherFee', label: '其他费用' }] },
  { label: 'MON电费', elec: true, leaves: [
    { colId: 'elecBasic', label: '基本用电费' },
    { colId: 'elecStd', label: '基准电费' },
    { colId: 'elecMaint', label: '电维护费' },
  ] },
  { label: 'MON水费', water: true, leaves: [
    { colId: 'waterStd', label: '基准水费' },
    { colId: 'waterMaint', label: '水维护费' },
  ] },
  { label: '保障房', leaves: [
    { colId: 'guaranteeRent', label: '一栋保障房租金' },
  ] },
]

// factory 版面（二期 / 三期）：无办公室/保障房/空地列，租金合并。
const FACTORY: Group[] = [
  { label: '租金', leaves: [
    { colId: 'factoryRent', label: '厂房租金' },
    { colId: 'factoryMgmtFee', label: '企业管理服务费' },
    { colId: 'shopRent', label: '商铺租金' },
    { colId: 'shopMgmtFee', label: '商铺企业管理服务费' },
    { colId: 'dormRent', label: '宿舍租金' },
    { colId: 'dormFacilityFee', label: '宿舍配套设施费' },
  ] },
  { label: '基础设施维护费', leaves: [
    { colId: 'infraFactory', label: '厂房基础设施维护费' },
    { colId: 'infraShop', label: '商铺基础设施维护费' },
    { colId: 'infraDorm', label: '宿舍基础设施维护费' },
  ] },
  { label: '厂房费用', leaves: [
    { colId: 'elevatorMaint', label: '电梯维护费' },
    { colId: 'transformerMaint', label: '变压器维护费' },
    { colId: 'landUseTax', label: '土地使用税、房产税' },
  ] },
  { label: '宿舍费用', leaves: [
    { colId: 'networkFee', label: '网络通讯费' },
    { colId: 'accessMaint', label: '门禁设施维护费' },
  ] },
  { leaves: [{ colId: 'otherFee', label: '其他费用' }] },
  { label: 'MON电费', elec: true, leaves: [
    { colId: 'elecBasic', label: '基本用电费' },
    { colId: 'elecStd', label: '基准电费' },
    { colId: 'elecMaint', label: '电维护费' },
  ] },
  { label: 'MON水费', water: true, leaves: [
    { colId: 'waterStd', label: '基准水费' },
    { colId: 'waterMaint', label: '水维护费' },
  ] },
]

export type LayoutId = 'office' | 'factory'
export const LAYOUTS: Record<LayoutId, Group[]> = { office: OFFICE, factory: FACTORY }

// 期 → 版面：{1:office, 2:factory, 3:factory, 4:office}
export const PHASE_LAYOUT: Record<number, LayoutId> = { 1: 'office', 2: 'factory', 3: 'factory', 4: 'office' }

export interface Phase { phase: number; name: string; short: string; layout: LayoutId }
export const PHASES: Phase[] = [
  { phase: 1, name: '一期厂房', short: '一期', layout: 'office' },
  { phase: 2, name: '二期厂房', short: '二期', layout: 'factory' },
  { phase: 3, name: '三期厂房', short: '三期', layout: 'factory' },
  { phase: 4, name: '宿舍区', short: '宿舍', layout: 'office' },
]

// 展平叶子（顺序 = 显示顺序）
export function leavesOf(layout: LayoutId): Leaf[] {
  return LAYOUTS[layout].flatMap(g => g.leaves)
}

// 新增租户抽屉的 profile 选项（office 含办公室/空地，factory 不含）
export interface ProfileOption { id: string; label: string }
export const PROFILES: Record<LayoutId, ProfileOption[]> = {
  office: [
    { id: 'office', label: '办公室' }, { id: 'factory', label: '厂房' },
    { id: 'shop', label: '商铺' }, { id: 'dorm', label: '宿舍' }, { id: 'land', label: '空地' },
  ],
  factory: [
    { id: 'factory', label: '厂房' }, { id: 'shop', label: '商铺' }, { id: 'dorm', label: '宿舍' },
  ],
}

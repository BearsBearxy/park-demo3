// Ported 1:1 from screen-ledger.jsx lgColumns(prev) — widths/labels/groups verbatim.
import type { LedgerFees } from '../types/ledger'

export type FeeKey = keyof LedgerFees
export type FixedLeftKey = 'tenantName' | 'balancePrev'
export type FixedRightKey = 'totalReceivable' | 'totalCollected' | 'balanceEnd' | 'note'
export type ColumnKey = FixedLeftKey | FeeKey | FixedRightKey

export interface LeafColumn {
  key: ColumnKey
  label: string
  w: number
  kind?: 'text' | 'num' | 'sum' | 'bal' | 'note'
}
export interface ColumnGroup {
  name: string
  cols: LeafColumn[]
}
export interface ColumnModel {
  fixedLeft: LeafColumn[]
  groups: ColumnGroup[]
  fixedRight: LeafColumn[]
}

export function lgColumns(prev: number): ColumnModel {
  return {
    fixedLeft: [
      { key: 'tenantName', label: '租户', w: 132, kind: 'text' },
      { key: 'balancePrev', label: prev + '月结余', w: 104, kind: 'num' },
    ],
    groups: [
      { name: '租金', cols: [
        { key: 'factoryRent', label: '厂房租金', w: 96 },
        { key: 'factoryMgmtFee', label: '厂房企业管理服务费', w: 130 },
        { key: 'shopRent', label: '商铺、宿舍租金', w: 112 },
        { key: 'dormRent', label: '宿舍租金', w: 88 },
        { key: 'dormFacilitiesFee', label: '宿舍配套费', w: 96 },
        { key: 'shopMgmtFee', label: '商铺企业管理服务费', w: 130 },
      ] },
      { name: '基础设施维护费', cols: [
        { key: 'factoryInfraMaint', label: '厂房基础设施维护费', w: 130 },
        { key: 'shopInfraMaint', label: '商铺、宿舍基础设施维护费', w: 152 },
        { key: 'dormInfraMaint', label: '宿舍基础设施维护费', w: 130 },
      ] },
      { name: '办公室、厂房费用', cols: [
        { key: 'elevatorMaint', label: '电梯维护费', w: 96 },
        { key: 'transformerMaint', label: '变压器维护费', w: 104 },
        { key: 'landUseTax', label: '土地使用税', w: 96 },
        { key: 'networkFee', label: '网络通讯费', w: 96 },
        { key: 'accessCtrlMaint', label: '门禁设施维护费', w: 112 },
        { key: 'officeOtherFee', label: '其他费用', w: 88 },
      ] },
      { name: '宿舍费用', cols: [
        { key: 'dormOtherFee', label: '宿舍其他费用', w: 104 },
      ] },
      { name: prev + '月电费', cols: [
        { key: 'basicElectricity', label: '基本用电费', w: 96 },
        { key: 'standardElectricity', label: '基准电费', w: 88 },
        { key: 'electricityMaint', label: '电维护费', w: 88 },
      ] },
      { name: prev + '月水费', cols: [
        { key: 'standardWater', label: '基准水费', w: 88 },
        { key: 'waterMaint', label: '水维护费', w: 88 },
      ] },
    ],
    fixedRight: [
      { key: 'totalReceivable', label: '本月应收合计', w: 116, kind: 'sum' },
      { key: 'totalCollected', label: '本月收款', w: 104, kind: 'num' },
      { key: 'balanceEnd', label: '本月结余', w: 104, kind: 'bal' },
      { key: 'note', label: '备注', w: 150, kind: 'note' },
    ],
  }
}

// 21 fee keys in column order (source: ledger-tenants-data.js FEE). Single source of truth.
export const FEE_KEYS: FeeKey[] = [
  'factoryRent', 'factoryMgmtFee', 'shopRent', 'dormRent', 'dormFacilitiesFee', 'shopMgmtFee',
  'factoryInfraMaint', 'shopInfraMaint', 'dormInfraMaint',
  'elevatorMaint', 'transformerMaint', 'landUseTax', 'networkFee', 'accessCtrlMaint', 'officeOtherFee',
  'dormOtherFee',
  'basicElectricity', 'standardElectricity', 'electricityMaint',
  'standardWater', 'waterMaint',
]

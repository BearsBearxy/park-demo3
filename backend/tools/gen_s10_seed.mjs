// gen_s10_seed.mjs — 离线确定性生成器:移植 schedule10-data.js 的 deriveCell 公式,
// 把原型 TENANTS 换成契约里的真实在租租户,输出 V18__s10_seed.sql。
// 用法: cd demo3/backend && node tools/gen_s10_seed.mjs
// 行数 = 13 真实租户 × 30 月(2024 全年 + 2025 全年 + 2026 1..6) = 390;宿舍(phase4)不插。

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'src', 'main', 'resources', 'db', 'migration', 'V18__s10_seed.sql');

// ── 25 费用列:camelCase(原型 leaf-id 映射后) -> snake_case(DB),顺序即列展示顺序 ──
// 顺序与契约 [25 费用列] 完全一致。
const COLS = [
  ['officeRent',       'office_rent'],
  ['officeMgmtFee',    'office_mgmt_fee'],
  ['factoryRent',      'factory_rent'],
  ['factoryMgmtFee',   'factory_mgmt_fee'],
  ['landRent',         'land_rent'],
  ['shopRent',         'shop_rent'],
  ['shopMgmtFee',      'shop_mgmt_fee'],
  ['dormRent',         'dorm_rent'],
  ['dormFacilityFee',  'dorm_facility_fee'],
  ['infraOffice',      'infra_office'],
  ['infraFactory',     'infra_factory'],
  ['infraShop',        'infra_shop'],
  ['infraDorm',        'infra_dorm'],
  ['elevatorMaint',    'elevator_maint'],
  ['transformerMaint', 'transformer_maint'],
  ['landUseTax',       'land_use_tax'],
  ['networkFee',       'network_fee'],
  ['accessMaint',      'access_maint'],
  ['otherFee',         'other_fee'],
  ['elecBasic',        'elec_basic'],
  ['elecStd',          'elec_std'],
  ['elecMaint',        'elec_maint'],
  ['waterStd',         'water_std'],
  ['waterMaint',       'water_maint'],
  ['guaranteeRent',    'guarantee_rent'],
];

// 原型 leaf-id -> 契约 camelCase 列(移植 OFFICE/FACTORY base 表时用)
const LEAF2CAM = {
  officeRent: 'officeRent', officeMgmt: 'officeMgmtFee',
  factoryRent: 'factoryRent', factoryMgmt: 'factoryMgmtFee',
  landRent: 'landRent', shopRent: 'shopRent', shopMgmt: 'shopMgmtFee',
  dormRent: 'dormRent', dormFacility: 'dormFacilityFee',
  infraOffice: 'infraOffice', infraFactory: 'infraFactory', infraShop: 'infraShop', infraDorm: 'infraDorm',
  elevator: 'elevatorMaint', transformer: 'transformerMaint', landTax: 'landUseTax',
  network: 'networkFee', access: 'accessMaint', otherFee: 'otherFee',
  elecBasic: 'elecBasic', elecStd: 'elecStd', elecMaint: 'elecMaint',
  waterStd: 'waterStd', waterMaint: 'waterMaint', guaranteeRent: 'guaranteeRent',
};

// ── 原型 base 表(schedule10-data.js OFFICE/FACTORY),按 leaf-id ──
const lf = (id, base) => [id, base];
const OFFICE_LEAVES = [
  lf('officeRent', 86000), lf('officeMgmt', 12900),
  lf('factoryRent', 130000), lf('factoryMgmt', 18200),
  lf('landRent', 9000),
  lf('shopRent', 14000), lf('dormRent', 12000), lf('dormFacility', 3000), lf('shopMgmt', 2200),
  lf('infraOffice', 3500), lf('infraFactory', 4200), lf('infraShop', 1800), lf('infraDorm', 2600),
  lf('elevator', 1600), lf('transformer', 2400), lf('landTax', 8000),
  lf('network', 900), lf('access', 700),
  lf('otherFee', 1500),
  lf('elecBasic', 26000), lf('elecStd', 41000), lf('elecMaint', 1200),
  lf('waterStd', 2800), lf('waterMaint', 600),
  lf('guaranteeRent', 22000),
];
const FACTORY_LEAVES = [
  lf('factoryRent', 168000), lf('factoryMgmt', 24000), lf('shopRent', 36000), lf('shopMgmt', 5400), lf('dormRent', 12600), lf('dormFacility', 3200),
  lf('infraFactory', 6800), lf('infraShop', 2100), lf('infraDorm', 2600),
  lf('elevator', 1800), lf('transformer', 2600), lf('landTax', 9000),
  lf('network', 1000), lf('access', 800),
  lf('otherFee', 1800),
  lf('elecBasic', 38000), lf('elecStd', 52000), lf('elecMaint', 1400),
  lf('waterStd', 2860), lf('waterMaint', 700),
];

// 版面 -> { leafId: base }
function baseMap(leaves) { const m = {}; for (const [id, base] of leaves) m[id] = base; return m; }
const BASE = { office: baseMap(OFFICE_LEAVES), factory: baseMap(FACTORY_LEAVES) };

// ── PROFILE 掩码(schedule10-data.js,逐版面) ── 哪些 leaf-id 有金额
const PROFILE = {
  office: {
    office:   ['officeRent','officeMgmt','infraOffice','elevator','transformer','landTax','network','otherFee','elecBasic','elecStd','elecMaint','waterStd','waterMaint'],
    factory:  ['factoryRent','factoryMgmt','infraFactory','elevator','transformer','landTax','otherFee','elecBasic','elecStd','elecMaint','waterStd','waterMaint'],
    shop:     ['shopRent','shopMgmt','infraShop','network','otherFee','elecStd','waterStd'],
    dorm:     ['dormRent','dormFacility','infraDorm','network','access','otherFee','elecBasic','waterStd','waterMaint'],
    land:     ['landRent','otherFee'],
    guarantee:['guaranteeRent'],
  },
  factory: {
    factory:  ['factoryRent','factoryMgmt','infraFactory','elevator','transformer','landTax','otherFee','elecBasic','elecStd','elecMaint','waterStd','waterMaint'],
    shop:     ['shopRent','shopMgmt','infraShop','network','otherFee','elecStd','waterStd'],
    dorm:     ['dormRent','dormFacility','infraDorm','network','access','otherFee','elecBasic','waterStd','waterMaint'],
  },
};

// 期 -> 版面(契约 [期->版面])
const PHASE_LAYOUT = { 1: 'office', 2: 'factory', 3: 'factory', 4: 'office' };

// ── 确定性派生公式(原型 hash + seedValue,逐字移植) ──
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function seedValue(phaseId, tenantSeed, leafId, year, month, base, scale) {
  const h = hash(phaseId + '|' + tenantSeed + '|' + leafId + '|' + year + '|' + month);
  const jitter = 0.86 + (h % 1000) / 1000 * 0.30;                 // 0.86 .. 1.16
  const seasonal = 1 + 0.08 * Math.sin((month - 1) / 12 * Math.PI * 2);
  const yearAdj = year === 2024 ? 0.88 : year === 2025 ? 0.95 : 1.0;
  return Math.round(base * scale * jitter * seasonal * yearAdj);
}
// 某真实租户某 leaf 的金额(profile 外 -> 0)
function deriveLeaf(phase, tenant, leafId, year, month) {
  const layout = PHASE_LAYOUT[phase];
  const active = PROFILE[layout][tenant.profile] || [];
  if (active.indexOf(leafId) < 0) return 0;
  return seedValue('p' + phase, tenant.seed, leafId, year, month, BASE[layout][leafId], tenant.scale);
}

// ── 契约真实在租租户(status=1) ── 全部 factory profile(本批均制造/电子/生物/材料/食品/五金/汽配/包装/光电/物流)
// scale: 按 id 确定性微调 0.8..1.2(id 哈希定标,稳定可复现)
function scaleFor(id) {
  const h = hash('s10-scale|' + id);
  return Math.round((0.8 + (h % 1000) / 1000 * 0.40) * 100) / 100;   // 0.80 .. 1.20
}
const RAW = [
  // phase1
  [1, '中誉机械重工', 1], [2, '锐通电子', 1], [9, '晨辉食品', 1], [10, '鑫达五金', 1], [13, '科锐传动', 1],
  // phase2
  [3, '康泽生物', 2], [4, '新元材料', 2], [7, '华瑞智能', 2], [11, '海纳汽配', 2],
  // phase3
  [5, '丰仓物流', 3], [6, '光晟光电', 3], [8, '绿能科技', 3], [12, '天盛包装', 3],
];
const TENANTS = RAW.map(([id, name, phase]) => ({
  id, name, phase,
  profile: 'factory',
  scale: scaleFor(id),
  // 原型派生以 tenant.id(字符串)入 hash;此处用真实数字 id 当种子(确定性即可)
  seed: 't' + id,
}));

// ── 月份范围:2024 全年 + 2025 全年 + 2026 1..6 ──
const MONTHS = [];
for (const y of [2024, 2025]) for (let m = 1; m <= 12; m++) MONTHS.push([y, m]);
for (let m = 1; m <= 6; m++) MONTHS.push([2026, m]);

// ── 生成 INSERT ──
const sqlCols = COLS.map(([, snake]) => snake);
const HEAD_COLS = ['tenant_id', 'tenant_name', 'phase', 'acct_month', 'profile', 'note', 'source', ...sqlCols];

const rows = [];
for (const t of TENANTS) {
  for (const [year, month] of MONTHS) {
    const acctMonth = `${year}-${String(month).padStart(2, '0')}`;
    // leaf 金额 -> camelCase -> snake 值
    const camVal = {};
    for (const leaf of (PHASE_LAYOUT[t.phase] === 'office' ? OFFICE_LEAVES : FACTORY_LEAVES)) {
      const leafId = leaf[0];
      const cam = LEAF2CAM[leafId];
      camVal[cam] = deriveLeaf(t.phase, t, leafId, year, month);
    }
    const vals = COLS.map(([cam]) => (camVal[cam] != null ? camVal[cam] : 0).toFixed(2));
    const head = [
      t.id,
      `'${t.name}'`,
      t.phase,
      `'${acctMonth}'`,
      `'${t.profile}'`,
      'NULL',
      `'seed'`,
    ];
    rows.push(`(${head.join(',')},${vals.join(',')})`);
  }
}

const header = `-- V18__s10_seed.sql — 附表10(销售收入)确定性种子,离线生成器输出(tools/gen_s10_seed.mjs)。
-- 移植 app/schedule10-data.js 的 deriveCell(hash + jitter + 季节因子 + 年因子),原型 TENANTS 换成真实在租租户。
-- 13 真实在租租户(phase1=5/phase2=4/phase3=4)× 30 月(2024 全年 + 2025 全年 + 2026 1..6)= 390 行。
-- 宿舍(phase 4)无在租租户,诚实留空不插。office 专属列(office_rent/guarantee_rent/land_rent…)对 factory profile 一律 0。
-- 派生(行合计/列合计/总计)绝不落库;tenant_id=真实 id 软引用,tenant_name=真名,source='seed'。

INSERT INTO s10_record (${HEAD_COLS.join(', ')}) VALUES
${rows.join(',\n')};
`;

writeFileSync(OUT, header, 'utf8');
console.log(`wrote ${OUT}`);
console.log(`rows = ${rows.length} (expect ${TENANTS.length} tenants × ${MONTHS.length} months = ${TENANTS.length * MONTHS.length})`);

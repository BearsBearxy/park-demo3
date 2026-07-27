-- V59: 合同性质 kind(用户拍板 2026-07-26):normal=普通租赁 | master_lease=整体承租(批发性质,
-- 与散户承租空间重叠,计入其月租金会双算 → 楼栋卡月租金/户数与合同 KPI 月租金合计均排除,合同本身照常管理)。
-- 编辑路径暂不开(PUT 不碰此列,防误抹);标记走 SQL/脚本,现仅火炬创新创业园 S10-0135 一份。
ALTER TABLE contract ADD COLUMN kind VARCHAR(16) NOT NULL DEFAULT 'normal' COMMENT '合同性质 normal|master_lease(整体承租不计KPI)';
UPDATE contract SET kind = 'master_lease' WHERE contract_no = 'S10-0135';

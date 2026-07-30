-- 刀3(用户 2026-07-30 报障):alloc_pool_result 两列只改 COMMENT 对齐语义,不改名不动数据。
-- 病灶=V64 起名照抄账册 AE「已分摊」/AF「盈亏」,实现的却是反方向:
--   账册 AE = 从『电费总表』按费目列拉回的**实收**(事后对账),AF = AE − 本组全部 AD
--   系统   = 引擎按受益人配置**正向试算**摊到户的合计;bill_notice 未落地,实收无从取得
-- 前端列头已正名为「摊出/差额」,另立「实收/盈亏」两列恒 '–' 待账单模块回填(POOL-ENGINE-SPEC §6.1)。
-- DTO 字段名保持 allocatedAmount/gapAmount(改名波及前后端与测试),语义以本注释与 spec 为准。
ALTER TABLE alloc_pool_result
  MODIFY COLUMN allocated_amount DECIMAL(14,2) NULL
    COMMENT '引擎按受益人试算摊出(非实收;账册AE=实收对账待账单模块)',
  MODIFY COLUMN gap_amount DECIMAL(14,2) NULL
    COMMENT '差额=摊出−应分摊(非账册AF盈亏)';

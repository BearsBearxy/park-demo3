-- V63__meter_contract_bind.sql — 表→合同绑定(S2-BIND-SPEC §1)。
-- 抄表数据模型不动,只加列;归属五级规则读侧派生(MeterBindingService),不建 meter_contract_bind 表
-- (ponytail: override 列够用——口径错位是表级稳定属性非月度属性;若未来需按月换绑再升级绑定表)。
-- meter_type 列已被「表类」原文占用(户内用电/公共用电…),表类型另立 device_type。
ALTER TABLE meter
  ADD COLUMN contract_id INT UNSIGNED NULL COMMENT '人工绑定覆盖:优先于自动归属规则;口径错位表指认一次持久化' AFTER tenant_id,
  ADD COLUMN device_type VARCHAR(16) NULL COMMENT '表类型:single单相|three三相|multi多功能(分时)|demand需量|bidir双向;口径2026-07-27拍板' AFTER meter_type,
  ADD CONSTRAINT fk_meter_contract FOREIGN KEY (contract_id) REFERENCES contract(id) ON DELETE SET NULL;

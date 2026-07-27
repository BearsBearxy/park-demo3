-- V57: 合同链链接类型(CONTRACT-ESCALATION-SPLIT-SPEC §1/CONTRACT-BILLING-REWORK-SPEC §1)。
-- new=链首 | renew=续签换约 | escalation=同约递增段;仅供卡片显示与留痕,账单派生一视同仁。
-- escalation 值由拆链脚本(backend/scripts/escalation-split)写入,不在迁移里拆。
ALTER TABLE contract ADD COLUMN link_type VARCHAR(12) NOT NULL DEFAULT 'new' COMMENT '相对父期链接类型 new|renew|escalation';
UPDATE contract SET link_type = 'renew' WHERE parent_contract_id IS NOT NULL;

-- Demo remarks so the contract drawer 备注 section is exercised across statuses.
-- V2 seed left all contract.remark NULL; this populates a representative few.
UPDATE contract SET remark = '标准三年租约,按季度收取租金,水电费随表计量,逾期按日加收滞纳金。'        WHERE contract_no = 'FP-2024-0001';
UPDATE contract SET remark = '租约将于2026年8月到期,已与租户沟通续签意向,待确认新租金后重签。'          WHERE contract_no = 'FP-2025-0007';
UPDATE contract SET remark = '因租户经营调整提前解约,押金已按合同条款结算退还,场地已验收交接。'        WHERE contract_no = 'FP-2023-0003';
UPDATE contract SET remark = '预留单元,等待租户确认入驻时间后正式签约,当前条款为初稿。'              WHERE contract_no = 'FP-2026-0015';

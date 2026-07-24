-- V55__contract_term_text.sql — 合同期限原文 + 分年阶梯价说明(合同导入支撑)。
-- 备份见 demo3/backup-before-v55.sql。用户点名:期限原文必须导入并可见,不允许只留解析后的起止日期。
--   term_text        期限原文(如「2023年7月14日起至2026年7月13日」),原样存原样显;
--   term_type        原文形态 explicit(明确起止) | multiple(多段) | relative(相对表述) | none(无);
--   tier_price_note  分年阶梯价说明(源文件 AH 列原文,如「第一年 X 元、第二年 Y 元」),原样留档不参与计费。
ALTER TABLE contract
  ADD COLUMN term_text       VARCHAR(255) NULL AFTER sign_date,
  ADD COLUMN term_type       VARCHAR(16)  NULL AFTER term_text,
  ADD COLUMN tier_price_note VARCHAR(500) NULL AFTER term_type;

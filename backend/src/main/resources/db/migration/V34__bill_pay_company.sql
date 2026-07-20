-- V34__bill_pay_company.sql — 收款公司指引(BILLS-SPEC §5):租户×附表10费用列 → 应转入公司。
-- 与台账记账公司、楼栋期数完全不联动:是"要求租户转到哪"的指引,不是记账事实。
-- fee_key = 附表10 colId(合法集=ReconService.RECON_FEES 的 s10Key);默认值由 V35 种子推导,之后全靠用户手改。
CREATE TABLE bill_pay_company (
  tenant_id  INT UNSIGNED NOT NULL,
  fee_key    VARCHAR(32)  NOT NULL,
  company_id INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, fee_key),
  CONSTRAINT fk_bpc_tenant  FOREIGN KEY (tenant_id)  REFERENCES tenant(id)             ON DELETE CASCADE,
  CONSTRAINT fk_bpc_company FOREIGN KEY (company_id) REFERENCES management_company(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

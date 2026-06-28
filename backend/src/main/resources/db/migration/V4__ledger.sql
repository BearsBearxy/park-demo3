CREATE TABLE management_company (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name       VARCHAR(64) NOT NULL,
  short      VARCHAR(8)  NOT NULL,
  sort_no    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id), UNIQUE KEY uk_company_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE monthly_ledger (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id   INT UNSIGNED NOT NULL,
  tenant_id    INT UNSIGNED NOT NULL,
  period_year  SMALLINT UNSIGNED NOT NULL,
  period_month TINYINT  UNSIGNED NOT NULL,
  factory_rent DECIMAL(14,2) NOT NULL DEFAULT 0, factory_mgmt_fee DECIMAL(14,2) NOT NULL DEFAULT 0,
  shop_rent DECIMAL(14,2) NOT NULL DEFAULT 0, dorm_rent DECIMAL(14,2) NOT NULL DEFAULT 0,
  dorm_facilities_fee DECIMAL(14,2) NOT NULL DEFAULT 0, shop_mgmt_fee DECIMAL(14,2) NOT NULL DEFAULT 0,
  factory_infra_maint DECIMAL(14,2) NOT NULL DEFAULT 0, shop_infra_maint DECIMAL(14,2) NOT NULL DEFAULT 0,
  dorm_infra_maint DECIMAL(14,2) NOT NULL DEFAULT 0,
  elevator_maint DECIMAL(14,2) NOT NULL DEFAULT 0, transformer_maint DECIMAL(14,2) NOT NULL DEFAULT 0,
  land_use_tax DECIMAL(14,2) NOT NULL DEFAULT 0, network_fee DECIMAL(14,2) NOT NULL DEFAULT 0,
  access_ctrl_maint DECIMAL(14,2) NOT NULL DEFAULT 0, office_other_fee DECIMAL(14,2) NOT NULL DEFAULT 0,
  dorm_other_fee DECIMAL(14,2) NOT NULL DEFAULT 0,
  basic_electricity DECIMAL(14,2) NOT NULL DEFAULT 0, standard_electricity DECIMAL(14,2) NOT NULL DEFAULT 0,
  electricity_maint DECIMAL(14,2) NOT NULL DEFAULT 0,
  standard_water DECIMAL(14,2) NOT NULL DEFAULT 0, water_maint DECIMAL(14,2) NOT NULL DEFAULT 0,
  balance_prev    DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_collected DECIMAL(14,2) NOT NULL DEFAULT 0,
  note            VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_ledger (company_id, period_year, period_month, tenant_id),
  KEY idx_ledger_cym (company_id, period_year, period_month),
  CONSTRAINT fk_ledger_company FOREIGN KEY (company_id) REFERENCES management_company(id),
  CONSTRAINT fk_ledger_tenant  FOREIGN KEY (tenant_id)  REFERENCES tenant(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

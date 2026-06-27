CREATE TABLE tenant_category (
  id   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(32) NOT NULL,
  PRIMARY KEY (id), UNIQUE KEY uk_tc_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE building (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name          VARCHAR(64) NOT NULL,
  phase         TINYINT UNSIGNED NOT NULL,
  floor_count   TINYINT UNSIGNED NOT NULL,
  total_area    DECIMAL(10,2) NOT NULL,
  rentable_area DECIMAL(10,2) NOT NULL,
  status        TINYINT UNSIGNED NOT NULL DEFAULT 1,
  per_floor     TINYINT UNSIGNED NOT NULL DEFAULT 0,
  remark        VARCHAR(255) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id), UNIQUE KEY uk_building_name (name),
  KEY idx_building_phase (phase), KEY idx_building_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE unit (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  building_id INT UNSIGNED NOT NULL,
  floor       TINYINT UNSIGNED NOT NULL,
  unit_no     VARCHAR(16) NOT NULL,
  area        DECIMAL(10,2) NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id), UNIQUE KEY uk_unit (building_id, unit_no),
  KEY idx_unit_bf (building_id, floor),
  CONSTRAINT fk_unit_building FOREIGN KEY (building_id) REFERENCES building(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE tenant (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_name  VARCHAR(128) NOT NULL,
  contact_name  VARCHAR(32) NULL,
  contact_phone VARCHAR(32) NULL,
  business_type VARCHAR(32) NOT NULL,
  status        TINYINT UNSIGNED NOT NULL DEFAULT 1,
  category_id   INT UNSIGNED NULL,
  phase         TINYINT UNSIGNED NULL,
  since         CHAR(7) NULL,
  remark        VARCHAR(255) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_tenant_status (status), KEY idx_tenant_cat (category_id),
  KEY idx_tenant_biz (business_type), KEY idx_tenant_name (company_name),
  CONSTRAINT fk_tenant_cat FOREIGN KEY (category_id) REFERENCES tenant_category(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE contract (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  contract_no  VARCHAR(32) NOT NULL,
  tenant_id    INT UNSIGNED NOT NULL,
  building_id  INT UNSIGNED NOT NULL,
  unit_id      INT UNSIGNED NULL,
  rent_area    DECIMAL(10,2) NOT NULL DEFAULT 0,
  monthly_rent DECIMAL(12,2) NOT NULL DEFAULT 0,
  deposit      DECIMAL(12,2) NOT NULL DEFAULT 0,
  start_date   DATE NULL,
  end_date     DATE NULL,
  sign_date    DATE NULL,
  status       VARCHAR(16) NOT NULL,
  remark       VARCHAR(255) NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id), UNIQUE KEY uk_contract_no (contract_no),
  KEY idx_ct_tenant (tenant_id), KEY idx_ct_building (building_id),
  KEY idx_ct_unit (unit_id), KEY idx_ct_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE auth_user (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username      VARCHAR(64) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name  VARCHAR(64) NOT NULL,
  status        TINYINT UNSIGNED NOT NULL DEFAULT 1,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id), UNIQUE KEY uk_user_name (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

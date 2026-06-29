CREATE TABLE elec_phase (
  id        VARCHAR(4)  NOT NULL,            -- p1 / p2 / p3
  name      VARCHAR(48) NOT NULL,
  short     VARCHAR(8)  NOT NULL,            -- 2 字简称
  sort_no   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 两类条目共一张表,用 type 区分(energy 电量电费/进项 · basic 基本电费)
-- 派生 amount/basicFee/tax/total 绝不落库,service 读时算
CREATE TABLE elec_record (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  type       VARCHAR(8)  NOT NULL,           -- energy / basic
  phase_id   VARCHAR(4)  NOT NULL,
  acct_month VARCHAR(7)  NOT NULL,           -- YYYY-MM 记账月
  inv_date   VARCHAR(10) NULL,               -- YYYY-MM-DD 开票日期
  period     VARCHAR(3)  NULL,               -- 峰/平/谷(仅 energy)
  cat        VARCHAR(16) NULL,               -- 用电类别(仅 energy)
  unit       VARCHAR(8)  NULL,               -- 单位(仅 energy)
  qty        DECIMAL(14,2) NULL,             -- 电量 kWh(仅 energy)
  demand     DECIMAL(14,2) NULL,            -- 计费需量 kVA(仅 basic)
  price      DECIMAL(14,6) NOT NULL DEFAULT 0,   -- 不含税单价
  rate       DECIMAL(6,4)  NOT NULL DEFAULT 0,   -- 税率
  note       VARCHAR(255) NULL,
  source     VARCHAR(8)  NOT NULL DEFAULT 'manual',  -- seed / manual
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_elec_acct (acct_month),
  KEY idx_elec_phase (phase_id),
  KEY idx_elec_type (type),
  CONSTRAINT fk_elec_phase FOREIGN KEY (phase_id) REFERENCES elec_phase(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

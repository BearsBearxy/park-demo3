CREATE TABLE pv_phase (
  id         VARCHAR(4)  NOT NULL,            -- p1 / p2 / p3
  name       VARCHAR(48) NOT NULL,
  short      VARCHAR(8)  NOT NULL,            -- 2 字简称
  online     VARCHAR(7)  NULL,               -- YYYY-MM 并网月
  cost       DECIMAL(16,2) NOT NULL DEFAULT 0,   -- 一次性工程成本(供 P3 光伏投资回收;本页不显)
  capacity   DECIMAL(12,6) NOT NULL DEFAULT 0,   -- 装机容量 MW(供 P3)
  cap_note   VARCHAR(32) NULL,
  sort_no    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE pv_record (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  phase_id    VARCHAR(4)  NOT NULL,
  acct_month  VARCHAR(7)  NOT NULL,           -- YYYY-MM 记账月
  occur_month VARCHAR(7)  NOT NULL,           -- YYYY-MM 发生月
  self_kwh    DECIMAL(14,2) NOT NULL DEFAULT 0,   -- 自消纳电量
  self_amt    DECIMAL(14,2) NOT NULL DEFAULT 0,   -- 自消纳金额
  grid_kwh    DECIMAL(14,2) NOT NULL DEFAULT 0,   -- 上网电量
  grid_amt    DECIMAL(14,2) NOT NULL DEFAULT 0,   -- 上网收益
  note        VARCHAR(255) NULL,
  source      VARCHAR(8)  NOT NULL DEFAULT 'manual',  -- seed / manual
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pv_acct (acct_month),
  KEY idx_pv_phase (phase_id),
  CONSTRAINT fk_pv_phase FOREIGN KEY (phase_id) REFERENCES pv_phase(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 附表7(汽车充电桩) / 附表8(电动车充电桩):同一模型两实例,schedule_no 7/8 区分。
-- 一条 = 充电桩类别(cat) × 记账月(acct_month) → kwh/fee/cost/note;利润 profit = fee - cost(派生,不落库)。

CREATE TABLE charging_cat (
  schedule_no TINYINT UNSIGNED NOT NULL,        -- 7 汽车 / 8 电动车
  cat_id      VARCHAR(16) NOT NULL,             -- dc/ac/shed/smart
  name        VARCHAR(32) NOT NULL,
  short       VARCHAR(12) NOT NULL,
  tint        VARCHAR(12) NULL,                 -- slate/blue/cyan 期色点
  sort_no     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (schedule_no, cat_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE charging_record (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  schedule_no TINYINT UNSIGNED NOT NULL,        -- 7 / 8
  cat         VARCHAR(16) NOT NULL,             -- 充电桩类别 id
  acct_month  VARCHAR(7)  NOT NULL,             -- YYYY-MM 记账月
  kwh         DECIMAL(14,2) NOT NULL DEFAULT 0, -- 充电电量(千瓦时)
  fee         DECIMAL(14,2) NOT NULL DEFAULT 0, -- 手续费及服务费金额(元)
  cost        DECIMAL(14,2) NOT NULL DEFAULT 0, -- 充电成本金额(元)
  note        VARCHAR(255) NULL,
  source      VARCHAR(8)  NOT NULL DEFAULT 'manual',  -- seed / manual
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_charging_sched_acct (schedule_no, acct_month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

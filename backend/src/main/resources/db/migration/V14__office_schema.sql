-- 附表13(办公水电) / 附表14(三期水电):同一模型两实例,schedule_no 13/14 区分。
-- 一条 = 记账月(acct_month)的逐月水电:用电量/单价、用水量/单价、备注。
-- 派生(不落库):电费金额=elec_qty×elec_price; 水费金额=water_qty×water_price; 水电费合计=两者和。

CREATE TABLE office_record (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  schedule_no  TINYINT UNSIGNED NOT NULL,         -- 13 办公水电 / 14 三期水电
  acct_month   VARCHAR(7)  NOT NULL,              -- YYYY-MM 记账月
  belong_month VARCHAR(7)  NOT NULL,              -- YYYY-MM 所属月
  elec_qty     DECIMAL(14,2) NOT NULL DEFAULT 0,  -- 用电量(千瓦)
  elec_price   DECIMAL(14,6) NOT NULL DEFAULT 0,  -- 基准用电单价(元/千瓦)
  water_qty    DECIMAL(14,2) NOT NULL DEFAULT 0,  -- 用水量(吨)
  water_price  DECIMAL(14,6) NOT NULL DEFAULT 0,  -- 基准用水单价(元/吨)
  note         VARCHAR(255) NULL,
  source       VARCHAR(8)  NOT NULL DEFAULT 'manual',  -- seed / manual
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_office_sched_acct (schedule_no, acct_month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

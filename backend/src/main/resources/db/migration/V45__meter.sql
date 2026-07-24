-- V45__meter.sql — 园区抄表(METER-SPEC §1):表档案 + 月度读数。P-A 刀,只做档案与读数;分摊/损耗/账单是 P-B/P-C。
-- 无种子:档案由首次导入真实抄表 Excel 建档(约 1100 块),uk(kind,zone,name) 幂等 upsert。
CREATE TABLE meter (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  kind        VARCHAR(8)  NOT NULL,                  -- elec / water
  zone        VARCHAR(8)  NOT NULL,                  -- p1(一期) / p2(二期) / dorm(宿舍)
  name        VARCHAR(64) NOT NULL,                  -- 首列标识名(如 一车间总电),同区同类唯一
  area        VARCHAR(64)  NULL,                     -- 区域(A座/一车间…)
  spot        VARCHAR(64)  NULL,                     -- 位置(负一层/一楼商铺…)
  tenant_name VARCHAR(64)  NULL,                     -- 企业名称原样;租户档案匹配是 P-B/P-C,不建 FK
  meter_type  VARCHAR(32)  NULL,                     -- 表类原样(总电表/公共用电/已分摊/户内用电…)
  sub_name    VARCHAR(32)  NULL,                     -- 电表①/低区总水表…
  code        VARCHAR(32)  NULL,                     -- 表编码
  factor      DECIMAL(10,2) NOT NULL DEFAULT 1,      -- 倍率:表面走 1 度实算 N 度
  sort_no     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_meter (kind, zone, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 读数:uk(meter_id, ym) 一表一月一条,重复导入先删后插幂等覆盖。
-- 用量=(curr−prev)×factor_snap 派生不落库;factor_snap 录入时快照表倍率,改倍率不回溯(同 pv_reading.price_snap 口径)。
-- 读数列全 NULL:水表只有 total,公共电表常只有 total;缺本月读数=漏抄(前端标黄),不是错误行。
CREATE TABLE meter_reading (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  meter_id     INT UNSIGNED NOT NULL,
  ym           CHAR(7)      NOT NULL,                -- YYYY-MM
  prev_total   DECIMAL(14,2) NULL,
  curr_total   DECIMAL(14,2) NULL,
  prev_sharp   DECIMAL(14,2) NULL,                   -- 尖
  prev_peak    DECIMAL(14,2) NULL,                   -- 峰
  prev_flat    DECIMAL(14,2) NULL,                   -- 平
  prev_valley  DECIMAL(14,2) NULL,                   -- 谷
  curr_sharp   DECIMAL(14,2) NULL,
  curr_peak    DECIMAL(14,2) NULL,
  curr_flat    DECIMAL(14,2) NULL,
  curr_valley  DECIMAL(14,2) NULL,
  factor_snap  DECIMAL(10,2) NOT NULL DEFAULT 1,
  note         VARCHAR(255) NULL,
  source       VARCHAR(12)  NOT NULL DEFAULT 'manual',  -- manual / import
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_meter_reading (meter_id, ym),
  KEY idx_meter_reading_ym (ym),
  CONSTRAINT fk_meter_reading_meter FOREIGN KEY (meter_id) REFERENCES meter(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

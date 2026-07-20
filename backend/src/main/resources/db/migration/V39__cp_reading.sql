-- V39__cp_reading.sql — 分桩充电记录(CP-METER-SPEC §1)。按日期记条自动汇月:月份 = read_date 派生(YYYY-MM),不另存字段。
-- uk(station_id, read_date):同桩同日一条;重复导入幂等 upsert。三金额全手填(从平台对账单抄,无 price_snap 概念)。
-- FK 不级联删记录:删桩由服务层 409 守卫(有充电记录的桩不可删)。
CREATE TABLE cp_reading (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  station_id  INT UNSIGNED NOT NULL,
  read_date   DATE         NOT NULL,                  -- 记录日期
  charge_kwh  DECIMAL(12,2) NOT NULL DEFAULT 0,       -- 充电量 kWh
  fee         DECIMAL(12,2) NOT NULL DEFAULT 0,       -- 手续费 元
  revenue     DECIMAL(12,2) NOT NULL DEFAULT 0,       -- 收益 元
  note        VARCHAR(255) NULL,
  source      VARCHAR(8)   NOT NULL DEFAULT 'manual', -- manual / import
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_cp_reading (station_id, read_date),
  KEY idx_cp_reading_date (read_date),
  CONSTRAINT fk_cp_reading_station FOREIGN KEY (station_id) REFERENCES cp_station(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

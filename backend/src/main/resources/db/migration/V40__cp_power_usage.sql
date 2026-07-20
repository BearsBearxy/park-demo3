-- V40__cp_power_usage.sql — 充电桩电表用电量(CP-METER-SPEC §1)。运营商×类型×月一条,period 取每月1日。
-- 用电损耗 = meter_kwh − Σ该运营商该类型桩当月充电量:读时派生不落库;为负(电表<充电量)前端黄警示不阻断。
CREATE TABLE cp_power_usage (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  operator     VARCHAR(32)  NOT NULL,                 -- 运营商(与 cp_station.operator 文本对应)
  vehicle_type VARCHAR(8)   NOT NULL,                 -- car / ebike
  period       DATE         NOT NULL,                 -- 月份(取每月1日)
  meter_kwh    DECIMAL(12,2) NOT NULL DEFAULT 0,      -- 电表用电量 kWh
  note         VARCHAR(255) NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_cp_power_usage (operator, vehicle_type, period)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

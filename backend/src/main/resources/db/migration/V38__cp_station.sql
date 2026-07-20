-- V38__cp_station.sql — 充电桩(站)主数据 + 3 桩种子(CP-METER-SPEC §1)。纯新增,不改附表7/8 charging_*(月度汇总原样)。
-- operator 运营商自由文本(万城万/小桔/…);vehicle_type car=汽车(附表7屏)/ebike=电动车(附表8屏),共享桩库各屏按类型过滤。
CREATE TABLE cp_station (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name         VARCHAR(48)  NOT NULL,                 -- 桩名,唯一
  operator     VARCHAR(32)  NOT NULL,                 -- 运营商(自由文本)
  vehicle_type VARCHAR(8)   NOT NULL,                 -- car / ebike
  sort_no      SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_cp_station_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 种子 3 桩(用户确认):小桔→快充1/慢充1(car);万城万种一个同名桩占位(ebike)。归属如与实际不符用户在编辑模式改。
INSERT INTO cp_station (name, operator, vehicle_type, sort_no) VALUES
  ('快充1',  '小桔',   'car',    1),
  ('慢充1',  '小桔',   'car',    2),
  ('万城万', '万城万', 'ebike', 11);

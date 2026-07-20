-- V36__pv_station.sql — 光伏电站(楼栋)主数据 + 13 站种子(PV-METER-SPEC §1)。纯新增,不改现有 pv_phase/pv_record(附表6 原样)。
-- capacity_kwp / price_yuan 站级配置,相对固定可行内调整;价格调整只影响之后新录的抄表记录(price_snap 快照,见 V37)。
CREATE TABLE pv_station (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name         VARCHAR(48)  NOT NULL,                 -- 电站名(楼栋),唯一
  phase        TINYINT      NOT NULL,                 -- 期数 1/2/3
  capacity_kwp DECIMAL(10,2) NULL,                    -- 装机容量 kWp(可空,后补)
  price_yuan   DECIMAL(8,4)  NULL,                    -- 消纳综合单价 元/kWh(可空,后补)
  sort_no      SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_pv_station_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 种子 13 站(思维导图定;C、D座算一个站)。容量/单价留空由用户界面补录。
INSERT INTO pv_station (name, phase, sort_no) VALUES
  ('B座',     1,  1),
  ('C、D座',  1,  2),
  ('E座',     1,  3),
  ('F座',     1,  4),
  ('G座',     1,  5),
  ('8栋',     2, 11),
  ('9栋',     2, 12),
  ('10栋',    2, 13),
  ('11栋',    2, 14),
  ('12栋',    2, 15),
  ('13栋',    2, 16),
  ('创业大厦', 3, 21),
  ('工业大厦', 3, 22);

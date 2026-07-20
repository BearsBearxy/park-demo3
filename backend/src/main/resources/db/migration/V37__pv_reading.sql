-- V37__pv_reading.sql — 分栋抄表记录(PV-METER-SPEC §1)。按日期记条自动汇月:发电月份 = read_date 派生(YYYY-MM),不另存字段。
-- uk(station_id, read_date):同站同日一条——日抄天然唯一,月抄用当月任意日期;重复导入幂等 upsert。
-- price_snap:录入/导入时快照当时站单价;收益 = self_use × price_snap。之后调站单价只影响新记录,历史收益不漂移。
-- FK 不级联删记录:删站由服务层 409 守卫(有抄表记录的站不可删)。
CREATE TABLE pv_reading (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  station_id  INT UNSIGNED NOT NULL,
  read_date   DATE         NOT NULL,                  -- 抄表日期
  gen_total   DECIMAL(12,2) NOT NULL DEFAULT 0,       -- 发电总量 kWh
  self_use    DECIMAL(12,2) NOT NULL DEFAULT 0,       -- 自消纳电量 kWh
  grid_feed   DECIMAL(12,2) NOT NULL DEFAULT 0,       -- 上网电量 kWh
  price_snap  DECIMAL(8,4)  NULL,                     -- 单价快照 元/kWh(录入时站单价;站未配价则 NULL,收益按 0)
  note        VARCHAR(255) NULL,
  source      VARCHAR(8)   NOT NULL DEFAULT 'manual', -- manual / import
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_pv_reading (station_id, read_date),
  KEY idx_pv_reading_date (read_date),
  CONSTRAINT fk_pv_reading_station FOREIGN KEY (station_id) REFERENCES pv_station(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- V121__pv_station_panel.sql — 组件台账两列(PV-ANALYSIS-SPEC §02/§03.5)。
-- 理论装机 kWp = panel_count × panel_watt ÷ 1000,是**唯一不从发电量倒推**的容量口径。
-- 没有它,效率 = 发电 ÷ 倒推容量 按构造趋近常数(实测 13 站极差仅 2.2%),横比整个是假的。
-- 一栋一个 panel_watt:分布式屋顶一个屋面一种型号是常态,分期扩建才混装。
-- 混装的栋填主力规格 —— 它会在台账体检上超 ±3% 线显示成偏离,那正是要人去看的信号,
-- 不是要建模的复杂度。真出现三栋以上混装再开子表。
-- 版本号从 V121 起,越过 V117/V119/V120 —— **实测踩出来的**:
-- 被删掉的天气迁移(V117 weather_hour / V119 weather_switch_params)在 dev 库里**已经应用过**,
-- 删文件不会删 flyway_schema_history 里的行。复用 V119 会直接报
--   Detected applied migration not resolved locally: 117
--   Migration checksum mismatch for migration version 119
-- 号只许往后取:一个号一旦在任何库里被应用过,它就永远不能再指别的东西。
-- 已跑过天气迁移的库另需一次性清理,见 PV-ANALYSIS-SPEC §02。
ALTER TABLE pv_station
  ADD COLUMN panel_count INT UNSIGNED NULL COMMENT '光伏板数量(块);空=未录' AFTER capacity_kwp,
  ADD COLUMN panel_watt  DECIMAL(7,1) NULL COMMENT '单块标称功率 W(出厂铭牌);空=未录' AFTER panel_count;

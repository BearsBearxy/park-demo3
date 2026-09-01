-- V119__pv_station_panel.sql — 组件台账两列(PV-ANALYSIS-SPEC §02/§03.5)。
-- 理论装机 kWp = panel_count × panel_watt ÷ 1000,是**唯一不从发电量倒推**的容量口径。
-- 没有它,效率 = 发电 ÷ 倒推容量 按构造趋近常数(实测 13 站极差仅 2.2%),横比整个是假的。
-- 一栋一个 panel_watt:分布式屋顶一个屋面一种型号是常态,分期扩建才混装。
-- 混装的栋填主力规格 —— 它会在台账体检上超 ±3% 线显示成偏离,那正是要人去看的信号,
-- 不是要建模的复杂度。真出现三栋以上混装再开子表。
-- 版本号接在 V118(metered)之后:V117 是删掉的天气表留下的空号,Flyway 不要求连号,
-- 而 V118 可能已经在某个库里跑过 —— 改它的号会让那个库既找不到 V118 又重跑 V117。
ALTER TABLE pv_station
  ADD COLUMN panel_count INT UNSIGNED NULL COMMENT '光伏板数量(块);空=未录' AFTER capacity_kwp,
  ADD COLUMN panel_watt  DECIMAL(7,1) NULL COMMENT '单块标称功率 W(出厂铭牌);空=未录' AFTER panel_count;

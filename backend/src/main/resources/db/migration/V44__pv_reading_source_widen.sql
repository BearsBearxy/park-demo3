-- V44__pv_reading_source_widen.sql — pv_reading.source 扩宽:模拟填充(PV-METER simulate)要写 'simulated'(9 字符),
-- 原 VARCHAR(8) 放不下。口径对齐 cp_reading(V43)/elec_cost_entry(V42):manual / import / simulated。
ALTER TABLE pv_reading MODIFY source VARCHAR(12) NOT NULL DEFAULT 'manual';

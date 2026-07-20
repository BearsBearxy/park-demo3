-- V43__cp_reading_source_widen.sql — cp_reading.source 扩宽:模拟填充(CP-METER simulate)要写 'simulated'(9 字符),
-- 原 VARCHAR(8) 放不下。口径对齐 elec_cost_entry.source(V42):manual / import / simulated。
ALTER TABLE cp_reading MODIFY source VARCHAR(12) NOT NULL DEFAULT 'manual';

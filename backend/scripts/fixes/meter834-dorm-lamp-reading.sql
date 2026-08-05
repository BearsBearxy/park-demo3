-- meter834-dorm-lamp-reading.sql — 宿舍路灯总表 2024-02 读数修正。2026-08-05(S4-3 第二轮 D① 根因)。
-- 证据:一期2024年2月水电费.xlsx!宿舍电 M336 行「宿舍路灯」93758→93996(238度);
--      库内 reading 10556 prev=curr=5695.86 与源册完全无关(导入身份/量程错挂,IMPORT-IDENTITY 族已知形态)。
-- 后果:rule 90 宿舍区·路灯池少 238 度 → std 0.05,而源册 ROUND(860.93×1.13156875/15510,2)=0.06;
--      修后重新生成 2024-02 核算,std 自动回 0.06。
-- 表档案 ownership='tenant'(佳亿兴)存疑属另刀(dorm-room-backfill.sql 待核③),本脚本只修读数。
UPDATE meter_reading
SET prev_total = 93758.00, curr_total = 93996.00,
    note = '2024-02读数修正:源册宿舍电M336(93758→93996,238度);原值5695.86错挂(S4-3二轮)'
WHERE id = 10556 AND meter_id = 834 AND ym = '2024-02'
  AND prev_total = 5695.86 AND curr_total = 5695.86;

-- 验证:预期 1 行 238.00
SELECT id, curr_total - prev_total AS qty_expect_238 FROM meter_reading WHERE id = 10556;

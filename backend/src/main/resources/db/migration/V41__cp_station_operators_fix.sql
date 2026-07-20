-- 电动车充电桩运营商修正(2026-07-18 用户澄清):电动车(ebike)运营商=叮叮充、电信;
-- V38 误将万城万种为 ebike——万城万实为汽车(car)侧运营商(与小桔并列),就地改型保留。
UPDATE cp_station SET vehicle_type = 'car', sort_no = 3 WHERE name = '万城万' AND vehicle_type = 'ebike';
INSERT INTO cp_station (name, operator, vehicle_type, sort_no) VALUES
  ('叮叮充', '叮叮充', 'ebike', 11),
  ('电信',   '电信',   'ebike', 12);

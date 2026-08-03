-- 邱彩云东侧公共电(meter 1139, suspect=shadow)清除(2026-08-04 用户要求删除)
-- 背景:零读数、零快照残留,但作为池 61「一期 D座·一楼东侧·公共用电」唯一成员被 fk_arm_meter 挡删,
--      前端按钮文案"有读数不可删"误导用户以为"一直显示有读数"。
-- 池 61 保留(版本簿种子池),成员清空;真表出现后人工绑定即可。
DELETE FROM alloc_rule_meter WHERE meter_id = 1139;
DELETE FROM meter WHERE id = 1139;

-- 核对:两条都应为 0;池 61 仍在
SELECT (SELECT COUNT(*) FROM meter WHERE id = 1139) AS meter_left,
       (SELECT COUNT(*) FROM alloc_rule_meter WHERE meter_id = 1139) AS bind_left,
       (SELECT COUNT(*) FROM alloc_rule WHERE id = 61) AS rule61_alive;

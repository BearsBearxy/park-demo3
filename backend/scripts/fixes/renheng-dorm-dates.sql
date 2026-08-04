-- 仁恒 S10-0062(宿舍新俊楼一座503/409室)补录(2026-08-04,依据=2024年03月租金物业通知单+门禁年费窗口):
-- ①起始日按门禁维护费年费窗口回填 2023-12-06(503室先入住;409室2024-02-01加入,行级差异记 remark);
--   终点纸面未见,保持 NULL 待财务——绑定侧走 date_missing 一键确认(规则4修订后本栋候选已浮出)。
-- ②503室单元漏挂:contract_unit 只有409,补挂 unit 477(宿舍一栋 5F-503)。
-- 注:费项明细与通知单逐格全等(合计1850.21锚),不动;门禁费实为年缴100/间(通知单月列8.33、应收0),备注留口径。
UPDATE contract SET start_date='2023-12-06',
  remark='宿舍新俊楼一座503+409室;起始按门禁年费窗口回填(503室2023-12-06先入住,409室2024-02-01加入);租赁期限终点纸面未见待财务;门禁费年缴100/间(通知单月列8.33应收0)'
WHERE id=62;

INSERT INTO contract_unit (contract_id, unit_id)
SELECT 62, 477 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM contract_unit WHERE contract_id=62 AND unit_id=477);

-- 核对
SELECT id, contract_no, start_date, end_date, remark FROM contract WHERE id=62;
SELECT cu.contract_id, u.floor, u.unit_no FROM contract_unit cu JOIN unit u ON u.id=cu.unit_id WHERE cu.contract_id=62;

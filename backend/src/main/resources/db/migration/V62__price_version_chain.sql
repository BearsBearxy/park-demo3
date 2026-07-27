-- V62: 价目版本链(PRICE-CFG-SPEC §3 v2) + 删除月推键(用户拍板 2026-07-27)
-- acct_month 语义升级为「版本生效起点」(''=初始版本):常数键沿版本链前滚(<=ym 最大者),
-- 月变键(电价6键)仅命中当月版本;updated_at=版本时间戳;历史账期取价不受后续改价扰动。
-- 语义变更不动表结构。月推输出键(公摊单价)彻底移出价目簿(公式见 POOL-FORMULA-AUDIT-2024-02.md):
DELETE FROM tenant_price_cfg
WHERE cfg_key IN ('green_water', 'green_water_hi', 'lamp_sqm', 'fire_sqm', 'elevator_sqm');

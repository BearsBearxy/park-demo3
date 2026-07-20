-- V33__contract_area_rentfree.sql — 合同面积模型 + 免租期（F1/F2）。纯新增列，存量一律留空不推测（不用租金反推污染主数据）。
-- building_area = 建筑面积（㎡）；既有 rent_area 语义明确为租赁面积（计租面积）。
-- unit_price    = 租金单价（元/㎡/月）。
-- rent_free     = 免租期 JSON 数组 [{"start":"2026-01-01","end":"2026-02-15","note":"装修期"}]，
--                 写入口由 ContractService 校验（合法数组 / start,end 为 ISO 日期且 start≤end / ≤24 段）。
-- ponytail: rent_free 用 JSON 列而非子表——纯展示用途；若日后免租参与应收计算再升子表。
ALTER TABLE contract
  ADD COLUMN building_area DECIMAL(12,2) NULL,
  ADD COLUMN unit_price    DECIMAL(10,2) NULL,
  ADD COLUMN rent_free     TEXT NULL;

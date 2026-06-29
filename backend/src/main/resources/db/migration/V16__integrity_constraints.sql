-- 补齐数据完整性约束（审查发现：contract 缺外键、平行子系统缺业务唯一键）。
-- 仅追加约束，不改既有列；种子数据已核验无违反（pv/charging/office 业务键唯一、合同引用闭合）。
-- elec/salary 未在此加唯一键：elec 的 basic 行 period 为 NULL、salary 缺稳定员工标识，
-- 需配套 schema 改造后再加，另行评估。

-- ① contract 外键（与 unit/tenant/monthly_ledger 风格一致，杜绝悬挂引用）
ALTER TABLE contract
  ADD CONSTRAINT fk_ct_tenant   FOREIGN KEY (tenant_id)   REFERENCES tenant(id),
  ADD CONSTRAINT fk_ct_building FOREIGN KEY (building_id) REFERENCES building(id),
  ADD CONSTRAINT fk_ct_unit     FOREIGN KEY (unit_id)     REFERENCES unit(id) ON DELETE SET NULL;

-- ② pv_record 业务唯一键：同相同记账月同发生月不可重复（防重复导入双计）
ALTER TABLE pv_record
  ADD CONSTRAINT uk_pv UNIQUE (phase_id, acct_month, occur_month);

-- ③ charging_record 业务唯一键 + 类别外键（父表 charging_cat 已有复合主键 (schedule_no, cat_id)）
ALTER TABLE charging_record
  ADD CONSTRAINT uk_charging UNIQUE (schedule_no, cat, acct_month),
  ADD CONSTRAINT fk_charging_cat FOREIGN KEY (schedule_no, cat) REFERENCES charging_cat(schedule_no, cat_id);

-- ④ office_record 业务唯一键：每附表每记账月一条（防重复导入双计水电费）
ALTER TABLE office_record
  ADD CONSTRAINT uk_office UNIQUE (schedule_no, acct_month);

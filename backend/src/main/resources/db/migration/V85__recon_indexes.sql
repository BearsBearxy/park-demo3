-- 审计4(2026-08-01):跨公司按期取数(收入核对/账单页)此前全表扫——
-- monthly_ledger 现有 uk/idx 均 company_id 打头,s10_record 均 phase 打头,单按期查询无可用索引。
ALTER TABLE monthly_ledger ADD KEY idx_ledger_ym (period_year, period_month);
ALTER TABLE s10_record ADD KEY idx_s10_month (acct_month);

-- 台账软引用化:导入不再强制命中租户档案(与 s10_record 同款语义)。
-- tenant_name = 账面名快照(导入原文/手工改名),tenant_id = 绑定的档案(可空=未绑定)。
-- uk_ledger(company,year,month,tenant_id) 对 NULL 不去重 —— 未绑定行的去重由
-- LedgerService.importRows 按账面名 upsert 兜住(代码级约束,DB 无法表达"同名未绑定唯一")。
ALTER TABLE monthly_ledger
  MODIFY tenant_id INT UNSIGNED NULL,
  ADD COLUMN tenant_name VARCHAR(64) NULL AFTER tenant_id;

-- 存量行回填账面名 = 当时档案名(此前 tenant_id 全部非空,逐行可解析)
UPDATE monthly_ledger ml JOIN tenant t ON t.id = ml.tenant_id
SET ml.tenant_name = t.company_name;

-- 附表10 软引用回填(口径重构 P1 项):账面名与档案名"全库唯一精确相等"的行补 tenant_id。
-- 同名多档不动(留人工绑定);别名命中留给导入/绑定端点(SQL 不解析别名)。
UPDATE s10_record sr
  JOIN (SELECT company_name, MIN(id) AS tid, COUNT(*) AS c
        FROM tenant GROUP BY company_name) t
    ON t.company_name = sr.tenant_name AND t.c = 1
SET sr.tenant_id = t.tid
WHERE sr.tenant_id IS NULL;

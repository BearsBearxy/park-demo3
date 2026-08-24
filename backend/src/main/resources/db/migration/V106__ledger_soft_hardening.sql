-- 评审修正(2026-08-23 V105 复审两刀):
-- ① 快照列宽对齐档案名:tenant.company_name 是 VARCHAR(128),V105 的 64 会在长档案名
--    回填/导入时 Data too long 整事务回滚(当前库最长 55 字符,先于撞线修)。
ALTER TABLE monthly_ledger MODIFY tenant_name VARCHAR(128) NULL;

-- ② 「同月同名未绑定行唯一」上 DB 闸:uk_ledger 对 NULL tenant_id 不去重,V105 只靠
--    请求内内存 map 兜住,并发重导/双击导入会插出同名双行、金额翻倍。MySQL 8.0.13+
--    函数索引可以表达这条不变量:绑定行走 t:tenant_id(与 uk_ledger 重叠,无害),
--    未绑定行走 n:账面名 —— 第二个并发事务在此撞 DuplicateKey,全局异常映射为 409。
ALTER TABLE monthly_ledger ADD UNIQUE KEY uk_ledger_soft
  (company_id, period_year, period_month,
   ((CASE WHEN tenant_id IS NULL THEN CONCAT('n:', tenant_name)
          ELSE CONCAT('t:', tenant_id) END)));

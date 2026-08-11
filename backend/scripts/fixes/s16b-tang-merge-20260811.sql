-- ════════════════════════════════════════════════════════════════════════════
-- S16-b 汤周杰双档并档:274「汤周杰（星耀）」→ 131「汤周杰」(用户拍板走别名机制,2026-08-11)
--
-- 形态与张执盛(390→博浩162)同款(s10-tenant-data-20260809.sql §2 先例):
--   131 持合同64+电表3块+水表3块+催缴单;274 无合同无表,只有 21 行台账实收
--   (2024-10 起,2024-02 台账未导入)+ 15 行收款公司映射(全 company 2,131 侧为 0 无冲突)。
--   台账导入三主径含 aliases 匹配(V86)——别名落档后,2024 台账补导自动归 131。
-- 执行: mysql --default-character-set=utf8mb4;前置 mysqldump 备份(规程)。
-- ════════════════════════════════════════════════════════════════════════════
SET NAMES utf8mb4;

-- §0 前置断言(与预期不符即停)
SELECT '断言01 双档现状' AS chk, id, company_name, aliases, status FROM tenant WHERE id IN (131,274);
SELECT '断言02 274挂靠(期望 ledger=21, paymap=15, 其余全0)' AS chk,
  (SELECT COUNT(*) FROM monthly_ledger    WHERE tenant_id=274) AS ledger,
  (SELECT COUNT(*) FROM bill_pay_company  WHERE tenant_id=274) AS paymap,
  (SELECT COUNT(*) FROM contract          WHERE tenant_id=274) AS contracts,
  (SELECT COUNT(*) FROM meter             WHERE tenant_id=274) AS meters,
  (SELECT COUNT(*) FROM bill_notice       WHERE tenant_id=274) AS notices,
  (SELECT COUNT(*) FROM alloc_rule_member WHERE tenant_id=274) AS members,
  (SELECT COUNT(*) FROM s10_record        WHERE tenant_id=274) AS s10,
  (SELECT COUNT(*) FROM tenant            WHERE parent_id=274) AS children,
  (SELECT COUNT(*) FROM tenant_price_cfg  WHERE scope='tenant:274') AS cfg;
SELECT '断言03 131收款映射为空(期望0,否则§2停手逐键并)' AS chk,
  COUNT(*) AS cnt FROM bill_pay_company WHERE tenant_id=131;

-- §1 别名落档(全角+半角括号双变体;台账导入三主径匹配用)
UPDATE tenant SET aliases = TRIM(BOTH ',' FROM CONCAT(COALESCE(aliases,''),
       CASE WHEN aliases IS NULL OR aliases='' THEN '' ELSE ',' END,
       '汤周杰（星耀）,汤周杰(星耀)'))
  WHERE id=131 AND (aliases IS NULL OR aliases NOT LIKE '%星耀%');

-- §2 挂靠平移(paymap 无 PK 冲突已核;其余为防御性,实测 0 行)
UPDATE monthly_ledger    SET tenant_id=131 WHERE tenant_id=274;   -- 21 行
UPDATE bill_pay_company  SET tenant_id=131 WHERE tenant_id=274;   -- 15 行
UPDATE s10_record        SET tenant_id=131 WHERE tenant_id=274;   -- 0 行防御
UPDATE alloc_rule_member SET tenant_id=131 WHERE tenant_id=274;   -- 0 行防御
UPDATE tenant            SET parent_id=131 WHERE parent_id=274;   -- 0 行防御
DELETE FROM tenant_price_cfg WHERE scope='tenant:274';            -- 0 行防御
DELETE FROM bill_notice      WHERE tenant_id=274;                 -- 0 行防御(行 FK CASCADE)

-- §3 删伪档(守卫:三大挂靠必须已清)
DELETE FROM tenant WHERE id=274
  AND NOT EXISTS(SELECT 1 FROM contract        WHERE tenant_id=274)
  AND NOT EXISTS(SELECT 1 FROM meter           WHERE tenant_id=274)
  AND NOT EXISTS(SELECT 1 FROM monthly_ledger  WHERE tenant_id=274);

-- §4 验证
SELECT '验证01 131终态(期望 ledger=21, paymap=15, aliases含星耀)' AS chk,
  (SELECT COUNT(*) FROM monthly_ledger   WHERE tenant_id=131) AS ledger,
  (SELECT COUNT(*) FROM bill_pay_company WHERE tenant_id=131) AS paymap,
  (SELECT aliases FROM tenant WHERE id=131) AS aliases;
SELECT '验证02 274已删(期望0)' AS chk, COUNT(*) AS cnt FROM tenant WHERE id=274;

-- ═══ 递增段拆链 · APPLY(CONTRACT-ESCALATION-SPLIT-SPEC §2.5)═══
-- 前置: plan.sql 已跑且人审通过;apply 前先 mysqldump 全量备份。
-- 单事务;二次运行会撞 uk_contract_no 自动回滚(天然幂等门)。
-- 顺序敏感: A 造祖先行 → B 串父指针 → C 复制计费行(读原行「缩放前」的值) → D/E 最后才改原行(头行)。
START TRANSACTION;

-- A. 造祖先行(档 1..n-1):复制原行全部字段;标量缩放(unit_price 恒缩,mgmt/infra 仅 rmi 口径)
INSERT INTO contract (contract_no, tenant_id, building_id, unit_id, rent_area, monthly_rent, deposit,
  building_area, unit_price, rent_free, mgmt_fee_price, infra_fee_price, elevator_count, elevator_floors,
  elevator_fee, transformer_fee, power_type, kva, fee_src, start_date, end_date, sign_date,
  term_text, term_type, tier_price_note, status, parent_contract_id, link_type, remark, created_at, updated_at)
SELECT CONCAT(c.contract_no,'#',p.lvl), c.tenant_id, c.building_id, c.unit_id, c.rent_area,
  ROUND(c.monthly_rent*p.ratio,2), c.deposit,
  c.building_area,
  IF(c.unit_price IS NULL, NULL, ROUND(c.unit_price*p.ratio,4)),
  c.rent_free,
  IF(p.scope='rmi' AND c.mgmt_fee_price IS NOT NULL, ROUND(c.mgmt_fee_price*p.ratio,4), c.mgmt_fee_price),
  IF(p.scope='rmi' AND c.infra_fee_price IS NOT NULL, ROUND(c.infra_fee_price*p.ratio,4), c.infra_fee_price),
  c.elevator_count, c.elevator_floors, c.elevator_fee, c.transformer_fee, c.power_type, c.kva, c.fee_src,
  p.cs, p.ce, c.sign_date, c.term_text, c.term_type, c.tier_price_note,
  'renewed', NULL, IF(p.lvl=1,'new','escalation'), c.remark, NOW(), NOW()
FROM esc_plan p JOIN contract c ON c.id=p.contract_id
WHERE p.lvl < p.n_lvl;

-- B. 串父指针:档i.parent=档(i-1)(档1 保持 NULL=新链首)
UPDATE contract a
JOIN esc_plan p ON a.contract_no=CONCAT(p.contract_no,'#',p.lvl) AND p.lvl>1 AND p.lvl<p.n_lvl
JOIN contract prev ON prev.contract_no=CONCAT(p.contract_no,'#',p.lvl-1)
SET a.parent_contract_id=prev.id;

-- C. 祖先行计费行:逐行复制原行(此刻仍是锚档值),口径行缩放;source='manual'(不被导入覆盖律清除)
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode,
  unit_price, area, coeff, room_count, amount_override, seq, tax_rate, params, note, source)
SELECT a.id, b.location, b.property_type, b.fee_key, b.fee_name, b.bill_mode,
  IF(b.fee_key LIKE 'rent%' OR (p.scope='rmi' AND b.fee_key IN ('mgmt','infra')),
     ROUND(b.unit_price*p.ratio,4), b.unit_price),
  b.area, b.coeff, b.room_count,
  IF((b.fee_key LIKE 'rent%' OR (p.scope='rmi' AND b.fee_key IN ('mgmt','infra'))) AND b.amount_override IS NOT NULL,
     ROUND(b.amount_override*p.ratio,2), b.amount_override),
  b.seq, b.tax_rate, b.params, b.note, 'manual'
FROM esc_plan p
JOIN contract a ON a.contract_no=CONCAT(p.contract_no,'#',p.lvl)
JOIN contract_billing_term b ON b.contract_id=p.contract_id
WHERE p.lvl < p.n_lvl;

-- D. 原行(头行=末档):起点改末档、挂到档(n-1)、标 escalation、标量按 ma_末/ma_锚 缩放(锚=末档时 ratio=1 恒等)
UPDATE contract c
JOIN esc_plan p ON p.contract_id=c.id AND p.is_head
JOIN contract prev ON prev.contract_no=CONCAT(p.contract_no,'#',p.n_lvl-1)
SET c.start_date=p.cs,
    c.parent_contract_id=prev.id,
    c.link_type='escalation',
    c.monthly_rent=ROUND(c.monthly_rent*p.ratio,2),
    c.unit_price=IF(c.unit_price IS NULL, NULL, ROUND(c.unit_price*p.ratio,4)),
    c.mgmt_fee_price=IF(p.scope='rmi' AND c.mgmt_fee_price IS NOT NULL, ROUND(c.mgmt_fee_price*p.ratio,4), c.mgmt_fee_price),
    c.infra_fee_price=IF(p.scope='rmi' AND c.infra_fee_price IS NOT NULL, ROUND(c.infra_fee_price*p.ratio,4), c.infra_fee_price);

-- E. 原行计费行缩放(必须在 C 之后)
UPDATE contract_billing_term b
JOIN esc_plan p ON p.contract_id=b.contract_id AND p.is_head
SET b.unit_price = IF(b.fee_key LIKE 'rent%' OR (p.scope='rmi' AND b.fee_key IN ('mgmt','infra')),
                      ROUND(b.unit_price*p.ratio,4), b.unit_price),
    b.amount_override = IF((b.fee_key LIKE 'rent%' OR (p.scope='rmi' AND b.fee_key IN ('mgmt','infra')))
                           AND b.amount_override IS NOT NULL,
                           ROUND(b.amount_override*p.ratio,2), b.amount_override);

COMMIT;

SELECT '== apply 完成 ==' info;
SELECT (SELECT COUNT(*) FROM contract WHERE contract_no LIKE '%#%') created_rows,
       (SELECT SUM(lvl<n_lvl) FROM esc_plan) planned_rows;

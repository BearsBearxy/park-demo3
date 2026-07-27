-- ═══ 递增段拆链 · VERIFY(CONTRACT-ESCALATION-SPLIT-SPEC §2.6)═══
-- 只读。所有「应为空」的结果集非空 = 验收失败,按 backup 回滚排查。

SELECT '① 新增行数 = 计划数(应相等)' info;
SELECT (SELECT COUNT(*) FROM contract WHERE contract_no LIKE '%#%') created_rows,
       (SELECT SUM(lvl<n_lvl) FROM esc_plan) planned_rows;

SELECT '② 段分区:相邻段缝隙非 1..3 天 或 首末不贴合同期(应为空)' info;
SELECT p.contract_no, p.lvl, a.start_date, a.end_date, nxt.start_date next_start,
       DATEDIFF(nxt.start_date, a.end_date) gap_days
FROM esc_plan p
JOIN contract a  ON a.contract_no = IF(p.lvl=p.n_lvl, p.contract_no, CONCAT(p.contract_no,'#',p.lvl))
LEFT JOIN esc_plan p2 ON p2.contract_id=p.contract_id AND p2.lvl=p.lvl+1
LEFT JOIN contract nxt ON nxt.contract_no = IF(p2.lvl=p2.n_lvl, p2.contract_no, CONCAT(p2.contract_no,'#',p2.lvl))
WHERE (p2.lvl IS NOT NULL AND DATEDIFF(nxt.start_date, a.end_date) NOT BETWEEN 0 AND 3)
   OR (a.start_date <> p.cs) OR (a.end_date <> p.ce);

SELECT '③ 父指针链:档i.parent ≠ 档(i-1).id(应为空)' info;
SELECT p.contract_no, p.lvl
FROM esc_plan p
JOIN contract a ON a.contract_no = IF(p.lvl=p.n_lvl, p.contract_no, CONCAT(p.contract_no,'#',p.lvl))
LEFT JOIN contract prev ON prev.contract_no = CONCAT(p.contract_no,'#',p.lvl-1)
WHERE (p.lvl=1 AND a.parent_contract_id IS NOT NULL)
   OR (p.lvl>1 AND (prev.id IS NULL OR a.parent_contract_id <> prev.id));

SELECT '④ 每段计费行数 = 原行数(应为空)' info;
SELECT p.contract_no, p.lvl, cnt.n, head_cnt.n head_n
FROM esc_plan p
JOIN contract a ON a.contract_no = CONCAT(p.contract_no,'#',p.lvl) AND p.lvl<p.n_lvl
JOIN (SELECT contract_id, COUNT(*) n FROM contract_billing_term GROUP BY contract_id) cnt ON cnt.contract_id=a.id
JOIN (SELECT contract_id, COUNT(*) n FROM contract_billing_term GROUP BY contract_id) head_cnt ON head_cnt.contract_id=p.contract_id
WHERE cnt.n <> head_cnt.n;

DROP TABLE IF EXISTS esc_seg_sum;
CREATE TABLE esc_seg_sum AS
SELECT b.contract_id,
  SUM(IF(b.fee_key LIKE 'rent%', m.monthly, 0)) s_rent,
  SUM(IF(b.fee_key LIKE 'rent%' OR b.fee_key IN ('mgmt','infra'), m.monthly, 0)) s_rmi
FROM contract_billing_term b
JOIN (SELECT id, CASE bill_mode
        WHEN 'per_sqm_month' THEN ROUND(area*unit_price*COALESCE(coeff,1),2)
        WHEN 'per_room_year' THEN ROUND(unit_price*room_count/12,2)
        WHEN 'per_room_month' THEN ROUND(unit_price*room_count,2)
        WHEN 'per_kva_month' THEN NULL
        ELSE amount_override END monthly FROM contract_billing_term) m ON m.id=b.id
GROUP BY b.contract_id;

SELECT '⑤ 金额:每段口径合计 vs 预期(锚档原合计×ratio),偏差>1 元(应为空)' info;
SELECT p.contract_no, p.lvl, p.scope,
  ROUND(IF(p.scope='rmi', ss.s_rmi, ss.s_rent),2) actual,
  ROUND(IF(p.scope='rmi', ls.sum_rmi, ls.sum_rent) * p.ratio,2) expect
FROM esc_plan p
JOIN contract a ON a.contract_no = IF(p.lvl=p.n_lvl, p.contract_no, CONCAT(p.contract_no,'#',p.lvl))
JOIN esc_seg_sum ss ON ss.contract_id=a.id
JOIN esc_line_sum ls ON ls.contract_id=p.contract_id
WHERE ABS(IF(p.scope='rmi', ss.s_rmi, ss.s_rent)
        - IF(p.scope='rmi', ls.sum_rmi, ls.sum_rent) * p.ratio) > 1;

SELECT '⑥ 对档参考:每段口径合计 vs 档月额 相对差(δ 均匀保留,应≈锚定偏差,仅留档)' info;
SELECT p.scope, COUNT(*) n,
  ROUND(MAX(ABS(IF(p.scope='rmi', ss.s_rmi, ss.s_rent) - p.ma)/p.ma),4) max_rel
FROM esc_plan p
JOIN contract a ON a.contract_no = IF(p.lvl=p.n_lvl, p.contract_no, CONCAT(p.contract_no,'#',p.lvl))
JOIN esc_seg_sum ss ON ss.contract_id=a.id
GROUP BY p.scope;

SELECT '⑦ 链完整:escalation/新链首行必须可归属计划(应为空)' info;
SELECT c.id, c.contract_no FROM contract c
WHERE (c.link_type='escalation' OR c.contract_no LIKE '%#%')
  AND NOT EXISTS (SELECT 1 FROM esc_plan p
    WHERE c.contract_no = p.contract_no OR c.contract_no = CONCAT(p.contract_no,'#',p.lvl));

SELECT '⑧ KPI 对照(留档):月租金合计 前/后(差=41 户末档放大,属修正)' info;
SELECT (SELECT sum_monthly FROM esc_kpi_before) kpi_before,
       (SELECT SUM(monthly_rent) FROM contract WHERE status='active' AND end_date IS NOT NULL) kpi_after;

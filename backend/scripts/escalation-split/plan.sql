-- ═══ 递增段拆链 · PLAN(CONTRACT-ESCALATION-SPLIT-SPEC §2)═══
-- 只读推导,产出 esc_* 计划表(留库供 apply/verify 消费)。不写任何业务表。
-- 跑法: docker exec -i demo3-mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" park_demo3' < plan.sql
-- 前置: V57 已迁移(link_type 列)。幂等: 已有 escalation 段或 #后缀行的合同不进计划。
DROP TABLE IF EXISTS esc_line_sum, esc_lvl0, esc_lvl, esc_chk, esc_anchor, esc_plan, esc_manual, esc_kpi_before;

-- 每合同计费行月合计(镜像 lineMonthly §1.1;per_kva_month 不计入两口径)
CREATE TABLE esc_line_sum AS
SELECT b.contract_id,
  SUM(CASE WHEN b.fee_key LIKE 'rent%' THEN m.monthly ELSE 0 END) sum_rent,
  SUM(CASE WHEN b.fee_key LIKE 'rent%' OR b.fee_key IN ('mgmt','infra') THEN m.monthly ELSE 0 END) sum_rmi
FROM contract_billing_term b
JOIN (SELECT id, CASE bill_mode
        WHEN 'per_sqm_month' THEN ROUND(area*unit_price*COALESCE(coeff,1),2)
        WHEN 'per_room_year' THEN ROUND(unit_price*room_count/12,2)
        WHEN 'per_room_month' THEN ROUND(unit_price*room_count,2)
        WHEN 'per_kva_month' THEN NULL
        ELSE amount_override END monthly
      FROM contract_billing_term) m ON m.id=b.id
GROUP BY b.contract_id;

-- 期内档:裁剪到合同期,同(cs,ce)平行行合并;幂等门=排除已拆过的合同
CREATE TABLE esc_lvl0 AS
SELECT t.contract_id,
  GREATEST(t.start_date, c.start_date) cs,
  LEAST(t.end_date, c.end_date) ce,
  c.end_date c_end, c.start_date c_start,
  SUM(t.monthly_amount) ma,
  SUM(t.monthly_amount IS NULL) n_null_ma,
  COUNT(*) nrows,
  GROUP_CONCAT(t.seq ORDER BY t.seq) seqs
FROM contract_rent_tier t JOIN contract c ON c.id=t.contract_id
WHERE t.start_date IS NOT NULL AND t.end_date IS NOT NULL
  AND t.start_date<=c.end_date AND t.end_date>=c.start_date
  AND c.link_type <> 'escalation'
  AND NOT EXISTS (SELECT 1 FROM contract e WHERE e.contract_no LIKE CONCAT(c.contract_no,'#%'))
GROUP BY t.contract_id, cs, ce, c.end_date, c.start_date;

-- 全平行(所有档 ce=合同end,如双单元并行排程) → 合并为单档
CREATE TABLE esc_lvl AS
SELECT contract_id, MIN(cs) cs, ce, c_end, c_start,
       SUM(ma) ma, SUM(n_null_ma) n_null_ma, SUM(nrows) nrows, GROUP_CONCAT(seqs) seqs
FROM esc_lvl0 x
WHERE (SELECT COUNT(DISTINCT ce) FROM esc_lvl0 y WHERE y.contract_id=x.contract_id)=1 AND ce=c_end
GROUP BY contract_id, ce, c_end, c_start
UNION ALL
SELECT contract_id, cs, ce, c_end, c_start, ma, n_null_ma, nrows, seqs
FROM esc_lvl0 x
WHERE NOT ((SELECT COUNT(DISTINCT ce) FROM esc_lvl0 y WHERE y.contract_id=x.contract_id)=1 AND ce=c_end);

-- 分区校验:首/末档贴合合同期(≤1天)、相邻缝隙 0..2 天
CREATE TABLE esc_chk AS
SELECT l.contract_id,
  COUNT(*) n_lvl,
  SUM(l.n_null_ma>0 OR l.ma IS NULL) n_bad_ma,
  MAX(ABS(DATEDIFF(first_cs, c_start))) start_gap,
  MAX(ABS(DATEDIFF(last_ce, c_end))) end_gap,
  MAX(seam_bad) seam_bad
FROM (
  SELECT contract_id, cs, ce, c_start, c_end, ma, n_null_ma,
    MIN(cs) OVER (PARTITION BY contract_id) first_cs,
    MAX(ce) OVER (PARTITION BY contract_id) last_ce,
    CASE WHEN LAG(ce) OVER (PARTITION BY contract_id ORDER BY cs) IS NULL THEN 0
         WHEN DATEDIFF(cs, LAG(ce) OVER (PARTITION BY contract_id ORDER BY cs)) BETWEEN 0 AND 2 THEN 0
         ELSE 1 END seam_bad
  FROM esc_lvl) l
JOIN contract c ON c.id=l.contract_id
GROUP BY l.contract_id;

-- 锚定(§2.4):best≤1% 直接锚;或 ≤5% 且与同口径次近档差≥4pp
CREATE TABLE esc_anchor AS
SELECT contract_id, scope, anchor_cs, anchor_ma, rel, rel2,
  (rel<=0.01 OR (rel<=0.05 AND rel2-rel>=0.04)) ok
FROM (
  SELECT contract_id, scope, cs anchor_cs, ma anchor_ma, rel,
    LEAD(rel) OVER (PARTITION BY contract_id, scope ORDER BY rel) rel2,
    ROW_NUMBER() OVER (PARTITION BY contract_id ORDER BY rel, scope='rent') rn
  FROM (
    SELECT l.contract_id, s.scope, l.cs, l.ma,
      ABS(CASE s.scope WHEN 'rmi' THEN ls.sum_rmi ELSE ls.sum_rent END - l.ma)/l.ma rel
    FROM esc_lvl l
    JOIN esc_line_sum ls ON ls.contract_id=l.contract_id
    JOIN (SELECT 'rmi' scope UNION ALL SELECT 'rent') s
    WHERE l.ma IS NOT NULL AND l.ma>0
  ) r
) x WHERE rn=1;

-- 人工清单
CREATE TABLE esc_manual AS
SELECT c.id contract_id, c.contract_no,
  CASE WHEN EXISTS (SELECT 1 FROM contract_rent_tier t WHERE t.contract_id=c.id AND t.start_date IS NOT NULL)
       THEN 'tiers-outside-period' ELSE 'no-dated-tier' END reason,
  NULL detail
FROM contract c
WHERE EXISTS (SELECT 1 FROM contract_rent_tier t WHERE t.contract_id=c.id)
  AND c.link_type <> 'escalation'
  AND NOT EXISTS (SELECT 1 FROM contract e WHERE e.contract_no LIKE CONCAT(c.contract_no,'#%'))
  AND NOT EXISTS (SELECT 1 FROM esc_lvl l WHERE l.contract_id=c.id)
UNION ALL
SELECT k.contract_id, c.contract_no, 'missing-ma', CONCAT(k.n_bad_ma,' 档缺月额')
FROM esc_chk k JOIN contract c ON c.id=k.contract_id WHERE k.n_lvl>=2 AND k.n_bad_ma>0
UNION ALL
SELECT k.contract_id, c.contract_no, 'bad-partition',
  CONCAT('start_gap=',k.start_gap,' end_gap=',k.end_gap,' seam_bad=',k.seam_bad)
FROM esc_chk k JOIN contract c ON c.id=k.contract_id
WHERE k.n_lvl>=2 AND k.n_bad_ma=0 AND (k.start_gap>1 OR k.end_gap>1 OR k.seam_bad=1)
UNION ALL
SELECT k.contract_id, c.contract_no, 'no-anchor',
  CONCAT('best=',COALESCE(ROUND(a.rel,4),-1),' rel2=',COALESCE(ROUND(a.rel2,4),-1),' scope=',COALESCE(a.scope,'?'))
FROM esc_chk k JOIN contract c ON c.id=k.contract_id
LEFT JOIN esc_anchor a ON a.contract_id=k.contract_id
WHERE k.n_lvl>=2 AND k.n_bad_ma=0 AND k.start_gap<=1 AND k.end_gap<=1 AND k.seam_bad=0
  AND (a.ok IS NULL OR NOT a.ok)
UNION ALL
-- 审查修正①:rent 口径锚定是数字巧合(档注记显示 mgmt/infra 实随档递增,如 S10-0056 note 基础设施费也 ×1.1),
-- 一刀切缩放会把 head 的 mgmt/infra 冻旧价 → 只信 rmi 口径,rent 锚改人工按 note 核构成
SELECT a.contract_id, c.contract_no, 'rent-scope-needs-review',
  CONCAT('rel=',ROUND(a.rel,4),' 档构成需按 tier note 人工核对 mgmt/infra 是否随档递增')
FROM esc_anchor a JOIN esc_chk k ON k.contract_id=a.contract_id JOIN contract c ON c.id=a.contract_id
WHERE a.ok AND a.scope='rent'
  AND k.n_lvl>=2 AND k.n_bad_ma=0 AND k.start_gap<=1 AND k.end_gap<=1 AND k.seam_bad=0
UNION ALL
-- 审查修正②:消化桶前提=期外档已被续签子期消化;子期若 0 计费行则档价仅存阶梯表(如 C2024M-020 的 2587.20),
-- DROP 表前必须人工把档价补成该子期计费行
SELECT c.id, c.contract_no, 'child-no-billing',
  GROUP_CONCAT(DISTINCT CONCAT('子期 ', ch.contract_no, ' 无计费行,档价仅存阶梯表') SEPARATOR '; ')
FROM contract c
JOIN contract ch ON ch.parent_contract_id=c.id
JOIN contract_rent_tier t ON t.contract_id=c.id AND t.start_date IS NOT NULL AND t.end_date IS NOT NULL
  AND t.start_date<=ch.end_date AND t.end_date>=ch.start_date
  AND (t.start_date>c.end_date OR t.end_date<c.start_date)
WHERE NOT EXISTS (SELECT 1 FROM contract_billing_term b WHERE b.contract_id=ch.id)
GROUP BY c.id, c.contract_no;

-- 自动拆计划
CREATE TABLE esc_plan AS
SELECT l.contract_id, c.contract_no,
  ROW_NUMBER() OVER (PARTITION BY l.contract_id ORDER BY l.cs) lvl,
  COUNT(*) OVER (PARTITION BY l.contract_id) n_lvl,
  l.cs, l.ce, l.ma,
  a.scope, a.anchor_ma,
  l.ma / a.anchor_ma ratio,
  (ROW_NUMBER() OVER (PARTITION BY l.contract_id ORDER BY l.cs)
    = COUNT(*) OVER (PARTITION BY l.contract_id)) is_head,
  (l.cs = a.anchor_cs) is_anchor
FROM esc_lvl l
JOIN esc_chk k ON k.contract_id=l.contract_id
JOIN esc_anchor a ON a.contract_id=l.contract_id AND a.ok AND a.scope='rmi'   -- 审查修正①:仅 rmi 口径可自动拆
JOIN contract c ON c.id=l.contract_id
WHERE k.n_lvl>=2 AND k.n_bad_ma=0 AND k.start_gap<=1 AND k.end_gap<=1 AND k.seam_bad=0
  AND NOT EXISTS (SELECT 1 FROM esc_manual m WHERE m.contract_id=l.contract_id);

-- KPI 前照(verify 对照用):active/expiring 月租金合计
CREATE TABLE esc_kpi_before AS
SELECT COUNT(*) n_contracts, SUM(monthly_rent) sum_monthly
FROM contract WHERE status='active' AND end_date IS NOT NULL;

-- ── 汇总输出(人审) ──
SELECT '== 自动拆:合同数/新增行数 ==' info;
SELECT COUNT(DISTINCT contract_id) auto_contracts, SUM(lvl<n_lvl) new_rows FROM esc_plan;
SELECT '== ratio/锚点位置(rmin,rmax 应在[0.5,1.6];wild 应=0) ==' info;
SELECT MIN(ratio) rmin, MAX(ratio) rmax,
  SUM(is_head AND is_anchor) head_is_anchor, SUM(is_head AND NOT is_anchor) head_scaled,
  SUM(ratio>1.6 OR ratio<0.5) ratio_wild FROM esc_plan;
SELECT '== 不变量:每合同恰 1 head 1 anchor(应为空) ==' info;
SELECT contract_id FROM esc_plan GROUP BY contract_id HAVING SUM(is_head)<>1 OR SUM(is_anchor)<>1;
SELECT '== 人工清单 ==' info;
SELECT * FROM esc_manual ORDER BY reason, contract_id;
SELECT '== 期内单档(消化,无动作) ==' info;
SELECT k.contract_id, c.contract_no FROM esc_chk k JOIN contract c ON c.id=k.contract_id
WHERE k.n_lvl=1 AND NOT EXISTS (SELECT 1 FROM esc_manual m WHERE m.contract_id=k.contract_id) ORDER BY 1;
SELECT '== 计划明细(留档 tsv) ==' info;
SELECT contract_id, contract_no, lvl, n_lvl, cs, ce, ma, scope, ROUND(ratio,6) ratio, is_head, is_anchor
FROM esc_plan ORDER BY contract_id, lvl;

-- V64__pool_engine.sql — 池核算引擎(POOL-ENGINE-SPEC §2):扩展 V47 alloc 族,不建平行 pool_* 族。
-- 缺口四项:池间折入链 / 表构成正负号 / 每池 ROUND 位数 / 池级+损耗结果落库。DDL 按 spec §2 原文。

ALTER TABLE alloc_rule
  ADD COLUMN round_scale TINYINT NOT NULL DEFAULT 2 COMMENT '分摊标准ROUND位数(2或3)',
  ADD COLUMN std_kind VARCHAR(20) NULL COMMENT '分摊标准算式:NULL=按zone默认(p2=amount_over_base,p1/dorm=qty_price_over_base);qty_over_base=广告字档(度数/面积,量纲混用复刻)',
  ADD COLUMN base_key VARCHAR(32) NULL COMMENT '分摊基数取自价目簿键(area_base/lamp_area_base/elevator_area_base...),NULL=用coefficient',
  MODIFY COLUMN method VARCHAR(10) NOT NULL COMMENT 'direct/area/floor/loss/none(不分摊,全额挂亏)/ref(纯标准行:只出std不出应分摊,如广联分摊V64,不入合计)';

ALTER TABLE alloc_rule_meter
  ADD COLUMN sign TINYINT NOT NULL DEFAULT 1 COMMENT '+1计入/-1从池剔除(广告字分表/火炬园/招商子表)';

ALTER TABLE alloc_cfg MODIFY COLUMN cfg_value DECIMAL(14,8) COMMENT '价格类参数需8位小数(1.13156875)';

CREATE TABLE alloc_rule_link (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  src_rule_id INT UNSIGNED NOT NULL,
  dst_rule_id INT UNSIGNED NOT NULL,
  link_type VARCHAR(12) NOT NULL COMMENT 'fold_price=src池分摊标准叠加进dst池标准(V46=0.01+V113);fold_qty=src池净度数计入dst池度数(招商净电→园区损耗公摊池)',
  UNIQUE KEY uk_link (src_rule_id, dst_rule_id, link_type),
  CONSTRAINT fk_link_src FOREIGN KEY (src_rule_id) REFERENCES alloc_rule(id) ON DELETE CASCADE,
  CONSTRAINT fk_link_dst FOREIGN KEY (dst_rule_id) REFERENCES alloc_rule(id) ON DELETE CASCADE
) COMMENT='池间折入链,引擎按拓扑序计算,禁环';

CREATE TABLE alloc_pool_result (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ym CHAR(7) NOT NULL,
  rule_id INT UNSIGNED NOT NULL,
  qty_total DECIMAL(14,2) NULL, qty_sharp DECIMAL(14,2) NULL, qty_peak DECIMAL(14,2) NULL,
  qty_flat DECIMAL(14,2) NULL, qty_valley DECIMAL(14,2) NULL,
  extra_qty_snap DECIMAL(14,2) NULL COMMENT '当月加度/扣度(进标准分子不进应分摊)',
  cost_amount DECIMAL(14,2) NULL COMMENT '应分摊(W/AD)',
  base_snap DECIMAL(14,2) NULL COMMENT '分摊基数快照(层数T/面积AA)',
  std_value DECIMAL(14,8) NULL COMMENT '分摊标准(V/AC:元每层/元每平米/整额)',
  fold_add DECIMAL(14,8) NULL COMMENT '折入叠加档(0.005/0.007),std_value已含',
  price_snap DECIMAL(14,8) NULL COMMENT 'p1/dorm合成单价;p2分时NULL',
  allocated_amount DECIMAL(14,2) NULL COMMENT '已分摊,B2回填',
  gap_amount DECIMAL(14,2) NULL COMMENT '盈亏,B2回填',
  warn VARCHAR(255) NULL COMMENT '缺读数/断链等行级警告',
  generated_at DATETIME NOT NULL,
  UNIQUE KEY uk_pool_result (ym, rule_id),
  CONSTRAINT fk_pr_rule FOREIGN KEY (rule_id) REFERENCES alloc_rule(id)
) COMMENT='池核算快照,账单依据,重导读数不漂移';

CREATE TABLE alloc_loss_result (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ym CHAR(7) NOT NULL,
  zone VARCHAR(8) NOT NULL,
  head_building_id INT NOT NULL COMMENT '组头楼栋(共享总表组=供电栋)',
  c_qty DECIMAL(14,2) NULL COMMENT '总表用电量',
  cable_qty DECIMAL(14,2) NULL COMMENT '铝缆用电量(仅陈列)',
  d_qty DECIMAL(14,2) NULL COMMENT '分表用电量Σ',
  e_qty DECIMAL(14,2) NULL COMMENT '损耗量=D-C',
  raw_rate DECIMAL(10,6) NULL COMMENT '原损耗率=E/C',
  g_qty DECIMAL(14,2) NULL COMMENT '公摊分摊度数(一期:园区公共池/6+g_adj;二期NULL)',
  adj_qty DECIMAL(14,2) NULL COMMENT '调整度数(二期H列)',
  adj_rate DECIMAL(10,6) NULL COMMENT '调整损耗加点(一期H/二期I)',
  variant VARCHAR(12) NOT NULL COMMENT 'net=净额式/share_only=纯公摊式/none=不核算(G座)',
  tenant_rate DECIMAL(10,6) NULL COMMENT '收取租户损耗率(I/J列)',
  generated_at DATETIME NOT NULL,
  UNIQUE KEY uk_loss_result (ym, head_building_id)
) COMMENT='楼栋损耗快照;对账区(总电表vs合计)读时派生不落库';

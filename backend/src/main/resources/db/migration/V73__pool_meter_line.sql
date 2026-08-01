-- V73__pool_meter_line.sql — 逐表行(刀C)+ 冲减载体(火炬园拍板)。
-- 用户 2026-07-30 报障:「公共电核算的天面还是想要一行一行的派生而不是汇总成一个」。
-- 原册「公共电分摊明细」是一表一行(A座天面四部梯各有 151.3/298.82/225.28/335.78),
-- 系统把 26 块天面表合成 15 个池后逐表金额无处可查。本迁移把逐表明细做成快照的一部分,
-- 与池行同批生成、同批删除,重导读数不漂移(与 alloc_pool_result 同口径)。

CREATE TABLE alloc_pool_meter_result (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ym CHAR(7) NOT NULL,
  rule_id INT UNSIGNED NOT NULL,
  meter_id INT UNSIGNED NOT NULL,
  sign TINYINT NOT NULL DEFAULT 1 COMMENT '+1计入/-1从池剔除(与 alloc_rule_meter.sign 同批快照)',
  seq SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '池内行序(按表 sort_no/id),锁死屏上与导出的行序',
  factor_snap DECIMAL(10,2) NULL COMMENT '倍率快照(取当月读数的 factor_snap,非档案现值)',
  prev_total DECIMAL(14,2) NULL COMMENT '上月行至(总)',
  curr_total DECIMAL(14,2) NULL COMMENT '本月行至(总)',
  qty_total DECIMAL(14,2) NULL, qty_sharp DECIMAL(14,2) NULL, qty_peak DECIMAL(14,2) NULL,
  qty_flat DECIMAL(14,2) NULL, qty_valley DECIMAL(14,2) NULL,
  cost_amount DECIMAL(14,2) NULL COMMENT '该表应分摊;仅 p1/dorm 逐表ROUND口径有值,p2 池级一次ROUND→NULL(金额只在池行)',
  generated_at DATETIME NOT NULL,
  UNIQUE KEY uk_pool_meter_result (ym, rule_id, meter_id),
  KEY idx_pmr_ym (ym),
  CONSTRAINT fk_pmr_rule FOREIGN KEY (rule_id) REFERENCES alloc_rule(id) ON DELETE CASCADE
) COMMENT='池核算逐表明细快照(原册一表一行);金额口径见 cost_amount 注释';

-- ── 冲减载体(用户 2026-07-30 拍板:火炬园出 0,跟账册一致)──
-- 池 17「二期 五车间·广告字灯（火炬园）」绑的 meter 58 同时以 sign=-1 挂在池 16(五车间电梯)上冲减;
-- 账册该行(W89)应分摊列是空的 —— 这 670.06 度的钱走账单侧单独向火炬园收,不在本表出数。
-- 原实现按通则「有度数就计价」得 590.17,是二期合计 15122.92 vs 账册锚点 14333.60 差额的最后一笔。
ALTER TABLE alloc_rule MODIFY COLUMN method VARCHAR(10) NOT NULL
  COMMENT 'direct/area/floor/loss/none(不分摊,全额挂亏)/ref(纯标准行:只出std不出应分摊,不入合计)/carrier(冲减载体:表已在别池以sign=-1冲减,本行只陈列用量不出应分摊、不入金额合计)';

UPDATE alloc_rule SET method = 'carrier'
WHERE id = 17 AND name = '二期 五车间·广告字灯（火炬园）';

-- ── 六车间电梯2 倍率(用户 2026-07-30 拍板:50 为准,账册按 40 出账是账册的错)──
-- 仅留档,不改数据:meter 77 档案倍率本就是 50,系统生成的 1008.50度/995.74元/165.96元每层 即为正确值。

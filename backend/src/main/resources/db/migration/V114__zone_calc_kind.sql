-- V114__zone_calc_kind.sql — 计费口径从「按期区名字硬分叉」改成期级参数。
-- 背景:AllocService 里 7 处 `"p2".equals(zone) ? 分时 : 平价`,新期区一律静默落平价分支,
-- 而 ruleCostAmount(:1109) 干脆 `if (!p1 && !p2) return null` —— p3 池的应分摊恒 null,
-- 池建得出来、算不出钱、不报任何错。
--
-- ⚠ 参数表是 alloc_cfg,且**只有 DECIMAL 值列**(cfg_value DECIMAL(14,8),无文本列),
--   故用数值编码 —— 与 loss_variant(0=net/1=share_only/2=陈列不出率)完全同款。
--     0 = flat 单一商业价 ×(用量 + 加减度数)
--     1 = tou  尖/峰/平/谷分时四段 + 管理费
-- acct_month='' + mode='from' = 初始版本、向后前滚(同 alloc_cfg 既有约定)。

INSERT INTO alloc_cfg (scope, cfg_key, cfg_value, acct_month, mode, note) VALUES
  ('p1', 'zone_calc_kind', 0, '', 'from', '一期:0=平价制(单一商业价=供电局月均+0.16)'),
  ('p2', 'zone_calc_kind', 1, '', 'from', '二期:1=分时制(尖峰平谷四段 + 管理费)');
-- dorm 不写:它本来就不出对账行(ruleCostAmount 旧实现读不到 p2.price_norm 即跳过),
--            写了反而会让宿舍开始出对账行,是行为变更。
-- 三期不预设:猜错等于三期整年电费收错,必须由用户在计费参数页显式选。

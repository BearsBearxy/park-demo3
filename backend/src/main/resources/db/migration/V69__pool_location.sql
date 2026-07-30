-- V69__pool_location.sql — 池的四级定位(楼栋+楼层+侧向+费项)与受益人按月留痕。
-- 用户 2026-07-30 拍板:池名不手写,由定位自动生成;层级留空即上一级(楼层空=整栋,楼栋空=园区级);
-- 受益人真正启用(alloc_rule_member 之前 0 行)并沿用本项目「月行优先回退默认行」模式(同 alloc_cfg/tenant_price_cfg)。
-- 计算内核口径一字不改:本迁移只加定位与受益人月份维度,不碰 qty/cost/std/base/损耗 任何列。

ALTER TABLE alloc_rule
  ADD COLUMN floor_label VARCHAR(16) NULL COMMENT '楼层显示名(四楼/负一层);NULL=整栋(货梯这类跨层池)',
  ADD COLUMN side        VARCHAR(8)  NULL COMMENT '侧向(东侧/西侧);NULL=整层',
  ADD COLUMN fee_name    VARCHAR(32) NULL COMMENT '费项显示名(走廊灯/消防/货梯),进自动池名末段';

-- 受益人按月留痕:''=默认长期行,'YYYY-MM'=该月覆盖(改 2026-07 不影响 2026-06 已出账)
ALTER TABLE alloc_rule_member
  ADD COLUMN acct_month CHAR(7) NOT NULL DEFAULT '' COMMENT "''=默认长期行;'YYYY-MM'=该月覆盖(月行优先回退默认)",
  DROP INDEX uk_alloc_rule_member,
  ADD UNIQUE KEY uk_alloc_rule_member (rule_id, acct_month, tenant_id);

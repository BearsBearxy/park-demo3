-- V68 表停用(账期口径)+ ownership 新增 park 园区自担(2026-07-29)
-- 停用不用布尔 status:系统是账期驱动的,布尔会追溯污染历史月(今天标停用→回看 2024-03 也算停用,分母失真)。
-- 判定 retired(m,ym) = retired_ym != NULL AND ym >= retired_ym(含当月起不计)。
-- park 园区自担(创显自担类):既不向租户收、也不进公摊分摊,但物理仍在楼栋分表Σ内(参与损耗组 D)。
ALTER TABLE meter
  ADD COLUMN retired_ym CHAR(7) NULL COMMENT '自该账期起停用(含当月不计);NULL=在用' AFTER factor,
  MODIFY COLUMN ownership VARCHAR(8) NOT NULL DEFAULT 'share'
    COMMENT 'tenant租户|share园区公摊|ops园区经营|infra配电总表|park园区自担(不收租户/不进公摊,仍入楼栋分表Σ)';

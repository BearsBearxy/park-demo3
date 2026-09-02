-- V123__pv_band_params.sql — 判据线换掉两条(PV-ANALYSIS-SPEC §04)。
-- 期间改成「按月逐日 / 按年逐月」两档之后,L1 由三张月度矩阵换成逐段看板:
-- 每栋一条「这栋 ÷ 全园同刻度中位」的线,加一条这栋自己的正常范围带。
-- 于是原来那两条服务于矩阵的线没有了消费方:
--   pv_crit_resid       月残差中位数 ±10%      → 由「出不出带」取代
--   pv_crit_disp_ratio  月离散度 1.5× 园区中位 → 由带宽本身取代
-- 换成两条描述带的:
--   pv_band_sigma  带的半宽 = 几倍稳健波动。2 是控制图惯例(双侧漏出约 4.6%)
--   pv_band_run    连续几个刻度同侧出带才算「一段」,用来把断崖与上下乱跳分开
-- ⚠ 散着出带的门槛**不是**这个数,而是从 pv_band_sigma 推出来的噪声期望的 3 倍
--   (见 logic 的 scatterMin):直接用 3 会让每栋健康楼都报 —— ±2σ 一个月本来就漏 1.4 天。
DELETE FROM alloc_cfg WHERE cfg_key IN ('pv_crit_resid', 'pv_crit_disp_ratio') AND scope = '';
INSERT INTO alloc_cfg (scope, cfg_key, cfg_value, acct_month, mode, note) VALUES
  ('', 'pv_band_sigma', 2, '', 'from', '正常范围半宽=几倍稳健波动'),
  ('', 'pv_band_run',   3, '', 'from', '连续几个刻度同侧出范围才算一段');

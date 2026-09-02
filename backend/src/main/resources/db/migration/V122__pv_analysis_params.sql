-- V122__pv_analysis_params.sql — 分栋分析的年锚点与五条判据线(PV-ANALYSIS-SPEC §04)。
-- 全部进参数中心的理由:判据线是**人定的**,只有让用户看得见、改得动,
-- 「越线了」才退回成一句可复算的事实,而不是屏替他下的结论。
-- 取值依据逐条写在 §04.2,不在这里重复。
INSERT INTO alloc_cfg (scope, cfg_key, cfg_value, acct_month, mode, note) VALUES
  ('', 'pv_yield_anchor_h',   950,  '', 'from', '年等效利用小时锚点(佛山高明实测≈944h)'),
  ('', 'pv_crit_resid',       0.10, '', 'from', '月残差中位数判据线 ±'),
  ('', 'pv_crit_disp_ratio',  1.5,  '', 'from', '月离散度判据线=园区同月中位σ的倍数'),
  ('', 'pv_crit_cover_month', 0.90, '', 'from', '月抄表覆盖率下限'),
  ('', 'pv_crit_ledger',      0.03, '', 'from', '台账与理论装机差判据线 ±'),
  ('', 'pv_crit_yield_ratio', 0.85, '', 'from', '年等效小时/锚点 下限');

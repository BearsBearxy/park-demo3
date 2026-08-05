-- =====================================================================
-- D① 公摊收取价落库（起草，未执行）2026-08-05
-- 依据：一期/二期2024年2月水电费.xlsx 逐格取证 + alloc_cfg frozen_2023 佐证
-- 规则结论（详见对账笔记）：
--   一期路灯 0.04 / 一期绿化 0.009 / 宿舍路灯 0.06 / 宿舍绿化 0.02
--     → 全部是"当月核算值再舍入"（ROUND 2位/绿化3位），与引擎同口径，
--       不需要固定收取价键。宿舍0.05 vs 0.06 是 meter 834『宿舍路灯』
--       2024-02 缺读数（238度），见文末数据修缮段。
--   二期路灯/绿化 → 两口径并存：
--     默认口径 = 冻结2023价（隐藏死模板『公共电分摊』M99=0.005 / M109=0.01，
--                45/38 张租户sheet直接引用）
--     例外口径 = 当月核算 std（『公共电数据』V95 / V65，10/17 张sheet引用），
--                V65 = 绿化水成本/148918.01 + 0.007水泵折入（=引擎 rule13
--                std_value 0.008 + fold_add 复刻）
-- 落点：tenant_price_cfg
--   zone 常数键  p2.lamp_rate / p2.green_rate  = 冻结月推收取价（默认口径）
--   户级例外键  tenant:<id>.lamp_rate_live / green_rate_live = 1
--               → 该户按当月 alloc_pool_result.std_value(+fold_add) 收
-- alloc_cfg 里 rule:18/rule:13 的 frozen_2023 (0.005/0.01) 保留作溯源，不动。
-- =====================================================================

-- ① 二期 zone 默认收取价（冻结 2023 月推价目）
INSERT INTO tenant_price_cfg (scope, cfg_key, acct_month, cfg_value, note) VALUES
  ('p2', 'lamp_rate',  '', 0.005, '二期路灯收取价:公共电分摊!M99 冻结2023-05 手写常数,2024-02 被45张租户sheet引用(保奔路!J44等)'),
  ('p2', 'green_rate', '', 0.01,  '二期绿化水收取价:公共电分摊!M109 冻结2023-05 手写常数,2024-02 被38张租户sheet引用(保奔路!J48/嘉荣!J47等)');

-- ② 户级例外：按当月核算 std 收（live 口径）
-- 路灯+绿化都走 live（10 张sheet：引用 公共电数据!V95+V65）
INSERT INTO tenant_price_cfg (scope, cfg_key, acct_month, cfg_value, note) VALUES
  ('tenant:48', 'lamp_rate_live',  '', 1, '力灏!J16={公共电数据!V95}'),
  ('tenant:48', 'green_rate_live', '', 1, '力灏!J22={公共电数据!V65}'),
  ('tenant:49', 'lamp_rate_live',  '', 1, '彭云霞 sheet 同源'),
  ('tenant:49', 'green_rate_live', '', 1, '彭云霞 sheet 同源'),
  ('tenant:50', 'lamp_rate_live',  '', 1, '丁天伦 sheet 同源'),
  ('tenant:50', 'green_rate_live', '', 1, '丁天伦 sheet 同源'),
  ('tenant:51', 'lamp_rate_live',  '', 1, '石荣杰 sheet 同源'),
  ('tenant:51', 'green_rate_live', '', 1, '石荣杰 sheet 同源'),
  ('tenant:52', 'lamp_rate_live',  '', 1, '徐翾 sheet 同源'),
  ('tenant:52', 'green_rate_live', '', 1, '徐翾 sheet 同源'),
  ('tenant:53', 'lamp_rate_live',  '', 1, '方凯鑫 sheet 同源'),
  ('tenant:53', 'green_rate_live', '', 1, '方凯鑫 sheet 同源'),
  ('tenant:56', 'lamp_rate_live',  '', 1, '三龙!J16={公共电数据!V95}'),
  ('tenant:56', 'green_rate_live', '', 1, '三龙!J22={公共电数据!V65}'),
  ('tenant:57', 'lamp_rate_live',  '', 1, '庞俊妨 sheet 同源'),
  ('tenant:57', 'green_rate_live', '', 1, '庞俊妨 sheet 同源'),
  ('tenant:58', 'lamp_rate_live',  '', 1, '应塘!J16={公共电数据!V95}'),
  ('tenant:58', 'green_rate_live', '', 1, '应塘!J22={公共电数据!V65}'),
  ('tenant:59', 'lamp_rate_live',  '', 1, '欧培敬 sheet 同源');
INSERT INTO tenant_price_cfg (scope, cfg_key, acct_month, cfg_value, note) VALUES
  ('tenant:59', 'green_rate_live', '', 1, '欧培敬 sheet 同源');

-- 仅绿化走 live、路灯仍走冻结 M99（7 张sheet：路灯=M99const 绿化=V65live）
INSERT INTO tenant_price_cfg (scope, cfg_key, acct_month, cfg_value, note) VALUES
  ('tenant:61', 'green_rate_live', '', 1, '朱漫钳: 路灯M99/绿化V65'),
  ('tenant:62', 'green_rate_live', '', 1, '南一!J47={公共电数据!V65}, 路灯J43={公共电分摊!M99}'),
  ('tenant:64', 'green_rate_live', '', 1, '王红婷: 路灯M99/绿化V65'),
  ('tenant:65', 'green_rate_live', '', 1, '张文峰: 路灯M99/绿化V65'),
  ('tenant:66', 'green_rate_live', '', 1, '陈土生: 路灯M99/绿化V65'),
  ('tenant:67', 'green_rate_live', '', 1, '柯建伍: 路灯M99/绿化V65');
-- 待核：邓宇峰 sheet 绿化两口径都出现(M109+V65,多场地)。tenant 60/24/296/309 多档并存，
-- 先不落，人工拍板后补一行:
-- INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note)
--   VALUES ('tenant:60','green_rate_live','',1,'邓宇峰 待核:sheet内 M109 与 V65 并存');

-- ③ 数据修缮（宿舍 0.05→0.06 的真因，非价目问题）：
-- meter 834『宿舍路灯』(code 220605000139) 2024-02 prev=curr=5695.86 → qty 0，
-- Excel 宿舍电!K336=93758 → L336=93996（238度，倍率1），且 DB 行至与 Excel 行至
-- 完全对不上（5695.86 vs 93758），疑似身份/量程错挂——先查再补：
-- SELECT * FROM meter_reading WHERE meter_id=834 AND ym IN ('2024-01','2024-02');
-- 补读数模板（人工核对表身份后再启用）：
-- UPDATE meter_reading SET curr_value=..., qty=238 WHERE meter_id=834 AND ym='2024-02';

-- ④ 疑点（不在本刀，仅记录）：
-- tenant_price_cfg id=24 p1.green_area_base=15510 与 Excel 一期园区水!L6
--   =ROUND((K6+K7+K8)*4.45/80000,3) 的分母 80000 不符（15510 是宿舍面积）。
--   一期绿化水引擎侧尚无池 rule（share_green_water 仅 rule13/91），recon 已记
--   "园区东侧绿化水1 整类缺失"。建池时分母应取 80000。

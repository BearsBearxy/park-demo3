-- V119__weather_switch_params.sql — 外部天气数据源断闸开关三键(PV-ANALYSIS-SPEC §02)。
-- 本刀的天气数据走导入中心(零持续费用、零扣费风险),这三个键是给「将来真接了付费 API」
-- 留的断闸。默认「关」:新装实例/开发环境/演示库都不该往外发付费请求 ——
-- 开启付费源必须是一个**显式动作**,而不是一个需要记得去关掉的默认行为。
--
-- ⚠ 参数表 alloc_cfg **只有 DECIMAL 值列**(cfg_value DECIMAL(14,8),无文本列),
--   故 weather_source 用整数编码 + ParamRegistry 侧 ValueKind.ENUM + WEATHER_SOURCE_OPTS 字典
--   —— 与 zone_calc_kind(V114) / loss_variant 完全同款。
--     0 = 导入(默认,不发任何外部请求)   1 = 和风天气 API   2 = datashareclub API
-- acct_month='' + mode='from' = 初始版本、向后前滚(同 alloc_cfg 既有约定)。

INSERT INTO alloc_cfg (scope, cfg_key, cfg_value, acct_month, mode, note) VALUES
  ('', 'weather_api_enabled',     0,   '', 'from', '外部天气API总开关 0=关(默认) 1=开'),
  ('', 'weather_api_monthly_cap', 400, '', 'from', '本月调用上限,达到自动置 enabled=0'),
  ('', 'weather_source',          0,   '', 'from', '0=导入(默认) 1=和风 2=datashareclub');
-- scope='' = GLOBAL(ParamRegistry.scopeKindOf:空 scope 即 GLOBAL);三键都只有全局一档。

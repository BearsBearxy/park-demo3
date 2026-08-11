-- V93__perf_indexes.sql — 2026-08-11 全面审计 P3(纯 I/O 优化:只加索引,不改表结构、不动任何一行数据)。
--
-- 来源:删池(DELETE /api/alloc/rules/{id} → AllocService.deleteRule)前要先做占用校验 ——
-- AllocResultMapper.countByRule 按 rule_id 数一遍 alloc_result,「有分摊结果不可删(历史月已快照)」。
-- 而该表建表时只有 uk_alloc_result(tenant_id, ym, fee_key) 与 idx_alloc_result_ym(ym)
-- 两个索引(V47__alloc.sql:83-84),rule_id 无索引可用 → 每次校验全表扫描。
-- rule_id 可空(损耗行 / manual 行 / 多规则合并行为 NULL),普通二级索引即可,不加唯一性。
CREATE INDEX idx_alloc_result_rule ON alloc_result (rule_id);

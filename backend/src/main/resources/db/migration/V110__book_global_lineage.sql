-- 账册模板全局化(2026-08-25 拍板,spec: docs/superpowers/specs/2026-08-25-global-book-template-design.md):
-- 台账屏从「每司一册一链」改为「全局一条链 + 每司一个版本指针」。
-- 本迁移只放宽约束;归并逻辑在 BookService.migrateToGlobalLineage()(启动幂等)——
-- 它要判断 JSON 模板之间的包含关系,SQL 做不了,且生产分叉形态未必与本地一致,
-- 纯 SQL 撞上意外形态只会写坏数据。
--
-- company_id 已是 NULL-able(V107),宿主行 (screen='ledger', company_id=NULL) 直接可插;
-- uk_book_company 在 MySQL 下多个 NULL 互不冲突,不阻止插入。宿主行唯一性由幂等种子保证。
-- 因此本文件无 DDL:留档说明迁移边界,真正的数据搬迁由启动方法完成(幂等、可重入)。
SELECT 1;

-- V29__tenant_parent.sql — 租户一级子关联(如「王柱宿舍」关联主租户「王柱」)。纯新增列+索引+自引用外键。
-- 仅支持一级:子租户不可再被关联(应用层校验);主租户被删时 SET NULL 兜底(应用层已有子租户守卫)。
ALTER TABLE tenant
  ADD COLUMN parent_id INT UNSIGNED NULL,
  ADD KEY idx_tenant_parent (parent_id),
  ADD CONSTRAINT fk_tenant_parent FOREIGN KEY (parent_id) REFERENCES tenant(id) ON DELETE SET NULL;

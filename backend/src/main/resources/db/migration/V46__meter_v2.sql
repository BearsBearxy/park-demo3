-- V46__meter_v2.sql — 园区抄表 v2 结构化档案(METER-SPEC §6.1):ALTER meter 加主数据关联与归属。
-- ownership 四值:tenant(租户表)/share(园区公摊)/ops(园区经营)/infra(配电总表)。
-- 回填方式=重导真实文件(导入刷新档案字段),本迁移不写数据迁移。
ALTER TABLE meter
  ADD COLUMN tenant_id   INT NULL AFTER tenant_name,          -- 关联租户管理,不级联;户内表
  ADD COLUMN building_id INT NULL AFTER tenant_id,            -- 关联楼栋管理;区域→楼栋映射(§6.3)
  ADD COLUMN ownership   VARCHAR(8) NOT NULL DEFAULT 'share' AFTER building_id;

-- 租户别名(2026-08-03):园区财务 worksheet 常用老板个人名(如「李富全」=鑫皇老板)代替公司名,
-- 导入/挂号按名匹配时对不上,曾致重复建档。逗号分隔多别名;全部匹配点均为内存 Map,无需独立表。
ALTER TABLE tenant ADD COLUMN aliases VARCHAR(255) NULL COMMENT '别名,逗号分隔(worksheet老板名/曾用名);导入与挂号匹配时与正名同权';
UPDATE tenant SET aliases = '李富全' WHERE company_name = '鑫皇';

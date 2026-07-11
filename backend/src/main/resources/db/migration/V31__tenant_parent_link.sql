-- V31__tenant_parent_link.sql — 租户关联数据铺底:按名称规则自动填 parent_id(V29 建列,已有 6 条手工关联不覆盖)。
-- 规则:child 名称 = parent 名称 + 后缀[宿舍/（宿舍）/（饭堂）/商铺/（商铺）,括号为全角,与库内数据一致]
--       或 = '火炬园' + parent 名称;仅动 child.parent_id IS NULL 的行;parent 取迁移前的根(parent_id IS NULL)。
-- 预期影响:语句1命中 14 行(2026-07-11 对 dev 库 dry-run 实测,无一对多歧义、无自指);
--          含一条两级链 309 火炬园火炬园邓宇峰 → 24 火炬园邓宇峰 → 60 邓宇峰,由语句2拍平到根。
-- 迁移后验证 SQL:
--   SELECT COUNT(*) FROM tenant WHERE parent_id IS NOT NULL;                     -- 应 = 20(14 新 + 6 旧)
--   SELECT id, parent_id FROM tenant WHERE company_name = '广联（宿舍）';          -- parent_id 应 = 28(广联)
--   SELECT parent_id FROM tenant WHERE id = 309;                                 -- 应 = 60(根,非 24)

-- 语句1:名称规则关联。parent 用派生表取迁移前快照,避免同语句内先更新的行(如 24)影响后续匹配(如 309)。
UPDATE tenant c
JOIN (SELECT id, company_name FROM tenant WHERE parent_id IS NULL) p
  ON (c.company_name IN (CONCAT(p.company_name, '宿舍'),
                         CONCAT(p.company_name, '（宿舍）'),
                         CONCAT(p.company_name, '（饭堂）'),
                         CONCAT(p.company_name, '商铺'),
                         CONCAT(p.company_name, '（商铺）'))
   OR c.company_name = CONCAT('火炬园', p.company_name))
SET c.parent_id = p.id
WHERE c.parent_id IS NULL AND c.id <> p.id;

-- 语句2:链拍平,跑两遍防两级链(child 的 parent 也有 parent → 直指 parent 的 parent);p.parent_id <> c.id 防自指。
UPDATE tenant c
JOIN tenant p ON c.parent_id = p.id AND p.parent_id IS NOT NULL
SET c.parent_id = p.parent_id
WHERE p.parent_id <> c.id;

UPDATE tenant c
JOIN tenant p ON c.parent_id = p.id AND p.parent_id IS NOT NULL
SET c.parent_id = p.parent_id
WHERE p.parent_id <> c.id;

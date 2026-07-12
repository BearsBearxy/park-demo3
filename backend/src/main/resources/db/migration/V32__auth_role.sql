-- 角色列(审计建议#8 只读账号):admin=可写 / viewer=只读(GET-only,SecurityConfig 强制)。
-- 不新增种子行:viewer 账号由 AdminInitializer 按 app.viewer.password 创建/重置(dev 默认 viewer123,
-- prod 留空=不创建),避免再往迁移里塞已知口令种子(审计已点名 seed 混入生产库问题)。
ALTER TABLE auth_user ADD COLUMN role VARCHAR(16) NOT NULL DEFAULT 'admin' AFTER status;

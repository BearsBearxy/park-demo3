-- 系统管理员角色无条件有工资录入(复查 2026-10-04)。V136 只给「同时有 entry:edit 与 salary:view」的角色:
-- 部署前若有人把系统管理员角色的事后录入或工资查看取消过(分级之前,任何有 system:edit 的人都改得了这个角色),
-- V136 会跳过它,系统管理员账号从此录不了附表 12 —— 而用户要的是「一个超级管理员的账号都能调试整个软件」
-- (2026-10-04 拍板)。照 V108 / V112 的老规矩:新权限点,admin 无条件给。
-- salary:view 一起种:角色屏按库里原样画勾,只种编辑会画出「编辑勾着、查看空着」。
-- 种子库上 V136 已经给过,这里什么都不插。幂等:NOT EXISTS。

INSERT INTO auth_role_perm (role_id, perm)
SELECT r.id, x.p FROM auth_role r, (SELECT 'salary:view' p UNION ALL SELECT 'salary:edit') x
WHERE r.code = 'admin'
  AND NOT EXISTS (SELECT 1 FROM auth_role_perm e WHERE e.role_id = r.id AND e.perm = x.p);

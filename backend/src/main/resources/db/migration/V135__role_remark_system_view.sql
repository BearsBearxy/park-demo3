-- 角色备注再跟一次(2026-10-04 文案复查):审核员、总经理、只读账号都没有「系统管理 · 查看」,
-- V134 写的「除工资外都能看」与角色屏矩阵上「系统管理」那一行不勾对不上。
-- 只改 V134 写下的原句,客户改过的不动;重放时原句已不在,什么都不改。
UPDATE auth_role SET remark = '只审不录:能看除工资、系统管理外的各模块,不能改'
WHERE code = 'reviewer' AND remark = '只审不录:能看除工资外的各模块,不能改';
UPDATE auth_role SET remark = '只读;除工资明细和系统管理外都能看'
WHERE code IN ('gm', 'viewer') AND remark = '只读;除工资明细外都能看';

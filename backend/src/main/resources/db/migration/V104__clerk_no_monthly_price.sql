-- 月度电价录入收归主管级(用户拍板 2026-08-22)。
--
-- 原本给财务专员的理由是「不给他,催缴单就出不了账」(RBAC-SPEC §2.1)。
-- 有了提权(ELEVATION-SPEC)之后这个理由不成立了:专员每月点一次「编辑模式」,
-- 主管当场授权 30 分钟,足够录完那 14 个键,而且每一次改动都记着两个人的名字。
--
-- 电价是**决定每一户账单**的数字。录错一位数,全园的催缴单一起错 ——
-- 这类数字值得每月被主管过一次眼。
--
-- 专员保留:抄表读数、台账/附表录入、出账运行(生成/重算)、报表。
DELETE arp FROM auth_role_perm arp
JOIN auth_role r ON r.id = arp.role_id
WHERE r.code = 'finance_clerk' AND arp.perm = 'param-monthly:edit';

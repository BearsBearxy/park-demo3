-- 数据修改记录带授权人(V138 漏了这一列;2026-10-05 对抗复查 SEC-6):借了别人的编辑权(提权)做的改动,
-- 操作日志要写明「由 X 授权」—— 账号与角色、计费参数两路一直这样记,提权弹窗也是这么告诉用户的。
-- NULL = 没走提权。两条链都跑:只加一列,不写数据。
ALTER TABLE value_change_log
  ADD COLUMN authorizer VARCHAR(64) DEFAULT NULL COMMENT '提权放行时的授权人用户名(ElevationStore.currentAuthorizer)' AFTER actor;

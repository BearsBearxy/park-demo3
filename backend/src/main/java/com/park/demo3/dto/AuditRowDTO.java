package com.park.demo3.dto;
import java.time.LocalDateTime;
/**
 * 操作日志时间线的一行（RBAC-SPEC §7）。三张来源表 union 后归一成这个形状。
 *
 * 为什么不把三张表合并成一张:param_change_log 有 old_value/new_value/cfg_key、
 * import_log 有 rows/ok/warn,都是专用字段,合进通用表就得塞 JSON,那两屏的历史查询反而难写。
 * 市面同样分开(Odoo 的 tracking vs logging、Jira 的 issue history vs audit log)。
 * 归一只发生在**展示层**。
 */
public record AuditRowDTO(
    String source,        // param(计费参数) / import(导入) / auth(账号与角色)
    LocalDateTime ts,
    String actor,
    String action,
    String target,
    String detail,
    String authorizer     // 仅「代他人执行」的动作有值(主管授权接管编辑锁),其余 null
) {}

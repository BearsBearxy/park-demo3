package com.park.demo3.service;

import com.park.demo3.entity.AuthAuditLog;
import com.park.demo3.mapper.AuthAuditLogMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;

/**
 * 审计写入（RBAC-SPEC §7）。actor 从 SecurityContext 取，与 ParamService.actor() 同口径。
 *
 * ⚠ **写日志失败绝不能让业务失败**：审计是旁路，不是主链路。
 *    但也不能像 import-log 那样静默 —— 至少 error 级落一条服务端日志，
 *    否则"审计有洞"这件事没人会发现（那正是这套设计要避免的毛病）。
 */
@Slf4j
@Service
public class AuditLogService {
    private final AuthAuditLogMapper logs;
    public AuditLogService(AuthAuditLogMapper logs) { this.logs = logs; }

    public void log(String action, String target, String detail) {
        write(action, target, null, detail);
    }

    /** 代他人执行的动作（主管授权接管编辑锁）：必须记两个人。 */
    public void logAuthorized(String action, String target, String authorizer, String detail) {
        write(action, target, authorizer, detail);
    }

    private void write(String action, String target, String authorizer, String detail) {
        try {
            AuthAuditLog l = new AuthAuditLog();
            l.setTs(LocalDateTime.now());
            l.setActor(actor());
            l.setAction(action);
            l.setTarget(target);
            l.setAuthorizer(authorizer);
            l.setDetail(detail);
            logs.insert(l);
        } catch (Exception e) {
            log.error("审计日志写入失败(业务未受影响) action={} target={}", action, target, e);
        }
    }

    private static String actor() {
        var a = SecurityContextHolder.getContext().getAuthentication();
        return a == null || a.getName() == null ? "" : a.getName();
    }
}

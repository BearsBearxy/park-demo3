package com.park.demo3.service;

import com.park.demo3.entity.AuthAuditLog;
import com.park.demo3.mapper.AuthAuditLogMapper;
import com.park.demo3.security.ElevationStore;
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
            // 截到列宽(V102:target 128 / detail 255)。不截的话超长的理由整条 INSERT 失败,
            // 被下面的 catch 吞成一行服务端日志 —— 审计凭空少一条,屏上什么都看不出来(unconfirm 原来就这样)。
            l.setTarget(cut(target, 128));
            // 显式传的授权人优先；没传就看本次请求是不是靠提权放行的（WriteAccessManager 塞的）。
            // 这一句让所有现存调用点自动记上授权人，一处都不用改。
            l.setAuthorizer(authorizer != null ? authorizer : ElevationStore.currentAuthorizer());
            l.setDetail(cut(detail, 255));
            logs.insert(l);
        } catch (Exception e) {
            log.error("审计日志写入失败(业务未受影响) action={} target={}", action, target, e);
        }
    }

    private static String cut(String s, int max) {
        return s == null || s.length() <= max ? s : s.substring(0, max);
    }

    private static String actor() {
        var a = SecurityContextHolder.getContext().getAuthentication();
        return a == null || a.getName() == null ? "" : a.getName();
    }
}

package com.park.demo3.security;

import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 提权授权的内存台账（ELEVATION-SPEC §3）。
 *
 * 一次授权 = (被授权人, 权限点) → (授权人, 到期时刻)。30 分钟 TTL。
 *
 * **为什么不落库**：授权是短命的会话态，落库要配清理任务、要处理陈旧行、重启还得读回来。
 * 掉一次授权的代价是重新叫主管点一下头 —— 比维护一张会一直长的表便宜得多。
 * 真正要持久的那部分（谁授权谁做了什么）落在审计日志里，那个一行不能丢。
 *
 * ponytail: 单实例态。多副本部署时授权不跨副本 —— 表现为「刚授权完下一个请求又要授权」，
 *           那一步再换共享存储（Redis），不是现在。
 */
@Component
public class ElevationStore {

    /** 授权 TTL。用户拍板 30 分钟（2026-08-22）。 */
    public static final long TTL_SECONDS = 30 * 60L;

    /** WriteAccessManager 靠提权放行时，把授权人塞进 request，供审计自动捡起。 */
    public static final String REQ_ATTR_AUTHORIZER = "elevation.authorizer";

    public record Grant(String perm, String authorizer, Instant expiresAt) {}

    /** username → (perm → Grant)。内层也用并发 Map：同一个人可能同时有多个权限点的授权。 */
    private final Map<String, Map<String, Grant>> byUser = new ConcurrentHashMap<>();

    /** 授权 —— 同一权限点重复授权直接覆盖（续期）。 */
    public void grant(String username, List<String> perms, String authorizer) {
        Instant exp = Instant.now().plusSeconds(TTL_SECONDS);
        Map<String, Grant> mine = byUser.computeIfAbsent(username, k -> new ConcurrentHashMap<>());
        for (String p : perms) mine.put(p, new Grant(p, authorizer, exp));
    }

    /** 本人当前有效的全部授权。顺带清掉过期项 —— 惰性清理，没有定时任务。 */
    public List<Grant> active(String username) {
        Map<String, Grant> mine = byUser.get(username);
        if (mine == null) return List.of();
        Instant now = Instant.now();
        mine.values().removeIf(g -> !now.isBefore(g.expiresAt()));
        if (mine.isEmpty()) { byUser.remove(username); return List.of(); }
        return List.copyOf(mine.values());
    }

    /**
     * anyOf 里任一权限点有有效授权就返回它。
     * WriteAccessManager 用 —— 一个端点可接受多个权限点（如 /api/params 收 policy 或 monthly）。
     */
    public Grant find(String username, List<String> anyOf) {
        Map<String, Grant> mine = byUser.get(username);
        if (mine == null) return null;
        Instant now = Instant.now();
        for (String p : anyOf) {
            Grant g = mine.get(p);
            if (g == null) continue;
            if (now.isBefore(g.expiresAt())) return g;
            mine.remove(p);
        }
        return null;
    }

    /** 退出编辑模式 / 登出 / 主动结束 —— 清掉本人全部授权。 */
    public void revokeAll(String username) { byUser.remove(username); }

    /** 账号被停用或改了角色时清掉 —— 否则停用后 30 分钟内他还能靠授权继续写。 */
    public void revokeAllUsers() { byUser.clear(); }

    /** 当前请求是靠提权放行的吗？是则返回授权人。审计从这里取，业务代码无感。 */
    public static String currentAuthorizer() {
        RequestAttributes ra = RequestContextHolder.getRequestAttributes();
        if (ra == null) return null;
        Object v = ra.getAttribute(REQ_ATTR_AUTHORIZER, RequestAttributes.SCOPE_REQUEST);
        return v == null ? null : v.toString();
    }
}

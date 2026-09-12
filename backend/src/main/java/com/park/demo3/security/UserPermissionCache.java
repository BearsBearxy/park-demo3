package com.park.demo3.security;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.park.demo3.entity.*;
import com.park.demo3.mapper.*;
import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.*;
import java.util.stream.Collectors;

/**
 * 用户 → 权限点 的内存快照(RBAC-SPEC v2 §5.5)。
 *
 * **为什么不把权限烤进 JWT**:令牌有效期 120 分钟。权限烤进去 → 把一个人停用了,
 * 他还能再用两小时。这里全量装内存(账号就几十行),任何用户/角色写操作后 {@link #reload()},
 * 每请求零 DB 查询,改完立刻生效,停用立刻踢。
 *
 * 停用/删号的账号**不进快照** → JwtAuthFilter 查不到 → 该请求保持匿名 → 401。
 */
@Slf4j
@Component
public class UserPermissionCache {

    /**
     * 一个账号的授权快照。navLayers 与权限无关,只管导航显示哪几层(RBAC-SPEC §4)。
     *
     * roleNames = 该账号挂着的角色**显示名**(D6),多角色按挂载序给全部,顺序即展示序。
     * 它是展示物,不是判定依据 —— 判定一律看 perms。放这里而不是每次 join `auth_user_role`,
     * 是因为这份快照本来就是那张表的内存投影,再查一次库只是把同一件事做两遍。
     * 一个角色都没挂的账号是空表(不是 null):派生兜底由前端 `auth.roleLabel` 做,
     * 后端不猜 —— 猜出来的名字会被当成真名显示,而"（派生）"这个标记只有前端画得出来。
     */
    public record UserAuth(String username, Set<String> perms, List<String> navLayers,
                           List<String> roleNames, int tokenVersion, String sessionId,
                           String revokeReason) {

        /** 换一份会话身份,其余原样(V125:登录/改密/踢人之后定点改这一个账号,不整表 reload)。 */
        UserAuth withSession(int tv, String sid, String reason) {
            return new UserAuth(username, perms, navLayers, roleNames, tv, sid, reason);
        }
    }

    private final AuthUserMapper users;
    private final AuthUserRoleMapper userRoles;
    private final AuthRoleMapper roles;
    private final AuthRolePermMapper rolePerms;

    private final ElevationStore elevations;

    private volatile Map<String, UserAuth> snapshot = Map.of();

    public UserPermissionCache(AuthUserMapper users, AuthUserRoleMapper userRoles,
                               AuthRoleMapper roles, AuthRolePermMapper rolePerms,
                               ElevationStore elevations) {
        this.users = users; this.userRoles = userRoles; this.roles = roles; this.rolePerms = rolePerms;
        this.elevations = elevations;
    }

    @PostConstruct
    public void init() { reload(); }

    /** 任何 auth_user / auth_role / auth_role_perm / auth_user_role 的写操作之后必须调。 */
    public synchronized void reload() {
        // reload 会重建整张快照,而会话 id 不在它查的那几张表里 —— 不先存下来,
        // 任何一次角色变更都会把所有人的 sid 抹成 null,下一个请求全部 401。
        Map<String, String> liveSid = new HashMap<>();
        Map<String, String> reason = new HashMap<>();
        for (var e : snapshot.entrySet()) {
            if (e.getValue().sessionId() != null) liveSid.put(e.getKey(), e.getValue().sessionId());
            if (e.getValue().revokeReason() != null) reason.put(e.getKey(), e.getValue().revokeReason());
        }
        // 提权授权一并清空。不清的话「停用立刻踢」这条就有个 30 分钟的洞:
        // 被停用的账号仍能靠手上的授权继续写 —— 那正是这份缓存存在的理由。
        // 粗粒度(清所有人)是故意的:reload 不知道是谁变了,而角色变更本就罕见,
        // 代价只是重新叫主管点一次头。
        elevations.revokeAllUsers();
        // 只装 status=1 的账号:停用的查不到 → 下一个请求就 401,不必等令牌过期
        List<AuthUser> active = users.selectList(Wrappers.<AuthUser>lambdaQuery().eq(AuthUser::getStatus, 1));
        if (active.isEmpty()) { snapshot = Map.of(); return; }

        Map<Integer, AuthRole> roleById = roles.selectList(null).stream()
            .collect(Collectors.toMap(AuthRole::getId, r -> r, (a, b) -> a));
        Map<Integer, Set<String>> permsByRole = new HashMap<>();
        for (AuthRolePerm rp : rolePerms.selectList(null)) {
            permsByRole.computeIfAbsent(rp.getRoleId(), k -> new HashSet<>()).add(rp.getPerm());
        }
        Map<Integer, List<Integer>> rolesByUser = new HashMap<>();
        for (AuthUserRole ur : userRoles.selectList(null)) {
            rolesByUser.computeIfAbsent(ur.getUserId(), k -> new ArrayList<>()).add(ur.getRoleId());
        }

        Map<String, UserAuth> next = new HashMap<>();
        for (AuthUser u : active) {
            Set<String> perms = new HashSet<>();
            // 多角色是并集 —— 现实里有「主管兼管理员」。导航层同理取并集,否则兼岗的人会少看到东西。
            Set<String> layers = new LinkedHashSet<>();
            List<String> roleNames = new ArrayList<>();
            for (Integer rid : rolesByUser.getOrDefault(u.getId(), List.of())) {
                perms.addAll(permsByRole.getOrDefault(rid, Set.of()));
                AuthRole r = roleById.get(rid);
                if (r != null && r.getName() != null && !r.getName().isBlank()) roleNames.add(r.getName());
                if (r != null && r.getNavLayers() != null) {
                    for (String s : r.getNavLayers().split(",")) {
                        String t = s.trim();
                        if (!t.isEmpty()) layers.add(t);
                    }
                }
            }
            // 一个角色都没挂的账号(手工 INSERT 进 auth_user 的)→ 零权限 + 导航全开。
            // 不给权限是安全的默认;导航全开是因为看不见入口比看得见更难排查。
            if (layers.isEmpty()) layers.addAll(List.of("data", "reports", "analysis"));
            // sessionId 从 auth_session 现查会让 reload 多一次 join;它只在登录时才变,
            // 由 applySession 定点写进来。reload 拿不到就给 null —— 见 applySession 的注释。
            int tv = u.getTokenVersion() == null ? 0 : u.getTokenVersion();
            String sid = liveSid.get(u.getUsername());
            next.put(u.getUsername(), new UserAuth(u.getUsername(), Set.copyOf(perms), List.copyOf(layers),
                                                   List.copyOf(roleNames), tv, sid, reason.get(u.getUsername())));
        }
        snapshot = Map.copyOf(next);
        log.info("permission cache reloaded: {} active users", snapshot.size());
    }

    /** 找不到 = 账号不存在或已停用。 */
    public UserAuth get(String username) { return username == null ? null : snapshot.get(username); }

    /**
     * 定点换掉一个账号的令牌版本与当前会话 id(V125)。
     *
     * **为什么不复用 reload()**:reload 的第一件事是 {@code elevations.revokeAllUsers()} ——
     * 登录是高频动作,每次登录都清掉所有人的提权授权,等于随便谁登录一次全公司都要重新叫主管点头。
     * 这里只换一个 entry,不碰提权,也不重查那四张表。
     *
     * sid 传 null = 这个账号当前没有活着的会话(被踢/登出),此后它的令牌一律不认。
     */
    public synchronized void applySession(String username, int tokenVersion, String sessionId, String reason) {
        UserAuth cur = snapshot.get(username);
        if (cur == null) return;   // 停用/不存在的账号不进快照,也就没有会话可言
        Map<String, UserAuth> next = new HashMap<>(snapshot);
        next.put(username, cur.withSession(tokenVersion, sessionId, reason));
        snapshot = Map.copyOf(next);
    }

    /**
     * 持有全部这些权限点的启用账号 —— 远程授权的候选人名单（设计稿 §07）。
     *
     * 快照本来就在内存里，这里只是给它开一个**收窄的**出口：
     * 只按传入的权限点筛，不返回全量用户表。它是个信息泄露口（谁都能拿它枚举「谁是主管」），
     * 内部系统可接受，但不要放宽成「列出所有人」。
     */
    public java.util.List<String> holdersOf(java.util.List<String> perms) {
        return snapshot.values().stream()
            .filter(u -> u.perms().containsAll(perms))
            .map(UserAuth::username)
            .sorted()
            .toList();
    }
}

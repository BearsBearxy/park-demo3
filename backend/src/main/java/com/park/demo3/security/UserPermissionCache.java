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

    /** 一个账号的授权快照。navLayers 与权限无关,只管导航显示哪几层(RBAC-SPEC §4)。 */
    public record UserAuth(String username, Set<String> perms, List<String> navLayers) {}

    private final AuthUserMapper users;
    private final AuthUserRoleMapper userRoles;
    private final AuthRoleMapper roles;
    private final AuthRolePermMapper rolePerms;

    private volatile Map<String, UserAuth> snapshot = Map.of();

    public UserPermissionCache(AuthUserMapper users, AuthUserRoleMapper userRoles,
                               AuthRoleMapper roles, AuthRolePermMapper rolePerms) {
        this.users = users; this.userRoles = userRoles; this.roles = roles; this.rolePerms = rolePerms;
    }

    @PostConstruct
    public void init() { reload(); }

    /** 任何 auth_user / auth_role / auth_role_perm / auth_user_role 的写操作之后必须调。 */
    public synchronized void reload() {
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
            for (Integer rid : rolesByUser.getOrDefault(u.getId(), List.of())) {
                perms.addAll(permsByRole.getOrDefault(rid, Set.of()));
                AuthRole r = roleById.get(rid);
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
            next.put(u.getUsername(), new UserAuth(u.getUsername(), Set.copyOf(perms), List.copyOf(layers)));
        }
        snapshot = Map.copyOf(next);
        log.info("permission cache reloaded: {} active users", snapshot.size());
    }

    /** 找不到 = 账号不存在或已停用。 */
    public UserAuth get(String username) { return username == null ? null : snapshot.get(username); }
}

package com.park.demo3.security;

/**
 * 完全放行的路径。**SecurityConfig 与 PermissionCoverageTest 共用这一份**。
 *
 * 为什么要共用:覆盖率测试要跳过这些路径(它们走不到写规则),但如果测试自己维护一份白名单,
 * 就等于给了「往测试里加一行就能豁免一个端点」的口子 —— 那条路上没有人会发现。
 * 放这里的话,想豁免必须同时把它变成**真的公开可访问**,那是一个显眼、可 review 的动作。
 *
 * /actuator/health 是 Dockerfile 的 HEALTHCHECK 探针,拿 401 的话容器永远 unhealthy。
 */
public final class SecurityPaths {
    private SecurityPaths() {}

    public static final String[] PERMIT_ALL = {
        "/api/auth/login",
        "/actuator/health", "/actuator/health/**",
        "/swagger-ui/**", "/swagger-ui.html", "/v3/api-docs/**",
    };

    /**
     * 带着管理员给的密码(must_change_password=1)还能调的接口,「方法 路径」原样比,别的一律 403 / body.code 428。
     * 就是改密页实际会调到的这几条:改密、退出登录是页面上的两个按钮;me / elevate 是 App 挂载时各取一次
     * (刷新权限、恢复授权胶囊),都只读本人自己的东西。改前只有前端路由守卫拦,拿初始密码换来的令牌
     * 直接调接口照样全通(安全审计 F02 / F40,用户 2026-10-04 拍板)。
     * 登录本身不看令牌,请求头里捎着一张没改密的旧令牌也不该把登录挡掉。
     */
    public static final java.util.Set<String> BEFORE_PASSWORD_CHANGE = java.util.Set.of(
        "POST /api/auth/change-password", "POST /api/auth/logout",
        "GET /api/auth/me", "GET /api/auth/elevate", "POST /api/auth/login");
}

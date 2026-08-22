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
}

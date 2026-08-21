package com.park.demo3.security;

import org.springframework.http.HttpMethod;
import org.springframework.security.authorization.AuthorizationDecision;
import org.springframework.security.authorization.AuthorizationManager;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.web.access.intercept.RequestAuthorizationContext;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.function.Supplier;

/**
 * 写请求(非 GET)的授权判定:查 {@link PermissionRegistry} 要什么权限,再看当前账号有没有。
 *
 * **默认拒绝**:映射表里没有的写路径一律 false。半年后加了新写接口忘了配权限,
 * 它当场 403,而不是裸奔 —— 配套的覆盖率测试会让这种遗漏在 CI 里就红。
 */
@Component
public class WriteAccessManager implements AuthorizationManager<RequestAuthorizationContext> {

    private final PermissionRegistry registry;

    public WriteAccessManager(PermissionRegistry registry) { this.registry = registry; }

    @Override
    public AuthorizationDecision check(Supplier<Authentication> authentication, RequestAuthorizationContext ctx) {
        Authentication auth = authentication.get();
        if (auth == null || !auth.isAuthenticated()) return new AuthorizationDecision(false);

        var req = ctx.getRequest();
        String path = req.getRequestURI();
        String ctxPath = req.getContextPath();
        if (ctxPath != null && !ctxPath.isEmpty() && path.startsWith(ctxPath)) {
            path = path.substring(ctxPath.length());
        }

        List<String> anyOf = registry.resolve(HttpMethod.valueOf(req.getMethod()), path);
        if (anyOf == null) return new AuthorizationDecision(false);                       // 默认拒绝
        if (anyOf.contains(PermissionRegistry.ANY_AUTHENTICATED)) return new AuthorizationDecision(true);

        for (GrantedAuthority a : auth.getAuthorities()) {
            if (anyOf.contains(a.getAuthority())) return new AuthorizationDecision(true); // 满足其一即可
        }
        return new AuthorizationDecision(false);
    }
}

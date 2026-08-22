package com.park.demo3.security;

import org.springframework.http.HttpMethod;
import org.springframework.security.authentication.AuthenticationTrustResolver;
import org.springframework.security.authentication.AuthenticationTrustResolverImpl;
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
 *
 * **提权(ELEVATION-SPEC)接在这里,而不是接在业务层**:角色判定失败后多问一次 {@link ElevationStore},
 * 命中就放行并把授权人塞进 request。126 个写端点一行不用改,全部自动支持;
 * 审计也自动带上授权人 —— 见 AuditLogService / ParamService 里的 currentAuthorizer()。
 * 接到业务层的话就是几十处散弹,且必漏。
 */
@Component
public class WriteAccessManager implements AuthorizationManager<RequestAuthorizationContext> {

    private final PermissionRegistry registry;
    private final ElevationStore elevations;

    /**
     * ⚠ **判匿名必须用它,不能用 `auth.isAuthenticated()`**。
     *
     * Spring 默认装了 AnonymousAuthenticationFilter:没带令牌时 auth 不是 null,而是一个
     * AnonymousAuthenticationToken —— 而它的 `isAuthenticated()` **恒返回 true**。
     * 于是「if (!auth.isAuthenticated()) 拒绝」这行看着像在挡未认证请求,实际一个都挡不住。
     *
     * 2026-08-22 实测:不带任何 Authorization 头 `DELETE /api/auth/elevate` → HTTP 200。
     * 三个 ANY_AUTHENTICATED 端点(import-log / change-password / elevate 撤销)对公网裸奔,
     * 其中 POST /api/import-log 会真往库里落一行 operator='anonymousUser'。
     *
     * 为什么 GET 没事:`.authenticated()` 用的是 Spring 自己的 AuthenticatedAuthorizationManager,
     * 它内部正是靠 TrustResolver 排除匿名 —— 只有手写的这个咽喉漏了这一步。
     */
    private final AuthenticationTrustResolver trustResolver = new AuthenticationTrustResolverImpl();

    public WriteAccessManager(PermissionRegistry registry, ElevationStore elevations) {
        this.registry = registry; this.elevations = elevations;
    }

    @Override
    public AuthorizationDecision check(Supplier<Authentication> authentication, RequestAuthorizationContext ctx) {
        Authentication auth = authentication.get();
        if (auth == null || !auth.isAuthenticated() || trustResolver.isAnonymous(auth)) {
            return new AuthorizationDecision(false);
        }

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

        // 角色没给 → 看有没有主管当场授权。放行时记下授权人,本次请求的审计会自动带上他。
        ElevationStore.Grant g = elevations.find(auth.getName(), anyOf);
        if (g != null) {
            req.setAttribute(ElevationStore.REQ_ATTR_AUTHORIZER, g.authorizer());
            return new AuthorizationDecision(true);
        }
        return new AuthorizationDecision(false);
    }
}

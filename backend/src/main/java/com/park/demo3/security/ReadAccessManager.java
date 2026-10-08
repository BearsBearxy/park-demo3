package com.park.demo3.security;

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
 * 读请求(GET /api/**)的授权判定(RBAC-SPEC §11,v3「读写分开」)。形状照 {@link WriteAccessManager}:
 * 查 {@link PermissionRegistry#resolveRead} 要哪几个查看点,再看当前账号有没有。
 *
 * **默认拒绝**:读规则表里没有的 GET 一律 false。加了新读接口忘了登记,它当场 403,
 * 配套的覆盖率测试(PermissionCoverageTest)在 CI 里就红。
 *
 * **不查 ElevationStore**(v3 规则 6):查看点全部不可提权,借不到。账号的权限集在
 * UserPermissionCache 装载时已经并上了「编辑隐含的查看」,这里只看 authorities。
 */
@Component
public class ReadAccessManager implements AuthorizationManager<RequestAuthorizationContext> {

    /** 被拒时记下这条读规则要的查看点,403 文案据此写明缺哪一项(SecurityConfig 的 accessDeniedHandler)。 */
    public static final String REQ_ATTR_NEED = "demo3.read.need";

    private final PermissionRegistry registry;
    /** 判匿名必须用它,理由见 WriteAccessManager 同名字段。 */
    private final AuthenticationTrustResolver trustResolver = new AuthenticationTrustResolverImpl();

    public ReadAccessManager(PermissionRegistry registry) { this.registry = registry; }

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

        List<String> anyOf = registry.resolveRead(path);
        if (anyOf == null) {                                                               // 默认拒绝
            req.setAttribute(REQ_ATTR_NEED, List.of());
            return new AuthorizationDecision(false);
        }
        if (anyOf.contains(PermissionRegistry.ANY_AUTHENTICATED)) return new AuthorizationDecision(true);

        for (GrantedAuthority a : auth.getAuthorities()) {
            if (anyOf.contains(a.getAuthority())) return new AuthorizationDecision(true); // 满足其一即可
        }
        req.setAttribute(REQ_ATTR_NEED, anyOf);
        return new AuthorizationDecision(false);
    }

    /**
     * GET 被拒的 403 文案:写明缺哪一屏的哪一项、去找谁 —— 用户拿着这句话去找系统管理员,管理员一眼知道该勾哪一格。
     * 一个接口被十几屏共用时不把十几个屏名糊进一句(Perm.needText)。
     */
    public static String deniedMessage(Object need) {
        if (need instanceof List<?> l && !l.isEmpty())
            return "无查看权限：需要" + Perm.needText(l.stream().map(String::valueOf).toList()) + "，请联系系统管理员在角色里勾上";
        return "无查看权限：这项数据没有对你的账号开放，请联系系统管理员";
    }

    /** 写被拒的 403 文案(v4):同样写屏名;need 为空(表里没有 / 显式拒绝)只说没开放。 */
    public static String writeDeniedMessage(Object need) {
        if (need instanceof List<?> l && !l.isEmpty())
            return "无修改权限：需要" + Perm.needText(l.stream().map(String::valueOf).toList()) + "，请联系系统管理员在角色里勾上";
        return "无修改权限：这个操作没有对你的账号开放，请联系系统管理员";
    }
}

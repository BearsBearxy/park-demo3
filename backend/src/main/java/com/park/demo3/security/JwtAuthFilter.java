package com.park.demo3.security;
import jakarta.servlet.FilterChain;
import jakarta.servlet.http.*;
import org.springframework.lang.NonNull;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.AuthorityUtils;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import java.io.IOException;

/**
 * 令牌只带身份;权限从 {@link UserPermissionCache} 现查(RBAC-SPEC v2 §5.5)。
 *
 * 令牌里**不烤权限** —— 烤进去的话把人停用了他还能再用两小时(exp 120 分钟)。
 * 缓存里查不到 = 账号不存在或已停用 → 保持匿名 → 401,停用立刻生效。
 *
 * V32 的 role claim 仍在签发与解析,但不再参与授权判定(authorities 只放权限点,无 ROLE_ 前缀)。
 *
 * V125 加了两道,都读同一份内存快照,**逐请求零查库**:
 *   ① tv 对不上 → 这张令牌是改密/踢人/别处登录之前签的,拒。
 *   ② sid 不是这个账号当前那个 → 同上(单会话:一个账号同时只认一个 sid)。
 * 老令牌(V125 之前签发、没有 tv/sid 的)一律拒:tokenVersionOf 给 -1,与任何真实版本都不等。
 * 这是有意的 —— 升级当天所有人重登一次,换来的是「改密码立刻生效」。
 */
@Component
public class JwtAuthFilter extends OncePerRequestFilter {
    private final JwtUtil jwt;
    private final UserPermissionCache cache;
    public JwtAuthFilter(JwtUtil jwt, UserPermissionCache cache) { this.jwt = jwt; this.cache = cache; }

    @Override protected void doFilterInternal(@NonNull HttpServletRequest req, @NonNull HttpServletResponse res,
            @NonNull FilterChain chain) throws IOException, jakarta.servlet.ServletException {
        String h = req.getHeader("Authorization");
        if (h != null && h.startsWith("Bearer ")) {
            try {
                var claims = jwt.validateAndGetClaims(h.substring(7));
                UserPermissionCache.UserAuth ua = cache.get(claims.getSubject());
                if (ua != null && live(ua, claims)) {   // null = 账号已停用/已删;live=false = 令牌已作废
                    var auth = new UsernamePasswordAuthenticationToken(ua.username(), null,
                            AuthorityUtils.createAuthorityList(ua.perms().toArray(new String[0])));
                    SecurityContextHolder.getContext().setAuthentication(auth);
                } else {
                    // 告诉前端这张为什么不认 —— 没有它,用户只会被默默踢回登录页,
                    // 不知道是自己账号在别处登了、还是改了密码、还是被停用。
                    // 只在「认得出是谁」时才给理由:账号不存在就什么都不说,不给枚举用户名的档口。
                    String reason = ua == null ? null : ua.revokeReason();
                    if (reason != null) res.setHeader("X-Auth-Reason", reason);
                }
            } catch (Exception ignored) { /* 无效令牌 → 保持匿名,后续被 401 拦截 */ }
        }
        chain.doFilter(req, res);
    }

    /** 这张令牌还活着吗。两个条件都要成立,缺一即作废。 */
    private static boolean live(UserPermissionCache.UserAuth ua, io.jsonwebtoken.Claims claims) {
        if (JwtUtil.tokenVersionOf(claims) != ua.tokenVersion()) return false;
        String sid = JwtUtil.sessionIdOf(claims);
        return sid != null && sid.equals(ua.sessionId());
    }
}

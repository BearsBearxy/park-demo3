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
 * 令牌只带用户名;权限从 {@link UserPermissionCache} 现查(RBAC-SPEC v2 §5.5)。
 *
 * 令牌里**不烤权限** —— 烤进去的话把人停用了他还能再用两小时(exp 120 分钟)。
 * 缓存里查不到 = 账号不存在或已停用 → 保持匿名 → 401,停用立刻生效。
 *
 * V32 的 role claim 仍在签发与解析,但不再参与授权判定(authorities 只放权限点,无 ROLE_ 前缀)。
 * 老令牌(V32 之前无 role claim)照样能用:权限一律现查,与 claim 无关。
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
                if (ua != null) {   // null = 账号已停用/已删 → 不认证,后续 401
                    var auth = new UsernamePasswordAuthenticationToken(ua.username(), null,
                            AuthorityUtils.createAuthorityList(ua.perms().toArray(new String[0])));
                    SecurityContextHolder.getContext().setAuthentication(auth);
                }
            } catch (Exception ignored) { /* 无效令牌 → 保持匿名,后续被 401 拦截 */ }
        }
        chain.doFilter(req, res);
    }
}

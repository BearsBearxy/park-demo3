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

@Component
public class JwtAuthFilter extends OncePerRequestFilter {
    private final JwtUtil jwt;
    public JwtAuthFilter(JwtUtil jwt) { this.jwt = jwt; }
    @Override protected void doFilterInternal(@NonNull HttpServletRequest req, @NonNull HttpServletResponse res,
            @NonNull FilterChain chain) throws IOException, jakarta.servlet.ServletException {
        String h = req.getHeader("Authorization");
        if (h != null && h.startsWith("Bearer ")) {
            try {
                var claims = jwt.validateAndGetClaims(h.substring(7));
                // 缺 role claim(V32 前签发的旧 token)按最小权限 viewer 处理:admin 重新登录一次即恢复可写
                String role = claims.get("role", String.class);
                // Locale.ROOT:避免 tr/az 默认 locale 下 "admin"→"ADMİN" 使 hasRole("ADMIN") 永不匹配
                var auth = new UsernamePasswordAuthenticationToken(claims.getSubject(), null,
                        AuthorityUtils.createAuthorityList("ROLE_" + (role == null ? "viewer" : role).toUpperCase(java.util.Locale.ROOT)));
                SecurityContextHolder.getContext().setAuthentication(auth);
            } catch (Exception ignored) { /* 无效令牌 → 保持匿名,后续被 401 拦截 */ }
        }
        chain.doFilter(req, res);
    }
}

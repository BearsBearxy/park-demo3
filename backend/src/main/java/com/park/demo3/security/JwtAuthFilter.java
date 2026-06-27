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
                String user = jwt.validateAndGetSubject(h.substring(7));
                var auth = new UsernamePasswordAuthenticationToken(user, null, AuthorityUtils.NO_AUTHORITIES);
                SecurityContextHolder.getContext().setAuthentication(auth);
            } catch (Exception ignored) { /* 无效令牌 → 保持匿名,后续被 401 拦截 */ }
        }
        chain.doFilter(req, res);
    }
}

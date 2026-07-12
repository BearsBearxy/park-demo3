package com.park.demo3.security;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.park.demo3.common.Result;
import com.park.demo3.common.ResultCode;
import org.springframework.context.annotation.*;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

@Configuration
public class SecurityConfig {
    private final JwtAuthFilter jwtFilter;
    public SecurityConfig(JwtAuthFilter jwtFilter) { this.jwtFilter = jwtFilter; }

    @Bean SecurityFilterChain chain(HttpSecurity http, ObjectMapper objectMapper) throws Exception {
        http.csrf(AbstractHttpConfigurer::disable)
            .cors(c -> {})
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(a -> a
                // 仅放行存活/就绪探针；/actuator/metrics、/prometheus、health 详情不再匿名可见
                .requestMatchers("/api/auth/login", "/actuator/health", "/actuator/health/**",
                                 "/swagger-ui/**", "/swagger-ui.html", "/v3/api-docs/**").permitAll()
                // 只读角色(V32):GET=读,任意已登录角色;非 GET=写,仅 admin。
                // 全部 POST/PUT/PATCH/DELETE 端点语义均为写(导入/标记/复制/保存都是 POST 写),GET-only 即只读成立
                .requestMatchers(org.springframework.http.HttpMethod.GET, "/api/**", "/actuator/**").authenticated()
                .requestMatchers("/api/**", "/actuator/**").hasRole("ADMIN")
                .anyRequest().permitAll())
            .addFilterBefore(jwtFilter, UsernamePasswordAuthenticationFilter.class)
            .exceptionHandling(e -> e.authenticationEntryPoint((req, res, ex) -> {
                res.setStatus(401);
                res.setContentType("application/json;charset=UTF-8");
                objectMapper.writeValue(res.getWriter(),
                    Result.error(ResultCode.UNAUTHORIZED.code, ResultCode.UNAUTHORIZED.message));
            }).accessDeniedHandler((req, res, ex) -> {
                // viewer 触发写操作 → HTTP 403 + Result 信封(前端既有 catch→alert 直接显示中文)
                res.setStatus(403);
                res.setContentType("application/json;charset=UTF-8");
                objectMapper.writeValue(res.getWriter(),
                    Result.error(ResultCode.FORBIDDEN.code, ResultCode.FORBIDDEN.message));
            }));
        return http.build();
    }
    @Bean PasswordEncoder passwordEncoder() { return new BCryptPasswordEncoder(); }
}

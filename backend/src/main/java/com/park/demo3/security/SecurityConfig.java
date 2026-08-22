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

/**
 * RBAC-SPEC v2「读全开,写分权」。
 *
 * 读:GET /api/** 任何已登录账号放行 —— 与 V32 之前的现状完全一致,这一行没变。
 *    分析层是纯只读派生层,它的数据天然来自全站;给读分权挡住的不是坏人,是它自己
 *    (v1 曾按模块拦读,结果总经理打不开充电桩分析、股东账号是空壳、12 处深链撞墙)。
 * 写:非 GET /api/** 交 {@link WriteAccessManager} 查映射表,**默认拒绝**。
 * 唯一读也管的是 /api/system/**(用户列表/角色配置/操作日志)。
 */
@Configuration
public class SecurityConfig {
    private final JwtAuthFilter jwtFilter;
    private final WriteAccessManager writeAccess;
    public SecurityConfig(JwtAuthFilter jwtFilter, WriteAccessManager writeAccess) {
        this.jwtFilter = jwtFilter; this.writeAccess = writeAccess;
    }

    @Bean SecurityFilterChain chain(HttpSecurity http, ObjectMapper objectMapper) throws Exception {
        http.csrf(AbstractHttpConfigurer::disable)
            .cors(c -> {})
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(a -> a
                // ── 放行段:必须在最前。/actuator/health 是 Dockerfile 的 HEALTHCHECK 探针
                //    (wget -qO- http://localhost:8080/actuator/health),拿 401 的话容器永远 unhealthy。
                .requestMatchers(SecurityPaths.PERMIT_ALL).permitAll()
                // ── 系统管理:全站唯一「读也管」的一段(RBAC-SPEC §5.1)
                .requestMatchers(org.springframework.http.HttpMethod.GET, "/api/system/**").hasAuthority(Perm.SYSTEM_VIEW)
                .requestMatchers("/api/system/**").hasAuthority(Perm.SYSTEM_EDIT)
                .requestMatchers("/actuator/**").hasAuthority(Perm.SYSTEM_VIEW)
                // ── 读全开
                .requestMatchers(org.springframework.http.HttpMethod.GET, "/api/**").authenticated()
                // ── 写分权
                .requestMatchers("/api/**").access(writeAccess)
                .anyRequest().permitAll())
            .addFilterBefore(jwtFilter, UsernamePasswordAuthenticationFilter.class)
            .exceptionHandling(e -> e.authenticationEntryPoint((req, res, ex) -> {
                res.setStatus(401);
                res.setContentType("application/json;charset=UTF-8");
                objectMapper.writeValue(res.getWriter(),
                    Result.error(ResultCode.UNAUTHORIZED.code, ResultCode.UNAUTHORIZED.message));
            }).accessDeniedHandler((req, res, ex) -> {
                res.setStatus(403);
                res.setContentType("application/json;charset=UTF-8");
                // 通用 403 文案是「不能改，但可查看」—— 那对 /api/system/** 是**反的**:
                // 它是全站唯一"读也管"的一段,被拦的人恰恰是不该看到这些内容。
                // 套通用文案会告诉他"你可以查看",而他点开只会得到又一个 403。
                boolean system = req.getRequestURI() != null && req.getRequestURI().contains("/api/system/");
                String msg = system
                    ? "无访问权限：账号与角色管理仅对系统管理员开放"
                    : ResultCode.FORBIDDEN.message;
                objectMapper.writeValue(res.getWriter(), Result.error(ResultCode.FORBIDDEN.code, msg));
            }));
        return http.build();
    }
    @Bean PasswordEncoder passwordEncoder() { return new BCryptPasswordEncoder(); }
}

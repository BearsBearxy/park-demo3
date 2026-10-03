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
 * RBAC-SPEC v3「读写分开」(2026-10-04 用户拍板,推翻 v2 的「读全开」)。
 *
 * 读:GET /api/** 交 {@link ReadAccessManager} 查读规则表,**默认拒绝**。每个模块一个查看点,编辑隐含查看;
 *    分析层独立放行(analysis:view 放行分析接口与分析屏实际调到的模块读接口),
 *    敏感字段由服务端打码(SensitiveMask)—— v1 按模块拦读让股东账号成了空壳,v3 不让分析依赖各模块的查看权。
 * 写:非 GET /api/** 交 {@link WriteAccessManager} 查映射表,**默认拒绝**。
 * /api/system/** 与 /actuator/** 的规则不变,排在前面先命中。
 */
@Configuration
public class SecurityConfig {
    private final JwtAuthFilter jwtFilter;
    private final WriteAccessManager writeAccess;
    private final ReadAccessManager readAccess;
    public SecurityConfig(JwtAuthFilter jwtFilter, WriteAccessManager writeAccess, ReadAccessManager readAccess) {
        this.jwtFilter = jwtFilter; this.writeAccess = writeAccess; this.readAccess = readAccess;
    }

    @Bean SecurityFilterChain chain(HttpSecurity http, ObjectMapper objectMapper) throws Exception {
        http.csrf(AbstractHttpConfigurer::disable)
            .cors(c -> {})
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(a -> a
                // ── 放行段:必须在最前。/actuator/health 是 Dockerfile 的 HEALTHCHECK 探针
                //    (wget -qO- http://localhost:8080/actuator/health),拿 401 的话容器永远 unhealthy。
                .requestMatchers(SecurityPaths.PERMIT_ALL).permitAll()
                // ── 系统管理:读写都单独管,排在通用读规则前先命中(RBAC-SPEC §5.1、§11.2)
                .requestMatchers(org.springframework.http.HttpMethod.GET, "/api/system/**").hasAuthority(Perm.SYSTEM_VIEW)
                .requestMatchers("/api/system/**").hasAuthority(Perm.SYSTEM_EDIT)
                .requestMatchers("/actuator/**").hasAuthority(Perm.SYSTEM_VIEW)
                // ── 读分权(v3):默认拒绝,规则表在 PermissionRegistry.registerReads
                .requestMatchers(org.springframework.http.HttpMethod.GET, "/api/**").access(readAccess)
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
                // 被拦的人恰恰不该看到账号与角色,文案单独写。
                // 套通用文案会告诉他"你可以查看",而他点开只会得到又一个 403。
                boolean system = req.getRequestURI() != null && req.getRequestURI().contains("/api/system/");
                // 读被拒同理(v3):通用那句告诉他「可查看」,而他刚刚就是看不了。写明缺哪一项、去找谁
                String msg = system
                    ? "无访问权限：账号与角色管理仅对系统管理员开放"
                    : "GET".equals(req.getMethod())
                        ? ReadAccessManager.deniedMessage(req.getAttribute(ReadAccessManager.REQ_ATTR_NEED))
                        : ResultCode.FORBIDDEN.message;
                objectMapper.writeValue(res.getWriter(), Result.error(ResultCode.FORBIDDEN.code, msg));
            }));
        return http.build();
    }
    @Bean PasswordEncoder passwordEncoder() { return new BCryptPasswordEncoder(); }
}

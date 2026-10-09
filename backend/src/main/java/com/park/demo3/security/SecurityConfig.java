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
 * 读:GET /api/** 交 {@link ReadAccessManager} 查读规则表,**默认拒绝**。v4(RBAC-SPEC §15)每屏一个查看,
 *    每条读接口对「实际调用它的那几屏」的查看放行(分析屏调到的模块接口照样放行,不依赖数据屏的查看权);
 *    敏感字段由服务端打码(SensitiveMask)。
 * 写:非 GET /api/** 交 {@link WriteAccessManager} 查映射表,**默认拒绝**。系统管理三屏也走这两张表。
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
                // ── 系统管理三屏(v4)各自一项,走下面的读写规则表(RBAC-SPEC §15.5);actuator 给系统管理任一查看
                .requestMatchers("/actuator/**").hasAnyAuthority(Perm.SYS_USERS_VIEW, Perm.SYS_ROLES_VIEW, Perm.SYS_LOGS_VIEW)
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
                // 读写都写明缺哪一屏的哪一项(两个 AccessManager 被拒时把 anyOf 记进 REQ_ATTR_NEED);
                // 「可查看,如需修改…」那句在屏级拆分后不一定成立,不再用
                Object need = req.getAttribute(ReadAccessManager.REQ_ATTR_NEED);
                String msg = "GET".equals(req.getMethod()) ? ReadAccessManager.deniedMessage(need)
                                                           : ReadAccessManager.writeDeniedMessage(need);
                objectMapper.writeValue(res.getWriter(), Result.error(ResultCode.FORBIDDEN.code, msg));
            }));
        return http.build();
    }
    @Bean PasswordEncoder passwordEncoder() { return new BCryptPasswordEncoder(); }
}

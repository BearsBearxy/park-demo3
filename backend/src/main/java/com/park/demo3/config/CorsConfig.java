package com.park.demo3.config;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.*;
import org.springframework.web.cors.*;
import java.util.Arrays;
import java.util.List;
@Configuration
public class CorsConfig {
    // dev 默认 "*"；prod 由 app.cors.allowed-origins（逗号分隔白名单）注入
    @Value("${app.cors.allowed-origins:*}")
    private String allowedOrigins;

    @Bean CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration c = new CorsConfiguration();
        c.setAllowedOriginPatterns(Arrays.stream(allowedOrigins.split(",")).map(String::trim).toList());
        // PATCH 一度缺席:浏览器发起的全部 @PatchMapping(改备注/行级绑定等 8 个端点)都被 CORS 拒成
        // 403「Invalid CORS request」,curl/测试(无 Origin 头)却全绿 —— 2026-08-23 行级绑定联调时引爆
        c.setAllowedMethods(List.of("GET","POST","PUT","PATCH","DELETE","OPTIONS"));
        c.setAllowedHeaders(List.of("*"));
        // X-Auth-Reason(2026-09-12):401 时告诉前端“为什么不认这张令牌”。
        // 不写这里的话跨域时浏览器不让 JS 读到它 —— 服务端发了,前端看不见,登录页照旧没提示。
        c.setExposedHeaders(List.of("X-Trace-Id", "X-Auth-Reason"));
        UrlBasedCorsConfigurationSource s = new UrlBasedCorsConfigurationSource();
        s.registerCorsConfiguration("/**", c);
        return s;
    }
}

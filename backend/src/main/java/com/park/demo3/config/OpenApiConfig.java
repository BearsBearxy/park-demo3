package com.park.demo3.config;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class OpenApiConfig {
    @Bean
    OpenAPI demo3OpenAPI() {
        return new OpenAPI().info(new Info()
                .title("demo3 园区管理系统 API")
                .version("0.0.1")
                .description("P0-A 后端地基：楼栋/租户/合同只读派生聚合 + JWT 登录"));
    }
}

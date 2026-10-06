package com.park.demo3.controller;

import com.park.demo3.config.DeployConfig;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

// 部署配置:前端据此决定显不显模拟填充 / 损益附表自动补行,更新记录从哪一版往后算(DeployConfig,2026-10-05 用户拍板)。
// 任何已登录账号可读:回包只有这两项,不含业务数据。
@Tag(name = "部署配置")
@RestController
@RequestMapping("/api/app")
public class AppConfigController {
    private final DeployConfig cfg;
    public AppConfigController(DeployConfig cfg) { this.cfg = cfg; }

    public record AppConfigDTO(boolean parkTools, String releaseBaseline) {}

    @Operation(summary = "部署配置(parkTools=模拟填充与损益附表自动补行开不开;releaseBaseline=更新记录只给看这一版之后的)")
    @GetMapping("/config")
    public AppConfigDTO config() { return new AppConfigDTO(cfg.parkTools(), cfg.releaseBaseline()); }
}

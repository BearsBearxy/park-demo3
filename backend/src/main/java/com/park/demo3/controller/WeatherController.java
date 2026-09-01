package com.park.demo3.controller;

import com.park.demo3.dto.ImportResultDTO;
import com.park.demo3.dto.WeatherDayDTO;
import com.park.demo3.dto.WeatherImportRequest;
import com.park.demo3.service.WeatherService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.util.List;

// 外部天气与辐射(PV-ANALYSIS-SPEC §03.5)。返回裸 DTO/List,ResponseWrapAdvice 统一包 Result。
// 写端点的权限在 security/PermissionRegistry 登记(/api/weather/** → METER_READING_EDIT),
// 读端点零配置(SecurityConfig 已放行任何已登录账号的 GET /api/**)。
@Tag(name = "外部天气与辐射")
@RestController @Validated @RequestMapping("/api/weather")
public class WeatherController {
    private final WeatherService svc;
    public WeatherController(WeatherService svc) { this.svc = svc; }

    @Operation(summary = "按年取日聚合") @GetMapping("/daily")
    public List<WeatherDayDTO> daily(@RequestParam @Min(2000) @Max(2100) int year) { return svc.daily(year); }

    @Operation(summary = "导入逐小时天气") @PostMapping("/import")
    public ImportResultDTO importRows(@Valid @RequestBody WeatherImportRequest req) { return svc.importRows(req); }
}

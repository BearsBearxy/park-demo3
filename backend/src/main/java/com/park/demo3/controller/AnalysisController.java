package com.park.demo3.controller;
import com.park.demo3.dto.AnalysisLedgerRowDTO;
import com.park.demo3.dto.AnalysisMonthsDTO;
import com.park.demo3.dto.AnalysisS10RowDTO;
import com.park.demo3.service.AnalysisService;
import com.park.demo3.service.AnalysisSettingService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

// P3 经营分析层只读聚合。仅 3 个「一次拉全」端点,其余屏数据走既有控制器。
// 唯一的写:「目标与阈值」(用户 2026-10-05 拍板第 2 条,全员一份,要「账簿报表」编辑权,见 PermissionRegistry)。
@Tag(name = "经营分析")
@RestController
@RequestMapping("/api/analysis")
public class AnalysisController {
    private final AnalysisService svc;
    private final AnalysisSettingService settings;
    public AnalysisController(AnalysisService svc, AnalysisSettingService settings) { this.svc = svc; this.settings = settings; }

    @Operation(summary = "各数据源 distinct 月份 + 并集(期间派生)") @GetMapping("/months")
    public AnalysisMonthsDTO months() { return svc.months(); }

    @Operation(summary = "s10 租户×月 slim 行(电/水/合计)") @GetMapping("/s10-tenant-months")
    public List<AnalysisS10RowDTO> s10TenantMonths() { return svc.s10TenantMonths(); }

    @Operation(summary = "台账 租户×公司×月 slim 行(应收/收款/结余)") @GetMapping("/ledger-tenant-months")
    public List<AnalysisLedgerRowDTO> ledgerTenantMonths() { return svc.ledgerTenantMonths(); }

    @Operation(summary = "目标与阈值(全员一份;没存过的项不回,前端用默认值)") @GetMapping("/settings")
    public Map<String, Double> settings() { return settings.get(); }

    @Operation(summary = "改目标与阈值(每改一项进操作日志)") @PutMapping("/settings")
    public Map<String, Double> saveSettings(@RequestBody Map<String, BigDecimal> patch) { return settings.save(patch); }
}

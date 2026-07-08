package com.park.demo3.controller;
import com.park.demo3.dto.AnalysisLedgerRowDTO;
import com.park.demo3.dto.AnalysisMonthsDTO;
import com.park.demo3.dto.AnalysisS10RowDTO;
import com.park.demo3.service.AnalysisService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.*;

import java.util.List;

// P3 经营分析层只读聚合(无写路径)。仅 3 个「一次拉全」端点,其余屏数据走既有控制器。
@Tag(name = "经营分析")
@RestController
@RequestMapping("/api/analysis")
public class AnalysisController {
    private final AnalysisService svc;
    public AnalysisController(AnalysisService svc) { this.svc = svc; }

    @Operation(summary = "各数据源 distinct 月份 + 并集(期间派生)") @GetMapping("/months")
    public AnalysisMonthsDTO months() { return svc.months(); }

    @Operation(summary = "s10 租户×月 slim 行(电/水/合计)") @GetMapping("/s10-tenant-months")
    public List<AnalysisS10RowDTO> s10TenantMonths() { return svc.s10TenantMonths(); }

    @Operation(summary = "台账 租户×公司×月 slim 行(应收/收款/结余)") @GetMapping("/ledger-tenant-months")
    public List<AnalysisLedgerRowDTO> ledgerTenantMonths() { return svc.ledgerTenantMonths(); }
}

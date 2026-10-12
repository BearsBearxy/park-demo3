package com.park.demo3.controller;
import com.park.demo3.dto.*;
import com.park.demo3.service.ImportCoverageService;
import com.park.demo3.service.ImportLogService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@Tag(name = "导入中心")
@Validated
@RestController
@RequestMapping("/api/import-log")
public class ImportLogController {
    private final ImportLogService svc;
    private final ImportCoverageService coverage;
    public ImportLogController(ImportLogService svc, ImportCoverageService coverage) { this.svc = svc; this.coverage = coverage; }

    @Operation(summary = "记录一次导入") @PostMapping
    public ImportLogDTO record(@Valid @RequestBody ImportLogReq req) { return svc.record(req); }

    @Operation(summary = "导入中心概览(每类最新 + 近N天历史)") @GetMapping("/overview")
    public ImportLogOverviewDTO overview(
        @RequestParam(defaultValue = "30") @Min(1) @Max(365) int days,
        @RequestParam(defaultValue = "100") @Min(1) @Max(500) int historyLimit) {
        return svc.overview(days, historyLimit);
    }

    @Operation(summary = "导入中心:选中这个月每一类的数有没有(与本月出账同一判据)") @GetMapping("/coverage")
    public List<ImportCenterDtos.CoverageItem> coverage(@RequestParam @Pattern(regexp = "\\d{4}-(0[1-9]|1[0-2])") String ym) {
        return coverage.coverage(ym);
    }

    @Operation(summary = "导入记录分页(近 30 天,不含抄表批量删除)") @GetMapping("/page")
    public ImportCenterDtos.Page page(
        @RequestParam(defaultValue = "1") @Min(1) int page,
        @RequestParam(defaultValue = "20") @Min(1) @Max(200) int size,
        @RequestParam(required = false) @Pattern(regexp = "partial|rejected") String status,
        @RequestParam(required = false) List<String> dataType) {
        return svc.page(page, size, status, dataType);
    }
}

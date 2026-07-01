package com.park.demo3.controller;
import com.park.demo3.dto.*;
import com.park.demo3.service.ImportLogService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

@Tag(name = "导入中心")
@Validated
@RestController
@RequestMapping("/api/import-log")
public class ImportLogController {
    private final ImportLogService svc;
    public ImportLogController(ImportLogService svc) { this.svc = svc; }

    @Operation(summary = "记录一次导入") @PostMapping
    public ImportLogDTO record(@Valid @RequestBody ImportLogReq req) { return svc.record(req); }

    @Operation(summary = "导入中心概览(每类最新 + 近N天历史)") @GetMapping("/overview")
    public ImportLogOverviewDTO overview(
        @RequestParam(defaultValue = "30") @Min(1) @Max(365) int days,
        @RequestParam(defaultValue = "100") @Min(1) @Max(500) int historyLimit) {
        return svc.overview(days, historyLimit);
    }
}

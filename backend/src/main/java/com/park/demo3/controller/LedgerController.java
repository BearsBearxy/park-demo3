package com.park.demo3.controller;
import com.park.demo3.dto.*;
import com.park.demo3.service.LedgerService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;

@Tag(name = "月度台账")
@RestController
@RequestMapping("/api/ledger/companies/{id}")
public class LedgerController {
    private final LedgerService svc;
    public LedgerController(LedgerService svc) { this.svc = svc; }

    @Operation(summary = "年度概览") @GetMapping("/overview")
    public LedgerOverviewDTO overview(@PathVariable Integer id, @RequestParam int year) {
        return svc.overview(id, year);
    }

    @Operation(summary = "月度宽表（稀疏补零成全部在租租户）") @GetMapping("/months/{year}/{month}")
    public LedgerMonthDTO month(@PathVariable Integer id, @PathVariable int year, @PathVariable int month) {
        return svc.month(id, year, month);
    }

    @Operation(summary = "保存月度宽表（upsert / 删空）") @PutMapping("/months/{year}/{month}")
    public LedgerMonthDTO save(@PathVariable Integer id, @PathVariable int year, @PathVariable int month,
                              @Valid @RequestBody LedgerSaveRequest req) {
        return svc.save(id, year, month, req);
    }

    @Operation(summary = "从上月复制（结余结转）") @PostMapping("/months/{year}/{month}/copy-from-prev")
    public LedgerMonthDTO copyFromPrev(@PathVariable Integer id, @PathVariable int year, @PathVariable int month) {
        return svc.copyFromPrev(id, year, month);
    }
}

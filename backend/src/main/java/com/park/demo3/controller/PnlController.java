package com.park.demo3.controller;
import com.park.demo3.dto.ImportResultDTO;
import com.park.demo3.dto.PnlImportRequest;
import com.park.demo3.dto.PnlOverviewDTO;
import com.park.demo3.dto.PnlSaveRequest;
import com.park.demo3.dto.PnlYearDTO;
import com.park.demo3.service.PnlService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

@Tag(name = "损益附表1-5")
@RestController
@Validated
@RequestMapping("/api/pnl/{schedule}")
public class PnlController {
    private final PnlService svc;
    public PnlController(PnlService svc) { this.svc = svc; }

    @Operation(summary = "年份概览(确定性范围)") @GetMapping("/overview")
    public PnlOverviewDTO overview(@PathVariable String schedule) {
        return svc.overview(schedule);
    }

    @Operation(summary = "某年全部行(按 sort_order)") @GetMapping("/{year}")
    public PnlYearDTO year(@PathVariable String schedule,
                           @PathVariable @Min(2000) @Max(2100) int year) {
        return svc.year(schedule, year);
    }

    @Operation(summary = "保存整年(clear+insert,row_key 服务端合成)") @PutMapping("/{year}")
    public PnlYearDTO save(@PathVariable String schedule,
                           @PathVariable @Min(2000) @Max(2100) int year,
                           @RequestBody PnlSaveRequest req) {
        return svc.save(schedule, year, req);
    }

    @Operation(summary = "导入整年(clear+insert)") @PostMapping("/import")
    public ImportResultDTO importRows(@PathVariable String schedule,
                                      @RequestParam @Min(2000) @Max(2100) int year,
                                      @RequestBody PnlImportRequest req) {
        return svc.importRows(schedule, year, req);
    }
}

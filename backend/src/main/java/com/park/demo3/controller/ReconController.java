package com.park.demo3.controller;
import com.park.demo3.dto.ReconMarkDTO;
import com.park.demo3.dto.ReconMarkReq;
import com.park.demo3.dto.ReconMonthDTO;
import com.park.demo3.dto.ReconOverviewDTO;
import com.park.demo3.service.ReconService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

@Tag(name = "收入核对")
@RestController
@Validated
@RequestMapping("/api/recon")
public class ReconController {
    private final ReconService svc;
    public ReconController(ReconService svc) { this.svc = svc; }

    @Operation(summary = "月卡概览（year 缺省=两本账有数据的最大年）") @GetMapping("/overview")
    public ReconOverviewDTO overview(@RequestParam(required = false) @Min(2000) @Max(2100) Integer year) {
        return svc.overview(year);
    }

    @Operation(summary = "整月对照（无数据月 entities 空数组，不 404）") @GetMapping("/{year}/{month}")
    public ReconMonthDTO month(@PathVariable @Min(2000) @Max(2100) int year,
                               @PathVariable @Min(1) @Max(12) int month) {
        return svc.month(year, month);
    }

    @Operation(summary = "标记已核实（uk 冲突即 upsert note）") @PostMapping("/{year}/{month}/mark")
    public ReconMarkDTO mark(@PathVariable @Min(2000) @Max(2100) int year,
                             @PathVariable @Min(1) @Max(12) int month,
                             @Valid @RequestBody ReconMarkReq req) {
        return svc.mark(year, month, req);
    }

    @Operation(summary = "取消核实（删除标记，幂等）") @DeleteMapping("/{year}/{month}/mark")
    public void unmark(@PathVariable @Min(2000) @Max(2100) int year,
                       @PathVariable @Min(1) @Max(12) int month,
                       @RequestParam @NotBlank String tenantName) {
        svc.unmark(year, month, tenantName);
    }
}

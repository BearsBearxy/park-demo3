package com.park.demo3.controller;
import com.park.demo3.dto.*;
import com.park.demo3.service.SalaryService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

@Tag(name = "附表12 工资明细")
@RestController
@Validated
@RequestMapping("/api/salary")
public class SalaryController {
    private final SalaryService svc;
    public SalaryController(SalaryService svc) { this.svc = svc; }

    @Operation(summary = "年份概览（确定性范围 + 每年有数据月份）") @GetMapping("/overview")
    public SalaryOverviewDTO overview() { return svc.overview(); }

    @Operation(summary = "某年某月工资明细") @GetMapping("/records")
    public SalaryYearMonthDTO records(@RequestParam @Min(2000) @Max(2100) int year,
                                      @RequestParam @Min(1) @Max(12) int month) {
        return svc.records(year, month);
    }

    @Operation(summary = "新增工资（source=manual）") @PostMapping("/records")
    public SalaryRecordDTO create(@Valid @RequestBody SalaryRecordReq req) { return svc.create(req); }

    @Operation(summary = "改逐行备注") @PatchMapping("/records/{id}/note")
    public SalaryRecordDTO updateNote(@PathVariable Integer id, @RequestBody SalaryNoteReq req) {
        return svc.updateNote(id, req.note());
    }

    @Operation(summary = "删除（seed 锁定 409，不存在 404）") @DeleteMapping("/records/{id}")
    public void delete(@PathVariable Integer id) { svc.delete(id); }

    @Operation(summary = "批量导入（重导=替换本月 source=import 行；行身份=姓名）") @PostMapping("/import")
    public ImportResultDTO importRows(@RequestParam @Min(2000) @Max(2100) int year,
                                      @RequestParam @Min(1) @Max(12) int month,
                                      @Valid @RequestBody SalaryImportRequest req) {
        return svc.importRows(year, month, req);
    }

    @Operation(summary = "清空本期导入行（删 acct_month·source=import）") @DeleteMapping("/imported")
    public DeleteResultDTO clearImported(@RequestParam @Min(2000) @Max(2100) int year,
                                         @RequestParam @Min(1) @Max(12) int month) {
        return svc.clearImported(year, month);
    }

    @Operation(summary = "批量删除（按 id；seed 种子跳过计入 skipped）") @DeleteMapping("/batch")
    public DeleteResultDTO batchDelete(@Valid @RequestBody S10BatchDeleteReq req) {
        return svc.batchDelete(req.ids());
    }
}

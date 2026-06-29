package com.park.demo3.controller;
import com.park.demo3.dto.*;
import com.park.demo3.service.S10Service;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

@Tag(name = "附表10 销售收入")
@Validated
@RestController
@RequestMapping("/api/s10")
public class S10Controller {
    private final S10Service svc;
    public S10Controller(S10Service svc) { this.svc = svc; }

    @Operation(summary = "年份概览（确定性范围；每年已录月数/户数）") @GetMapping("/overview")
    public S10OverviewDTO overview() { return svc.overview(); }

    @Operation(summary = "某期某年某月逐租户宽表（稀疏读，含列合计/总计）") @GetMapping("/{phase}/{year}/{month}")
    public S10MonthDTO month(@PathVariable @Min(1) @Max(4) int phase,
                             @PathVariable @Min(2000) @Max(2100) int year,
                             @PathVariable @Min(1) @Max(12) int month) {
        return svc.month(phase, year, month);
    }

    @Operation(summary = "新增/upsert 一行（按 期·记账月·租户名）") @PostMapping
    public S10RecordDTO save(@Valid @RequestBody S10RecordReq req) { return svc.save(req); }

    @Operation(summary = "改逐行备注") @PutMapping("/{id}/note")
    public S10RecordDTO updateNote(@PathVariable Long id, @RequestBody S10NoteReq req) {
        return svc.updateNote(id, req.note());
    }

    @Operation(summary = "删除（seed 锁定 409，不存在 404）") @DeleteMapping("/{id}")
    public void delete(@PathVariable Long id) { svc.delete(id); }
}

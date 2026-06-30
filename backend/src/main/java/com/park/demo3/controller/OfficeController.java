package com.park.demo3.controller;
import com.park.demo3.dto.*;
import com.park.demo3.service.OfficeService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

@Tag(name = "附表13/14 办公·三期水电")
@RestController
@Validated
@RequestMapping("/api/utilities")
public class OfficeController {
    private final OfficeService svc;
    public OfficeController(OfficeService svc) { this.svc = svc; }

    @Operation(summary = "年份概览（13+14 合并，确定性范围）") @GetMapping("/overview")
    public OfficeOverviewDTO overview() { return svc.overview(); }

    @Operation(summary = "某附表某年逐月水电台账") @GetMapping("/{no}/records")
    public OfficeYearDTO records(@PathVariable int no, @RequestParam int year) { return svc.records(no, year); }

    @Operation(summary = "新增记账（source=manual）") @PostMapping("/{no}/records")
    public OfficeRecordDTO create(@PathVariable int no, @Valid @RequestBody OfficeRecordReq req) { return svc.create(no, req); }

    @Operation(summary = "改逐行备注") @PatchMapping("/{no}/records/{id}/note")
    public OfficeRecordDTO updateNote(@PathVariable int no, @PathVariable Integer id, @RequestBody OfficeNoteReq req) {
        return svc.updateNote(no, id, req.note());
    }

    @Operation(summary = "删除（seed 同等可删，不存在 404）") @DeleteMapping("/{no}/records/{id}")
    public void delete(@PathVariable int no, @PathVariable Integer id) { svc.delete(no, id); }

    @Operation(summary = "批量导入（行自带 acctMonth,跨年各落各年;重导=替换涉及年 source=import 行；附表号非法 404）") @PostMapping("/{no}/import")
    public ImportResultDTO importRows(@PathVariable int no, @Valid @RequestBody OfficeImportRequest req) {
        return svc.importRows(no, req);
    }

    @Operation(summary = "清空本期导入行（删本附表本年 source=import）") @DeleteMapping("/{no}/imported")
    public DeleteResultDTO clearImported(@PathVariable int no,
                                         @RequestParam @Min(2000) @Max(2100) int year) {
        return svc.clearImported(no, year);
    }

    @Operation(summary = "批量删除（按 id；seed 同等可删，skipped 恒 0）") @DeleteMapping("/batch")
    public DeleteResultDTO batchDelete(@Valid @RequestBody S10BatchDeleteReq req) {
        return svc.batchDelete(req.ids());
    }
}

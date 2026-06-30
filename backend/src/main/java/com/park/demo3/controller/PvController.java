package com.park.demo3.controller;
import com.park.demo3.dto.*;
import com.park.demo3.service.PvService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@Tag(name = "附表6 光伏发电")
@RestController
@Validated
@RequestMapping("/api/pv")
public class PvController {
    private final PvService svc;
    public PvController(PvService svc) { this.svc = svc; }

    @Operation(summary = "期别列表") @GetMapping("/phases")
    public List<PvPhaseDTO> phases() { return svc.phases(); }

    @Operation(summary = "年份概览（确定性范围）") @GetMapping("/overview")
    public PvOverviewDTO overview() { return svc.overview(); }

    @Operation(summary = "某年逐月发电台账") @GetMapping("/records")
    public PvYearDTO records(@RequestParam int year) { return svc.records(year); }

    @Operation(summary = "新增记账（source=manual）") @PostMapping("/records")
    public PvRecordDTO create(@Valid @RequestBody PvRecordReq req) { return svc.create(req); }

    @Operation(summary = "改逐行备注") @PatchMapping("/records/{id}/note")
    public PvRecordDTO updateNote(@PathVariable Integer id, @RequestBody PvNoteReq req) {
        return svc.updateNote(id, req.note());
    }

    @Operation(summary = "删除（seed 同等可删，不存在 404）") @DeleteMapping("/records/{id}")
    public void delete(@PathVariable Integer id) { svc.delete(id); }

    @Operation(summary = "批量导入（行自带 phaseId+acctMonth，按(期,月)upsert；非法行进 errors 跳过）") @PostMapping("/import")
    public ImportResultDTO importRows(@Valid @RequestBody PvImportRequest req) { return svc.importRows(req); }

    @Operation(summary = "清空本期导入行（删本年 source=import）") @DeleteMapping("/imported")
    public DeleteResultDTO clearImported(@RequestParam @Min(2000) @Max(2100) int year) {
        return svc.clearImported(year);
    }

    @Operation(summary = "批量删除（按 id；seed 同等可删，skipped 恒 0）") @DeleteMapping("/batch")
    public DeleteResultDTO batchDelete(@Valid @RequestBody S10BatchDeleteReq req) {
        return svc.batchDelete(req.ids());
    }
}

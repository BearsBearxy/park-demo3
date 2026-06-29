package com.park.demo3.controller;
import com.park.demo3.dto.*;
import com.park.demo3.service.ElecService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@Tag(name = "附表11 电费成本")
@RestController
@RequestMapping("/api/elec")
public class ElecController {
    private final ElecService svc;
    public ElecController(ElecService svc) { this.svc = svc; }

    @Operation(summary = "期别列表") @GetMapping("/phases")
    public List<ElecPhaseDTO> phases() { return svc.phases(); }

    @Operation(summary = "年份概览（确定性范围；价税合计跨 energy+basic）") @GetMapping("/overview")
    public ElecOverviewDTO overview() { return svc.overview(); }

    @Operation(summary = "某年某类逐月电费台账") @GetMapping("/records")
    public ElecYearDTO records(@RequestParam int year, @RequestParam String type) {
        return svc.records(year, type);
    }

    @Operation(summary = "新增记账（source=manual）") @PostMapping("/records")
    public ElecRecordDTO create(@Valid @RequestBody ElecRecordReq req) { return svc.create(req); }

    @Operation(summary = "改逐行备注") @PatchMapping("/records/{id}/note")
    public ElecRecordDTO updateNote(@PathVariable Integer id, @RequestBody PvNoteReq req) {
        return svc.updateNote(id, req.note());
    }

    @Operation(summary = "删除（seed 锁定 409，不存在 404）") @DeleteMapping("/records/{id}")
    public void delete(@PathVariable Integer id) { svc.delete(id); }
}

package com.park.demo3.controller;
import com.park.demo3.dto.*;
import com.park.demo3.service.ChargingService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@Tag(name = "附表7/8 充电桩")
@RestController
@RequestMapping("/api/charging/{no}")
public class ChargingController {
    private final ChargingService svc;
    public ChargingController(ChargingService svc) { this.svc = svc; }

    @Operation(summary = "充电桩类别列表") @GetMapping("/cats")
    public List<ChargingCatDTO> cats(@PathVariable int no) { return svc.cats(no); }

    @Operation(summary = "年份概览（确定性范围）") @GetMapping("/overview")
    public ChargingOverviewDTO overview(@PathVariable int no) { return svc.overview(no); }

    @Operation(summary = "某年逐月充电台账") @GetMapping("/records")
    public ChargingYearDTO records(@PathVariable int no, @RequestParam int year) { return svc.records(no, year); }

    @Operation(summary = "新增记账（source=manual）") @PostMapping("/records")
    public ChargingRecordDTO create(@PathVariable int no, @Valid @RequestBody ChargingRecordReq req) { return svc.create(no, req); }

    @Operation(summary = "改逐行备注") @PatchMapping("/records/{id}/note")
    public ChargingRecordDTO updateNote(@PathVariable int no, @PathVariable Integer id, @RequestBody ChargingNoteReq req) {
        return svc.updateNote(no, id, req.note());
    }

    @Operation(summary = "删除（seed 锁定 409，不存在 404）") @DeleteMapping("/records/{id}")
    public void delete(@PathVariable int no, @PathVariable Integer id) { svc.delete(no, id); }
}

package com.park.demo3.controller;
import com.park.demo3.dto.*;
import com.park.demo3.service.PvMeterService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import java.util.List;

// 光伏分栋抄表(PV-METER-SPEC)。与附表6 /api/pv 完全独立;GET=viewer 可读,写=admin(SecurityConfig 统一门)。
@Tag(name = "光伏分栋抄表")
@RestController
@Validated
@RequestMapping("/api/pv-meter")
public class PvMeterController {
    private final PvMeterService svc;
    public PvMeterController(PvMeterService svc) { this.svc = svc; }

    @Operation(summary = "电站列表(13 站种子,按 sort 升序)") @GetMapping("/stations")
    public List<PvStationDTO> stations() { return svc.stationList(); }

    @Operation(summary = "新增电站(名称唯一 409)") @PostMapping("/stations")
    public PvStationDTO createStation(@Valid @RequestBody PvStationReq req) { return svc.createStation(req); }

    @Operation(summary = "编辑电站(名称/期数/容量/单价;调价只影响之后新录记录)") @PutMapping("/stations/{id}")
    public PvStationDTO updateStation(@PathVariable Integer id, @Valid @RequestBody PvStationReq req) {
        return svc.updateStation(id, req);
    }

    @Operation(summary = "删除电站(有抄表记录 409;不存在 404)") @DeleteMapping("/stations/{id}")
    public void deleteStation(@PathVariable Integer id) { svc.deleteStation(id); }

    @Operation(summary = "有抄表记录的年份(升序;空表=[],年选择器数据驱动)") @GetMapping("/years")
    public List<Integer> years() { return svc.years(); }

    @Operation(summary = "某年月抄表记录(month 可空=全年,ENERGY-ANALYSIS §4;可选按站过滤;行含 price_snap 与派生收益)") @GetMapping("/readings")
    public List<PvReadingDTO> readings(@RequestParam @Min(2000) @Max(2100) int year,
                                       @RequestParam(required = false) @Min(1) @Max(12) Integer month,
                                       @RequestParam(required = false) Integer stationId) {
        return svc.readingList(year, month, stationId);
    }

    @Operation(summary = "新增抄表记录(source=manual;price_snap=当时站单价;同站同日 409)") @PostMapping("/readings")
    public PvReadingDTO createReading(@Valid @RequestBody PvReadingReq req) { return svc.createReading(req); }

    @Operation(summary = "编辑抄表记录(日期/三量/备注;price_snap 保持原快照不变)") @PutMapping("/readings/{id}")
    public PvReadingDTO updateReading(@PathVariable Integer id, @Valid @RequestBody PvReadingReq req) {
        return svc.updateReading(id, req);
    }

    @Operation(summary = "删除抄表记录(不存在 404)") @DeleteMapping("/readings/{id}")
    public void deleteReading(@PathVariable Integer id) { svc.deleteReading(id); }

    @Operation(summary = "批量导入(行自带楼栋名+日期,(站,日)幂等 upsert;行级错误跳过不整批拦)") @PostMapping("/import")
    public ImportResultDTO importRows(@Valid @RequestBody PvMeterImportRequest req) { return svc.importRows(req); }

    @Operation(summary = "模拟填充(按附表6 phase 月度汇总反推站容量/单价(只填空位)并按容量占比拆分各栋月末记录;只写空位与 simulated,绝不覆盖 manual/import;幂等)")
    @PostMapping("/simulate")
    public PvSimulateResultDTO simulate(@RequestParam @Min(2000) @Max(2100) int year) { return svc.simulate(year); }
}

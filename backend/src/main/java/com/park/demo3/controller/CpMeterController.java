package com.park.demo3.controller;
import com.park.demo3.dto.*;
import com.park.demo3.service.CpMeterService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import java.util.List;

// 充电桩分桩明细(CP-METER-SPEC)。与附表7/8 /api/charging 完全独立(功能门只是入口分叉);
// GET=viewer 可读,写=admin(SecurityConfig 统一门)。结构同 PvMeterController。
@Tag(name = "充电桩分桩明细")
@RestController
@Validated
@RequestMapping("/api/cp-meter")
public class CpMeterController {
    private final CpMeterService svc;
    public CpMeterController(CpMeterService svc) { this.svc = svc; }

    @Operation(summary = "充电桩列表(3 桩种子,按 sort 升序;汽车/电动车屏前端按 vehicleType 过滤)") @GetMapping("/stations")
    public List<CpStationDTO> stations() { return svc.stationList(); }

    @Operation(summary = "新增充电桩(名称唯一 409)") @PostMapping("/stations")
    public CpStationDTO createStation(@Valid @RequestBody CpStationReq req) { return svc.createStation(req); }

    @Operation(summary = "编辑充电桩(名称/运营商/类型)") @PutMapping("/stations/{id}")
    public CpStationDTO updateStation(@PathVariable Integer id, @Valid @RequestBody CpStationReq req) {
        return svc.updateStation(id, req);
    }

    @Operation(summary = "删除充电桩(有充电记录 409;不存在 404)") @DeleteMapping("/stations/{id}")
    public void deleteStation(@PathVariable Integer id) { svc.deleteStation(id); }

    @Operation(summary = "有充电记录的年份(升序;空表=[],年选择器数据驱动)") @GetMapping("/years")
    public List<Integer> years() { return svc.years(); }

    @Operation(summary = "有充电记录的账期('YYYY-MM' 升序;空表=[],默认月数据驱动)") @GetMapping("/months")
    public List<String> months() { return svc.months(); }

    @Operation(summary = "某年月充电记录(month 可空=全年,ENERGY-ANALYSIS §4;可选按桩过滤)") @GetMapping("/readings")
    public List<CpReadingDTO> readings(@RequestParam @Min(2000) @Max(2100) int year,
                                       @RequestParam(required = false) @Min(1) @Max(12) Integer month,
                                       @RequestParam(required = false) Integer stationId) {
        return svc.readingList(year, month, stationId);
    }

    @Operation(summary = "新增充电记录(source=manual;三金额≥0 全手填;同桩同日 409)") @PostMapping("/readings")
    public CpReadingDTO createReading(@Valid @RequestBody CpReadingReq req) { return svc.createReading(req); }

    @Operation(summary = "编辑充电记录(日期/三金额/备注;桩不可改)") @PutMapping("/readings/{id}")
    public CpReadingDTO updateReading(@PathVariable Integer id, @Valid @RequestBody CpReadingReq req) {
        return svc.updateReading(id, req);
    }

    @Operation(summary = "删除充电记录(不存在 404)") @DeleteMapping("/readings/{id}")
    public void deleteReading(@PathVariable Integer id) { svc.deleteReading(id); }

    @Operation(summary = "某年月电表与损耗(每运营商×类型一行,行含 month;month 可空=各月并集;lossKwh=电表−Σ充电量 读时派生,可为负)") @GetMapping("/power-usage")
    public List<CpPowerUsageDTO> powerUsage(@RequestParam @Min(2000) @Max(2100) int year,
                                            @RequestParam(required = false) @Min(1) @Max(12) Integer month) {
        return svc.powerUsageList(year, month);
    }

    @Operation(summary = "录入/修改电表用电量(uk 运营商×类型×月 upsert)") @PutMapping("/power-usage")
    public CpPowerUsageDTO upsertPowerUsage(@Valid @RequestBody CpPowerUsageReq req) {
        return svc.upsertPowerUsage(req);
    }

    @Operation(summary = "批量导入(行自带桩名+日期,(桩,日)幂等 upsert;行级错误跳过不整批拦)") @PostMapping("/import")
    public ImportResultDTO importRows(@Valid @RequestBody CpMeterImportRequest req) { return svc.importRows(req); }

    @Operation(summary = "模拟填充(按附表7/8 充电汇总推导分桩月末记录与电表用电量;只写空位与 simulated,绝不覆盖 manual/import;幂等)")
    @PostMapping("/simulate")
    public CpSimulateResultDTO simulate(@RequestParam @Min(2000) @Max(2100) int year) { return svc.simulate(year); }
}

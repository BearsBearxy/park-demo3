package com.park.demo3.controller;
import com.park.demo3.dto.*;
import com.park.demo3.service.ElecCostService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Pattern;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import java.util.List;

// 电费成本模型(ELEC-COST-SPEC)。与附表11 /api/elec 完全独立(功能门入口分叉,原功能零改动);
// GET=viewer 可读,写=admin(SecurityConfig 统一门)。
@Tag(name = "电费成本总览")
@RestController
@Validated
@RequestMapping("/api/elec-cost")
public class ElecCostController {
    private final ElecCostService svc;
    public ElecCostController(ElecCostService svc) { this.svc = svc; }

    @Operation(summary = "电表列表(8 表种子,按 sort 升序)") @GetMapping("/meters")
    public List<ElecMeterDTO> meters() { return svc.meterList(); }

    @Operation(summary = "新增电表(名称唯一 409)") @PostMapping("/meters")
    public ElecMeterDTO createMeter(@Valid @RequestBody ElecMeterReq req) { return svc.createMeter(req); }

    @Operation(summary = "编辑电表(改名自由;有费项数据不可改类型 409)") @PutMapping("/meters/{id}")
    public ElecMeterDTO updateMeter(@PathVariable Integer id, @Valid @RequestBody ElecMeterReq req) {
        return svc.updateMeter(id, req);
    }

    @Operation(summary = "删除电表(有费项数据 409;不存在 404)") @DeleteMapping("/meters/{id}")
    public void deleteMeter(@PathVariable Integer id) { svc.deleteMeter(id); }

    @Operation(summary = "有数据的年份(升序;空表=[],年选择器数据驱动)") @GetMapping("/years")
    public List<Integer> years() { return svc.years(); }

    @Operation(summary = "有数据的账期('YYYY-MM' 升序;空表=[],默认月数据驱动)") @GetMapping("/months")
    public List<String> months() { return svc.months(); }

    @Operation(summary = "某年月费项行(含 source;合计行与拆分行并存照返,黄警前端判)") @GetMapping("/entries")
    public List<ElecCostEntryDTO> entries(@RequestParam @Min(2000) @Max(2100) int year,
                                          @RequestParam @Min(1) @Max(12) int month) {
        return svc.entryList(year, month);
    }

    @Operation(summary = "费项月度值 upsert(键=表/月/费项/拆分;source 置 manual)") @PutMapping("/entries")
    public ElecCostEntryDTO upsertEntry(@Valid @RequestBody ElecCostEntryReq req) { return svc.upsertEntry(req); }

    @Operation(summary = "删除费项行(不存在 404)") @DeleteMapping("/entries/{id}")
    public void deleteEntry(@PathVariable Integer id) { svc.deleteEntry(id); }

    @Operation(summary = "电价参数(4 键;解析值=当月优先回退默认,附月度/默认原值)") @GetMapping("/price-cfg")
    public List<ElecPriceCfgDTO> priceCfg(
            @RequestParam(required = false) @Pattern(regexp = "(\\d{4}-(0[1-9]|1[0-2]))?") String acctMonth) {
        return svc.priceCfg(acctMonth);
    }

    @Operation(summary = "电价参数 upsert(acctMonth 空=默认行;value=null 删行回退默认)") @PutMapping("/price-cfg")
    public void savePriceCfg(@Valid @RequestBody ElecPriceCfgReq req) { svc.savePriceCfg(req); }

    @Operation(summary = "批量导入(长表:电表|费项|拆分|月份|金额|电量|备注;(表,月,费项,拆分) upsert,行级错误跳过)")
    @PostMapping("/import")
    public ImportResultDTO importRows(@Valid @RequestBody ElecCostImportRequest req) { return svc.importRows(req); }

    @Operation(summary = "模拟填充(按附表11/6/13 推导;只写空位与 simulated,绝不覆盖 manual/import;幂等)")
    @PostMapping("/simulate")
    public ElecSimulateResultDTO simulate(@RequestParam @Min(2000) @Max(2100) int year) { return svc.simulate(year); }

    @Operation(summary = "派生指标 1-7(算不出 value=null + missing 列缺失源)") @GetMapping("/metrics")
    public List<ElecMetricDTO> metrics(@RequestParam @Min(2000) @Max(2100) int year,
                                       @RequestParam @Min(1) @Max(12) int month) {
        return svc.metrics(year, month);
    }

    @Operation(summary = "派生指标年度序列(12 月×7 卡;口径与单月端点全等,ENERGY-ANALYSIS §4)") @GetMapping("/metrics-year")
    public List<ElecMetricsMonthDTO> metricsYear(@RequestParam @Min(2000) @Max(2100) int year) {
        return svc.metricsYear(year);
    }
}

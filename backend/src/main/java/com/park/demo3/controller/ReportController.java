package com.park.demo3.controller;
import com.park.demo3.dto.ImportResultDTO;
import com.park.demo3.dto.ReportCustomRowDTO;
import com.park.demo3.dto.ReportImportRequest;
import com.park.demo3.dto.ReportPeriodDTO;
import com.park.demo3.dto.ReportSaveReq;
import com.park.demo3.dto.ReportYearDTO;
import com.park.demo3.service.ReportService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

@Tag(name = "报表(利润表)")
@RestController
@Validated
@RequestMapping("/api/reports/{statement}")
public class ReportController {
    private final ReportService svc;
    public ReportController(ReportService svc) { this.svc = svc; }

    // 字面量段 /years 比 /{companyId}/{year} 更特异,Spring PathPattern 优先匹配,不冲突
    @Operation(summary = "有数据的年份+各年月份数(年份门)") @GetMapping("/{companyId}/years")
    public java.util.List<com.park.demo3.dto.YearMonthsDTO> years(@PathVariable String statement,
                                                                  @PathVariable int companyId) {
        return svc.years(statement, companyId);
    }

    @Operation(summary = "年历(各月 hasData + 营业收入预览)") @GetMapping("/{companyId}/{year}")
    public ReportYearDTO year(@PathVariable String statement, @PathVariable int companyId,
                              @PathVariable @Min(2000) @Max(2100) int year) {
        return svc.year(statement, companyId, year);
    }

    @Operation(summary = "单公司本期读") @GetMapping("/{companyId}/{year}/{month}")
    public ReportPeriodDTO period(@PathVariable String statement, @PathVariable int companyId,
                                  @PathVariable @Min(2000) @Max(2100) int year,
                                  @PathVariable @Min(1) @Max(12) int month) {
        return svc.period(statement, companyId, year, month);
    }

    @Operation(summary = "全部汇总本期(跨公司求和,只读)") @GetMapping("/all/{year}/{month}")
    public ReportPeriodDTO allPeriod(@PathVariable String statement,
                                     @PathVariable @Min(2000) @Max(2100) int year,
                                     @PathVariable @Min(1) @Max(12) int month) {
        return svc.allPeriod(statement, year, month);
    }

    @Operation(summary = "保存本期金额(clear+insert)") @PutMapping("/{companyId}/{year}/{month}")
    public ReportPeriodDTO save(@PathVariable String statement, @PathVariable int companyId,
                                @PathVariable @Min(2000) @Max(2100) int year,
                                @PathVariable @Min(1) @Max(12) int month,
                                @RequestBody ReportSaveReq req) {
        return svc.save(statement, companyId, year, month, req);
    }

    // 契约对齐前端 api/report.ts:JSON body {parentKey,label,level},level 可空缺省 1
    public record CustomRowReq(String parentKey, String label, Integer level) {}

    @Operation(summary = "加自定义子类") @PostMapping("/{companyId}/custom-row")
    public ReportCustomRowDTO addCustomRow(@PathVariable String statement, @PathVariable int companyId,
                                           @RequestBody CustomRowReq req) {
        return svc.addCustomRow(statement, companyId, req.parentKey(), req.label(),
                req.level() == null ? 1 : req.level());
    }

    @Operation(summary = "删自定义子类(级联删后代+金额)") @DeleteMapping("/custom-row/{id}")
    public void deleteCustomRow(@PathVariable String statement, @PathVariable long id) {
        svc.deleteCustomRow(statement, id);
    }

    @Operation(summary = "导入本期(多公司段,未匹配公司自动新建)") @PostMapping("/import")
    public ImportResultDTO importRows(@PathVariable String statement,
                                      @RequestParam @Min(2000) @Max(2100) int year,
                                      @RequestParam @Min(1) @Max(12) int month,
                                      @RequestBody ReportImportRequest req) {
        return svc.importRows(statement, year, month, req);
    }
}

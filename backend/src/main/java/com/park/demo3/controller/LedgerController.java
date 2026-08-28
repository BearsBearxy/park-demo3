package com.park.demo3.controller;
import com.park.demo3.dto.*;
import com.park.demo3.service.LedgerService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

@Tag(name = "月度台账")
@RestController
@Validated
@RequestMapping("/api/ledger")
public class LedgerController {
    private final LedgerService svc;
    public LedgerController(LedgerService svc) { this.svc = svc; }

    @Operation(summary = "有数据的年份+各年月份数(年份门)") @GetMapping("/companies/{id}/years")
    public java.util.List<YearMonthsDTO> years(@PathVariable Integer id) { return svc.years(id); }

    @Operation(summary = "年度概览") @GetMapping("/companies/{id}/overview")
    public LedgerOverviewDTO overview(@PathVariable Integer id, @RequestParam @Min(2000) @Max(2100) int year) {
        return svc.overview(id, year);
    }

    @Operation(summary = "月度宽表（稀疏补零成全部在租租户）") @GetMapping("/companies/{id}/months/{year}/{month}")
    public LedgerMonthDTO month(@PathVariable Integer id, @PathVariable @Min(2000) @Max(2100) int year,
                               @PathVariable @Min(1) @Max(12) int month) {
        return svc.month(id, year, month);
    }

    @Operation(summary = "保存月度宽表（upsert / 删空）") @PutMapping("/companies/{id}/months/{year}/{month}")
    public LedgerMonthDTO save(@PathVariable Integer id, @PathVariable @Min(2000) @Max(2100) int year,
                              @PathVariable @Min(1) @Max(12) int month,
                              @Valid @RequestBody LedgerSaveRequest req) {
        return svc.save(id, year, month, req);
    }

    @Operation(summary = "从上月复制（结余结转）") @PostMapping("/companies/{id}/months/{year}/{month}/copy-from-prev")
    public LedgerMonthDTO copyFromPrev(@PathVariable Integer id, @PathVariable @Min(2000) @Max(2100) int year,
                                      @PathVariable @Min(1) @Max(12) int month) {
        return svc.copyFromPrev(id, year, month);
    }

    @Operation(summary = "批量导入（按租户名解析 + 逐行定向 upsert，不删未导入租户）") @PostMapping("/companies/{id}/import")
    public ImportResultDTO importRows(@PathVariable Integer id, @RequestParam @Min(2000) @Max(2100) int year,
                                      @RequestParam @Min(1) @Max(12) int month,
                                      @Valid @RequestBody LedgerImportRequest req) {
        return svc.importRows(id, year, month, req);
    }

    @Operation(summary = "按账面名批量绑定档案（跨公司跨月挂未绑定行；目标月已有该租户行则计入 conflicts）")
    @PutMapping("/bind-tenant")
    public BindResultDTO bindTenant(@Valid @RequestBody TenantBindReq req) { return svc.bindTenant(req); }

    @Operation(summary = "行级绑定/换绑/解绑（tenantId=null 即解绑；同月撞车 409）")
    @PatchMapping("/rows/{rowId}/tenant")
    public LedgerMonthDTO.LedgerRowDTO bindRow(@PathVariable Integer rowId,
                                               @RequestBody RowTenantBindReq req) {
        return svc.bindRow(rowId, req.tenantId(), Boolean.TRUE.equals(req.addAlias()));
    }

    @Operation(summary = "行级改账面名（只动快照；未绑定行改对名字自动配档）")
    @PatchMapping("/rows/{rowId}/tenant-name")
    public LedgerMonthDTO.LedgerRowDTO renameRow(@PathVariable Integer rowId,
                                                 @Valid @RequestBody RowTenantRenameReq req) {
        return svc.renameRow(rowId, req.tenantName());
    }
}

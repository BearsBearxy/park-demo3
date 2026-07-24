package com.park.demo3.controller;
import com.park.demo3.dto.*;
import com.park.demo3.service.ContractService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@Tag(name = "合同")
@RestController
@RequestMapping("/api/contracts")
public class ContractController {
    private final ContractService svc;
    public ContractController(ContractService svc) { this.svc = svc; }

    @Operation(summary = "合同列表（含派生；asOfDate 非空则某日在租过滤）") @GetMapping
    public List<ContractDTO> list(@RequestParam(required = false) String asOfDate) { return svc.list(asOfDate); }

    @Operation(summary = "合同 KPI 汇总") @GetMapping("/summary")
    public ContractSummaryDTO summary() { return svc.summary(); }

    @Operation(summary = "新增合同") @PostMapping
    public ContractDTO create(@Valid @RequestBody ContractCreateReq req) { return svc.create(req); }

    @Operation(summary = "合同详情（含租户快照）") @GetMapping("/{id}")
    public ContractDetailDTO detail(@PathVariable Integer id) { return svc.detail(id); }

    @Operation(summary = "编辑合同（全字段 PUT 语义）") @PutMapping("/{id}")
    public ContractDTO update(@PathVariable Integer id, @Valid @RequestBody ContractCreateReq req) {
        return svc.update(id, req);
    }

    @Operation(summary = "终止合同（其占用单元派生回空置）") @PostMapping("/{id}/terminate")
    public ContractDTO terminate(@PathVariable Integer id) { return svc.terminate(id); }

    @Operation(summary = "续签合同（原合同终止，新合同继承租户/楼栋/单元）") @PostMapping("/{id}/renew")
    public ContractDTO renew(@PathVariable Integer id, @Valid @RequestBody ContractRenewReq req) {
        return svc.renew(id, req);
    }

    @Operation(summary = "删除合同（仅用于误录；留档费项级联删）") @DeleteMapping("/{id}")
    public void delete(@PathVariable Integer id) { svc.delete(id); }

    // ─── 计费行批量导入(BILL-FORWARD 刀1 三次返工 §1.7,FeeRow 1:1) ──────
    // 每行=一份合同的计费行合集;按合同整组替换 source='import' 行,manual 保留;落库后反向同步五标量缓存;行级错误跳过。
    @Operation(summary = "批量导入合同计费行（整组替换 import 行,manual 保留;反向同步五标量缓存）")
    @PostMapping("/billing-lines/import")
    public ImportResultDTO importBillingLines(@Valid @RequestBody BillingLinesImportRequest req) {
        return svc.importBillingLines(req);
    }

    // ─── 合同全量导入(V55):期限原文 + 整组计费行,一行=一户 ──────
    // 租户按 企业全称优先/简称+期兜底 匹配;合同 单份直用/多份取最新期/无则自动新建(C2024M-序);
    // 期限原文三字段落库;计费行整组替换 import 行(manual 保留);行级错误(类型钉死越界等)跳过。
    @Operation(summary = "合同全量导入（期限原文+计费行；自动匹配/新建合同，行级错误跳过）")
    @PostMapping("/import-full")
    public ContractFullImportRequest.Result importFull(@Valid @RequestBody ContractFullImportRequest req) {
        return svc.importFull(req);
    }
}

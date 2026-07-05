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

    @Operation(summary = "合同列表（含派生）") @GetMapping
    public List<ContractDTO> list() { return svc.list(); }

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

    @Operation(summary = "删除合同（仅用于误录）") @DeleteMapping("/{id}")
    public void delete(@PathVariable Integer id) { svc.delete(id); }
}

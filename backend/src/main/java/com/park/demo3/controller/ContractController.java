package com.park.demo3.controller;
import com.park.demo3.dto.*;
import com.park.demo3.service.ContractService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
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

    @Operation(summary = "合同详情（含租户快照）") @GetMapping("/{id}")
    public ContractDetailDTO detail(@PathVariable Integer id) { return svc.detail(id); }
}

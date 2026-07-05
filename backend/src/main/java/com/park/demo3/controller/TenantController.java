package com.park.demo3.controller;
import com.park.demo3.dto.*;
import com.park.demo3.service.TenantService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;
import java.util.List;
@Tag(name = "租户")
@RestController
@RequestMapping("/api/tenants")
public class TenantController {
    private final TenantService svc;
    public TenantController(TenantService svc) { this.svc = svc; }
    @Operation(summary = "租户列表(含派生)") @GetMapping
    public List<TenantDTO> list() { return svc.list(); }
    @Operation(summary = "租户 KPI 汇总") @GetMapping("/summary")
    public TenantSummaryDTO summary() { return svc.summary(); }
    @Operation(summary = "新增租户") @PostMapping
    public TenantDTO create(@Valid @RequestBody TenantCreateReq req) { return svc.create(req); }
    @Operation(summary = "编辑租户（全量 PUT，含状态）") @PutMapping("/{id}")
    public TenantDTO update(@PathVariable Integer id, @Valid @RequestBody TenantUpdateReq req) {
        return svc.update(id, req);
    }
    @Operation(summary = "删除租户（有合同/台账记录时 409）") @DeleteMapping("/{id}")
    public void delete(@PathVariable Integer id) { svc.delete(id); }
    @Operation(summary = "租户详情（含合同历史）") @GetMapping("/{id}")
    public TenantDetailDTO detail(@PathVariable Integer id) { return svc.detail(id); }
}

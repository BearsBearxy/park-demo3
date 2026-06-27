package com.park.demo3.controller;
import com.park.demo3.dto.*;
import com.park.demo3.service.TenantService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
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
}

package com.park.demo3.controller;
import com.park.demo3.dto.*;
import com.park.demo3.service.BuildingService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@Tag(name = "楼栋")
@RestController
@RequestMapping("/api/buildings")
public class BuildingController {
    private final BuildingService svc;
    public BuildingController(BuildingService svc) { this.svc = svc; }

    @Operation(summary = "楼栋列表(含派生聚合)") @GetMapping
    public List<BuildingDTO> list() { return svc.list(); }

    @Operation(summary = "楼栋 KPI 汇总") @GetMapping("/summary")
    public BuildingSummaryDTO summary() { return svc.summary(); }

    @Operation(summary = "楼栋详情（含单元列表）") @GetMapping("/{id}")
    public BuildingDetailDTO detail(@PathVariable Integer id) { return svc.detail(id); }
}

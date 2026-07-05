package com.park.demo3.controller;
import com.park.demo3.dto.*;
import com.park.demo3.service.BuildingService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
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

    @Operation(summary = "新建楼栋(可选按层×每层单元数自动生成单元)") @PostMapping
    public BuildingDTO create(@Valid @RequestBody BuildingCreateReq req) { return svc.create(req); }

    @Operation(summary = "楼栋详情（含单元列表）") @GetMapping("/{id}")
    public BuildingDetailDTO detail(@PathVariable Integer id) { return svc.detail(id); }

    @Operation(summary = "编辑楼栋（名称/期数/层数/面积/状态/备注；编辑不重算单元）") @PutMapping("/{id}")
    public BuildingDTO update(@PathVariable Integer id, @Valid @RequestBody BuildingUpdateReq req) {
        return svc.update(id, req);
    }

    @Operation(summary = "删除楼栋（有合同 409；单元随 FK 级联删除）") @DeleteMapping("/{id}")
    public void delete(@PathVariable Integer id) { svc.delete(id); }
}

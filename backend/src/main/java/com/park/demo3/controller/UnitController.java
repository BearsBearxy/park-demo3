package com.park.demo3.controller;
import com.park.demo3.dto.*;
import com.park.demo3.service.BuildingService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;

@Tag(name = "单元")
@RestController
@RequestMapping("/api/units")
public class UnitController {
    private final BuildingService svc;
    public UnitController(BuildingService svc) { this.svc = svc; }

    @Operation(summary = "编辑单元（层/单元号/面积；同栋重号 409；超层数 409）") @PutMapping("/{id}")
    public UnitDTO update(@PathVariable Integer id, @Valid @RequestBody UnitUpdateReq req) {
        return svc.updateUnit(id, req);
    }

    @Operation(summary = "删除单元（存在合同记录不论状态 409）") @DeleteMapping("/{id}")
    public void delete(@PathVariable Integer id) { svc.deleteUnit(id); }
}

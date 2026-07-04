package com.park.demo3.controller;
import com.park.demo3.dto.*;
import com.park.demo3.service.CompanyService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@Tag(name = "管理公司")
@RestController
@RequestMapping("/api/companies")
public class CompanyController {
    private final CompanyService svc;
    public CompanyController(CompanyService svc) { this.svc = svc; }

    @Operation(summary = "公司列表") @GetMapping
    public List<CompanyDTO> list() { return svc.list(); }

    @Operation(summary = "新建公司") @PostMapping
    public CompanyDTO create(@Valid @RequestBody CompanyNameReq req) { return svc.create(req.name()); }

    @Operation(summary = "公司改名") @PutMapping("/{id}")
    public CompanyDTO rename(@PathVariable Integer id, @Valid @RequestBody CompanyNameReq req) {
        return svc.rename(id, req.name());
    }

    @Operation(summary = "删除公司（级联删除其全部台账与报表数据）") @DeleteMapping("/{id}")
    public void delete(@PathVariable Integer id) { svc.delete(id); }
}

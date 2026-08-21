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

    @Operation(summary = "公司列表（含收款账户）") @GetMapping
    public List<CompanyDTO> list() { return svc.list(); }

    @Operation(summary = "新建公司") @PostMapping
    public CompanyDTO create(@Valid @RequestBody CompanyReq req) { return svc.create(req); }

    @Operation(summary = "编辑公司（改名/全称/启停用；null 字段保持不变）") @PutMapping("/{id}")
    public CompanyDTO update(@PathVariable Integer id, @Valid @RequestBody CompanyReq req) {
        return svc.update(id, req);
    }

    @Operation(summary = "删除公司（名下有台账/报表数据时先 409 报行数，force=true 才连数据一起删）") @DeleteMapping("/{id}")
    // force=true 才连数据一起删;缺省先 409 把影响行数报出来(见 CompanyService.delete 注释)
    public void delete(@PathVariable Integer id,
                       @RequestParam(defaultValue = "false") boolean force) { svc.delete(id, force); }

    @Operation(summary = "新增收款账户") @PostMapping("/{id}/accounts")
    public CompanyAccountDTO addAccount(@PathVariable Integer id, @Valid @RequestBody CompanyAccountReq req) {
        return svc.addAccount(id, req);
    }
}

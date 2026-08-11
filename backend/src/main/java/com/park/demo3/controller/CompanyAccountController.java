package com.park.demo3.controller;
import com.park.demo3.dto.CompanyAccountDTO;
import com.park.demo3.dto.CompanyAccountReq;
import com.park.demo3.service.CompanyService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;

// 账户按 id 改删(路径与 /api/companies 平级,故独立 controller;新增在 CompanyController 的 /{id}/accounts)
@Tag(name = "管理公司")
@RestController
@RequestMapping("/api/company-accounts")
public class CompanyAccountController {
    private final CompanyService svc;
    public CompanyAccountController(CompanyService svc) { this.svc = svc; }

    @Operation(summary = "改收款账户（设为默认时自动清掉同公司旧默认）") @PutMapping("/{id}")
    public CompanyAccountDTO update(@PathVariable Integer id, @Valid @RequestBody CompanyAccountReq req) {
        return svc.updateAccount(id, req);
    }

    @Operation(summary = "删收款账户") @DeleteMapping("/{id}")
    public void delete(@PathVariable Integer id) { svc.deleteAccount(id); }
}

package com.park.demo3.controller;
import com.park.demo3.dto.BudgetImportRequest;
import com.park.demo3.dto.BudgetRowDTO;
import com.park.demo3.dto.ImportResultDTO;
import com.park.demo3.service.BudgetService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.*;
import java.util.List;

// 年度预算(全面预算总表,年度粒度)。鉴权走全局 /api/** JWT(SecurityConfig)。
@Tag(name = "年度预算")
@RestController
@RequestMapping("/api/budget")
public class BudgetController {
    private final BudgetService svc;
    public BudgetController(BudgetService svc) { this.svc = svc; }

    @Operation(summary = "导入(按 payload 出现年整年替换)") @PostMapping("/import")
    public ImportResultDTO importRows(@RequestBody BudgetImportRequest req) { return svc.importRows(req); }

    @Operation(summary = "全部行(按 year、sort_order)") @GetMapping("/all")
    public List<BudgetRowDTO> all() { return svc.all(); }
}

package com.park.demo3.controller;
import com.park.demo3.dto.BillRowDTO;
import com.park.demo3.dto.BillS10RowDTO;
import com.park.demo3.dto.PayMapReq;
import com.park.demo3.entity.BillPayCompany;
import com.park.demo3.service.BillsService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@Tag(name = "账单")
@RestController
@Validated
@RequestMapping("/api/bills")
public class BillController {
    private final BillsService svc;
    public BillController(BillsService svc) { this.svc = svc; }

    // GET-only 端点,SecurityConfig 下 viewer 天然可读,无需改安全配置
    @Operation(summary = "某期全部公司账单行（台账×租户×公司，含家族聚合所需 parentId/parentName）") @GetMapping
    public List<BillRowDTO> bills(@RequestParam @Min(2000) @Max(2100) int year,
                                  @RequestParam @Min(1) @Max(12) int month) {
        return svc.bills(year, month);
    }

    @Operation(summary = "某期全部附表10行（应收口径，账单工资条明细；空期空数组）") @GetMapping("/s10")
    public List<BillS10RowDTO> s10(@RequestParam @Min(2000) @Max(2100) int year,
                                   @RequestParam @Min(1) @Max(12) int month) {
        return svc.s10Bills(year, month);
    }

    @Operation(summary = "收款公司指引全量映射（租户×附表10费用列→应转入公司）") @GetMapping("/paymap")
    public List<BillPayCompany> paymap() {
        return svc.paymap();
    }

    // PUT 非 GET,SecurityConfig 写门天然仅 admin(viewer 403),无需改安全配置
    @Operation(summary = "设置收款公司指引（upsert；仅 admin）") @PutMapping("/paymap")
    public void savePaymap(@Valid @RequestBody PayMapReq req) {
        svc.savePaymap(req);
    }
}

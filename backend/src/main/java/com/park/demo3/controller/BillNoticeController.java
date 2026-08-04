package com.park.demo3.controller;
import com.park.demo3.dto.BillNoticeDTO;
import com.park.demo3.dto.BillNoticeDetailDTO;
import com.park.demo3.dto.BillNoticeGenResultDTO;
import com.park.demo3.service.BillNoticeService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.Pattern;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import java.util.List;

// 催缴单派生(S4-BILL-NOTICE-SPEC)。GET=viewer 可读,写=admin(SecurityConfig 统一门)。
@Tag(name = "催缴单")
@RestController
@Validated
@RequestMapping("/api/bill-notices")
public class BillNoticeController {
    private final BillNoticeService svc;
    public BillNoticeController(BillNoticeService svc) { this.svc = svc; }

    @Operation(summary = "按月派生催缴单(幂等:先删本月 draft/void 再插;有 issued 单的租户跳过并计入 warned)")
    @PostMapping("/generate")
    public BillNoticeGenResultDTO generate(@RequestParam @Pattern(regexp = "\\d{4}-\\d{2}") String ym) {
        return svc.generate(ym);
    }

    @Operation(summary = "某月催缴单列表(全状态;含租户/收款公司名与行数)") @GetMapping
    public List<BillNoticeDTO> list(@RequestParam @Pattern(regexp = "\\d{4}-\\d{2}") String ym) {
        return svc.list(ym);
    }

    @Operation(summary = "单据明细(单头+明细行,行序=场地段→表序→段序;含取价审计链)") @GetMapping("/{id}")
    public BillNoticeDetailDTO detail(@PathVariable Integer id) { return svc.detail(id); }

    @Operation(summary = "作废(仅 draft/issued 可作废;已作废 409)") @PostMapping("/{id}/void")
    public BillNoticeDTO voidNotice(@PathVariable Integer id) { return svc.voidNotice(id); }

    @Operation(summary = "签发(仅 draft 可签发;签发后不被重跑覆盖,须先作废)") @PostMapping("/{id}/issue")
    public BillNoticeDTO issue(@PathVariable Integer id) { return svc.issue(id); }
}

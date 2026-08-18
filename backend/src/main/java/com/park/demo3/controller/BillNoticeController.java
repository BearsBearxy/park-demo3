package com.park.demo3.controller;
import com.park.demo3.dto.BillDeliveryDTO;
import com.park.demo3.dto.BillNoteReq;
import com.park.demo3.dto.BillNoticeDTO;
import com.park.demo3.dto.BillNoticeDetailDTO;
import com.park.demo3.dto.BillNoticeGenResultDTO;
import com.park.demo3.entity.BillNoteOverride;
import com.park.demo3.service.BillNoticeService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
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

    @Operation(summary = "按月派生催缴单(幂等:先删本月 draft/void 再插;已确认/已导出的租户整户跳过,"
        + "计入 warned 与 skippedConfirmed,其单与草稿都原样保留)")
    @PostMapping("/generate")
    public BillNoticeGenResultDTO generate(@RequestParam @Pattern(regexp = "\\d{4}-\\d{2}") String ym) {
        return svc.generate(ym);
    }

    // 放在 /{id} 之前只是为了读起来顺:Spring 的路径匹配字面段优先于模板段,顺序不影响解析
    @Operation(summary = "有单的账期('YYYY-MM' 升序;空表=[],默认月数据驱动)") @GetMapping("/months")
    public List<String> months() { return svc.months(); }

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

    // ── 交付状态流(S20 §1.3):户级批量,该月这些租户的全部单一起流转 ──
    @Operation(summary = "确认无误(draft→confirmed,落确认人与时间;非 draft 单跳过并计数)")
    @PostMapping("/confirm")
    public BillDeliveryDTO.Confirm confirm(@Valid @RequestBody BillDeliveryDTO.Req req) {
        return svc.confirm(req.ym(), req.tenantIds());
    }

    @Operation(summary = "标记已导出(draft/confirmed→exported,刷新导出时间;已作废单不动)")
    @PostMapping("/mark-exported")
    public BillDeliveryDTO.Export markExported(@Valid @RequestBody BillDeliveryDTO.Req req) {
        return svc.markExported(req.ym(), req.tenantIds());
    }

    // ── 备注人工覆盖(V92):独立表挂业务键,重生成不丢;显示优先级=覆盖>引擎备注(前端合成) ──
    @Operation(summary = "该户该月全部备注覆盖(键=fee_key+premise_key+meter_key+seg_key,合并行 meter_key='merged')")
    @GetMapping("/notes")
    public List<BillNoteOverride> notes(@RequestParam @Pattern(regexp = "\\d{4}-\\d{2}") String ym,
                                        @RequestParam Integer tenantId) {
        return svc.notes(ym, tenantId);
    }

    @Operation(summary = "写备注覆盖(upsert;仅 admin)") @PutMapping("/notes")
    public void saveNote(@Valid @RequestBody BillNoteReq req) { svc.saveNote(req); }

    @Operation(summary = "清除备注覆盖=恢复引擎默认备注(幂等;仅 admin)") @DeleteMapping("/notes")
    public void deleteNote(@RequestParam @Pattern(regexp = "\\d{4}-\\d{2}") String ym,
                           @RequestParam Integer tenantId, @RequestParam String feeKey,
                           @RequestParam(defaultValue = "") String premiseKey,
                           @RequestParam(defaultValue = "") String meterKey,
                           @RequestParam(defaultValue = "") String segKey) {
        svc.deleteNote(ym, tenantId, feeKey, premiseKey, meterKey, segKey);
    }
}

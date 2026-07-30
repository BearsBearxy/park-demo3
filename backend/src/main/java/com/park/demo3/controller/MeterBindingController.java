package com.park.demo3.controller;
import com.park.demo3.dto.AutoLinkResultDTO;
import com.park.demo3.dto.MeterBindReq;
import com.park.demo3.dto.MeterBindingDTO;
import com.park.demo3.dto.MeterUsageSummaryDTO;
import com.park.demo3.service.MeterBindingService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.Pattern;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import java.util.List;

// 表→合同绑定(S2-BIND-SPEC §3)。GET=viewer 可读,写=admin(SecurityConfig 统一门)。
@Tag(name = "表→合同绑定")
@RestController
@Validated
@RequestMapping("/api/meters")
public class MeterBindingController {
    private final MeterBindingService svc;
    public MeterBindingController(MeterBindingService svc) { this.svc = svc; }

    @Operation(summary = "归属覆盖率报表(五级规则按账期月读侧派生;summary 各状态计数+漏抄数)")
    @GetMapping("/binding")
    public MeterBindingDTO binding(@RequestParam @Pattern(regexp = "\\d{4}-\\d{2}") String ym) {
        return svc.resolveBinding(ym);
    }

    @Operation(summary = "人工绑定覆盖(写 override;contractId=null 解绑;表/合同不存在 404)")
    @PutMapping("/{id}/bind")
    public void bind(@PathVariable Integer id, @RequestBody MeterBindReq req) {
        svc.bind(id, req.contractId());
    }

    @Operation(summary = "按企业名称原文精确唯一匹配批量挂租户(幂等;返回 linked/skipped)")
    @PostMapping("/auto-link-by-name")
    public AutoLinkResultDTO autoLinkByName() { return svc.autoLinkByName(); }

    @Operation(summary = "户×月用量聚合(S3 输入面;仅 tenant 且已挂租户的表;漏抄计数不硬算)")
    @GetMapping("/usage-summary")
    public List<MeterUsageSummaryDTO> usageSummary(@RequestParam @Pattern(regexp = "\\d{4}-\\d{2}") String ym) {
        return svc.usageSummary(ym);
    }
}

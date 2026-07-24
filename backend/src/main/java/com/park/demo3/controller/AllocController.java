package com.park.demo3.controller;
import com.park.demo3.dto.*;
import com.park.demo3.service.AllocService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Pattern;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import java.util.List;

// 公摊分摊(PB-ALLOCATION-SPEC §4)。GET=viewer 可读,写=admin(SecurityConfig 统一门)。
// 用量唯一来源=P-A meter_reading 派生;本域出口=alloc_result(P-C 缴费单契约)。
@Tag(name = "公摊分摊")
@RestController
@Validated
@RequestMapping("/api/alloc")
public class AllocController {
    private final AllocService svc;
    public AllocController(AllocService svc) { this.svc = svc; }

    @Operation(summary = "年份(抄表年∪结果年,升序;年下拉数据驱动)") @GetMapping("/years")
    public List<Integer> years() { return svc.years(); }

    @Operation(summary = "规则列表(携 meterIds+members;可选 zone 过滤)") @GetMapping("/rules")
    public List<AllocRuleDTO> rules(@RequestParam(required = false) @Pattern(regexp = "p1|p2") String zone) {
        return svc.ruleList(zone);
    }

    @Operation(summary = "新增规则(rule+绑定表+受益人整体保存)") @PostMapping("/rules")
    public AllocRuleDTO createRule(@Valid @RequestBody AllocRuleReq req) { return svc.createRule(req); }

    @Operation(summary = "编辑规则(整体覆盖;规则改了重生成即可,历史月已快照不受影响)") @PutMapping("/rules/{id}")
    public AllocRuleDTO updateRule(@PathVariable Integer id, @Valid @RequestBody AllocRuleReq req) {
        return svc.updateRule(id, req);
    }

    @Operation(summary = "删除规则(有分摊结果 409;不存在 404)") @DeleteMapping("/rules/{id}")
    public void deleteRule(@PathVariable Integer id) { svc.deleteRule(id); }

    @Operation(summary = "参数(默认行∪当月行原值;解析=月行优先回退默认)") @GetMapping("/cfg")
    public List<AllocCfgDTO> cfg(@RequestParam @Pattern(regexp = "\\d{4}-(0[1-9]|1[0-2])") String ym) {
        return svc.cfgList(ym);
    }

    @Operation(summary = "参数 upsert(acctMonth 空=默认行;value=null 删行回退默认)") @PutMapping("/cfg")
    public void saveCfg(@Valid @RequestBody AllocCfgReq req) { svc.saveCfg(req); }

    @Operation(summary = "生成本月(按 ym 先删后插 gen 行幂等;manual 保留;返回缺抄警告清单)") @PostMapping("/generate")
    public AllocGenerateResultDTO generate(@RequestParam @Pattern(regexp = "\\d{4}-(0[1-9]|1[0-2])") String ym) {
        return svc.generate(ym);
    }

    @Operation(summary = "某月分摊结果(户级×费项,快照;含租户/楼栋名)") @GetMapping("/result")
    public List<AllocResultDTO> result(@RequestParam @Pattern(regexp = "\\d{4}-(0[1-9]|1[0-2])") String ym) {
        return svc.resultByYm(ym);
    }

    @Operation(summary = "某户抽屉明细(表级现算;与快照不符标 stale=读数已变可重新生成)") @GetMapping("/result/{tenantId}")
    public List<AllocDetailRowDTO> resultDetail(@PathVariable Integer tenantId,
            @RequestParam @Pattern(regexp = "\\d{4}-(0[1-9]|1[0-2])") String ym) {
        return svc.resultDetail(tenantId, ym);
    }

    @Operation(summary = "手工行 upsert(孵化协议固定收取等;生成时保留不覆盖)") @PostMapping("/result/manual")
    public AllocResultDTO saveManual(@Valid @RequestBody AllocManualReq req) { return svc.saveManual(req); }

    @Operation(summary = "删除结果行(仅 manual 行;gen 行 409)") @DeleteMapping("/result/{id}")
    public void deleteResult(@PathVariable Integer id) { svc.deleteResult(id); }

    @Operation(summary = "损耗与对账(读时派生:损耗率表+已/未分摊+elec-cost 互认提示)") @GetMapping("/recon")
    public AllocReconDTO recon(@RequestParam @Pattern(regexp = "\\d{4}-(0[1-9]|1[0-2])") String ym) {
        return svc.recon(ym);
    }
}

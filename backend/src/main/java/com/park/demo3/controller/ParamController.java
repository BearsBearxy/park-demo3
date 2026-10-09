package com.park.demo3.controller;
import com.park.demo3.dto.*;
import com.park.demo3.security.Perm;
import com.park.demo3.security.SensitiveMask;
import com.park.demo3.service.ParamRegistry;
import com.park.demo3.service.ParamService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Pattern;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import java.util.List;
import java.util.Set;

// 计费参数中心(S21-PARAM-CENTER-SPEC §6)。读写的门在 PermissionRegistry(RBAC-SPEC §15.5);list 的回包另按屏收窄。
// 业务错(注册表外键/上级作用域改错/删被使用版本)HTTP 200+body.code=400;校验错(@Valid/@Pattern)HTTP 400。
@Tag(name = "计费参数")
@RestController
@Validated
@RequestMapping("/api/params")
public class ParamController {
    private static final String YM = "\\d{4}-(0[1-9]|1[0-2])";
    private final ParamService svc;
    public ParamController(ParamService svc) { this.svc = svc; }

    @Operation(summary = "站在 ym 看的全部生效参数行(人话作用域/值/区间/命中链);zone=all|p{n}|dorm;"
        + "scope=作用域前缀过滤(如 rule:/building:),key=逗号分隔键名过滤 —— 其它屏只读镜像用,少拉几百行")
    @GetMapping
    public List<ParamRowDTO> list(@RequestParam @Pattern(regexp = YM) String ym,
                                  @RequestParam(defaultValue = "all") @Pattern(regexp = "all|p\\d+|dorm") String zone,
                                  @RequestParam(required = false) String scope,
                                  @RequestParam(required = false) String key) {
        List<ParamRowDTO> rows = svc.list(ym, zone);
        // 读规则只能按路径放行,挡不住「不带 key 拉全表」:没有计费参数查看的人只拿到自己那几屏要的键(RBAC-SPEC §15.6)
        if (!SensitiveMask.holds(Perm.PARAMS_VIEW)) rows = rows.stream().filter(r -> visibleWithoutParamsView(r.key())).toList();
        if (scope == null && key == null) return rows;
        Set<String> keys = key == null ? null : Set.of(key.split(","));
        return rows.stream().filter(r -> (scope == null || r.scope().startsWith(scope)) && (keys == null || keys.contains(r.key()))).toList();
    }

    /** 键表 = 这几屏现在实际带的 key 参数(勘察清单);只读到看得了的那几屏要的键。 */
    static boolean visibleWithoutParamsView(String key) {
        if (SensitiveMask.holds("alloc:view") && ALLOC_KEYS.contains(key)) return true;
        if (SensitiveMask.holds("alloc-loss:view") && LOSS_KEYS.contains(key)) return true;
        if (SensitiveMask.holds(Perm.BILL_NOTICES_VIEW)) {
            ParamRegistry.Def d = ParamRegistry.get(key);
            if (d != null && d.coefBook()) return true;
        }
        return key.startsWith("pv_") && SensitiveMask.holdsAny(List.of("anomaly:view", "pv-meter-analysis:view"));
    }
    private static final Set<String> ALLOC_KEYS = Set.of("coefficient", "extra_qty", "frozen_2023", "round_scale");
    private static final Set<String> LOSS_KEYS = Set.of("loss_adj_qty", "loss_adj_rate", "loss_rate_manual");

    @Operation(summary = "有状态可看的账期('YYYY-MM' 升序;空表=[]);= status 的 poolSnapshotAt‖billBatchAt 非空月,"
        + "池快照月 ∪ 出单月") @GetMapping("/months")
    public List<String> months() { return svc.months(); }

    @Operation(summary = "状态条:本月电价 n/6、自快照以来改动数、池快照/催缴单批次时间、stale、其它受影响月") @GetMapping("/status")
    public ParamStatusDTO status(@RequestParam @Pattern(regexp = YM) String ym) {
        return svc.status(ym);
    }

    @Operation(summary = "写一行(注册表校验/日志/价目缓存失效);value=null 删版本行;correction=true 改错原地;返回站在 ym(缺省 acctMonth)的新生效行")
    @PutMapping
    public ParamRowDTO put(@Valid @RequestBody ParamPutReq req,
                           @RequestParam(required = false) @Pattern(regexp = YM) String ym) {
        return svc.write(req, ym);
    }

    @Operation(summary = "单键单作用域:版本时间轴 + 变更日志") @GetMapping("/history")
    public ParamHistoryDTO history(@RequestParam String key, @RequestParam(defaultValue = "") String scope) {
        return svc.history(key, scope);
    }

    @Operation(summary = "全页变更记录:影响 ym 的改动 + 该月重算,时间倒序") @GetMapping("/changes")
    public List<ParamHistoryDTO.Change> changes(@RequestParam @Pattern(regexp = YM) String ym,
                                                @RequestParam(defaultValue = "200") int limit) {
        return svc.changes(ym, limit);
    }

    @Operation(summary = "重算本月:池+楼栋损耗 → 催缴单(已确认/已导出户跳过并计数) → 日志 recalc") @PostMapping("/recalc")
    public RecalcResultDTO recalc(@RequestParam @Pattern(regexp = YM) String ym) {
        return svc.recalc(ym);
    }
}

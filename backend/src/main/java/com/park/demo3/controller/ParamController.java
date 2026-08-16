package com.park.demo3.controller;
import com.park.demo3.dto.ParamRowDTO;
import com.park.demo3.dto.ParamStatusDTO;
import com.park.demo3.service.ParamService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.Pattern;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import java.util.List;

// 计费参数中心(S21-PARAM-CENTER-SPEC §6)。GET=已登录可读,写/重算=admin(SecurityConfig 全局门)。
// 业务错(注册表外键/上级作用域改错/删被使用版本)HTTP 200+body.code=400;校验错(@Valid/@Pattern)HTTP 400。
@Tag(name = "计费参数")
@RestController
@Validated
@RequestMapping("/api/params")
public class ParamController {
    private static final String YM = "\\d{4}-(0[1-9]|1[0-2])";
    private final ParamService svc;
    public ParamController(ParamService svc) { this.svc = svc; }

    @Operation(summary = "站在 ym 看的全部生效参数行(四区;人话作用域/值/区间/命中链);zone=all|p1|p2|dorm") @GetMapping
    public List<ParamRowDTO> list(@RequestParam @Pattern(regexp = YM) String ym,
                                  @RequestParam(defaultValue = "all") @Pattern(regexp = "all|p1|p2|dorm") String zone) {
        return svc.list(ym, zone);
    }

    @Operation(summary = "状态条:本月电价 n/6、自快照以来改动数、池快照/催缴单批次时间、stale、其它受影响月") @GetMapping("/status")
    public ParamStatusDTO status(@RequestParam @Pattern(regexp = YM) String ym) {
        return svc.status(ym);
    }
}

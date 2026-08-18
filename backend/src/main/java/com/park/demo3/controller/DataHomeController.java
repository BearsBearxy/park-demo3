package com.park.demo3.controller;
import com.park.demo3.dto.DataHomeOverviewDTO;
import com.park.demo3.service.DataHomeService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.Pattern;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

@Tag(name = "数据中心首页")
@Validated
@RestController
@RequestMapping("/api/data-home")
public class DataHomeController {
    private final DataHomeService svc;
    public DataHomeController(DataHomeService svc) { this.svc = svc; }

    // 不传 ym = 锚定月(出账链最新有数据月,spec §2.2);顶部下拉切月时传具体账期。
    // 一个往返拿齐 period+months+chain+schedules —— 前端不需要先拉月份再决定看哪月。
    @Operation(summary = "数据中心首页(不传 ym = 锚定月:出账链最新有数据月)") @GetMapping("/overview")
    public DataHomeOverviewDTO overview(
            @RequestParam(required = false) @Pattern(regexp = "\\d{4}-(0[1-9]|1[0-2])") String ym) {
        return svc.overview(ym);
    }
}

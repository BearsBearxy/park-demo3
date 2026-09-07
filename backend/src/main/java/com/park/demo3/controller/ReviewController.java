package com.park.demo3.controller;

import com.park.demo3.dto.ReviewDtos.ReasonReq;
import com.park.demo3.dto.ReviewDtos.ReviewRowDTO;
import com.park.demo3.service.ReviewService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * 审核机制(SIDEBAR-UX-REDESIGN §7.4)。
 *
 * GET 不进 PermissionRegistry —— 那张表只管非 GET,读全开。
 * 四个写端点已登记:submit 挂「任一相关 edit 权」(真正的 kind→perm 判定在 ReviewService,
 * 因为要哪个权限点取决于 key 里的 kind,URL 层判不出来),其余三个挂 review:approve。
 *
 * ⚠ 审核键里带冒号(`ledger:7:2024-02`)。冒号在 path segment 里合法,`{key}` 单段能吃下 ——
 * ReviewApiIT 第一条用例就打这个带两个冒号的键,红了说明这个假设不成立,那时改成 @RequestParam,
 * **不要**去改键的格式(格式是 spec §7.1 定的)。
 */
@Tag(name = "审核")
@RestController
@RequestMapping("/api/review")
public class ReviewController {

    private final ReviewService svc;
    public ReviewController(ReviewService svc) { this.svc = svc; }

    @Operation(summary = "某月全部审核键的当前态(含派生 entered 与通过前置缺项)")
    @GetMapping
    public List<ReviewRowDTO> list(@RequestParam String period) { return svc.list(period); }

    @Operation(summary = "某年已落库的审核行(编辑闸用;不含派生 entered,不算前置)")
    @GetMapping("/states")
    public List<ReviewRowDTO> states(@RequestParam int year) { return svc.statesOfYear(year); }

    @Operation(summary = "交审(录入方;需该表的 edit 权,且清单行已做)")
    @PostMapping("/{key}/submit")
    public void submit(@PathVariable String key) { svc.submit(key); }

    @Operation(summary = "通过(审核员;上游未审完返 409)")
    @PostMapping("/{key}/approve")
    public void approve(@PathVariable String key) { svc.approve(key); }

    @Operation(summary = "退回(审核员;理由必填)")
    @PostMapping("/{key}/return")
    public void returnBack(@PathVariable String key, @Valid @RequestBody ReasonReq req) {
        svc.returnBack(key, req.reason());
    }

    @Operation(summary = "撤销审核(审核员;理由必填,下游还挂着已审核则 409)")
    @PostMapping("/{key}/withdraw")
    public void withdraw(@PathVariable String key, @Valid @RequestBody ReasonReq req) {
        svc.withdraw(key, req.reason());
    }
}

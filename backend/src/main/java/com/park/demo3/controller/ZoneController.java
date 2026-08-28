package com.park.demo3.controller;

import com.park.demo3.dto.ZoneDTO;
import com.park.demo3.service.ZoneService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

// ⚠ 必须是 GET。SecurityConfig 的「读全开」只覆盖 GET;换成 POST 会掉进
// PermissionRegistry 的 catch-all,拿到一个语义不对的写权限。
@Tag(name = "期区")
@RestController
@RequestMapping("/api/zones")
public class ZoneController {

    private final ZoneService svc;

    public ZoneController(ZoneService svc) { this.svc = svc; }

    @Operation(summary = "期区候选(building.zone 去重 ∪ 基础清单;dorm 恒排尾)")
    @GetMapping
    public List<ZoneDTO> list() { return svc.list(); }
}

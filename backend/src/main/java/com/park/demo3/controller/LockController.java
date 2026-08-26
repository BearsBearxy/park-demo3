package com.park.demo3.controller;

import com.park.demo3.dto.LockDtos.*;
import com.park.demo3.service.LockService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.*;

/**
 * 编辑锁（CONCURRENCY-SPEC §4.4）。
 *
 * scope 形如 {@code ledger:3:2025-06}（模块:标识:期）。冒号在路径段里合法，
 * 前端刻意**不做 URL 编码** —— encodeURIComponent 会把 `/` 编成 `%2F` 而 Tomcat 默认拒收。
 *
 * 权限在 PermissionRegistry 里登记为「任何已登录账号」，具体的门在 LockService：
 * 一个 :edit 权都没有的账号占锁毫无意义。真正的写入口仍由 WriteAccessManager 把守，
 * 锁只是前置的协作信号，不是安全边界。
 */
@Tag(name = "编辑锁")
@RestController
@RequestMapping("/api/locks")
public class LockController {

    private final LockService svc;
    public LockController(LockService svc) { this.svc = svc; }

    @Operation(summary = "占锁（点「编辑模式」）。已被占返回持有人与已持有/空闲时长")
    @PostMapping("/{scope}")
    public LockDTO acquire(@PathVariable String scope) { return svc.acquire(scope); }

    @Operation(summary = "心跳续锁（20 秒一拍）。返回 evicted 非空即「你被接管了」")
    @PutMapping("/{scope}/heartbeat")
    public HeartbeatDTO heartbeat(@PathVariable String scope, @RequestBody(required = false) HeartbeatReq req) {
        return svc.heartbeat(scope, req == null ? null : req.lastActivityAt());
    }

    @Operation(summary = "释放（点「完成」/ 离页）。非持有人调用是空操作")
    @DeleteMapping("/{scope}")
    public void release(@PathVariable String scope) { svc.release(scope); }

    @Operation(summary = "接管。持有人空闲 ≥20 分钟免授权；活跃中须带授权人账号 + 密码")
    @PostMapping("/{scope}/takeover")
    public LockDTO takeover(@PathVariable String scope, @RequestBody(required = false) TakeoverReq req) {
        return svc.takeover(scope, req);
    }
}

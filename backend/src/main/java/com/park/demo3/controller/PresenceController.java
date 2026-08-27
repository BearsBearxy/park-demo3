package com.park.demo3.controller;

import com.park.demo3.dto.PresenceDtos.*;
import com.park.demo3.service.PresenceService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.*;

/**
 * 在场（PRESENCE 设计稿 §02）。全站唯一的轮询。
 *
 * 零 WebSocket、零 SSE —— CONCURRENCY-SPEC 已定。20 秒一拍的 HTTP 对几十个账号完全够用，
 * 而且它顺带就是编辑锁的心跳通道，不必为「实时」再养一条连接。
 */
@Tag(name = "在场")
@RestController
@RequestMapping("/api/presence")
public class PresenceController {

    private final PresenceService svc;
    public PresenceController(PresenceService svc) { this.svc = svc; }

    @Operation(summary = "心跳（20 秒一拍）：上报我在哪一屏，下发谁在线 + 我是否被接管")
    @PutMapping("/ping")
    public PingResp ping(@RequestBody PingReq req) { return svc.ping(req); }

    @Operation(summary = "离开（登出 / 关页面）")
    @DeleteMapping("/{sid}")
    public void leave(@PathVariable String sid) { svc.leave(sid); }
}

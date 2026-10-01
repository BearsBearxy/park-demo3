package com.park.demo3.controller;

import com.park.demo3.dto.NoticeDtos.NoticeDTO;
import com.park.demo3.dto.NoticeDtos.SystemSeenDTO;
import com.park.demo3.service.NoticeService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * 铃铛(PAGE-BEHAVIOR-SPEC §5)。只读写**本人**的:收件人一律取自令牌,不收入参。
 * 写端点在 PermissionRegistry 登记为 ANY_AUTHENTICATED。
 */
@Tag(name = "通知")
@RestController
@RequestMapping("/api/notices")
public class NoticeController {

    private final NoticeService svc;
    public NoticeController(NoticeService svc) { this.svc = svc; }

    @Operation(summary = "本人最近 30 条「有结果了」,新的在前")
    @GetMapping
    public List<NoticeDTO> list() { return svc.list(me()); }

    @Operation(summary = "打开铃铛:本人全部标为看过")
    @PostMapping("/seen")
    public void seen() { svc.markSeen(me()); }

    @Operation(summary = "系统类看过(更新记录版本号、上次开铃铛时的系统组内容键)")
    @GetMapping("/system-seen")
    public SystemSeenDTO systemSeen() { return svc.systemSeen(me()); }

    @Operation(summary = "记系统类看过;传 null 的那一项保持原值")
    @PostMapping("/system-seen")
    public void saveSystemSeen(@Valid @RequestBody SystemSeenDTO req) { svc.saveSystemSeen(me(), req); }

    private static String me() {
        return SecurityContextHolder.getContext().getAuthentication().getName();
    }
}

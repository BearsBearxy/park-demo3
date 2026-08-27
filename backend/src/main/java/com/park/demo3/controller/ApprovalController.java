package com.park.demo3.controller;

import com.park.demo3.dto.ApprovalDtos.*;
import com.park.demo3.service.ApprovalService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * 远程授权（设计稿 §07）：挑一个在线的主管，把请求弹过去，他在**自己的电脑上**批。
 *
 * ⚠ 补充，不是替代。主管不在电脑前时请求者会干等 —— 前端必须一直留「改为请人走过来」的逃生口。
 *
 * 结果与待批清单都顺着**在场那条唯一的轮询**回传，这里不开第二条通道。
 */
@Tag(name = "远程授权")
@RestController
@RequestMapping("/api/auth/approvals")
public class ApprovalController {

    private final ApprovalService svc;
    public ApprovalController(ApprovalService svc) { this.svc = svc; }

    @Operation(summary = "能批这几个权限点的同事（在线的排前面）")
    @GetMapping("/candidates")
    public List<AuthorizerDTO> candidates(@RequestParam List<String> perms) { return svc.candidates(perms); }

    @Operation(summary = "发起请求（2 分钟内有效）。上下文三行必填 —— 主管远程批准时看不见你的屏幕")
    @PostMapping
    public PendingDTO request(@RequestBody RequestReq req) { return svc.request(req); }

    @Operation(summary = "本人的待批清单（顶栏通知）")
    @GetMapping
    public List<PendingDTO> inbox() { return svc.inbox(); }

    @Operation(summary = "批准 / 拒绝。批准要输**自己的**密码，在自己的电脑上")
    @PostMapping("/{id}")
    public void decide(@PathVariable String id, @RequestBody DecideReq req) { svc.decide(id, req); }
}

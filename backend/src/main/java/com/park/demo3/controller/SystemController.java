package com.park.demo3.controller;

import com.park.demo3.dto.SystemDtos.*;
import com.park.demo3.service.SystemService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * 系统管理（RBAC-SPEC P1）。**全站唯一"读也管"的一段**：
 * GET 要 system:view、非 GET 要 system:edit，由 SecurityConfig 直接判，不走写端点映射表。
 * 不能让财务只读看到所有账号和权限配置。
 *
 * 账号只有停用（{@code /status}），**没有 DELETE** —— 删掉的账号名下有导入记录、
 * 系数簿修改历史、审计痕迹，真删了这些记录成孤儿，追责链断掉。
 */
@Tag(name = "系统管理")
@RestController
@RequestMapping("/api/system")
public class SystemController {
    private final SystemService svc;
    public SystemController(SystemService svc) { this.svc = svc; }

    @Operation(summary = "权限点字典与导航层（角色矩阵屏渲染用；前端不硬编码）")
    @GetMapping("/perms")
    public PermCatalog catalog() { return svc.catalog(); }

    // ── 角色 ──
    @Operation(summary = "角色列表（含权限、导航层、在用账号数）")
    @GetMapping("/roles")
    public List<RoleDTO> roles() { return svc.listRoles(); }

    @Operation(summary = "新建自定义角色")
    @PostMapping("/roles")
    public RoleDTO createRole(@Valid @RequestBody RoleCreateReq req) { return svc.createRole(req); }

    @Operation(summary = "改角色（预置角色的权限与导航层也可改，只有 code 与不可删是固定的）")
    @PutMapping("/roles/{id}")
    public RoleDTO updateRole(@PathVariable Integer id, @Valid @RequestBody RoleUpdateReq req) {
        return svc.updateRole(id, req);
    }

    @Operation(summary = "删角色（预置角色 409；名下有账号 409）")
    @DeleteMapping("/roles/{id}")
    public void deleteRole(@PathVariable Integer id) { svc.deleteRole(id); }

    // ── 用户 ──
    @Operation(summary = "账号列表（q 搜用户名/显示名；status 0停用 1启用；roleId 按角色筛）")
    @GetMapping("/users")
    public List<UserDTO> users(@RequestParam(required = false) String q,
                               @RequestParam(required = false) Integer status,
                               @RequestParam(required = false) Integer roleId) {
        return svc.listUsers(q, status, roleId);
    }

    @Operation(summary = "新建账号（管理员设初始密码；该账号首次登录强制改密）")
    @PostMapping("/users")
    public UserDTO createUser(@Valid @RequestBody UserCreateReq req) { return svc.createUser(req); }

    @Operation(summary = "改账号显示名与角色（用户名不可改：它是审计记录里的身份锚点）")
    @PutMapping("/users/{id}")
    public UserDTO updateUser(@PathVariable Integer id, @Valid @RequestBody UserUpdateReq req) {
        return svc.updateUser(id, req);
    }

    @Operation(summary = "停用/启用账号（停用后下一个请求即失效，不必等令牌过期）")
    @PostMapping("/users/{id}/status")
    public UserDTO setStatus(@PathVariable Integer id, @Valid @RequestBody UserStatusReq req) {
        return svc.setStatus(id, req.status());
    }

    @Operation(summary = "重置密码（重置后该账号下次登录须改密）")
    @PostMapping("/users/{id}/password")
    public void resetPassword(@PathVariable Integer id, @Valid @RequestBody PasswordResetReq req) {
        svc.resetPassword(id, req.password());
    }
}

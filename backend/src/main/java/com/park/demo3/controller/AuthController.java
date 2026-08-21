package com.park.demo3.controller;
import com.park.demo3.dto.*;
import com.park.demo3.dto.SystemDtos.ChangePasswordReq;
import com.park.demo3.service.AuthService;
import com.park.demo3.service.SystemService;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;
@Tag(name = "认证")
@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private final AuthService auth;
    private final SystemService system;
    public AuthController(AuthService auth, SystemService system) { this.auth = auth; this.system = system; }
    @PostMapping("/login")
    public LoginResp login(@Valid @RequestBody LoginReq req) { return auth.login(req); }

    // 本人改密:任何已登录账号都能改自己的,与 system 权限无关 →
    // PermissionRegistry 里登记为 ANY_AUTHENTICATED(不登记的话按「默认拒绝」会 403)。
    @io.swagger.v3.oas.annotations.Operation(summary = "本人修改密码（首次登录强制改密走这里）")
    @PostMapping("/change-password")
    public void changePassword(@Valid @RequestBody ChangePasswordReq req) {
        system.changeOwnPassword(req.currentPassword(), req.newPassword());
    }
}

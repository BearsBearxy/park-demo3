package com.park.demo3.controller;
import com.park.demo3.dto.*;
import com.park.demo3.dto.SystemDtos.ChangePasswordReq;
import com.park.demo3.dto.ElevationDtos.ElevateReq;
import com.park.demo3.dto.ElevationDtos.GrantDTO;
import com.park.demo3.service.AuthService;
import com.park.demo3.service.ElevationService;
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
    private final ElevationService elevation;
    public AuthController(AuthService auth, SystemService system, ElevationService elevation) {
        this.auth = auth; this.system = system; this.elevation = elevation;
    }
    @PostMapping("/login")
    public LoginResp login(@Valid @RequestBody LoginReq req) { return auth.login(req); }

    // 本人改密:任何已登录账号都能改自己的,与 system 权限无关 →
    // PermissionRegistry 里登记为 ANY_AUTHENTICATED(不登记的话按「默认拒绝」会 403)。
    @io.swagger.v3.oas.annotations.Operation(summary = "本人修改密码（首次登录强制改密走这里）")
    @PostMapping("/change-password")
    public void changePassword(@Valid @RequestBody ChangePasswordReq req) {
        system.changeOwnPassword(req.currentPassword(), req.newPassword());
    }

    // ══════════ 主管当场授权提权(ELEVATION-SPEC) ══════════
    // 三个端点的权限在 PermissionRegistry 里:POST 要 elevate:request(viewer/股东连问都不能问),
    // DELETE 任何人可调(结束自己的授权,幂等)。GET 是读,走「读全开」。

    @io.swagger.v3.oas.annotations.Operation(summary = "请主管当场授权(30 分钟)")
    @PostMapping("/elevate")
    public java.util.List<GrantDTO> elevate(@Valid @RequestBody ElevateReq req) { return elevation.elevate(req); }

    @io.swagger.v3.oas.annotations.Operation(summary = "结束本人全部授权(退出编辑模式/登出时调)")
    @DeleteMapping("/elevate")
    public void revokeElevation() { elevation.revoke(); }

    @io.swagger.v3.oas.annotations.Operation(summary = "本人当前有效的授权(刷新页面后恢复横幅)")
    @GetMapping("/elevate")
    public java.util.List<GrantDTO> currentElevation() { return elevation.current(); }

    // 权限点字典。/api/system/perms 也返回同一份,但那条要 system:view ——
    // 而提权弹窗要给**财务专员**看「你缺的是哪几项」,他没有 system:view。
    // 这是个纯静态目录(键+人话名+说明),零敏感信息,GET 走「读全开」。
    // 前端据此渲染,不许自己硬编码这 14 项:加第 15 个时它要自动出现。
    @io.swagger.v3.oas.annotations.Operation(summary = "权限点字典(任何已登录账号可读,提权弹窗用)")
    @GetMapping("/perms")
    public java.util.List<com.park.demo3.security.Perm.Meta> perms() {
        return com.park.demo3.security.Perm.META;
    }
}

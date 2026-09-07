package com.park.demo3.service;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.park.demo3.security.NoReviewGuard;
import com.park.demo3.common.*;
import com.park.demo3.dto.*;
import com.park.demo3.entity.AuthUser;
import com.park.demo3.mapper.AuthUserMapper;
import com.park.demo3.security.JwtUtil;
import com.park.demo3.security.UserPermissionCache;
import java.util.List;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
@Service
public class AuthService {
    // 账号不存在/停用时拿来空跑一次 BCrypt 的固定哈希(cost 10,与种子同档),匹配结果一律丢弃。
    // 存在的意义只是把这两条路径的耗时拉平到「口令错误」量级——否则它们不做哈希、快几十毫秒,
    // 靠响应快慢就能枚举出哪些用户名是真的。
    private static final String DUMMY_HASH = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

    private final AuthUserMapper users; private final PasswordEncoder enc; private final JwtUtil jwt;
    private final LoginRateLimiter limiter; private final HttpServletRequest request;
    private final UserPermissionCache perms;
    public AuthService(AuthUserMapper users, PasswordEncoder enc, JwtUtil jwt,
                       LoginRateLimiter limiter, HttpServletRequest request, UserPermissionCache perms) {
        this.users = users; this.enc = enc; this.jwt = jwt; this.limiter = limiter;
        this.request = request; this.perms = perms;
    }
        @NoReviewGuard(reason = "会话,不是数据录入。进审核等于登录要先过闸,而闸的判定本身要先登录")
public LoginResp login(LoginReq req) {
        String key = LoginRateLimiter.key(clientIp(), req.username());
        if (limiter.isLocked(key)) throw new BizException(ResultCode.TOO_MANY_REQUESTS);
        AuthUser u = users.selectOne(Wrappers.<AuthUser>lambdaQuery().eq(AuthUser::getUsername, req.username()));
        boolean active = u != null && u.getStatus() == 1;
        if (!enc.matches(req.password(), active ? u.getPasswordHash() : DUMMY_HASH) || !active) {
            limiter.recordFailure(key);   // 口令错/查无此人/已停用 一律记一次失败
            throw new BizException(ResultCode.UNAUTHORIZED, "用户名或密码错误");
        }
        limiter.reset(key);
        // 权限与导航层从内存快照取(与 JwtAuthFilter 同一份),不烤进令牌 —— 停用要立刻生效。
        // 缓存里没有 = 账号刚建还没 reload,按零权限返回,重登一次即恢复(不 500)。
        UserPermissionCache.UserAuth ua = perms.get(u.getUsername());
        List<String> ps = ua == null ? List.of() : List.copyOf(ua.perms());
        List<String> nl = ua == null ? List.of("data", "reports", "analysis") : ua.navLayers();
        List<String> rn = ua == null ? List.of() : ua.roleNames();
        return new LoginResp(jwt.generate(u.getUsername(), u.getRole()), u.getUsername(), u.getDisplayName(), u.getRole(),
                             ps, nl, rn, u.getMustChangePassword() != null && u.getMustChangePassword() == 1);
    }
    // 取 XFF 首段(nginx 用 $proxy_add_x_forwarded_for 透传)。首段是客户端自报值、可伪造,
    // 所以 IP 只是尽力而为的分桶维度,不是身份。
    // ponytail: 上限——换 IP 就能换桶,分布式爆破挡不住;键里带 username 保证的是「同源刷同一账号」必被锁。
    //           要真正封住得上账号级锁定或验证码,但那会引入被人拿用户名锁真人的拒绝服务面,本轮不做。
    private String clientIp() {
        String xff = request.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isBlank()) return xff.split(",")[0].trim();
        String ip = request.getRemoteAddr();
        return ip == null ? "unknown" : ip;
    }
}

package com.park.demo3.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import com.park.demo3.dto.ElevationDtos.ElevateReq;
import com.park.demo3.dto.ElevationDtos.GrantDTO;
import com.park.demo3.entity.AuthUser;
import com.park.demo3.mapper.AuthUserMapper;
import com.park.demo3.security.ElevationStore;
import com.park.demo3.security.Perm;
import com.park.demo3.security.UserPermissionCache;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;

/**
 * 主管当场授权提权(ELEVATION-SPEC)。
 *
 * 场景:财务专员要改计费口径 → 点得动 → 弹窗 → 主管走过来在**专员的屏幕上**输自己的账号密码
 * → 专员获得 30 分钟该权限 → 期间所有写操作的审计都记两个人。
 *
 * ⚠ **这个端点是一个口令试错口**:任何已登录账号都能拿它猜主管的密码。
 *   所以它跟登录走同一套失败锁定({@link LoginRateLimiter}),且失败也进审计 ——
 *   「有人在反复试主管密码」必须查得出来,这正是审计存在的意义。
 */
@Service
public class ElevationService {

    // 授权人不存在/停用时空跑一次 BCrypt 的固定哈希,结果丢弃 —— 与 AuthService 同理:
    // 不空跑的话这两条路径快几十毫秒,靠响应快慢就能枚举出哪些用户名是真的。
    private static final String DUMMY_HASH = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

    private final AuthUserMapper users;
    private final PasswordEncoder enc;
    private final UserPermissionCache cache;
    private final ElevationStore store;
    private final LoginRateLimiter limiter;
    private final AuditLogService audit;
    private final HttpServletRequest request;

    public ElevationService(AuthUserMapper users, PasswordEncoder enc, UserPermissionCache cache,
                            ElevationStore store, LoginRateLimiter limiter, AuditLogService audit,
                            HttpServletRequest request) {
        this.users = users; this.enc = enc; this.cache = cache; this.store = store;
        this.limiter = limiter; this.audit = audit; this.request = request;
    }

    public List<GrantDTO> elevate(ElevateReq req) {
        String me = currentUsername();

        // ── 1. 请求的权限点必须干净 ──
        List<String> perms = new ArrayList<>(new LinkedHashSet<>(req.perms()));   // 去重保序
        if (perms.isEmpty()) throw new BizException(ResultCode.BAD_REQUEST, "没有要授权的权限");
        for (String p : perms) {
            if (!Perm.exists(p)) throw new BizException(ResultCode.BAD_REQUEST, "未知权限点:" + p);
            if (!Perm.elevatable(p)) {
                throw new BizException(ResultCode.FORBIDDEN,
                    "「" + label(p) + "」不能靠当场授权获得。系统管理必须本人登录自己的账号去改 —— "
                  + "否则一次 30 分钟的授权就能换来一个永久管理员账号,整套权限当场作废。");
            }
        }

        // ── 2~4. 授权人是谁、密码对不对、他本人有没有这些权限 ──
        AuthUser boss = verifyAuthorizer(req.authorizer(), req.password(), perms, "elevate");

        // ── 5. 发放 ──
        store.grant(me, perms, boss.getUsername());
        audit.logAuthorized("elevate.grant", "perm:" + String.join(",", perms), boss.getUsername(),
            "授权 " + (ElevationStore.TTL_SECONDS / 60) + " 分钟:"
            + String.join("、", perms.stream().map(ElevationService::label).toList()));
        return current();
    }

    /**
     * 「某位同事当场在这台电脑上，用自己的账号密码，为一件他有权做的事背书」——
     * 提权与**编辑锁接管**共用这一套校验。返回授权人；不通过直接抛。
     *
     * ⚠ **两处必须共用，不能各写一份。** 这里面有三样东西是一旦漏抄就静默失效的：
     *   · 与登录同一套失败锁定（这个端点让任何已登录账号都能猜主管的密码）
     *   · 授权人不存在/已停用时空跑一次 BCrypt —— 否则靠响应快慢就能枚举用户名
     *   · 失败也进审计 ——「有人在反复试主管密码」必须查得出来
     * 复制一份的结果不是两份一样的防护，是其中一份先烂掉而没人发现。
     *
     * @param auditAction 审计动作前缀（elevate / lock.takeover），失败时记 {前缀}.deny / .locked
     */
    public AuthUser verifyAuthorizer(String account, String password, List<String> mustHave, String auditAction) {
        String me = currentUsername();

        // 失败锁定:按 ip|授权人 计数(防的是猜某个主管的密码)
        String key = LoginRateLimiter.key(clientIp(), account);
        if (limiter.isLocked(key)) {
            audit.log(auditAction + ".locked", "user:" + account, "授权失败次数过多,已锁定");
            throw new BizException(ResultCode.TOO_MANY_REQUESTS, "授权失败次数过多,请 15 分钟后再试");
        }

        AuthUser boss = users.selectOne(Wrappers.<AuthUser>lambdaQuery().eq(AuthUser::getUsername, account));
        boolean active = boss != null && boss.getStatus() == 1;
        boolean ok = enc.matches(password, active ? boss.getPasswordHash() : DUMMY_HASH) && active;
        if (!ok) {
            limiter.recordFailure(key);
            audit.log(auditAction + ".deny", "user:" + account, "授权账号或密码错误");
            throw new BizException(ResultCode.UNAUTHORIZED, "授权人账号或密码错误");
        }
        limiter.reset(key);

        // 自己给自己授权毫无意义(有权限就不会走到这),但从 API 直接调是可达的 —— 挡掉,
        // 否则审计里会出现「张三授权张三」这种看似有责任人、实则没有的记录。
        if (boss.getUsername().equals(me)) {
            throw new BizException(ResultCode.CONFLICT, "不能给自己授权:请找一位有该权限的同事。");
        }

        // 授权人得真有这些权限
        UserPermissionCache.UserAuth ua = cache.get(boss.getUsername());
        List<String> lacking = mustHave.stream().filter(p -> ua == null || !ua.perms().contains(p)).toList();
        if (!lacking.isEmpty()) {
            String names = String.join("、", lacking.stream().map(ElevationService::label).toList());
            audit.log(auditAction + ".deny", "user:" + boss.getUsername(), "授权人本人无此权限:" + names);
            throw new BizException(ResultCode.FORBIDDEN,
                (boss.getDisplayName() == null ? boss.getUsername() : boss.getDisplayName())
                + " 本人也没有「" + names + "」的权限,授权不了。请找系统管理员或财务主管。");
        }
        return boss;
    }

    /** 退出编辑模式 / 登出 / 主动结束。幂等。 */
    public void revoke() {
        String me = currentUsername();
        if (!store.active(me).isEmpty()) audit.log("elevate.revoke", "user:" + me, "结束授权");
        store.revokeAll(me);
    }

    /** 刷新页面后恢复横幅用。 */
    public List<GrantDTO> current() {
        return store.active(currentUsername()).stream()
            .map(g -> new GrantDTO(g.perm(), label(g.perm()), g.authorizer(),
                                   authorizerName(g.authorizer()), g.expiresAt().toEpochMilli()))
            .toList();
    }

    private String authorizerName(String username) {
        AuthUser u = users.selectOne(Wrappers.<AuthUser>lambdaQuery().eq(AuthUser::getUsername, username));
        return u == null || u.getDisplayName() == null ? username : u.getDisplayName();
    }

    private static String label(String perm) {
        return Perm.META.stream().filter(m -> m.key().equals(perm)).map(Perm.Meta::label).findFirst().orElse(perm);
    }

    private static String currentUsername() {
        var a = SecurityContextHolder.getContext().getAuthentication();
        return a == null || a.getName() == null ? "" : a.getName();
    }

    private String clientIp() {
        String xff = request.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isBlank()) return xff.split(",")[0].trim();
        String ip = request.getRemoteAddr();
        return ip == null ? "unknown" : ip;
    }
}

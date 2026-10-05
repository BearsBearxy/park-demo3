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
    private final UserPermissionCache perms; private final SessionService sessions;
    private final AuditLogService audit;
    public AuthService(AuthUserMapper users, PasswordEncoder enc, JwtUtil jwt,
                       LoginRateLimiter limiter, HttpServletRequest request, UserPermissionCache perms,
                       SessionService sessions, AuditLogService audit) {
        this.users = users; this.enc = enc; this.jwt = jwt; this.limiter = limiter;
        this.request = request; this.perms = perms; this.sessions = sessions; this.audit = audit;
    }
        @NoReviewGuard(reason = "会话,不是数据录入。进审核等于登录要先过闸,而闸的判定本身要先登录")
public LoginResp login(LoginReq req) {
        AuthUser u = users.selectOne(Wrappers.<AuthUser>lambdaQuery().eq(AuthUser::getUsername, req.username()));
        // 先查人,再用库里那份**规范用户名**组限流键:auth_user.username 的排序规则不分重音与全半角,
        // 「ádmin」「ａdmin」都查得到 admin 那一行 —— 按原样输入组键的话每换一种写法就换一个桶,
        // 5 次锁定形同虚设(2026-10-03 安全修复对抗复查)。查无此人才用输入值,那种桶锁不住任何真账号。
        String key = LoginRateLimiter.key(clientIp(), u != null ? u.getUsername() : req.username());
        if (limiter.isLocked(key)) throw new BizException(ResultCode.TOO_MANY_REQUESTS);
        // 停用的账号也按它自己的哈希比:密码对了才说「账号已停用」(10-01 照画布 06-E,规范 §2 第 13 条)。
        // 密码错一律「用户名或密码错误」—— 拿不出密码的人从这里分不出账号是停用还是不存在,不给枚举口。
        boolean pwOk = enc.matches(req.password(), u != null ? u.getPasswordHash() : DUMMY_HASH);
        if (!pwOk || u == null) {
            limiter.recordFailure(key);   // 口令错/查无此人/已停用 一律记一次失败
            loginFailed(u, key, u == null ? "没有这个账号" : "密码不对");
            throw new BizException(ResultCode.UNAUTHORIZED, "用户名或密码错误");
        }
        if (u.getStatus() != 1) {
            limiter.recordFailure(key);   // 照样算失败:限流不因为密码对了就放宽
            loginFailed(u, key, "账号已停用");
            throw new BizException(ResultCode.FORBIDDEN, "账号已停用，请联系管理员");
        }
        limiter.reset(key);
        // 权限与导航层从内存快照取(与 JwtAuthFilter 同一份),不烤进令牌 —— 停用要立刻生效。
        // 缓存里没有 = 账号刚建还没 reload,按零权限返回,重登一次即恢复(不 500)。
        UserPermissionCache.UserAuth ua = perms.get(u.getUsername());
        List<String> ps = ua == null ? List.of() : List.copyOf(ua.perms());
        List<String> nl = ua == null ? List.of("data", "reports", "analysis") : ua.navLayers();
        List<String> rn = ua == null ? List.of() : ua.roleNames();
        // 单会话(V125,用户 2026-09-12 拍板):开新会话前先作废旧的并把 token_version +1,
        // 别处那台设备下一个请求就是 401。注意顺序:先 open 拿到新版本号再签发,
        // 反过来的话刚签的那张会被自己这次 bump 当场作废。
        SessionService.Issued is_ = sessions.open(u, clientIp(), request.getHeader("User-Agent"), "relogin");
        audit.logAs(LoginRateLimiter.user(u.getUsername()), "login", clientIp(), null);
        return new LoginResp(jwt.generate(u.getUsername(), u.getRole(), is_.tokenVersion(), is_.sessionId()),
                             u.getUsername(), u.getDisplayName(), u.getRole(),
                             ps, nl, rn, u.getMustChangePassword() != null && u.getMustChangePassword() == 1,
                             perms.isSuperAdmin(u.getUsername()));
    }
    /**
     * 登录失败进操作日志(用户 2026-10-05 拍板:记登录成败,用户名照限流键的写法,记 IP,不记密码)。
     * 没有这个账号时**不记输入的用户名**:常有人把密码敲进了用户名框,记下来就是把密码写进了日志。
     * 行数有上限,靠两处:
     *  · 已锁定期间(429)的尝试不记 —— 锁定那一下记在第 5 次失败上;真账号每个 地址|账号 15 分钟最多 5 行。
     *  · 没有这个账号:限流键里是敲进去的名字,换一个名字就是一个新桶、永远到不了 5 次 —— 原来每次一行,
     *    一个地址换着名字刷就按请求速率涨(2026-10-05 对抗复查 SEC-1)。改按地址合一个桶(UNKNOWN_BUCKET),
     *    15 分钟里只记第 1 次和第 5 次,其余只计数;刷个不停这个桶一直锁着,后面的都不再记。
     */
    private void loginFailed(AuthUser u, String key, String why) {
        String ip = clientIp();
        long mins = LoginRateLimiter.LOCK_MS / 60_000;
        if (u == null) {
            int n = limiter.recordFailure(LoginRateLimiter.key(ip, UNKNOWN_BUCKET));
            if (n == 1) audit.logAs("", "login.fail", ip, why);
            else if (n == LoginRateLimiter.MAX_FAILURES)
                audit.logAs("", "login.fail", ip, why + "；这个网络地址 " + mins + " 分钟内已试了 " + n + " 次不存在的账号，后面的不再一条条记");
            return;
        }
        String detail = limiter.isLocked(key)
            ? why + "，已连错 " + LoginRateLimiter.MAX_FAILURES + " 次，这个网络地址 " + mins + " 分钟内不能再试这个账号"
            : why;
        audit.logAs(LoginRateLimiter.user(u.getUsername()), "login.fail", ip, detail);
    }
    /** 「没有这个账号」按地址合的那个限流桶。开头是个空字符,真用户名里不会有(SystemDtos 用户名只许字母数字 _ . @ -),撞不上真账号的桶。 */
    private static final String UNKNOWN_BUCKET = "\u0000没有这个账号";

    /**
     * 改了自己的密码之后,给发起修改的这台设备换一张新令牌(用户 2026-10-04 拍板:改完本机不掉线,别处的登录全部退出)。
     * 开一个新会话:旧会话连同它签出去的每一张令牌一起作废 —— 别的设备、被人抄走的那一张都下线,
     * 下一个请求 401、登录页说「密码已修改」。改前是 revokeAll,连本机也踢回登录页,而改密页上写着「当前登录状态保持不变」。
     * 本人改密(SystemService.changeOwnPassword)与在用户管理里给自己重置(resetPassword)都走这里。
     */
    public String reissueAfterPasswordChange(AuthUser u) {
        SessionService.Issued is_ = sessions.open(u, clientIp(), request.getHeader("User-Agent"), "password");
        return jwt.generate(u.getUsername(), u.getRole(), is_.tokenVersion(), is_.sessionId());
    }

    /**
     * 当前账号的权限、导航层、角色名(V133)。App 挂载时调:登录响应里那份会在角色被改后变旧,
     * 铃铛里「角色或权限被改 · 刷新后生效」要靠它说实话。读的是内存快照,零查库。
     */
    public MeResp me() {
        String me = org.springframework.security.core.context.SecurityContextHolder
            .getContext().getAuthentication().getName();
        UserPermissionCache.UserAuth ua = perms.get(me);
        if (ua == null) throw new BizException(ResultCode.UNAUTHORIZED);
        return new MeResp(me, ua.perms().stream().sorted().toList(), ua.navLayers(), ua.roleNames(),
                          perms.isSuperAdmin(me));
    }

    // 取 XFF 首段。frontend/nginx.conf 只信 docker 内网(Caddy)给的 XFF,并把它重写成单个真实 IP 再转过来
    // (2026-10-03 起;原来用 $proxy_add_x_forwarded_for 追加,首段是客户端自报值、可伪造)。
    // 后端本身没有对外端口,所以这里看到的 XFF 一定是 nginx 写的。IP 仍只是尽力而为的分桶维度,不是身份。
    // ponytail: 上限——换 IP 就能换桶,分布式爆破挡不住;键里带 username 保证的是「同源刷同一账号」必被锁。
    //           要真正封住得上账号级锁定或验证码,但那会引入被人拿用户名锁真人的拒绝服务面,本轮不做。
    private String clientIp() {
        String xff = request.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isBlank()) return xff.split(",")[0].trim();
        String ip = request.getRemoteAddr();
        return ip == null ? "unknown" : ip;
    }
}

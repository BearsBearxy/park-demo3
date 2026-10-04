package com.park.demo3.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import com.park.demo3.entity.AuthSession;
import com.park.demo3.entity.AuthUser;
import com.park.demo3.mapper.AuthSessionMapper;
import com.park.demo3.mapper.AuthUserMapper;
import com.park.demo3.security.JwtUtil;
import com.park.demo3.security.NoReviewGuard;
import com.park.demo3.security.UserPermissionCache;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

/**
 * 会话作废（V125）。
 *
 * **闸在 token_version,不在这张表。** 每请求要比对的那个数在 UserPermissionCache 的内存快照里,
 * 零查库。auth_session 是旁路记录:谁在线、从哪登的、被谁踢的,给审计和系统屏看。
 *
 * 单会话:登录时先把这个人所有活着的会话标记作废,再 +1 token_version、建新行。
 * token_version 一动,这个人手上所有旧令牌当场失效 —— 别处那台设备下一个请求就是 401。
 */
@Service
public class SessionService {

    private final AuthUserMapper users;
    private final AuthSessionMapper sessions;
    private final UserPermissionCache cache;
    private final JwtUtil jwt;

    public SessionService(AuthUserMapper users, AuthSessionMapper sessions,
                          UserPermissionCache cache, JwtUtil jwt) {
        this.users = users; this.sessions = sessions; this.cache = cache; this.jwt = jwt;
    }

    /**
     * 一次登录:作废旧会话 + 版本 +1 + 建新行。返回新会话 id 与新版本号,供签发令牌用。
     * by = 被挤掉的那一方听到的理由:登录是 relogin;改了自己的密码、给这台设备换新令牌是 password(AuthService.reissueAfterPasswordChange)。
     */
    @NoReviewGuard(reason = "会话,不是期间数据。与 AuthService.login 同一条路径,进审核等于登录要先请人审")
    @Transactional
    public Issued open(AuthUser u, String clientIp, String userAgent, String by) {
        // 先 +1、且只给还启用的号 +1(2026-10-04 复查):u 是调用方早先读的 —— 登录读完人还要验几百毫秒口令,
        // 这期间被停用,原来照样建一行活会话、回一张令牌(下一个请求才 401,「谁在线」里挂着一个已停用的人)。
        // 现在答密码对了的停用号那一句,本事务回滚、什么都不留。先锁 auth_user 再动 auth_session,
        // 与 setStatus / resetPassword / revokeAll 同序:原来反着,登录撞上停用同一个人可能死锁(按加锁顺序推的,没有测试)。
        int tv = bump(u, true);
        int kicked = revokeLive(u.getUsername(), by);
        String sid = UUID.randomUUID().toString().replace("-", "");
        AuthSession s = new AuthSession();
        s.setId(sid);
        s.setUsername(u.getUsername());
        s.setTokenVersion(tv);
        LocalDateTime now = LocalDateTime.now();
        s.setCreatedAt(now);
        s.setLastSeenAt(now);
        s.setExpiresAt(now.plusNanos(jwt.expireMs() * 1_000_000L));
        s.setClientIp(trim(clientIp, 64));
        s.setUserAgent(trim(userAgent, 255));
        sessions.insert(s);
        // 这个 reason 不是说给刚登进来的人听的 —— 他的令牌 tv 对得上,永远读不到它。
        // 它是说给**刚被挤掉的那一方**听的:他下一个请求 401,靠它知道是“另一台设备登录了”(或“密码已修改”)
        // 而不是被默默踢回登录页。真踢掉了人才写,第一次登录不写。
        cache.applySession(u.getUsername(), tv, sid, kicked > 0 ? by : null);
        return new Issued(sid, tv);
    }

    public record Issued(String sessionId, int tokenVersion) {}

    /**
     * 作废某人当前全部会话。改密、管理员强制登出、本人登出都走这里。
     * by: relogin / password / self / admin:<用户名>
     */
    @NoReviewGuard(reason = "同 open:写的是会话与令牌版本,不是期间数据")
    @Transactional
    public void revokeAll(String username, String by) {
        AuthUser u = users.selectOne(Wrappers.<AuthUser>lambdaQuery().eq(AuthUser::getUsername, username));
        if (u == null) return;
        int tv = bump(u, false);   // 先锁 auth_user,同 open
        revokeLive(username, by);
        // sid 置空:此后这个账号的任何令牌都对不上,直到他重新登录
        cache.applySession(username, tv, null, by);
    }

    /** 活着的会话(按建立时间倒序)。系统屏「谁在线」读它;不在鉴权路径上。 */
    public List<AuthSession> live(String username) {
        return sessions.selectList(Wrappers.<AuthSession>lambdaQuery()
            .eq(AuthSession::getUsername, username)
            .isNull(AuthSession::getRevokedAt)
            .orderByDesc(AuthSession::getCreatedAt));
    }

    /** 返回真正被作废的行数 —— 调用方靠它区分「挤掉了别人」与「本来就没人在线」。 */
    private int revokeLive(String username, String by) {
        AuthSession patch = new AuthSession();
        patch.setRevokedAt(LocalDateTime.now());
        patch.setRevokedBy(trim(by, 64));
        return sessions.update(patch, Wrappers.<AuthSession>lambdaUpdate()
            .eq(AuthSession::getUsername, username)
            .isNull(AuthSession::getRevokedAt));
    }

    /** token_version + 1 并落库,返回新值。activeOnly:号已停用就不 +1,抛「账号已停用」。 */
    private int bump(AuthUser u, boolean activeOnly) {
        // 在库里 +1,不拿 u 里的数 +1(2026-10-04):u 是调用方早先读的 —— 登录读完人还要验几百毫秒口令,
        // 改密读完人还要验旧口令、算新哈希。这期间别人已提交的 +1(被踢、别处登录)会被「旧数 + 1」写回去,
        // 版本号原地踏步、连着两次就往回走(AuthUserLostUpdateIT)。本事务改过的行再读,读到的是自己写的这一版。
        int n = users.update(null, Wrappers.<AuthUser>lambdaUpdate()
            .setSql("token_version = token_version + 1").eq(AuthUser::getId, u.getId())
            .eq(activeOnly, AuthUser::getStatus, 1));
        if (activeOnly && n == 0) throw new BizException(ResultCode.FORBIDDEN, "账号已停用，请联系管理员");
        int tv = users.selectById(u.getId()).getTokenVersion();
        u.setTokenVersion(tv);
        return tv;
    }

    private static String trim(String s, int max) {
        if (s == null) return null;
        return s.length() <= max ? s : s.substring(0, max);
    }
}

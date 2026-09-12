package com.park.demo3.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
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

    /** 一次登录:作废旧会话 + 版本 +1 + 建新行。返回新会话 id 与新版本号,供签发令牌用。 */
    @NoReviewGuard(reason = "会话,不是期间数据。与 AuthService.login 同一条路径,进审核等于登录要先请人审")
    @Transactional
    public Issued open(AuthUser u, String clientIp, String userAgent) {
        revokeLive(u.getUsername(), "relogin");
        int tv = bump(u);
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
        cache.applySession(u.getUsername(), tv, sid);
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
        revokeLive(username, by);
        int tv = bump(u);
        // sid 置空:此后这个账号的任何令牌都对不上,直到他重新登录
        cache.applySession(username, tv, null);
    }

    /** 活着的会话(按建立时间倒序)。系统屏「谁在线」读它;不在鉴权路径上。 */
    public List<AuthSession> live(String username) {
        return sessions.selectList(Wrappers.<AuthSession>lambdaQuery()
            .eq(AuthSession::getUsername, username)
            .isNull(AuthSession::getRevokedAt)
            .orderByDesc(AuthSession::getCreatedAt));
    }

    private void revokeLive(String username, String by) {
        AuthSession patch = new AuthSession();
        patch.setRevokedAt(LocalDateTime.now());
        patch.setRevokedBy(trim(by, 64));
        sessions.update(patch, Wrappers.<AuthSession>lambdaUpdate()
            .eq(AuthSession::getUsername, username)
            .isNull(AuthSession::getRevokedAt));
    }

    /** token_version + 1 并落库,返回新值。null 当 0 —— V125 之前建的行没有这一列的值。 */
    private int bump(AuthUser u) {
        int tv = (u.getTokenVersion() == null ? 0 : u.getTokenVersion()) + 1;
        AuthUser patch = new AuthUser();
        patch.setId(u.getId());
        patch.setTokenVersion(tv);
        users.updateById(patch);
        u.setTokenVersion(tv);
        return tv;
    }

    private static String trim(String s, int max) {
        if (s == null) return null;
        return s.length() <= max ? s : s.substring(0, max);
    }
}

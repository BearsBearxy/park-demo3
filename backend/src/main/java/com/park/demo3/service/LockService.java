package com.park.demo3.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import com.park.demo3.dto.LockDtos.*;
import com.park.demo3.entity.AuthUser;
import com.park.demo3.mapper.AuthUserMapper;
import com.park.demo3.security.Perm;
import com.park.demo3.security.PresenceStore;
import com.park.demo3.security.PresenceStore.LockState;
import com.park.demo3.security.UserPermissionCache;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

/**
 * 编辑锁（CONCURRENCY-SPEC §4）。互斥语义在 {@link PresenceStore}（有单测钉死）；
 * 这里只做**接上账号体系之后才成立**的那几件事：谁有资格占锁、接管走哪条路、审计记谁。
 */
@Service
public class LockService {

    private final PresenceStore store;
    private final ElevationService elevation;
    private final AuditLogService audit;
    private final UserPermissionCache cache;
    private final AuthUserMapper users;

    public LockService(PresenceStore store, ElevationService elevation, AuditLogService audit,
                       UserPermissionCache cache, AuthUserMapper users) {
        this.store = store; this.elevation = elevation; this.audit = audit;
        this.cache = cache; this.users = users;
    }

    public LockDTO acquire(String scope) {
        requireSomeEditPerm();
        LockState held = store.acquire(scope, me(), myName());
        if (held != null) return new LockDTO(false, holderOf(scope, held), null);
        LockState mine = store.state(scope);   // 刚占到,必是自己的、非陈旧
        return LockDTO.ok(mine == null ? null : mine.acquiredAt().toEpochMilli());
    }

    public HeartbeatDTO heartbeat(String scope, Long lastActivityAt) {
        Instant touched = lastActivityAt == null ? Instant.now() : Instant.ofEpochMilli(lastActivityAt);
        PresenceStore.Eviction e = store.heartbeat(scope, me(), touched);
        return new HeartbeatDTO(e == null ? null
            : new EvictionDTO(e.scope(), e.by(), e.byDisplayName(), e.authorizerName()));
    }

    public void release(String scope, Long token) {
        store.release(scope, me(), token);
    }

    /**
     * 接管，两条路径按持有人状态自动分流（CONCURRENCY-SPEC §4.3）。
     *
     * ⚠ **锁转给请求者，不是转给授权人。** 主管授权的是「这件事可以发生」，不是「我来接手」——
     *   初版转给主管，结果请求者还是进不去，除非主管接管后立刻退出、他抢在别人前点进去。
     */
    public LockDTO takeover(String scope, TakeoverReq req) {
        requireSomeEditPerm();
        LockState cur = store.state(scope);
        // 已经空了（心跳超时自愈 / 持有人刚点了完成）→ 就是一次普通的占锁，不必留接管痕迹
        if (cur == null || cur.user().equals(me())) return acquire(scope);

        if (store.isIdle(scope)) {
            long idleMin = Duration.between(cur.lastActivityAt(), Instant.now()).toMinutes();
            store.takeover(scope, me(), myName());
            audit.log("lock.takeover", "scope:" + scope,
                "接管 " + cur.displayName() + " 的编辑锁（持有人已空闲 " + idleMin + " 分钟，免授权）");
            return LockDTO.ok(store.state(scope) == null ? null : store.state(scope).acquiredAt().toEpochMilli());
        }

        // 持有人正在操作 —— 裸接管等于给静默覆盖换了个入口，必须有人当场背书
        if (isBlank(req == null ? null : req.authorizer()) || isBlank(req == null ? null : req.password())) {
            throw new BizException(ResultCode.FORBIDDEN,
                cur.displayName() + " 正在编辑本期（" + Duration.between(cur.lastActivityAt(), Instant.now()).toMinutes()
                + " 分钟前仍在操作）。接管需要财务主管及以上当场授权。");
        }
        AuthUser boss = elevation.verifyAuthorizer(
            req.authorizer(), req.password(), List.of(Perm.LOCK_TAKEOVER), "lock.takeover");

        String bossName = boss.getDisplayName() == null ? boss.getUsername() : boss.getDisplayName();
        store.takeover(scope, me(), myName(), bossName);
        // 审计必须记两个人:手是请求者的,责任是授权人的
        audit.logAuthorized("lock.takeover", "scope:" + scope, boss.getUsername(),
            "接管 " + cur.displayName() + " 的编辑锁（持有人活跃中，经授权）");
        return LockDTO.ok(store.state(scope) == null ? null : store.state(scope).acquiredAt().toEpochMilli());
    }

    // ══════════ 内部 ══════════

    private HolderDTO holderOf(String scope, LockState s) {
        Instant now = Instant.now();
        return new HolderDTO(s.user(), s.displayName(),
            Duration.between(s.acquiredAt(), now).toMillis(),
            Duration.between(s.lastActivityAt(), now).toMillis(),
            store.isIdle(scope));
    }

    /**
     * 一个 edit 权都没有的账号占锁毫无意义 —— 只会变成谁都解不开的堵。
     *
     * ponytail: 只查「有没有任一 :edit」，不按 scope 反查该屏具体要哪一档。
     *   真正的门在 WriteAccessManager 那 126 个写端点上，锁只是前置的协作信号；
     *   按 scope 映射权限点要再维护一张表，而它能多挡住的只有「有 A 屏权限的人去占 B 屏的锁」——
     *   内部系统、有审计、可接管，不值那张表。
     */
    private void requireSomeEditPerm() {
        UserPermissionCache.UserAuth ua = cache.get(me());
        boolean any = ua != null && ua.perms().stream().anyMatch(p -> p.endsWith(":edit"));
        if (!any) throw new BizException(ResultCode.FORBIDDEN, "只读账号不能占用编辑锁");
    }

    private static boolean isBlank(String s) { return s == null || s.isBlank(); }

    private static String me() {
        var a = SecurityContextHolder.getContext().getAuthentication();
        return a == null || a.getName() == null ? "" : a.getName();
    }

    private String myName() {
        AuthUser u = users.selectOne(Wrappers.<AuthUser>lambdaQuery().eq(AuthUser::getUsername, me()));
        return u == null || u.getDisplayName() == null ? me() : u.getDisplayName();
    }
}

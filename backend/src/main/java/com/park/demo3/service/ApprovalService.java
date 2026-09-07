package com.park.demo3.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.park.demo3.security.NoReviewGuard;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import com.park.demo3.dto.ApprovalDtos.*;
import com.park.demo3.entity.AuthUser;
import com.park.demo3.mapper.AuthUserMapper;
import com.park.demo3.security.ApprovalStore;
import com.park.demo3.security.ElevationStore;
import com.park.demo3.security.Perm;
import com.park.demo3.security.PresenceStore;
import com.park.demo3.security.UserPermissionCache;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 远程授权（设计稿 §07）：挑一个在线的主管，把请求弹过去，他在**自己的电脑上**批。
 *
 * ⚠ **它是当场授权的补充，不是替代。** 主管不在电脑前时请求者会干等 ——
 *   界面必须一直留「改为请人走过来」的逃生口（CONCURRENCY-SPEC §4.3 当初否掉它的第二条理由）。
 *
 * 为什么值得做：主管的密码不再离开自己的设备，正好消掉 ELEVATION-SPEC §6 记的那条已知风险
 * （「主管在别人电脑上输密码，有肩窥与键盘记录的风险」）。
 *
 * 授权机制本身**一行没碰** —— 批准最终只调 {@link ElevationStore#grant}，
 * 与当场授权走同一个 store、同一道 WriteAccessManager 咽喉、同一套审计。
 * 换掉的只是「验证主管本人在场」那套仪式。
 */
@Service
public class ApprovalService {

    private static final int LABEL_MAX = 80;

    private final ApprovalStore store;
    private final PresenceStore presence;
    private final UserPermissionCache cache;
    private final ElevationStore elevations;
    private final ElevationService elevation;
    private final AuditLogService audit;
    private final AuthUserMapper users;

    public ApprovalService(ApprovalStore store, PresenceStore presence, UserPermissionCache cache,
                           ElevationStore elevations, ElevationService elevation,
                           AuditLogService audit, AuthUserMapper users) {
        this.store = store; this.presence = presence; this.cache = cache;
        this.elevations = elevations; this.elevation = elevation; this.audit = audit; this.users = users;
    }

    /** 能批这几个权限点的同事。在线的排前面 —— 挑一个不在线的人等于白等两分钟。 */
    public List<AuthorizerDTO> candidates(List<String> perms) {
        List<String> want = clean(perms);
        String me = me();
        Map<String, PresenceStore.Seat> seats = presence.online().stream()
            .collect(Collectors.toMap(PresenceStore.Seat::user, Function.identity(), (a, b) -> a));
        return cache.holdersOf(want).stream()
            .filter(u -> !u.equals(me))       // 不能给自己授权（与当场授权同一条规矩）
            .map(u -> {
                AuthUser au = users.selectOne(Wrappers.<AuthUser>lambdaQuery().eq(AuthUser::getUsername, u));
                PresenceStore.Seat s = seats.get(u);
                return new AuthorizerDTO(u,
                    au == null || au.getDisplayName() == null ? u : au.getDisplayName(),
                    au == null ? null : au.getRole(),
                    s != null,
                    s == null ? -1 : Duration.between(s.heartbeatAt(), Instant.now()).toMillis());
            })
            .sorted(Comparator.comparing((AuthorizerDTO a) -> !a.online())   // 在线优先
                              .thenComparing(AuthorizerDTO::displayName))
            .toList();
    }

    /** 发起请求。请求出现在被指名那位主管的顶栏通知里，2 分钟内有效。 */
    public PendingDTO request(RequestReq req) {
        List<String> perms = clean(req.perms());
        for (String p : perms) {
            if (!Perm.exists(p)) throw new BizException(ResultCode.BAD_REQUEST, "未知权限点:" + p);
            // 与当场授权同一张不可提权名单 —— 换条路径不该换规矩，
            // 否则 system:* 就有了一个绕过去的后门。
            if (!Perm.elevatable(p)) {
                throw new BizException(ResultCode.FORBIDDEN,
                    "「" + Perm.label(p) + "」不能靠授权获得，必须本人登录自己的账号去改。");
            }
        }
        if (isBlank(req.approver())) throw new BizException(ResultCode.BAD_REQUEST, "没有选择授权人");
        if (req.approver().equals(me())) throw new BizException(ResultCode.CONFLICT, "不能请自己授权");
        // 上下文三行是硬要求：主管远程批准时看不见请求者的屏幕，
        // 只写「张三申请 param-policy:edit」的话这功能会退化成看见弹窗就点同意。
        if (isBlank(req.page()) || isBlank(req.action())) {
            throw new BizException(ResultCode.BAD_REQUEST, "请求缺少上下文，主管无从判断");
        }
        UserPermissionCache.UserAuth boss = cache.get(req.approver());
        if (boss == null || !boss.perms().containsAll(perms)) {
            throw new BizException(ResultCode.FORBIDDEN, "这位同事没有这些权限，授权不了");
        }
        AuthUser meRow = users.selectOne(Wrappers.<AuthUser>lambdaQuery().eq(AuthUser::getUsername, me()));
        ApprovalStore.Pending p = store.request(me(),
            meRow == null || meRow.getDisplayName() == null ? me() : meRow.getDisplayName(),
            meRow == null ? null : meRow.getRole(),
            perms, req.approver(),
            new ApprovalStore.Context(clamp(req.page()), clamp(req.action()), clamp(req.impact())));
        audit.log("elevate.ask", "user:" + req.approver(),
            "远程请求授权:" + String.join("、", perms.stream().map(Perm::label).toList()));
        return toDto(p);
    }

    /** 本人请的那次远程授权批了没有。**读一次即消费** —— 否则每 20 秒被同一个结果通知一次。 */
    public OutcomeDTO pollOutcome() {
        ApprovalStore.Outcome o = store.pollOutcome(me());
        return o == null ? null : new OutcomeDTO(o.id(), o.approved(), o.approverName());
    }

    /** 本人的待批清单（顶栏通知）。 */
    public List<PendingDTO> inbox() {
        return store.inboxOf(me()).stream().map(this::toDto).toList();
    }

    /**
     * 批准 / 拒绝。
     *
     * 批准要输**自己的密码，在自己的电脑上** —— 那正是这条路径比当场授权更安全的地方，
     * 也防「主管电脑没锁屏，路过的人替他点了同意」。
     */
        @NoReviewGuard(reason = "提权审批流本身,同 ReviewService 四个动作的豁免理由 ——「审核/审批动作自己再进一次审核」会死锁")
public void decide(String id, DecideReq req) {
        // ⚠ **顺序要紧**：先 peek（不消费）→ 验密码 → 再 take（原子摘走）。
        //   反过来的话密码输错一次请求就没了，请求者对着等待环白等满两分钟、
        //   而他那边什么错误都看不到。take 仍然是「只处理一次」的保证点。
        ApprovalStore.Pending seen = store.peek(id, me());
        if (seen == null) throw new BizException(ResultCode.CONFLICT, "这条请求已经处理过或已过期");

        // 复用当场授权那套护栏：限流、空跑 BCrypt 防用户名枚举、失败进审计。
        // 批准时验的是**自己的**密码 —— 那正是这条路径比当场授权更安全的地方。
        if (req.approve()) elevation.verifyOwnPassword(req.password(), "elevate.remote");

        ApprovalStore.Pending p = store.take(id, me());
        if (p == null) throw new BizException(ResultCode.CONFLICT, "这条请求已经处理过或已过期");

        if (!req.approve()) {
            store.settle(p, false, me(), myName());
            audit.log("elevate.reject", "user:" + p.requester(), "拒绝远程授权请求");
            return;
        }
        elevations.grant(p.requester(), p.perms(), me());
        store.settle(p, true, me(), myName());
        audit.logAuthorized("elevate.grant", "perm:" + String.join(",", p.perms()), me(),
            "远程授权 " + (ElevationStore.TTL_SECONDS / 60) + " 分钟给 " + p.requesterName()
          + ":" + p.context().action());
    }

    // ══════════ 内部 ══════════

    private PendingDTO toDto(ApprovalStore.Pending p) {
        long left = ApprovalStore.TTL.toMillis()
                  - Duration.between(p.createdAt(), Instant.now()).toMillis();
        return new PendingDTO(p.id(), p.requester(), p.requesterName(), p.requesterRole(),
            p.perms(), p.perms().stream().map(Perm::label).toList(),
            p.context().page(), p.context().action(), p.context().impact(), Math.max(0, left));
    }

    private static List<String> clean(List<String> perms) {
        if (perms == null || perms.isEmpty()) throw new BizException(ResultCode.BAD_REQUEST, "没有要授权的权限");
        return List.copyOf(new LinkedHashSet<>(perms));
    }

    private static boolean isBlank(String s) { return s == null || s.isBlank(); }
    private static String clamp(String s) {
        return s == null ? null : (s.length() <= LABEL_MAX ? s : s.substring(0, LABEL_MAX));
    }

    private String myName() {
        AuthUser u = users.selectOne(Wrappers.<AuthUser>lambdaQuery().eq(AuthUser::getUsername, me()));
        return u == null || u.getDisplayName() == null ? me() : u.getDisplayName();
    }

    private static String me() {
        var a = SecurityContextHolder.getContext().getAuthentication();
        return a == null || a.getName() == null ? "" : a.getName();
    }
}

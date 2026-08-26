package com.park.demo3.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.park.demo3.dto.LockDtos.EvictionDTO;
import com.park.demo3.dto.PresenceDtos.*;
import com.park.demo3.entity.AuthUser;
import com.park.demo3.mapper.AuthUserMapper;
import com.park.demo3.security.PresenceStore;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;

/**
 * 在场（PRESENCE 设计稿 §02）。全站**唯一的轮询**，20 秒一拍，一条通道两件事：
 * 登记「我在哪一屏」，顺带在编辑态续锁、并把「你被接管了」带回去。
 */
@Service
public class PresenceService {

    /** label 是客户端供给的展示文本 —— 截断，不解释。不截的话一个坏客户端能把内存撑大。 */
    private static final int LABEL_MAX = 60;

    private final PresenceStore store;
    private final AuthUserMapper users;

    public PresenceService(PresenceStore store, AuthUserMapper users) {
        this.store = store; this.users = users;
    }

    public PingResp ping(PingReq req) {
        String me = me();
        // ⚠ 身份从令牌取，不从请求体取。让客户端报自己是谁，头像组就成了谁都能冒名的地方。
        // ponytail: 每 20 秒一次唯一索引点查。几十个账号 = 约 90 次/分钟，不值得为它加缓存；
        //           而且这样改了显示名 20 秒内就生效。
        AuthUser u = users.selectOne(Wrappers.<AuthUser>lambdaQuery().eq(AuthUser::getUsername, me));
        String name = u == null || u.getDisplayName() == null ? me : u.getDisplayName();
        String role = u == null ? null : u.getRole();

        Instant touched = req.lastActivityAt() == null
            ? Instant.now() : Instant.ofEpochMilli(req.lastActivityAt());

        PresenceStore.Eviction e = store.ping(
            req.sid(), me, name, role, req.scope(), clamp(req.label()), req.mode(), touched);

        return new PingResp(seats(me), e == null ? null
            : new EvictionDTO(e.scope(), e.by(), e.byDisplayName(), e.authorizerName()));
    }

    /** 登出 / 关页面。不清的话他会在别人的头像组里多挂 60 秒。 */
    public void leave(String sid) { store.leave(sid); }

    /**
     * 在线清单，排序即优先级：**编辑中 → 浏览中 → 空闲**，同档内先到先排。
     *
     * 排序放服务端：头像组只显示前 5 个，谁被挤进「+N」是个判断，
     * 三个前端各排各的迟早会不一致。
     */
    private List<SeatDTO> seats(String me) {
        Instant now = Instant.now();
        return store.online().stream()
            .map(s -> new SeatDTO(s.sid(), s.user(), s.displayName(), s.role(),
                s.scope(), s.label(), s.mode(),
                Duration.between(s.since(), now).toMillis(),
                Duration.between(s.heartbeatAt(), now).toMillis(),
                s.user().equals(me)))
            .sorted(Comparator
                .comparingInt((SeatDTO s) -> "edit".equals(s.mode()) ? 0 : 1)
                .thenComparing(SeatDTO::sinceMs, Comparator.reverseOrder()))
            .toList();
    }

    private static String clamp(String label) {
        if (label == null) return null;
        return label.length() <= LABEL_MAX ? label : label.substring(0, LABEL_MAX);
    }

    private static String me() {
        var a = SecurityContextHolder.getContext().getAuthentication();
        return a == null || a.getName() == null ? "" : a.getName();
    }
}

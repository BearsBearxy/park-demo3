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

    /** 一个会话同时握的锁数上限。真实上限是「开着的编辑态屏数」(个位数);超出的只能是坏客户端。 */
    private static final int EDIT_SCOPES_MAX = 16;

    private final PresenceStore store;
    private final AuthUserMapper users;
    private final ApprovalService approvals;

    public PresenceService(PresenceStore store, AuthUserMapper users, ApprovalService approvals) {
        this.store = store; this.users = users; this.approvals = approvals;
    }

    public PingResp ping(PingReq req) {
        String me = me();
        // ⚠ 身份从令牌取，不从请求体取。让客户端报自己是谁，头像组就成了谁都能冒名的地方。
        //
        // 只在这个会话的**第一拍**查库。轮询从 20 秒收到 3 秒之后，每拍都查等于把这条点查
        // 放大 7 倍（30 个账号约 600 次/分钟）—— 而显示名几个月才改一次。
        // 代价写明：改了显示名，已开着的标签页要到下次开页才更新。
        PresenceStore.Seat known = store.seatOf(req.sid());
        String name, role;
        if (known != null) {
            name = known.displayName(); role = known.role();
        } else {
            AuthUser u = users.selectOne(Wrappers.<AuthUser>lambdaQuery().eq(AuthUser::getUsername, me));
            name = u == null || u.getDisplayName() == null ? me : u.getDisplayName();
            role = u == null ? null : u.getRole();
        }

        Instant touched = req.lastActivityAt() == null
            ? Instant.now() : Instant.ofEpochMilli(req.lastActivityAt());

        List<String> editScopes = resolveEditScopes(req);
        List<PresenceStore.Eviction> es = store.ping(
            req.sid(), me, name, role, req.scope(), clamp(req.label()), editScopes, touched);

        // 远程授权顺着同一条通道回来（设计稿 §07）——「要做通知机制」当初是否掉它的理由之一，
        // 而心跳建好之后，它的边际成本就只是响应体多两个字段。
        var out = approvals.pollOutcome();
        List<EvictionDTO> evictions = es.stream()
            .map(e -> new EvictionDTO(e.scope(), e.by(), e.byDisplayName(), e.authorizerName()))
            .toList();
        // 单数 evicted 是给发布前就开着的旧页签的 —— 它们只读这个字段,不给的话被接管零提示
        return new PingResp(seats(me), evictions,
            evictions.isEmpty() ? null : evictions.get(0),
            approvals.inbox(), out);
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
                s.scope(), s.label(), s.mode(), s.editScopes(),
                Duration.between(s.since(), now).toMillis(),
                Duration.between(s.heartbeatAt(), now).toMillis(),
                s.user().equals(me)))
            .sorted(Comparator
                .comparingInt((SeatDTO s) -> "edit".equals(s.mode()) ? 0 : 1)
                .thenComparing(SeatDTO::sinceMs, Comparator.reverseOrder()))
            .toList();
    }

    /**
     * 客户端报的锁清单 → 服务端认的锁清单。
     *
     * · null 元素过滤:List.copyOf 对 [null] 抛 NPE → 整拍 500(在场没登记、别的锁也没续)。
     * · 限 16 把:真实上限是「开着的编辑态屏数」(个位数),超出只能是坏客户端。
     * · **旧页签垫层**:发布前已打开的 SPA 还在发 {mode:'edit', scope},不发 editScopes ——
     *   不认的话它们的锁静默停续,3 分钟后被人直接拿走且双方零提示(2026-08-30 复查坐实)。
     */
    static List<String> resolveEditScopes(PingReq req) {
        List<String> raw = req.editScopes() == null ? List.of()
            : req.editScopes().stream().filter(java.util.Objects::nonNull).limit(EDIT_SCOPES_MAX).toList();
        if (!raw.isEmpty()) return raw;
        return "edit".equals(req.mode()) && req.scope() != null ? List.of(req.scope()) : List.of();
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

/* Copyright (c) 2026 Junyang. All rights reserved. */
package com.park.demo3.security;

import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 编辑锁与在场的内存台账（CONCURRENCY-SPEC §4）。行为由 PresenceStoreTest 逐条驱动。
 */
@Component
public class PresenceStore {

    public record LockState(String scope, String user, String displayName,
                            Instant acquiredAt, Instant heartbeatAt, Instant lastActivityAt) {}

    /**
     * scope → 持有人。互斥靠 {@link ConcurrentHashMap#putIfAbsent} 的原子性 ——
     * 不落库，所以没有唯一索引可用，这就是那把唯一索引。
     */
    private final Map<String, LockState> locks = new ConcurrentHashMap<>();

    private final Clock clock;

    public PresenceStore() { this(Clock.systemUTC()); }
    /** 测试用：超时与空闲判定是这套机制的一半，不能靠 Thread.sleep 去等真实的 3 分钟。 */
    public PresenceStore(Clock clock) { this.clock = clock; }

    /**
     * 心跳超时。断这么久 = 页面关了或断网 —— 锁自动释放，谁都能直接进，不走接管。
     *
     * ⚠ 与「空闲 20 分钟」是**两个不同的计时器**，不能合并：心跳只要页面开着就发，
     * 所以持有人去开会时这个永远不触发，那一格归空闲判定管。合并了就分不出
     * 「页面关了」和「页面开着但人走了」，而这两种的接管门槛不一样。
     */
    public static final Duration HEARTBEAT_TTL = Duration.ofMinutes(3);

    /** 空闲阈值（用户拍板 2026-08-21）。页面开着但这么久没动键鼠 → 任何有该屏 edit 权的人可直接接管。 */
    public static final Duration IDLE_AFTER = Duration.ofMinutes(20);

    private boolean stale(LockState s) {
        return s.heartbeatAt().isBefore(clock.instant().minus(HEARTBEAT_TTL));
    }

    /**
     * 一个人同时握着的活锁上限(安全审计 G4b)。真实上限是开着的编辑态屏数(个位数),
     * 与 PresenceService 一拍最多续 16 把同一个数。由 LockService 在占锁前查。
     */
    public static final int LOCKS_PER_USER = 16;

    /**
     * 心跳断了这么久的锁从表里删掉(惰性,搭在 acquire 上)。scope 是自由字符串,原来陈旧锁永不清理,
     * 循环占随机 scope 能让锁表只增不减直到 OOM(G4b)。
     * 取 1 小时而不是 3 分钟:陈旧锁现在还能被原持有人的心跳续回来(笔记本合盖几分钟再打开照常),
     * 一小时以上没心跳的,按 HEARTBEAT_TTL 那条本来就已经算释放了。
     */
    static final Duration LOCK_FORGET = Duration.ofHours(1);

    /** user 此刻握着的活锁数(不含陈旧的、不含 except 那一把 —— 本人重入同一把不算新占)。 */
    public long liveLocksOf(String user, String except) {
        return locks.values().stream()
            .filter(s -> s.user().equals(user) && !stale(s) && !s.scope().equals(except)).count();
    }

    /** 持有人是否已空闲 ≥20 分钟 —— 决定接管走「直接」还是「须主管授权」。空着的 scope 返回 false。 */
    public boolean isIdle(String scope) {
        LockState cur = locks.get(scope);
        return cur != null && cur.lastActivityAt().isBefore(clock.instant().minus(IDLE_AFTER));
    }

    /** 占锁。成功（或本人重入）返回 null；已被别人占着返回那个人的状态。 */
    public LockState acquire(String scope, String user, String displayName) {
        Instant now = clock.instant();
        Instant forget = now.minus(LOCK_FORGET);
        locks.values().removeIf(s -> s.heartbeatAt().isBefore(forget));
        // compute 对单个 key 是原子的 —— 这就是互斥点，不落库所以没有唯一索引可依。
        // 本人重入时返回 cur 而**不覆盖**：acquiredAt 要从真正的开始时刻算，
        // 否则「已持有 12:41」会被一次深链或 KeepAlive 重建清零。
        LockState after = locks.compute(scope, (k, cur) ->
            (cur != null && !stale(cur)) ? cur : new LockState(scope, user, displayName, now, now, now));
        // ⚠ 合法占到锁的那一刻,清掉自己在这把锁上**未送达的旧通知**。一次性通知永不过期,
        //   不清的话一条几天前没送达的「已被 V 接管」会在下一次合法占锁后的第一拍被消费:
        //   当场弹旧接管、踢出刚进的编辑态,那一拍还跳过续锁(2026-08-30 第三轮复查坐实)。
        //   被拒时(after 不是我的)不清 —— 通知仍是真的,人还没看到。
        if (after.user().equals(user)) { evictions.remove(evictionKey(user, scope)); return null; }
        return after;
    }

    /**
     * 释放。点「完成」/ 离页 / beforeunload 的 sendBeacon。
     *
     * ⚠ **只有持有人放得掉。** 这个口子无鉴权可言:beacon 会在任意时刻补发、陈旧客户端也会发。
     * 不认人的话任何人 DELETE 一下就能踢掉别人的锁 —— 绕开整个接管流程，不留审计、不通知被踢的人。
     */
    public void release(String scope, String user) { release(scope, user, null); }

    /**
     * 带围栏的释放。token = 客户端 acquire 时拿到的 acquiredAt(毫秒)。
     * ⚠ 晚到的 DELETE(不 await 的退出、beacon 补发)没有围栏时会把同一用户**随后又占到的
     *   新锁**误删掉 —— 服务端只认 user。带围栏后只删得掉自己那一代。null = 旧客户端,原行为。
     */
    public void release(String scope, String user, Long token) {
        locks.computeIfPresent(scope, (k, cur) ->
            cur.user().equals(user) && (token == null || cur.acquiredAt().toEpochMilli() == token)
                ? null : cur);
    }

    /**
     * 心跳续锁。lastActivityAt 由前端上报（最后一次键鼠），服务端据此算空闲。
     *
     * 不认人：被接管之后老持有人的心跳打不到这里 —— 那正是他下一次心跳会拿到 409 的原因。
     */
    public Eviction heartbeat(String scope, String user, Instant lastActivityAt) {
        // 先看有没有被接管的**详情**(带授权人)—— 有就当场返回并消费掉，不再续锁
        Eviction notice = evictions.remove(evictionKey(user, scope));
        if (notice != null) return notice;
        LockState after = locks.computeIfPresent(scope, (k, cur) -> cur.user().equals(user)
            ? new LockState(cur.scope(), cur.user(), cur.displayName(),
                            cur.acquiredAt(), clock.instant(), lastActivityAt)
            : cur);
        // ⚠ 「我还持有吗」是**每一拍都重新推导的真相**,不是只送一次的消息(2026-08-30 复查):
        //   一次性通知在响应丢包(前端 catch{} 吞掉)、或被同一用户的另一个标签页先消费掉之后
        //   就永久丢失 —— 而后续心跳只走 computeIfPresent,不续也不报,人留在编辑态继续录,
        //   保存时整片覆盖接管者刚写的东西。改成派生之后,丢一拍下一拍(3 秒)自愈;
        //   陈旧被直接占(那条路从不写 eviction)、锁在别的标签页被还掉、后端重启锁蒸发,
        //   这三种从前完全静默的失锁也一并当面报出来。授权人姓名只有一次性通知里有,
        //   兜底通知拿不到 —— 可接受的降级。
        if (after == null) return new Eviction(scope, null, null, null);          // 锁没了
        if (!after.user().equals(user))
            return new Eviction(scope, after.user(), after.displayName(), null);  // 已易主
        return null;
    }

    /** 被接管的通知。authorizerName 只有「授权接管」那条路径有值。 */
    public record Eviction(String scope, String by, String byDisplayName, String authorizerName) {}

    /**
     * 被接管者的待领通知。**读一次即消费** —— 弹一次就够了，
     * 不消费的话他每 20 秒被同一个弹窗糊一次脸。
     */
    private final Map<String, Eviction> evictions = new ConcurrentHashMap<>();

    private static String evictionKey(String user, String scope) { return user + ' ' + scope; }

    /** 直接接管（持有人空闲 ≥20 分钟，免授权）。 */
    public LockState takeover(String scope, String newUser, String newDisplayName) {
        return takeover(scope, newUser, newDisplayName, null);
    }

    /**
     * 接管。锁转给 newUser —— **不是转给授权人**。返回被接管的那个人（原先空闲则 null）。
     *
     * authorizerName 只有「授权接管」那条路径有值，它会出现在被接管者看到的那句话里：
     * 「你对本期的编辑权已被 李四 接管（由 张主管 授权）」。少了它，被接管的人不知道
     * 这事经过谁同意，也就无从申诉。
     */
    public LockState takeover(String scope, String newUser, String newDisplayName, String authorizerName) {
        Instant now = clock.instant();
        // put 返回旧值且对单 key 原子 —— 不需要 compute 那套回调里捞变量的写法
        LockState evicted = locks.put(scope, new LockState(scope, newUser, newDisplayName, now, now, now));
        if (evicted != null && !evicted.user().equals(newUser)) {
            evictions.put(evictionKey(evicted.user(), scope),
                          new Eviction(scope, newUser, newDisplayName, authorizerName));
        }
        return evicted;
    }

    // ══════════ 在场（P2） ══════════

    /**
     * 一个人此刻在哪一屏。按**会话**记而不是按人 —— 同一个人开两个标签页看两个屏是常态。
     *
     * scope = 他此刻看着的屏;editScopes = 这个会话握着的**全部**锁。
     * 两者分开是 2026-08-30 的修正:原来锁的续期键就是 scope 单槽,第二个屏进编辑态时
     * 把第一个屏的锁顶出心跳,3 分钟后被当陈旧锁静默让给别人 —— 而「同时两个页面在
     * 编辑态」是明写的设计。mode 由 editScopes 派生,不再由客户端申报。
     */
    public record Seat(String sid, String user, String displayName, String role,
                       String scope, String label, String mode, java.util.List<String> editScopes,
                       Instant since, Instant heartbeatAt) {}

    /**
     * 在场的存活期。
     *
     * ⚠ **不能跟着轮询周期一起缩。** 轮询是 3 秒，但浏览器会把**后台标签页**的定时器
     *   节流到约 1 分钟一拍。TTL 缩到十几秒的话，一个把页面切到后台的人会从在线名单里消失，
     *   而他手上的锁还在 —— 别人的按钮就不再显示「李四 编辑中」了，等于标记失效。
     *   60 秒是踩着那条节流线定的。
     *
     * 与锁的 3 分钟仍然是两个数、两个理由：锁掉了代价是重新占（宽容），
     * 在场错了代价是有人按错误信息做决定（从紧）。
     */
    public static final Duration PRESENCE_TTL = Duration.ofSeconds(60);

    /** sid → 座位。key 是**会话**不是人：同一个人开两个标签页看两个屏是常态。 */
    private final Map<String, Seat> seats = new ConcurrentHashMap<>();

    /**
     * 一个人的座位上限(安全审计 G4a)。原来 sid 由客户端给、座位数不设限:换着 sid 刷 ping 就能把座位表撑满,
     * 而每个在线的人每 3 秒都要收一份全表。超了挤掉他自己最久没心跳的那个(多是刷新前的旧标签页),
     * 不拒 —— 拒了的话一个开了很多标签页的正常人会从头像组里消失。
     */
    public static final int SEATS_PER_USER = 8;

    /** 在线清单。顺手清掉过期座位 —— 惰性清理，不起定时任务（同 ElevationStore 的做法）。 */
    public java.util.List<Seat> online() {
        Instant cutoff = clock.instant().minus(PRESENCE_TTL);
        seats.values().removeIf(s -> s.heartbeatAt().isBefore(cutoff));
        return java.util.List.copyOf(seats.values());
    }

    /**
     * 唯一的轮询（20 秒一拍）。**一个 ping 干两件事**：登记在场 + 编辑态续锁。
     *
     * 分成两条的话，编辑态每 20 秒要发两个请求，而且两边的「最后一次活动」各记各的 ——
     * 空闲判定就会有两个不一致的答案，而它决定接管要不要叫主管。
     *
     * @param editScopes 这个会话握着的全部锁 —— **逐把续**。null 当空表。
     * @return 被接管的通知,一把一条(顺着这条通道回传,不需要 WebSocket)
     */
    public java.util.List<Eviction> ping(String sid, String user, String displayName, String role,
                                         String scope, String label,
                                         java.util.List<String> editScopes, Instant lastActivityAt) {
        Instant now = clock.instant();
        java.util.List<String> held = editScopes == null ? java.util.List.of()
                                                         : java.util.List.copyOf(editScopes);
        // mode 由服务端派生,不信客户端申报 —— 免得一个坏客户端不带锁却把自己标成「编辑中」
        String mode = held.isEmpty() ? "view" : "edit";
        if (!seats.containsKey(sid)) {
            java.util.List<Seat> mine = seats.values().stream().filter(s -> s.user().equals(user))
                .sorted(java.util.Comparator.comparing(Seat::heartbeatAt)).toList();
            for (int i = 0; i <= mine.size() - SEATS_PER_USER; i++) seats.remove(mine.get(i).sid());
        }
        seats.compute(sid, (k, cur) -> new Seat(sid, user, displayName, role, scope, label, mode, held,
            // 换了屏就重新计时:「在这一屏待了多久」换屏之后从零算才对
            cur == null || !java.util.Objects.equals(cur.scope(), scope) ? now : cur.since(), now));
        // ⚠ 每一把都要续。只续一把正是被修掉的那个洞:另一把 3 分钟后被当陈旧锁
        //   静默让给别人,且那条路不写 eviction,两边零提示。
        //   heartbeat 的返回值必须逐条透出去 ——「当面提示」是这套机制存在的一半理由。
        java.util.List<Eviction> notices = new java.util.ArrayList<>();
        for (String sc : held) {
            Eviction e = heartbeat(sc, user, lastActivityAt);
            if (e != null) notices.add(e);
        }
        return notices;
    }

    /** 这个会话已经登记过的座位 —— 服务端据此免掉每一拍的身份查库。 */
    public Seat seatOf(String sid) { return seats.get(sid); }

    /** 离开（登出 / 关页面）。留着的话他会在别人的头像组里多挂 60 秒。 */
    public void leave(String sid) { seats.remove(sid); }

    /** 当前持有人（含已陈旧的）。null = 这一期空着。服务端算「已持有多久 / 空闲多久」用。 */
    public LockState state(String scope) {
        LockState cur = locks.get(scope);
        return cur == null || stale(cur) ? null : cur;
    }
}

package com.park.demo3.security;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 编辑锁的互斥语义（CONCURRENCY-SPEC §4）。
 *
 * 这个类存在的理由就一句：**后写静默盖先写**。2025-06 台账两个人同时进编辑模式、
 * 各自保存、各自看到「保存成功」，而先写的那份被还原成后写者打开页面那一刻的快照 ——
 * 库里只剩最后一版，月底对账对不上，回头查也查不出来。
 *
 * 纯内存、不碰数据库，所以是 *Test 不是 *IT：不起 MySQL 容器，秒级跑完。
 */
class PresenceStoreTest {

    private static final String SCOPE = "ledger:3:2025-06";

    private PresenceStore store;
    private TickingClock clock;

    @BeforeEach
    void setUp() {
        clock = new TickingClock();
        store = new PresenceStore(clock);
    }

    /** 超时与空闲是这套机制的一半，不能靠 Thread.sleep 去等真实的 3 分钟。 */
    private static final class TickingClock extends Clock {
        private Instant now = Instant.parse("2026-08-25T10:00:00Z");
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
        void advance(Duration d) { now = now.plus(d); }
    }

    @Test
    void secondUserIsRefusedAndToldWhoHoldsIt() {
        assertThat(store.acquire(SCOPE, "zhangsan", "张三"))
            .as("空闲的期，第一个人必须占得到")
            .isNull();

        PresenceStore.LockState held = store.acquire(SCOPE, "lisi", "李四");

        assertThat(held).as("已被占的期必须拒绝第二个人").isNotNull();
        assertThat(held.user()).isEqualTo("zhangsan");
        assertThat(held.displayName())
            .as("拒绝时必须带上持有人是谁 —— 只说「进不去」用户没法处理")
            .isEqualTo("张三");
    }

    @Test
    void holderCanReacquireItsOwnLock() {
        // 深链(?edit=1)、KeepAlive 淘汰后重建实例、断网重连 —— 都会让同一个人再占一次同一把锁。
        // 把本人当成「被别人占着」的话，用户会看到「张三 正在编辑」而张三就是他自己。
        store.acquire(SCOPE, "zhangsan", "张三");

        assertThat(store.acquire(SCOPE, "zhangsan", "张三"))
            .as("本人重入必须放行")
            .isNull();
    }

    @Test
    void releasingFreesTheScopeForTheNextPerson() {
        store.acquire(SCOPE, "zhangsan", "张三");

        store.release(SCOPE, "zhangsan");

        assertThat(store.acquire(SCOPE, "lisi", "李四"))
            .as("点「完成」/离页之后，下一个人必须进得来")
            .isNull();
    }

    @Test
    void releaseByANonHolderDoesNothing() {
        // release 是个无鉴权的口子：beforeunload 的 sendBeacon 会在任意时刻补发，
        // 陈旧客户端也会发。若不认人，任何人 DELETE 一下就能把别人的锁踢掉 ——
        // 那等于绕开了整个接管流程（不留审计、不通知被踢的人）。
        store.acquire(SCOPE, "zhangsan", "张三");

        store.release(SCOPE, "lisi");

        PresenceStore.LockState still = store.acquire(SCOPE, "lisi", "李四");
        assertThat(still).as("别人的 release 不许动这把锁").isNotNull();
        assertThat(still.user()).isEqualTo("zhangsan");
    }

    @Test
    void aLockGoesStaleThreeMinutesAfterTheHeartbeatStops() {
        // 「任何需要人来解的锁，最后都会变成日常工单」(CONCURRENCY-SPEC §4.2)。
        // 页面被直接关掉 / 断网 → 心跳停 → 锁必须自己掉，不需要谁去解。
        store.acquire(SCOPE, "zhangsan", "张三");

        clock.advance(Duration.ofMinutes(3).plusSeconds(1));

        assertThat(store.acquire(SCOPE, "lisi", "李四"))
            .as("心跳断 3 分钟后锁自愈，下一个人直接进得去，无需接管")
            .isNull();
    }

    @Test
    void heartbeatKeepsTheLockAliveIndefinitely() {
        // 没有这条，每个人录到第 3 分钟锁就掉了 —— 比不加锁还糟。
        store.acquire(SCOPE, "zhangsan", "张三");

        clock.advance(Duration.ofMinutes(2));
        store.heartbeat(SCOPE, "zhangsan", clock.instant());
        clock.advance(Duration.ofMinutes(2));

        assertThat(store.acquire(SCOPE, "lisi", "李四"))
            .as("距上次心跳只过了 2 分钟，锁还在张三手上")
            .isNotNull();
    }

    @Test
    void takeoverTransfersTheLockToTheRequesterNotTheAuthorizer() {
        // CONCURRENCY-SPEC §4.3 的核心纠正：初版让锁归主管，结果请求者还是进不去，
        // 除非主管接管后立刻退出、他抢在别人前点进去 —— 荒唐的竞态。
        store.acquire(SCOPE, "zhangsan", "张三");

        store.takeover(SCOPE, "lisi", "李四");

        PresenceStore.LockState holder = store.acquire(SCOPE, "wangmin", "王敏");
        assertThat(holder).as("接管之后锁仍然被占着").isNotNull();
        assertThat(holder.user())
            .as("锁归请求者 李四，不是授权的那位主管")
            .isEqualTo("lisi");
    }

    @Test
    void theEvictedHolderLearnsAboutItOnItsNextHeartbeat() {
        // 「必须是当面提示，不是等他保存时才 403」(CONCURRENCY-SPEC §4.3)。
        // 心跳是现成的通道，不需要 WebSocket。
        store.acquire(SCOPE, "zhangsan", "张三");
        store.takeover(SCOPE, "lisi", "李四");

        PresenceStore.Eviction notice = store.heartbeat(SCOPE, "zhangsan", clock.instant());

        assertThat(notice).as("老持有人的下一次心跳必须带回被接管的消息").isNotNull();
        assertThat(notice.byDisplayName()).isEqualTo("李四");
    }

    // ══════════ 在场（P2） ══════════
    //
    // 在场与锁是同一份数据的两个视图：「谁在哪一屏」是在场，「谁在哪一屏的编辑态」就是锁。
    // 所以它们共用同一条心跳 —— 不开第二条通道（CONCURRENCY-SPEC §2 / PRESENCE 设计稿 §02）。

    @Test
    void pingPutsSomeoneOnTheOnlineList() {
        store.ping("sess-a", "zhangsan", "张三", "finance_clerk",
                   SCOPE, "月度台账 · 一泽 2025-06", java.util.List.of(), clock.instant());

        var online = store.online();

        assertThat(online).hasSize(1);
        assertThat(online.get(0).displayName()).isEqualTo("张三");
        assertThat(online.get(0).label())
            .as("界面上要显示的是人话「在哪一屏」，不是 scope 键")
            .isEqualTo("月度台账 · 一泽 2025-06");
    }

    @Test
    void oneSessionPerTabNotOnePerUser() {
        // 同一个人开两个标签页看两个屏 —— 顶栏头像组按人去重，但在场表按会话记，
        // 否则后开的那个标签页会把前一个的位置覆盖掉。
        store.ping("sess-1", "zhangsan", "张三", "finance_clerk", "a:1", "台账", java.util.List.of(), clock.instant());
        store.ping("sess-2", "zhangsan", "张三", "finance_clerk", "b:1", "抄表", java.util.List.of(), clock.instant());

        assertThat(store.online()).hasSize(2);
    }

    @Test
    void someoneWhoStoppedPingingDropsOffTheListInOneMinute() {
        // 陈旧的在场是**错误信息**：显示「李四在线」而他两分钟前就关了页面，
        // 会让人白等一个不在的人。所以在场的 TTL 比锁短得多 ——
        // 锁掉了代价是重新占，在场错了代价是有人按错误信息做决定。
        store.ping("sess-a", "zhangsan", "张三", "finance_clerk", SCOPE, "台账", java.util.List.of(), clock.instant());

        clock.advance(Duration.ofSeconds(61));

        assertThat(store.online()).isEmpty();
    }

    @Test
    void anEditModePingAlsoRenewsTheLock() {
        // 一个 ping 干两件事。分成两条轮询的话，编辑态每 20 秒要发两个请求，
        // 而且两者的「最后一次活动」会各记各的，空闲判定就有两个不一致的答案。
        store.acquire(SCOPE, "zhangsan", "张三");

        clock.advance(Duration.ofMinutes(2));
        store.ping("sess-a", "zhangsan", "张三", "finance_clerk", SCOPE, "台账", java.util.List.of(SCOPE), clock.instant());
        clock.advance(Duration.ofMinutes(2));

        assertThat(store.acquire(SCOPE, "lisi", "李四"))
            .as("编辑态的 ping 必须同时续锁，否则第 3 分钟锁自己掉了")
            .isNotNull();
    }

    @Test
    void aPingRenewsEveryLockTheSessionHolds_notJustOne() {
        // 被修掉的洞:续期键原是会话级单槽 scope,同一标签页第二个屏进编辑态时
        // 把第一个屏的锁顶出心跳 —— 3 分钟后被当陈旧锁静默让给别人,且那条路不写 eviction,
        // 两边零提示。而「同时两个页面在编辑态」是明写的设计(EDIT-MODE-SPEC v3)。
        store.acquire("meters:2025", "zhangsan", "张三");
        store.acquire("pv-meter:2025", "zhangsan", "张三");

        clock.advance(Duration.ofMinutes(2));
        store.ping("sess-a", "zhangsan", "张三", "finance_clerk", "pv:screen", "分栋抄表",
                   java.util.List.of("meters:2025", "pv-meter:2025"), clock.instant());
        clock.advance(Duration.ofMinutes(2));   // 距 acquire 已 4 分钟 > TTL,距 ping 2 分钟 < TTL

        assertThat(store.acquire("meters:2025", "lisi", "李四"))
            .as("第一把锁也被续着 —— 只续一把正是那个静默丢锁的洞").isNotNull();
        assertThat(store.acquire("pv-meter:2025", "lisi", "李四"))
            .as("第二把锁照常续着").isNotNull();
    }

    @Test
    void evictionsForEveryHeldScopeComeBackInOnePing() {
        // 两把锁在两拍之间都被接管(极端但可达):通知必须一把一条全部带回,
        // 吞掉任何一条,「当面提示」对那一把就失效了。
        store.acquire("meters:2025", "zhangsan", "张三");
        store.acquire("pv-meter:2025", "zhangsan", "张三");
        store.takeover("meters:2025", "lisi", "李四", "张主管");
        store.takeover("pv-meter:2025", "wangwu", "王五", null);

        var notices = store.ping("sess-a", "zhangsan", "张三", "finance_clerk", null, null,
                                 java.util.List.of("meters:2025", "pv-meter:2025"), clock.instant());

        assertThat(notices).hasSize(2);
        assertThat(notices).extracting(PresenceStore.Eviction::scope)
            .containsExactlyInAnyOrder("meters:2025", "pv-meter:2025");
    }

    @Test
    void seatModeIsDerivedFromHeldLocks_notClientClaim() {
        // mode 由服务端从 editScopes 派生 —— 一个坏客户端不带锁就标不成「编辑中」,
        // 徽标与排序读的都是它,不能信申报。
        store.ping("sess-a", "zhangsan", "张三", "finance_clerk", "a:1", "台账",
                   java.util.List.of(), clock.instant());
        assertThat(store.online().get(0).mode()).isEqualTo("view");

        store.ping("sess-a", "zhangsan", "张三", "finance_clerk", "a:1", "台账",
                   java.util.List.of("ledger:3:2025-06"), clock.instant());
        assertThat(store.online().get(0).mode()).isEqualTo("edit");
        assertThat(store.online().get(0).editScopes()).containsExactly("ledger:3:2025-06");
    }

    @Test
    void aLostTakeoverNoticeIsRederivedOnTheNextPing() {
        // 「我还持有吗」是每一拍都重新推导的真相,不是只送一次的消息:
        // 一次性通知在响应丢包(前端 catch 吞掉)后就没了,而人留在编辑态继续录 ——
        // 保存时整片覆盖接管者刚写的东西。派生之后丢一拍,下一拍(3 秒)自愈。
        store.acquire(SCOPE, "zhangsan", "张三");
        store.takeover(SCOPE, "lisi", "李四", "张主管");

        PresenceStore.Eviction first = store.heartbeat(SCOPE, "zhangsan", clock.instant());
        assertThat(first.authorizerName()).as("第一次拿到带授权人的完整通知").isEqualTo("张主管");

        PresenceStore.Eviction again = store.heartbeat(SCOPE, "zhangsan", clock.instant());
        assertThat(again).as("响应丢了也要能再报 —— 从锁的现状推导").isNotNull();
        assertThat(again.byDisplayName()).isEqualTo("李四");
    }

    @Test
    void aLockReleasedInAnotherTabComesBackAsALoss() {
        // 同一个人两个标签页共持一把锁(服务端本人重入放行,按 user 不按 sid)——
        // A 页还锁,B 页还在编辑态。改前 B 的心跳只是静默不续;现在要当面报失锁。
        store.acquire(SCOPE, "zhangsan", "张三");
        store.release(SCOPE, "zhangsan");

        PresenceStore.Eviction e = store.heartbeat(SCOPE, "zhangsan", clock.instant());
        assertThat(e).as("锁没了必须当面说,不能让他继续对着假编辑态录入").isNotNull();
        assertThat(e.by()).as("没有接管者,by 为空").isNull();
    }

    @Test
    void aStaleLockGrabbedByAcquireStillNotifiesTheOldHolder() {
        // 陈旧路径(合盖 3 分钟+)被 acquire 直接占走**从不写 eviction** ——
        // 改前老持有人醒来后零提示继续编辑。现在第一拍就从现状推导出已易主。
        store.acquire(SCOPE, "zhangsan", "张三");
        clock.advance(Duration.ofMinutes(4));
        store.acquire(SCOPE, "lisi", "李四");   // 陈旧,直接占走

        PresenceStore.Eviction e = store.heartbeat(SCOPE, "zhangsan", clock.instant());
        assertThat(e).isNotNull();
        assertThat(e.byDisplayName()).isEqualTo("李四");
    }

    @Test
    void pingPassesClientActivityThroughToIdleJudgment() {
        // 空闲判定必须用**客户端上报的键鼠时间**,不是服务器收包时间:页面开着心跳一直发,
        // 用 now 的话「空闲 20 分钟可直接接管」永远不触发,接管永远要惊动主管。
        store.acquire(SCOPE, "zhangsan", "张三");
        java.time.Instant idleSince = clock.instant();
        clock.advance(Duration.ofMinutes(25));
        store.ping("sess-a", "zhangsan", "张三", "finance_clerk", SCOPE, "台账",
                   java.util.List.of(SCOPE), idleSince);

        assertThat(store.isIdle(SCOPE))
            .as("人 25 分钟没动键鼠,页面开着 —— 必须判成空闲").isTrue();
    }

    @Test
    void anAuthorizedTakeoverTellsTheEvictedHolderWhoApprovedIt() {
        // 「你对本期的编辑权已被 李四 接管（由 张主管 授权）」——
        // 少了后半句，被接管的人只知道被谁抢了，不知道这事经过谁同意，也就无从申诉。
        store.acquire(SCOPE, "zhangsan", "张三");

        store.takeover(SCOPE, "lisi", "李四", "张主管");

        PresenceStore.Eviction notice = store.heartbeat(SCOPE, "zhangsan", clock.instant());
        assertThat(notice.authorizerName()).isEqualTo("张主管");
    }

    @Test
    void anIdleHolderStillHoldsTheLockButBecomesTakeoverable() {
        // 这条就是「两个计时器不能合并」的全部理由：
        // 页面开着 → 心跳一直在发 → 心跳超时永远不触发；但人去开会了，键鼠 21 分钟没动。
        // 合并成一个字段就分不出「页面关了」和「页面开着但人走了」，而这两种的接管门槛不一样。
        Instant lastTouch = clock.instant();
        store.acquire(SCOPE, "zhangsan", "张三");

        clock.advance(Duration.ofMinutes(21));
        store.heartbeat(SCOPE, "zhangsan", lastTouch);

        assertThat(store.acquire(SCOPE, "lisi", "李四"))
            .as("空闲 ≠ 释放。锁还在张三手上，李四得走接管")
            .isNotNull();
        assertThat(store.isIdle(SCOPE))
            .as("空闲 ≥20 分钟 → 走「直接接管」，不必惊动主管")
            .isTrue();
    }
}

package com.park.demo3.security;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;

import com.park.demo3.dto.ApprovalDtos.DecideReq;
import com.park.demo3.entity.AuthUser;
import com.park.demo3.mapper.AuthUserMapper;
import com.park.demo3.service.ApprovalService;
import com.park.demo3.service.AuditLogService;
import com.park.demo3.service.ElevationService;
import com.park.demo3.service.NoticeService;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * 远程授权的待批队列（设计稿 §07）。
 *
 * 场景：财务专员要改计费口径，主管不在座位上。挑一个**在线**的主管把请求弹过去，
 * 主管在**自己的电脑上**批 —— 密码不再离开他的设备（消掉 ELEVATION-SPEC §6 记的那条已知风险）。
 *
 * ⚠ 这是当场授权的**补充，不是替代**：主管不在电脑前时请求者会干等，
 *   所以界面必须一直留「改为请人走过来」的逃生口（CONCURRENCY-SPEC §4.3 当初否掉它的第二条理由）。
 */
class ApprovalStoreTest {

    private static final List<String> PERMS = List.of("param-policy:edit");
    private static final ApprovalStore.Context CTX = new ApprovalStore.Context(
        "计费参数 · 一泽 2025-06", "修改 loss_rate · A 座", "本月 A 座 41 户的催缴单金额");

    private ApprovalStore store;
    private TickingClock clock;

    @BeforeEach
    void setUp() {
        clock = new TickingClock();
        store = new ApprovalStore(clock);
    }

    private static final class TickingClock extends Clock {
        private Instant now = Instant.parse("2026-08-26T10:00:00Z");
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
        void advance(Duration d) { now = now.plus(d); }
    }

    @Test
    void aRequestLandsOnlyInTheNamedApproversInbox() {
        // 弹给谁就只有谁看得见。广播给所有主管的话，责任就散了 ——
        // 审计里「谁批准的」还查得出来，但「谁本该看见却没看」查不出来。
        store.request("zhangsan", "张三", "finance_clerk", PERMS, "boss-a", CTX);

        assertThat(store.inboxOf("boss-a")).hasSize(1);
        assertThat(store.inboxOf("boss-b")).isEmpty();
    }

    @Test
    void theRequestCarriesTheContextTheApproverNeedsToJudge() {
        // 防批准疲劳的唯一手段。当场授权时主管看得见专员的屏幕；远程批准看不见，
        // 所以「哪一屏、改什么、影响多少户」必须跟着请求走 ——
        // 只写「张三申请 param-policy:edit」的话，这功能会退化成看见弹窗就点同意。
        store.request("zhangsan", "张三", "finance_clerk", PERMS, "boss-a", CTX);

        ApprovalStore.Pending p = store.inboxOf("boss-a").get(0);

        assertThat(p.requesterName()).isEqualTo("张三");
        assertThat(p.context().page()).isEqualTo("计费参数 · 一泽 2025-06");
        assertThat(p.context().action()).isEqualTo("修改 loss_rate · A 座");
        assertThat(p.context().impact()).isEqualTo("本月 A 座 41 户的催缴单金额");
    }

    @Test
    void aRequestExpiresInTwoMinutes() {
        // 短得刻意：请求者正在屏幕前等着。超过两分钟他多半该改走当场授权或直接打个电话，
        // 而一条挂着不动的请求过几小时被批准，比没批更糟 —— 那时他早就不在那一屏了。
        store.request("zhangsan", "张三", "finance_clerk", PERMS, "boss-a", CTX);

        clock.advance(Duration.ofSeconds(121));

        assertThat(store.inboxOf("boss-a")).isEmpty();
    }

    @Test
    void thesameRequesterDoesNotPileUpRequests() {
        // 请求者连点三下「发送请求」，主管不该收到三条一模一样的。
        store.request("zhangsan", "张三", "finance_clerk", PERMS, "boss-a", CTX);
        store.request("zhangsan", "张三", "finance_clerk", PERMS, "boss-a", CTX);
        store.request("zhangsan", "张三", "finance_clerk", PERMS, "boss-a", CTX);

        assertThat(store.inboxOf("boss-a")).hasSize(1);
    }

    @Test
    void takingARequestRemovesItSoItCannotBeApprovedTwice() {
        // 主管手快点了两下「批准」，或者两个标签页都开着这条 —— 只能成一次。
        ApprovalStore.Pending p = store.request("zhangsan", "张三", "finance_clerk", PERMS, "boss-a", CTX);

        assertThat(store.take(p.id(), "boss-a")).isNotNull();
        assertThat(store.take(p.id(), "boss-a")).as("第二次认领必须落空").isNull();
    }

    @Test
    void onlyTheNamedApproverCanTakeIt() {
        ApprovalStore.Pending p = store.request("zhangsan", "张三", "finance_clerk", PERMS, "boss-a", CTX);

        assertThat(store.take(p.id(), "boss-b")).as("不是弹给他的，认领不了").isNull();
        assertThat(store.inboxOf("boss-a")).as("而且原请求必须还在").hasSize(1);
    }

    @Test
    void peekingDoesNotConsumeTheRequest() {
        // 密码校验必须在**摘走之前**。反过来的话主管手滑输错一次，请求就没了 ——
        // 请求者对着等待环白等满两分钟，而他那边什么错误都看不到。
        // peek 只是「让我看看这条是不是给我的」，不改变任何状态。
        ApprovalStore.Pending p = store.request("zhangsan", "张三", "finance_clerk", PERMS, "boss-a", CTX);

        assertThat(store.peek(p.id(), "boss-a")).isNotNull();
        assertThat(store.peek(p.id(), "boss-a")).as("peek 不消费").isNotNull();
        assertThat(store.inboxOf("boss-a")).as("原请求必须还在").hasSize(1);
    }

    @Test
    void peekRespectsTheNamedApprover() {
        ApprovalStore.Pending p = store.request("zhangsan", "张三", "finance_clerk", PERMS, "boss-a", CTX);

        assertThat(store.peek(p.id(), "boss-b")).isNull();
    }

    @Test
    void theRequesterLearnsTheOutcomeOnItsNextPing() {
        // 结果顺着在场那条唯一的轮询回传，最迟 20 秒 —— 不需要第二条通道。
        ApprovalStore.Pending p = store.request("zhangsan", "张三", "finance_clerk", PERMS, "boss-a", CTX);
        store.take(p.id(), "boss-a");

        store.settle(p, true, "boss-a", "李主管");

        ApprovalStore.Outcome out = store.pollOutcome("zhangsan");
        assertThat(out).isNotNull();
        assertThat(out.approved()).isTrue();
        assertThat(out.approverName()).isEqualTo("李主管");
    }

    @Test
    void theOutcomeIsConsumedOnce() {
        // 同 Eviction：读一次即消费，否则他每 20 秒被同一个结果通知一次。
        ApprovalStore.Pending p = store.request("zhangsan", "张三", "finance_clerk", PERMS, "boss-a", CTX);
        store.settle(p, false, "boss-a", "李主管");

        assertThat(store.pollOutcome("zhangsan")).isNotNull();
        assertThat(store.pollOutcome("zhangsan")).isNull();
    }

    // ── 铃铛(V133;06-E「你请的远程授权超时」,问题列「点了取消请求照样报超时」)──

    @Test
    void anExpiredRequestIsReportedExactlyOnce() {
        List<ApprovalStore.Pending> expired = new ArrayList<>();
        store.onExpire(expired::add);
        store.request("zhangsan", "张三", "finance_clerk", PERMS, "boss-a", CTX);

        clock.advance(Duration.ofMinutes(2).plusSeconds(1));
        store.inboxOf("boss-a");
        store.inboxOf("boss-a");   // 再扫一遍也不重报

        assertThat(expired).singleElement().satisfies(p -> assertThat(p.requester()).isEqualTo("zhangsan"));
    }

    @Test
    void aCancelledRequestIsGone_andNeverReportedAsTimeout() {
        List<ApprovalStore.Pending> expired = new ArrayList<>();
        store.onExpire(expired::add);
        ApprovalStore.Pending p = store.request("zhangsan", "张三", "finance_clerk", PERMS, "boss-a", CTX);

        assertThat(store.cancel(p.id(), "boss-a")).as("只有请求者本人撤得动").isFalse();
        assertThat(store.inboxOf("boss-a")).hasSize(1);

        assertThat(store.cancel(p.id(), "zhangsan")).isTrue();
        assertThat(store.inboxOf("boss-a")).as("撤回后审批人那边立刻没了").isEmpty();

        clock.advance(Duration.ofMinutes(2).plusSeconds(1));
        store.inboxOf("boss-a");
        assertThat(expired).as("撤回的不算超时").isEmpty();
    }

    /** ApprovalService 把三种结果接进请求者的铃铛:批准 / 拒绝谁点的谁署名,超时是系统的(addAsSystem)。 */
    @Test
    void decideAndExpiry_landInTheRequestersBell() {
        NoticeService bell = mock(NoticeService.class);
        AuthUserMapper users = mock(AuthUserMapper.class);
        AuthUser boss = new AuthUser();
        boss.setUsername("boss-a");
        boss.setDisplayName("王主管");
        when(users.selectOne(any())).thenReturn(boss);
        // 批准时复核两头此刻的权限(安全审计 F24):批准人仍持有这些权限点、请求人仍能请求授权
        UserPermissionCache cache = mock(UserPermissionCache.class);
        when(cache.get("boss-a")).thenReturn(new UserPermissionCache.UserAuth("boss-a", java.util.Set.copyOf(PERMS),
            List.of(), List.of(), 1, "s1", null));
        when(cache.get("zhangsan")).thenReturn(new UserPermissionCache.UserAuth("zhangsan", java.util.Set.of(Perm.ELEVATE_REQUEST),
            List.of(), List.of(), 1, "s2", null));
        ApprovalService svc = new ApprovalService(store, mock(PresenceStore.class), cache,
            mock(ElevationStore.class), mock(ElevationService.class), mock(AuditLogService.class), users, bell);
        SecurityContextHolder.getContext().setAuthentication(
            new UsernamePasswordAuthenticationToken("boss-a", null, List.of()));
        try {
            ApprovalStore.Pending ok = store.request("zhangsan", "张三", "finance_clerk", PERMS, "boss-a", CTX);
            svc.decide(ok.id(), new DecideReq(true, "pw"));
            verify(bell).add("zhangsan", NoticeService.Kind.approval_approved, "王主管批准了你的授权",
                "30 分钟内可以修改 loss_rate · A 座", null);

            ApprovalStore.Pending no = store.request("zhangsan", "张三", "finance_clerk", PERMS, "boss-a", CTX);
            svc.decide(no.id(), new DecideReq(false, null));
            verify(bell).add(eq("zhangsan"), eq(NoticeService.Kind.approval_rejected), eq("王主管拒绝了你的授权"),
                anyString(), isNull());

            store.request("lisi", "李四", "finance_clerk", PERMS, "boss-a", CTX);
            clock.advance(Duration.ofMinutes(2).plusSeconds(1));
            store.inboxOf("boss-a");
            verify(bell).addAsSystem(eq("lisi"), eq(NoticeService.Kind.approval_timeout), anyString(), anyString(), isNull());
            verify(bell, never()).addAsSystem(eq("zhangsan"), any(), any(), any(), any());
        } finally {
            SecurityContextHolder.clearContext();
        }
    }
}

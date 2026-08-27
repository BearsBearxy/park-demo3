package com.park.demo3.security;

import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/** 远程授权的待批队列（设计稿 §07）。骨架 —— 行为由 ApprovalStoreTest 逐条驱动。 */
@Component
public class ApprovalStore {

    /** 主管判断这件事该不该批所需要的上下文。**没有它这个功能不该上** —— 见 §07 批准疲劳。 */
    public record Context(String page, String action, String impact) {}

    public record Pending(String id, String requester, String requesterName, String requesterRole,
                          List<String> perms, String approver, Context context, Instant createdAt) {}

    public record Outcome(String id, boolean approved, String approver, String approverName,
                          List<String> perms) {}

    private final Clock clock;
    public ApprovalStore() { this(Clock.systemUTC()); }
    public ApprovalStore(Clock clock) { this.clock = clock; }

    /**
     * 请求的存活期。**刻意很短** —— 请求者正在屏幕前等着；超过两分钟他多半该改走
     * 当场授权或直接打个电话。一条挂着不动的请求过几小时才被批准比没批更糟：
     * 那时他早就不在那一屏了，而权限已经发出去 30 分钟。
     */
    public static final Duration TTL = Duration.ofMinutes(2);

    /** id → 待批。几十个账号、两分钟存活，整张表始终是个位数。 */
    private final Map<String, Pending> pendings = new ConcurrentHashMap<>();
    /**
     * 请求者 → 结果。**读一次即消费**（同 PresenceStore 的 Eviction）。
     * ponytail: 没做 TTL —— 每人至多一条，上限就是账号数；请求者不来取也只是一条陈旧记录，
     *           他下次发请求时会被新结果覆盖。
     */
    private final Map<String, Outcome> outcomes = new ConcurrentHashMap<>();

    public Pending request(String requester, String requesterName, String requesterRole,
                           List<String> perms, String approver, Context ctx) {
        sweep();
        // 连点三下「发送请求」，主管不该收到三条一模一样的
        for (Pending p : pendings.values()) {
            if (p.requester().equals(requester) && p.approver().equals(approver)
                && p.perms().equals(perms)) return p;
        }
        Pending p = new Pending(UUID.randomUUID().toString(), requester, requesterName, requesterRole,
                                List.copyOf(perms), approver, ctx, clock.instant());
        pendings.put(p.id(), p);
        return p;
    }

    /** 弹给谁就只有谁看得见。广播给所有主管的话责任就散了。 */
    public List<Pending> inboxOf(String approver) {
        sweep();
        return pendings.values().stream().filter(p -> p.approver().equals(approver)).toList();
    }

    /**
     * 只看不取 —— 「这条是不是弹给我的」。**不改变任何状态。**
     *
     * 有它是因为密码校验必须发生在摘走**之前**：反过来的话主管手滑输错一次，
     * 请求就没了，请求者对着等待环白等满两分钟，而他那边什么错误都看不到。
     */
    public Pending peek(String id, String approver) {
        sweep();
        Pending p = pendings.get(id);
        return p != null && p.approver().equals(approver) ? p : null;
    }

    /**
     * 认领并移出 —— 保证一条请求只被处理一次（主管手快点两下、或两个标签页都开着这条）。
     * 不是弹给他的返回 null，且**原请求留在原处**。
     */
    public Pending take(String id, String approver) {
        sweep();
        Pending p = pendings.get(id);
        if (p == null || !p.approver().equals(approver)) return null;
        return pendings.remove(id, p) ? p : null;
    }

    /** 结果入袋，等请求者下一次 ping 来取（顺着在场那条唯一的轮询，最迟 20 秒）。 */
    public void settle(Pending p, boolean approved, String approver, String approverName) {
        outcomes.put(p.requester(), new Outcome(p.id(), approved, approver, approverName, p.perms()));
    }

    /** 请求者取结果。**读一次即消费** —— 否则他每 20 秒被同一个结果通知一次。 */
    public Outcome pollOutcome(String requester) { return outcomes.remove(requester); }

    private void sweep() {
        Instant cut = clock.instant().minus(TTL);
        pendings.values().removeIf(p -> p.createdAt().isBefore(cut));
    }
}

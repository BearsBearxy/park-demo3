package com.park.demo3.service;
import org.springframework.stereotype.Component;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.LongSupplier;

/**
 * 登录失败限流：按 ip|username 计数，滑动窗口 15 分钟内累计 5 次失败即锁该键 15 分钟，成功登录立即清零。
 * 只锁「键」不锁账号——避免有人拿别人的用户名从任意 IP 刷失败把真人锁在门外（拒绝服务）。
 * ponytail: 纯内存单机态（ConcurrentHashMap），不引 bucket4j/caffeine/redis。
 *           上限 = 单实例：多副本部署时每副本各算各的，有效阈值被放大 N 倍；到那一步再换共享存储。
 */
@Component
public class LoginRateLimiter {
    static final int MAX_FAILURES = 5;
    static final long WINDOW_MS = 15 * 60_000L;
    static final long LOCK_MS = 15 * 60_000L;
    // 条目数上限：字典爆破会造出海量 ip|username 键，不清扫就是内存泄漏。
    // 清扫搭在 isLocked 上（每次登录必过），超阈值才做一次 O(n) 全量，平时零开销。
    private static final int SWEEP_THRESHOLD = 10_000;

    /** 失败次数 / 窗口起点 / 锁定到期（0 = 未锁定），后两者均为毫秒时间戳 */
    private record Counter(int failures, long windowStart, long lockedUntil) {}

    private final Map<String, Counter> buckets = new ConcurrentHashMap<>();
    private final LongSupplier clock;

    public LoginRateLimiter() { this(System::currentTimeMillis); }
    // 假时钟入口：要验窗口/锁过期不可能真等 15 分钟。Spring 走上面的无参构造，这个只给测试用
    LoginRateLimiter(LongSupplier clock) { this.clock = clock; }

    /** 用户名一律小写入键：Admin / ADMIN 与 admin 必须算同一个桶，否则改个大小写就绕开了 */
    public static String key(String ip, String username) {
        return ip + "|" + username.toLowerCase(Locale.ROOT);
    }

    public boolean isLocked(String key) {
        long now = clock.getAsLong();
        if (buckets.size() > SWEEP_THRESHOLD) buckets.values().removeIf(c -> dead(c, now));
        Counter c = buckets.get(key);
        return c != null && now < c.lockedUntil();
    }

    public void recordFailure(String key) {
        long now = clock.getAsLong();
        // compute 保证同键并发下计数不丢（多个请求同时打同一 ip|username 是爆破的常态）
        buckets.compute(key, (k, c) -> {
            boolean locked = c != null && now < c.lockedUntil();
            // ⚠ 锁定期内不得走「窗口过期 → 重置」这一支:windowStart 是**首次**失败时刻,
            //   lockedUntil 是**第 5 次**失败 + 15min。首次远早于第 5 次时(如失败落在 0/1/2/3/14min),
            //   窗口会先于锁到期,此时重置就把 lockedUntil 一并清成 0 = 提前解锁(该例可早解 14 分钟)。
            if (!locked && (c == null || now - c.windowStart() >= WINDOW_MS)) return new Counter(1, now, 0);
            int fails = c.failures() + 1;
            return new Counter(fails, c.windowStart(), fails >= MAX_FAILURES ? now + LOCK_MS : c.lockedUntil());
        });
    }

    public void reset(String key) { buckets.remove(key); }

    /** 窗口已过且不在锁定中 = 死条目，可回收 */
    private static boolean dead(Counter c, long now) {
        return now >= c.lockedUntil() && now - c.windowStart() >= WINDOW_MS;
    }
}

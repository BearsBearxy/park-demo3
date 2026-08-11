package com.park.demo3.service;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 纯单测（不起 Spring/容器）：用假时钟推进虚拟时间，验窗口与锁的边界——真等 15 分钟不可行。
 * LoginRateLimitIT 覆盖的是 HTTP 端到端行为，本类覆盖的是时间语义。
 */
class LoginRateLimiterTest {

    /** 可推进的假时钟 */
    private static final class Clock {
        long now = 1_000_000L;   // 非 0 起点，免得 lockedUntil=0「未锁定」哨兵值与真实时间戳撞上
        void advance(long ms) { now += ms; }
    }

    private static final String K = "1.2.3.4|admin";

    private static Clock clockOf(LoginRateLimiter[] out) {
        Clock c = new Clock();
        out[0] = new LoginRateLimiter(() -> c.now);
        return c;
    }

    @Test
    void 连续五次失败即锁定_第五次之前不锁() {
        LoginRateLimiter[] box = new LoginRateLimiter[1];
        clockOf(box);
        LoginRateLimiter lim = box[0];

        for (int i = 0; i < LoginRateLimiter.MAX_FAILURES - 1; i++) {
            lim.recordFailure(K);
            assertThat(lim.isLocked(K)).as("第 %d 次失败后不应锁定", i + 1).isFalse();
        }
        lim.recordFailure(K);
        assertThat(lim.isLocked(K)).as("第 5 次失败后应锁定").isTrue();
    }

    @Test
    void 成功登录清零计数() {
        LoginRateLimiter[] box = new LoginRateLimiter[1];
        clockOf(box);
        LoginRateLimiter lim = box[0];

        for (int i = 0; i < 4; i++) lim.recordFailure(K);
        lim.reset(K);                       // 一次成功登录
        for (int i = 0; i < 4; i++) lim.recordFailure(K);
        assertThat(lim.isLocked(K)).as("清零后重新计数，累计 4 次不应锁定").isFalse();
    }

    @Test
    void 锁定十五分钟后自动解锁() {
        LoginRateLimiter[] box = new LoginRateLimiter[1];
        Clock clock = clockOf(box);
        LoginRateLimiter lim = box[0];

        for (int i = 0; i < LoginRateLimiter.MAX_FAILURES; i++) lim.recordFailure(K);
        assertThat(lim.isLocked(K)).isTrue();

        clock.advance(LoginRateLimiter.LOCK_MS - 1);
        assertThat(lim.isLocked(K)).as("差 1ms 到期仍应锁定").isTrue();

        clock.advance(2);
        assertThat(lim.isLocked(K)).as("锁到期应自动解锁").isFalse();
    }

    @Test
    void 窗口内零星失败不累积到锁定() {
        LoginRateLimiter[] box = new LoginRateLimiter[1];
        Clock clock = clockOf(box);
        LoginRateLimiter lim = box[0];

        for (int i = 0; i < 4; i++) lim.recordFailure(K);
        clock.advance(LoginRateLimiter.WINDOW_MS + 1);   // 窗口过期
        lim.recordFailure(K);
        assertThat(lim.isLocked(K)).as("跨窗口后重新计数，不应因累计 5 次而锁定").isFalse();
    }

    /**
     * 回归：窗口起点是「首次失败」，锁到期是「第 5 次失败 + LOCK_MS」。
     * 首次远早于第 5 次时窗口会先到期——此时若走「窗口过期 → 重置」分支就会把锁一并清掉，
     * 等于提前解锁。本例中锁应持续到 14min + 15min = 29min，而窗口 15min 就到期了。
     */
    @Test
    void 锁定期内窗口到期不得提前解锁() {
        LoginRateLimiter[] box = new LoginRateLimiter[1];
        Clock clock = clockOf(box);
        LoginRateLimiter lim = box[0];

        for (int i = 0; i < 4; i++) lim.recordFailure(K);        // t=0：首次失败，windowStart=0
        clock.advance(14 * 60_000L);
        lim.recordFailure(K);                                     // t=14min：第 5 次 → 锁到 29min
        assertThat(lim.isLocked(K)).isTrue();

        clock.advance(60_000L + 1);                               // t=15min：窗口到期，但锁还有 14 分钟
        lim.recordFailure(K);                                     // 攻击者继续试 —— 不得借此重置窗口解锁
        assertThat(lim.isLocked(K)).as("窗口到期不得清掉未过期的锁").isTrue();

        clock.advance(LoginRateLimiter.LOCK_MS + 1);              // 越过滑动后的锁到期
        assertThat(lim.isLocked(K)).as("锁真正到期后应解锁").isFalse();
    }

    @Test
    void 用户名大小写归一到同一个桶() {
        assertThat(LoginRateLimiter.key("1.2.3.4", "Admin"))
                .isEqualTo(LoginRateLimiter.key("1.2.3.4", "admin"));
    }
}

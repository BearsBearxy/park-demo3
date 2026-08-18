package com.park.demo3.common;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.io.IOException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 纯单测（不起 Spring/容器）：假纳秒钟由 chain 里推进，验阈值语义——真 sleep 500ms 是把
 * 测试时间当耗材烧。挂 logback 的 ListAppender 直接看这条 warn 打没打。
 */
class SlowRequestFilterTest {

    /** 可推进的假单调钟（纳秒） */
    private static final class Clock {
        long nanos = 1_000_000_000L;   // 非 0 起点：0 起点掩盖不掉「忘了取起始值」的写法
        void advanceMs(long ms) { nanos += ms * 1_000_000L; }
    }

    private final Clock clock = new Clock();
    private final SlowRequestFilter filter = new SlowRequestFilter(500, () -> clock.nanos);
    private final Logger logger = (Logger) LoggerFactory.getLogger(SlowRequestFilter.class);
    private final ListAppender<ILoggingEvent> appender = new ListAppender<>();

    @BeforeEach void attach() { appender.start(); logger.addAppender(appender); }
    @AfterEach  void detach() { logger.detachAppender(appender); appender.stop(); }

    /** 假 chain：只负责让虚拟时钟走 costMs */
    private FilterChain chainCosting(long costMs) {
        return (rq, rs) -> clock.advanceMs(costMs);
    }

    private void run(String uri, String queryString, FilterChain chain) throws Exception {
        MockHttpServletRequest req = new MockHttpServletRequest("GET", uri);
        req.setQueryString(queryString);
        filter.doFilter(req, new MockHttpServletResponse(), chain);
    }

    @Test
    void 快请求不打日志() throws Exception {
        run("/api/tenants", null, chainCosting(120));
        assertThat(appender.list).as("120ms 远低于阈值，不该有输出").isEmpty();
    }

    @Test
    void 慢请求打warn并带方法URI与queryString() throws Exception {
        run("/api/alloc/pools", "ym=2024-02", chainCosting(1200));

        assertThat(appender.list).hasSize(1);
        ILoggingEvent e = appender.list.get(0);
        assertThat(e.getLevel()).isEqualTo(Level.WARN);
        assertThat(e.getFormattedMessage())
                .contains("1200ms").contains("GET").contains("/api/alloc/pools?ym=2024-02");
    }

    /** 边界：>= 阈值即打。取 499/500 两点，免得写成 > 后再没人发现 */
    @Test
    void 恰好等于阈值要打_差一毫秒不打() throws Exception {
        run("/api/meters", null, chainCosting(499));
        assertThat(appender.list).as("499ms 未达阈值").isEmpty();

        run("/api/meters", null, chainCosting(500));
        assertThat(appender.list).as("500ms 达阈值").hasSize(1);
    }

    /**
     * 回归：耗时统计在 finally 里，下游抛异常时这条日志同样得出来——
     * 500 报错往往正是「打满超时才炸」的慢请求，那才是最需要看到的一条。
     */
    @Test
    void 下游抛异常仍记录耗时() {
        FilterChain boom = (rq, rs) -> { clock.advanceMs(900); throw new IOException("下游炸了"); };
        assertThatThrownBy(() -> run("/api/boom", null, boom)).isInstanceOf(IOException.class);
        assertThat(appender.list).hasSize(1);
        assertThat(appender.list.get(0).getFormattedMessage()).contains("900ms");
    }
}

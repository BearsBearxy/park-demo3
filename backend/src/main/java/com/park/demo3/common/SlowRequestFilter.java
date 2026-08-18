package com.park.demo3.common;
import jakarta.servlet.*;
import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import java.io.IOException;
import java.util.function.LongSupplier;

// 紧跟 TraceIdFilter(HIGHEST_PRECEDENCE)之后:那一层已把 traceId 写进 MDC,这行 warn 才带得上
// [traceId](logging.pattern 里有 %X{traceId}),用户报上来的 X-Trace-Id 才能直接在日志里搜到慢的那次;
// 若排到它之前,慢请求日志的 traceId 恒为空,等于要人肉猜是哪个请求
@Component @Order(Ordered.HIGHEST_PRECEDENCE + 1)
@Slf4j
public class SlowRequestFilter implements Filter {
    private final long thresholdMs;
    // 单调纳秒钟:currentTimeMillis 会被 NTP 校时拽着跳(甚至倒退),量耗时只能用 nanoTime
    private final LongSupplier nanoClock;

    @Autowired
    public SlowRequestFilter(@Value("${app.slow-request-ms:500}") long thresholdMs) { this(thresholdMs, System::nanoTime); }

    SlowRequestFilter(long thresholdMs, LongSupplier nanoClock) { this.thresholdMs = thresholdMs; this.nanoClock = nanoClock; }

    @Override public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain) throws IOException, ServletException {
        long t0 = nanoClock.getAsLong();
        try { chain.doFilter(req, res); } finally {
            long ms = (nanoClock.getAsLong() - t0) / 1_000_000L;
            // 只打超阈值的:正常请求在 2ms 级,逐条 access log 会把真正该看的那几条淹没
            if (ms >= thresholdMs && req instanceof HttpServletRequest r) {
                // 只读方法/URI/queryString —— 绝不碰 request body:ServletInputStream 只能读一次,
                // 这里读完后面 @RequestBody 就拿到空(除非套 ContentCachingRequestWrapper,不值当)
                String qs = r.getQueryString();
                log.warn("慢请求 {}ms {} {}{}", ms, r.getMethod(), r.getRequestURI(), qs == null ? "" : "?" + qs);
            }
        }
    }
}

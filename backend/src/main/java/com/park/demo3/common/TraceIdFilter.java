package com.park.demo3.common;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import java.io.IOException;
import java.util.UUID;

// 最高优先级:必须排在 Spring Security 过滤链(order=-100)之前,
// 否则认证失败的 401 响应体 traceId=null、响应头无 X-Trace-Id,恰恰丢掉最需排障场景的链路标识
@Component @Order(Ordered.HIGHEST_PRECEDENCE)
public class TraceIdFilter implements Filter {
    @Override public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain) throws IOException, ServletException {
        String tid = ((HttpServletRequest) req).getHeader("X-Trace-Id");
        if (tid == null || !tid.matches("[A-Za-z0-9-]{1,64}")) tid = UUID.randomUUID().toString().replace("-", "").substring(0, 16);
        MDC.put("traceId", tid);
        ((HttpServletResponse) res).setHeader("X-Trace-Id", tid);
        try { chain.doFilter(req, res); } finally { MDC.remove("traceId"); }
    }
}

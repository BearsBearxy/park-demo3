package com.park.demo3.common;
import org.slf4j.MDC;
public record Result<T>(int code, String message, T data, String traceId) {
    public static <T> Result<T> ok(T data) { return new Result<>(0, "ok", data, MDC.get("traceId")); }
    public static <T> Result<T> error(int code, String message) { return new Result<>(code, message, null, MDC.get("traceId")); }
}

package com.park.demo3.common;
import org.springframework.core.MethodParameter;
import org.springframework.http.MediaType;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.mvc.method.annotation.ResponseBodyAdvice;

@RestControllerAdvice(basePackages = "com.park.demo3.controller")
public class ResponseWrapAdvice implements ResponseBodyAdvice<Object> {
    @Override public boolean supports(MethodParameter rt, Class conv) { return true; }
    @Override public Object beforeBodyWrite(Object body, MethodParameter rt, MediaType ct,
            Class conv, ServerHttpRequest req, ServerHttpResponse res) {
        if (body instanceof Result<?>) return body;
        return Result.ok(body);
    }
}

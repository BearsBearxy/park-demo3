package com.park.demo3.common;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.core.MethodParameter;
import org.springframework.http.MediaType;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.mvc.method.annotation.ResponseBodyAdvice;

@RestControllerAdvice(basePackages = "com.park.demo3.controller")
public class ResponseWrapAdvice implements ResponseBodyAdvice<Object> {
    private final ObjectMapper objectMapper;
    public ResponseWrapAdvice(ObjectMapper objectMapper) { this.objectMapper = objectMapper; }

    @Override public boolean supports(MethodParameter rt, Class conv) { return true; }
    @Override public Object beforeBodyWrite(Object body, MethodParameter rt, MediaType ct,
            Class conv, ServerHttpRequest req, ServerHttpResponse res) {
        if (body instanceof Result<?>) return body;
        // String 返回类型:Spring 已按声明选中 StringHttpMessageConverter,
        // 返回 Result 对象会 ClassCastException → 手动序列化成 JSON 字符串
        if (body instanceof String s) {
            res.getHeaders().setContentType(MediaType.APPLICATION_JSON);
            try {
                return objectMapper.writeValueAsString(Result.ok(s));
            } catch (JsonProcessingException e) {
                throw new IllegalStateException(e);
            }
        }
        return Result.ok(body);
    }
}

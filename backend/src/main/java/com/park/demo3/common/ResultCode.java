package com.park.demo3.common;
public enum ResultCode {
    BAD_REQUEST(400, "请求参数错误"),
    UNAUTHORIZED(401, "未认证或令牌无效"),
    NOT_FOUND(404, "资源不存在"),
    CONFLICT(409, "资源冲突"),
    INTERNAL(500, "服务器内部错误");
    public final int code; public final String message;
    ResultCode(int code, String message) { this.code = code; this.message = message; }
}

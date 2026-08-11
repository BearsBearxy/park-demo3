package com.park.demo3.common;
public enum ResultCode {
    BAD_REQUEST(400, "请求参数错误"),
    UNAUTHORIZED(401, "未认证或令牌无效"),
    FORBIDDEN(403, "无操作权限（只读账号；如为管理员请重新登录）"),   // 旧 token 缺 role 降级 viewer,文案不断言账号身份并给出路
    NOT_FOUND(404, "资源不存在"),
    CONFLICT(409, "资源冲突"),
    TOO_MANY_REQUESTS(429, "登录尝试过于频繁，请 15 分钟后再试"),   // 登录限流(LoginRateLimiter);仍走 BizException → HTTP 200 + body.code=429

    INTERNAL(500, "服务器内部错误");
    public final int code; public final String message;
    ResultCode(int code, String message) { this.code = code; this.message = message; }
}

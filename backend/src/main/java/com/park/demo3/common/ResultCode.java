package com.park.demo3.common;
public enum ResultCode {
    BAD_REQUEST(400, "请求参数错误"),
    UNAUTHORIZED(401, "未认证或令牌无效"),
    // V101:v2 是「读全开,写分权」,403 只可能是"这个模块你没有 edit 权",与账号是不是 viewer 无关。
    // 旧文案的「如为管理员请重新登录」出自 V32「老 token 缺 role 降级 viewer」那条防御 —— v2 权限服务端
    // 现查、令牌里没有可陈旧的东西,重登录不会改变任何结果,那句话是把用户支去做一件没用的事。
    FORBIDDEN(403, "无操作权限：当前账号没有修改这项数据的权限（可查看，如需修改请联系管理员开通）"),
    NOT_FOUND(404, "资源不存在"),
    CONFLICT(409, "资源冲突"),
    TOO_MANY_REQUESTS(429, "登录尝试过于频繁，请 15 分钟后再试"),   // 登录限流(LoginRateLimiter);仍走 BizException → HTTP 200 + body.code=429

    INTERNAL(500, "服务器内部错误");
    public final int code; public final String message;
    ResultCode(int code, String message) { this.code = code; this.message = message; }
}

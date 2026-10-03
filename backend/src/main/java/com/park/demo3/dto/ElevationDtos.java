package com.park.demo3.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;

import java.util.List;

public final class ElevationDtos {
    private ElevationDtos() {}

    /** 一次授权可以补齐多个权限点 —— 一个页面的编辑模式常常同时要两三项,不该让主管输三遍密码。 */
    public record ElevateReq(@NotEmpty List<String> perms,
                             // authorizer 进登录限流表的键(ip|authorizer),同 LoginReq 限长(安全审计 F05)
                             @NotBlank @Size(max = 64, message = "不能超过 64 位") String authorizer,
                             @NotBlank @Size(max = 72, message = "不能超过 72 位") String password) {}

    /** expiresAt / grantedAt 用毫秒时间戳:前端直接减 Date.now() 出倒计时,不必解析时区。
     *  source = onsite(当场授权)| remote(远程批准),见 ElevationStore.ONSITE / REMOTE。 */
    public record GrantDTO(String perm, String permLabel,
                           String authorizer, String authorizerName, long expiresAt,
                           long grantedAt, String source) {}
}

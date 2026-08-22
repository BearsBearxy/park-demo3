package com.park.demo3.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;

import java.util.List;

public final class ElevationDtos {
    private ElevationDtos() {}

    /** 一次授权可以补齐多个权限点 —— 一个页面的编辑模式常常同时要两三项,不该让主管输三遍密码。 */
    public record ElevateReq(@NotEmpty List<String> perms,
                             @NotBlank String authorizer,
                             @NotBlank String password) {}

    /** expiresAt 用毫秒时间戳:前端直接减 Date.now() 出倒计时,不必解析时区。 */
    public record GrantDTO(String perm, String permLabel,
                           String authorizer, String authorizerName, long expiresAt) {}
}

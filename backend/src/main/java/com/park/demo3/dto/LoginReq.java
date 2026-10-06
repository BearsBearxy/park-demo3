package com.park.demo3.dto;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
// 长度上限(安全审计 F05):登录失败把 ip|username 存进限流表 15 分钟,不限长时匿名请求用约 1MB 的随机用户名
// 几百次就能把堆撑满。上限照建号口径(用户名 3-64 位、密码至多 72 位);超长的不可能是真账号。
public record LoginReq(@NotBlank @Size(max = 64, message = "不能超过 64 位") String username,
                       @NotBlank @Size(max = 72, message = "不能超过 72 位") String password) {}

package com.park.demo3.dto;
import java.util.List;
/**
 * role 保留是为了老前端与 IconRail 的角色展示;**授权判定不看它**,看 permissions。
 * navLayers 与权限脱钩,只管导航显示哪几层(RBAC-SPEC §4)。
 * username 是给前端做"这是我自己"判断用的(用户管理屏要把自己那行的停用按钮预先置灰) ——
 * 后端有自锁守卫兜底,但让用户点一个注定 409 的按钮是坏体验。别让前端去解 JWT 的 sub 猜。
 */
public record LoginResp(String token, String username, String displayName, String role,
                        List<String> permissions, List<String> navLayers,
                        boolean mustChangePassword) {}

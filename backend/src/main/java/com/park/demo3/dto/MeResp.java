package com.park.demo3.dto;
import java.util.List;
/** GET /api/auth/me:登录响应里会变旧的那几项,字段名与 LoginResp 同。 */
public record MeResp(String username, List<String> permissions, List<String> navLayers, List<String> roleNames) {}

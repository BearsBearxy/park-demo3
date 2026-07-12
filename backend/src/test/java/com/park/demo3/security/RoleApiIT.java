package com.park.demo3.security;
import com.jayway.jsonpath.JsonPath;
import com.park.demo3.AbstractMysqlIT;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

// 只读角色(V32 审计建议#8):GET=读(两角色),非 GET=写(仅 admin,SecurityConfig 强制)。
// viewer 账号由 AdminInitializer 按 app.viewer.password(application.yml dev 默认 viewer123)创建。
@AutoConfigureMockMvc
class RoleApiIT extends AbstractMysqlIT {
    @Autowired MockMvc mvc;
    @Autowired JwtUtil jwt;

    private String login(String user, String pass) throws Exception {
        String body = mvc.perform(post("/api/auth/login").contentType("application/json")
                .content("{\"username\":\"" + user + "\",\"password\":\"" + pass + "\"}"))
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$.data.token");
    }

    @Test
    void loginRespCarriesRole() throws Exception {
        mvc.perform(post("/api/auth/login").contentType("application/json")
                .content("{\"username\":\"viewer\",\"password\":\"viewer123\"}"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.code").value(0))
           .andExpect(jsonPath("$.data.role").value("viewer"))
           .andExpect(jsonPath("$.data.displayName").value("只读账号"));
        mvc.perform(post("/api/auth/login").contentType("application/json")
                .content("{\"username\":\"admin\",\"password\":\"admin123\"}"))
           .andExpect(jsonPath("$.data.role").value("admin"));
    }

    @Test
    void viewerCanRead() throws Exception {
        String t = login("viewer", "viewer123");
        mvc.perform(get("/api/tenants").header("Authorization", "Bearer " + t))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.code").value(0));
    }

    @Test
    void viewerWriteForbiddenWithEnvelope() throws Exception {
        String t = login("viewer", "viewer123");
        // 角色门在控制器/校验之前:非 GET 一律 HTTP 403 + code 403 信封,不触达业务层(零数据污染)
        mvc.perform(post("/api/tenants").header("Authorization", "Bearer " + t)
                .contentType("application/json").content("{}"))
           .andExpect(status().isForbidden())
           .andExpect(jsonPath("$.code").value(403))
           .andExpect(jsonPath("$.message").value("无操作权限（只读账号；如为管理员请重新登录）"));
        mvc.perform(delete("/api/tenants/999999").header("Authorization", "Bearer " + t))
           .andExpect(status().isForbidden())
           .andExpect(jsonPath("$.code").value(403));
    }

    @Test
    void adminWritePassesRoleGate() throws Exception {
        String t = login("admin", "admin123");
        // 空体过角色门抵达 @Valid 校验层返 400(≠403 即证明 admin 通过写门),不产生数据
        mvc.perform(post("/api/tenants").header("Authorization", "Bearer " + t)
                .contentType("application/json").content("{}"))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value(400));
    }

    @Test
    void legacyTokenWithoutRoleClaimIsViewer() throws Exception {
        // V32 前签发的 token 无 role claim → 最小权限按 viewer:可读不可写,admin 重登录即恢复
        String legacy = jwt.generate("admin", null);
        mvc.perform(get("/api/tenants").header("Authorization", "Bearer " + legacy))
           .andExpect(status().isOk());
        mvc.perform(post("/api/tenants").header("Authorization", "Bearer " + legacy)
                .contentType("application/json").content("{}"))
           .andExpect(status().isForbidden());
    }
}

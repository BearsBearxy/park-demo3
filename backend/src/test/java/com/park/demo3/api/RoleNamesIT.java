package com.park.demo3.api;

import com.jayway.jsonpath.JsonPath;
import com.park.demo3.AbstractMysqlIT;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 角色真名(SIDEBAR-UX-REDESIGN §6 / D6,P5)。
 *
 * `auth_user.role` 那一列存的是 'admin' / 'viewer' —— **代码,不是名字**。侧栏角色行与在场头像组
 * 一直在直接显示它。这里钉的是那条链:`auth_user_role` join 出来的 `auth_role.name`
 * 经权限快照送到两个出口(登录响应 / 心跳的座位),两处必须是同一份东西。
 */
@AutoConfigureMockMvc
class RoleNamesIT extends AbstractMysqlIT {

    @Autowired MockMvc mvc;

    /** 破坏验证:把 UserPermissionCache 里那句 `roleNames.add(r.getName())` 删掉 → 空表,红。 */
    @Test
    void loginCarriesRoleDisplayNamesNotRoleCodes() throws Exception {
        String b = body(mvc.perform(MockMvcRequestBuilders.post("/api/auth/login")
            .contentType("application/json")
            .content("{\"username\":\"admin\",\"password\":\"admin123\"}")).andReturn());

        List<String> names = JsonPath.read(b, "$.data.roleNames");
        assertThat(names).as("挂着的是预置 admin 角色,显示名是「系统管理员」").containsExactly("系统管理员");
        // 同一个响应里 role 仍是老那一列 —— 两者并存是刻意的(V32 的 JWT claim 还在用它),
        // 断言它没被顺手改掉,免得下次有人以为可以拿 role 当名字用。
        assertThat(JsonPath.<String>read(b, "$.data.role")).as("role 列还是代码,没被顶替").isEqualTo("admin");
    }

    /** 破坏验证:把 PresenceService 里 role 改回 `u.getRole()` → 座位上写 'admin',红。 */
    @Test
    void presenceSeatShowsTheRoleNameNotTheCode() throws Exception {
        String token = JsonPath.read(body(mvc.perform(MockMvcRequestBuilders.post("/api/auth/login")
            .contentType("application/json")
            .content("{\"username\":\"admin\",\"password\":\"admin123\"}")).andReturn()), "$.data.token");

        // sid 唯一:在场是进程内内存态,座位在**第一拍**定形,复用别的用例的 sid 会读到它那一拍的旧值
        String b = body(mvc.perform(MockMvcRequestBuilders.put("/api/presence/ping")
            .header("Authorization", "Bearer " + token).contentType("application/json")
            .content("{\"sid\":\"it-rolenames-sid\",\"scope\":null,\"label\":null,"
                   + "\"lastActivityAt\":null,\"editScopes\":[],\"mode\":null}"))
            .andExpect(status().isOk()).andReturn());

        List<String> roles = JsonPath.read(b, "$.data.users[?(@.user=='admin')].role");
        assertThat(roles).as("头像组上写的是人看得懂的角色名").containsOnly("系统管理员");
    }

    private String body(MvcResult r) {
        return new String(r.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
    }
}

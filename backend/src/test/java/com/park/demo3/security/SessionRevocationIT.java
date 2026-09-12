package com.park.demo3.security;
import com.park.demo3.AbstractMysqlIT;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * 会话作废（V125，用户 2026-09-12 拍板）。钉的是「旧令牌什么时候必须失效」这件事本身。
 *
 * 改前 JWT 完全无状态:签发之后服务端不再认识它,改密码也不会让它失效,最多要等 120 分钟。
 * 下面每条都是那个洞的一个出口。
 */
@AutoConfigureMockMvc
class SessionRevocationIT extends AbstractMysqlIT {
    @Autowired MockMvc mvc;
    @Autowired org.springframework.jdbc.core.JdbcTemplate jdbc;

    private String login(String user, String pwd) throws Exception {
        String body = mvc.perform(post("/api/auth/login").contentType("application/json")
                .content("{\"username\":\"" + user + "\",\"password\":\"" + pwd + "\"}"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return com.jayway.jsonpath.JsonPath.read(body, "$.data.token");
    }
    private int probe(String token) throws Exception {
        return mvc.perform(get("/api/probe/ok").header("Authorization", "Bearer " + token))
                  .andReturn().getResponse().getStatus();
    }

    @Test
    void 新登录把旧令牌挤掉_单会话() throws Exception {
        String first = login("admin", "admin123");
        assertThat(probe(first)).isEqualTo(200);

        String second = login("admin", "admin123");
        assertThat(probe(second)).as("新的这张当然能用").isEqualTo(200);
        assertThat(probe(first)).as("旧的那张当场失效——这就是「新登录挤掉旧的」").isEqualTo(401);
    }

    @Test
    void 登出之后那张令牌立刻不能用() throws Exception {
        String token = login("admin", "admin123");
        assertThat(probe(token)).isEqualTo(200);

        mvc.perform(post("/api/auth/logout").header("Authorization", "Bearer " + token))
           .andExpect(status().isOk());
        // 改前这里会是 200:前端只删了本地令牌,服务端根本不知道有人登出过
        assertThat(probe(token)).isEqualTo(401);
    }

    @Test
    void 登出幂等_已经作废再调一次不炸() throws Exception {
        String token = login("admin", "admin123");
        mvc.perform(post("/api/auth/logout").header("Authorization", "Bearer " + token)).andExpect(status().isOk());
        // 第二次调时令牌已失效 → 401(而不是 500)
        assertThat(probe(token)).isEqualTo(401);
    }

    @Test
    void 改密码之后旧令牌立刻失效() throws Exception {
        // 容器是跨类复用的(见 AbstractMysqlIT 头注),改密失败在半路会把 admin 的口令
        // 留在中间态,后面所有用例全红。所以先把哈希存下来,finally 里直接走库还原,
        // 不依赖任何接口调用成功。
        String hash = jdbc.queryForObject("SELECT password_hash FROM auth_user WHERE username='admin'", String.class);
        try {
            String token = login("admin", "admin123");
            assertThat(probe(token)).isEqualTo(200);

            mvc.perform(post("/api/auth/change-password").header("Authorization", "Bearer " + token)
                    .contentType("application/json")
                    .content("{\"currentPassword\":\"admin123\",\"newPassword\":\"admin1234\"}"))
               .andExpect(status().isOk());

            // 这条是整件事的由头:「怀疑口令泄露,赶紧改密码」必须当场生效,不能等 120 分钟
            assertThat(probe(token)).isEqualTo(401);
            // 新口令能登进来,说明改密本身没被破坏
            assertThat(probe(login("admin", "admin1234"))).isEqualTo(200);
        } finally {
            jdbc.update("UPDATE auth_user SET password_hash=?, must_change_password=0 WHERE username='admin'", hash);
        }
    }

    @Test
    void 伪造的令牌版本进不来() throws Exception {
        // 签名是服务端密钥签的,改 tv 必然破坏签名 → 解析失败 → 匿名 → 401。
        // 这条钉的是「tv 不是自助字段」,不是钉 JWT 库本身。
        String token = login("admin", "admin123");
        String[] parts = token.split("[.]");
        String tampered = parts[0] + "." + java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(
                "{\"sub\":\"admin\",\"tv\":999999,\"sid\":\"deadbeef\"}".getBytes(java.nio.charset.StandardCharsets.UTF_8))
                + "." + parts[2];
        assertThat(probe(tampered)).isEqualTo(401);
    }

    @Test
    void 会话表记下了这次登录() throws Exception {
        login("admin", "admin123");
        Integer live = jdbc.queryForObject(
            "SELECT COUNT(*) FROM auth_session WHERE username='admin' AND revoked_at IS NULL", Integer.class);
        assertThat(live).as("单会话:活着的行同时只能有一条").isEqualTo(1);
        String sid = jdbc.queryForObject(
            "SELECT id FROM auth_session WHERE username='admin' AND revoked_at IS NULL", String.class);
        assertThat(sid).as("会话 id 是 32 位十六进制,不是空串").hasSize(32);
    }
}

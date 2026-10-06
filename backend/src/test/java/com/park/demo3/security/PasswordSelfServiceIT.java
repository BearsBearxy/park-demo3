package com.park.demo3.security;

import com.jayway.jsonpath.JsonPath;
import com.park.demo3.AbstractMysqlIT;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

/**
 * 改密三件(用户 2026-10-04:「首次登录强制改密，现在自己改不了自己的密码，并且在系统用户管理里面重置密码后，
 * 到登录的时候又要强制改一遍」;安全审计 F02 / F40 / F89)。
 * <ul>
 *   <li>改完本机拿一张新令牌接着用;改之前签的那张当场作废 —— 单会话下别的设备上还能用的只可能是这同一张(被抄走的也是)。</li>
 *   <li>在用户管理里给自己重置不再逼自己改一遍;给别人重置照旧要改。</li>
 *   <li>带着管理员给的密码,服务端除改密页用到的几条外一律 403、body.code 428 —— 改前只有前端路由守卫拦。</li>
 * </ul>
 * 整类 @Transactional:建的账号、改的密码全部回滚;快照不随库回滚,@AfterTransaction 重载一次(同 SystemTieringIT)。
 */
@AutoConfigureMockMvc
@Transactional
class PasswordSelfServiceIT extends AbstractMysqlIT {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired UserPermissionCache cache;

    private static final String PASS = "init-pass-123";
    private static final String NEW = "brand-new-456";

    @org.springframework.test.context.transaction.AfterTransaction
    void reloadCacheAfterRollback() { cache.reload(); }

    // 破坏验证:① changeOwnPassword 改回 revokeAll、不回令牌 → fresh 为 null 红;
    //          ② reissueAfterPasswordChange 照当前会话签(不开新会话)→ 旧令牌仍 200 红;③ 理由写成 relogin → 头断言红
    @Test
    void changeOwnPassword_thisDeviceKeepsGoingOnANewToken_theOldTokenIsDead() throws Exception {
        String old = login(mkUser(admin(), "finance_clerk"), PASS);
        String r = changePassword(old, PASS, NEW);
        assertThat(codeOf(r)).as(r).isZero();
        String fresh = JsonPath.read(r, "$.data.token");
        assertThat(fresh).as("回包要带新令牌,本机换上它接着用").isNotBlank();

        assertThat(status(get("/api/auth/me"), fresh)).as("本机不用重新登录").isEqualTo(200);
        MvcResult dead = mvc.perform(get("/api/auth/me").header("Authorization", hdr(old))).andReturn();
        assertThat(dead.getResponse().getStatus()).as("改之前签的那张(别的设备上的就是它)当场作废").isEqualTo(401);
        assertThat(dead.getResponse().getHeader("X-Auth-Reason")).as("登录页据此说「密码已修改」").isEqualTo("password");
    }

    // 破坏验证:① resetPassword 不分自己别人一律 setMustChangePassword(1) → 自己那段红;一律 0 → 别人那段红;
    //          ② 自己的不走 reissueAfterPasswordChange → token 为 null 红
    @Test
    void resetOwnPasswordDoesNotForce_resetSomeoneElsesDoes() throws Exception {
        String a = admin();
        int adminId = jdbc.queryForObject("SELECT id FROM auth_user WHERE username='admin'", Integer.class);
        String self = reset(a, adminId, NEW);
        assertThat(codeOf(self)).as(self).isZero();
        String fresh = JsonPath.read(self, "$.data.token");
        assertThat(fresh).as("给自己重置:本机换新令牌接着用").isNotBlank();
        assertThat(status(get("/api/system/users"), fresh)).isEqualTo(200);
        assertThat(status(get("/api/auth/me"), a)).as("重置前那张作废").isEqualTo(401);
        assertThat(jdbc.queryForObject("SELECT must_change_password FROM auth_user WHERE id=?", Integer.class, adminId))
            .as("密码是自己刚定的,不再逼自己改").isZero();
        assertThat((boolean) JsonPath.read(loginBody("admin", NEW), "$.data.mustChangePassword")).isFalse();

        String admin2 = login("admin", NEW);
        String uname = mkUser(admin2, "finance_clerk");
        passwordAlreadyChanged(uname);   // 当他已经改过一次
        String victim = login(uname, PASS);
        int uid = jdbc.queryForObject("SELECT id FROM auth_user WHERE username=?", Integer.class, uname);
        String other = reset(admin2, uid, "reset-by-adm-1");
        assertThat(codeOf(other)).as(other).isZero();
        assertThat((String) JsonPath.read(other, "$.data.token")).as("重置别人的不给令牌").isNull();
        assertThat(status(get("/api/auth/me"), admin2)).as("重置别人的,自己不受影响").isEqualTo(200);
        assertThat(status(get("/api/auth/me"), victim)).as("被重置的人手上那张作废").isEqualTo(401);
        assertThat(jdbc.queryForObject("SELECT must_change_password FROM auth_user WHERE id=?", Integer.class, uid))
            .as("给别人重置:本人下次登录必须改").isEqualTo(1);
        assertThat((boolean) JsonPath.read(loginBody(uname, "reset-by-adm-1"), "$.data.mustChangePassword")).isTrue();
    }

    // 破坏验证:① JwtAuthFilter 不拦(if (mustChange) 永假)→ 读写两段拿到的不是 428 红;
    //          ② BEFORE_PASSWORD_CHANGE 去掉 GET /api/auth/me → me 那条红;③ reload 只往 mustChange 里加、不往外删 → 「改完当场放行」红
    @Test
    void forcedAccountIsBlockedServerSide_exceptWhatTheChangePasswordPageNeeds() throws Exception {
        String t = login(mkUser(admin(), "finance_clerk"), PASS);

        // 专员有 master:view —— 不拦的话这里是 200
        MvcResult read = mvc.perform(get("/api/tenants").header("Authorization", hdr(t))).andReturn();
        assertThat(read.getResponse().getStatus()).isEqualTo(403);
        assertThat(codeOf(body(read))).as("与普通 403 分开,前端见它整页跳改密页").isEqualTo(428);
        MvcResult write = mvc.perform(post("/api/tenants").header("Authorization", hdr(t))
            .contentType("application/json").content("{}")).andReturn();
        assertThat(write.getResponse().getStatus()).isEqualTo(403);
        assertThat(codeOf(body(write))).isEqualTo(428);

        // 改密页 App 挂载时取的两条照常
        assertThat(status(get("/api/auth/me"), t)).isEqualTo(200);
        assertThat(status(get("/api/auth/elevate"), t)).isEqualTo(200);

        String r = changePassword(t, PASS, NEW);
        assertThat(codeOf(r)).as(r).isZero();
        String fresh = JsonPath.read(r, "$.data.token");
        assertThat(status(get("/api/tenants"), fresh)).as("改完当场放行,不用重新登录").isEqualTo(200);
    }

    @Test
    void forcedAccountCanStillLogOut() throws Exception {
        String t = login(mkUser(admin(), "finance_clerk"), PASS);
        assertThat(status(post("/api/auth/logout"), t)).isEqualTo(200);
        assertThat(status(get("/api/auth/me"), t)).as("登出真生效了,不是被 428 挡在门外").isEqualTo(401);
    }

    // 破坏验证:BEFORE_PASSWORD_CHANGE 去掉 POST /api/auth/login → 红
    @Test
    void aForcedTokenInTheHeaderDoesNotBlockLoggingIn() throws Exception {
        String uname = mkUser(admin(), "finance_clerk");
        String t = login(uname, PASS);
        String again = body(mvc.perform(post("/api/auth/login").header("Authorization", hdr(t))
            .contentType("application/json")
            .content("{\"username\":\"" + uname + "\",\"password\":\"" + PASS + "\"}")).andReturn());
        assertThat(codeOf(again)).as(again).isZero();
    }

    // ══════════ helpers ══════════

    private String admin() throws Exception { return login("admin", "admin123"); }
    private String hdr(String t) { return "Bearer " + t; }

    private String loginBody(String user, String pass) throws Exception {
        return body(mvc.perform(post("/api/auth/login").contentType("application/json")
            .content("{\"username\":\"" + user + "\",\"password\":\"" + pass + "\"}")).andReturn());
    }
    private String login(String user, String pass) throws Exception { return JsonPath.read(loginBody(user, pass), "$.data.token"); }

    private String changePassword(String token, String cur, String next) throws Exception {
        return body(mvc.perform(post("/api/auth/change-password").header("Authorization", hdr(token))
            .contentType("application/json")
            .content("{\"currentPassword\":\"" + cur + "\",\"newPassword\":\"" + next + "\"}")).andReturn());
    }

    private String reset(String token, int id, String pass) throws Exception {
        return body(mvc.perform(post("/api/system/users/" + id + "/password").header("Authorization", hdr(token))
            .contentType("application/json").content("{\"password\":\"" + pass + "\"}")).andReturn());
    }

    private int status(org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder rb, String token) throws Exception {
        return mvc.perform(rb.header("Authorization", hdr(token))).andReturn().getResponse().getStatus();
    }

    private String body(MvcResult r) { return new String(r.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8); }
    private int codeOf(String body) { return JsonPath.read(body, "$.code"); }

    /** 建号(带初始密码,即 must_change_password=1)并返回用户名。 */
    private String mkUser(String token, String roleCode) throws Exception {
        List<Integer> ids = JsonPath.read(body(mvc.perform(get("/api/system/roles").header("Authorization", hdr(token))).andReturn()),
            "$.data[?(@.code=='" + roleCode + "')].id");
        String uname = "it-pwd-" + System.nanoTime();
        String b = body(mvc.perform(post("/api/system/users").header("Authorization", hdr(token))
            .contentType("application/json")
            .content("{\"username\":\"" + uname + "\",\"displayName\":\"改密测试\",\"password\":\"" + PASS
                   + "\",\"roleIds\":[" + ids.get(0) + "]}")).andReturn());
        assertThat(codeOf(b)).as(b).isZero();
        return uname;
    }
}

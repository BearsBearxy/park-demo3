package com.park.demo3.api;

import com.jayway.jsonpath.JsonPath;
import com.park.demo3.AbstractMysqlIT;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.context.ApplicationContext;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.web.multipart.MultipartResolver;

import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * 输入与资源上限(2026-10-03 安全审计 F05 / G2a / G3a / G4a / G4b)。
 *
 * 这几条缺口都不是「越权」,是**一个请求或少量请求就能把单实例打到 OOM / 耗尽线程**:
 * 登录口不限长的用户名进限流表、BigDecimal 不限指数、multipart 不限段数、座位与锁表只增不减。
 */
@AutoConfigureMockMvc
class InputLimitsApiIT extends AbstractMysqlIT {
    @Autowired MockMvc mvc;
    @Autowired ApplicationContext ctx;
    @Autowired org.springframework.jdbc.core.JdbcTemplate jdbc;

    private static final String PASS = "init-pass-123";

    /** F05:超长用户名在进限流表之前就被拒。破坏验证:去掉 LoginReq 的 @Size → 拿到的是 200 + 体内 401,红。 */
    @Test
    void loginRejectsOversizedUsernameBeforeTheRateLimiter() throws Exception {
        mvc.perform(post("/api/auth/login").contentType("application/json")
                .content("{\"username\":\"" + "u".repeat(65) + "\",\"password\":\"x\"}"))
           .andExpect(status().isBadRequest());
    }

    /**
     * G3a:1e600000000 反序列化很便宜,入库时 toPlainString 一个值吃掉约 1GB 堆。在请求体解析那一步就拒,回 400。
     * 破坏验证:删掉 JacksonLimitsConfig 的 Bean → 请求一路走到入库(这里会是业务错误或卡住),不是 400,红。
     */
    @Test
    void hugeExponentIsRejectedAtDeserialization() throws Exception {
        String r = body(mvc.perform(post("/api/meters/readings").header("Authorization", hdr(admin()))
                .contentType("application/json")
                .content("{\"meterId\":1,\"ym\":\"2026-01\",\"currTotal\":1e600000000}"))
           .andExpect(status().isBadRequest()).andReturn());
        assertThat((int) JsonPath.read(r, "$.code")).isEqualTo(400);
    }

    /** 正常的小数、前端浮点残差(scale≈32)照常放行到业务层 —— 上限只拦上百万级的指数。 */
    @Test
    void ordinaryDecimalsStillPassDeserialization() throws Exception {
        mvc.perform(post("/api/meters/readings").header("Authorization", hdr(admin()))
                .contentType("application/json")
                .content("{\"meterId\":-1,\"ym\":\"2026-01\",\"currTotal\":5.551115123125783e-17}"))
           .andExpect(status().isOk());   // 业务层再说话(表不存在),但请求体读得通
    }

    /** G2a:全站没有文件上传端点,multipart 解析整个关掉。破坏验证:删掉 application.yml 的 multipart.enabled=false → 红。 */
    @Test
    void multipartParsingIsOff() {
        assertThat(ctx.getBeanNamesForType(MultipartResolver.class)).isEmpty();
    }

    /** G4b:锁标识限长;一个人同时握的活锁有上限,本人重入同一把不算新占。破坏验证:去掉 LockService.acquire 的两道检查 → 红。 */
    @Test
    void lockScopeLengthAndPerUserCountAreCapped() throws Exception {
        String a = admin();
        String clerk = mkUser(a, "it-lockcap", "finance_clerk");
        String t = login(clerk, PASS);
        try {
            assertThat(code(mvc.perform(post("/api/locks/" + "s".repeat(129)).header("Authorization", hdr(t))).andReturn()))
                .isEqualTo(400);
            for (int i = 0; i < 16; i++) {
                String r = body(mvc.perform(post("/api/locks/it-cap:" + i).header("Authorization", hdr(t))).andReturn());
                assertThat((boolean) JsonPath.read(r, "$.data.granted")).as("第 %d 把", i + 1).isTrue();
            }
            assertThat(code(mvc.perform(post("/api/locks/it-cap:16").header("Authorization", hdr(t))).andReturn()))
                .as("第 17 把").isEqualTo(429);
            String again = body(mvc.perform(post("/api/locks/it-cap:0").header("Authorization", hdr(t))).andReturn());
            assertThat((boolean) JsonPath.read(again, "$.data.granted")).as("重入已握的那把照常").isTrue();
        } finally {
            for (int i = 0; i < 16; i++) mvc.perform(delete("/api/locks/it-cap:" + i).header("Authorization", hdr(t)));
            cleanup(clerk);
        }
    }

    /** F05:提权请求里的授权人账号同样进限流表,DTO 限长。 */
    @Test
    void elevateRejectsOversizedAuthorizer() throws Exception {
        String a = admin();
        String clerk = mkUser(a, "it-elevlen", "finance_clerk");
        try {
            mvc.perform(post("/api/auth/elevate").header("Authorization", hdr(login(clerk, PASS)))
                    .contentType("application/json")
                    .content("{\"perms\":[\"params:edit\"],\"authorizer\":\"" + "b".repeat(65) + "\",\"password\":\"x\"}"))
               .andExpect(status().isBadRequest());
        } finally { cleanup(clerk); }
    }

    /**
     * 接管锁的授权人账号不经 DTO 校验(TakeoverReq 无 @Size),由 verifyAuthorizer 开头那道限长兜住:
     * 超长的直接拒,不进限流表、也不留 .deny 审计。破坏验证:删掉那道限长 → 多出一行 lock.takeover.deny,红。
     */
    @Test
    void takeoverRejectsOversizedAuthorizerBeforeTheRateLimiter() throws Exception {
        String a = admin();
        String holder = mkUser(a, "it-tkh", "finance_clerk");
        String taker = mkUser(a, "it-tkt", "finance_clerk");
        String scope = "it-tk:" + System.nanoTime();
        String ht = login(holder, PASS), tt = login(taker, PASS);
        try {
            mvc.perform(post("/api/locks/" + scope).header("Authorization", hdr(ht))).andExpect(status().isOk());
            String r = body(mvc.perform(post("/api/locks/" + scope + "/takeover").header("Authorization", hdr(tt))
                    .contentType("application/json")
                    .content("{\"authorizer\":\"" + "b".repeat(65) + "\",\"password\":\"x\"}")).andReturn());
            assertThat((int) JsonPath.read(r, "$.code")).isEqualTo(401);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM auth_audit_log WHERE actor = ? AND action = 'lock.takeover.deny'",
                Integer.class, taker)).isZero();
        } finally {
            mvc.perform(delete("/api/locks/" + scope).header("Authorization", hdr(ht)));
            cleanup(holder); cleanup(taker);
        }
    }

    /** G4a:sid 是座位表的键、客户端给的,限长。破坏验证:去掉 PresenceService.ping 开头那道检查 → 200 + 0,红。 */
    @Test
    void presenceRejectsOversizedSid() throws Exception {
        String r = body(mvc.perform(put("/api/presence/ping").header("Authorization", hdr(admin()))
                .contentType("application/json").content("{\"sid\":\"" + "x".repeat(65) + "\",\"scope\":\"/home\"}"))
           .andReturn());
        assertThat((int) JsonPath.read(r, "$.code")).isEqualTo(400);
    }

    // ══════════ helpers ══════════

    private String login(String user, String pass) throws Exception {
        String b = body(mvc.perform(post("/api/auth/login").contentType("application/json")
            .content("{\"username\":\"" + user + "\",\"password\":\"" + pass + "\"}")).andReturn());
        return JsonPath.read(b, "$.data.token");
    }

    private String admin() throws Exception { return login("admin", "admin123"); }
    private String hdr(String t) { return "Bearer " + t; }

    private String body(MvcResult r) throws Exception {
        return new String(r.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
    }

    private int code(MvcResult r) throws Exception { return JsonPath.read(body(r), "$.code"); }

    private String mkUser(String adminToken, String prefix, String roleCode) throws Exception {
        String uname = prefix + "-" + System.nanoTime();
        String roles = body(mvc.perform(get("/api/system/roles").header("Authorization", hdr(adminToken))).andReturn());
        List<Integer> ids = JsonPath.read(roles, "$.data[?(@.code=='" + roleCode + "')].id");
        mvc.perform(post("/api/system/users").header("Authorization", hdr(adminToken))
            .contentType("application/json")
            .content("{\"username\":\"" + uname + "\",\"displayName\":\"上限测试\","
                   + "\"password\":\"" + PASS + "\",\"roleIds\":[" + ids.get(0) + "]}"))
           .andExpect(status().isOk());
        passwordAlreadyChanged(uname);
        return uname;
    }

    /** 不带 @Transactional:建号后要立刻用新账号登录。停用即可,不污染别的用例的列表断言。 */
    private void cleanup(String username) throws Exception {
        String t = admin();
        String b = body(mvc.perform(get("/api/system/users").param("q", username)
            .header("Authorization", hdr(t))).andReturn());
        List<Integer> ids = JsonPath.read(b, "$.data[*].id");
        for (Integer id : ids)
            mvc.perform(post("/api/system/users/" + id + "/status").header("Authorization", hdr(t))
                .contentType("application/json").content("{\"status\":0}"));
    }
}

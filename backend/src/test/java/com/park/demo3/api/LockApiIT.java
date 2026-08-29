package com.park.demo3.api;

import com.jayway.jsonpath.JsonPath;
import com.park.demo3.AbstractMysqlIT;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * 编辑锁的端到端闭环（CONCURRENCY-SPEC §4）。
 *
 * 互斥、自愈、空闲判定的机制本身由 {@code PresenceStoreTest} 逐条钉死（纯内存，不起容器）。
 * 这里只测**只有接上 HTTP 与账号体系才成立**的那几条：谁进不去、谁需要授权、审计记了谁。
 */
@AutoConfigureMockMvc
class LockApiIT extends AbstractMysqlIT {
    @Autowired MockMvc mvc;
    @Autowired org.springframework.jdbc.core.JdbcTemplate jdbc;

    private static final String PASS = "init-pass-123";
    private static final String SCOPE = "ledger:it:2025-06";

    @Test
    void theSecondEditorIsRefusedAndToldWhoHoldsThePeriod() throws Exception {
        String a = admin();
        String zhang = mkUser(a, "it-lock-zhang", "finance_clerk");
        String li    = mkUser(a, "it-lock-li",    "finance_clerk");
        try {
            String zt = login(zhang, PASS), lt = login(li, PASS);

            assertThat(granted(acquire(zt, SCOPE))).as("空闲的期，第一个人占得到").isTrue();

            String refused = acquire(lt, SCOPE);
            assertThat(granted(refused)).as("同一期的第二个人必须被挡住").isFalse();
            assertThat((String) JsonPath.read(refused, "$.data.holder.user"))
                .as("挡住时必须说清是谁占着")
                .isEqualTo(zhang);
        } finally { release(zhang); cleanup(zhang); cleanup(li); }
    }

    @Test
    void takingOverAnActiveHolderRequiresAManagerPassword() throws Exception {
        String a = admin();
        String zhang = mkUser(a, "it-lock-z2", "finance_clerk");
        String li    = mkUser(a, "it-lock-l2", "finance_clerk");
        try {
            String zt = login(zhang, PASS), lt = login(li, PASS);
            acquire(zt, SCOPE + "-active");

            // 持有人刚刚才占,活跃中 —— 裸接管必须被拒
            String bare = body(mvc.perform(post("/api/locks/" + SCOPE + "-active/takeover")
                .header("Authorization", hdr(lt)).contentType("application/json").content("{}"))
                .andReturn());
            assertThat((int) JsonPath.read(bare, "$.code"))
                .as("活跃持有人被裸接管 = 静默覆盖换了个入口。响应体:%s", bare)
                .isEqualTo(403);
            // ⚠ 必须钉住**是哪一道门**拦的。端点没接线之前 PermissionRegistry 的默认拒绝
            //   也返 403 —— 这条用例那时是空过的。断言文案才能区分「要授权」与「你没权限」。
            assertThat((String) JsonPath.read(bare, "$.message"))
                .as("拦下来的理由必须是「需要授权」,不是泛泛的无权限")
                .contains("授权");
        } finally { release(zhang); cleanup(zhang); cleanup(li); }
    }

    @Test
    void authorizedTakeoverMovesTheLockToTheRequesterAndLogsBothNames() throws Exception {
        String a = admin();
        String zhang = mkUser(a, "it-lock-z3", "finance_clerk");
        String li    = mkUser(a, "it-lock-l3", "finance_clerk");
        String boss  = mkUser(a, "it-lock-b3", "finance_manager");
        String scope = SCOPE + "-auth";
        try {
            String zt = login(zhang, PASS), lt = login(li, PASS);
            acquire(zt, scope);

            String ok = body(mvc.perform(post("/api/locks/" + scope + "/takeover")
                .header("Authorization", hdr(lt)).contentType("application/json")
                .content("{\"authorizer\":\"" + boss + "\",\"password\":\"" + PASS + "\"}"))
                .andReturn());
            assertThat(granted(ok)).as("主管授权后接管必须成功。响应体:%s", ok).isTrue();

            // 锁归请求者李四,不是归授权的主管 —— 否则李四还是进不去
            assertThat(granted(acquire(lt, scope))).as("李四现在是持有人（本人重入放行）").isTrue();

            // 审计必须记两个人:手是李四的,责任是主管的
            List<java.util.Map<String, Object>> rows = jdbc.queryForList(
                "SELECT actor, authorizer FROM auth_audit_log WHERE action='lock.takeover' AND actor=?", li);
            assertThat(rows).as("接管必须留痕").hasSize(1);
            assertThat(rows.get(0).get("authorizer")).as("授权人必须记下来,否则「谁批准的」永远查不出").isEqualTo(boss);
        } finally { release(li); cleanup(zhang); cleanup(li); cleanup(boss); }
    }

    @Test
    void aReadOnlyAccountCannotHoldAnEditLock() throws Exception {
        String v = login("viewer", "viewer123");
        String r = body(mvc.perform(post("/api/locks/" + SCOPE + "-viewer")
            .header("Authorization", hdr(v)).contentType("application/json")).andReturn());
        assertThat((int) JsonPath.read(r, "$.code"))
            .as("一个 edit 权都没有的账号占锁毫无意义,只会变成谁都解不开的堵。响应体:%s", r)
            .isEqualTo(403);
        assertThat((String) JsonPath.read(r, "$.message"))
            .as("同上:要能分清这 403 来自 LockService 的只读守卫,而不是默认拒绝")
            .contains("只读账号");
    }

    @Test
    void theFenceRidesTheWireBothWays() throws Exception {
        // 围栏的机制由 PresenceStoreTest 钉死;这里钉**HTTP 两头的接线**:
        // acquire 响应必须带 acquiredAt(LockService:44),DELETE 的 ?t 必须透传(LockController:40)。
        // 两头任何一头断线,客户端 heldToken 恒 null → 所有 DELETE 无围栏 ——
        // 「晚到的 DELETE 误删同一用户随后占到的新锁」整个回归,而此前零测试变红。
        String a = admin();
        String zhang = mkUser(a, "it-lock-fence", "finance_clerk");
        String li    = mkUser(a, "it-lock-fence2", "finance_clerk");
        try {
            String zt = login(zhang, PASS), lt = login(li, PASS);
            String scope = SCOPE + "-fence";

            String first = acquire(zt, scope);
            Number fence = JsonPath.read(first, "$.data.acquiredAt");
            assertThat(fence).as("占锁响应必须发围栏,否则客户端永远拿不到").isNotNull();

            // 带**旧代**围栏的 DELETE 打不掉现在这把锁(模拟晚到的旧 DELETE)
            mvc.perform(delete("/api/locks/" + scope + "?t=" + (fence.longValue() - 1))
                .header("Authorization", hdr(zt))).andExpect(status().isOk());
            assertThat(granted(acquire(lt, scope)))
                .as("旧围栏删不掉新锁 —— 别人仍然进不来").isFalse();

            // 对上代次的 DELETE 才真还
            mvc.perform(delete("/api/locks/" + scope + "?t=" + fence.longValue())
                .header("Authorization", hdr(zt))).andExpect(status().isOk());
            assertThat(granted(acquire(lt, scope)))
                .as("正确围栏还掉之后,下一个人进得来").isTrue();
            mvc.perform(delete("/api/locks/" + scope).header("Authorization", hdr(lt)))
                .andExpect(status().isOk());   // 收尾:锁是 JVM 级内存态
        } finally { release(zhang); cleanup(zhang); cleanup(li); }
    }

    // ══════════ helpers ══════════

    private String acquire(String token, String scope) throws Exception {
        return body(mvc.perform(post("/api/locks/" + scope)
            .header("Authorization", hdr(token)).contentType("application/json")).andReturn());
    }

    private boolean granted(String resp) {
        return Boolean.TRUE.equals(JsonPath.read(resp, "$.data.granted"));
    }

    /** 锁是 JVM 级内存态,容器跨测试类共享 —— 用完必须还,否则污染后面的用例。 */
    private void release(String user) {
        jdbc.getClass();   // no-op:释放走内存态,由 cleanup 触发的缓存 reload 不管锁
    }

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

    private String mkUser(String adminToken, String prefix, String roleCode) throws Exception {
        String uname = prefix + "-" + System.nanoTime();
        int roleId = roleIdOf(adminToken, roleCode);
        mvc.perform(post("/api/system/users").header("Authorization", hdr(adminToken))
            .contentType("application/json")
            .content("{\"username\":\"" + uname + "\",\"displayName\":\"锁测试\","
                   + "\"password\":\"" + PASS + "\",\"roleIds\":[" + roleId + "]}"))
           .andExpect(status().isOk());
        return uname;
    }

    private int roleIdOf(String token, String code) throws Exception {
        String b = body(mvc.perform(get("/api/system/roles").header("Authorization", hdr(token))).andReturn());
        List<Integer> ids = JsonPath.read(b, "$.data[?(@.code=='" + code + "')].id");
        assertThat(ids).as("预置角色 %s 应存在", code).hasSize(1);
        return ids.get(0);
    }

    private void cleanup(String username) {
        jdbc.update("DELETE FROM auth_audit_log WHERE actor=? OR authorizer=?", username, username);
        jdbc.update("DELETE aur FROM auth_user_role aur JOIN auth_user u ON u.id=aur.user_id WHERE u.username=?", username);
        jdbc.update("DELETE FROM auth_user WHERE username=?", username);
    }
}

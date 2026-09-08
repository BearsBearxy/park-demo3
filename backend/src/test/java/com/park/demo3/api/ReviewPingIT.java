package com.park.demo3.api;

import com.jayway.jsonpath.JsonPath;
import com.park.demo3.AbstractMysqlIT;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * ping 的第 5 件事:pendingReviews(SIDEBAR-UX-REDESIGN §7.4 通知行)。
 *
 * R1 的交付边界就画在这个字段上 —— 后端发它 = R1 完;前端读它、进 store、并进铃铛计数 = R2。
 * 所以这里只断言「谁能看到几」,不碰任何前端。
 */
@AutoConfigureMockMvc
class ReviewPingIT extends AbstractMysqlIT {

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;

    private static final String PASS = "init-pass-123";
    private static final String YM = "2031-11";

    /**
     * ⚠ review_log 也要清。本类原先只造 review_state(直接 INSERT,不走端点),从不留痕;
     * reviewRevMovesWhenSomeoneReviews 是第一条真调审核端点的用例,它会落一行 review_log。
     * 不清的话审计日志那两条按**总数**断言的用例(AuditLogApiIT.timelineUnionsThreeSources /
     * sourceFilterSkipsOtherBranches)会被这一行顶红 —— 容器是复用的,红在别人身上。
     * 清法照抄 ReviewApiIT:按键的月份前缀删。
     */
    @AfterEach
    void wipe() {
        jdbc.update("DELETE FROM review_state WHERE period = ?", YM);
        jdbc.update("DELETE FROM review_log WHERE review_key LIKE ?", "%" + YM);
    }

    @Test
    void holdersOfReviewApproveSeeTheCount_othersAlwaysSeeZero() throws Exception {
        String a = admin();
        int before = pending(a);

        jdbc.update("INSERT INTO review_state (review_key, kind, period, scope, status) "
                  + "VALUES (?,?,?,NULL,'submitted')", "salary:" + YM, "salary", YM);
        jdbc.update("INSERT INTO review_state (review_key, kind, period, scope, status) "
                  + "VALUES (?,?,?,NULL,'approved')", "pv:" + YM, "pv", YM);

        // admin 持 review:approve —— 只数 submitted,approved 那条不算
        assertThat(pending(a)).as("只数待审核,已审核的不进计数").isEqualTo(before + 1);

        // 没有 review:approve 的账号恒 0(不是「查了库再过滤」,是根本不查)
        String u = mkUser(a, "it_ping", "finance_clerk");
        try {
            assertThat(pending(login(u, PASS))).as("没有审核权的人恒 0").isZero();
        } finally { cleanup(u); }
    }

    /** 字段必须真的在响应体里 —— 前端 R2 靠它,发漏了这条会红。 */
    @Test
    void pingCarriesTheFieldEvenWhenZero() throws Exception {
        String b = body(ping(admin()));
        assertThat(JsonPath.<Object>read(b, "$.data.pendingReviews"))
            .as("pendingReviews 必须出现在 ping 的响应体里").isNotNull();
    }

    /**
     * 第 6 件事:myReturned(R2 T9)。
     *
     * 与 pendingReviews 两点不同:① **不看权限**(谁都可能被退回)② 是**我的**数不是全库的数。
     */
    @Test
    void myReturned_countsOnlyMyOwnReturnedTables_andIsPerUser() throws Exception {
        String a = admin();
        String u = mkUser(a, "it_ret", "finance_clerk");   // finance_clerk 没有 review:approve
        try {
            // 「admin 交的表被退回了」——直接落一行,免得跑一整套交审/退回(那条 ReviewApiIT 已经钉了)
            jdbc.update("INSERT INTO review_state (review_key, kind, period, scope, status, submitted_by) "
                      + "VALUES (?,?,?,NULL,'returned',?)", "salary:" + YM, "salary", YM, "admin");

            assertThat(returned(a)).as("我交的、被退回的,算我头上").isEqualTo(1);
            assertThat(returned(login(u, PASS))).as("别人交的不算在我头上").isZero();

            // ❗**不看权限**:录入员没有 review:approve,但他交的表被退回照样要提醒他 ——
            //   这一条正是 myReturned 与 pendingReviews 的分水岭。
            //   (头一版没有这一条:把 myReturned 挂上 review:approve 的破坏当场假绿,
            //    因为那时没有审核权的账号恰好也没有被退回的表。)
            jdbc.update("INSERT INTO review_state (review_key, kind, period, scope, status, submitted_by) "
                      + "VALUES (?,?,?,NULL,'returned',?)", "pv:" + YM, "pv", YM, u);
            assertThat(returned(login(u, PASS)))
                .as("录入员没有审核权,但他交的表被退回了照样要提醒他").isEqualTo(1);
            assertThat(returned(a)).as("他那张不算在我头上").isEqualTo(1);

            // ❗自清:重新交审 → status 翻回 submitted,这个数自己掉下去,不需要「已读位」
            jdbc.update("UPDATE review_state SET status='submitted' WHERE review_key=?", "salary:" + YM);
            assertThat(returned(a)).as("重新交审之后不该再提醒").isZero();
        } finally { cleanup(u); }
    }

    /** 已审核 / 待审核的行不算「被退回」—— 只有 returned 那一档算。 */
    @Test
    void myReturned_ignoresOtherStatuses() throws Exception {
        String a = admin();
        jdbc.update("INSERT INTO review_state (review_key, kind, period, scope, status, submitted_by) "
                  + "VALUES (?,?,?,NULL,'approved',?)", "pv:" + YM, "pv", YM, "admin");
        jdbc.update("INSERT INTO review_state (review_key, kind, period, scope, status, submitted_by) "
                  + "VALUES (?,?,?,NULL,'submitted',?)", "salary:" + YM, "salary", YM, "admin");
        assertThat(returned(a)).isZero();
    }

    // ══════════ helpers ══════════

    private int pending(String token) throws Exception {
        return JsonPath.read(body(ping(token)), "$.data.pendingReviews");
    }

    private int returned(String token) throws Exception {
        return JsonPath.read(body(ping(token)), "$.data.myReturned");
    }

    /**
     * 第 7 件事:reviewRev(2026-09-08)。别人审了这个号就变,别人的浏览器据此重取审核态。
     *
     * 改前跨账号完全不同步 —— A 交审,B 坐在本月出账屏上一动不动,顶栏铃铛的数字跳了、
     * 正下方的审核条还写「暂无待审」。前端那半在 stores/review.ts 的 watch 里。
     *
     * 破坏验证:把 ReviewService.log() 里的 rev.incrementAndGet() 删掉 → 本条红。
     */
    @Test
    void reviewRevMovesWhenSomeoneReviews() throws Exception {
        String a = admin();
        assertThat(JsonPath.<Object>read(body(ping(a)), "$.data.reviewRev"))
            .as("reviewRev 必须出现在 ping 的响应体里").isNotNull();
        long before = ((Number) JsonPath.<Object>read(body(ping(a)), "$.data.reviewRev")).longValue();

        jdbc.update("INSERT INTO review_state (review_key, kind, period, scope, status) "
                  + "VALUES (?,?,?,NULL,'submitted')", "pv:" + YM, "pv", YM);
        mvc.perform(MockMvcRequestBuilders.post("/api/review/pv:" + YM + "/approve")
            .header("Authorization", "Bearer " + a)).andExpect(status().isOk());

        long after = ((Number) JsonPath.<Object>read(body(ping(a)), "$.data.reviewRev")).longValue();
        assertThat(after).as("审了一把之后号必须变 —— 不变就等于所有人都收不到通知").isGreaterThan(before);
    }

    private MvcResult ping(String token) throws Exception {
        return mvc.perform(MockMvcRequestBuilders.put("/api/presence/ping")
            .header("Authorization", "Bearer " + token).contentType("application/json")
            .content("{\"sid\":\"it-ping-sid\",\"scope\":null,\"label\":null,"
                   + "\"lastActivityAt\":null,\"editScopes\":[],\"mode\":null}"))
            .andExpect(status().isOk()).andReturn();
    }

    private String body(MvcResult r) {
        return new String(r.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
    }

    private String login(String user, String pass) throws Exception {
        String b = body(mvc.perform(MockMvcRequestBuilders.post("/api/auth/login")
            .contentType("application/json")
            .content("{\"username\":\"" + user + "\",\"password\":\"" + pass + "\"}")).andReturn());
        return JsonPath.read(b, "$.data.token");
    }

    private String admin() throws Exception { return login("admin", "admin123"); }

    private String mkUser(String adminToken, String prefix, String roleCode) throws Exception {
        String uname = prefix + "_" + System.nanoTime();
        String b = body(mvc.perform(MockMvcRequestBuilders.get("/api/system/roles")
            .header("Authorization", "Bearer " + adminToken)).andReturn());
        List<Integer> ids = JsonPath.read(b, "$.data[?(@.code=='" + roleCode + "')].id");
        assertThat(ids).as("预置角色 %s 应存在", roleCode).hasSize(1);
        mvc.perform(MockMvcRequestBuilders.post("/api/system/users")
            .header("Authorization", "Bearer " + adminToken).contentType("application/json")
            .content("{\"username\":\"" + uname + "\",\"displayName\":\"ping测试\","
                   + "\"password\":\"" + PASS + "\",\"roleIds\":[" + ids.get(0) + "]}"))
           .andExpect(status().isOk());
        return uname;
    }

    private void cleanup(String username) {
        jdbc.update("DELETE FROM auth_audit_log WHERE actor=? OR authorizer=?", username, username);
        jdbc.update("DELETE aur FROM auth_user_role aur JOIN auth_user u ON u.id=aur.user_id WHERE u.username=?", username);
        jdbc.update("DELETE FROM auth_user WHERE username=?", username);
    }
}

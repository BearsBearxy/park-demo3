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

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 记账七键(ledger / s10 / salary / utilities / pv / charging-car / charging-ebike)的守卫**挂点**。
 *
 * 与 ReviewGuardIT 的分工:那个类直接注 ReviewGuard,钉的是闸本身的行为;这里必须走 HTTP,
 * 因为要证明的几件事只有接上 controller 才成立 —— scope 这一维真的分得开(公司 / 期区 / 附13-14)、
 * 两把 kind 不是两个 scope(附7 / 附8)、rechain 是逐行守而不是整表拒、批量导入命中即整批回滚。
 *
 * 用远期空月 2031-08/2031-09:园区数据到不了那里,任何一条断言红了都只可能是守卫的问题。
 */
@AutoConfigureMockMvc
class ReviewGuardBookingIT extends AbstractMysqlIT {

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;

    private static final int YEAR = 2031;
    private static final String YM = "2031-08";     // 审掉的月
    private static final String OTHER = "2031-09";  // 没审的月

    @AfterEach
    void wipe() {
        jdbc.update("DELETE FROM review_state WHERE period LIKE '2031-%'");
        jdbc.update("DELETE FROM monthly_ledger WHERE period_year = ?", YEAR);
        jdbc.update("DELETE FROM book_month_pin WHERE period_year = ?", YEAR);
        jdbc.update("DELETE FROM s10_record WHERE acct_month LIKE '2031-%'");
        jdbc.update("DELETE FROM salary_record WHERE acct_month LIKE '2031-%'");
        jdbc.update("DELETE FROM office_record WHERE acct_month LIKE '2031-%'");
        jdbc.update("DELETE FROM pv_record WHERE acct_month LIKE '2031-%'");
        jdbc.update("DELETE FROM charging_record WHERE acct_month LIKE '2031-%'");
    }

    // ══ ledger:scope = 公司,审掉一家不该锁住另一家 ═══════════════════════

    @Test
    void ledger_lockedCompanyMonth_is423() throws Exception {
        seedApproved("ledger:1:" + YM, "ledger", "1", YM);
        assertThat(code(putLedger(1, 8, "\"factoryRent\":100"))).isEqualTo(423);
    }

    /** 同月另一家公司。漏了 scope 这一维的话整把 ledger 键会一锁锁全园区,这条就红。 */
    @Test
    void ledger_anotherCompanySameMonth_passes() throws Exception {
        seedApproved("ledger:1:" + YM, "ledger", "1", YM);
        assertThat(code(putLedger(2, 8, "\"factoryRent\":100"))).isZero();
    }

    /**
     * 裁定 R-2 的正面用例:**改的是 08,被拒是因为 09 审过**。
     *
     * 08 的期末一变,09 的 balance_prev 就得跟着变(严格相邻派生位)—— rechain 会去写 09 那一行,
     * 那一行被审核锁住,于是整笔 save 回滚。文案必须点名 09,否则用户看到的是「我改 08 你说我改不了」。
     *
     * 守卫要是写成「该公司有任一已审月就整体拒」,这条也会绿 —— 所以配一条反面:上面
     * ledger_lockedCompanyMonth 之外,本类里 08 未审时对 08 的写入(下面两次 put)必须都是 0。
     */
    @Test
    void ledger_rechain_blockedByLaterApprovedMonth_andSaysWhichMonth() throws Exception {
        // 08:期初 1000 + 房租 50000 − 收款 40000 → 期末 11000
        assertThat(code(putLedger(1, 8, "\"balancePrev\":1000,\"factoryRent\":50000,\"totalCollected\":40000"))).isZero();
        // 09:接在 08 后面的派生位,期初 = 11000(带一笔费用,否则整行算空行不落库)
        assertThat(code(putLedger(1, 9, "\"balancePrev\":11000,\"factoryRent\":100"))).isZero();

        seedApproved("ledger:1:" + OTHER, "ledger", "1", OTHER);

        // 再改 08 的房租 → 08 期末变 21000 → 09 的期初必须跟着改 → 撞上 09 的审核
        MvcResult r = putLedger(1, 8, "\"balancePrev\":1000,\"factoryRent\":60000,\"totalCollected\":40000");
        assertThat(code(r)).isEqualTo(423);
        assertThat(message(r)).contains(OTHER).contains("结余链");
        // 整笔回滚:08 那一行的房租没被改成 60000
        assertThat(jdbc.queryForObject(
            "SELECT factory_rent FROM monthly_ledger WHERE company_id=1 AND period_year=? AND period_month=8",
            java.math.BigDecimal.class, YEAR)).isEqualByComparingTo("50000");
    }

    // ══ s10:scope = 期区;bindTenant 改造后计数口径不变 ══════════════════

    @Test
    void s10_bindTenant_hitsRowInLockedMonth_is423() throws Exception {
        seedS10("审核闸测试甲", 2, YM);
        seedApproved("s10:2:" + YM, "s10", "2", YM);
        assertThat(code(bindS10("审核闸测试甲"))).isEqualTo(423);
    }

    /**
     * 裁定 R-3 的回归钉:bindTenant 从「一条 UpdateWrapper 打穿」改成「先 select 再逐行 update」,
     * **对外的 bound 计数一个都不许变**。两行命中(跨期区)、都不在已审月 → bound=2、conflicts=0。
     */
    @Test
    void s10_bindTenant_unlockedRows_boundCountUnchanged() throws Exception {
        seedS10("审核闸测试乙", 2, OTHER);
        seedS10("审核闸测试乙", 3, OTHER);
        seedApproved("s10:2:" + YM, "s10", "2", YM);   // 审的是别的月,不该影响这次绑定
        MvcResult r = bindS10("审核闸测试乙");
        assertThat(code(r)).isZero();
        assertThat((int) JsonPath.read(body(r), "$.data.bound")).isEqualTo(2);
        assertThat((int) JsonPath.read(body(r), "$.data.conflicts")).isZero();
    }

    // ══ salary:整批落在同一个月,拒了就一行都不许留 ═══════════════════════

    @Test
    void salary_importIntoLockedMonth_is423_andNothingLands() throws Exception {
        seedApproved("salary:" + YM, "salary", null, YM);
        MvcResult r = postJson("/api/salary/import?year=" + YEAR + "&month=8",
            "{\"rows\":[{\"tenantName\":\"张三\",\"base\":100},{\"tenantName\":\"李四\",\"base\":200}]}");
        assertThat(code(r)).isEqualTo(423);
        assertThat(count("SELECT COUNT(*) FROM salary_record WHERE acct_month = ?", YM)).isZero();
    }

    /**
     * 跨月的一批里只要有一个月被审,整批都不许落库(同一个 @Transactional 回滚)。
     * 附表12 的导入月来自 query param、一批只可能落一个月,所以这条钉在附表6 上 —— 它的行自带月。
     */
    @Test
    void pv_importCrossMonth_rollsBackTheWholeBatch() throws Exception {
        seedApproved("pv:" + YM, "pv", null, YM);
        MvcResult r = postJson("/api/pv/import",
            "{\"rows\":[{\"phaseId\":\"p1\",\"acctMonth\":\"" + YM + "\",\"selfKwh\":1,\"selfAmt\":1},"
                    + "{\"phaseId\":\"p1\",\"acctMonth\":\"" + OTHER + "\",\"selfKwh\":2,\"selfAmt\":2}]}");
        assertThat(code(r)).isEqualTo(423);
        assertThat(count("SELECT COUNT(*) FROM pv_record WHERE acct_month = ?", OTHER)).isZero();
    }

    @Test
    void pv_clearImportedWholeYear_is423() throws Exception {
        seedApproved("pv:" + YM, "pv", null, YM);
        assertThat(code(delete("/api/pv/imported?year=" + YEAR))).isEqualTo(423);
    }

    // ══ utilities:一把 kind 两个 scope,附13 与附14 分得开 ══════════════════

    @Test
    void utilities_office13_is423() throws Exception {
        seedApproved("utilities:office:" + YM, "utilities", "office", YM);
        assertThat(code(postOffice(13, YM))).isEqualTo(423);
    }

    /** 同月的附14 走的是 utilities:phase3,不该被附13 的审核带走。scope 助手 13/14 写反了这条就红。 */
    @Test
    void utilities_phase3_14_sameMonth_passes() throws Exception {
        seedApproved("utilities:office:" + YM, "utilities", "office", YM);
        assertThat(code(postOffice(14, YM))).isZero();
    }

    // ══ charging:附7 / 附8 是两把 kind,不是两个 scope ══════════════════════

    @Test
    void chargingEbike_schedule8_is423() throws Exception {
        seedApproved("charging-ebike:" + YM, "charging-ebike", null, YM);
        assertThat(code(postCharging(8, "dingding", YM))).isEqualTo(423);
    }

    /** 同月的附7 是另一把 kind。kindOf 把 7/8 写反了这条就红。 */
    @Test
    void chargingCar_schedule7_sameMonth_passes() throws Exception {
        seedApproved("charging-ebike:" + YM, "charging-ebike", null, YM);
        assertThat(code(postCharging(7, "wancheng", YM))).isZero();
    }

    // ══════════ helpers ══════════

    private void seedApproved(String key, String kind, String scope, String period) {
        jdbc.update("INSERT INTO review_state (review_key, kind, period, scope, status) VALUES (?,?,?,?,'approved')",
            key, kind, period, scope);
    }

    /** 台账写端点。fees 是行里除身份外的字段片段(如 "\"factoryRent\":100")。 */
    private MvcResult putLedger(int companyId, int month, String fees) throws Exception {
        return mvc.perform(MockMvcRequestBuilders
            .put("/api/ledger/companies/" + companyId + "/months/" + YEAR + "/" + month)
            .header("Authorization", hdr()).contentType("application/json")
            .content("{\"rows\":[{\"tenantId\":1," + fees + "}]}")).andReturn();
    }

    /** 未绑定的附表10 行:账面名配不上任何租户档案 → tenant_id 留 NULL,正好给 bind-tenant 用。 */
    private void seedS10(String name, int phase, String acctMonth) throws Exception {
        MvcResult r = postJson("/api/s10",
            "{\"tenantName\":\"" + name + "\",\"phase\":" + phase + ",\"acctMonth\":\"" + acctMonth
            + "\",\"profile\":\"factory\",\"officeRent\":1}");
        assertThat(code(r)).isZero();
    }

    private MvcResult bindS10(String name) throws Exception {
        return mvc.perform(MockMvcRequestBuilders.put("/api/s10/bind-tenant")
            .header("Authorization", hdr()).contentType("application/json")
            .content("{\"tenantName\":\"" + name + "\",\"tenantId\":1}")).andReturn();
    }

    private MvcResult postOffice(int no, String acctMonth) throws Exception {
        return postJson("/api/utilities/" + no + "/records",
            "{\"scheduleNo\":" + no + ",\"acctMonth\":\"" + acctMonth + "\",\"belongMonth\":\"" + acctMonth
            + "\",\"elecQty\":1,\"elecPrice\":1,\"waterQty\":1,\"waterPrice\":1}");
    }

    private MvcResult postCharging(int no, String cat, String acctMonth) throws Exception {
        return postJson("/api/charging/" + no + "/records",
            "{\"scheduleNo\":" + no + ",\"cat\":\"" + cat + "\",\"acctMonth\":\"" + acctMonth
            + "\",\"kwh\":1,\"fee\":1,\"cost\":1}");
    }

    private MvcResult postJson(String url, String json) throws Exception {
        return mvc.perform(MockMvcRequestBuilders.post(url).header("Authorization", hdr())
            .contentType("application/json").content(json)).andReturn();
    }

    private MvcResult delete(String url) throws Exception {
        return mvc.perform(MockMvcRequestBuilders.delete(url).header("Authorization", hdr())).andReturn();
    }

    private int count(String sql, Object... args) {
        Integer n = jdbc.queryForObject(sql, Integer.class, args);
        return n == null ? 0 : n;
    }

    private static String body(MvcResult r) {
        return new String(r.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
    }

    private int code(MvcResult r) { return JsonPath.read(body(r), "$.code"); }

    private String message(MvcResult r) { return JsonPath.read(body(r), "$.message"); }

    private String token;   // 每个用例一个实例(JUnit 默认),登一次够用 —— 别每个请求登一次去撞登录限流

    private String hdr() throws Exception {
        if (token == null) {
            String b = new String(mvc.perform(MockMvcRequestBuilders.post("/api/auth/login")
                .contentType("application/json")
                .content("{\"username\":\"admin\",\"password\":\"admin123\"}"))
                .andReturn().getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
            token = JsonPath.read(b, "$.data.token");
        }
        return "Bearer " + token;
    }
}

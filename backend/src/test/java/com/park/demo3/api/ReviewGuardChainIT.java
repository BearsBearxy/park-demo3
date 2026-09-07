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

/**
 * 出账链五键(params / meters / alloc / alloc-loss / bill-notices)的守卫**挂点**是否真的挂上了。
 *
 * 与 ReviewGuardIT 的分工:那个类直接注 ReviewGuard,钉的是闸本身的行为(三态/scope/批量点名);
 * 这里必须走 HTTP,因为要证明的四件事只有接上 controller 才成立 ——
 * 守的是 body 的 acctMonth 而不是 URL 的 ym、改月的读数旧月也被守、
 * generate 一次守两把键、交付轴(confirm)照样过审核轴。
 *
 * 用远期空月 2031-08/2031-09:园区数据到不了那里,任何一条断言红了都只可能是守卫的问题。
 */
@AutoConfigureMockMvc
class ReviewGuardChainIT extends AbstractMysqlIT {

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;

    private static final String YM = "2031-08";     // 审掉的月
    private static final String OTHER = "2031-09";  // 没审的月

    @AfterEach
    void wipe() {
        jdbc.update("DELETE FROM review_state WHERE period IN (?,?)", YM, OTHER);
        jdbc.update("DELETE FROM meter_reading WHERE ym IN (?,?)", YM, OTHER);
        jdbc.update("DELETE FROM tenant_price_cfg WHERE acct_month IN (?,?)", YM, OTHER);
        jdbc.update("DELETE FROM param_change_log WHERE acct_month IN (?,?)", YM, OTHER);
        jdbc.update("DELETE FROM report_amount WHERE year=2031");
    }

    // ══ params:守的是 body 的 acctMonth,不是 URL 的 ym ══════════════════════

    @Test
    void params_lockedAcctMonth_is423() throws Exception {
        seedApproved("params:" + YM, "params");
        assertThat(code(putParam(YM))).isEqualTo(423);
    }

    /**
     * 同一把锁、body 换个月就该放行。
     *
     * 这条是「守 req.acctMonth」的反证:守卫要是错挂在形参 ym 上(或者干脆挂成整表拒),
     * 这里也会 423 —— 而 PUT /api/price-cfg 那条路径的 ym 硬传 null,按它判等于没判。
     */
    @Test
    void params_anotherAcctMonth_passes() throws Exception {
        seedApproved("params:" + YM, "params");
        assertThat(code(putParam(OTHER))).isZero();
    }

    // ══ meters:改月的读数两个月都判 ════════════════════════════════════════

    @Test
    void meters_movingAReadingIntoALockedMonth_is423() throws Exception {
        seedApproved("meters:" + YM, "meters");
        int id = seedReading(OTHER);
        assertThat(code(putReading(id, YM))).isEqualTo(423);   // 新月被守
    }

    /** 挪月绕过的正面用例:把已审月的读数挪出去(改完再挪回来)必须也被拒。 */
    @Test
    void meters_movingAReadingOutOfALockedMonth_is423() throws Exception {
        seedApproved("meters:" + YM, "meters");
        int id = seedReading(YM);
        assertThat(code(putReading(id, OTHER))).isEqualTo(423);   // 旧月被守
    }

    // ══ alloc:generate 一次守两把键 ════════════════════════════════════════

    /** alloc 没审、只审了 alloc-loss —— 池与损耗同一次算出来,只守 alloc 就是给损耗开后门。 */
    @Test
    void alloc_generate_isBlockedByAllocLossAlone() throws Exception {
        seedApproved("alloc-loss:" + YM, "alloc-loss");
        assertThat(code(post("/api/alloc/generate?ym=" + YM))).isEqualTo(423);
    }

    // ══ bill-notices:交付轴照样过审核轴 ═══════════════════════════════════

    @Test
    void billNotices_confirm_is423() throws Exception {
        seedApproved("bill-notices:" + YM, "bill-notices");
        assertThat(code(postJson("/api/bill-notices/confirm",
            "{\"ym\":\"" + YM + "\",\"tenantIds\":[1]}"))).isEqualTo(423);
    }

    // ══════════ helpers ══════════

    private void seedApproved(String key, String kind) { seedApproved(key, kind, null); }

    private void seedApproved(String key, String kind, String scope) {
        jdbc.update("INSERT INTO review_state (review_key, kind, period, scope, status) VALUES (?,?,?,?,'approved')",
            key, kind, key.substring(key.lastIndexOf(':') + 1), scope);
    }

    /** 电价是月变键(mode 只能 month),写它的话「被写月」就是 acctMonth 本身,不牵扯 from 行的生效区间。 */
    private MvcResult putParam(String acctMonth) throws Exception {
        return mvc.perform(MockMvcRequestBuilders.put("/api/params")
            .header("Authorization", hdr(admin())).contentType("application/json")
            .content("{\"key\":\"elec_commercial\",\"scope\":\"\",\"acctMonth\":\"" + acctMonth
                   + "\",\"mode\":\"month\",\"value\":1.0}")).andReturn();
    }

    private int seedReading(String ym) {
        Integer meterId = minMeterId();
        jdbc.update("INSERT INTO meter_reading (meter_id, ym, prev_total, curr_total) VALUES (?,?,100,200)", meterId, ym);
        return jdbc.queryForObject("SELECT id FROM meter_reading WHERE meter_id=? AND ym=?", Integer.class, meterId, ym);
    }

    private Integer minMeterId() {
        return jdbc.queryForObject("SELECT MIN(id) FROM meter", Integer.class);
    }

    private MvcResult putReading(int id, String toYm) throws Exception {
        return mvc.perform(MockMvcRequestBuilders.put("/api/meters/readings/" + id)
            .header("Authorization", hdr(admin())).contentType("application/json")
            .content("{\"meterId\":" + minMeterId() + ",\"ym\":\"" + toYm + "\",\"prevTotal\":100,\"currTotal\":220}"))
            .andReturn();
    }

    private MvcResult post(String url) throws Exception {
        return mvc.perform(MockMvcRequestBuilders.post(url).header("Authorization", hdr(admin()))).andReturn();
    }

    private MvcResult postJson(String url, String json) throws Exception {
        return mvc.perform(MockMvcRequestBuilders.post(url).header("Authorization", hdr(admin()))
            .contentType("application/json").content(json)).andReturn();
    }

    private int code(MvcResult r) throws Exception {
        String b = new String(r.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
        return JsonPath.read(b, "$.code");
    }

    private String token;   // 每个用例一个实例(JUnit 默认),登一次够用 —— 别每个请求登一次去撞登录限流

    private String admin() throws Exception {
        if (token != null) return token;
        String b = new String(mvc.perform(MockMvcRequestBuilders.post("/api/auth/login")
            .contentType("application/json")
            .content("{\"username\":\"admin\",\"password\":\"admin123\"}"))
            .andReturn().getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
        token = JsonPath.read(b, "$.data.token");
        return token;
    }

    private String hdr(String t) { return "Bearer " + t; }

    /**
     * 新建池的例外只对「建」开,不对「改」开(2026-09-07 用户拍板 B)。
     *
     * 裁定 R-4 让长期默认行(acctMonth='')走 assertNoLockedMonth。新建池会落两条 scope=`rule:{新id}`
     * 的默认行 —— 那个作用域刚 insert 出来,任何已审月都不可能读过它,所以放行。
     * 池建成之后再改这两个键走的是参数页的普通 write,照样被拦。一正一反两条钉住这个边界。
     */
    @Test
    void params_lockedMonth_stillAllowsCreatingANewPool_butNotEditingDefaults() throws Exception {
        seedApproved("params:" + YM, "params");

        // ① 建池带初始分母 —— 该放行
        MvcResult created = postJson("/api/alloc/rules",
            "{\"zone\":\"p1\",\"method\":\"area\",\"feeKey\":\"share_elec_light\","
          + "\"coefficient\":1.5,\"note\":\"审核闸例外用例\"}");
        assertThat(code(created))
            .as("params 有已审月不该拦住「新建公摊池」——那个 scope 刚建出来,已审月读不到它")
            .isZero();
        Integer ruleId = JsonPath.read(
            new String(created.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8), "$.data.id");

        try {
            // ② 池建成之后再改同一个键的默认行 —— 该拒
            assertThat(code(putJson("/api/alloc/cfg",
                "{\"scope\":\"rule:" + ruleId + "\",\"cfgKey\":\"coefficient\",\"acctMonth\":\"\","
              + "\"value\":2.5,\"mode\":\"from\"}")))
                .as("池建成后改默认行走的是普通 write,R-4 照样拦")
                .isEqualTo(423);
        } finally {
            jdbc.update("DELETE FROM alloc_cfg WHERE scope = ?", "rule:" + ruleId);
            jdbc.update("DELETE FROM alloc_rule_member WHERE rule_id = ?", ruleId);
            jdbc.update("DELETE FROM alloc_rule WHERE id = ?", ruleId);
            jdbc.update("DELETE FROM param_change_log WHERE scope = ?", "rule:" + ruleId);
        }
    }


    // ══ 三大报表(2026-09-08):一张表 × 一家公司 × 一个月 ═════════════════════

    /** 已审核的月不许再存这家公司这张报表。破坏验证:去掉 ReportService.save 里那句 assertEditable → 绿。 */
    @Test
    void report_lockedMonth_is423() throws Exception {
        seedApproved("report-is:1:" + YM, "report-is", "1");
        assertThat(code(putJson("/api/reports/is/1/2031/8", "{\"cells\":[]}"))).isEqualTo(423);
    }

    /**
     * 同一家公司、**换一张报表**就该放行。
     *
     * 这条是「三个 statement 是三把独立的键」的反证:要是守成了一个 kind(或者按公司整体拒),
     * 审掉利润表会连资产负债表一起锁死,而它们是两张各录各的表。
     */
    @Test
    void report_anotherStatement_passes() throws Exception {
        seedApproved("report-is:1:" + YM, "report-is", "1");
        assertThat(code(putJson("/api/reports/bs/1/2031/8", "{\"cells\":[]}"))).isEqualTo(0);
    }

    /**
     * 同一张报表、**换一家公司**就该放行。
     *
     * 审核键的 scope 段放的是 companyId —— 守卫要是漏了 scope,一家公司审完会把别家一起锁死。
     */
    @Test
    void report_anotherCompany_passes() throws Exception {
        seedApproved("report-is:1:" + YM, "report-is", "1");
        assertThat(code(putJson("/api/reports/is/2/2031/8", "{\"cells\":[]}"))).isEqualTo(0);
    }

    /** 换个没审的月照样能存。 */
    @Test
    void report_anotherMonth_passes() throws Exception {
        seedApproved("report-is:1:" + YM, "report-is", "1");
        assertThat(code(putJson("/api/reports/is/1/2031/9", "{\"cells\":[]}"))).isEqualTo(0);
    }

    /**
     * ❗删自定义行是**跨全部期**删金额(级联子树 × 所有月),算不出「被写的是哪几个月」,
     * 所以按「有任一已审月就整体拒」判。这条之前是个真洞:整个 ReportService 一句守卫都没有,
     * 一次点击就能删掉已审月的报表金额。
     */
    @Test
    void report_deleteCustomRow_refusedWhenAnyMonthApproved() throws Exception {
        // 先建一行自己的(不复用库里现成的:那行可能被别的用例依赖,删了会连坐)
        assertThat(code(postJson("/api/reports/is/1/custom-row",
            "{\"parentKey\":\"1\",\"label\":\"审核闸用例\",\"level\":1}"))).isEqualTo(0);
        List<Long> ids = jdbc.queryForList(
            "SELECT id FROM report_custom_row WHERE company_id=1 AND statement='is' AND label='审核闸用例'",
            Long.class);
        assertThat(ids).as("自定义行没建出来,后面那句删就没意义了").hasSize(1);
        try {
            seedApproved("report-is:1:" + YM, "report-is", "1");
            assertThat(code(mvc.perform(MockMvcRequestBuilders
                .delete("/api/reports/is/custom-row/" + ids.get(0))
                .header("Authorization", hdr(admin()))).andReturn())).isEqualTo(423);
        } finally {
            jdbc.update("DELETE FROM report_custom_row WHERE label='审核闸用例'");
        }
    }

    private MvcResult putJson(String url, String json) throws Exception {
        return mvc.perform(MockMvcRequestBuilders.put(url).header("Authorization", hdr(admin()))
            .contentType("application/json").content(json)).andReturn();
    }
}

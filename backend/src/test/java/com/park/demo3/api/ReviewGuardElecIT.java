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
 * 附表11 两把键的守卫挂点 —— 这个类存在的唯一理由是钉死「elec-cost 与 elec-model 各守各的 service」。
 *
 * spec §7.4 早期版本把 elec-cost 点在 ElecCostService 上,点反了:本月出账屏清单「附表11」那一行的
 * done 判据读的是 ElecRecordMapper(DataHomeService),所以
 *   · elec-cost  → ElecService     (/api/elec,      表 elec_record,      报送台账,上清单)
 *   · elec-model → ElecCostService (/api/elec-cost, 表 elec_cost_entry, 园区电费模型,不上清单)
 * 两把键照字面挂反的话,下面 doesNotBlock 的两条会同时红 —— 它们就是这处规范笔误的证据。
 *
 * 用远期空月 2031-08:园区数据到不了那里,断言红了只可能是守卫的问题。
 */
@AutoConfigureMockMvc
class ReviewGuardElecIT extends AbstractMysqlIT {

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;

    private static final int YEAR = 2031;
    private static final String YM = "2031-08";

    @AfterEach
    void wipe() {
        jdbc.update("DELETE FROM review_state WHERE period LIKE '2031-%'");
        jdbc.update("DELETE FROM elec_record WHERE acct_month LIKE '2031-%'");
        jdbc.update("DELETE FROM elec_cost_entry WHERE acct_month LIKE '2031-%'");
        jdbc.update("DELETE FROM elec_price_cfg WHERE acct_month LIKE '2031-%'");
        jdbc.update("DELETE FROM pv_reading WHERE YEAR(read_date) = ?", YEAR);
    }

    // ══ elec-cost:守的是报送台账,不是电费模型 ═══════════════════════════

    @Test
    void elecCost_locked_blocksSchedule11Record() throws Exception {
        seedApproved("elec-cost:" + YM, "elec-cost", YM);
        assertThat(code(postElecRecord(YM))).isEqualTo(423);
    }

    /** 同月的电费模型是另一本账、另一把键。两把键挂反(或合成一把)这条就红。 */
    @Test
    void elecCost_locked_doesNotBlockCostModel() throws Exception {
        seedApproved("elec-cost:" + YM, "elec-cost", YM);
        assertThat(code(putCostEntry(YM, 100))).isZero();
    }

    // ══ elec-model:反过来同样分得开 ═══════════════════════════════════

    @Test
    void elecModel_locked_blocksCostModel() throws Exception {
        seedApproved("elec-model:" + YM, "elec-model", YM);
        assertThat(code(putCostEntry(YM, 100))).isEqualTo(423);
    }

    @Test
    void elecModel_locked_doesNotBlockSchedule11Record() throws Exception {
        seedApproved("elec-model:" + YM, "elec-model", YM);
        assertThat(code(postElecRecord(YM))).isZero();
    }

    /** 整年模拟填充没有「被写月」,走 12 个月的批量闸;漏挂的话审过的月会被模拟数据覆盖。 */
    @Test
    void elecModel_simulateWholeYear_is423() throws Exception {
        seedApproved("elec-model:" + YM, "elec-model", YM);
        MvcResult r = mvc.perform(MockMvcRequestBuilders.post("/api/elec-cost/simulate?year=" + YEAR)
            .header("Authorization", hdr())).andReturn();
        assertThat(code(r)).isEqualTo(423);
    }

    /** deleteEntry 原本只判存在性就删,拿不到 acctMonth;改成先取实体再守之后这条才可能绿。 */
    @Test
    void elecModel_deleteEntryInLockedMonth_is423() throws Exception {
        MvcResult created = putCostEntry(YM, 100);
        assertThat(code(created)).isZero();
        int id = JsonPath.read(body(created), "$.data.id");
        seedApproved("elec-model:" + YM, "elec-model", YM);
        assertThat(code(delete("/api/elec-cost/entries/" + id))).isEqualTo(423);
        assertThat(count("SELECT COUNT(*) FROM elec_cost_entry WHERE acct_month = ?", YM)).isEqualTo(1);
    }

    /** batchDelete 是计划没点到的写入口:不挂就是「审过的月照样能一键删光」。 */
    @Test
    void elecCost_batchDeleteInLockedMonth_is423() throws Exception {
        MvcResult created = postElecRecord(YM);
        assertThat(code(created)).isZero();
        int id = JsonPath.read(body(created), "$.data.id");
        seedApproved("elec-cost:" + YM, "elec-cost", YM);
        MvcResult r = mvc.perform(MockMvcRequestBuilders.delete("/api/elec/batch")
            .header("Authorization", hdr()).contentType("application/json")
            .content("{\"ids\":[" + id + "]}")).andReturn();
        assertThat(code(r)).isEqualTo(423);
        assertThat(count("SELECT COUNT(*) FROM elec_record WHERE acct_month = ?", YM)).isEqualTo(1);
    }

    // ══ 白名单的正面用例(裁定 R-6) ═══════════════════════════════════

    /**
     * 附表6 审掉之后,光伏分栋抄表(第二本账)仍然写得进去 —— @NoReviewGuard 生效的正面钉。
     * 哪天那批注解被误删,这条会红并逼人回答「这是故意的还是漏的」。
     */
    @Test
    void pvMeterReading_stillWritable_whenSchedule6MonthApproved() throws Exception {
        seedApproved("pv:" + YM, "pv", YM);
        Integer stationId = jdbc.queryForObject("SELECT MIN(id) FROM pv_station", Integer.class);
        MvcResult r = postJson("/api/pv-meter/readings",
            "{\"stationId\":" + stationId + ",\"readDate\":\"" + YM + "-15\","
            + "\"genTotal\":10,\"selfUse\":6,\"gridFeed\":4}");
        assertThat(code(r)).isZero();
    }

    // ══════════ helpers ══════════

    private void seedApproved(String key, String kind, String period) {
        jdbc.update("INSERT INTO review_state (review_key, kind, period, scope, status) VALUES (?,?,?,NULL,'approved')",
            key, kind, period);
    }

    /** 附表11 报送台账的写端点(energy 行)。 */
    private MvcResult postElecRecord(String acctMonth) throws Exception {
        return postJson("/api/elec/records",
            "{\"type\":\"energy\",\"phase\":\"p1\",\"acctMonth\":\"" + acctMonth + "\","
            + "\"cat\":\"商业\",\"unit\":\"kWh\",\"qty\":1,\"price\":1,\"rate\":0.13}");
    }

    /** 园区电费模型的写端点。'路灯' 是 ops 表,费项 usage 在其值域内。 */
    private MvcResult putCostEntry(String acctMonth, int amount) throws Exception {
        Integer meterId = jdbc.queryForObject("SELECT id FROM elec_meter WHERE name = ?", Integer.class, "路灯");
        return mvc.perform(MockMvcRequestBuilders.put("/api/elec-cost/entries")
            .header("Authorization", hdr()).contentType("application/json")
            .content("{\"meterId\":" + meterId + ",\"acctMonth\":\"" + acctMonth + "\","
                + "\"feeKey\":\"usage\",\"amount\":" + amount + "}")).andReturn();
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

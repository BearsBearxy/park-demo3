package com.park.demo3.api;

import com.park.demo3.AbstractMysqlIT;
import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@AutoConfigureMockMvc
class S10ApiIT extends AbstractMysqlIT {

    @Autowired MockMvc mvc;
    private String token;

    @BeforeEach
    void login() throws Exception {
        String body = mvc.perform(post("/api/auth/login")
                .contentType("application/json")
                .content("{\"username\":\"admin\",\"password\":\"admin123\"}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        token = JsonPath.read(body, "$.data.token");
    }

    private String auth() { return "Bearer " + token; }

    private static String utf8(MvcResult r) {
        return new String(r.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
    }

    // ── overview:确定性范围 + 摘要形状(不依赖具体种子值) ──
    @Test
    void overview_deterministicRangeAndSummaryShape() throws Exception {
        String body = utf8(mvc.perform(get("/api/s10/overview").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andReturn());
        // years = [BASE_YEAR..maxData+1];currentYear ≤ 上界-1;currentMonth ∈ [0..12]
        List<Integer> years = JsonPath.read(body, "$.data.years[*]");
        assertThat(years).isNotEmpty();
        assertThat(years.get(0)).isEqualTo(2024);
        int currentYear = JsonPath.read(body, "$.data.currentYear");
        int currentMonth = JsonPath.read(body, "$.data.currentMonth");
        assertThat(currentYear).isBetween(years.get(0), years.get(years.size() - 1));
        assertThat(currentMonth).isBetween(0, 12);
        // 每年摘要含 year/recordedMonths/tenantCount
        assertThat((Integer) JsonPath.read(body, "$.data.summaries[0].year")).isEqualTo(2024);
        JsonPath.read(body, "$.data.summaries[0].recordedMonths");
        JsonPath.read(body, "$.data.summaries[0].tenantCount");
    }

    // ── 四级取数:phase/year/month 宽表形状(含列合计/总计/recorded) ──
    @Test
    void month_fourLevelFetch_shapeAndColumnTotals() throws Exception {
        String body = utf8(mvc.perform(get("/api/s10/2/2025/3").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.phase").value(2))
                .andExpect(jsonPath("$.data.year").value(2025))
                .andExpect(jsonPath("$.data.month").value(3))
                .andReturn());
        // recorded 为布尔;rows 为数组;columnTotals 含 25 列键之一;grandTotal 存在
        JsonPath.read(body, "$.data.recorded");
        List<Object> rows = JsonPath.read(body, "$.data.rows");
        assertThat(rows).isNotNull();
        JsonPath.read(body, "$.data.columnTotals.factoryRent");
        JsonPath.read(body, "$.data.grandTotal");
    }

    // ── 宿舍(phase 4)空读:不补零,recorded=false,rows=[] ──
    @Test
    void month_dormEmptySlot_returnsEmptyNotRecorded() throws Exception {
        String body = utf8(mvc.perform(get("/api/s10/4/2099/12").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.recorded").value(false))
                .andExpect(jsonPath("$.data.rows.length()").value(0))
                .andReturn());
        assertThat(((Number) JsonPath.read(body, "$.data.grandTotal")).doubleValue()).isEqualTo(0.0);
    }

    // ── year-summary:种子年 2025 聚合(phase1 factoryRent 1月 = V18 五租户之和);全零列不输出 ──
    @Test
    void yearSummary_seedYear_aggregatesKnownColumn() throws Exception {
        String body = utf8(mvc.perform(get("/api/s10/year-summary").param("year", "2025")
                .header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.year").value(2025))
                .andReturn());
        Map<String, Object> p1 = JsonPath.read(body, "$.data.phases['1']");
        assertThat(p1).isNotEmpty().containsKey("factoryRent")
                .doesNotContainKey("officeRent");   // factory profile 全零列不输出
        List<Object> factoryRent = JsonPath.read(body, "$.data.phases['1'].factoryRent");
        assertThat(factoryRent).hasSize(12);
        // V18 种子 phase1 五租户 2025-01 factory_rent Σ = 103284+129552+93176+109507+130229
        assertThat(((Number) factoryRent.get(0)).doubleValue()).isEqualTo(565748.00);
    }

    // ── year-summary:无数据年(2023)→ phases 空 ──
    @Test
    void yearSummary_emptyYear_returnsEmptyPhases() throws Exception {
        String body = utf8(mvc.perform(get("/api/s10/year-summary").param("year", "2023")
                .header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.year").value(2023))
                .andReturn());
        Map<String, Object> phases = JsonPath.read(body, "$.data.phases");
        assertThat(phases).isEmpty();
    }

    // ── POST upsert round-trip → 读回 → PUT note → DELETE manual ok ──
    @Test
    void save_roundTrip_thenNoteThenDelete() throws Exception {
        String reqBody = "{\"tenantName\":\"集成测试租户\",\"phase\":1,\"acctMonth\":\"2099-01\","
                + "\"profile\":\"factory\",\"factoryRent\":1000,\"elecStd\":200}";
        String created = utf8(mvc.perform(post("/api/s10").header("Authorization", auth())
                .contentType("application/json").content(reqBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.source").value("manual"))
                .andExpect(jsonPath("$.data.tenantName").value("集成测试租户"))
                .andExpect(jsonPath("$.data.factoryRent").value(1000.00))
                // total 派生 = 1000 + 200
                .andExpect(jsonPath("$.data.total").value(1200.00))
                .andReturn());
        long id = ((Number) JsonPath.read(created, "$.data.id")).longValue();

        // upsert again(同 slot)→ update,不新增行;读回 month 该行存在
        String reqBody2 = "{\"tenantName\":\"集成测试租户\",\"phase\":1,\"acctMonth\":\"2099-01\","
                + "\"profile\":\"factory\",\"factoryRent\":1500,\"elecStd\":200}";
        mvc.perform(post("/api/s10").header("Authorization", auth())
                .contentType("application/json").content(reqBody2))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").value(id))           // 同 id → upsert
                .andExpect(jsonPath("$.data.factoryRent").value(1500.00));

        String month = utf8(mvc.perform(get("/api/s10/1/2099/1").header("Authorization", auth()))
                .andExpect(status().isOk()).andReturn());
        assertThat(((Number) JsonPath.read(month, "$.data.rows.length()")).intValue()).isEqualTo(1);
        assertThat(((Number) JsonPath.read(month, "$.data.columnTotals.factoryRent")).doubleValue())
                .isEqualTo(1500.00);

        // PUT note
        mvc.perform(put("/api/s10/" + id + "/note").header("Authorization", auth())
                .contentType("application/json").content("{\"note\":\"集成备注\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.note").value("集成备注"));

        // DELETE manual → ok
        mvc.perform(delete("/api/s10/" + id).header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0));
    }

    // ── acctMonth @Pattern 非法 → HTTP 400 ──
    @Test
    void save_invalidAcctMonth_returns400() throws Exception {
        String reqBody = "{\"tenantName\":\"x\",\"phase\":1,\"acctMonth\":\"2099-13\",\"profile\":\"factory\"}";
        mvc.perform(post("/api/s10").header("Authorization", auth())
                .contentType("application/json").content(reqBody))
                .andExpect(status().isBadRequest());
    }

    // ── tenantName 空 → HTTP 400 ──
    @Test
    void save_blankTenantName_returns400() throws Exception {
        String reqBody = "{\"tenantName\":\"\",\"phase\":1,\"acctMonth\":\"2099-01\",\"profile\":\"factory\"}";
        mvc.perform(post("/api/s10").header("Authorization", auth())
                .contentType("application/json").content(reqBody))
                .andExpect(status().isBadRequest());
    }

    // ── phase 越界(path 0 / 5)→ HTTP 400(@Min/@Max 白名单) ──
    @Test
    void month_phaseOutOfRange_returns400() throws Exception {
        mvc.perform(get("/api/s10/0/2025/3").header("Authorization", auth()))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/api/s10/5/2025/3").header("Authorization", auth()))
                .andExpect(status().isBadRequest());
    }

    // ── month 越界(path month=13)→ HTTP 400 ──
    @Test
    void month_monthOutOfRange_returns400() throws Exception {
        mvc.perform(get("/api/s10/1/2025/13").header("Authorization", auth()))
                .andExpect(status().isBadRequest());
    }

    // ── delete 不存在 → 404 in body ──
    @Test
    void delete_missingRow_returns404InBody() throws Exception {
        mvc.perform(delete("/api/s10/99999999").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(404));
    }

    // ── auth:无 token → 401 ──
    @Test
    void month_withoutToken_returns401() throws Exception {
        mvc.perform(get("/api/s10/1/2025/1"))
                .andExpect(status().isUnauthorized());
    }
}

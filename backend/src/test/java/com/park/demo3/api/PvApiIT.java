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

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@AutoConfigureMockMvc
class PvApiIT extends AbstractMysqlIT {

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

    // ── phases ────────────────────────────────────────────────
    @Test
    void phases_listSeededThree_withShortWireName() throws Exception {
        String body = utf8(mvc.perform(get("/api/pv/phases").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.length()").value(3))
                .andReturn());
        List<String> ids    = JsonPath.read(body, "$.data[*].id");
        List<String> shorts = JsonPath.read(body, "$.data[*].short");   // JSON wire name is "short"
        assertThat(ids).containsExactly("p1", "p2", "p3");
        assertThat(shorts).containsExactly("一期", "二期", "三期");
    }

    // ── overview (deterministic range) ────────────────────────
    @Test
    void overview_shapeAndDeterministicYearRange() throws Exception {
        String body = utf8(mvc.perform(get("/api/pv/overview").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                // seed maxData = 2026 → range [2024..2027], currentYear = 2026
                .andExpect(jsonPath("$.data.currentYear").value(2026))
                .andExpect(jsonPath("$.data.years.length()").value(4))
                .andReturn());
        List<Integer> years = JsonPath.read(body, "$.data.years[*].year");
        assertThat(years).containsExactly(2024, 2025, 2026, 2027);
        // 2024 has data, 2027 does not
        assertThat((Boolean) JsonPath.read(body, "$.data.years[0].hasData")).isTrue();
        assertThat((Boolean) JsonPath.read(body, "$.data.years[3].hasData")).isFalse();
        assertThat(((Number) JsonPath.read(body, "$.data.years[3].count")).intValue()).isEqualTo(0);
    }

    // ── records(2025): row count + derived gen/fee + totals ──
    @Test
    void records2025_rowCountAndDerivedGenFeeAndTotals() throws Exception {
        String body = utf8(mvc.perform(get("/api/pv/records").param("year", "2025")
                .header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.year").value(2025))
                .andExpect(jsonPath("$.data.phases.length()").value(3))
                .andExpect(jsonPath("$.data.rows.length()").value(20)) // p1:12 + p2:7 + p3:1
                .andReturn());

        // first row ascending by acct_month = 2025-01 (p1): gen=124209.5, fee=91806.52
        assertThat((String) JsonPath.read(body, "$.data.rows[0].acctMonth")).isEqualTo("2025-01");
        assertThat(((Number) JsonPath.read(body, "$.data.rows[0].gen")).doubleValue()).isEqualTo(124209.50);
        assertThat(((Number) JsonPath.read(body, "$.data.rows[0].fee")).doubleValue()).isEqualTo(91806.52);
        assertThat((String) JsonPath.read(body, "$.data.rows[0].phase")).isEqualTo("p1");
        assertThat((String) JsonPath.read(body, "$.data.rows[0].source")).isEqualTo("seed");

        // year totals
        assertThat(((Number) JsonPath.read(body, "$.data.total.gen")).doubleValue()).isEqualTo(4431332.50);
        assertThat(((Number) JsonPath.read(body, "$.data.total.fee")).doubleValue()).isEqualTo(3510737.42);
        assertThat(((Number) JsonPath.read(body, "$.data.total.selfKwh")).doubleValue()).isEqualTo(3305652.50);
        assertThat(((Number) JsonPath.read(body, "$.data.total.gridKwh")).doubleValue()).isEqualTo(1125680.00);
    }

    // ── create round-trip (manual) ────────────────────────────
    @Test
    void create_manualRecord_roundTrip_thenDeleteOk() throws Exception {
        String reqBody = "{\"phase\":\"p1\",\"acctMonth\":\"2027-03\",\"occurMonth\":\"2027-02\","
                + "\"selfKwh\":1000,\"selfAmt\":900,\"gridKwh\":200,\"gridAmt\":90}";
        String created = utf8(mvc.perform(post("/api/pv/records").header("Authorization", auth())
                .contentType("application/json").content(reqBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.source").value("manual"))
                .andExpect(jsonPath("$.data.gen").value(1200.0))  // 1000 + 200
                .andExpect(jsonPath("$.data.fee").value(990.0))   // 900 + 90
                .andReturn());
        int id = JsonPath.read(created, "$.data.id");

        // patch note
        mvc.perform(patch("/api/pv/records/" + id + "/note").header("Authorization", auth())
                .contentType("application/json").content("{\"note\":\"集成备注\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.note").value("集成备注"));

        // delete manual → ok
        mvc.perform(delete("/api/pv/records/" + id).header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0));
    }

    // ── delete seed → 409 in body ─────────────────────────────
    @Test
    void delete_seedRow_returns409InBody() throws Exception {
        // grab a seed record id from 2025
        String body = utf8(mvc.perform(get("/api/pv/records").param("year", "2025")
                .header("Authorization", auth()))
                .andExpect(status().isOk()).andReturn());
        int seedId = JsonPath.read(body, "$.data.rows[0].id");

        mvc.perform(delete("/api/pv/records/" + seedId).header("Authorization", auth()))
                .andExpect(status().isOk())          // BizException → HTTP 200, code in body
                .andExpect(jsonPath("$.code").value(409));
    }

    // ── delete non-existent → 404 in body ─────────────────────
    @Test
    void delete_missingRow_returns404InBody() throws Exception {
        mvc.perform(delete("/api/pv/records/99999999").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(404));
    }

    // ── validation: 非法 acctMonth 格式 → 400（验证 @Valid + @Pattern） ──
    @Test
    void create_invalidAcctMonthFormat_returns400() throws Exception {
        String reqBody = "{\"phase\":\"p1\",\"acctMonth\":\"2027-13\",\"occurMonth\":\"2027-02\","
                + "\"selfKwh\":1000,\"selfAmt\":900,\"gridKwh\":200,\"gridAmt\":90}";
        mvc.perform(post("/api/pv/records").header("Authorization", auth())
                .contentType("application/json").content(reqBody))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(400));
    }

    // ── validation: 缺必填字段 → 400（验证 @NotBlank 触发与异常映射） ──
    @Test
    void create_missingAcctMonth_returns400() throws Exception {
        String reqBody = "{\"phase\":\"p1\",\"occurMonth\":\"2027-02\",\"selfKwh\":1000}";
        mvc.perform(post("/api/pv/records").header("Authorization", auth())
                .contentType("application/json").content(reqBody))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(400));
    }

    // ── auth ──────────────────────────────────────────────────
    @Test
    void records_withoutToken_returns401() throws Exception {
        mvc.perform(get("/api/pv/records").param("year", "2025"))
                .andExpect(status().isUnauthorized());
    }
}

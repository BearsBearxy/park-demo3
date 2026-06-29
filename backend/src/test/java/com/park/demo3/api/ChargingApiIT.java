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
class ChargingApiIT extends AbstractMysqlIT {

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

    // ── cats (附表7 seeded two, with `short` wire name) ────────
    @Test
    void cats_listSeededTwo_withShortWireName() throws Exception {
        String body = utf8(mvc.perform(get("/api/charging/7/cats").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.length()").value(2))
                .andReturn());
        List<String> ids    = JsonPath.read(body, "$.data[*].catId");
        List<String> shorts = JsonPath.read(body, "$.data[*].short");   // JSON wire name is "short"
        assertThat(ids).containsExactly("dc", "ac");
        assertThat(shorts).containsExactly("直流快充", "交流慢充");
    }

    // ── overview (deterministic range, schedule 7) ────────────
    @Test
    void overview_shapeAndDeterministicYearRange() throws Exception {
        String body = utf8(mvc.perform(get("/api/charging/7/overview").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                // seed maxData = 2026 → range [2024..2027], currentYear = 2026
                .andExpect(jsonPath("$.data.currentYear").value(2026))
                .andExpect(jsonPath("$.data.years.length()").value(4))
                .andReturn());
        List<Integer> years = JsonPath.read(body, "$.data.years[*].year");
        assertThat(years).containsExactly(2024, 2025, 2026, 2027);
        // 2024 has no data, 2025 does
        assertThat((Boolean) JsonPath.read(body, "$.data.years[0].hasData")).isFalse();
        assertThat((Boolean) JsonPath.read(body, "$.data.years[1].hasData")).isTrue();
        // 2025 profit = fee - cost across 24 rows = 141006.60
        assertThat(((Number) JsonPath.read(body, "$.data.years[1].totalProfit")).doubleValue())
                .isEqualTo(141006.60);
        assertThat(((Number) JsonPath.read(body, "$.data.years[1].count")).intValue()).isEqualTo(24);
    }

    // ── records(7, 2025): row count + derived profit + totals ──
    @Test
    void records2025_rowCountAndDerivedProfitAndTotals() throws Exception {
        String body = utf8(mvc.perform(get("/api/charging/7/records").param("year", "2025")
                .header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.year").value(2025))
                .andExpect(jsonPath("$.data.cats.length()").value(2))
                .andExpect(jsonPath("$.data.rows.length()").value(24)) // dc:12 + ac:12
                .andReturn());

        // first row ascending by acct_month = 2025-01; source seed, profit derived = fee - cost
        assertThat((String) JsonPath.read(body, "$.data.rows[0].acctMonth")).isEqualTo("2025-01");
        assertThat((String) JsonPath.read(body, "$.data.rows[0].source")).isEqualTo("seed");
        double r0fee  = ((Number) JsonPath.read(body, "$.data.rows[0].fee")).doubleValue();
        double r0cost = ((Number) JsonPath.read(body, "$.data.rows[0].cost")).doubleValue();
        double r0prof = ((Number) JsonPath.read(body, "$.data.rows[0].profit")).doubleValue();
        assertThat(r0prof).isEqualTo(Math.round((r0fee - r0cost) * 100) / 100.0);

        // year totals (24 rows, dc + ac)
        assertThat(((Number) JsonPath.read(body, "$.data.total.kwh")).doubleValue()).isEqualTo(653790.00);
        assertThat(((Number) JsonPath.read(body, "$.data.total.fee")).doubleValue()).isEqualTo(543175.80);
        assertThat(((Number) JsonPath.read(body, "$.data.total.cost")).doubleValue()).isEqualTo(402169.20);
        assertThat(((Number) JsonPath.read(body, "$.data.total.profit")).doubleValue()).isEqualTo(141006.60);
    }

    // ── create round-trip (manual) → patch note → delete ok ───
    @Test
    void create_manualRecord_roundTrip_thenDeleteOk() throws Exception {
        String reqBody = "{\"scheduleNo\":7,\"cat\":\"dc\",\"acctMonth\":\"2027-03\","
                + "\"kwh\":1000,\"fee\":900,\"cost\":600}";
        String created = utf8(mvc.perform(post("/api/charging/7/records").header("Authorization", auth())
                .contentType("application/json").content(reqBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.source").value("manual"))
                .andExpect(jsonPath("$.data.catName").value("直流快充桩"))
                .andExpect(jsonPath("$.data.profit").value(300.0))  // 900 - 600
                .andReturn());
        int id = JsonPath.read(created, "$.data.id");

        // patch note
        mvc.perform(patch("/api/charging/7/records/" + id + "/note").header("Authorization", auth())
                .contentType("application/json").content("{\"note\":\"集成备注\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.note").value("集成备注"));

        // delete manual → ok
        mvc.perform(delete("/api/charging/7/records/" + id).header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0));
    }

    // ── delete seed → 409 in body ─────────────────────────────
    @Test
    void delete_seedRow_returns409InBody() throws Exception {
        String body = utf8(mvc.perform(get("/api/charging/7/records").param("year", "2025")
                .header("Authorization", auth()))
                .andExpect(status().isOk()).andReturn());
        int seedId = JsonPath.read(body, "$.data.rows[0].id");

        mvc.perform(delete("/api/charging/7/records/" + seedId).header("Authorization", auth()))
                .andExpect(status().isOk())          // BizException → HTTP 200, code in body
                .andExpect(jsonPath("$.code").value(409));
    }

    // ── auth ──────────────────────────────────────────────────
    @Test
    void records_withoutToken_returns401() throws Exception {
        mvc.perform(get("/api/charging/7/records").param("year", "2025"))
                .andExpect(status().isUnauthorized());
    }
}

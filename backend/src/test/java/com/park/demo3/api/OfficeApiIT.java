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
class OfficeApiIT extends AbstractMysqlIT {

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

    // ── overview (merged 13+14, deterministic range; phase3 pulls 2024 in) ──
    @Test
    void overview_mergedShapeAndDeterministicYearRange() throws Exception {
        String body = utf8(mvc.perform(get("/api/utilities/overview").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                // merged maxData = 2026 → range [2024..2027], currentYear = 2026
                .andExpect(jsonPath("$.data.currentYear").value(2026))
                .andExpect(jsonPath("$.data.years.length()").value(4))
                .andReturn());
        List<Integer> years = JsonPath.read(body, "$.data.years[*].year");
        assertThat(years).containsExactly(2024, 2025, 2026, 2027);

        // 2024: only phase3 (5 rows), totalFee = 109549.70
        assertThat((Boolean) JsonPath.read(body, "$.data.years[0].hasData")).isTrue();
        assertThat(((Number) JsonPath.read(body, "$.data.years[0].count")).intValue()).isEqualTo(5);
        assertThat(((Number) JsonPath.read(body, "$.data.years[0].totalFee")).doubleValue())
                .isEqualTo(109549.70);

        // 2025: office 12 + phase3 3 = 15 rows merged, totalFee = 78223.73
        assertThat((Boolean) JsonPath.read(body, "$.data.years[1].hasData")).isTrue();
        assertThat(((Number) JsonPath.read(body, "$.data.years[1].count")).intValue()).isEqualTo(15);
        assertThat(((Number) JsonPath.read(body, "$.data.years[1].totalFee")).doubleValue())
                .isEqualTo(78223.73);

        // 2027 empty (upper bound)
        assertThat((Boolean) JsonPath.read(body, "$.data.years[3].hasData")).isFalse();
        assertThat(((Number) JsonPath.read(body, "$.data.years[3].count")).intValue()).isEqualTo(0);
    }

    // ── office(13) records 2025: row count + derived amounts + totals ──
    @Test
    void office2025_rowCountAndDerivedAmountsAndTotals() throws Exception {
        String body = utf8(mvc.perform(get("/api/utilities/13/records").param("year", "2025")
                .header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.year").value(2025))
                .andExpect(jsonPath("$.data.scheduleNo").value(13))
                .andExpect(jsonPath("$.data.rows.length()").value(12))  // 2025 全年
                .andReturn());

        // first row ascending by acct_month = 2025-01; source seed
        assertThat((String) JsonPath.read(body, "$.data.rows[0].acctMonth")).isEqualTo("2025-01");
        assertThat((String) JsonPath.read(body, "$.data.rows[0].belongMonth")).isEqualTo("2024-12");
        assertThat((String) JsonPath.read(body, "$.data.rows[0].source")).isEqualTo("seed");
        // derived: elecAmt=3072×0.8123=2495.39, waterAmt=154×4.15=639.10, total=3134.49
        assertThat(((Number) JsonPath.read(body, "$.data.rows[0].elecAmt")).doubleValue()).isEqualTo(2495.39);
        assertThat(((Number) JsonPath.read(body, "$.data.rows[0].waterAmt")).doubleValue()).isEqualTo(639.10);
        assertThat(((Number) JsonPath.read(body, "$.data.rows[0].total")).doubleValue()).isEqualTo(3134.49);
        // note carried only on 2025-07 (index 6)
        assertThat((String) JsonPath.read(body, "$.data.rows[6].note")).isEqualTo("空调高峰");

        // year totals (12 rows)
        assertThat(((Number) JsonPath.read(body, "$.data.total.elecQty")).doubleValue()).isEqualTo(40640.00);
        assertThat(((Number) JsonPath.read(body, "$.data.total.elecAmt")).doubleValue()).isEqualTo(33011.88);
        assertThat(((Number) JsonPath.read(body, "$.data.total.waterQty")).doubleValue()).isEqualTo(2033.00);
        assertThat(((Number) JsonPath.read(body, "$.data.total.waterAmt")).doubleValue()).isEqualTo(8436.95);
        assertThat(((Number) JsonPath.read(body, "$.data.total.total")).doubleValue()).isEqualTo(41448.83);
    }

    // ── phase3(14) records 2024: building-period 5 rows, first derived ──
    @Test
    void phase3_2024_buildingPeriodRows() throws Exception {
        String body = utf8(mvc.perform(get("/api/utilities/14/records").param("year", "2024")
                .header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.rows.length()").value(5))
                .andReturn());
        assertThat((String) JsonPath.read(body, "$.data.rows[0].acctMonth")).isEqualTo("2024-08");
        // 18600×0.7965=14814.90, 1240×3.85=4774.00, total=19588.90
        assertThat(((Number) JsonPath.read(body, "$.data.rows[0].elecAmt")).doubleValue()).isEqualTo(14814.90);
        assertThat(((Number) JsonPath.read(body, "$.data.rows[0].waterAmt")).doubleValue()).isEqualTo(4774.00);
        assertThat(((Number) JsonPath.read(body, "$.data.rows[0].total")).doubleValue()).isEqualTo(19588.90);
    }

    // ── create round-trip (manual) → patch note → delete ok ───
    @Test
    void create_manualRecord_roundTrip_thenDeleteOk() throws Exception {
        String reqBody = "{\"scheduleNo\":13,\"acctMonth\":\"2027-03\",\"belongMonth\":\"2027-02\","
                + "\"elecQty\":1000,\"elecPrice\":0.8123,\"waterQty\":50,\"waterPrice\":4.15}";
        String created = utf8(mvc.perform(post("/api/utilities/13/records").header("Authorization", auth())
                .contentType("application/json").content(reqBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.source").value("manual"))
                .andExpect(jsonPath("$.data.scheduleNo").value(13))
                // elecAmt=1000×0.8123=812.30, waterAmt=50×4.15=207.50, total=1019.80
                .andExpect(jsonPath("$.data.elecAmt").value(812.30))
                .andExpect(jsonPath("$.data.waterAmt").value(207.50))
                .andExpect(jsonPath("$.data.total").value(1019.80))
                .andReturn());
        int id = JsonPath.read(created, "$.data.id");

        // patch note
        mvc.perform(patch("/api/utilities/13/records/" + id + "/note").header("Authorization", auth())
                .contentType("application/json").content("{\"note\":\"集成备注\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.note").value("集成备注"));

        // delete manual → ok
        mvc.perform(delete("/api/utilities/13/records/" + id).header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0));
    }

    // ── create with mismatched scheduleNo vs path → 409 ──
    @Test
    void create_pathBodyMismatch_returns409InBody() throws Exception {
        String reqBody = "{\"scheduleNo\":14,\"acctMonth\":\"2027-03\",\"belongMonth\":\"2027-02\","
                + "\"elecQty\":1000,\"elecPrice\":0.8123,\"waterQty\":50,\"waterPrice\":4.15}";
        mvc.perform(post("/api/utilities/13/records").header("Authorization", auth())
                .contentType("application/json").content(reqBody))
                .andExpect(status().isOk())          // BizException → HTTP 200, code in body
                .andExpect(jsonPath("$.code").value(409));
    }

    // ── delete seed → 409 in body ─────────────────────────────
    @Test
    void delete_seedRow_returns409InBody() throws Exception {
        String body = utf8(mvc.perform(get("/api/utilities/13/records").param("year", "2025")
                .header("Authorization", auth()))
                .andExpect(status().isOk()).andReturn());
        int seedId = JsonPath.read(body, "$.data.rows[0].id");

        mvc.perform(delete("/api/utilities/13/records/" + seedId).header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(409));
    }

    // ── cross-schedule delete (14's row via path 13) → 404 in body ──
    @Test
    void delete_crossSchedule_returns404InBody() throws Exception {
        String body = utf8(mvc.perform(get("/api/utilities/14/records").param("year", "2024")
                .header("Authorization", auth()))
                .andExpect(status().isOk()).andReturn());
        int s14Id = JsonPath.read(body, "$.data.rows[0].id");

        mvc.perform(delete("/api/utilities/13/records/" + s14Id).header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(404));
    }

    // ── auth ──────────────────────────────────────────────────
    @Test
    void records_withoutToken_returns401() throws Exception {
        mvc.perform(get("/api/utilities/13/records").param("year", "2025"))
                .andExpect(status().isUnauthorized());
    }
}

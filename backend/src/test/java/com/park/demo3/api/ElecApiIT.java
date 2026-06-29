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
class ElecApiIT extends AbstractMysqlIT {

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
        String body = utf8(mvc.perform(get("/api/elec/phases").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.length()").value(3))
                .andReturn());
        List<String> ids    = JsonPath.read(body, "$.data[*].id");
        List<String> shorts = JsonPath.read(body, "$.data[*].short");   // JSON wire name is "short"
        assertThat(ids).containsExactly("p1", "p2", "p3");
        assertThat(shorts).containsExactly("一期", "二期", "三期");
    }

    // ── overview (deterministic range; totalFee spans energy+basic) ──
    @Test
    void overview_shapeAndDeterministicYearRange() throws Exception {
        String body = utf8(mvc.perform(get("/api/elec/overview").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                // seed maxData = 2026 → range [2024..2027], currentYear = 2026
                .andExpect(jsonPath("$.data.currentYear").value(2026))
                .andExpect(jsonPath("$.data.years.length()").value(4))
                .andReturn());
        List<Integer> years = JsonPath.read(body, "$.data.years[*].year");
        assertThat(years).containsExactly(2024, 2025, 2026, 2027);
        // 2024 empty (seed starts 2025), 2025 hasData count 132, 2027 empty
        assertThat((Boolean) JsonPath.read(body, "$.data.years[0].hasData")).isFalse();
        assertThat((Boolean) JsonPath.read(body, "$.data.years[1].hasData")).isTrue();
        assertThat(((Number) JsonPath.read(body, "$.data.years[1].count")).intValue()).isEqualTo(132);
        // 2025 totalFee = energy(3186056.11) + basic(976320.00)
        assertThat(((Number) JsonPath.read(body, "$.data.years[1].totalFee")).doubleValue()).isEqualTo(4162376.11);
        assertThat((Boolean) JsonPath.read(body, "$.data.years[3].hasData")).isFalse();
        assertThat(((Number) JsonPath.read(body, "$.data.years[3].count")).intValue()).isEqualTo(0);
    }

    // ── records(2025, energy): row count + derived amount/tax/total + totals ──
    @Test
    void records2025Energy_rowCountAndDerivedAndTotals() throws Exception {
        String body = utf8(mvc.perform(get("/api/elec/records")
                .param("year", "2025").param("type", "energy")
                .header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.year").value(2025))
                .andExpect(jsonPath("$.data.type").value("energy"))
                .andExpect(jsonPath("$.data.phases.length()").value(3))
                .andExpect(jsonPath("$.data.rows.length()").value(108)) // 12 months × 3 phases × 3 periods
                .andReturn());

        // first row ascending by acct_month = 2025-01 (p1 峰): amount=51609.36 tax=6709.22 total=58318.58
        assertThat((String) JsonPath.read(body, "$.data.rows[0].acctMonth")).isEqualTo("2025-01");
        assertThat((String) JsonPath.read(body, "$.data.rows[0].source")).isEqualTo("seed");
        assertThat(((Number) JsonPath.read(body, "$.data.rows[0].amount")).doubleValue()).isEqualTo(51609.36);
        assertThat(((Number) JsonPath.read(body, "$.data.rows[0].tax")).doubleValue()).isEqualTo(6709.22);
        assertThat(((Number) JsonPath.read(body, "$.data.rows[0].total")).doubleValue()).isEqualTo(58318.58);

        // year energy totals
        assertThat(((Number) JsonPath.read(body, "$.data.total.qty")).doubleValue()).isEqualTo(4238501.00);
        assertThat(((Number) JsonPath.read(body, "$.data.total.amount")).doubleValue()).isEqualTo(2819518.64);
        assertThat(((Number) JsonPath.read(body, "$.data.total.tax")).doubleValue()).isEqualTo(366537.47);
        assertThat(((Number) JsonPath.read(body, "$.data.total.total")).doubleValue()).isEqualTo(3186056.11);
    }

    // ── records(2025, basic): only p1/p2 → 24 rows, derived from demand ──
    @Test
    void records2025Basic_rowCountAndDerivedFromDemand() throws Exception {
        String body = utf8(mvc.perform(get("/api/elec/records")
                .param("year", "2025").param("type", "basic")
                .header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.rows.length()").value(24)) // 12 months × (p1,p2)
                .andReturn());
        assertThat(((Number) JsonPath.read(body, "$.data.rows[0].amount")).doubleValue()).isEqualTo(40000.00);
        assertThat(((Number) JsonPath.read(body, "$.data.rows[0].total")).doubleValue()).isEqualTo(45200.00);
        assertThat(((Number) JsonPath.read(body, "$.data.total.demand")).doubleValue()).isEqualTo(27000.00);
        assertThat(((Number) JsonPath.read(body, "$.data.total.amount")).doubleValue()).isEqualTo(864000.00);
    }

    // ── create round-trip (manual energy) + note + delete ─────
    @Test
    void create_manualEnergyRecord_roundTrip_noteThenDeleteOk() throws Exception {
        String reqBody = "{\"type\":\"energy\",\"phase\":\"p1\",\"acctMonth\":\"2027-03\","
                + "\"period\":\"峰\",\"cat\":\"大工业用电\",\"unit\":\"度\","
                + "\"qty\":1000,\"price\":0.9821,\"rate\":0.13}";
        String created = utf8(mvc.perform(post("/api/elec/records").header("Authorization", auth())
                .contentType("application/json").content(reqBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.source").value("manual"))
                .andExpect(jsonPath("$.data.amount").value(982.10))  // 1000 × 0.9821
                .andExpect(jsonPath("$.data.tax").value(127.67))     // 982.10 × 0.13
                .andExpect(jsonPath("$.data.total").value(1109.77))
                .andReturn());
        int id = JsonPath.read(created, "$.data.id");

        // patch note (reuses PvNoteReq {note})
        mvc.perform(patch("/api/elec/records/" + id + "/note").header("Authorization", auth())
                .contentType("application/json").content("{\"note\":\"集成备注\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.note").value("集成备注"));

        // delete manual → ok
        mvc.perform(delete("/api/elec/records/" + id).header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0));
    }

    // ── delete seed → 409 in body ─────────────────────────────
    @Test
    void delete_seedRow_returns409InBody() throws Exception {
        String body = utf8(mvc.perform(get("/api/elec/records")
                .param("year", "2025").param("type", "energy")
                .header("Authorization", auth()))
                .andExpect(status().isOk()).andReturn());
        int seedId = JsonPath.read(body, "$.data.rows[0].id");

        mvc.perform(delete("/api/elec/records/" + seedId).header("Authorization", auth()))
                .andExpect(status().isOk())          // BizException → HTTP 200, code in body
                .andExpect(jsonPath("$.code").value(409));
    }

    // ── delete non-existent → 404 in body ─────────────────────
    @Test
    void delete_missingRow_returns404InBody() throws Exception {
        mvc.perform(delete("/api/elec/records/99999999").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(404));
    }

    // ── auth ──────────────────────────────────────────────────
    @Test
    void records_withoutToken_returns401() throws Exception {
        mvc.perform(get("/api/elec/records").param("year", "2025").param("type", "energy"))
                .andExpect(status().isUnauthorized());
    }
}

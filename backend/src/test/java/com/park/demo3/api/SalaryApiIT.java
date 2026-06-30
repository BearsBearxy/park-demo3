package com.park.demo3.api;

import com.park.demo3.AbstractMysqlIT;
import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@AutoConfigureMockMvc
class SalaryApiIT extends AbstractMysqlIT {

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

    // ── overview: deterministic range [2024..2027], currentYear 2026 ──
    @Test
    void overview_shapeAndDeterministicYearRange() throws Exception {
        String body = utf8(mvc.perform(get("/api/salary/overview").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                // seed maxData = 2026 → range [2024..2027], currentYear = 2026
                .andExpect(jsonPath("$.data.currentYear").value(2026))
                .andExpect(jsonPath("$.data.years.length()").value(4))
                .andReturn());
        List<Integer> years = JsonPath.read(body, "$.data.years[*].year");
        assertThat(years).containsExactly(2024, 2025, 2026, 2027);

        // 2024 empty, 2026 has data (Jan-May seeded → 5 months), 2027 empty
        assertThat((Boolean) JsonPath.read(body, "$.data.years[0].hasData")).isFalse();
        assertThat((Boolean) JsonPath.read(body, "$.data.years[2].hasData")).isTrue();
        assertThat((Boolean) JsonPath.read(body, "$.data.years[3].hasData")).isFalse();
        // 2025 only 2025-12 → 10 records, months [12]
        assertThat(((Number) JsonPath.read(body, "$.data.years[1].count")).intValue()).isEqualTo(10);
        assertThat((List<Integer>) JsonPath.read(body, "$.data.years[1].months")).containsExactly(12);
        // 2026 five months × 10 = 50 records, months [1,2,3,4,5]
        assertThat(((Number) JsonPath.read(body, "$.data.years[2].count")).intValue()).isEqualTo(50);
        assertThat((List<Integer>) JsonPath.read(body, "$.data.years[2].months")).containsExactly(1, 2, 3, 4, 5);
    }

    // ── records(2026,1): 10 rows, first by emp_idx = 周明, derived net + month total ──
    @Test
    void records_2026_01_rowCountDerivedAndTotals() throws Exception {
        String body = utf8(mvc.perform(get("/api/salary/records")
                .param("year", "2026").param("month", "1")
                .header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.year").value(2026))
                .andExpect(jsonPath("$.data.month").value(1))
                .andExpect(jsonPath("$.data.rows.length()").value(10))
                .andReturn());

        // 升序首行 emp_idx=1 周明:wage 24100, gross 24500, deduct 2900, net 21600, fullAttend true
        assertThat((String) JsonPath.read(body, "$.data.rows[0].name")).isEqualTo("周明");
        assertThat((String) JsonPath.read(body, "$.data.rows[0].source")).isEqualTo("seed");
        assertThat(((Number) JsonPath.read(body, "$.data.rows[0].wageTotal")).doubleValue()).isEqualTo(24100.00);
        assertThat(((Number) JsonPath.read(body, "$.data.rows[0].gross")).doubleValue()).isEqualTo(24500.00);
        assertThat(((Number) JsonPath.read(body, "$.data.rows[0].deduct")).doubleValue()).isEqualTo(2900.00);
        assertThat(((Number) JsonPath.read(body, "$.data.rows[0].net")).doubleValue()).isEqualTo(21600.00);
        assertThat(((Number) JsonPath.read(body, "$.data.rows[0].actualDays")).intValue()).isEqualTo(21);
        assertThat((Boolean) JsonPath.read(body, "$.data.rows[0].fullAttend")).isTrue();

        // 月合计实发(2026-01 全月 net 合计,来自生成器:128120.00)
        assertThat(((Number) JsonPath.read(body, "$.data.total.net")).doubleValue()).isEqualTo(128120.00);
    }

    // ── create round-trip (manual) → patch note → delete ok ──
    @Test
    void create_manualRecord_roundTrip_thenDeleteOk() throws Exception {
        String reqBody = "{\"acctMonth\":\"2026-06\",\"name\":\"测试员\",\"role\":\"临时工\","
                + "\"base\":5000,\"post\":1000,\"perf\":500,\"attend\":300,\"skill\":200,\"edu\":100,\"other\":0,"
                + "\"lunch\":400,\"heat\":300,\"commission\":0,"
                + "\"shouldDays\":22,\"leaveDays\":0,"
                + "\"social\":600,\"tax\":80,\"otherDeduct\":0}";
        String created = utf8(mvc.perform(post("/api/salary/records").header("Authorization", auth())
                .contentType("application/json").content(reqBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.source").value("manual"))
                // wage = 5000+1000+500+300+200+100 = 7100; gross = 7100+400+300 = 7800
                // deduct = 600+80 = 680; net = 7120
                .andExpect(jsonPath("$.data.wageTotal").value(7100.0))
                .andExpect(jsonPath("$.data.gross").value(7800.0))
                .andExpect(jsonPath("$.data.deduct").value(680.0))
                .andExpect(jsonPath("$.data.net").value(7120.0))
                .andReturn());
        int id = JsonPath.read(created, "$.data.id");

        mvc.perform(patch("/api/salary/records/" + id + "/note").header("Authorization", auth())
                .contentType("application/json").content("{\"note\":\"集成备注\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.note").value("集成备注"));

        mvc.perform(delete("/api/salary/records/" + id).header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0));
    }

    // ── delete seed → 成功(seed 同等可删,不再 409) ──
    // @Transactional:此用例真删共享种子行,事务回滚还原,避免污染同库其它读测试(IT 单例容器无 per-test 重置)。
    @Test
    @Transactional
    void delete_seedRow_succeeds() throws Exception {
        String body = utf8(mvc.perform(get("/api/salary/records")
                .param("year", "2026").param("month", "1")
                .header("Authorization", auth()))
                .andExpect(status().isOk()).andReturn());
        int seedId = JsonPath.read(body, "$.data.rows[0].id");

        mvc.perform(delete("/api/salary/records/" + seedId).header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0));

        // 该种子行已删
        mvc.perform(get("/api/salary/records").param("year", "2026").param("month", "1")
                .header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows[?(@.id==" + seedId + ")]").isEmpty());
    }

    // ── validation: 越界 month → 400（验证 @Validated 参数校验 + 异常映射，否则会 500） ──
    @Test
    void records_invalidMonth_returns400() throws Exception {
        mvc.perform(get("/api/salary/records").param("year", "2026").param("month", "13")
                .header("Authorization", auth()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(400));
    }

    // ── auth ──
    @Test
    void records_withoutToken_returns401() throws Exception {
        mvc.perform(get("/api/salary/records").param("year", "2026").param("month", "1"))
                .andExpect(status().isUnauthorized());
    }
}

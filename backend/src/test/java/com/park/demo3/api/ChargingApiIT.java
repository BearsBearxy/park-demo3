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

// V19 把充电桩字典改运营商口径(no=7 万城万/小桔;no=8 叮叮充/电信)且清空全部记录种子 → 屏空 by design。
// 写入用例标 @Transactional 回滚还原(避免污染 overview 确定性范围与同库读测试)。
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

    // ── cats:V19 运营商字典(no=7 万城万/小桔;短名 = 中文)──
    @Test
    void cats_listOperators_withShortWireName() throws Exception {
        String body = utf8(mvc.perform(get("/api/charging/7/cats").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.length()").value(2))
                .andReturn());
        List<String> ids    = JsonPath.read(body, "$.data[*].catId");
        List<String> names  = JsonPath.read(body, "$.data[*].name");
        List<String> shorts = JsonPath.read(body, "$.data[*].short");   // JSON wire name is "short"
        assertThat(ids).containsExactly("wancheng", "xiaoju");
        assertThat(names).containsExactly("万城万", "小桔");
        assertThat(shorts).containsExactly("万城万", "小桔");

        // no=8 电动车桩字典:叮叮充/电信
        List<String> ids8 = JsonPath.read(
                utf8(mvc.perform(get("/api/charging/8/cats").header("Authorization", auth()))
                        .andExpect(status().isOk()).andReturn()),
                "$.data[*].catId");
        assertThat(ids8).containsExactly("dingding", "dianxin");
    }

    // ── overview:无种子记录 → 范围 [2024..2025],currentYear=2024(对齐无数据口径) ──
    @Test
    void overview_noSeedData_deterministicEmptyRange() throws Exception {
        String body = utf8(mvc.perform(get("/api/charging/7/overview").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.currentYear").value(2024))
                .andExpect(jsonPath("$.data.years.length()").value(2))
                .andReturn());
        List<Integer> years = JsonPath.read(body, "$.data.years[*].year");
        assertThat(years).containsExactly(2024, 2025);
        assertThat((Boolean) JsonPath.read(body, "$.data.years[0].hasData")).isFalse();
    }

    // ── records(7, 2025):无种子 → 0 行,cats=2,合计皆 0 ──
    @Test
    void records_emptyYear_zeroRowsAndTotals() throws Exception {
        mvc.perform(get("/api/charging/7/records").param("year", "2025").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.year").value(2025))
                .andExpect(jsonPath("$.data.cats.length()").value(2))
                .andExpect(jsonPath("$.data.rows.length()").value(0))
                .andExpect(jsonPath("$.data.total.profit").value(0.0));
    }

    // ── create round-trip(manual,运营商 cat)→ patch note → delete ok ───
    @Test
    @Transactional
    void create_manualRecord_roundTrip_thenDeleteOk() throws Exception {
        String reqBody = "{\"scheduleNo\":7,\"cat\":\"wancheng\",\"acctMonth\":\"2027-03\","
                + "\"kwh\":1000,\"fee\":900,\"cost\":600}";
        String created = utf8(mvc.perform(post("/api/charging/7/records").header("Authorization", auth())
                .contentType("application/json").content(reqBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.source").value("manual"))
                .andExpect(jsonPath("$.data.catName").value("万城万"))
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

    // ── create 未知 cat → 409 ──
    @Test
    void create_unknownCat_returns409InBody() throws Exception {
        mvc.perform(post("/api/charging/7/records").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"scheduleNo\":7,\"cat\":\"nope\",\"acctMonth\":\"2027-03\",\"kwh\":1,\"fee\":1,\"cost\":0}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(409));
    }

    // ── auth ──────────────────────────────────────────────────
    @Test
    void records_withoutToken_returns401() throws Exception {
        mvc.perform(get("/api/charging/7/records").param("year", "2025"))
                .andExpect(status().isUnauthorized());
    }
}

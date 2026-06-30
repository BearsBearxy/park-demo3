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
class OfficeImportApiIT extends AbstractMysqlIT {

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

    // ── 月份解析(多形态)+ source=import + 重导替换;手动行保留;无效月份进 errors ──
    @Test
    void import_monthParsing_replaceSemantics_manualPreserved() throws Exception {
        // 干净 slot 13/2099。先放一行 manual(2099-08,应在重导中保留)。
        mvc.perform(post("/api/utilities/13/records").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"scheduleNo\":13,\"acctMonth\":\"2099-08\",\"belongMonth\":\"2099-08\","
                        + "\"elecQty\":100,\"elecPrice\":0.8,\"waterQty\":10,\"waterPrice\":4}"))
                .andExpect(status().isOk());

        // 三行有效(\"1月\"→1、\"02\"→2、\"2099-03\"→3) + 一行无效(\"abc\")
        String body = "{\"rows\":["
                + "{\"tenantName\":\"1月\",\"elecQty\":1000,\"elecPrice\":0.8,\"waterQty\":50,\"waterPrice\":4},"
                + "{\"tenantName\":\"02\",\"elecQty\":2000,\"elecPrice\":0.8,\"waterQty\":60,\"waterPrice\":4},"
                + "{\"tenantName\":\"2099-03\",\"elecQty\":3000,\"elecPrice\":0.8,\"waterQty\":70,\"waterPrice\":4},"
                + "{\"tenantName\":\"abc\",\"elecQty\":9}"
                + "]}";
        String res = utf8(mvc.perform(post("/api/utilities/13/import").header("Authorization", auth())
                .param("year", "2099")
                .contentType("application/json").content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.imported").value(3))
                .andExpect(jsonPath("$.data.skipped").value(1))
                .andReturn());
        assertThat((Integer) JsonPath.read(res, "$.data.errors[0].rowIndex")).isEqualTo(3);

        // 读回 13/2099:4 行(1 manual 08 + 3 import 01/02/03),acctMonth 升序
        String year = utf8(mvc.perform(get("/api/utilities/13/records").param("year", "2099")
                .header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.rows.length()").value(4))
                .andReturn());
        List<String> months = JsonPath.read(year, "$.data.rows[*].acctMonth");
        assertThat(months).containsExactly("2099-01", "2099-02", "2099-03", "2099-08");
        // 导入行 belongMonth==acctMonth、source=import(过滤器返数组,用 isNotEmpty)
        mvc.perform(get("/api/utilities/13/records").param("year", "2099").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows[?(@.acctMonth=='2099-01' && @.source=='import' && @.belongMonth=='2099-01')]").isNotEmpty());

        // 重导(仅 \"5月\")→ 旧 3 导入行清,新导入落库;手动 08 不动
        mvc.perform(post("/api/utilities/13/import").header("Authorization", auth())
                .param("year", "2099")
                .contentType("application/json")
                .content("{\"rows\":[{\"tenantName\":\"5月\",\"elecQty\":500,\"elecPrice\":0.8,\"waterQty\":5,\"waterPrice\":4}]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.imported").value(1));
        String after = utf8(mvc.perform(get("/api/utilities/13/records").param("year", "2099")
                .header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.rows.length()").value(2))
                .andReturn());
        List<String> months2 = JsonPath.read(after, "$.data.rows[*].acctMonth");
        assertThat(months2).containsExactly("2099-05", "2099-08");
    }

    // ── scheduleNo 非白名单 → 404(code in body) ──
    @Test
    void import_badScheduleNo_returns404InBody() throws Exception {
        mvc.perform(post("/api/utilities/99/import").header("Authorization", auth())
                .param("year", "2099")
                .contentType("application/json").content("{\"rows\":[]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(404));
    }

    // ── year 越界 → 400 ──
    @Test
    void import_yearOutOfRange_returns400() throws Exception {
        mvc.perform(post("/api/utilities/13/import").header("Authorization", auth())
                .param("year", "1999")
                .contentType("application/json").content("{\"rows\":[]}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void import_withoutToken_returns401() throws Exception {
        mvc.perform(post("/api/utilities/13/import").param("year", "2099")
                .contentType("application/json").content("{\"rows\":[]}"))
                .andExpect(status().isUnauthorized());
    }
}

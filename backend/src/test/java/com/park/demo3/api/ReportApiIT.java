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
class ReportApiIT extends AbstractMysqlIT {

    @Autowired MockMvc mvc;
    private String token;

    @BeforeEach
    void login() throws Exception {
        String body = mvc.perform(post("/api/auth/login").contentType("application/json")
                .content("{\"username\":\"admin\",\"password\":\"admin123\"}"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        token = JsonPath.read(body, "$.data.token");
    }
    private String auth() { return "Bearer " + token; }
    private static String utf8(MvcResult r) {
        return new String(r.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
    }

    // ── PUT 保存三行 → GET 读回 amounts 对(含小计不落库=只回叶子) ──
    @Test
    void save_thenReadBack_amountsMatch() throws Exception {
        String saveBody = "{\"cells\":["
                + "{\"rowKey\":\"1\",\"field\":\"cur\",\"amount\":1000},"
                + "{\"rowKey\":\"1\",\"field\":\"ytd\",\"amount\":9000},"
                + "{\"rowKey\":\"2\",\"field\":\"cur\",\"amount\":300}"
                + "]}";
        mvc.perform(put("/api/reports/is/1/2025/10").header("Authorization", auth())
                .contentType("application/json").content(saveBody))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0));

        String res = utf8(mvc.perform(get("/api/reports/is/1/2025/10").header("Authorization", auth()))
                .andExpect(status().isOk()).andReturn());
        assertThat(((Number) JsonPath.read(res, "$.data.amounts.1.cur")).doubleValue()).isEqualTo(1000.0);
        assertThat(((Number) JsonPath.read(res, "$.data.amounts.1.ytd")).doubleValue()).isEqualTo(9000.0);
        assertThat(((Number) JsonPath.read(res, "$.data.amounts.2.cur")).doubleValue()).isEqualTo(300.0);

        // 重存(clear+insert) 覆盖:只剩 row 5
        mvc.perform(put("/api/reports/is/1/2025/10").header("Authorization", auth())
                .contentType("application/json").content("{\"cells\":[{\"rowKey\":\"5\",\"field\":\"cur\",\"amount\":42}]}"))
                .andExpect(status().isOk());
        String res2 = utf8(mvc.perform(get("/api/reports/is/1/2025/10").header("Authorization", auth()))
                .andExpect(status().isOk()).andReturn());
        assertThat(((Number) JsonPath.read(res2, "$.data.amounts.5.cur")).doubleValue()).isEqualTo(42.0);
    }

    // ── GET all/2025/11 跨公司求和(公司1+公司2 同 rowKey/field) ──
    @Test
    void allPeriod_sumsAcrossCompanies() throws Exception {
        mvc.perform(put("/api/reports/is/1/2025/11").header("Authorization", auth())
                .contentType("application/json").content("{\"cells\":[{\"rowKey\":\"1\",\"field\":\"cur\",\"amount\":100}]}"))
                .andExpect(status().isOk());
        mvc.perform(put("/api/reports/is/2/2025/11").header("Authorization", auth())
                .contentType("application/json").content("{\"cells\":[{\"rowKey\":\"1\",\"field\":\"cur\",\"amount\":250}]}"))
                .andExpect(status().isOk());
        String res = utf8(mvc.perform(get("/api/reports/is/all/2025/11").header("Authorization", auth()))
                .andExpect(status().isOk()).andReturn());
        assertThat(((Number) JsonPath.read(res, "$.data.amounts.1.cur")).doubleValue()).isEqualTo(350.0);
    }

    // ── POST custom-row → GET period 见该行 → DELETE 级联(父+子一起没) ──
    @Test
    void customRow_add_seen_thenDeleteCascades() throws Exception {
        String parentRes = utf8(mvc.perform(post("/api/reports/is/1/custom-row").header("Authorization", auth())
                .param("parentKey", "3").param("label", "自定义税A").param("level", "1"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0)).andReturn());
        String parentKey = JsonPath.read(parentRes, "$.data.rowKey");
        Number parentId = JsonPath.read(parentRes, "$.data.id");

        // 子行挂到父自定义行下
        mvc.perform(post("/api/reports/is/1/custom-row").header("Authorization", auth())
                .param("parentKey", parentKey).param("label", "自定义税A-子").param("level", "2"))
                .andExpect(status().isOk());

        // GET period 见这两行
        String p = utf8(mvc.perform(get("/api/reports/is/1/2025/10").header("Authorization", auth()))
                .andExpect(status().isOk()).andReturn());
        assertThat(JsonPath.<List<?>>read(p, "$.data.customRows[?(@.label=='自定义税A')]")).isNotEmpty();
        assertThat(JsonPath.<List<?>>read(p, "$.data.customRows[?(@.label=='自定义税A-子')]")).isNotEmpty();

        // DELETE 父 → 级联删子
        mvc.perform(delete("/api/reports/is/custom-row/" + parentId.longValue()).header("Authorization", auth()))
                .andExpect(status().isOk());
        String after = utf8(mvc.perform(get("/api/reports/is/1/2025/10").header("Authorization", auth()))
                .andExpect(status().isOk()).andReturn());
        assertThat(JsonPath.<List<?>>read(after, "$.data.customRows[?(@.label=='自定义税A')]")).isEmpty();
        assertThat(JsonPath.<List<?>>read(after, "$.data.customRows[?(@.label=='自定义税A-子')]")).isEmpty();
    }

    // ── POST import 两公司(一个新公司名) → 新公司自动建 + 本期落值 ──
    @Test
    void import_matchesExisting_autoCreatesNew_andWritesPeriod() throws Exception {
        String importBody = "{\"sections\":["
                + "{\"companyName\":\"园区租赁管理公司\",\"cells\":[{\"rowKey\":\"1\",\"field\":\"cur\",\"amount\":500}]},"
                + "{\"companyName\":\"某全新导入公司IT\",\"cells\":["
                + "{\"rowKey\":\"1\",\"field\":\"cur\",\"amount\":700},"
                + "{\"rowKey\":\"1\",\"field\":\"ytd\",\"amount\":7000}]}"
                + "]}";
        mvc.perform(post("/api/reports/is/import").param("year", "2025").param("month", "12")
                .header("Authorization", auth()).contentType("application/json").content(importBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.imported").value(3));

        // 新公司出现在公司列表
        String companies = utf8(mvc.perform(get("/api/companies").header("Authorization", auth()))
                .andExpect(status().isOk()).andReturn());
        assertThat(JsonPath.<List<?>>read(companies, "$.data[?(@.name=='某全新导入公司IT')]")).isNotEmpty();
        int newId = ((Number) JsonPath.<List<Object>>read(companies, "$.data[?(@.name=='某全新导入公司IT')].id").get(0)).intValue();

        // 新公司本期落值
        String p = utf8(mvc.perform(get("/api/reports/is/" + newId + "/2025/12").header("Authorization", auth()))
                .andExpect(status().isOk()).andReturn());
        assertThat(((Number) JsonPath.read(p, "$.data.amounts.1.cur")).doubleValue()).isEqualTo(700.0);
        assertThat(((Number) JsonPath.read(p, "$.data.amounts.1.ytd")).doubleValue()).isEqualTo(7000.0);
    }

    // ── 非法 statement 'bs' → 体内 code 400(HTTP 200) ──
    @Test
    void illegalStatement_returns400InBody() throws Exception {
        mvc.perform(get("/api/reports/bs/1/2025/10").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(400));
    }

    // ── 无 token → 401 ──
    @Test
    void period_withoutToken_returns401() throws Exception {
        mvc.perform(get("/api/reports/is/1/2025/10")).andExpect(status().isUnauthorized());
    }
}

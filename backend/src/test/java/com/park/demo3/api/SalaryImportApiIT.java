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
class SalaryImportApiIT extends AbstractMysqlIT {

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

    // ── 正常导入 source=import;空名进 errors;重导=替换本月导入行,手动行保留 ──
    @Test
    void import_replaceSemantics_sourceImport_blankNameSkipped_manualPreserved() throws Exception {
        // 干净 slot:2099-02。先放一行 manual(应在重导中保留)。
        mvc.perform(post("/api/salary/records").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"acctMonth\":\"2099-02\",\"name\":\"手动员工\",\"base\":5000}"))
                .andExpect(status().isOk());

        String body = "{\"rows\":["
                + "{\"tenantName\":\"导入张三\",\"role\":\"工程师\",\"base\":8000,\"social\":600,\"tax\":100},"
                + "{\"tenantName\":\"  \",\"base\":9}"
                + "]}";
        String res = utf8(mvc.perform(post("/api/salary/import").header("Authorization", auth())
                .param("year", "2099").param("month", "2")
                .contentType("application/json").content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.imported").value(1))
                .andExpect(jsonPath("$.data.skipped").value(1))
                .andReturn());
        assertThat((Integer) JsonPath.read(res, "$.data.errors[0].rowIndex")).isEqualTo(1);

        // 读回该月:2 行(1 manual + 1 import);导入行 source=import
        String month = utf8(mvc.perform(get("/api/salary/records")
                .param("year", "2099").param("month", "2").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.rows.length()").value(2))
                .andReturn());
        List<String> names = JsonPath.read(month, "$.data.rows[*].name");
        assertThat(names).containsExactlyInAnyOrder("手动员工", "导入张三");
        // 导入行 source=import 存在(过滤器返数组,用 isNotEmpty)
        mvc.perform(get("/api/salary/records").param("year", "2099").param("month", "2")
                .header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows[?(@.name=='导入张三' && @.source=='import')]").isNotEmpty());

        // 重导 B(不含「导入张三」)→ 旧导入行被清,新导入行落库;手动行不动
        mvc.perform(post("/api/salary/import").header("Authorization", auth())
                .param("year", "2099").param("month", "2")
                .contentType("application/json")
                .content("{\"rows\":[{\"tenantName\":\"新导入李四\",\"base\":7000}]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.imported").value(1));
        String after = utf8(mvc.perform(get("/api/salary/records")
                .param("year", "2099").param("month", "2").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.rows.length()").value(2))
                .andReturn());
        List<String> names2 = JsonPath.read(after, "$.data.rows[*].name");
        assertThat(names2).containsExactlyInAnyOrder("手动员工", "新导入李四");
    }

    // ── month 越界 → 400 ──
    @Test
    void import_invalidMonth_returns400() throws Exception {
        mvc.perform(post("/api/salary/import").header("Authorization", auth())
                .param("year", "2099").param("month", "13")
                .contentType("application/json").content("{\"rows\":[]}"))
                .andExpect(status().isBadRequest());
    }

    // ── year 越界 → 400 ──
    @Test
    void import_yearOutOfRange_returns400() throws Exception {
        mvc.perform(post("/api/salary/import").header("Authorization", auth())
                .param("year", "1999").param("month", "2")
                .contentType("application/json").content("{\"rows\":[]}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void import_withoutToken_returns401() throws Exception {
        mvc.perform(post("/api/salary/import")
                .param("year", "2099").param("month", "2")
                .contentType("application/json").content("{\"rows\":[]}"))
                .andExpect(status().isUnauthorized());
    }
}

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
class LedgerImportApiIT extends AbstractMysqlIT {

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

    // ── 正常导入 upsert + 未匹配租户进 errors + 未导入的其他租户行未被改/删 ──
    @Test
    void import_upsertMatched_reportsUnmatched_andLeavesOthersUntouched() throws Exception {
        // 用一个干净未来月(2026/12,无 seed),先种一行 tenant 2 作为"未在本次导入里的其他租户行"
        String seedOther = "{\"rows\":[{\"tenantId\":2,\"factoryRent\":7777}]}";
        mvc.perform(put("/api/ledger/companies/1/months/2026/12").header("Authorization", auth())
                .contentType("application/json").content(seedOther))
                .andExpect(status().isOk());

        // 导入:tenant 1 (中誉机械重工 = 在租) 命中;一个不存在的名字进 errors
        String importBody = "{\"rows\":["
                + "{\"tenantName\":\"中誉机械重工\",\"factoryRent\":50000},"
                + "{\"tenantName\":\"查无此租户\",\"factoryRent\":123}"
                + "]}";
        String res = utf8(mvc.perform(post("/api/ledger/companies/1/import")
                .param("year", "2026").param("month", "12")
                .header("Authorization", auth())
                .contentType("application/json").content(importBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.imported").value(1))
                .andExpect(jsonPath("$.data.skipped").value(1))
                .andReturn());
        assertThat((String) JsonPath.read(res, "$.data.errors[0].label")).isEqualTo("查无此租户");
        assertThat((String) JsonPath.read(res, "$.data.errors[0].reason")).isEqualTo("未找到匹配在租租户");

        // 读回本月:tenant 1 (rows[0]) 收到导入值;tenant 2 (rows[1]) 旧值未被抹/改
        String month = utf8(mvc.perform(get("/api/ledger/companies/1/months/2026/12")
                .header("Authorization", auth()))
                .andExpect(status().isOk()).andReturn());
        List<Integer> ids = JsonPath.read(month, "$.data.rows[*].tenantId");
        int idx1 = ids.indexOf(1), idx2 = ids.indexOf(2);
        assertThat(((Number) JsonPath.read(month, "$.data.rows[" + idx1 + "].factoryRent")).doubleValue())
                .isEqualTo(50000.0);
        // tenant 2 未在本次导入里 → 其 7777 行未被改/删
        assertThat(((Number) JsonPath.read(month, "$.data.rows[" + idx2 + "].factoryRent")).doubleValue())
                .isEqualTo(7777.0);

        // 二次导入同租户 → update(upsert,非新增):tenant 1 改成 60000
        mvc.perform(post("/api/ledger/companies/1/import")
                .param("year", "2026").param("month", "12")
                .header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":[{\"tenantName\":\"中誉机械重工\",\"factoryRent\":60000}]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.imported").value(1));
        String month2 = utf8(mvc.perform(get("/api/ledger/companies/1/months/2026/12")
                .header("Authorization", auth())).andReturn());
        List<Integer> ids2 = JsonPath.read(month2, "$.data.rows[*].tenantId");
        assertThat(((Number) JsonPath.read(month2, "$.data.rows[" + ids2.indexOf(1) + "].factoryRent")).doubleValue())
                .isEqualTo(60000.0);

        // 清理:blank tenant 1 / 2 让重跑确定性
        mvc.perform(put("/api/ledger/companies/1/months/2026/12").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":[{\"tenantId\":1},{\"tenantId\":2}]}"))
                .andExpect(status().isOk());
    }

    @Test
    void import_withoutToken_returns401() throws Exception {
        mvc.perform(post("/api/ledger/companies/1/import").param("year", "2026").param("month", "12")
                .contentType("application/json").content("{\"rows\":[]}"))
                .andExpect(status().isUnauthorized());
    }
}

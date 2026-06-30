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
class S10ImportApiIT extends AbstractMysqlIT {

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

    // ── 正常导入 source=import + tenant_id=null;空名进 errors;重导=替换本槽导入行,手动行保留 ──
    @Test
    void import_replaceSemantics_sourceImport_blankNameSkipped_manualPreserved() throws Exception {
        // 干净 slot:phase 1 / 2099-02。先放一行 manual(应在重导中保留)。
        mvc.perform(post("/api/s10").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"tenantName\":\"手动租户\",\"phase\":1,\"acctMonth\":\"2099-02\","
                        + "\"profile\":\"factory\",\"factoryRent\":777}"))
                .andExpect(status().isOk());

        String body = "{\"phase\":1,\"acctMonth\":\"2099-02\",\"rows\":["
                + "{\"tenantName\":\"导入试点租户\",\"profile\":\"factory\",\"factoryRent\":1000,\"elecStd\":200},"
                + "{\"tenantName\":\"  \",\"factoryRent\":9}"
                + "]}";
        String res = utf8(mvc.perform(post("/api/s10/import").header("Authorization", auth())
                .contentType("application/json").content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.imported").value(1))
                .andExpect(jsonPath("$.data.skipped").value(1))
                .andReturn());
        assertThat((Integer) JsonPath.read(res, "$.data.errors[0].rowIndex")).isEqualTo(1);

        // 读回 month:2 行(1 manual + 1 import);导入行 source=import,tenant_id 缺失(软引用)
        String month = utf8(mvc.perform(get("/api/s10/1/2099/2").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.rows.length()").value(2))
                .andReturn());
        // factoryRent 列合计 = 777(手动) + 1000(导入)
        assertThat(((Number) JsonPath.read(month, "$.data.columnTotals.factoryRent")).doubleValue())
                .isEqualTo(1777.00);

        // 重导 B(不含「导入试点租户」)→ 旧导入行被清,新导入行落库;手动行不动
        mvc.perform(post("/api/s10/import").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"phase\":1,\"acctMonth\":\"2099-02\",\"rows\":["
                        + "{\"tenantName\":\"新导入租户\",\"profile\":\"factory\",\"factoryRent\":500}]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.imported").value(1));
        String after = utf8(mvc.perform(get("/api/s10/1/2099/2").header("Authorization", auth()))
                .andExpect(status().isOk())
                // 仍 2 行:手动租户 + 新导入租户(旧导入「导入试点租户」已被清)
                .andExpect(jsonPath("$.data.rows.length()").value(2))
                .andReturn());
        // factoryRent 列合计 = 777(手动保留) + 500(新导入);旧 1000 消失
        assertThat(((Number) JsonPath.read(after, "$.data.columnTotals.factoryRent")).doubleValue())
                .isEqualTo(1277.00);
        List<String> names = JsonPath.read(after, "$.data.rows[*].tenantName");
        assertThat(names).containsExactlyInAnyOrder("手动租户", "新导入租户");
    }

    // ── acctMonth @Pattern 非法 → 400 ──
    @Test
    void import_invalidAcctMonth_returns400() throws Exception {
        mvc.perform(post("/api/s10/import").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"phase\":1,\"acctMonth\":\"2099-13\",\"rows\":[]}"))
                .andExpect(status().isBadRequest());
    }

    // ── phase 白名单越界 → 400 ──
    @Test
    void import_phaseOutOfRange_returns400() throws Exception {
        mvc.perform(post("/api/s10/import").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"phase\":5,\"acctMonth\":\"2099-02\",\"rows\":[]}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void import_withoutToken_returns401() throws Exception {
        mvc.perform(post("/api/s10/import")
                .contentType("application/json")
                .content("{\"phase\":1,\"acctMonth\":\"2099-02\",\"rows\":[]}"))
                .andExpect(status().isUnauthorized());
    }
}

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

    // ── 正常导入 upsert + source=import + tenant_id=null;空名进 errors;再导入即 update ──
    @Test
    void import_upsert_sourceImport_blankNameSkipped() throws Exception {
        // 干净 slot:phase 1 / 2099-02
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

        // 读回 month:1 行,source=import,tenant_id 缺失(软引用)
        String month = utf8(mvc.perform(get("/api/s10/1/2099/2").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.rows.length()").value(1))
                .andExpect(jsonPath("$.data.rows[0].source").value("import"))
                .andExpect(jsonPath("$.data.rows[0].tenantName").value("导入试点租户"))
                .andReturn());
        assertThat((Object) JsonPath.read(month, "$.data.rows[0].tenantId")).isNull();
        assertThat(((Number) JsonPath.read(month, "$.data.columnTotals.factoryRent")).doubleValue())
                .isEqualTo(1000.00);

        // 再导入同 slot 同名 → update,不新增行
        mvc.perform(post("/api/s10/import").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"phase\":1,\"acctMonth\":\"2099-02\",\"rows\":["
                        + "{\"tenantName\":\"导入试点租户\",\"profile\":\"factory\",\"factoryRent\":1500}]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.imported").value(1));
        mvc.perform(get("/api/s10/1/2099/2").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows.length()").value(1))
                .andExpect(jsonPath("$.data.columnTotals.factoryRent").value(1500.00));
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

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

// @Transactional 回滚造数(2026-07-20):此前 2099-05 的 s10 行不清理泄漏共享容器,
// 污染 ElecCostApiIT 空月锚(附表10收入侧变可算)——v0.10.0-beta.1 CI 首红根因之一。
@AutoConfigureMockMvc
@org.springframework.transaction.annotation.Transactional
class S10DeleteApiIT extends AbstractMysqlIT {

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

    // ── 清空本期导入:只删 source=import,manual/seed 不动,返回 deleted 计数 ──
    @Test
    void clearImported_deletesOnlyImport_keepsManual_returnsCount() throws Exception {
        // 干净 slot phase 1 / 2099-05:1 manual + 2 import
        mvc.perform(post("/api/s10").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"tenantName\":\"手动租户\",\"phase\":1,\"acctMonth\":\"2099-05\","
                        + "\"profile\":\"factory\",\"factoryRent\":100}"))
                .andExpect(status().isOk());
        mvc.perform(post("/api/s10/import").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"phase\":1,\"acctMonth\":\"2099-05\",\"rows\":["
                        + "{\"tenantName\":\"导入A\",\"profile\":\"factory\",\"factoryRent\":200},"
                        + "{\"tenantName\":\"导入B\",\"profile\":\"factory\",\"factoryRent\":300}]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.imported").value(2));
        mvc.perform(get("/api/s10/1/2099/5").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows.length()").value(3));

        // 清空本期导入 → deleted=2, skipped=0
        mvc.perform(delete("/api/s10/imported").header("Authorization", auth())
                .param("phase", "1").param("acctMonth", "2099-05"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.deleted").value(2))
                .andExpect(jsonPath("$.data.skipped").value(0));

        // 只剩手动行
        mvc.perform(get("/api/s10/1/2099/5").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows.length()").value(1))
                .andExpect(jsonPath("$.data.rows[0].source").value("manual"))
                .andExpect(jsonPath("$.data.rows[0].tenantName").value("手动租户"));

        // 无导入行可清 → deleted=0
        mvc.perform(delete("/api/s10/imported").header("Authorization", auth())
                .param("phase", "1").param("acctMonth", "2099-05"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.deleted").value(0));
    }

    // ── 批删:删 import/manual,跳过 seed(skipped=种子数);不存在 id 静默忽略 ──
    @Test
    void batchDelete_deletesImportManual_skipsSeed() throws Exception {
        // 干净 slot phase 1 / 2099-06:1 import
        String created = utf8(mvc.perform(post("/api/s10").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"tenantName\":\"待删手动\",\"phase\":1,\"acctMonth\":\"2099-06\","
                        + "\"profile\":\"factory\",\"factoryRent\":10}"))
                .andExpect(status().isOk()).andReturn());
        long manualId = ((Number) JsonPath.read(created, "$.data.id")).longValue();

        // 种子行 id:phase 1 / 2025-03 第一行(source=seed)
        String seedMonth = utf8(mvc.perform(get("/api/s10/1/2025/3").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.rows[0].source").value("seed"))
                .andReturn());
        long seedId = ((Number) JsonPath.read(seedMonth, "$.data.rows[0].id")).longValue();

        // 批删 [manualId, seedId, 99999999(不存在)] → deleted=1, skipped=1(种子)
        mvc.perform(delete("/api/s10/batch").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"ids\":[" + manualId + "," + seedId + ",99999999]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.deleted").value(1))
                .andExpect(jsonPath("$.data.skipped").value(1));

        // 手动行已删;种子行还在
        mvc.perform(get("/api/s10/1/2099/6").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows.length()").value(0));
        // 用 isNotEmpty 断言该种子行仍在(JsonPath 过滤器返数组,勿与标量 value 比,避类型/包装不符)
        mvc.perform(get("/api/s10/1/2025/3").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows[?(@.id==" + seedId + ")]").isNotEmpty());
    }

    // ── clearImported phase 越界 → 400 ──
    @Test
    void clearImported_phaseOutOfRange_returns400() throws Exception {
        mvc.perform(delete("/api/s10/imported").header("Authorization", auth())
                .param("phase", "5").param("acctMonth", "2099-05"))
                .andExpect(status().isBadRequest());
    }

    // ── clearImported acctMonth @Pattern 非法 → 400 ──
    @Test
    void clearImported_invalidAcctMonth_returns400() throws Exception {
        mvc.perform(delete("/api/s10/imported").header("Authorization", auth())
                .param("phase", "1").param("acctMonth", "2099-13"))
                .andExpect(status().isBadRequest());
    }

    // ── auth:无 token → 401 ──
    @Test
    void clearImported_withoutToken_returns401() throws Exception {
        mvc.perform(delete("/api/s10/imported")
                .param("phase", "1").param("acctMonth", "2099-05"))
                .andExpect(status().isUnauthorized());
    }
}

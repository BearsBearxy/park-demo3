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

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// @Transactional:批删用例真删共享种子行、清空用例留 manual 行,事务回滚还原,避免污染同库其它读/导入测试。
@AutoConfigureMockMvc
@Transactional
class OfficeDeleteApiIT extends AbstractMysqlIT {

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

    // ── 清空本期导入:只删 source=import,manual 不动,返回 deleted 计数 ──
    @Test
    void clearImported_deletesOnlyImport_keepsManual_returnsCount() throws Exception {
        // 干净 slot 13/2098:1 manual(05) + 2 import(01/02)
        mvc.perform(post("/api/utilities/13/records").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"scheduleNo\":13,\"acctMonth\":\"2098-05\",\"belongMonth\":\"2098-05\","
                        + "\"elecQty\":100,\"elecPrice\":0.8,\"waterQty\":10,\"waterPrice\":4}"))
                .andExpect(status().isOk());
        mvc.perform(post("/api/utilities/13/import").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":["
                        + "{\"acctMonth\":\"2098-01\",\"elecQty\":200,\"elecPrice\":0.8,\"waterQty\":5,\"waterPrice\":4},"
                        + "{\"acctMonth\":\"2098-02\",\"elecQty\":300,\"elecPrice\":0.8,\"waterQty\":6,\"waterPrice\":4}]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.imported").value(2));
        mvc.perform(get("/api/utilities/13/records").param("year", "2098").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows.length()").value(3));

        // 清空本期导入 → deleted=2, skipped=0
        mvc.perform(delete("/api/utilities/13/imported").header("Authorization", auth())
                .param("year", "2098"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.deleted").value(2))
                .andExpect(jsonPath("$.data.skipped").value(0));

        // 只剩手动行
        mvc.perform(get("/api/utilities/13/records").param("year", "2098").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows.length()").value(1))
                .andExpect(jsonPath("$.data.rows[0].source").value("manual"))
                .andExpect(jsonPath("$.data.rows[0].acctMonth").value("2098-05"));

        // 无导入行可清 → deleted=0
        mvc.perform(delete("/api/utilities/13/imported").header("Authorization", auth())
                .param("year", "2098"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.deleted").value(0));
    }

    // ── 批删:seed 与 manual 同等可删(deleted 含种子,skipped=0);不存在 id 静默忽略 ──
    @Test
    void batchDelete_deletesManualAndSeed() throws Exception {
        // 干净 slot 13/2097:1 manual
        String created = utf8(mvc.perform(post("/api/utilities/13/records").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"scheduleNo\":13,\"acctMonth\":\"2097-06\",\"belongMonth\":\"2097-06\","
                        + "\"elecQty\":1,\"elecPrice\":0.8,\"waterQty\":1,\"waterPrice\":4}"))
                .andExpect(status().isOk()).andReturn());
        long manualId = ((Number) JsonPath.read(created, "$.data.id")).longValue();

        // 种子行 id:13/2025 第一行(source=seed)
        String seedYear = utf8(mvc.perform(get("/api/utilities/13/records").param("year", "2025")
                .header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.rows[0].source").value("seed"))
                .andReturn());
        long seedId = ((Number) JsonPath.read(seedYear, "$.data.rows[0].id")).longValue();

        // 批删 [manualId, seedId, 99999999(不存在)] → deleted=2(种子也删), skipped=0
        mvc.perform(delete("/api/utilities/batch").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"ids\":[" + manualId + "," + seedId + ",99999999]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.deleted").value(2))
                .andExpect(jsonPath("$.data.skipped").value(0));

        // 手动行已删
        mvc.perform(get("/api/utilities/13/records").param("year", "2097").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows.length()").value(0));
        // 种子行也已删(过滤器返数组,用 isEmpty)
        mvc.perform(get("/api/utilities/13/records").param("year", "2025").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows[?(@.id==" + seedId + ")]").isEmpty());
    }

    // ── clearImported scheduleNo 非白名单 → 404(code in body) ──
    @Test
    void clearImported_badScheduleNo_returns404InBody() throws Exception {
        mvc.perform(delete("/api/utilities/99/imported").header("Authorization", auth())
                .param("year", "2098"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(404));
    }

    // ── clearImported year 越界 → 400 ──
    @Test
    void clearImported_yearOutOfRange_returns400() throws Exception {
        mvc.perform(delete("/api/utilities/13/imported").header("Authorization", auth())
                .param("year", "1999"))
                .andExpect(status().isBadRequest());
    }

    // ── auth:无 token → 401 ──
    @Test
    void clearImported_withoutToken_returns401() throws Exception {
        mvc.perform(delete("/api/utilities/13/imported").param("year", "2098"))
                .andExpect(status().isUnauthorized());
    }
}

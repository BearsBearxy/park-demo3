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

// @Transactional:批删/单删真删共享种子行、清空留 manual 行,事务回滚还原,避免污染同库其它读/导入测试。
@AutoConfigureMockMvc
@Transactional
class ElecDeleteApiIT extends AbstractMysqlIT {

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

    // ── 单删 seed(假数据可删,去 seed 保护)→ 成功(code 0) ──
    @Test
    void delete_seedRow_ok() throws Exception {
        String body = utf8(mvc.perform(get("/api/elec/records")
                .param("year", "2025").param("type", "energy").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.rows[0].source").value("seed"))
                .andReturn());
        int seedId = JsonPath.read(body, "$.data.rows[0].id");

        mvc.perform(delete("/api/elec/records/" + seedId).header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0));
        // 种子行已删(过滤器返数组,用 isEmpty)
        mvc.perform(get("/api/elec/records").param("year", "2025").param("type", "energy").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows[?(@.id==" + seedId + ")]").isEmpty());
    }

    // ── 清空本期导入:只删 source=import(本年),manual/seed 不动,返回 deleted 计数 ──
    @Test
    void clearImported_deletesOnlyImport_keepsManual_returnsCount() throws Exception {
        // 干净年 2098:1 manual(energy) + 2 import(energy + basic)
        mvc.perform(post("/api/elec/records").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"type\":\"energy\",\"phase\":\"p1\",\"acctMonth\":\"2098-05\","
                        + "\"cat\":\"大工业用电\",\"unit\":\"度\",\"qty\":100,\"price\":1,\"rate\":0.13}"))
                .andExpect(status().isOk());
        mvc.perform(post("/api/elec/import").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":["
                        + "{\"type\":\"energy\",\"phaseId\":\"p1\",\"acctMonth\":\"2098-01\",\"cat\":\"大工业用电\",\"unit\":\"度\",\"qty\":200,\"price\":1,\"rate\":0.13},"
                        + "{\"type\":\"basic\",\"phaseId\":\"p1\",\"acctMonth\":\"2098-01\",\"demand\":300,\"price\":36.1,\"rate\":0.13}]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.imported").value(2));

        // 清空本期导入 → deleted=2, skipped=0
        mvc.perform(delete("/api/elec/imported").header("Authorization", auth()).param("year", "2098"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.deleted").value(2))
                .andExpect(jsonPath("$.data.skipped").value(0));

        // 只剩手动 energy 行
        mvc.perform(get("/api/elec/records").param("year", "2098").param("type", "energy").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows.length()").value(1))
                .andExpect(jsonPath("$.data.rows[0].source").value("manual"));
        mvc.perform(get("/api/elec/records").param("year", "2098").param("type", "basic").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows.length()").value(0));

        // 无导入行可清 → deleted=0
        mvc.perform(delete("/api/elec/imported").header("Authorization", auth()).param("year", "2098"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.deleted").value(0));
    }

    // ── 批删:seed 与 manual 同等可删(deleted 含种子,skipped=0);不存在 id 静默忽略 ──
    @Test
    void batchDelete_deletesManualAndSeed() throws Exception {
        // 干净年 2097:1 manual
        String created = utf8(mvc.perform(post("/api/elec/records").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"type\":\"energy\",\"phase\":\"p1\",\"acctMonth\":\"2097-06\","
                        + "\"cat\":\"大工业用电\",\"unit\":\"度\",\"qty\":1,\"price\":1,\"rate\":0.13}"))
                .andExpect(status().isOk()).andReturn());
        long manualId = ((Number) JsonPath.read(created, "$.data.id")).longValue();

        // 种子行 id:2025 energy 第一行(source=seed)
        String seedYear = utf8(mvc.perform(get("/api/elec/records").param("year", "2025")
                .param("type", "energy").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.rows[0].source").value("seed"))
                .andReturn());
        long seedId = ((Number) JsonPath.read(seedYear, "$.data.rows[0].id")).longValue();

        // 批删 [manualId, seedId, 99999999(不存在)] → deleted=2(种子也删), skipped=0
        mvc.perform(delete("/api/elec/batch").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"ids\":[" + manualId + "," + seedId + ",99999999]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.deleted").value(2))
                .andExpect(jsonPath("$.data.skipped").value(0));

        // 手动行已删
        mvc.perform(get("/api/elec/records").param("year", "2097").param("type", "energy").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows.length()").value(0));
        // 种子行也已删
        mvc.perform(get("/api/elec/records").param("year", "2025").param("type", "energy").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows[?(@.id==" + seedId + ")]").isEmpty());
    }

    // ── clearImported year 越界 → 400 ──
    @Test
    void clearImported_yearOutOfRange_returns400() throws Exception {
        mvc.perform(delete("/api/elec/imported").header("Authorization", auth()).param("year", "1999"))
                .andExpect(status().isBadRequest());
    }

    // ── auth:无 token → 401 ──
    @Test
    void clearImported_withoutToken_returns401() throws Exception {
        mvc.perform(delete("/api/elec/imported").param("year", "2098"))
                .andExpect(status().isUnauthorized());
    }
}

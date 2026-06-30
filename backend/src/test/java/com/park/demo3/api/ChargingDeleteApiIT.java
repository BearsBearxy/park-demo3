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

// @Transactional:清空/批删用例写入再删,事务回滚还原,避免污染同库读测试。
// V19 后充电桩记录空 → 用例自建 manual + import 行验证。
@AutoConfigureMockMvc
@Transactional
class ChargingDeleteApiIT extends AbstractMysqlIT {

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
        // 干净 slot 7/2098:1 manual + 2 import
        mvc.perform(post("/api/charging/7/records").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"scheduleNo\":7,\"cat\":\"wancheng\",\"acctMonth\":\"2098-05\",\"kwh\":100,\"fee\":80,\"cost\":50}"))
                .andExpect(status().isOk());
        mvc.perform(post("/api/charging/7/import").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":["
                        + "{\"cat\":\"wancheng\",\"acctMonth\":\"2098-01\",\"kwh\":200,\"fee\":160,\"cost\":100},"
                        + "{\"cat\":\"xiaoju\",\"acctMonth\":\"2098-02\",\"kwh\":300,\"fee\":240,\"cost\":150}]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.imported").value(2));
        mvc.perform(get("/api/charging/7/records").param("year", "2098").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows.length()").value(3));

        // 清空本期导入 → deleted=2, skipped=0
        mvc.perform(delete("/api/charging/7/imported").header("Authorization", auth())
                .param("year", "2098"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.deleted").value(2))
                .andExpect(jsonPath("$.data.skipped").value(0));

        // 只剩手动行
        mvc.perform(get("/api/charging/7/records").param("year", "2098").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows.length()").value(1))
                .andExpect(jsonPath("$.data.rows[0].source").value("manual"))
                .andExpect(jsonPath("$.data.rows[0].acctMonth").value("2098-05"));

        // 无导入行可清 → deleted=0
        mvc.perform(delete("/api/charging/7/imported").header("Authorization", auth())
                .param("year", "2098"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.deleted").value(0));
    }

    // ── 批删:manual 与 import 同等可删(deleted 含两者,skipped=0);不存在 id 静默忽略 ──
    @Test
    void batchDelete_deletesManualAndImport() throws Exception {
        // 干净 slot 8/2097:1 manual
        String created = utf8(mvc.perform(post("/api/charging/8/records").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"scheduleNo\":8,\"cat\":\"dingding\",\"acctMonth\":\"2097-06\",\"kwh\":1,\"fee\":1,\"cost\":0}"))
                .andExpect(status().isOk()).andReturn());
        long manualId = ((Number) JsonPath.read(created, "$.data.id")).longValue();
        // 1 import
        mvc.perform(post("/api/charging/8/import").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":[{\"cat\":\"dingding\",\"acctMonth\":\"2097-01\",\"kwh\":10,\"fee\":30,\"cost\":8}]}"))
                .andExpect(status().isOk());
        String y = utf8(mvc.perform(get("/api/charging/8/records").param("year", "2097").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows.length()").value(2))
                .andReturn());
        // 取 import 行 id(过滤器返数组)
        java.util.List<Number> importIds = JsonPath.read(y, "$.data.rows[?(@.source=='import')].id");
        long importId = importIds.get(0).longValue();

        // 批删 [manualId, importId, 99999999(不存在)] → deleted=2, skipped=0
        mvc.perform(delete("/api/charging/8/batch").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"ids\":[" + manualId + "," + importId + ",99999999]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.deleted").value(2))
                .andExpect(jsonPath("$.data.skipped").value(0));

        // 两行皆已删
        mvc.perform(get("/api/charging/8/records").param("year", "2097").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows.length()").value(0));
    }

    // ── clearImported scheduleNo 非白名单 → 404(code in body) ──
    @Test
    void clearImported_badScheduleNo_returns404InBody() throws Exception {
        mvc.perform(delete("/api/charging/99/imported").header("Authorization", auth())
                .param("year", "2098"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(404));
    }

    // ── clearImported year 越界 → 400 ──
    @Test
    void clearImported_yearOutOfRange_returns400() throws Exception {
        mvc.perform(delete("/api/charging/7/imported").header("Authorization", auth())
                .param("year", "1999"))
                .andExpect(status().isBadRequest());
    }

    // ── auth:无 token → 401 ──
    @Test
    void clearImported_withoutToken_returns401() throws Exception {
        mvc.perform(delete("/api/charging/7/imported").param("year", "2098"))
                .andExpect(status().isUnauthorized());
    }
}

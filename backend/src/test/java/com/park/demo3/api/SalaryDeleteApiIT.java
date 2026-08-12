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

// @Transactional:批删用例真删共享种子行、清空用例留 manual 行,事务回滚还原,避免污染同库其它读测试。
@AutoConfigureMockMvc
@Transactional
class SalaryDeleteApiIT extends AbstractMysqlIT {

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
        // 干净 slot 2099-05:1 manual + 2 import
        String createdManual = utf8(mvc.perform(post("/api/salary/records").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"acctMonth\":\"2099-05\",\"name\":\"手动员工\",\"base\":100}"))
                .andExpect(status().isOk()).andReturn());
        long manualId = ((Number) JsonPath.read(createdManual, "$.data.id")).longValue();
        mvc.perform(post("/api/salary/import").header("Authorization", auth())
                .param("year", "2099").param("month", "5")
                .contentType("application/json")
                .content("{\"rows\":[{\"tenantName\":\"导入A\",\"base\":200},{\"tenantName\":\"导入B\",\"base\":300}]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.imported").value(2));
        mvc.perform(get("/api/salary/records").param("year", "2099").param("month", "5")
                .header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows.length()").value(3));

        // 清空本期导入 → deleted=2, skipped=0
        mvc.perform(delete("/api/salary/imported").header("Authorization", auth())
                .param("year", "2099").param("month", "5"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.deleted").value(2))
                .andExpect(jsonPath("$.data.skipped").value(0));

        // 只剩手动行
        mvc.perform(get("/api/salary/records").param("year", "2099").param("month", "5")
                .header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows.length()").value(1))
                .andExpect(jsonPath("$.data.rows[0].source").value("manual"))
                .andExpect(jsonPath("$.data.rows[0].name").value("手动员工"));

        // 无导入行可清 → deleted=0
        mvc.perform(delete("/api/salary/imported").header("Authorization", auth())
                .param("year", "2099").param("month", "5"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.deleted").value(0));

        // ⭐收尾必须删掉这条 manual:salary/overview 的 currentYear 是「表内最大数据年」推导的,
        // 留一条 2099 行会把 SalaryApiIT 的 currentYear 断言从 2026 顶到 2099。共享容器里
        // surefire 顺序不保证:本地按类名字母序 SalaryApiIT 先跑所以看不见,CI 上换了顺序就红
        // (feat 分支首推实测)。断言全部做完才删,不影响本例的"manual 不动"语义。
        mvc.perform(delete("/api/salary/batch").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"ids\":[" + manualId + "]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.deleted").value(1));
    }

    // ── 批删:seed 与 manual 同等可删(deleted 含种子,skipped=0);不存在 id 静默忽略 ──
    @Test
    void batchDelete_deletesManualAndSeed() throws Exception {
        // 干净 slot 2099-06:1 manual
        String created = utf8(mvc.perform(post("/api/salary/records").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"acctMonth\":\"2099-06\",\"name\":\"待删手动\",\"base\":10}"))
                .andExpect(status().isOk()).andReturn());
        long manualId = ((Number) JsonPath.read(created, "$.data.id")).longValue();

        // 种子行 id:2026-01 第一行(source=seed)
        String seedMonth = utf8(mvc.perform(get("/api/salary/records")
                .param("year", "2026").param("month", "1").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.rows[0].source").value("seed"))
                .andReturn());
        long seedId = ((Number) JsonPath.read(seedMonth, "$.data.rows[0].id")).longValue();

        // 批删 [manualId, seedId, 99999999(不存在)] → deleted=2(种子也删), skipped=0
        mvc.perform(delete("/api/salary/batch").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"ids\":[" + manualId + "," + seedId + ",99999999]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.deleted").value(2))
                .andExpect(jsonPath("$.data.skipped").value(0));

        // 手动行已删
        mvc.perform(get("/api/salary/records").param("year", "2099").param("month", "6")
                .header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows.length()").value(0));
        // 种子行也已删(过滤器返数组,用 isEmpty)
        mvc.perform(get("/api/salary/records").param("year", "2026").param("month", "1")
                .header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows[?(@.id==" + seedId + ")]").isEmpty());
    }

    // ── clearImported month 越界 → 400 ──
    @Test
    void clearImported_invalidMonth_returns400() throws Exception {
        mvc.perform(delete("/api/salary/imported").header("Authorization", auth())
                .param("year", "2099").param("month", "13"))
                .andExpect(status().isBadRequest());
    }

    // ── auth:无 token → 401 ──
    @Test
    void clearImported_withoutToken_returns401() throws Exception {
        mvc.perform(delete("/api/salary/imported")
                .param("year", "2099").param("month", "5"))
                .andExpect(status().isUnauthorized());
    }
}

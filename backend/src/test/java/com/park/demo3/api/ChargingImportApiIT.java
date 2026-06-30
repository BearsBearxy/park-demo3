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
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// @Transactional:导入用例写入多运营商多月记录、replace upsert,事务回滚还原,避免污染 overview 确定性年份范围与同库读测试。
// V19 后充电桩记录空 → 各用例从空 slot 起,fee 由前端按附表算好后下发(IT 直接传算好的 fee 值)。
@AutoConfigureMockMvc
@Transactional
class ChargingImportApiIT extends AbstractMysqlIT {

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

    // ── 电动车(no=8):各运营商逐月入(叮叮充/电信),source=import,派生 profit=fee−cost;未知运营商跳过 ──
    @Test
    void import_ebike_perOperatorMonthly_unknownSkipped() throws Exception {
        String body = "{\"rows\":["
                + "{\"cat\":\"dingding\",\"acctMonth\":\"2025-01\",\"kwh\":1205.49,\"fee\":3872.23,\"cost\":895.01},"
                + "{\"cat\":\"dingding\",\"acctMonth\":\"2025-02\",\"kwh\":1404.15,\"fee\":4329.03,\"cost\":1013.49},"
                + "{\"cat\":\"dianxin\",\"acctMonth\":\"2025-01\",\"kwh\":839.63,\"fee\":2367.91,\"cost\":699.41},"
                + "{\"cat\":\"unknownop\",\"acctMonth\":\"2025-01\",\"kwh\":1,\"fee\":1,\"cost\":0}"
                + "]}";
        String res = utf8(mvc.perform(post("/api/charging/8/import").header("Authorization", auth())
                .contentType("application/json").content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.imported").value(3))
                .andExpect(jsonPath("$.data.skipped").value(1))
                .andReturn());
        // 未知运营商行 rowIndex=3
        List<Integer> badIdx = JsonPath.read(res, "$.data.errors[*].rowIndex");
        assertThat(badIdx).containsExactly(3);

        // 读回 2025:3 行;dingding 两月 + dianxin 一月;source=import;fee 直取(电动车口径)、profit 派生
        String y = utf8(mvc.perform(get("/api/charging/8/records").param("year", "2025").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.rows.length()").value(3))
                .andReturn());
        // dingding 2025-01:fee=3872.23(已扣手续费,直取)、profit=3872.23−895.01=2977.22
        mvc.perform(get("/api/charging/8/records").param("year", "2025").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows[?(@.cat=='dingding' && @.acctMonth=='2025-01' && @.source=='import' && @.fee==3872.23 && @.profit==2977.22)]").isNotEmpty())
                .andExpect(jsonPath("$.data.rows[?(@.cat=='dianxin' && @.acctMonth=='2025-01')]").isNotEmpty());
        assertThat((List<String>) JsonPath.read(y, "$.data.rows[*].cat"))
                .contains("dingding", "dianxin");
    }

    // ── 汽车(no=7):聚合行前端已跳过 → IT 只传单月行入库;fee 为前端算好的「收入−手续费」口径 ──
    @Test
    void import_car_singleMonthsOnly_feeNetOfServiceFee() throws Exception {
        // 万城万 2025-10/11(聚合年/范围/小计行前端不入此 rows);fee = 充电收入 − 手续费及服务费
        // 2025-10:9076.52 − 162.74 = 8913.78;cost=5395.08
        String body = "{\"rows\":["
                + "{\"cat\":\"wancheng\",\"acctMonth\":\"2025-10\",\"kwh\":8484.58,\"fee\":8913.78,\"cost\":5395.08},"
                + "{\"cat\":\"wancheng\",\"acctMonth\":\"2025-11\",\"kwh\":5168.42,\"fee\":5149.48,\"cost\":3286.43},"
                + "{\"cat\":\"xiaoju\",\"acctMonth\":\"2025-10\",\"kwh\":17144.76,\"fee\":18181.64,\"cost\":10901.81}"
                + "]}";
        mvc.perform(post("/api/charging/7/import").header("Authorization", auth())
                .contentType("application/json").content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.imported").value(3))
                .andExpect(jsonPath("$.data.skipped").value(0));
        // 万城万 2025-10:profit = 8913.78 − 5395.08 = 3518.70(派生)
        mvc.perform(get("/api/charging/7/records").param("year", "2025").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows.length()").value(3))
                .andExpect(jsonPath("$.data.rows[?(@.cat=='wancheng' && @.acctMonth=='2025-10' && @.fee==8913.78 && @.profit==3518.70)]").isNotEmpty());
    }

    // ── 按(附表,cat,月)upsert:重导同(cat,月)替换、新(cat,月)新增、别的运营商不动 ──
    @Test
    void import_upsertByScheduleCatMonth() throws Exception {
        mvc.perform(post("/api/charging/8/import").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":["
                        + "{\"cat\":\"dingding\",\"acctMonth\":\"2096-01\",\"kwh\":100,\"fee\":300,\"cost\":80},"
                        + "{\"cat\":\"dianxin\",\"acctMonth\":\"2096-01\",\"kwh\":50,\"fee\":150,\"cost\":40}]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.imported").value(2));
        // 重导:dingding/2096-01 改值(替换) + dingding/2096-02 新增;dianxin/2096-01 不受影响
        mvc.perform(post("/api/charging/8/import").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":["
                        + "{\"cat\":\"dingding\",\"acctMonth\":\"2096-01\",\"kwh\":999,\"fee\":900,\"cost\":100},"
                        + "{\"cat\":\"dingding\",\"acctMonth\":\"2096-02\",\"kwh\":120,\"fee\":360,\"cost\":90}]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.imported").value(2));
        String y = utf8(mvc.perform(get("/api/charging/8/records").param("year", "2096").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.rows.length()").value(3))   // dingding 01(替换)/02(新) + dianxin 01(留)
                .andReturn());
        // dingding/2096-01 单行新值(upsert 替换,不重复)
        mvc.perform(get("/api/charging/8/records").param("year", "2096").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows[?(@.cat=='dingding' && @.acctMonth=='2096-01' && @.kwh==999)]").isNotEmpty())
                .andExpect(jsonPath("$.data.rows[?(@.cat=='dianxin' && @.acctMonth=='2096-01')]").isNotEmpty());
        assertThat((List<String>) JsonPath.read(y, "$.data.rows[*].acctMonth"))
                .filteredOn(m -> true).hasSize(3);
    }

    // ── 非法 acctMonth(越界年/月)→ 进 errors 跳过,不抛 ──
    @Test
    void import_invalidAcctMonth_skipped() throws Exception {
        mvc.perform(post("/api/charging/8/import").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":["
                        + "{\"cat\":\"dingding\",\"acctMonth\":\"1999-01\",\"kwh\":1,\"fee\":1,\"cost\":0},"
                        + "{\"cat\":\"dingding\",\"acctMonth\":\"2024-13\",\"kwh\":1,\"fee\":1,\"cost\":0}"
                        + "]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.imported").value(0))
                .andExpect(jsonPath("$.data.skipped").value(2));
    }

    // ── scheduleNo 非白名单 → 404(code in body) ──
    @Test
    void import_badScheduleNo_returns404InBody() throws Exception {
        mvc.perform(post("/api/charging/99/import").header("Authorization", auth())
                .contentType("application/json").content("{\"rows\":[]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(404));
    }

    @Test
    void import_withoutToken_returns401() throws Exception {
        mvc.perform(post("/api/charging/8/import")
                .contentType("application/json").content("{\"rows\":[]}"))
                .andExpect(status().isUnauthorized());
    }
}

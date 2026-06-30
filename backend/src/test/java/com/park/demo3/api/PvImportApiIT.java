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

// @Transactional:导入用例写入多期多年记录、替换共享种子(期,月),事务回滚还原,避免污染 overview 确定性年份范围与同库其它读测试。
@AutoConfigureMockMvc
@Transactional
class PvImportApiIT extends AbstractMysqlIT {

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

    // ── 多段各落各期 + 跨年(2096+2097,无种子年)+ occurMonth 分离 + source=import + 派生 gen/fee + 重导 upsert + 非法行跳过 ──
    @Test
    void import_multiPhase_crossYear_occurSeparate_upsert_skipsInvalid() throws Exception {
        // p1/p2/p3 各落各期,跨 2096+2097;occurMonth=上月;两行非法(期别/月格式)
        String body = "{\"rows\":["
                + "{\"phaseId\":\"p1\",\"acctMonth\":\"2096-01\",\"occurMonth\":\"2095-12\",\"selfKwh\":100,\"selfAmt\":90,\"gridKwh\":40,\"gridAmt\":18},"
                + "{\"phaseId\":\"p1\",\"acctMonth\":\"2097-01\",\"occurMonth\":\"2096-12\",\"selfKwh\":200,\"selfAmt\":180,\"gridKwh\":50,\"gridAmt\":22.5},"
                + "{\"phaseId\":\"p2\",\"acctMonth\":\"2096-06\",\"occurMonth\":\"2096-05\",\"selfKwh\":300,\"selfAmt\":270,\"gridKwh\":60,\"gridAmt\":27},"
                + "{\"phaseId\":\"p3\",\"acctMonth\":\"2096-12\",\"occurMonth\":\"2096-11\",\"selfKwh\":10,\"selfAmt\":9,\"gridKwh\":2,\"gridAmt\":1},"
                + "{\"phaseId\":\"pX\",\"acctMonth\":\"2096-01\",\"selfKwh\":1},"
                + "{\"phaseId\":\"p1\",\"acctMonth\":\"2096-13\",\"selfKwh\":1}"
                + "]}";
        String res = utf8(mvc.perform(post("/api/pv/import").header("Authorization", auth())
                .contentType("application/json").content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.imported").value(4))
                .andExpect(jsonPath("$.data.skipped").value(2))
                .andReturn());
        List<Integer> badIdx = JsonPath.read(res, "$.data.errors[*].rowIndex");
        assertThat(badIdx).containsExactly(4, 5);

        // 2096:三段各落各期(p1-01 / p2-06 / p3-12),按 acctMonth 升序
        String y2096 = utf8(mvc.perform(get("/api/pv/records").param("year", "2096")
                .header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.rows.length()").value(3))
                .andReturn());
        assertThat((List<String>) JsonPath.read(y2096, "$.data.rows[*].phase"))
                .containsExactly("p1", "p2", "p3");
        // p1/2096-01:occurMonth 分离、source=import、派生 gen=140/fee=108
        mvc.perform(get("/api/pv/records").param("year", "2096").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows[?(@.phase=='p1' && @.acctMonth=='2096-01' && @.occurMonth=='2095-12' && @.source=='import')]").isNotEmpty())
                .andExpect(jsonPath("$.data.rows[?(@.acctMonth=='2096-01' && @.gen==140.0 && @.fee==108.0)]").isNotEmpty());

        // 2097:仅 p1-01
        mvc.perform(get("/api/pv/records").param("year", "2097").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows.length()").value(1))
                .andExpect(jsonPath("$.data.rows[0].phase").value("p1"))
                .andExpect(jsonPath("$.data.rows[0].acctMonth").value("2097-01"));

        // 重导:p1/2096-01 改值(同(期,月)upsert 替换)+ p1/2096-05 新增;p2/p3 与 2097 不动
        mvc.perform(post("/api/pv/import").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":["
                        + "{\"phaseId\":\"p1\",\"acctMonth\":\"2096-01\",\"selfKwh\":999,\"selfAmt\":900,\"gridKwh\":1,\"gridAmt\":1},"
                        + "{\"phaseId\":\"p1\",\"acctMonth\":\"2096-05\",\"selfKwh\":50,\"selfAmt\":40,\"gridKwh\":5,\"gridAmt\":4}]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.imported").value(2));
        // 2096 现 4 行(p1-01 替换 / p1-05 新 / p2-06 留 / p3-12 留);p1-01 单行新值
        mvc.perform(get("/api/pv/records").param("year", "2096").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows.length()").value(4))
                .andExpect(jsonPath("$.data.rows[?(@.phase=='p1' && @.acctMonth=='2096-01' && @.selfKwh==999.0)]").isNotEmpty())
                .andExpect(jsonPath("$.data.rows[?(@.phase=='p1' && @.acctMonth=='2096-01')]").isNotEmpty());
        // 2097 未被触及
        mvc.perform(get("/api/pv/records").param("year", "2097").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows.length()").value(1));
    }

    // ── 导入种子(期,月)→ 按(期,月)upsert 覆盖种子(p1/2025-01 本有种子;@Transactional 回滚还原) ──
    @Test
    void import_replacesSeedPhaseMonth() throws Exception {
        // 该(期,月)导入前为 seed;导入后覆盖为 import 新值,仍单行
        mvc.perform(post("/api/pv/import").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":[{\"phaseId\":\"p1\",\"acctMonth\":\"2025-01\",\"occurMonth\":\"2024-12\","
                        + "\"selfKwh\":11111,\"selfAmt\":10000,\"gridKwh\":2222,\"gridAmt\":2000}]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.imported").value(1))
                .andExpect(jsonPath("$.data.errors.length()").value(0));
        mvc.perform(get("/api/pv/records").param("year", "2025").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows[?(@.phase=='p1' && @.acctMonth=='2025-01' && @.source=='import' && @.selfKwh==11111)]").isNotEmpty())
                .andExpect(jsonPath("$.data.rows[?(@.phase=='p1' && @.acctMonth=='2025-01' && @.source=='seed')]").isEmpty());
    }

    // ── occurMonth 缺省 = acctMonth ──
    @Test
    void import_occurMonthDefaultsToAcct() throws Exception {
        mvc.perform(post("/api/pv/import").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":[{\"phaseId\":\"p2\",\"acctMonth\":\"2098-06\",\"selfKwh\":500,\"selfAmt\":400}]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.imported").value(1));
        mvc.perform(get("/api/pv/records").param("year", "2098").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows[0].acctMonth").value("2098-06"))
                .andExpect(jsonPath("$.data.rows[0].occurMonth").value("2098-06"));
    }

    // ── 非法 phaseId / acctMonth → 进 errors 跳过,不抛 ──
    @Test
    void import_invalidRows_skipped() throws Exception {
        mvc.perform(post("/api/pv/import").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":["
                        + "{\"phaseId\":\"p9\",\"acctMonth\":\"2098-01\",\"selfKwh\":1},"
                        + "{\"phaseId\":\"p1\",\"acctMonth\":\"1999-01\",\"selfKwh\":1},"
                        + "{\"phaseId\":\"p1\",\"acctMonth\":\"2024-13\",\"selfKwh\":1}"
                        + "]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.imported").value(0))
                .andExpect(jsonPath("$.data.skipped").value(3));
    }

    @Test
    void import_withoutToken_returns401() throws Exception {
        mvc.perform(post("/api/pv/import")
                .contentType("application/json").content("{\"rows\":[]}"))
                .andExpect(status().isUnauthorized());
    }
}

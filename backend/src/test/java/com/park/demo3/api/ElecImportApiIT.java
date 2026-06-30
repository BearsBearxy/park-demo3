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

// @Transactional:导入写入多期多年、替换共享种子(期,月),事务回滚还原,避免污染 overview 确定性年份范围与同库其它读测试。
@AutoConfigureMockMvc
@Transactional
class ElecImportApiIT extends AbstractMysqlIT {

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

    // ── 一(记账期,期)多 energy + 1 basic;跨年(无种子年 2096/2097);派生不入库;非法行跳过 ──
    @Test
    void import_multiEnergyPlusBasic_crossYear_derivedNotStored_skipsInvalid() throws Exception {
        // p1/2096-01:大工业 energy + basic、居民 energy、商业 energy(同(期,月)整体)
        // p2/2096-01:大工业 energy + basic
        // p1/2097-01:大工业 energy + basic
        // 三行非法:type / phaseId / acctMonth 各一
        String body = "{\"rows\":["
                + "{\"type\":\"energy\",\"phaseId\":\"p1\",\"acctMonth\":\"2096-01\",\"invDate\":\"2095-12-09\",\"cat\":\"大工业用电\",\"unit\":\"千瓦时\",\"qty\":203280,\"price\":0.735342,\"rate\":0.13},"
                + "{\"type\":\"basic\",\"phaseId\":\"p1\",\"acctMonth\":\"2096-01\",\"demand\":1029.6,\"price\":36.1,\"rate\":0.13},"
                + "{\"type\":\"energy\",\"phaseId\":\"p1\",\"acctMonth\":\"2096-01\",\"cat\":\"居民生活\",\"unit\":\"千瓦时\",\"qty\":137595,\"price\":0.562716,\"rate\":0.13},"
                + "{\"type\":\"energy\",\"phaseId\":\"p1\",\"acctMonth\":\"2096-01\",\"cat\":\"商业\",\"unit\":\"千瓦时\",\"qty\":42405,\"price\":0.605644,\"rate\":0.13},"
                + "{\"type\":\"energy\",\"phaseId\":\"p2\",\"acctMonth\":\"2096-01\",\"cat\":\"大工业用电\",\"unit\":\"千瓦时\",\"qty\":585120,\"price\":0.728420,\"rate\":0.13},"
                + "{\"type\":\"basic\",\"phaseId\":\"p2\",\"acctMonth\":\"2096-01\",\"demand\":1666.8,\"price\":36.1,\"rate\":0.13},"
                + "{\"type\":\"energy\",\"phaseId\":\"p1\",\"acctMonth\":\"2097-01\",\"cat\":\"大工业用电\",\"unit\":\"千瓦时\",\"qty\":101494.67,\"price\":1.13,\"rate\":0.13},"
                + "{\"type\":\"basic\",\"phaseId\":\"p1\",\"acctMonth\":\"2097-01\",\"demand\":1008,\"price\":36.1,\"rate\":0.13},"
                + "{\"type\":\"bogus\",\"phaseId\":\"p1\",\"acctMonth\":\"2096-01\"},"
                + "{\"type\":\"energy\",\"phaseId\":\"pX\",\"acctMonth\":\"2096-01\"},"
                + "{\"type\":\"energy\",\"phaseId\":\"p1\",\"acctMonth\":\"2096-13\"}"
                + "]}";
        String res = utf8(mvc.perform(post("/api/elec/import").header("Authorization", auth())
                .contentType("application/json").content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.imported").value(8))
                .andExpect(jsonPath("$.data.skipped").value(3))
                .andReturn());
        List<Integer> badIdx = JsonPath.read(res, "$.data.errors[*].rowIndex");
        assertThat(badIdx).containsExactly(8, 9, 10);

        // 2096 energy:p1 三条(大工业/居民/商业) + p2 一条 = 4;按 acct 升序 + id
        String e96 = utf8(mvc.perform(get("/api/elec/records")
                .param("year", "2096").param("type", "energy").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.rows.length()").value(4))
                .andReturn());
        // p1/2096-01 大工业 energy:派生 amount=qty×price(price 存 6dp:203280×0.735342=149480.32;
        // 与文件满精度 149480.36 差几分属 price 6dp 截断,模型按存储精度派生)、source=import、period 空
        mvc.perform(get("/api/elec/records").param("year", "2096").param("type", "energy").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows[?(@.phase=='p1' && @.cat=='大工业用电' && @.source=='import' && @.amount==149480.32)]").isNotEmpty())
                .andExpect(jsonPath("$.data.rows[?(@.phase=='p1' && @.cat=='大工业用电' && @.period==null)]").isNotEmpty());

        // 2096 basic:p1 + p2 = 2;basic 派生 amount=demand×price(p1:1029.6×36.1=37168.56)
        mvc.perform(get("/api/elec/records").param("year", "2096").param("type", "basic").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows.length()").value(2))
                .andExpect(jsonPath("$.data.rows[?(@.phase=='p1' && @.demand==1029.6 && @.amount==37168.56)]").isNotEmpty());

        // 2097 energy(p1 大工业 1) + basic(p1 1)
        mvc.perform(get("/api/elec/records").param("year", "2097").param("type", "energy").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows.length()").value(1))
                .andExpect(jsonPath("$.data.rows[0].acctMonth").value("2097-01"));
        mvc.perform(get("/api/elec/records").param("year", "2097").param("type", "basic").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows.length()").value(1));

        assertThat(e96).contains("大工业用电");

        // ── 重导(p1/2096-01 整月整期替换:只剩 1 energy + 1 basic,居民/商业被清)；p2 与 2097 不动 ──
        mvc.perform(post("/api/elec/import").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":["
                        + "{\"type\":\"energy\",\"phaseId\":\"p1\",\"acctMonth\":\"2096-01\",\"cat\":\"大工业用电\",\"unit\":\"度\",\"qty\":9999,\"price\":1,\"rate\":0.13},"
                        + "{\"type\":\"basic\",\"phaseId\":\"p1\",\"acctMonth\":\"2096-01\",\"demand\":500,\"price\":36.1,\"rate\":0.13}]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.imported").value(2));
        // p1/2096 energy 现仅 1 条(居民/商业被整月替换清掉);值=9999。
        // 过滤数组计数用 JsonPath.read+hasSize(不用 [?()].length(),后者在过滤数组上不可靠,见 IMPORT-GUIDE 铁律)
        String e96b = utf8(mvc.perform(get("/api/elec/records").param("year", "2096").param("type", "energy").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows[?(@.phase=='p1' && @.qty==9999)]").isNotEmpty())
                // p2 未被触及,仍在
                .andExpect(jsonPath("$.data.rows[?(@.phase=='p2' && @.cat=='大工业用电')]").isNotEmpty())
                .andReturn());
        assertThat((List<?>) JsonPath.read(e96b, "$.data.rows[?(@.phase=='p1')]")).hasSize(1);
        // 2097 未被触及
        mvc.perform(get("/api/elec/records").param("year", "2097").param("type", "energy").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows.length()").value(1));
    }

    // ── 导入种子(期,月)→ 整月整期 upsert 覆盖种子(p1/2025-01 本有种子 energy+basic;@Transactional 回滚还原) ──
    @Test
    void import_replacesSeedPhaseMonth() throws Exception {
        mvc.perform(post("/api/elec/import").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":["
                        + "{\"type\":\"energy\",\"phaseId\":\"p1\",\"acctMonth\":\"2025-01\",\"cat\":\"大工业用电\",\"unit\":\"度\",\"qty\":12345,\"price\":1,\"rate\":0.13},"
                        + "{\"type\":\"basic\",\"phaseId\":\"p1\",\"acctMonth\":\"2025-01\",\"demand\":1000,\"price\":36.1,\"rate\":0.13}]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.imported").value(2))
                .andExpect(jsonPath("$.data.errors.length()").value(0));
        // p1/2025-01 energy 现为导入单条(种子多条被整月清掉),source=import。
        // 过滤数组计数用 JsonPath.read+hasSize(不用 [?()].length(),后者在过滤数组上不可靠)
        String e25 = utf8(mvc.perform(get("/api/elec/records").param("year", "2025").param("type", "energy").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows[?(@.phase=='p1' && @.acctMonth=='2025-01' && @.source=='import' && @.qty==12345)]").isNotEmpty())
                .andExpect(jsonPath("$.data.rows[?(@.phase=='p1' && @.acctMonth=='2025-01' && @.source=='seed')]").isEmpty())
                .andReturn());
        assertThat((List<?>) JsonPath.read(e25, "$.data.rows[?(@.phase=='p1' && @.acctMonth=='2025-01')]")).hasSize(1);
    }

    // ── 非法 type/phaseId/acctMonth → 进 errors 跳过,不抛 ──
    @Test
    void import_invalidRows_skipped() throws Exception {
        mvc.perform(post("/api/elec/import").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":["
                        + "{\"type\":\"x\",\"phaseId\":\"p1\",\"acctMonth\":\"2098-01\"},"
                        + "{\"type\":\"energy\",\"phaseId\":\"p9\",\"acctMonth\":\"2098-01\"},"
                        + "{\"type\":\"energy\",\"phaseId\":\"p1\",\"acctMonth\":\"1999-01\"}"
                        + "]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.imported").value(0))
                .andExpect(jsonPath("$.data.skipped").value(3));
    }

    @Test
    void import_withoutToken_returns401() throws Exception {
        mvc.perform(post("/api/elec/import")
                .contentType("application/json").content("{\"rows\":[]}"))
                .andExpect(status().isUnauthorized());
    }
}

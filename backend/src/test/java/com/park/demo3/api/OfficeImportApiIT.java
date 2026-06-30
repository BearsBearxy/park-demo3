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

// @Transactional:导入用例写入多年记录,事务回滚还原,避免污染 overview 的确定性年份范围与同库其它测试。
@AutoConfigureMockMvc
@Transactional
class OfficeImportApiIT extends AbstractMysqlIT {

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

    // ── 跨年(2096+2097 同次导入各落各年;选无种子年避免与 seed 混)+ acctMonth 行驱动 + belongMonth 分离 + source=import + 重导;手动行保留 ──
    @Test
    void import_crossYear_acctMonthDriven_belongSeparate_replaceSemantics() throws Exception {
        // 干净 slot:先放一行 manual(2099-08,跨年导入不应波及)。
        mvc.perform(post("/api/utilities/13/records").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"scheduleNo\":13,\"acctMonth\":\"2099-08\",\"belongMonth\":\"2099-08\","
                        + "\"elecQty\":100,\"elecPrice\":0.8,\"waterQty\":10,\"waterPrice\":4}"))
                .andExpect(status().isOk());

        // 跨 2096+2097 各两行 + belongMonth=上月 + 一行非法 acctMonth(空) + 一行非法(乱码)
        String body = "{\"rows\":["
                + "{\"acctMonth\":\"2096-01\",\"belongMonth\":\"2095-12\",\"elecQty\":1284.8,\"elecPrice\":0.79406875},"
                + "{\"acctMonth\":\"2096-02\",\"belongMonth\":\"2096-01\",\"elecQty\":1362,\"elecPrice\":0.77556875},"
                + "{\"acctMonth\":\"2097-01\",\"belongMonth\":\"2096-12\",\"elecQty\":1177.2,\"elecPrice\":0.77496875},"
                + "{\"acctMonth\":\"2097-02\",\"belongMonth\":\"2097-01\",\"elecQty\":1618.4,\"elecPrice\":0.78076875},"
                + "{\"acctMonth\":\"\",\"elecQty\":9},"
                + "{\"acctMonth\":\"abc\",\"elecQty\":9}"
                + "]}";
        String res = utf8(mvc.perform(post("/api/utilities/13/import").header("Authorization", auth())
                .contentType("application/json").content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.imported").value(4))
                .andExpect(jsonPath("$.data.skipped").value(2))
                .andReturn());
        // 两条非法行 rowIndex=4,5
        List<Integer> badIdx = JsonPath.read(res, "$.data.errors[*].rowIndex");
        assertThat(badIdx).containsExactly(4, 5);

        // 读回 2096:2 行(import 01/02);belongMonth 分离、source=import
        String y2096 = utf8(mvc.perform(get("/api/utilities/13/records").param("year", "2096")
                .header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.rows.length()").value(2))
                .andReturn());
        List<String> m96 = JsonPath.read(y2096, "$.data.rows[*].acctMonth");
        assertThat(m96).containsExactly("2096-01", "2096-02");
        mvc.perform(get("/api/utilities/13/records").param("year", "2096").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows[?(@.acctMonth=='2096-01' && @.source=='import' && @.belongMonth=='2095-12')]").isNotEmpty());

        // 读回 2097:2 行(import 01/02) + manual 08 不在 2097;manual 在 2099 不动
        String y2097 = utf8(mvc.perform(get("/api/utilities/13/records").param("year", "2097")
                .header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.rows.length()").value(2))
                .andReturn());
        List<String> m97 = JsonPath.read(y2097, "$.data.rows[*].acctMonth");
        assertThat(m97).containsExactly("2097-01", "2097-02");
        mvc.perform(get("/api/utilities/13/records").param("year", "2099").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows.length()").value(1))
                .andExpect(jsonPath("$.data.rows[0].acctMonth").value("2099-08"))
                .andExpect(jsonPath("$.data.rows[0].source").value("manual"));

        // 派生电费金额:elecAmt=elecQty×elecPrice(下发算好,行体未导金额)
        mvc.perform(get("/api/utilities/13/records").param("year", "2096").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows[?(@.acctMonth=='2096-01' && @.elecAmt==1020.22)]").isNotEmpty());

        // 重导(2096-01 改值 + 2096-05 新月)→ 按月 upsert:2096-01 替换、2096-02 留、2096-05 新增;2097 不受影响
        mvc.perform(post("/api/utilities/13/import").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":["
                        + "{\"acctMonth\":\"2096-01\",\"elecQty\":9999,\"elecPrice\":0.78},"
                        + "{\"acctMonth\":\"2096-05\",\"elecQty\":1416.8,\"elecPrice\":0.78}]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.imported").value(2));
        String after96 = utf8(mvc.perform(get("/api/utilities/13/records").param("year", "2096")
                .header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.rows.length()").value(3))   // 01(替换)/02(留)/05(新)
                .andReturn());
        assertThat((List<String>) JsonPath.read(after96, "$.data.rows[*].acctMonth"))
                .containsExactly("2096-01", "2096-02", "2096-05");
        // 2096-01 被替换为新值(uk 唯一,仍单行)
        mvc.perform(get("/api/utilities/13/records").param("year", "2096").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows[?(@.acctMonth=='2096-01' && @.elecQty==9999)]").isNotEmpty());
        // 2097 未被触及,仍 2 行
        mvc.perform(get("/api/utilities/13/records").param("year", "2097").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows.length()").value(2));
    }

    // ── 导入种子月 → 按月 upsert 覆盖种子(不再 uk_office 唯一键冲突;@Transactional 回滚还原种子) ──
    @Test
    void import_replacesSeedMonth() throws Exception {
        // 13/2025-01 本有种子;导入该月 → 覆盖为 import,该月仍单行(uk),值=导入值
        mvc.perform(post("/api/utilities/13/import").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":[{\"acctMonth\":\"2025-01\",\"belongMonth\":\"2024-12\","
                        + "\"elecQty\":1177.2,\"elecPrice\":0.77496875}]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.imported").value(1))
                .andExpect(jsonPath("$.data.errors.length()").value(0));
        // 该月覆盖为 import 新值(uk_office 保证单行,无重复键冲突)
        mvc.perform(get("/api/utilities/13/records").param("year", "2025").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows[?(@.acctMonth=='2025-01' && @.source=='import' && @.elecQty==1177.2)]").isNotEmpty())
                .andExpect(jsonPath("$.data.rows[?(@.acctMonth=='2025-01' && @.source=='seed')]").isEmpty());
    }

    // ── belongMonth 缺省 = acctMonth ──
    @Test
    void import_belongMonthDefaultsToAcct() throws Exception {
        mvc.perform(post("/api/utilities/13/import").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":[{\"acctMonth\":\"2098-06\",\"elecQty\":500,\"elecPrice\":0.8}]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.imported").value(1));
        mvc.perform(get("/api/utilities/13/records").param("year", "2098").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows[0].acctMonth").value("2098-06"))
                .andExpect(jsonPath("$.data.rows[0].belongMonth").value("2098-06"));
    }

    // ── 非法 acctMonth(越界年/月)→ 进 errors 跳过,不抛 ──
    @Test
    void import_invalidAcctMonth_skipped() throws Exception {
        mvc.perform(post("/api/utilities/13/import").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":["
                        + "{\"acctMonth\":\"1999-01\",\"elecQty\":1},"
                        + "{\"acctMonth\":\"2024-13\",\"elecQty\":1}"
                        + "]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.imported").value(0))
                .andExpect(jsonPath("$.data.skipped").value(2));
    }

    // ── scheduleNo 非白名单 → 404(code in body) ──
    @Test
    void import_badScheduleNo_returns404InBody() throws Exception {
        mvc.perform(post("/api/utilities/99/import").header("Authorization", auth())
                .contentType("application/json").content("{\"rows\":[]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(404));
    }

    @Test
    void import_withoutToken_returns401() throws Exception {
        mvc.perform(post("/api/utilities/13/import")
                .contentType("application/json").content("{\"rows\":[]}"))
                .andExpect(status().isUnauthorized());
    }
}

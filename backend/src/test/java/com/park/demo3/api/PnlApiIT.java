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
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// 每用例独占 (schedule,year):save→s2、import→s4、overview 无数据→s5、种子→s1,互不干扰
@AutoConfigureMockMvc
class PnlApiIT extends AbstractMysqlIT {

    @Autowired MockMvc mvc;
    private String token;

    @BeforeEach
    void login() throws Exception {
        String body = mvc.perform(post("/api/auth/login").contentType("application/json")
                .content("{\"username\":\"admin\",\"password\":\"admin123\"}"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        token = JsonPath.read(body, "$.data.token");
    }
    private String auth() { return "Bearer " + token; }
    private static String utf8(MvcResult r) {
        return new String(r.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
    }
    private static final String NULLS_10 = "null,null,null,null,null,null,null,null,null,null";
    private static final String M_ALL_NULL = "[null,null," + NULLS_10 + "]";   // 12 个 null

    // ── PUT 2 行(含 null 月/备注/kind) → GET 读回序+值;重存 1 行覆盖(clear+insert) ──
    @Test
    void pnl_saveYear_readBack_thenOverwrite() throws Exception {
        String saveBody = "{\"rows\":["
                + "{\"groupLabel\":\"一期、宿舍\",\"label\":\"测试收入A\",\"kind\":\"detail\",\"note\":\"备注X\","
                + "\"m\":[100.5," + NULLS_10 + ",12.25],\"sortOrder\":0},"
                + "{\"groupLabel\":\"\",\"label\":\"测试收入小计\",\"kind\":null,\"note\":\"\","
                + "\"m\":" + M_ALL_NULL + ",\"sortOrder\":1}"
                + "]}";
        mvc.perform(put("/api/pnl/s2/2025").header("Authorization", auth())
                .contentType("application/json").content(saveBody))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0));

        String res = utf8(mvc.perform(get("/api/pnl/s2/2025").header("Authorization", auth()))
                .andExpect(status().isOk()).andReturn());
        // 序:row_key 服务端按行序合成 r1/r2
        assertThat(JsonPath.<List<String>>read(res, "$.data.rows[*].rowKey")).containsExactly("r1", "r2");
        assertThat((String) JsonPath.read(res, "$.data.rows[0].label")).isEqualTo("测试收入A");
        assertThat((String) JsonPath.read(res, "$.data.rows[0].note")).isEqualTo("备注X");
        assertThat(((Number) JsonPath.read(res, "$.data.rows[0].m[0]")).doubleValue()).isEqualTo(100.5);
        assertThat((Object) JsonPath.read(res, "$.data.rows[0].m[1]")).isNull();       // NULL=未录保留
        assertThat(((Number) JsonPath.read(res, "$.data.rows[0].m[11]")).doubleValue()).isEqualTo(12.25);
        // kind 缺省 → 服务端按标签识别(含「小计」→subtotal);空备注 → null
        assertThat((String) JsonPath.read(res, "$.data.rows[1].kind")).isEqualTo("subtotal");
        assertThat((Object) JsonPath.read(res, "$.data.rows[1].note")).isNull();

        // 重存 1 行 → 覆盖(clear+insert)
        mvc.perform(put("/api/pnl/s2/2025").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":[{\"groupLabel\":\"g\",\"label\":\"仅剩一行\",\"kind\":\"detail\",\"note\":null,"
                        + "\"m\":" + M_ALL_NULL + ",\"sortOrder\":0}]}"))
                .andExpect(status().isOk());
        String res2 = utf8(mvc.perform(get("/api/pnl/s2/2025").header("Authorization", auth()))
                .andExpect(status().isOk()).andReturn());
        assertThat(JsonPath.<List<String>>read(res2, "$.data.rows[*].label")).containsExactly("仅剩一行");
        assertThat(JsonPath.<List<String>>read(res2, "$.data.rows[*].rowKey")).containsExactly("r1");
    }

    // ── POST import 2 行 → imported=2;再 import 1 行 → 整 (schedule,year) clear+insert 只剩 1 行 ──
    @Test
    void pnl_import_clearInsert() throws Exception {
        String importBody = "{\"rows\":["
                + "{\"groupLabel\":\"项目A\",\"label\":\"导入行1\",\"kind\":null,\"note\":null,"
                + "\"m\":[1,null," + NULLS_10 + "],\"sortOrder\":0},"
                + "{\"groupLabel\":\"项目A\",\"label\":\"导入行合计\",\"kind\":null,\"note\":null,"
                + "\"m\":[1,null," + NULLS_10 + "],\"sortOrder\":1}"
                + "]}";
        mvc.perform(post("/api/pnl/s4/import").param("year", "2025")
                .header("Authorization", auth()).contentType("application/json").content(importBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.imported").value(2));

        String res = utf8(mvc.perform(get("/api/pnl/s4/2025").header("Authorization", auth()))
                .andExpect(status().isOk()).andReturn());
        assertThat(JsonPath.<List<String>>read(res, "$.data.rows[*].label")).containsExactly("导入行1", "导入行合计");
        assertThat((String) JsonPath.read(res, "$.data.rows[1].kind")).isEqualTo("total");

        // 再导 1 行 → 覆盖
        mvc.perform(post("/api/pnl/s4/import").param("year", "2025")
                .header("Authorization", auth()).contentType("application/json")
                .content("{\"rows\":[{\"groupLabel\":\"项目B\",\"label\":\"二次导入\",\"kind\":null,\"note\":null,"
                        + "\"m\":[2,null," + NULLS_10 + "],\"sortOrder\":0}]}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.imported").value(1));
        String res2 = utf8(mvc.perform(get("/api/pnl/s4/2025").header("Authorization", auth()))
                .andExpect(status().isOk()).andReturn());
        assertThat(JsonPath.<List<String>>read(res2, "$.data.rows[*].label")).containsExactly("二次导入");
    }

    // ── overview 确定性年范围:s1 有 V27 种子(2025) → [2024..2026];s5 无数据 → [2024..2025] ──
    @Test
    void pnl_overview_deterministicYears() throws Exception {
        String s1 = utf8(mvc.perform(get("/api/pnl/s1/overview").header("Authorization", auth()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0)).andReturn());
        assertThat(JsonPath.<List<Integer>>read(s1, "$.data.years[*].year")).containsExactly(2024, 2025, 2026);
        assertThat((Boolean) JsonPath.read(s1, "$.data.years[1].hasData")).isTrue();
        assertThat(((Number) JsonPath.read(s1, "$.data.years[1].rowCount")).intValue()).isEqualTo(4);
        assertThat((Boolean) JsonPath.read(s1, "$.data.years[0].hasData")).isFalse();
        assertThat((Boolean) JsonPath.read(s1, "$.data.years[2].hasData")).isFalse();

        String s5 = utf8(mvc.perform(get("/api/pnl/s5/overview").header("Authorization", auth()))
                .andExpect(status().isOk()).andReturn());
        assertThat(JsonPath.<List<Integer>>read(s5, "$.data.years[*].year")).containsExactly(2024, 2025);
        assertThat(JsonPath.<List<Boolean>>read(s5, "$.data.years[*].hasData")).containsExactly(false, false);
    }

    // ── V27 种子可读:s1 2025 首行 一期租金收入 m1=1141774.45;分带 kind 逐行对 ──
    @Test
    void pnl_seed_readable() throws Exception {
        String res = utf8(mvc.perform(get("/api/pnl/s1/2025").header("Authorization", auth()))
                .andExpect(status().isOk()).andReturn());
        assertThat(JsonPath.<List<String>>read(res, "$.data.rows[*].rowKey"))
                .containsExactly("r1", "r2", "r3", "r4");
        assertThat((String) JsonPath.read(res, "$.data.rows[0].label")).isEqualTo("一期租金收入");
        assertThat((String) JsonPath.read(res, "$.data.rows[0].groupLabel")).isEqualTo("一期、宿舍");
        assertThat(((Number) JsonPath.read(res, "$.data.rows[0].m[0]")).doubleValue()).isEqualTo(1141774.45);
        assertThat(((Number) JsonPath.read(res, "$.data.rows[0].m[11]")).doubleValue()).isEqualTo(1135794.49);
        assertThat(JsonPath.<List<String>>read(res, "$.data.rows[*].kind"))
                .containsExactly("detail", "detail", "subtotal", "pnl");
        assertThat(((Number) JsonPath.read(res, "$.data.rows[3].m[0]")).doubleValue()).isEqualTo(156121.32);
    }

    // ── 非法 schedule 's9' → 体内 code 400(HTTP 200) ──
    @Test
    void illegalSchedule_s9_400() throws Exception {
        mvc.perform(get("/api/pnl/s9/overview").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(400));
    }

    // ── 无 token → 401 ──
    @Test
    void noToken_401() throws Exception {
        mvc.perform(get("/api/pnl/s1/overview")).andExpect(status().isUnauthorized());
    }
}

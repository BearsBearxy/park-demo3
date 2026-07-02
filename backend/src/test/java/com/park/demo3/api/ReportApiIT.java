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
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@AutoConfigureMockMvc
class ReportApiIT extends AbstractMysqlIT {

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

    // ── PUT 保存三行 → GET 读回 amounts 对(含小计不落库=只回叶子) ──
    @Test
    void save_thenReadBack_amountsMatch() throws Exception {
        String saveBody = "{\"cells\":["
                + "{\"rowKey\":\"1\",\"field\":\"cur\",\"amount\":1000},"
                + "{\"rowKey\":\"1\",\"field\":\"ytd\",\"amount\":9000},"
                + "{\"rowKey\":\"2\",\"field\":\"cur\",\"amount\":300}"
                + "]}";
        mvc.perform(put("/api/reports/is/1/2025/10").header("Authorization", auth())
                .contentType("application/json").content(saveBody))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0));

        String res = utf8(mvc.perform(get("/api/reports/is/1/2025/10").header("Authorization", auth()))
                .andExpect(status().isOk()).andReturn());
        assertThat(((Number) JsonPath.read(res, "$.data.amounts.1.cur")).doubleValue()).isEqualTo(1000.0);
        assertThat(((Number) JsonPath.read(res, "$.data.amounts.1.ytd")).doubleValue()).isEqualTo(9000.0);
        assertThat(((Number) JsonPath.read(res, "$.data.amounts.2.cur")).doubleValue()).isEqualTo(300.0);

        // 重存(clear+insert) 覆盖:只剩 row 5
        mvc.perform(put("/api/reports/is/1/2025/10").header("Authorization", auth())
                .contentType("application/json").content("{\"cells\":[{\"rowKey\":\"5\",\"field\":\"cur\",\"amount\":42}]}"))
                .andExpect(status().isOk());
        String res2 = utf8(mvc.perform(get("/api/reports/is/1/2025/10").header("Authorization", auth()))
                .andExpect(status().isOk()).andReturn());
        assertThat(((Number) JsonPath.read(res2, "$.data.amounts.5.cur")).doubleValue()).isEqualTo(42.0);
    }

    // ── GET all/2025/11 跨公司求和(公司1+公司2 同 rowKey/field) ──
    @Test
    void allPeriod_sumsAcrossCompanies() throws Exception {
        mvc.perform(put("/api/reports/is/1/2025/11").header("Authorization", auth())
                .contentType("application/json").content("{\"cells\":[{\"rowKey\":\"1\",\"field\":\"cur\",\"amount\":100}]}"))
                .andExpect(status().isOk());
        mvc.perform(put("/api/reports/is/2/2025/11").header("Authorization", auth())
                .contentType("application/json").content("{\"cells\":[{\"rowKey\":\"1\",\"field\":\"cur\",\"amount\":250}]}"))
                .andExpect(status().isOk());
        String res = utf8(mvc.perform(get("/api/reports/is/all/2025/11").header("Authorization", auth()))
                .andExpect(status().isOk()).andReturn());
        assertThat(((Number) JsonPath.read(res, "$.data.amounts.1.cur")).doubleValue()).isEqualTo(350.0);
    }

    // ── POST custom-row → GET period 见该行 → DELETE 级联(父+子一起没) ──
    @Test
    void customRow_add_seen_thenDeleteCascades() throws Exception {
        String parentRes = utf8(mvc.perform(post("/api/reports/is/1/custom-row").header("Authorization", auth())
                .param("parentKey", "3").param("label", "自定义税A").param("level", "1"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0)).andReturn());
        String parentKey = JsonPath.read(parentRes, "$.data.rowKey");
        Number parentId = JsonPath.read(parentRes, "$.data.id");

        // 子行挂到父自定义行下
        mvc.perform(post("/api/reports/is/1/custom-row").header("Authorization", auth())
                .param("parentKey", parentKey).param("label", "自定义税A-子").param("level", "2"))
                .andExpect(status().isOk());

        // GET period 见这两行
        String p = utf8(mvc.perform(get("/api/reports/is/1/2025/10").header("Authorization", auth()))
                .andExpect(status().isOk()).andReturn());
        assertThat(JsonPath.<List<?>>read(p, "$.data.customRows[?(@.label=='自定义税A')]")).isNotEmpty();
        assertThat(JsonPath.<List<?>>read(p, "$.data.customRows[?(@.label=='自定义税A-子')]")).isNotEmpty();

        // DELETE 父 → 级联删子
        mvc.perform(delete("/api/reports/is/custom-row/" + parentId.longValue()).header("Authorization", auth()))
                .andExpect(status().isOk());
        String after = utf8(mvc.perform(get("/api/reports/is/1/2025/10").header("Authorization", auth()))
                .andExpect(status().isOk()).andReturn());
        assertThat(JsonPath.<List<?>>read(after, "$.data.customRows[?(@.label=='自定义税A')]")).isEmpty();
        assertThat(JsonPath.<List<?>>read(after, "$.data.customRows[?(@.label=='自定义税A-子')]")).isEmpty();
    }

    // ── POST import 两公司(一个新公司名) → 新公司自动建 + 本期落值 ──
    @Test
    void import_matchesExisting_autoCreatesNew_andWritesPeriod() throws Exception {
        String importBody = "{\"sections\":["
                + "{\"companyName\":\"园区租赁管理公司\",\"cells\":[{\"rowKey\":\"1\",\"field\":\"cur\",\"amount\":500}]},"
                + "{\"companyName\":\"某全新导入公司IT\",\"cells\":["
                + "{\"rowKey\":\"1\",\"field\":\"cur\",\"amount\":700},"
                + "{\"rowKey\":\"1\",\"field\":\"ytd\",\"amount\":7000}]}"
                + "]}";
        mvc.perform(post("/api/reports/is/import").param("year", "2025").param("month", "12")
                .header("Authorization", auth()).contentType("application/json").content(importBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.imported").value(3));

        // 新公司出现在公司列表
        String companies = utf8(mvc.perform(get("/api/companies").header("Authorization", auth()))
                .andExpect(status().isOk()).andReturn());
        assertThat(JsonPath.<List<?>>read(companies, "$.data[?(@.name=='某全新导入公司IT')]")).isNotEmpty();
        int newId = ((Number) JsonPath.<List<Object>>read(companies, "$.data[?(@.name=='某全新导入公司IT')].id").get(0)).intValue();

        // 新公司本期落值
        String p = utf8(mvc.perform(get("/api/reports/is/" + newId + "/2025/12").header("Authorization", auth()))
                .andExpect(status().isOk()).andReturn());
        assertThat(((Number) JsonPath.read(p, "$.data.amounts.1.cur")).doubleValue()).isEqualTo(700.0);
        assertThat(((Number) JsonPath.read(p, "$.data.amounts.1.ytd")).doubleValue()).isEqualTo(7000.0);
    }

    // ── 非法 statement 'xx' → 体内 code 400(HTTP 200);'bs'/'tb' 已合法(见 bs_*/tb_* 用例) ──
    @Test
    void illegalStatement_returns400InBody() throws Exception {
        mvc.perform(get("/api/reports/xx/1/2025/10").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(400));
    }

    // ── bs: PUT 保存 field='end' → GET 读回 → 重存覆盖(clear+insert) ──
    @Test
    void bs_saveAndRead_endField() throws Exception {
        mvc.perform(put("/api/reports/bs/1/2025/10").header("Authorization", auth())
                .contentType("application/json").content("{\"cells\":[{\"rowKey\":\"1\",\"field\":\"end\",\"amount\":1000}]}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0));
        String res = utf8(mvc.perform(get("/api/reports/bs/1/2025/10").header("Authorization", auth()))
                .andExpect(status().isOk()).andReturn());
        assertThat(((Number) JsonPath.read(res, "$.data.amounts.1.end")).doubleValue()).isEqualTo(1000.0);

        // 重存(clear+insert) 覆盖:只剩 row 31
        mvc.perform(put("/api/reports/bs/1/2025/10").header("Authorization", auth())
                .contentType("application/json").content("{\"cells\":[{\"rowKey\":\"31\",\"field\":\"end\",\"amount\":42}]}"))
                .andExpect(status().isOk());
        String res2 = utf8(mvc.perform(get("/api/reports/bs/1/2025/10").header("Authorization", auth()))
                .andExpect(status().isOk()).andReturn());
        assertThat(((Number) JsonPath.read(res2, "$.data.amounts.31.end")).doubleValue()).isEqualTo(42.0);
        assertThat(JsonPath.<Map<String, ?>>read(res2, "$.data.amounts")).doesNotContainKey("1");
    }

    // ── bs: V23 种子可读(公司1 2025-09 期末余额) ──
    @Test
    void bs_seed_readable() throws Exception {
        String res = utf8(mvc.perform(get("/api/reports/bs/1/2025/9").header("Authorization", auth()))
                .andExpect(status().isOk()).andReturn());
        assertThat(((Number) JsonPath.read(res, "$.data.amounts.1.end")).doubleValue()).isEqualTo(292259.39);
        assertThat(((Number) JsonPath.read(res, "$.data.amounts.48.end")).doubleValue()).isEqualTo(20000000.00);
    }

    // ── tb: PUT 科目树+8字段金额 → GET 读回树序+amounts → 重存覆盖(树与金额同期 clear+insert) ──
    @Test
    void tb_saveTreeAndAmounts_readBack() throws Exception {
        String saveBody = "{\"accounts\":["
                + "{\"rowKey\":\"1001\",\"parentKey\":null,\"code\":\"1001\",\"label\":\"库存现金\",\"level\":0,\"sortOrder\":0},"
                + "{\"rowKey\":\"1002\",\"parentKey\":null,\"code\":\"1002\",\"label\":\"银行存款\",\"level\":0,\"sortOrder\":1},"
                + "{\"rowKey\":\"r3\",\"parentKey\":\"1002\",\"code\":null,\"label\":\"农商行\",\"level\":1,\"sortOrder\":2}"
                + "],\"cells\":["
                + "{\"rowKey\":\"1001\",\"field\":\"openDr\",\"amount\":1},"
                + "{\"rowKey\":\"1001\",\"field\":\"openCr\",\"amount\":2},"
                + "{\"rowKey\":\"1001\",\"field\":\"periodDr\",\"amount\":3},"
                + "{\"rowKey\":\"1001\",\"field\":\"periodCr\",\"amount\":4},"
                + "{\"rowKey\":\"1001\",\"field\":\"ytdDr\",\"amount\":5},"
                + "{\"rowKey\":\"1001\",\"field\":\"ytdCr\",\"amount\":6},"
                + "{\"rowKey\":\"1001\",\"field\":\"endDr\",\"amount\":7},"
                + "{\"rowKey\":\"1001\",\"field\":\"endCr\",\"amount\":8}"
                + "]}";
        mvc.perform(put("/api/reports/tb/1/2025/10").header("Authorization", auth())
                .contentType("application/json").content(saveBody))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0));

        String res = utf8(mvc.perform(get("/api/reports/tb/1/2025/10").header("Authorization", auth()))
                .andExpect(status().isOk()).andReturn());
        // 树按 sort_order 读回
        assertThat(JsonPath.<List<String>>read(res, "$.data.accounts[*].rowKey"))
                .containsExactly("1001", "1002", "r3");
        assertThat((String) JsonPath.read(res, "$.data.accounts[2].parentKey")).isEqualTo("1002");
        assertThat(((Number) JsonPath.read(res, "$.data.accounts[2].level")).intValue()).isEqualTo(1);
        // 8 金额字段读回
        assertThat(((Number) JsonPath.read(res, "$.data.amounts.1001.openDr")).doubleValue()).isEqualTo(1.0);
        assertThat(((Number) JsonPath.read(res, "$.data.amounts.1001.periodCr")).doubleValue()).isEqualTo(4.0);
        assertThat(((Number) JsonPath.read(res, "$.data.amounts.1001.endCr")).doubleValue()).isEqualTo(8.0);

        // 重存(整期 clear+insert):树与金额都只剩新内容
        mvc.perform(put("/api/reports/tb/1/2025/10").header("Authorization", auth())
                .contentType("application/json").content("{\"accounts\":["
                        + "{\"rowKey\":\"2001\",\"parentKey\":null,\"code\":\"2001\",\"label\":\"短期借款\",\"level\":0,\"sortOrder\":0}"
                        + "],\"cells\":[{\"rowKey\":\"2001\",\"field\":\"endCr\",\"amount\":42}]}"))
                .andExpect(status().isOk());
        String res2 = utf8(mvc.perform(get("/api/reports/tb/1/2025/10").header("Authorization", auth()))
                .andExpect(status().isOk()).andReturn());
        assertThat(JsonPath.<List<String>>read(res2, "$.data.accounts[*].rowKey")).containsExactly("2001");
        assertThat(((Number) JsonPath.read(res2, "$.data.amounts.2001.endCr")).doubleValue()).isEqualTo(42.0);
        assertThat(JsonPath.<Map<String, ?>>read(res2, "$.data.amounts")).doesNotContainKey("1001");
    }

    // ── tb: POST import 段带 accounts+cells → 自动建公司 + 科目树与金额双写 ──
    @Test
    void tb_import_writesAccountsAndAmounts_autoCreatesCompany() throws Exception {
        String importBody = "{\"sections\":[{\"companyName\":\"某全新TB公司IT\",\"accounts\":["
                + "{\"rowKey\":\"1002\",\"parentKey\":null,\"code\":\"1002\",\"label\":\"银行存款\",\"level\":0,\"sortOrder\":0},"
                + "{\"rowKey\":\"100201\",\"parentKey\":\"1002\",\"code\":\"100201\",\"label\":\"农商行\",\"level\":1,\"sortOrder\":1}"
                + "],\"cells\":["
                + "{\"rowKey\":\"1002\",\"field\":\"endDr\",\"amount\":123.45},"
                + "{\"rowKey\":\"100201\",\"field\":\"endDr\",\"amount\":123.45}"
                + "]}]}";
        mvc.perform(post("/api/reports/tb/import").param("year", "2025").param("month", "12")
                .header("Authorization", auth()).contentType("application/json").content(importBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.imported").value(2));

        String companies = utf8(mvc.perform(get("/api/companies").header("Authorization", auth()))
                .andExpect(status().isOk()).andReturn());
        assertThat(JsonPath.<List<?>>read(companies, "$.data[?(@.name=='某全新TB公司IT')]")).isNotEmpty();
        int newId = ((Number) JsonPath.<List<Object>>read(companies, "$.data[?(@.name=='某全新TB公司IT')].id").get(0)).intValue();

        String p = utf8(mvc.perform(get("/api/reports/tb/" + newId + "/2025/12").header("Authorization", auth()))
                .andExpect(status().isOk()).andReturn());
        assertThat(JsonPath.<List<String>>read(p, "$.data.accounts[*].rowKey")).containsExactly("1002", "100201");
        assertThat(((Number) JsonPath.read(p, "$.data.amounts.1002.endDr")).doubleValue()).isEqualTo(123.45);
        assertThat(((Number) JsonPath.read(p, "$.data.amounts.100201.endDr")).doubleValue()).isEqualTo(123.45);
    }

    // ── tb: GET all 只合并一级科目(同 code 求和,明细不出现) ──
    @Test
    void tb_allPeriod_levelZeroMerge() throws Exception {
        mvc.perform(put("/api/reports/tb/1/2025/11").header("Authorization", auth())
                .contentType("application/json").content("{\"accounts\":["
                        + "{\"rowKey\":\"1001\",\"parentKey\":null,\"code\":\"1001\",\"label\":\"库存现金\",\"level\":0,\"sortOrder\":0},"
                        + "{\"rowKey\":\"r2\",\"parentKey\":\"1001\",\"code\":null,\"label\":\"备用金\",\"level\":1,\"sortOrder\":1}"
                        + "],\"cells\":["
                        + "{\"rowKey\":\"1001\",\"field\":\"endDr\",\"amount\":100},"
                        + "{\"rowKey\":\"r2\",\"field\":\"endDr\",\"amount\":100}]}"))
                .andExpect(status().isOk());
        mvc.perform(put("/api/reports/tb/2/2025/11").header("Authorization", auth())
                .contentType("application/json").content("{\"accounts\":["
                        + "{\"rowKey\":\"1001\",\"parentKey\":null,\"code\":\"1001\",\"label\":\"库存现金\",\"level\":0,\"sortOrder\":0}"
                        + "],\"cells\":[{\"rowKey\":\"1001\",\"field\":\"endDr\",\"amount\":250}]}"))
                .andExpect(status().isOk());

        String res = utf8(mvc.perform(get("/api/reports/tb/all/2025/11").header("Authorization", auth()))
                .andExpect(status().isOk()).andReturn());
        // 同 code 一级科目跨公司求和;明细行(r2)不参与也不出现
        assertThat(((Number) JsonPath.read(res, "$.data.amounts.1001.endDr")).doubleValue()).isEqualTo(350.0);
        assertThat(JsonPath.<List<?>>read(res, "$.data.accounts[?(@.rowKey=='1001')]")).isNotEmpty();
        assertThat(JsonPath.<List<?>>read(res, "$.data.accounts[?(@.level!=0)]")).isEmpty();
        assertThat(JsonPath.<Map<String, ?>>read(res, "$.data.amounts")).doesNotContainKey("r2");
    }

    // ── tb: V25 种子可读(公司1 2025-09 五科目树 + 已平金额) ──
    @Test
    void tb_seed_readable() throws Exception {
        String res = utf8(mvc.perform(get("/api/reports/tb/1/2025/9").header("Authorization", auth()))
                .andExpect(status().isOk()).andReturn());
        assertThat(JsonPath.<List<String>>read(res, "$.data.accounts[*].rowKey"))
                .containsExactly("1001", "1002", "100201", "1122", "r5");
        assertThat((String) JsonPath.read(res, "$.data.accounts[2].parentKey")).isEqualTo("1002");
        assertThat(((Number) JsonPath.read(res, "$.data.amounts.1001.endDr")).doubleValue()).isEqualTo(20000.0);
        assertThat(((Number) JsonPath.read(res, "$.data.amounts.1122.endCr")).doubleValue()).isEqualTo(100000.0);
        // 一级科目 endDr 合计 = endCr 合计 = 100000(演示已平)
        assertThat(((Number) JsonPath.read(res, "$.data.amounts.1002.endDr")).doubleValue()
                + ((Number) JsonPath.read(res, "$.data.amounts.1001.endDr")).doubleValue()).isEqualTo(100000.0);
    }

    // ── 无 token → 401 ──
    @Test
    void period_withoutToken_returns401() throws Exception {
        mvc.perform(get("/api/reports/is/1/2025/10")).andExpect(status().isUnauthorized());
    }
}

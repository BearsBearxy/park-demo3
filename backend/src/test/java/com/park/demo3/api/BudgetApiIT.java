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

// /all 返回全库,用例各占独立年份(2091~2095)互不干扰,断言按年过滤
@AutoConfigureMockMvc
class BudgetApiIT extends AbstractMysqlIT {

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
    private void importRows(String rowsJson, int expectImported) throws Exception {
        mvc.perform(post("/api/budget/import").header("Authorization", auth())
                .contentType("application/json").content("{\"rows\":[" + rowsJson + "]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.imported").value(expectImported));
    }
    private String all() throws Exception {
        return utf8(mvc.perform(get("/api/budget/all").header("Authorization", auth()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0)).andReturn());
    }

    // ── 导入回读:只有预算(actual null)/只有发生额(budget null),sub、note、金额保真 ──
    @Test
    void budget_import_readBack_nullBudgetOrActual() throws Exception {
        importRows(
              "{\"year\":2091,\"label\":\"收入总计\",\"sub\":false,\"budget\":92705202.87,\"actual\":null,\"note\":\"预算年\",\"sortOrder\":0},"
            + "{\"year\":2091,\"label\":\"其中：租金收入\",\"sub\":true,\"budget\":null,\"actual\":82867520.264,\"note\":null,\"sortOrder\":1}", 2);

        String res = all();
        assertThat(JsonPath.<List<String>>read(res, "$.data[?(@.year==2091)].label"))
                .containsExactly("收入总计", "其中：租金收入");
        // 过滤器表达式恒返回数组,先取 List 再取首元素
        assertThat(((Number) JsonPath.<List<Object>>read(res, "$.data[?(@.year==2091&&@.sortOrder==0)].budget").get(0)).doubleValue())
                .isEqualTo(92705202.87);
        assertThat(JsonPath.<List<Object>>read(res, "$.data[?(@.year==2091&&@.sortOrder==0)].actual").get(0)).isNull();
        assertThat(JsonPath.<List<String>>read(res, "$.data[?(@.year==2091&&@.sortOrder==0)].note").get(0)).isEqualTo("预算年");
        // 子行:budget null,发生额四舍五入到分,sub=true
        assertThat(JsonPath.<List<Object>>read(res, "$.data[?(@.year==2091&&@.sortOrder==1)].budget").get(0)).isNull();
        assertThat(((Number) JsonPath.<List<Object>>read(res, "$.data[?(@.year==2091&&@.sortOrder==1)].actual").get(0)).doubleValue())
                .isEqualTo(82867520.26);
        assertThat(JsonPath.<List<Boolean>>read(res, "$.data[?(@.year==2091)].sub")).containsExactly(false, true);
    }

    // ── 整年替换:同年二次导入,旧行不残留 ──
    @Test
    void budget_import_replaceYear_noLeftover() throws Exception {
        importRows(
              "{\"year\":2092,\"label\":\"旧行A\",\"sub\":false,\"budget\":1,\"actual\":null,\"note\":null,\"sortOrder\":0},"
            + "{\"year\":2092,\"label\":\"旧行B\",\"sub\":false,\"budget\":2,\"actual\":null,\"note\":null,\"sortOrder\":1}", 2);
        importRows(
              "{\"year\":2092,\"label\":\"新行\",\"sub\":false,\"budget\":3,\"actual\":null,\"note\":null,\"sortOrder\":0}", 1);

        assertThat(JsonPath.<List<String>>read(all(), "$.data[?(@.year==2092)].label")).containsExactly("新行");
    }

    // ── 双年 payload:两年各自整年替换,未出现的年不受扰动 ──
    @Test
    void budget_import_twoYears_eachReplaced() throws Exception {
        importRows(
              "{\"year\":2093,\"label\":\"甲旧\",\"sub\":false,\"budget\":1,\"actual\":null,\"note\":null,\"sortOrder\":0},"
            + "{\"year\":2094,\"label\":\"乙旧\",\"sub\":false,\"budget\":null,\"actual\":2,\"note\":null,\"sortOrder\":0},"
            + "{\"year\":2095,\"label\":\"丙不动\",\"sub\":false,\"budget\":5,\"actual\":null,\"note\":null,\"sortOrder\":0}", 3);
        importRows(
              "{\"year\":2093,\"label\":\"甲新\",\"sub\":false,\"budget\":10,\"actual\":null,\"note\":null,\"sortOrder\":0},"
            + "{\"year\":2094,\"label\":\"乙新\",\"sub\":false,\"budget\":null,\"actual\":20,\"note\":null,\"sortOrder\":0}", 2);

        String res = all();
        assertThat(JsonPath.<List<String>>read(res, "$.data[?(@.year==2093)].label")).containsExactly("甲新");
        assertThat(JsonPath.<List<String>>read(res, "$.data[?(@.year==2094)].label")).containsExactly("乙新");
        assertThat(JsonPath.<List<String>>read(res, "$.data[?(@.year==2095)].label")).containsExactly("丙不动");
    }
}

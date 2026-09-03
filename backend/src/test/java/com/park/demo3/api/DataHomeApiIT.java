package com.park.demo3.api;

import com.park.demo3.AbstractMysqlIT;
import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 数据中心首页(DATA-HOME-REDESIGN)。旧契约的 kpis/tasks/recent/progress* 已整组删除 —— 那三块
 *  是同一批信息的重复画法(详见 DataHomeOverviewDTO 头注),这里只验新的两段式形状。 */
@AutoConfigureMockMvc
class DataHomeApiIT extends AbstractMysqlIT {

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

    private String getOk(String url) throws Exception {
        return mvc.perform(get(url).header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
    }

    @Test
    void overview_默认落锚定月且形状完整() throws Exception {
        String body = getOk("/api/data-home/overview");
        assertThat((String) JsonPath.read(body, "$.data.period.label")).contains("年").contains("月");
        List<String> months = JsonPath.read(body, "$.data.months[*]");
        assertThat(months).isSorted().allMatch(m -> m.matches("\\d{4}-\\d{2}"));
        assertThat((List<?>) JsonPath.read(body, "$.data.chain.steps")).hasSize(5);
        assertThat((int) JsonPath.read(body, "$.data.schedules.total")).isEqualTo(9);
        assertThat((List<?>) JsonPath.read(body, "$.data.schedules.items")).hasSize(9);
        assertThat((List<?>) JsonPath.read(body, "$.data.blockers")).isNotNull();
    }

    @Test
    void overview_出账链五步的状态取值受限() throws Exception {
        String body = getOk("/api/data-home/overview");
        List<String> statuses = JsonPath.read(body, "$.data.chain.steps[*].status");
        assertThat(statuses).allMatch(s -> List.of("done", "current", "todo").contains(s));
        // 当前步至多一个:currentIndex 指向它;全 done 时为 -1、一个 current 都没有
        int currentIndex = JsonPath.read(body, "$.data.chain.currentIndex");
        long currents = statuses.stream().filter("current"::equals).count();
        assertThat(currents).isEqualTo(currentIndex >= 0 ? 1 : 0);
    }

    @Test
    void overview_指定月生效() throws Exception {
        String body = getOk("/api/data-home/overview?ym=2024-02");
        assertThat((int) JsonPath.read(body, "$.data.period.year")).isEqualTo(2024);
        assertThat((int) JsonPath.read(body, "$.data.period.month")).isEqualTo(2);
    }

    @Test
    void overview_完全空的月不炸() throws Exception {
        String body = getOk("/api/data-home/overview?ym=2099-12");
        assertThat((int) JsonPath.read(body, "$.data.chain.currentIndex")).isZero();
        assertThat((int) JsonPath.read(body, "$.data.schedules.done")).isZero();
        List<String> statuses = JsonPath.read(body, "$.data.chain.steps[*].status");
        assertThat(statuses).containsExactly("current", "todo", "todo", "todo");
    }

    @Test
    void overview_ym格式非法返回400() throws Exception {
        mvc.perform(get("/api/data-home/overview?ym=2024-13").header("Authorization", "Bearer " + token))
                .andExpect(status().isBadRequest());
    }

    @Test
    void overview_withoutToken_returns401() throws Exception {
        mvc.perform(get("/api/data-home/overview"))
                .andExpect(status().isUnauthorized());
    }
}

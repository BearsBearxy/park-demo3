package com.park.demo3.api;

import com.park.demo3.AbstractMysqlIT;
import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

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

    @Test
    void overview_returnsShapeWith9SourcesAndPeriod() throws Exception {
        mvc.perform(get("/api/data-home/overview")
                .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.progressTotal").value(9))
                .andExpect(jsonPath("$.data.sources.length()").value(9))
                .andExpect(jsonPath("$.data.kpis.length()").value(4))
                .andExpect(jsonPath("$.data.period.year").isNumber())
                .andExpect(jsonPath("$.data.period.month").isNumber())
                .andExpect(jsonPath("$.data.period.label").isString())
                .andExpect(jsonPath("$.data.pct").isNumber())
                .andExpect(jsonPath("$.data.tasks").isArray())
                .andExpect(jsonPath("$.data.recent").isArray());
    }

    @Test
    void overview_withoutToken_returns401() throws Exception {
        mvc.perform(get("/api/data-home/overview"))
                .andExpect(status().isUnauthorized());
    }
}

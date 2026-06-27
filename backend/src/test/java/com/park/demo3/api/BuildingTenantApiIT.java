package com.park.demo3.api;

import com.park.demo3.AbstractMysqlIT;
import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@AutoConfigureMockMvc
class BuildingTenantApiIT extends AbstractMysqlIT {

    @Autowired
    MockMvc mvc;

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
    void buildings_returnsListAndStoppedBuildingHasZeroOccRate() throws Exception {
        String body = mvc.perform(get("/api/buildings")
                .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsString();

        List<Object> data = JsonPath.read(body, "$.data");
        assertThat(data.size()).isGreaterThanOrEqualTo(6);

        // 停用楼栋 (status=0) occRate 必须为 0
        List<Double> occRates = JsonPath.read(body, "$.data[?(@.status==0)].occRate");
        assertThat(occRates).isNotEmpty();
        assertThat(occRates.get(0)).isEqualTo(0.0);
    }

    @Test
    void buildingsSummary_returnsAggregates() throws Exception {
        mvc.perform(get("/api/buildings/summary")
                .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.buildingCount").value(org.hamcrest.Matchers.greaterThanOrEqualTo(6)))
                .andExpect(jsonPath("$.data.stoppedCount").value(org.hamcrest.Matchers.greaterThanOrEqualTo(1)));
    }

    @Test
    void tenants_returnsList() throws Exception {
        String body = mvc.perform(get("/api/tenants")
                .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsString();

        List<Object> data = JsonPath.read(body, "$.data");
        assertThat(data.size()).isGreaterThanOrEqualTo(12);
    }

    @Test
    void tenantsSummary_returnsAggregates() throws Exception {
        mvc.perform(get("/api/tenants/summary")
                .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.tenantActive").value(org.hamcrest.Matchers.greaterThanOrEqualTo(1)));
    }

    @Test
    void tenantCategories_returnsThree() throws Exception {
        String body = mvc.perform(get("/api/tenant-categories")
                .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsString();

        List<Object> data = JsonPath.read(body, "$.data");
        assertThat(data.size()).isEqualTo(3);
    }

    @Test
    void buildings_withoutToken_returns401() throws Exception {
        mvc.perform(get("/api/buildings"))
                .andExpect(status().isUnauthorized());
    }
}

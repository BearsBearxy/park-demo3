package com.park.demo3.api;
import com.park.demo3.AbstractMysqlIT;
import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@AutoConfigureMockMvc
class ImportLogApiIT extends AbstractMysqlIT {
    @Autowired MockMvc mvc;

    private String auth() throws Exception {
        String body = mvc.perform(post("/api/auth/login").contentType("application/json")
                .content("{\"username\":\"admin\",\"password\":\"admin123\"}"))
                .andReturn().getResponse().getContentAsString();
        return "Bearer " + JsonPath.read(body, "$.data.token");
    }

    @Test void post_thenOverview_recordsAndLists() throws Exception {
        String tok = auth();
        mvc.perform(post("/api/import-log").header("Authorization", tok).contentType("application/json")
                .content("{\"dataType\":\"salary\",\"typeLabel\":\"工资明细\",\"fileName\":\"s.xlsx\",\"rows\":10,\"ok\":9,\"warn\":1,\"status\":\"partial\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.status").value("partial"))
                .andExpect(jsonPath("$.data.operator").isNotEmpty())   // resolveOperator 填了 admin displayName
                .andExpect(jsonPath("$.data.createdAt").isNotEmpty());
        mvc.perform(get("/api/import-log/overview").header("Authorization", tok))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.latestByType[?(@.dataType=='salary')]").isNotEmpty())
                .andExpect(jsonPath("$.data.history[?(@.fileName=='s.xlsx')]").isNotEmpty());
    }

    @Test void post_unknownType_accepted_noWhitelist() throws Exception {
        // 2026-07-09 起无类型白名单(双份清单必然烂,budget 上线事故):任意 dataType 正常入库
        mvc.perform(post("/api/import-log").header("Authorization", auth()).contentType("application/json")
                .content("{\"dataType\":\"bogus\",\"typeLabel\":\"X\",\"fileName\":\"f.xlsx\",\"rows\":1,\"ok\":1,\"warn\":0,\"status\":\"complete\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.dataType").value("bogus"));
    }

    @Test void post_badStatus_returns400() throws Exception {
        // @Pattern 校验失败 → HTTP 400
        mvc.perform(post("/api/import-log").header("Authorization", auth()).contentType("application/json")
                .content("{\"dataType\":\"salary\",\"typeLabel\":\"X\",\"fileName\":\"f.xlsx\",\"rows\":1,\"ok\":1,\"warn\":0,\"status\":\"weird\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test void overview_withoutToken_returns401() throws Exception {
        mvc.perform(get("/api/import-log/overview")).andExpect(status().isUnauthorized());
    }
}

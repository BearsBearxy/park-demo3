package com.park.demo3.security;
import com.park.demo3.AbstractMysqlIT;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@AutoConfigureMockMvc
class AuthIT extends AbstractMysqlIT {
    @Autowired MockMvc mvc;

    @Test
    void loginReturnsToken() throws Exception {
        mvc.perform(post("/api/auth/login").contentType("application/json")
                .content("{\"username\":\"admin\",\"password\":\"admin123\"}"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.code").value(0))
           .andExpect(jsonPath("$.data.token").isNotEmpty())
           .andExpect(jsonPath("$.data.displayName").value("周明"));
    }

    @Test
    void protectedEndpointRejectsWithoutToken() throws Exception {
        mvc.perform(get("/api/probe/ok")).andExpect(status().isUnauthorized());
    }

    @Test
    void protectedEndpointAcceptsWithToken() throws Exception {
        String body = mvc.perform(post("/api/auth/login").contentType("application/json")
                .content("{\"username\":\"admin\",\"password\":\"admin123\"}"))
                .andReturn().getResponse().getContentAsString();
        String token = com.jayway.jsonpath.JsonPath.read(body, "$.data.token");
        mvc.perform(get("/api/probe/ok").header("Authorization", "Bearer " + token))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.data.hello").value("demo3"));
    }
}

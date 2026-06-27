package com.park.demo3.common;
import com.park.demo3.AbstractMysqlIT;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@AutoConfigureMockMvc
class WebLayerIT extends AbstractMysqlIT {
    @Autowired MockMvc mvc;

    @Test @WithMockUser
    void wrapsBodyInResultWithTraceId() throws Exception {
        mvc.perform(get("/api/probe/ok"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.code").value(0))
           .andExpect(jsonPath("$.data.hello").value("demo3"))
           .andExpect(jsonPath("$.traceId").isNotEmpty())
           .andExpect(header().exists("X-Trace-Id"));
    }

    @Test @WithMockUser
    void mapsBizExceptionToResultCode() throws Exception {
        mvc.perform(get("/api/probe/boom"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.code").value(404))
           .andExpect(jsonPath("$.message").value("probe not found"));
    }
}

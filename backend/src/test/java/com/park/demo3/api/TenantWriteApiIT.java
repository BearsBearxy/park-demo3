package com.park.demo3.api;

import com.park.demo3.AbstractMysqlIT;
import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// 写入类 IT 统一 @Transactional 回滚:共享单例容器,不污染种子
@AutoConfigureMockMvc
@Transactional
class TenantWriteApiIT extends AbstractMysqlIT {

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

    private org.springframework.test.web.servlet.ResultActions create(String json) throws Exception {
        return mvc.perform(post("/api/tenants")
                .header("Authorization", "Bearer " + token)
                .contentType("application/json")
                .content(json));
    }

    @Test
    void createTenant_returnsDtoWithDerivedDefaults() throws Exception {
        create("""
                {"companyName":"IT写测租户甲","businessType":"智能制造","contactName":"王测",
                 "contactPhone":"13800000000","phase":2,"since":"2026-01","remark":"IT 创建"}""")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.id").isNumber())
                .andExpect(jsonPath("$.data.companyName").value("IT写测租户甲"))
                .andExpect(jsonPath("$.data.businessType").value("智能制造"))
                .andExpect(jsonPath("$.data.contactName").value("王测"))
                .andExpect(jsonPath("$.data.status").value(1))
                .andExpect(jsonPath("$.data.phase").value(2))
                .andExpect(jsonPath("$.data.since").value("2026-01"))
                // 新租户无合同:派生字段为 0/占位
                .andExpect(jsonPath("$.data.monthlyRent").value(0))
                .andExpect(jsonPath("$.data.leasedArea").value(0))
                .andExpect(jsonPath("$.data.contractCount").value(0))
                .andExpect(jsonPath("$.data.primaryBuilding").value("—"));
    }

    @Test
    void createTenant_duplicateName_returns409Envelope() throws Exception {
        create("{\"companyName\":\"IT写测租户重名\",\"businessType\":\"仓储物流\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0));
        create("{\"companyName\":\"IT写测租户重名\",\"businessType\":\"仓储物流\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(409))
                .andExpect(jsonPath("$.message").value("租户名称已存在"));
    }

    @Test
    void createTenant_unknownCategory_returns404Envelope() throws Exception {
        create("{\"companyName\":\"IT写测租户丙\",\"businessType\":\"电子信息\",\"categoryId\":99999}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(404))
                .andExpect(jsonPath("$.message").value("租户分类不存在"));
    }

    @Test
    void createTenant_blankName_returnsHttp400() throws Exception {
        create("{\"companyName\":\"\",\"businessType\":\"电子信息\"}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(400));
    }
}

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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.hamcrest.Matchers.greaterThanOrEqualTo;

@AutoConfigureMockMvc
class ContractApiIT extends AbstractMysqlIT {

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
    void contracts_returnsListWithTenantAndBuildingName() throws Exception {
        String body = mvc.perform(get("/api/contracts")
                .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data").isArray())
                .andExpect(jsonPath("$.data.length()", greaterThanOrEqualTo(1)))
                .andReturn().getResponse().getContentAsString();

        // every row has tenantName and buildingName
        List<String> tenantNames  = JsonPath.read(body, "$.data[*].tenantName");
        List<String> buildingNames = JsonPath.read(body, "$.data[*].buildingName");
        List<String> statuses      = JsonPath.read(body, "$.data[*].status");

        assertThat(tenantNames).isNotEmpty().allMatch(n -> n != null && !n.isEmpty());
        assertThat(buildingNames).isNotEmpty().allMatch(n -> n != null && !n.isEmpty());
        // seed has at least 4 distinct statuses
        assertThat(statuses.stream().distinct().count()).isGreaterThanOrEqualTo(2L);
    }

    @Test
    void contractsSummary_returnsAggregates() throws Exception {
        mvc.perform(get("/api/contracts/summary")
                .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.total", greaterThanOrEqualTo(1)))
                .andExpect(jsonPath("$.data.contractActive").isNumber())
                .andExpect(jsonPath("$.data.contractExpiring").isNumber())
                .andExpect(jsonPath("$.data.contractDraft").isNumber())
                .andExpect(jsonPath("$.data.monthlyRent").isNumber());
    }

    @Test
    void contractDetail_returnsContractAndTenantSnap() throws Exception {
        // get a valid contract id from the list
        String listBody = mvc.perform(get("/api/contracts")
                .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        int id = ((Integer) ((List<?>) JsonPath.read(listBody, "$.data[*].id")).get(0));

        String body = mvc.perform(get("/api/contracts/" + id)
                .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.contract.id").value(id))
                .andExpect(jsonPath("$.data.contract.tenantName").isString())
                .andExpect(jsonPath("$.data.tenant").exists())
                .andExpect(jsonPath("$.data.tenant.companyName").isString())
                .andReturn().getResponse().getContentAsString();

        String tenantName    = JsonPath.read(body, "$.data.contract.tenantName");
        String companyName   = JsonPath.read(body, "$.data.tenant.companyName");
        // contract.tenantName and tenant.companyName must agree
        assertThat(tenantName).isEqualTo(companyName);
    }

    @Test
    void contracts_withoutToken_returns401() throws Exception {
        mvc.perform(get("/api/contracts"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void contractDetail_missingId_returnsNotFoundEnvelope() throws Exception {
        // 查无此合同 → 码在体内 404（HTTP 200），非 500 兜底
        mvc.perform(get("/api/contracts/99999999")
                .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(404));
    }

    // ─── V90 公摊面积(S5 §1):写路径 areaShared 落库回读 + 负值 400 ───────────

    /** 建一份 draft 合同(租户/楼栋取种子首个),返回 [id, tenantId, buildingId] */
    private int[] createDraft(String no) throws Exception {
        String tenants = mvc.perform(get("/api/tenants").header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getContentAsString();
        int tid = ((List<Integer>) JsonPath.read(tenants, "$.data[*].id")).get(0);
        String buildings = mvc.perform(get("/api/buildings").header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getContentAsString();
        int bid = ((List<Integer>) JsonPath.read(buildings, "$.data[*].id")).get(0);
        String body = mvc.perform(post("/api/contracts")
                .header("Authorization", "Bearer " + token)
                .contentType("application/json")
                .content("{\"contractNo\":\"" + no + "\",\"tenantId\":" + tid + ",\"buildingId\":" + bid
                        + ",\"status\":\"draft\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsString();
        return new int[]{JsonPath.read(body, "$.data.id"), tid, bid};
    }

    private static String putBody(String no, int tid, int bid, String areaShared) {
        return "{\"contractNo\":\"" + no + "\",\"tenantId\":" + tid + ",\"buildingId\":" + bid
                + ",\"status\":\"draft\",\"billingLines\":[{\"propertyType\":\"factory\",\"location\":\"A座602\","
                + "\"feeKey\":\"rent_factory\",\"area\":1528,\"areaShared\":" + areaShared + ",\"unitPrice\":10}]}";
    }

    @Test
    @org.springframework.transaction.annotation.Transactional  // 写用例回滚,不污染共享容器种子
    void billingLine_areaShared_writtenAndReadBack() throws Exception {
        String no = "IT-V90-" + System.nanoTime();
        int[] c = createDraft(no);
        mvc.perform(put("/api/contracts/" + c[0])
                .header("Authorization", "Bearer " + token)
                .contentType("application/json")
                .content(putBody(no, c[1], c[2], "458")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(get("/api/contracts/" + c[0]).header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.billingLines[0].areaShared").value(458.0))
                .andExpect(jsonPath("$.data.billingLines[0].area").value(1528.0));
    }

    @Test
    @org.springframework.transaction.annotation.Transactional
    void billingLine_areaShared_negative_returns400() throws Exception {
        String no = "IT-V90N-" + System.nanoTime();
        int[] c = createDraft(no);
        mvc.perform(put("/api/contracts/" + c[0])
                .header("Authorization", "Bearer " + token)
                .contentType("application/json")
                .content(putBody(no, c[1], c[2], "-1")))
                .andExpect(status().isBadRequest());
    }
}

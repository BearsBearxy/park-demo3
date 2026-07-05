package com.park.demo3.api;

import com.park.demo3.AbstractMysqlIT;
import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** /api/contracts 写接口 IT（新增/编辑/终止/续签/删除）。写入类 IT 统一 @Transactional 回滚:共享单例容器,不污染种子。 */
@AutoConfigureMockMvc
@Transactional
class ContractWriteApiIT extends AbstractMysqlIT {

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

    // ─── helpers ─────────────────────────────────────────────

    private String getBody(String url) throws Exception {
        return mvc.perform(get(url).header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
    }

    private int firstTenantId() throws Exception {
        return ((List<Integer>) JsonPath.read(getBody("/api/tenants"), "$.data[*].id")).get(0);
    }

    private int firstBuildingId() throws Exception {
        return ((List<Integer>) JsonPath.read(getBody("/api/buildings"), "$.data[*].id")).get(0);
    }

    /** [buildingId, vacantUnitId] — 遍历楼栋找第一个有空置单元的 */
    private int[] findVacantUnit() throws Exception {
        List<Integer> bids = JsonPath.read(getBody("/api/buildings"), "$.data[*].id");
        for (int bid : bids) {
            List<Integer> vacant = JsonPath.read(getBody("/api/buildings/" + bid),
                    "$.data.units[?(@.status=='vacant')].id");
            if (!vacant.isEmpty()) return new int[]{bid, vacant.get(0)};
        }
        throw new IllegalStateException("seed 中无空置单元，无法验证 occupied 联动");
    }

    private static String uniqueNo() {
        // contract_no VARCHAR(32) 唯一键；纳秒时间戳保证跨用例唯一
        return "IT-W-" + System.nanoTime();
    }

    private String json(String contractNo, Object tenantId, Object buildingId, Object unitId,
                        String startDate, String endDate, String status) {
        StringBuilder sb = new StringBuilder("{");
        sb.append("\"contractNo\":\"").append(contractNo).append("\",");
        sb.append("\"tenantId\":").append(tenantId).append(",");
        sb.append("\"buildingId\":").append(buildingId).append(",");
        if (unitId != null) sb.append("\"unitId\":").append(unitId).append(",");
        if (startDate != null) sb.append("\"startDate\":\"").append(startDate).append("\",");
        if (endDate != null) sb.append("\"endDate\":\"").append(endDate).append("\",");
        sb.append("\"rentArea\":100.5,\"monthlyRent\":8000,\"deposit\":16000,");
        sb.append("\"status\":\"").append(status).append("\",\"remark\":\"IT 写接口\"}");
        return sb.toString();
    }

    // ─── cases ───────────────────────────────────────────────

    @Test
    void createActive_success_fieldsEchoed_andUnitBecomesOccupied() throws Exception {
        int tid = firstTenantId();
        int[] bu = findVacantUnit();
        String no = uniqueNo();

        mvc.perform(post("/api/contracts")
                .header("Authorization", "Bearer " + token)
                .contentType("application/json")
                .content(json(no, tid, bu[0], bu[1], "2026-01-01", "2028-12-31", "active")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.id").isNumber())
                .andExpect(jsonPath("$.data.contractNo").value(no))
                .andExpect(jsonPath("$.data.tenantId").value(tid))
                .andExpect(jsonPath("$.data.buildingId").value(bu[0]))
                .andExpect(jsonPath("$.data.tenantName").isNotEmpty())
                .andExpect(jsonPath("$.data.buildingName").isNotEmpty())
                .andExpect(jsonPath("$.data.rentArea").value(100.5))
                .andExpect(jsonPath("$.data.monthlyRent").value(8000.0))
                .andExpect(jsonPath("$.data.startDate").value("2026-01-01"))
                .andExpect(jsonPath("$.data.endDate").value("2028-12-31"))
                .andExpect(jsonPath("$.data.status").value("active"));

        // 关键联动：单元状态读时派生，active 合同落库后该单元在楼栋详情中应变 occupied
        List<String> st = JsonPath.read(getBody("/api/buildings/" + bu[0]),
                "$.data.units[?(@.id==" + bu[1] + ")].status");
        assertThat(st).containsExactly("occupied");
    }

    @Test
    void duplicateContractNo_returns409InBody() throws Exception {
        int tid = firstTenantId(); int bid = firstBuildingId();
        String no = uniqueNo();
        mvc.perform(post("/api/contracts")
                .header("Authorization", "Bearer " + token)
                .contentType("application/json")
                .content(json(no, tid, bid, null, null, null, "draft")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0));

        mvc.perform(post("/api/contracts")
                .header("Authorization", "Bearer " + token)
                .contentType("application/json")
                .content(json(no, tid, bid, null, null, null, "draft")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(409))
                .andExpect(jsonPath("$.message").value("合同号已存在"));
    }

    @Test
    void missingTenant_returns404InBody() throws Exception {
        mvc.perform(post("/api/contracts")
                .header("Authorization", "Bearer " + token)
                .contentType("application/json")
                .content(json(uniqueNo(), 99999999, firstBuildingId(), null, null, null, "draft")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(404));
    }

    @Test
    void invalidStatus_returnsHttp400() throws Exception {
        mvc.perform(post("/api/contracts")
                .header("Authorization", "Bearer " + token)
                .contentType("application/json")
                .content(json(uniqueNo(), firstTenantId(), firstBuildingId(), null, null, null, "bogus")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(400));
    }

    @Test
    void endBeforeStart_returns409InBody() throws Exception {
        mvc.perform(post("/api/contracts")
                .header("Authorization", "Bearer " + token)
                .contentType("application/json")
                .content(json(uniqueNo(), firstTenantId(), firstBuildingId(), null,
                        "2026-06-01", "2026-01-01", "draft")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(409))
                .andExpect(jsonPath("$.message").value("结束日期不能早于开始日期"));
    }

    // ─── 编辑 / 终止 / 续签 / 删除 ───────────────────────────

    /** 建一份合同并返回 id */
    private int createContract(String no, int tid, int bid, Integer uid,
                               String start, String end, String status) throws Exception {
        String body = mvc.perform(post("/api/contracts")
                .header("Authorization", "Bearer " + token)
                .contentType("application/json")
                .content(json(no, tid, bid, uid, start, end, status)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$.data.id");
    }

    @Test
    void updateContract_success_sameNoExcludesSelf_andReadBack() throws Exception {
        int tid = firstTenantId(); int bid = firstBuildingId();
        String no = uniqueNo();
        int id = createContract(no, tid, bid, null, null, null, "draft");

        // 合同号不变(证明查重排除自身),改租金/状态/日期
        mvc.perform(put("/api/contracts/" + id)
                .header("Authorization", "Bearer " + token)
                .contentType("application/json")
                .content("{\"contractNo\":\"" + no + "\",\"tenantId\":" + tid + ",\"buildingId\":" + bid
                        + ",\"rentArea\":120,\"monthlyRent\":9999,\"deposit\":20000,"
                        + "\"startDate\":\"2026-02-01\",\"endDate\":\"2027-01-31\","
                        + "\"status\":\"active\",\"remark\":\"IT 编辑\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.monthlyRent").value(9999.0))
                .andExpect(jsonPath("$.data.status").value("active"));

        // 回读
        mvc.perform(get("/api/contracts/" + id).header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.contract.monthlyRent").value(9999.0))
                .andExpect(jsonPath("$.data.contract.status").value("active"))
                .andExpect(jsonPath("$.data.contract.remark").value("IT 编辑"));
    }

    @Test
    void updateContract_duplicateOtherNo_returns409InBody() throws Exception {
        int tid = firstTenantId(); int bid = firstBuildingId();
        String noA = uniqueNo();
        createContract(noA, tid, bid, null, null, null, "draft");
        int idB = createContract(uniqueNo(), tid, bid, null, null, null, "draft");

        mvc.perform(put("/api/contracts/" + idB)
                .header("Authorization", "Bearer " + token)
                .contentType("application/json")
                .content(json(noA, tid, bid, null, null, null, "draft")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(409))
                .andExpect(jsonPath("$.message").value("合同号已存在"));
    }

    @Test
    void updateContract_missing_returns404InBody() throws Exception {
        mvc.perform(put("/api/contracts/99999999")
                .header("Authorization", "Bearer " + token)
                .contentType("application/json")
                .content(json(uniqueNo(), firstTenantId(), firstBuildingId(), null, null, null, "draft")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(404))
                .andExpect(jsonPath("$.message").value("合同不存在"));
    }

    @Test
    void terminate_success_unitBackToVacant() throws Exception {
        int tid = firstTenantId();
        int[] bu = findVacantUnit();
        int id = createContract(uniqueNo(), tid, bu[0], bu[1], "2026-01-01", "2028-12-31", "active");

        // active 落库后单元 occupied(create 用例已验),终止后派生应回 vacant
        mvc.perform(post("/api/contracts/" + id + "/terminate")
                .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.status").value("terminated"));

        List<String> st = JsonPath.read(getBody("/api/buildings/" + bu[0]),
                "$.data.units[?(@.id==" + bu[1] + ")].status");
        assertThat(st).containsExactly("vacant");
    }

    @Test
    void terminate_twice_returns409InBody() throws Exception {
        int id = createContract(uniqueNo(), firstTenantId(), firstBuildingId(), null,
                "2026-01-01", "2028-12-31", "active");
        mvc.perform(post("/api/contracts/" + id + "/terminate")
                .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0));

        mvc.perform(post("/api/contracts/" + id + "/terminate")
                .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(409))
                .andExpect(jsonPath("$.message").value("合同已终止"));
    }

    @Test
    void renew_success_oldTerminated_newActiveInheritsUnitAndRent() throws Exception {
        int tid = firstTenantId();
        int[] bu = findVacantUnit();
        int oldId = createContract(uniqueNo(), tid, bu[0], bu[1], "2026-01-01", "2028-12-31", "active");
        String newNo = uniqueNo();

        // 租金/押金/面积不传 → 继承旧合同(8000/16000/100.5)
        mvc.perform(post("/api/contracts/" + oldId + "/renew")
                .header("Authorization", "Bearer " + token)
                .contentType("application/json")
                .content("{\"contractNo\":\"" + newNo + "\",\"startDate\":\"2029-01-01\",\"endDate\":\"2031-12-31\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.contractNo").value(newNo))
                .andExpect(jsonPath("$.data.status").value("active"))
                .andExpect(jsonPath("$.data.tenantId").value(tid))
                .andExpect(jsonPath("$.data.buildingId").value(bu[0]))
                .andExpect(jsonPath("$.data.unitId").value(bu[1]))
                .andExpect(jsonPath("$.data.monthlyRent").value(8000.0));

        // 旧合同回读已终止
        mvc.perform(get("/api/contracts/" + oldId).header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.contract.status").value("terminated"));
    }

    @Test
    void renew_duplicateNo_returns409InBody() throws Exception {
        String no = uniqueNo();
        int id = createContract(no, firstTenantId(), firstBuildingId(), null,
                "2026-01-01", "2028-12-31", "active");

        // 新合同号撞旧合同自身的号(旧合同仍存在)→ 409
        mvc.perform(post("/api/contracts/" + id + "/renew")
                .header("Authorization", "Bearer " + token)
                .contentType("application/json")
                .content("{\"contractNo\":\"" + no + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(409))
                .andExpect(jsonPath("$.message").value("合同号已存在"));
    }

    @Test
    void deleteContract_success_goneFromList() throws Exception {
        int id = createContract(uniqueNo(), firstTenantId(), firstBuildingId(), null, null, null, "draft");

        mvc.perform(delete("/api/contracts/" + id)
                .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0));

        List<Integer> hit = JsonPath.read(getBody("/api/contracts"), "$.data[?(@.id==" + id + ")].id");
        assertThat(hit).isEmpty();
    }
}

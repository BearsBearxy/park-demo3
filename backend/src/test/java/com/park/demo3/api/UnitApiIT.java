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

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 单元 CRUD IT（POST /api/buildings/{id}/units + PUT/DELETE /api/units/{id}）。写入类 IT 统一 @Transactional 回滚。 */
@AutoConfigureMockMvc
@Transactional
class UnitApiIT extends AbstractMysqlIT {

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

    /** 新建 2 层 × 每层 2 单元的靶子楼栋(单元 101/102/201/202),避免动种子 */
    private int createBuilding(String name) throws Exception {
        String body = mvc.perform(post("/api/buildings")
                .header("Authorization", "Bearer " + token)
                .contentType("application/json")
                .content("{\"name\":\"" + name + "\",\"phase\":1,\"floorCount\":2,\"perFloor\":2," +
                        "\"totalArea\":1000,\"rentableArea\":900}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$.data.id");
    }

    private int unitIdByNo(int bid, String unitNo) throws Exception {
        List<Integer> ids = JsonPath.read(getBody("/api/buildings/" + bid),
                "$.data.units[?(@.unitNo=='" + unitNo + "')].id");
        return ids.get(0);
    }

    private int firstTenantId() throws Exception {
        return ((List<Integer>) JsonPath.read(getBody("/api/tenants"), "$.data[*].id")).get(0);
    }

    // ─── POST /api/buildings/{id}/units ──────────────────────

    @Test
    void createUnit_explicitNo_success_vacant() throws Exception {
        int bid = createBuilding("IT单元-新增栋");
        mvc.perform(post("/api/buildings/" + bid + "/units")
                .header("Authorization", "Bearer " + token)
                .contentType("application/json")
                .content("{\"floor\":2,\"unitNo\":\"203\",\"area\":88.5}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.id").isNumber())
                .andExpect(jsonPath("$.data.floor").value(2))
                .andExpect(jsonPath("$.data.unitNo").value("203"))
                .andExpect(jsonPath("$.data.area").value(88.5))
                .andExpect(jsonPath("$.data.status").value("vacant"))
                .andExpect(jsonPath("$.data.tenantId").isEmpty());
        // 回读楼栋详情:4 个自动单元 + 新增 1 个
        mvc.perform(get("/api/buildings/" + bid).header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.units.length()").value(5));
    }

    @Test
    void createUnit_autoNo_numericMaxPlusOne_areaDefaultsZero() throws Exception {
        int bid = createBuilding("IT单元-自动编号栋");
        // 1 层已有 101/102(数字惯例)→ 自动编号 103;area 缺省 0
        mvc.perform(post("/api/buildings/" + bid + "/units")
                .header("Authorization", "Bearer " + token)
                .contentType("application/json")
                .content("{\"floor\":1}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.unitNo").value("103"))
                .andExpect(jsonPath("$.data.area").value(0.0))
                .andExpect(jsonPath("$.data.status").value("vacant"));
        // 再来一个 → 104
        mvc.perform(post("/api/buildings/" + bid + "/units")
                .header("Authorization", "Bearer " + token)
                .contentType("application/json")
                .content("{\"floor\":1}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.unitNo").value("104"));
    }

    @Test
    void createUnit_duplicateNoInBuilding_returns409InBody() throws Exception {
        int bid = createBuilding("IT单元-重号栋");
        // 101 已存在于 1 层;同栋查重与楼层无关
        mvc.perform(post("/api/buildings/" + bid + "/units")
                .header("Authorization", "Bearer " + token)
                .contentType("application/json")
                .content("{\"floor\":2,\"unitNo\":\"101\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(409))
                .andExpect(jsonPath("$.message").value("单元号已存在"));
    }

    @Test
    void createUnit_floorExceedsFloorCount_returns409InBody() throws Exception {
        int bid = createBuilding("IT单元-超层栋");
        mvc.perform(post("/api/buildings/" + bid + "/units")
                .header("Authorization", "Bearer " + token)
                .contentType("application/json")
                .content("{\"floor\":3}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(409))
                .andExpect(jsonPath("$.message").value("楼层超出楼栋层数,请先在编辑楼栋中增加层数"));
    }

    // ─── PUT /api/units/{id} ─────────────────────────────────

    @Test
    void updateUnit_changeFloor_success_readsBack() throws Exception {
        int bid = createBuilding("IT单元-换层栋");
        int uid = unitIdByNo(bid, "101");
        mvc.perform(put("/api/units/" + uid)
                .header("Authorization", "Bearer " + token)
                .contentType("application/json")
                .content("{\"floor\":2,\"unitNo\":\"205\",\"area\":66}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.floor").value(2))
                .andExpect(jsonPath("$.data.unitNo").value("205"))
                .andExpect(jsonPath("$.data.status").value("vacant"));
        // 回读:该单元 floor 已变
        mvc.perform(get("/api/buildings/" + bid).header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.units[?(@.id==" + uid + ")].floor").value(2));
    }

    @Test
    void updateUnit_duplicateNo_excludesSelf() throws Exception {
        int bid = createBuilding("IT单元-编辑重号栋");
        int uid = unitIdByNo(bid, "101");
        // 撞同栋 102 → 409
        mvc.perform(put("/api/units/" + uid)
                .header("Authorization", "Bearer " + token)
                .contentType("application/json")
                .content("{\"floor\":1,\"unitNo\":\"102\",\"area\":50}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(409))
                .andExpect(jsonPath("$.message").value("单元号已存在"));
        // 保留自己的号 → 排除自身,不冲突
        mvc.perform(put("/api/units/" + uid)
                .header("Authorization", "Bearer " + token)
                .contentType("application/json")
                .content("{\"floor\":1,\"unitNo\":\"101\",\"area\":50}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0));
    }

    @Test
    void updateUnit_missing_returns404InBody() throws Exception {
        mvc.perform(put("/api/units/99999999")
                .header("Authorization", "Bearer " + token)
                .contentType("application/json")
                .content("{\"floor\":1,\"unitNo\":\"101\",\"area\":50}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(404))
                .andExpect(jsonPath("$.message").value("单元不存在"));
    }

    // ─── DELETE /api/units/{id} ──────────────────────────────

    @Test
    void deleteUnit_withoutContract_success_goneFromDetail() throws Exception {
        int bid = createBuilding("IT单元-删除栋");
        int uid = unitIdByNo(bid, "202");
        mvc.perform(delete("/api/units/" + uid)
                .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(get("/api/buildings/" + bid).header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.units.length()").value(3));
    }

    @Test
    void deleteUnit_withContract_returns409InBody() throws Exception {
        int bid = createBuilding("IT单元-有合同栋");
        int uid = unitIdByNo(bid, "201");
        // 对该单元建一份 draft 合同(删除守卫不论合同状态)
        mvc.perform(post("/api/contracts")
                .header("Authorization", "Bearer " + token)
                .contentType("application/json")
                .content("{\"contractNo\":\"IT-U-" + System.nanoTime() + "\",\"tenantId\":" + firstTenantId()
                        + ",\"buildingId\":" + bid + ",\"unitId\":" + uid
                        + ",\"rentArea\":100,\"monthlyRent\":8000,\"deposit\":16000,"
                        + "\"status\":\"draft\",\"remark\":\"IT 单元删除守卫\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0));

        mvc.perform(delete("/api/units/" + uid)
                .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(409))
                .andExpect(jsonPath("$.message").value("单元存在合同记录,请先处理相关合同"));
    }

    @Test
    void deleteUnit_missing_returns404InBody() throws Exception {
        mvc.perform(delete("/api/units/99999999")
                .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(404));
    }

    // ─── PUT /api/buildings/{id} floorCount 守卫 ─────────────

    @Test
    void updateBuilding_floorCountBelowMaxUnitFloor_returns409InBody() throws Exception {
        int bid = createBuilding("IT单元-缩层栋");
        // 现有单元最高 2 层,floorCount 改 1 → 409
        mvc.perform(put("/api/buildings/" + bid)
                .header("Authorization", "Bearer " + token)
                .contentType("application/json")
                .content("{\"name\":\"IT单元-缩层栋\",\"phase\":1,\"floorCount\":1," +
                        "\"totalArea\":1000,\"rentableArea\":900,\"status\":1}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(409))
                .andExpect(jsonPath("$.message").value("层数不能小于现有单元的最高楼层"));
    }
}

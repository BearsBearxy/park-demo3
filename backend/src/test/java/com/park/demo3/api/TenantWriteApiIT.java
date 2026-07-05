package com.park.demo3.api;

import com.park.demo3.AbstractMysqlIT;
import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
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

    // ─── 编辑 / 删除 ───────────────────────────────────────

    private int createAndGetId(String name) throws Exception {
        String body = create("{\"companyName\":\"" + name + "\",\"businessType\":\"电子信息\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$.data.id");
    }

    private org.springframework.test.web.servlet.ResultActions update(int id, String json) throws Exception {
        return mvc.perform(put("/api/tenants/" + id)
                .header("Authorization", "Bearer " + token)
                .contentType("application/json")
                .content(json));
    }

    @Test
    void updateTenant_renameAndRetire_readsBack() throws Exception {
        int id = createAndGetId("IT编辑租户原名");
        update(id, """
                {"companyName":"IT编辑租户新名","businessType":"仓储物流","contactName":"李改",
                 "contactPhone":"13900000000","phase":3,"since":"2025-06","remark":"已改","status":2}""")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.id").value(id))
                .andExpect(jsonPath("$.data.companyName").value("IT编辑租户新名"))
                .andExpect(jsonPath("$.data.businessType").value("仓储物流"))
                .andExpect(jsonPath("$.data.contactName").value("李改"))
                .andExpect(jsonPath("$.data.phase").value(3))
                .andExpect(jsonPath("$.data.since").value("2025-06"))
                .andExpect(jsonPath("$.data.status").value(2));
    }

    @Test
    void updateTenant_duplicateExistingName_returns409Envelope() throws Exception {
        int id = createAndGetId("IT编辑撞名租户");
        // 撞 V2 种子既有租户「中誉机械重工」
        update(id, "{\"companyName\":\"中誉机械重工\",\"businessType\":\"电子信息\",\"status\":1}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(409))
                .andExpect(jsonPath("$.message").value("租户名称已存在"));
    }

    @Test
    void updateTenant_unknownId_returns404Envelope() throws Exception {
        update(999999, "{\"companyName\":\"IT编辑幽灵租户\",\"businessType\":\"电子信息\",\"status\":1}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(404))
                .andExpect(jsonPath("$.message").value("租户不存在"));
    }

    @Test
    void deleteTenant_unknownId_returns404Envelope() throws Exception {
        mvc.perform(delete("/api/tenants/999999").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(404))
                .andExpect(jsonPath("$.message").value("租户不存在"));
    }

    @Test
    void deleteTenant_freshTenant_removedFromList() throws Exception {
        int id = createAndGetId("IT删除租户丁");
        mvc.perform(delete("/api/tenants/" + id).header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(get("/api/tenants").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[?(@.id == " + id + ")]").isEmpty());
    }

    @Test
    void deleteTenant_withContracts_returns409Envelope() throws Exception {
        // V2 种子:tenant 1「中誉机械重工」持有 FP-2024-0001/0002 两份合同(硬 FK)
        mvc.perform(delete("/api/tenants/1").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(409))
                .andExpect(jsonPath("$.message").value("该租户存在合同,请先处理合同"));
    }

    // ─── 子租户一级关联 ─────────────────────────────────────

    @Test
    void createChildTenant_readsBackParentIdAndName() throws Exception {
        int pid = createAndGetId("IT子租户主王柱");
        create("{\"companyName\":\"IT子租户王柱宿舍\",\"businessType\":\"电子信息\",\"parentId\":" + pid + "}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.parentId").value(pid))
                .andExpect(jsonPath("$.data.parentName").value("IT子租户主王柱"));
    }

    @Test
    void createTenant_unknownParent_returns404Envelope() throws Exception {
        create("{\"companyName\":\"IT子租户孤儿\",\"businessType\":\"电子信息\",\"parentId\":999999}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(404))
                .andExpect(jsonPath("$.message").value("主租户不存在"));
    }

    @Test
    void updateTenant_selfParent_returns409Envelope() throws Exception {
        int id = createAndGetId("IT子租户自恋");
        update(id, "{\"companyName\":\"IT子租户自恋\",\"businessType\":\"电子信息\",\"status\":1,\"parentId\":" + id + "}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(409))
                .andExpect(jsonPath("$.message").value("不能关联自己"));
    }

    @Test
    void createTenant_parentIsAlreadyChild_returns409Envelope() throws Exception {
        // B 为主,A 为 B 的子租户;再建 C 关联 A → 二级链,拒绝
        int bId = createAndGetId("IT二级链主B");
        String body = create("{\"companyName\":\"IT二级链子A\",\"businessType\":\"电子信息\",\"parentId\":" + bId + "}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsString();
        int aId = JsonPath.read(body, "$.data.id");
        create("{\"companyName\":\"IT二级链孙C\",\"businessType\":\"电子信息\",\"parentId\":" + aId + "}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(409))
                .andExpect(jsonPath("$.message").value("仅支持一级关联,所选租户已是子租户"));
    }

    @Test
    void updateTenant_clearParent_readsBackNull() throws Exception {
        int pid = createAndGetId("IT解绑主租户");
        String body = create("{\"companyName\":\"IT解绑子租户\",\"businessType\":\"电子信息\",\"parentId\":" + pid + "}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsString();
        int childId = JsonPath.read(body, "$.data.id");
        update(childId, "{\"companyName\":\"IT解绑子租户\",\"businessType\":\"电子信息\",\"status\":1,\"parentId\":null}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.parentId").isEmpty())
                .andExpect(jsonPath("$.data.parentName").isEmpty());
    }

    @Test
    void deleteTenant_withChildren_409_thenReleaseAndDelete() throws Exception {
        int pid = createAndGetId("IT待删主租户");
        String body = create("{\"companyName\":\"IT待删子租户\",\"businessType\":\"电子信息\",\"parentId\":" + pid + "}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsString();
        int childId = JsonPath.read(body, "$.data.id");
        mvc.perform(delete("/api/tenants/" + pid).header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(409))
                .andExpect(jsonPath("$.message").value("该租户存在关联子租户,请先解除关联"));
        // 解除关联后可删
        update(childId, "{\"companyName\":\"IT待删子租户\",\"businessType\":\"电子信息\",\"status\":1}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(delete("/api/tenants/" + pid).header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0));
    }
}

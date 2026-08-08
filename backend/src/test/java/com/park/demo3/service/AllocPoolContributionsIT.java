package com.park.demo3.service;

import com.jayway.jsonpath.JsonPath;
import com.park.demo3.AbstractMysqlIT;
import com.park.demo3.dto.AllocResultDTO;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// S4-0.2 poolContributions:generate 后逐池×户级贡献行按 (tenant,feeKey) 聚合须与 alloc_result
// 落库 gen 行金额全等(同一份额解析路径,池金额取当月快照);无池快照月=空表不抛错。
// 落在 service 包:Contribution 包级可见,api 包够不着。@Transactional 回滚;
// 独占槽 2095-03(2095-04 仅作无快照只读探针,全库无数据落该月)、2091-02(S5 分摊面积公式)。
@AutoConfigureMockMvc
@org.springframework.transaction.annotation.Transactional
class AllocPoolContributionsIT extends AbstractMysqlIT {

    @Autowired MockMvc mvc;
    @Autowired AllocService alloc;
    private String token;

    @BeforeEach
    void login() throws Exception {
        String body = mvc.perform(post("/api/auth/login").contentType("application/json")
                .content("{\"username\":\"admin\",\"password\":\"admin123\"}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        token = JsonPath.read(body, "$.data.token");
    }

    private String auth() { return "Bearer " + token; }

    private int postId(String url, String body) throws Exception {
        String res = mvc.perform(post(url).header("Authorization", auth())
                .contentType("application/json").content(body))
                .andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(res, "$.data.id");
    }

    private void reading(int meterId, String ym, String prev, String curr) throws Exception {
        mvc.perform(post("/api/meters/readings").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"meterId\":" + meterId + ",\"ym\":\"" + ym + "\",\"prevTotal\":" + prev + ",\"currTotal\":" + curr + "}"))
                .andExpect(jsonPath("$.code").value(0));
    }

    private void price(String cfgKey, String ym, String value) throws Exception {
        mvc.perform(put("/api/price-cfg").header("Authorization", auth()).contentType("application/json")
                .content("{\"scope\":\"\",\"cfgKey\":\"" + cfgKey + "\",\"acctMonth\":\"" + ym + "\",\"value\":" + value + "}"))
                .andExpect(status().isOk());
    }

    @Test
    void poolContributions_aggEqualsAllocResult() throws Exception {
        String ym = "2095-03";
        int t1 = postId("/api/tenants", "{\"companyName\":\"IT贡献户甲\",\"businessType\":\"IT\"}");
        int t2 = postId("/api/tenants", "{\"companyName\":\"IT贡献户乙\",\"businessType\":\"IT\"}");
        // floor 池(AC43 锚:644.5+170 → 302.50 元/层;weight 1/0.5)+ direct 池(100×1.11416875=111.42)
        int mFloor = postId("/api/meters", "{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT贡献楼梯灯\",\"ownership\":\"share\"}");
        reading(mFloor, ym, "0", "644.5");
        postId("/api/alloc/rules", "{\"zone\":\"p1\",\"name\":\"IT贡献楼梯间\",\"method\":\"floor\","
                + "\"coefficient\":3,\"extraQty\":170,\"feeKey\":\"share_elec_floor\",\"meterIds\":[" + mFloor + "],"
                + "\"members\":[{\"tenantId\":" + t1 + ",\"weight\":1},{\"tenantId\":" + t2 + ",\"weight\":0.5}]}");
        int mDir = postId("/api/meters", "{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT贡献电梯\",\"ownership\":\"share\"}");
        reading(mDir, ym, "0", "100");
        postId("/api/alloc/rules", "{\"zone\":\"p1\",\"name\":\"IT贡献直归\",\"method\":\"direct\","
                + "\"feeKey\":\"share_elec_elevator\",\"meterIds\":[" + mDir + "],"
                + "\"members\":[{\"tenantId\":" + t1 + "}]}");
        price("elec_commercial", ym, "0.79416875");
        price("elec_sharp", ym, "1.50076875");
        price("elec_peak", ym, "1.20606875");
        price("elec_flat", ym, "0.72076875");
        price("elec_valley", ym, "0.29116875");
        mvc.perform(post("/api/alloc/generate").param("ym", ym).header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0));

        // 落库 gen 行(manual 不属贡献行口径)
        Map<String, BigDecimal> db = new HashMap<>();
        for (AllocResultDTO r : alloc.resultByYm(ym))
            if ("gen".equals(r.source())) db.put(r.tenantId() + "|" + r.feeKey(), r.amount());
        assertEquals(3, db.size());
        assertEquals(0, db.get(t1 + "|share_elec_floor").compareTo(new BigDecimal("302.50")));   // 锚点防两侧同错

        Map<String, BigDecimal> agg = new HashMap<>();
        for (AllocService.Contribution c : alloc.poolContributions(ym))
            agg.merge(c.tenantId() + "|" + c.feeKey(), c.amount(), BigDecimal::add);
        assertEquals(db.keySet(), agg.keySet());
        for (Map.Entry<String, BigDecimal> e : db.entrySet())
            assertEquals(0, e.getValue().compareTo(agg.get(e.getKey()).setScale(2, RoundingMode.HALF_UP)),
                    "金额不等:" + e.getKey());

        // 无池快照月 → 空表
        assertTrue(alloc.poolContributions("2095-04").isEmpty());
    }

    // S5 §1:area 法池贡献基数 = Σ租金计费行(area+IFNULL(area_shared,0)),不再取 contract.rent_area。
    // 两条 rent 行(100+公摊50 / 200 无公摊)→ 基数 350;旧口径 rent_area=Σarea=300 会摊出 300.00。独占槽 2091-02。
    @Test
    void areaPool_baseIncludesAreaShared() throws Exception {
        String ym = "2091-02";
        int t = postId("/api/tenants", "{\"companyName\":\"IT公摊面积户\",\"businessType\":\"IT\"}");
        String buildings = mvc.perform(get("/api/buildings").header("Authorization", auth()))
                .andReturn().getResponse().getContentAsString();
        int bid = ((java.util.List<Integer>) JsonPath.read(buildings, "$.data[*].id")).get(0);
        // S8 起面积基数按账期取(covers),合同须带起止日期;显式成员 + 池无 buildingId → 走 areaByTenant 路径
        postId("/api/contracts", "{\"contractNo\":\"IT-S5A-" + System.nanoTime() + "\",\"tenantId\":" + t
                + ",\"buildingId\":" + bid + ",\"status\":\"active\","
                + "\"startDate\":\"2091-01-01\",\"endDate\":\"2093-12-31\",\"billingLines\":["
                + "{\"propertyType\":\"factory\",\"location\":\"IT-A段\",\"feeKey\":\"rent_factory\",\"area\":100,\"areaShared\":50,\"unitPrice\":10},"
                + "{\"propertyType\":\"factory\",\"location\":\"IT-B段\",\"feeKey\":\"rent_factory\",\"area\":200,\"unitPrice\":10}]}");
        int m = postId("/api/meters", "{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT公摊面积池表\",\"ownership\":\"share\"}");
        reading(m, ym, "0", "700");
        postId("/api/alloc/rules", "{\"zone\":\"p1\",\"name\":\"IT公摊面积池\",\"method\":\"area\","
                + "\"coefficient\":700,\"feeKey\":\"share_elec_light\",\"meterIds\":[" + m + "],"
                + "\"members\":[{\"tenantId\":" + t + "}]}");
        price("elec_commercial", ym, "1");
        price("mgmt_fee_commercial", ym, "0");   // 钉死池单价=1.00,std=ROUND(700/700×1,2)=1.00 元/㎡
        price("elec_sharp", ym, "1"); price("elec_peak", ym, "1");
        price("elec_flat", ym, "1"); price("elec_valley", ym, "1");   // priceGate 全 zone 门禁
        mvc.perform(post("/api/alloc/generate").param("ym", ym).header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0));
        BigDecimal amt = alloc.resultByYm(ym).stream()
                .filter(r -> r.tenantId().equals(t) && "share_elec_light".equals(r.feeKey()))
                .map(AllocResultDTO::amount).findFirst().orElseThrow();
        assertEquals(0, amt.compareTo(new BigDecimal("350.00")), "基数应=350(含公摊50),实摊 " + amt);
    }

    // S8:area/floor 池的户面积基数=当月覆盖合同(MeterBindingService.covers),不是 status='active' 全集。
    // 病根:续签两段同时 active → 面积翻倍(实测宏玥 257.30→514.60、旭化成 6 段叠成 4511.60)。
    // 三条断言:①续签双计只算一份 ②楼栋级池只吃该栋合同 ③缺起止日期合同=判不出在租→面积 0 不摊。
    // 独占槽 2091-07。
    @Test
    void areaPool_baseIsCoveringNotActive() throws Exception {
        String ym = "2091-07";
        int t = postId("/api/tenants", "{\"companyName\":\"IT账期面积户\",\"businessType\":\"IT\"}");
        int t2 = postId("/api/tenants", "{\"companyName\":\"IT缺日期面积户\",\"businessType\":\"IT\"}");
        String buildings = mvc.perform(get("/api/buildings").header("Authorization", auth()))
                .andReturn().getResponse().getContentAsString();
        java.util.List<Integer> bids = JsonPath.read(buildings, "$.data[*].id");
        int b0 = bids.get(0), b1 = bids.get(1);
        // 续签两段同时 active:段① 覆盖 2091-07,段② 不覆盖 —— 旧口径两段都算 → 基数 200
        contract(t, b0, "2091-01-01", "2091-07-31", 100);
        contract(t, b0, "2091-08-01", "2094-07-31", 100);
        contract(t, b1, "2091-01-01", "2094-07-31", 500);   // 外栋合同:楼栋级池不许吃
        contract(t2, b0, null, null, 200);                  // 缺起止日期:active 但判不出在租
        int m = postId("/api/meters", "{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT账期面积池表\",\"ownership\":\"share\"}");
        reading(m, ym, "0", "100");
        postId("/api/alloc/rules", "{\"zone\":\"p1\",\"name\":\"IT账期面积池\",\"method\":\"area\",\"buildingId\":" + b0
                + ",\"coefficient\":100,\"feeKey\":\"share_elec_light\",\"meterIds\":[" + m + "],"
                + "\"members\":[{\"tenantId\":" + t + "},{\"tenantId\":" + t2 + "}]}");
        price("elec_commercial", ym, "1");
        price("mgmt_fee_commercial", ym, "0");   // std=ROUND(100/100×1,2)=1.00 元/㎡
        price("elec_sharp", ym, "1"); price("elec_peak", ym, "1");
        price("elec_flat", ym, "1"); price("elec_valley", ym, "1");
        mvc.perform(post("/api/alloc/generate").param("ym", ym).header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0));

        Map<Integer, BigDecimal> got = new HashMap<>();
        for (AllocResultDTO r : alloc.resultByYm(ym))
            if ("share_elec_light".equals(r.feeKey())) got.put(r.tenantId(), r.amount());
        assertEquals(0, got.get(t).compareTo(new BigDecimal("100.00")),
                "应只算当月覆盖的那一段 100㎡(双计=200,跨栋=600),实摊 " + got.get(t));
        assertNull(got.get(t2), "缺起止日期合同判不出在租,面积基数=0 不参与分摊");
    }

    private void contract(int tenantId, int buildingId, String start, String end, int area) throws Exception {
        postId("/api/contracts", "{\"contractNo\":\"IT-S8-" + System.nanoTime() + "\",\"tenantId\":" + tenantId
                + ",\"buildingId\":" + buildingId + ",\"status\":\"active\","
                + (start == null ? "" : "\"startDate\":\"" + start + "\",\"endDate\":\"" + end + "\",")
                + "\"billingLines\":[{\"propertyType\":\"factory\",\"location\":\"IT-S8段\","
                + "\"feeKey\":\"rent_factory\",\"area\":" + area + ",\"unitPrice\":10}]}");
    }
}

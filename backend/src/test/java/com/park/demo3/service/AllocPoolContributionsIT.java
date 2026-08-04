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
// 独占槽 2095-03(2095-04 仅作无快照只读探针,全库无数据落该月)。
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
}

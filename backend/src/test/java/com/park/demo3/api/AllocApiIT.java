package com.park.demo3.api;

import com.jayway.jsonpath.JsonPath;
import com.park.demo3.AbstractMysqlIT;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// 公摊分摊(PB-ALLOCATION-SPEC):规则 CRUD 守卫、生成快照/幂等/manual 保留/缺抄警告、
// 抽屉 stale、损耗链、对账派生、elec-cost 桥。@Transactional 回滚;写数据用 2099 远期槽;
// 各用例自建自证无顺序依赖(探针模式)。锚点复现:H48=302.5(floor)/AC15 标准 0.02→F8 户金额(area)。
@AutoConfigureMockMvc
@org.springframework.transaction.annotation.Transactional
class AllocApiIT extends AbstractMysqlIT {

    @Autowired MockMvc mvc;
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

    private int createTenant(String name) throws Exception {
        return postId("/api/tenants", "{\"companyName\":\"" + name + "\",\"businessType\":\"IT\"}");
    }

    private int createMeter(String name, String zone, String ownership, Integer tenantId, Integer buildingId) throws Exception {
        return postId("/api/meters", "{\"kind\":\"elec\",\"zone\":\"" + zone + "\",\"name\":\"" + name + "\""
                + ",\"ownership\":\"" + ownership + "\""
                + (tenantId == null ? "" : ",\"tenantId\":" + tenantId)
                + (buildingId == null ? "" : ",\"buildingId\":" + buildingId) + "}");
    }

    private void reading(int meterId, String ym, String prev, String curr) throws Exception {
        mvc.perform(post("/api/meters/readings").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"meterId\":" + meterId + ",\"ym\":\"" + ym + "\",\"prevTotal\":" + prev + ",\"currTotal\":" + curr + "}"))
                .andExpect(jsonPath("$.code").value(0));
    }

    // ── 规则 CRUD + 删除守卫 + 生成锚点(floor:H48=302.5 元/层×weight) ──
    @Test
    void ruleCrud_generate_floorAnchor_deleteGuard() throws Exception {
        int t1 = createTenant("IT分摊户甲");
        int t2 = createTenant("IT分摊户乙");
        int m = createMeter("IT楼梯间灯", "p1", "share", null, null);
        reading(m, "2099-01", "0", "644.5");   // 用量 644.5,+extra 170 → 全额 907.49,/3 层=302.50(AC43 锚)
        int rule = postId("/api/alloc/rules", "{\"zone\":\"p1\",\"name\":\"IT B座楼梯间\",\"method\":\"floor\","
                + "\"coefficient\":3,\"extraQty\":170,\"feeKey\":\"share_elec_floor\",\"meterIds\":[" + m + "],"
                + "\"members\":[{\"tenantId\":" + t1 + ",\"weight\":1},{\"tenantId\":" + t2 + ",\"weight\":0.5}]}");
        // 规则列表携 meterIds+members;zone 过滤
        mvc.perform(get("/api/alloc/rules").param("zone", "p1").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.id==" + rule + ")].meterIds[0]").value(m))
                .andExpect(jsonPath("$.data[?(@.id==" + rule + ")].members.length()").value(2));
        // area/floor 无系数 400;direct 受益人≠1 户 400
        mvc.perform(post("/api/alloc/rules").header("Authorization", auth()).contentType("application/json")
                .content("{\"zone\":\"p1\",\"name\":\"IT坏规则\",\"method\":\"floor\",\"feeKey\":\"share_elec_floor\"}"))
                .andExpect(jsonPath("$.code").value(400));
        mvc.perform(post("/api/alloc/rules").header("Authorization", auth()).contentType("application/json")
                .content("{\"zone\":\"p1\",\"name\":\"IT坏整笔\",\"method\":\"direct\",\"feeKey\":\"share_elec_fire\",\"members\":[]}"))
                .andExpect(jsonPath("$.code").value(400));
        // 生成:H48 型每户一份=302.50;对半 weight=0.5 → 151.25;rate_snap=元/层
        mvc.perform(post("/api/alloc/generate").param("ym", "2099-01").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows").value(2))
                .andExpect(jsonPath("$.data.tenants").value(2));
        mvc.perform(get("/api/alloc/result").param("ym", "2099-01").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.tenantId==" + t1 + ")].amount").value(302.50))
                .andExpect(jsonPath("$.data[?(@.tenantId==" + t2 + ")].amount").value(151.25))
                .andExpect(jsonPath("$.data[?(@.tenantId==" + t1 + ")].rateSnap").value(302.50))
                .andExpect(jsonPath("$.data[?(@.tenantId==" + t1 + ")].source").value("gen"));
        // 有结果删规则 409
        mvc.perform(delete("/api/alloc/rules/" + rule).header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(409));
        // 年份数据驱动含 2099
        mvc.perform(get("/api/alloc/years").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@==2099)]").exists());
    }

    // ── 重生成幂等 + manual 保留 + 缺抄警告 + 快照不漂移(读数改 → 抽屉 stale) ──
    @Test
    void regen_idempotent_manualKept_staleFlag() throws Exception {
        int t1 = createTenant("IT快照户");
        int m = createMeter("IT电梯", "p1", "share", null, null);
        int mMiss = createMeter("IT缺抄表", "p1", "share", null, null);   // 无读数 → 缺抄警告
        reading(m, "2099-02", "0", "100");
        postId("/api/alloc/rules", "{\"zone\":\"p1\",\"name\":\"IT直归\",\"method\":\"direct\","
                + "\"feeKey\":\"share_elec_elevator\",\"meterIds\":[" + m + "," + mMiss + "],"
                + "\"members\":[{\"tenantId\":" + t1 + "}]}");
        // manual 行(孵化协议固定收取型)先落
        mvc.perform(post("/api/alloc/result/manual").header("Authorization", auth()).contentType("application/json")
                .content("{\"tenantId\":" + t1 + ",\"ym\":\"2099-02\",\"feeKey\":\"share_elec_fire\",\"amount\":63.8,\"note\":\"孵化协议固定收取\"}"))
                .andExpect(jsonPath("$.code").value(0));
        // 生成:direct=用量×价 全额 100×1.11417=111.42(种子 price_flat);缺抄表入 warnings;manual 保留
        mvc.perform(post("/api/alloc/generate").param("ym", "2099-02").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows").value(1))
                .andExpect(jsonPath("$.data.manualKept").value(1))
                .andExpect(jsonPath("$.data.warnings[0]").value(org.hamcrest.Matchers.containsString("缺抄")));
        mvc.perform(get("/api/alloc/result").param("ym", "2099-02").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.length()").value(2))
                .andExpect(jsonPath("$.data[?(@.feeKey=='share_elec_elevator')].amount").value(111.42))
                .andExpect(jsonPath("$.data[?(@.feeKey=='share_elec_fire')].amount").value(63.8))
                .andExpect(jsonPath("$.data[?(@.feeKey=='share_elec_fire')].source").value("manual"));
        // 重生成幂等:行数不翻倍,manual 仍在
        mvc.perform(post("/api/alloc/generate").param("ym", "2099-02").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows").value(1));
        mvc.perform(get("/api/alloc/result").param("ym", "2099-02").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.length()").value(2));
        // 读数变化不回溯已生成金额(快照);抽屉现算标 stale
        String rid = mvc.perform(get("/api/meters/" + m + "/readings").header("Authorization", auth()))
                .andReturn().getResponse().getContentAsString();
        int readingId = JsonPath.read(rid, "$.data[0].id");
        mvc.perform(put("/api/meters/readings/" + readingId).header("Authorization", auth())
                .contentType("application/json")
                .content("{\"meterId\":" + m + ",\"ym\":\"2099-02\",\"prevTotal\":0,\"currTotal\":200}"))
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(get("/api/alloc/result").param("ym", "2099-02").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.feeKey=='share_elec_elevator')].amount").value(111.42));   // 不漂移
        mvc.perform(get("/api/alloc/result/" + t1).param("ym", "2099-02").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.feeKey=='share_elec_elevator')].stale").value(true))
                .andExpect(jsonPath("$.data[?(@.feeKey=='share_elec_elevator')].liveAmount").value(222.83))
                .andExpect(jsonPath("$.data[?(@.feeKey=='share_elec_fire')].stale").value(false));
        // gen 行不可单删 409;manual 行可删
        String all = mvc.perform(get("/api/alloc/result").param("ym", "2099-02").header("Authorization", auth()))
                .andReturn().getResponse().getContentAsString();
        int genId = ((java.util.List<Integer>) JsonPath.read(all, "$.data[?(@.source=='gen')].id")).get(0);
        int manId = ((java.util.List<Integer>) JsonPath.read(all, "$.data[?(@.source=='manual')].id")).get(0);
        mvc.perform(delete("/api/alloc/result/" + genId).header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(409));
        mvc.perform(delete("/api/alloc/result/" + manId).header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0));
    }

    // ── area 锚点(AC15 标准 0.02 元/㎡ → F8 户金额=标准×面积) + 损耗链 + 对账派生 ──
    @Test
    void area_lossChain_recon() throws Exception {
        int b = postId("/api/buildings", "{\"name\":\"IT-PB-A座\",\"phase\":1,\"floorCount\":5,"
                + "\"totalArea\":10000,\"rentableArea\":9000}");
        int t1 = createTenant("IT损耗户");
        int t2 = createTenant("IT面积户");
        postId("/api/contracts", "{\"contractNo\":\"IT-PB-C1\",\"tenantId\":" + t2 + ",\"buildingId\":" + b
                + ",\"rentArea\":120,\"status\":\"active\"}");
        // area 规则:用量 31.2 → 全额 34.76,/1734.73=0.02 元/㎡(AC15 锚)→ 户金额 0.02×120=2.40(F8 型)
        int mArea = createMeter("IT路灯", "p1", "share", null, null);
        reading(mArea, "2099-05", "0", "31.2");
        postId("/api/alloc/rules", "{\"zone\":\"p1\",\"name\":\"IT园区路灯\",\"method\":\"area\","
                + "\"coefficient\":1734.73,\"feeKey\":\"share_elec_light\",\"meterIds\":[" + mArea + "],"
                + "\"members\":[{\"tenantId\":" + t2 + "}]}");
        // 损耗链:总表 C=40000,分表Σ D=36000(户内 1000+公共 35000) → E=−4000;
        // loss 规则用量 520.8 → G=520.8/6=86.8(park_share_div 种子);adjQty=−1500,adjRate=0.003
        // I=−r4((−4000−86.8+1500)/40000)+0.003=0.0647+0.003=0.0677;户损耗=r2(1000×0.0677×1.11417)=75.43
        int mInfra = createMeter("IT总表", "p1", "infra", null, b);
        int mTen = createMeter("IT户内表", "p1", "tenant", t1, b);
        int mShare = createMeter("IT公共表", "p1", "share", null, b);
        int mLoss = createMeter("IT园区公共电", "p1", "share", null, null);   // 园区级,不挂楼栋
        reading(mInfra, "2099-05", "0", "40000");
        reading(mTen, "2099-05", "0", "1000");
        reading(mShare, "2099-05", "0", "35000");
        reading(mLoss, "2099-05", "0", "520.8");
        postId("/api/alloc/rules", "{\"zone\":\"p1\",\"name\":\"IT园区公共电\",\"method\":\"loss\","
                + "\"feeKey\":\"share_elec_loss\",\"meterIds\":[" + mLoss + "]}");
        mvc.perform(put("/api/alloc/cfg").header("Authorization", auth()).contentType("application/json")
                .content("{\"scope\":\"building:" + b + "\",\"cfgKey\":\"loss_adj_qty\",\"value\":-1500}"))
                .andExpect(status().isOk());
        mvc.perform(put("/api/alloc/cfg").header("Authorization", auth()).contentType("application/json")
                .content("{\"scope\":\"building:" + b + "\",\"cfgKey\":\"loss_adj_rate\",\"value\":0.003}"))
                .andExpect(status().isOk());
        mvc.perform(post("/api/alloc/generate").param("ym", "2099-05").header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(get("/api/alloc/result").param("ym", "2099-05").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.feeKey=='share_elec_light')].amount").value(2.40))
                .andExpect(jsonPath("$.data[?(@.feeKey=='share_elec_loss')].amount").value(75.43))
                .andExpect(jsonPath("$.data[?(@.feeKey=='share_elec_loss')].rateSnap").value(0.0677))
                .andExpect(jsonPath("$.data[?(@.feeKey=='share_elec_loss')].tenantName").value("IT损耗户"));
        // 对账(读时派生):损耗率表行 + 规则行(成本=全额 34.76,已分摊=2.40,差额=舍入差+未覆盖面积) + 互认合计
        mvc.perform(get("/api/alloc/recon").param("ym", "2099-05").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.lossRows[0].headQty").value(40000.0))
                .andExpect(jsonPath("$.data.lossRows[0].subQty").value(36000.0))
                .andExpect(jsonPath("$.data.lossRows[0].lossQty").value(-4000.0))
                .andExpect(jsonPath("$.data.lossRows[0].rawRate").value(-0.1))
                .andExpect(jsonPath("$.data.lossRows[0].tenantRate").value(0.0677))
                .andExpect(jsonPath("$.data.rows[?(@.name=='IT园区路灯')].costAmount").value(34.76))
                .andExpect(jsonPath("$.data.rows[?(@.name=='IT园区路灯')].allocated").value(2.40))
                .andExpect(jsonPath("$.data.rows[?(@.name=='一期损耗')].qty").value(-4000.0))
                .andExpect(jsonPath("$.data.allocSum").value(77.83));
        // 参数月行优先:当月 price_flat 覆盖默认 → 抽屉现算金额随月价变(默认行不动)
        mvc.perform(put("/api/alloc/cfg").header("Authorization", auth()).contentType("application/json")
                .content("{\"scope\":\"p1\",\"cfgKey\":\"price_flat\",\"acctMonth\":\"2099-05\",\"value\":2}"))
                .andExpect(status().isOk());
        mvc.perform(get("/api/alloc/cfg").param("ym", "2099-05").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.scope=='p1'&&@.cfgKey=='price_flat'&&@.acctMonth=='2099-05')].value").value(2.0))
                .andExpect(jsonPath("$.data[?(@.scope=='p1'&&@.cfgKey=='price_flat'&&@.acctMonth=='')]").exists());
    }

    // ── elec-cost 桥:有分摊数据月「分摊额度」=alloc_result Σ 真值;无数据月回退 ×50% 假设不变 ──
    @Test
    void elecCostBridge_realAllocOverridesAssumption() throws Exception {
        int t = createTenant("IT桥测户");
        // 2099-03 有分摊结果(manual 行即成立,桥只看Σ);2099-04 无
        mvc.perform(post("/api/alloc/result/manual").header("Authorization", auth()).contentType("application/json")
                .content("{\"tenantId\":" + t + ",\"ym\":\"2099-03\",\"feeKey\":\"share_elec_fire\",\"amount\":888.88}"))
                .andExpect(jsonPath("$.code").value(0));
        for (String m : new String[]{"03", "04"})
            mvc.perform(post("/api/utilities/13/records").header("Authorization", auth()).contentType("application/json")
                    .content("{\"scheduleNo\":13,\"acctMonth\":\"2099-" + m + "\",\"belongMonth\":\"2099-" + m + "\","
                            + "\"elecQty\":1000,\"elecPrice\":1}"))
                    .andExpect(jsonPath("$.code").value(0));
        mvc.perform(post("/api/elec-cost/simulate").param("year", "2099").header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0));
        // 2099-03:办公用电 allocated=888.88(P-B 真值),4 运营表无 allocated 假设行
        mvc.perform(get("/api/elec-cost/entries").param("year", "2099").param("month", "3").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.meterName=='办公用电'&&@.feeKey=='allocated')].amount").value(888.88))
                .andExpect(jsonPath("$.data[?(@.meterName=='水泵房'&&@.feeKey=='allocated')]").doesNotExist());
        // 2099-04(无分摊数据):回退 费用×50% 假设(办公 500,水泵房 800×50%=400)
        mvc.perform(get("/api/elec-cost/entries").param("year", "2099").param("month", "4").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.meterName=='办公用电'&&@.feeKey=='allocated')].amount").value(500.0))
                .andExpect(jsonPath("$.data[?(@.meterName=='水泵房'&&@.feeKey=='allocated')].amount").value(400.0));
    }

    // ── 鉴权门:无 token 401;viewer 读 200 写 403 ──
    @Test
    void auth_noToken401_viewerReadOnly() throws Exception {
        mvc.perform(get("/api/alloc/rules")).andExpect(status().isUnauthorized());
        String body = mvc.perform(post("/api/auth/login").contentType("application/json")
                .content("{\"username\":\"viewer\",\"password\":\"viewer123\"}"))
                .andReturn().getResponse().getContentAsString();
        String viewer = JsonPath.read(body, "$.data.token");
        mvc.perform(get("/api/alloc/rules").header("Authorization", "Bearer " + viewer))
                .andExpect(status().isOk());
        mvc.perform(post("/api/alloc/generate").param("ym", "2099-01").header("Authorization", "Bearer " + viewer))
                .andExpect(status().isForbidden());
    }
}

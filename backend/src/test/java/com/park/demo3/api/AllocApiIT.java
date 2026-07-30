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

    // 价目簿月行(池引擎门禁:电价月推键缺当月→整zone拒绝生成)
    private void price(String cfgKey, String ym, String value) throws Exception {
        mvc.perform(put("/api/price-cfg").header("Authorization", auth()).contentType("application/json")
                .content("{\"scope\":\"\",\"cfgKey\":\"" + cfgKey + "\",\"acctMonth\":\"" + ym + "\",\"value\":" + value + "}"))
                .andExpect(status().isOk());
    }

    // V65 种子后 p2 规则常驻 → 任意月生成需分时四键(门禁按 zone 全量校验)
    private void p2Prices(String ym) throws Exception {
        price("elec_sharp", ym, "1.50076875");
        price("elec_peak", ym, "1.20606875");
        price("elec_flat", ym, "0.72076875");
        price("elec_valley", ym, "0.29116875");
    }

    private void allocCfg(String scope, String key, String value) throws Exception {
        mvc.perform(put("/api/alloc/cfg").header("Authorization", auth()).contentType("application/json")
                .content("{\"scope\":\"" + scope + "\",\"cfgKey\":\"" + key + "\",\"value\":" + value + "}"))
                .andExpect(status().isOk());
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
        // 生成:H48 型每户一份=302.50;对半 weight=0.5 → 151.25;rate_snap=元/层(池引擎门禁需当月电价)
        price("elec_commercial", "2099-01", "0.79416875");
        p2Prices("2099-01");
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
        price("elec_commercial", "2099-02", "0.79416875");
        p2Prices("2099-02");
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
        // 园区公摊池=fee_key='park_loss_pool'(V64 口径:G 基数按该费键池净量Σ/park_share_div)
        postId("/api/alloc/rules", "{\"zone\":\"p1\",\"name\":\"IT园区公共电\",\"method\":\"loss\","
                + "\"feeKey\":\"park_loss_pool\",\"meterIds\":[" + mLoss + "]}");
        mvc.perform(put("/api/alloc/cfg").header("Authorization", auth()).contentType("application/json")
                .content("{\"scope\":\"building:" + b + "\",\"cfgKey\":\"loss_adj_qty\",\"value\":-1500}"))
                .andExpect(status().isOk());
        mvc.perform(put("/api/alloc/cfg").header("Authorization", auth()).contentType("application/json")
                .content("{\"scope\":\"building:" + b + "\",\"cfgKey\":\"loss_adj_rate\",\"value\":0.003}"))
                .andExpect(status().isOk());
        price("elec_commercial", "2099-05", "0.79416875");
        p2Prices("2099-05");
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

    // ── 池引擎(POOL-ENGINE-SPEC):门禁 → 快照 → 幂等 → 读数重导不漂移(p1,2099-06) ──
    @Test
    void poolEngine_gate_snapshot_idempotent_noDrift() throws Exception {
        int t = createTenant("IT池户");
        int m = createMeter("IT池货梯", "p1", "share", null, null);
        reading(m, "2099-06", "0", "100");
        int rule = postId("/api/alloc/rules", "{\"zone\":\"p1\",\"name\":\"IT池B座货梯\",\"method\":\"floor\","
                + "\"coefficient\":3,\"extraQty\":170,\"feeKey\":\"share_elec_floor\",\"meterIds\":[" + m + "],"
                + "\"members\":[{\"tenantId\":" + t + ",\"weight\":1}]}");
        // 门禁:缺当月商业电价 → 整zone 400
        mvc.perform(post("/api/alloc/generate").param("ym", "2099-06").header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(400));
        // 无快照月:generated=false,config 行仍返回且数值列 null(V65 种子常驻 → 按 ruleId 过滤断言)
        String my = "$.data.rows[?(@.ruleId==" + rule + ")]";
        mvc.perform(get("/api/alloc/pools").param("ym", "2099-06").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.generated").value(false))
                .andExpect(jsonPath(my + ".name").value("IT池B座货梯"))
                .andExpect(jsonPath(my + ".meters[0].sign").value(1))
                .andExpect(jsonPath(my + ".groupLabel").value("园区级"));
        price("elec_commercial", "2099-06", "0.79416875");
        p2Prices("2099-06");
        mvc.perform(post("/api/alloc/generate").param("ym", "2099-06").header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0));
        // 快照:AB=0.79416875+0.32;cost=r2(100×AB)=111.42(不含加度);std=ROUND((100+170)/3×AB,2)=100.28
        mvc.perform(get("/api/alloc/pools").param("ym", "2099-06").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.generated").value(true))
                .andExpect(jsonPath(my + ".qtyTotal").value(100.0))
                .andExpect(jsonPath(my + ".extraQty").value(170.0))
                .andExpect(jsonPath(my + ".costAmount").value(111.42))
                .andExpect(jsonPath(my + ".stdValue").value(100.28))
                .andExpect(jsonPath(my + ".priceSnap").value(1.11416875));
        // 幂等:重复生成行数不翻倍(本规则仍恰一行)
        mvc.perform(post("/api/alloc/generate").param("ym", "2099-06").header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0));
        String pools = mvc.perform(get("/api/alloc/pools").param("ym", "2099-06").header("Authorization", auth()))
                .andReturn().getResponse().getContentAsString();
        org.junit.jupiter.api.Assertions.assertEquals(1,
                ((java.util.List<?>) JsonPath.read(pools, my)).size());
        // 快照不随读数重导漂移:改读数后 pools 仍旧值;重新生成才更新
        String rid = mvc.perform(get("/api/meters/" + m + "/readings").header("Authorization", auth()))
                .andReturn().getResponse().getContentAsString();
        int readingId = JsonPath.read(rid, "$.data[0].id");
        mvc.perform(put("/api/meters/readings/" + readingId).header("Authorization", auth())
                .contentType("application/json")
                .content("{\"meterId\":" + m + ",\"ym\":\"2099-06\",\"prevTotal\":0,\"currTotal\":200}"))
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(get("/api/alloc/pools").param("ym", "2099-06").header("Authorization", auth()))
                .andExpect(jsonPath(my + ".costAmount").value(111.42));
        mvc.perform(post("/api/alloc/generate").param("ym", "2099-06").header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(get("/api/alloc/pools").param("ym", "2099-06").header("Authorization", auth()))
                .andExpect(jsonPath(my + ".costAmount").value(222.83));
    }

    // ── 损耗单元快照+对账读时派生(p1,2099-07):variant 配置驱动/G=park池/6+g_adj/loss_recon 排除 ──
    @Test
    void poolLoss_units_recon_variant() throws Exception {
        int b1 = postId("/api/buildings", "{\"name\":\"IT-PE-A座\",\"phase\":1,\"floorCount\":5,"
                + "\"totalArea\":10000,\"rentableArea\":9000}");
        int b2 = postId("/api/buildings", "{\"name\":\"IT-PE-B座\",\"phase\":1,\"floorCount\":5,"
                + "\"totalArea\":10000,\"rentableArea\":9000}");
        int t = createTenant("IT损耗池户");
        int mInfra1 = createMeter("IT-PE总表A", "p1", "infra", null, b1);
        int mTen1 = createMeter("IT-PE户表A", "p1", "tenant", t, b1);
        int mInfra2 = createMeter("IT-PE总表B", "p1", "infra", null, b2);
        int mTen2 = createMeter("IT-PE户表B", "p1", "tenant", t, b2);
        int mPark = createMeter("IT-PE园区公共", "p1", "share", null, null);
        int mSupply = createMeter("IT-PE供电局总表", "p1", "ops", null, null);
        reading(mInfra1, "2099-07", "0", "1000");
        reading(mTen1, "2099-07", "0", "900");     // E1=-100
        reading(mInfra2, "2099-07", "0", "500");
        reading(mTen2, "2099-07", "0", "520");     // E2=+20(share_only 配置驱动,不按符号)
        reading(mPark, "2099-07", "0", "520.82");  // G基数=ROUND(520.82/6,2)=86.80(park_share_div 种子)
        reading(mSupply, "2099-07", "0", "1600");
        postId("/api/alloc/rules", "{\"zone\":\"p1\",\"name\":\"IT-PE园区公摊池\",\"method\":\"loss\","
                + "\"feeKey\":\"park_loss_pool\",\"meterIds\":[" + mPark + "]}");
        allocCfg("building:" + b1, "loss_g_adj", "-50");     // b1 G=86.8-50=36.8
        allocCfg("building:" + b1, "loss_recon", "0");       // b1 独立供电链路,排除对账
        allocCfg("building:" + b2, "loss_variant", "1");     // b2=纯公摊式
        allocCfg("building:" + b2, "loss_adj_rate", "0.005");
        allocCfg("p1", "loss_supply_meter", String.valueOf(mSupply));
        price("elec_commercial", "2099-07", "0.79416875");
        p2Prices("2099-07");
        mvc.perform(post("/api/alloc/generate").param("ym", "2099-07").header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0));
        // b1 net:I=-r4((-100-36.8)/1000)=0.1368;b2 share_only:I=r4(86.8/500)+0.005=0.1786
        mvc.perform(get("/api/alloc/loss").param("ym", "2099-07").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.generated").value(true))
                .andExpect(jsonPath("$.data.units[?(@.headBuildingId==" + b1 + ")].label").value("IT-PE-A座"))
                .andExpect(jsonPath("$.data.units[?(@.headBuildingId==" + b1 + ")].variant").value("net"))
                .andExpect(jsonPath("$.data.units[?(@.headBuildingId==" + b1 + ")].cQty").value(1000.0))
                .andExpect(jsonPath("$.data.units[?(@.headBuildingId==" + b1 + ")].dQty").value(900.0))
                .andExpect(jsonPath("$.data.units[?(@.headBuildingId==" + b1 + ")].eQty").value(-100.0))
                .andExpect(jsonPath("$.data.units[?(@.headBuildingId==" + b1 + ")].rawRate").value(-0.1))
                .andExpect(jsonPath("$.data.units[?(@.headBuildingId==" + b1 + ")].gQty").value(36.8))
                .andExpect(jsonPath("$.data.units[?(@.headBuildingId==" + b1 + ")].tenantRate").value(0.1368))
                .andExpect(jsonPath("$.data.units[?(@.headBuildingId==" + b2 + ")].variant").value("share_only"))
                .andExpect(jsonPath("$.data.units[?(@.headBuildingId==" + b2 + ")].tenantRate").value(0.1786))
                // 对账:排除 b1 → sumC=500,sumD=520,vs 供电侧 1600
                .andExpect(jsonPath("$.data.recon[0].zone").value("p1"))
                .andExpect(jsonPath("$.data.recon[0].supplyQty").value(1600.0))
                .andExpect(jsonPath("$.data.recon[0].sumC").value(500.0))
                .andExpect(jsonPath("$.data.recon[0].sumD").value(520.0))
                .andExpect(jsonPath("$.data.recon[0].lossVsC").value(-1100.0))
                .andExpect(jsonPath("$.data.recon[0].rateVsC").value(-0.6875));
        // 无快照月:generated=false
        mvc.perform(get("/api/alloc/loss").param("ym", "2099-12").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.generated").value(false));
    }

    // ── p2 门禁(分时四键)+ ref 纯标准行 + fold_price 折入 + 环=409(2099-08) ──
    @Test
    void poolP2_gate_ref_fold_cycle() throws Exception {
        int t = createTenant("IT-P2池户");
        int m = createMeter("IT-PE二期电梯", "p2", "share", null, null);
        reading(m, "2099-08", "0", "100");
        int rA = postId("/api/alloc/rules", "{\"zone\":\"p2\",\"name\":\"IT-PE四车间电梯\",\"method\":\"floor\","
                + "\"coefficient\":6,\"feeKey\":\"share_elec_elevator\",\"meterIds\":[" + m + "],"
                + "\"members\":[{\"tenantId\":" + t + ",\"weight\":1}]}");
        // 缺分时四键 → 400
        mvc.perform(post("/api/alloc/generate").param("ym", "2099-08").header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(400));
        p2Prices("2099-08");
        price("elec_commercial", "2099-08", "0.79416875");   // V65 种子 p1/dorm 规则常驻,门禁需商业价
        // ref 行:同表,coefficient=18,fold_price←rA,std_add=100(rule 月参)
        int rB = postId("/api/alloc/rules", "{\"zone\":\"p2\",\"name\":\"IT-PE广联分摊\",\"method\":\"ref\","
                + "\"coefficient\":18,\"feeKey\":\"share_elec_elevator\","
                + "\"meters\":[{\"meterId\":" + m + ",\"sign\":1}],"
                + "\"links\":[{\"ruleId\":" + rA + ",\"type\":\"fold_price\"}]}");
        allocCfg("rule:" + rB, "std_add", "100");
        mvc.perform(post("/api/alloc/generate").param("ym", "2099-08").header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0));
        // 无分时段回退平价:unrounded=100×(0.72076875+0.16)=88.076875 → costA=88.08,stdA=ROUND(/6,2)=14.68
        // stdB=ROUND(88.076875/18,2)+14.68+100=119.57;ref 不出应分摊
        String pools = mvc.perform(get("/api/alloc/pools").param("ym", "2099-08").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows[?(@.ruleId==" + rA + ")].costAmount").value(88.08))
                .andExpect(jsonPath("$.data.rows[?(@.ruleId==" + rA + ")].stdValue").value(14.68))
                .andExpect(jsonPath("$.data.rows[?(@.ruleId==" + rB + ")].stdValue").value(119.57))
                .andExpect(jsonPath("$.data.rows[?(@.ruleId==" + rB + ")].links[0].ruleId").value(rA))
                .andExpect(jsonPath("$.data.rows[?(@.ruleId==" + rB + ")].links[0].type").value("fold_price"))
                .andReturn().getResponse().getContentAsString();
        // ref 只出 std 不出应分摊(不入合计)
        java.util.List<Object> costB = JsonPath.read(pools, "$.data.rows[?(@.ruleId==" + rB + ")].costAmount");
        org.junit.jupiter.api.Assertions.assertNull(costB.get(0));
        // 环:rA←rB 反向再挂 → 拓扑序检出 409
        mvc.perform(put("/api/alloc/rules/" + rA).header("Authorization", auth()).contentType("application/json")
                .content("{\"zone\":\"p2\",\"name\":\"IT-PE四车间电梯\",\"method\":\"floor\","
                        + "\"coefficient\":6,\"feeKey\":\"share_elec_elevator\",\"meterIds\":[" + m + "],"
                        + "\"members\":[{\"tenantId\":" + t + ",\"weight\":1}],"
                        + "\"links\":[{\"ruleId\":" + rB + ",\"type\":\"fold_price\"}]}"))
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(post("/api/alloc/generate").param("ym", "2099-08").header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(409));
    }

    // ── 平段兜底冲减锚点(五车间电梯型,2099-09):sign=-1 剔除表只有总读数无分时 → 总量从平段扣 ──
    // 读数=2024-02 真实值:头表倍率40 尖194.4/峰403.2/平1013.2/谷266.4(总1877.6),分表仅总670.06;
    // 期望 qtyTotal=1207.54/qtyFlat=343.14/cost=1238.78/std=ROUND(未舍/5.7,2)=217.33(W83/V83 锚)
    @Test
    void poolP2_netFlatFallback_w83Anchor() throws Exception {
        int t = createTenant("IT平段兜底户");
        int mHead = postId("/api/meters", "{\"kind\":\"elec\",\"zone\":\"p2\",\"name\":\"IT五车间电梯\","
                + "\"ownership\":\"share\",\"factor\":40}");
        int mSub = createMeter("IT火炬园广告字分表", "p2", "share", null, null);
        mvc.perform(post("/api/meters/readings").header("Authorization", auth()).contentType("application/json")
                .content("{\"meterId\":" + mHead + ",\"ym\":\"2099-09\",\"prevTotal\":1088.07,\"currTotal\":1135.01,"
                        + "\"prevSharp\":184.33,\"currSharp\":189.19,\"prevPeak\":246.99,\"currPeak\":257.07,"
                        + "\"prevFlat\":469.35,\"currFlat\":494.68,\"prevValley\":187.39,\"currValley\":194.05}"))
                .andExpect(jsonPath("$.code").value(0));
        reading(mSub, "2099-09", "3702.92", "4372.98");   // 仅总读数 670.06,无分时
        int rule = postId("/api/alloc/rules", "{\"zone\":\"p2\",\"name\":\"IT五车间电梯池\",\"method\":\"floor\","
                + "\"coefficient\":5.7,\"feeKey\":\"share_elec_elevator\","
                + "\"meters\":[{\"meterId\":" + mHead + ",\"sign\":1},{\"meterId\":" + mSub + ",\"sign\":-1}],"
                + "\"members\":[{\"tenantId\":" + t + ",\"weight\":1}]}");
        p2Prices("2099-09");
        price("elec_commercial", "2099-09", "0.79416875");
        mvc.perform(post("/api/alloc/generate").param("ym", "2099-09").header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0));
        String my = "$.data.rows[?(@.ruleId==" + rule + ")]";
        mvc.perform(get("/api/alloc/pools").param("ym", "2099-09").header("Authorization", auth()))
                .andExpect(jsonPath(my + ".qtyTotal").value(1207.54))
                .andExpect(jsonPath(my + ".qtySharp").value(194.4))
                .andExpect(jsonPath(my + ".qtyPeak").value(403.2))
                .andExpect(jsonPath(my + ".qtyFlat").value(343.14))
                .andExpect(jsonPath(my + ".qtyValley").value(266.4))
                .andExpect(jsonPath(my + ".costAmount").value(1238.78))
                .andExpect(jsonPath(my + ".stdValue").value(217.33));
    }

    // ── 损耗组结构(2099-10):loss_c_meter 只取指定总表/meter loss_exclude 剔除/variant=2 陈列不出率/
    //    供电侧总表挂栋(infra)不成组(B-G座总电真实档案范式,上轮修复补测) ──
    @Test
    void poolLoss_cMeter_variant2_meterExclude_supplyBound() throws Exception {
        int b1 = postId("/api/buildings", "{\"name\":\"IT-PG-A座\",\"phase\":1,\"floorCount\":5,"
                + "\"totalArea\":10000,\"rentableArea\":9000}");
        int b2 = postId("/api/buildings", "{\"name\":\"IT-PG-G座\",\"phase\":1,\"floorCount\":2,"
                + "\"totalArea\":1000,\"rentableArea\":900}");
        int t = createTenant("IT-PG户");
        int mC = createMeter("IT-PG总电", "p1", "infra", null, b1);
        int mC2 = createMeter("IT-PG自装总表", "p1", "infra", null, b1);
        int mTen = createMeter("IT-PG户表", "p1", "tenant", t, b1);
        int mEx = createMeter("IT-PG剔除表", "p1", "share", null, b1);
        int mSup = createMeter("IT-PG供电总表", "p1", "infra", null, b2);
        reading(mC, "2099-10", "0", "1000");
        reading(mC2, "2099-10", "0", "800");     // loss_c_meter 生效后不入C也不入D
        reading(mTen, "2099-10", "0", "900");
        reading(mEx, "2099-10", "0", "50");      // loss_exclude 生效后不入D
        reading(mSup, "2099-10", "0", "5000");   // 供电侧总表挂栋:只做对账供给边,b2 不成组
        allocCfg("building:" + b1, "loss_c_meter", String.valueOf(mC));
        allocCfg("building:" + b1, "loss_variant", "2");
        allocCfg("meter:" + mEx, "loss_exclude", "1");
        allocCfg("p1", "loss_supply_meter", String.valueOf(mSup));
        price("elec_commercial", "2099-10", "0.79416875");
        p2Prices("2099-10");
        mvc.perform(post("/api/alloc/generate").param("ym", "2099-10").header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0));
        String body = mvc.perform(get("/api/alloc/loss").param("ym", "2099-10").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.units[?(@.headBuildingId==" + b1 + ")].cQty").value(1000.0))
                .andExpect(jsonPath("$.data.units[?(@.headBuildingId==" + b1 + ")].dQty").value(900.0))
                .andExpect(jsonPath("$.data.units[?(@.headBuildingId==" + b1 + ")].eQty").value(-100.0))
                .andExpect(jsonPath("$.data.units[?(@.headBuildingId==" + b1 + ")].variant").value("none"))
                .andExpect(jsonPath("$.data.units[?(@.headBuildingId==" + b2 + ")]").isEmpty())
                .andExpect(jsonPath("$.data.recon[0].supplyQty").value(5000.0))
                .andExpect(jsonPath("$.data.recon[0].sumC").value(1000.0))
                .andExpect(jsonPath("$.data.recon[0].sumD").value(900.0))
                .andReturn().getResponse().getContentAsString();
        // variant=2 → 不出率(rate=null),户级不派生损耗费
        java.util.List<Object> rate = JsonPath.read(body,
                "$.data.units[?(@.headBuildingId==" + b1 + ")].tenantRate");
        org.junit.jupiter.api.Assertions.assertNull(rate.get(0));
        mvc.perform(get("/api/alloc/result").param("ym", "2099-10").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.feeKey=='share_elec_loss')]").isEmpty());
    }

    // ══ V69 池定位化(用户 2026-07-30 拍板:池名自动生成/受益人勾选+按月留痕/已分摊盈亏首次落库) ══

    private int building(String name) throws Exception {
        return postId("/api/buildings", "{\"name\":\"" + name + "\",\"phase\":1,\"floorCount\":5,"
                + "\"totalArea\":10000,\"rentableArea\":9000}");
    }

    private int unit(int buildingId, int floor, String unitNo) throws Exception {
        return postId("/api/buildings/" + buildingId + "/units",
                "{\"floor\":" + floor + ",\"unitNo\":\"" + unitNo + "\",\"area\":500}");
    }

    // 覆盖 2099 全年的在租合同(在租语义=非草稿+起止齐全+月区间重叠)
    private void contract(String no, int tenantId, int buildingId, Integer unitId) throws Exception {
        postId("/api/contracts", "{\"contractNo\":\"" + no + "\",\"tenantId\":" + tenantId
                + ",\"buildingId\":" + buildingId + (unitId == null ? "" : ",\"unitId\":" + unitId)
                + ",\"rentArea\":500,\"status\":\"active\","
                + "\"startDate\":\"2099-01-01\",\"endDate\":\"2099-12-31\"}");
    }

    private int locMeter(String name, int buildingId, String spot, String subName) throws Exception {
        return postId("/api/meters", "{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"" + name + "\","
                + "\"ownership\":\"share\",\"buildingId\":" + buildingId
                + ",\"spot\":\"" + spot + "\",\"subName\":\"" + subName + "\",\"meterType\":\"公共用电\"}");
    }

    // ── 池名由定位自动生成并覆盖入参(前端传的 name 忽略);改定位即改名 ──
    @Test
    void poolRule_autoNameFromLocation() throws Exception {
        int b = building("IT-V69-A座");
        int m = locMeter("IT-V69走廊灯表", b, "四楼西侧", "电表①");
        int rule = postId("/api/alloc/rules", "{\"zone\":\"p1\",\"name\":\"前端瞎传的名字\",\"method\":\"none\","
                + "\"feeKey\":\"share_elec_floor\",\"meterIds\":[" + m + "],\"buildingId\":" + b + ","
                + "\"floorLabel\":\"四楼\",\"side\":\"西侧\",\"feeName\":\"走廊灯\"}");
        String my = "$.data[?(@.id==" + rule + ")]";
        mvc.perform(get("/api/alloc/rules").param("zone", "p1").header("Authorization", auth()))
                .andExpect(jsonPath(my + ".name").value("IT-V69-A座·四楼西侧·走廊灯"))
                .andExpect(jsonPath(my + ".floorLabel").value("四楼"))
                .andExpect(jsonPath(my + ".side").value("西侧"))
                .andExpect(jsonPath(my + ".feeName").value("走廊灯"));
        // 改侧向 → 自动改名(租户换了池名也不会错,因为名字只由定位来)
        mvc.perform(put("/api/alloc/rules/" + rule).header("Authorization", auth()).contentType("application/json")
                .content("{\"zone\":\"p1\",\"name\":\"照旧瞎传\",\"method\":\"none\",\"feeKey\":\"share_elec_floor\","
                        + "\"meterIds\":[" + m + "],\"buildingId\":" + b + ",\"floorLabel\":\"四楼\","
                        + "\"side\":\"东侧\",\"feeName\":\"走廊灯\"}"))
                .andExpect(jsonPath("$.data.name").value("IT-V69-A座·四楼东侧·走廊灯"));
        // 楼栋空=按 zone 取期别前缀(V70:一期/二期/宿舍区各有一个「路灯」池,统一写"园区级"会撞名)
        int rPark = postId("/api/alloc/rules", "{\"zone\":\"p1\",\"method\":\"none\","
                + "\"feeKey\":\"share_elec_light\",\"meterIds\":[" + m + "],\"feeName\":\"IT-V69路灯\"}");
        mvc.perform(get("/api/alloc/rules").param("zone", "p1").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.id==" + rPark + ")].name").value("一期园区·IT-V69路灯"));
    }

    // ── pools 扩字段(定位/autoName/位置化表标签/受益人)+ 已分摊&盈亏回填 + 受益人月行覆盖 ──
    @Test
    void poolMembers_allocatedGap_monthOverride() throws Exception {
        int b = building("IT-V69-B座");
        int u = unit(b, 4, "401");
        int t1 = createTenant("IT-V69户甲");
        int t2 = createTenant("IT-V69户乙");
        contract("IT-V69-C1", t1, b, u);
        int m = locMeter("IT-V69四楼西侧灯", b, "四楼西侧", "电表①");
        reading(m, "2099-11", "0", "100");
        // floor 池:cost=r2(100×AB)=111.42;std=ROUND(100/1×AB,2)=111.42;户甲 weight=1 → 已分摊 111.42,盈亏 0
        int rule = postId("/api/alloc/rules", "{\"zone\":\"p1\",\"method\":\"floor\",\"coefficient\":1,"
                + "\"feeKey\":\"share_elec_floor\",\"meterIds\":[" + m + "],\"buildingId\":" + b + ","
                + "\"floorLabel\":\"四楼\",\"side\":\"西侧\",\"feeName\":\"走廊灯\","
                + "\"members\":[{\"tenantId\":" + t1 + ",\"weight\":1}]}");
        price("elec_commercial", "2099-11", "0.79416875");
        p2Prices("2099-11");
        mvc.perform(post("/api/alloc/generate").param("ym", "2099-11").header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0));
        String my = "$.data.rows[?(@.ruleId==" + rule + ")]";
        mvc.perform(get("/api/alloc/pools").param("ym", "2099-11").header("Authorization", auth()))
                .andExpect(jsonPath(my + ".buildingId").value(b))
                .andExpect(jsonPath(my + ".buildingName").value("IT-V69-B座"))
                .andExpect(jsonPath(my + ".floorLabel").value("四楼"))
                .andExpect(jsonPath(my + ".side").value("西侧"))
                .andExpect(jsonPath(my + ".feeName").value("走廊灯"))
                .andExpect(jsonPath(my + ".autoName").value("IT-V69-B座·四楼西侧·走廊灯"))
                .andExpect(jsonPath(my + ".meters[0].label").value("四楼西侧·电表①"))
                .andExpect(jsonPath(my + ".meters[0].spot").value("四楼西侧"))
                .andExpect(jsonPath(my + ".members[0].tenantId").value(t1))
                .andExpect(jsonPath(my + ".members[0].tenantName").value("IT-V69户甲"))
                .andExpect(jsonPath(my + ".members[0].unitNo").value("401"))
                .andExpect(jsonPath(my + ".members[0].inForce").value("yes"))
                .andExpect(jsonPath(my + ".members[0].src").value("default"))
                .andExpect(jsonPath(my + ".costAmount").value(111.42))
                .andExpect(jsonPath(my + ".allocatedAmount").value(111.42))
                .andExpect(jsonPath(my + ".gapAmount").value(0.0));
        // 户级出口(P-C 缴费单契约)同源同额
        mvc.perform(get("/api/alloc/result").param("ym", "2099-11").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.tenantId==" + t1 + "&&@.feeKey=='share_elec_floor')].amount").value(111.42));
        // 受益人月行覆盖:只写 2099-12 → 11 月仍是默认行户甲,12 月是户乙(src=month,未在租 inForce=false)
        mvc.perform(put("/api/alloc/rules/" + rule).header("Authorization", auth()).contentType("application/json")
                .content("{\"zone\":\"p1\",\"method\":\"floor\",\"coefficient\":1,\"feeKey\":\"share_elec_floor\","
                        + "\"meterIds\":[" + m + "],\"buildingId\":" + b + ",\"floorLabel\":\"四楼\","
                        + "\"side\":\"西侧\",\"feeName\":\"走廊灯\",\"memberMonth\":\"2099-12\","
                        + "\"members\":[{\"tenantId\":" + t2 + ",\"weight\":1}]}"))
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(get("/api/alloc/pools").param("ym", "2099-11").header("Authorization", auth()))
                .andExpect(jsonPath(my + ".members.length()").value(1))
                .andExpect(jsonPath(my + ".members[0].tenantId").value(t1))
                .andExpect(jsonPath(my + ".members[0].src").value("default"));
        mvc.perform(get("/api/alloc/pools").param("ym", "2099-12").header("Authorization", auth()))
                .andExpect(jsonPath(my + ".members.length()").value(1))
                .andExpect(jsonPath(my + ".members[0].tenantId").value(t2))
                .andExpect(jsonPath(my + ".members[0].src").value("month"))
                .andExpect(jsonPath(my + ".members[0].inForce").value("no"));
        // none 法不摊:全额挂亏(盈亏=−应分摊),验证四法分支
        int rNone = postId("/api/alloc/rules", "{\"zone\":\"p1\",\"method\":\"none\",\"feeKey\":\"share_elec_floor\","
                + "\"meterIds\":[" + m + "],\"buildingId\":" + b + ",\"feeName\":\"IT-V69不分摊\"}");
        mvc.perform(post("/api/alloc/generate").param("ym", "2099-11").header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(get("/api/alloc/pools").param("ym", "2099-11").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows[?(@.ruleId==" + rNone + ")].allocatedAmount").value(0.0))
                .andExpect(jsonPath("$.data.rows[?(@.ruleId==" + rNone + ")].gapAmount").value(-111.42));
    }

    // ── pool-candidates:表按定位过滤(位置化标签,不露内部标识名)+ 该定位在租租户预勾 ──
    @Test
    void poolCandidates_byLocation() throws Exception {
        int b = building("IT-V69-C座");
        int u4 = unit(b, 4, "402");
        unit(b, 3, "302");
        int t4 = createTenant("IT-V69四楼户");
        int t3 = createTenant("IT-V69三楼户");
        contract("IT-V69-C4", t4, b, u4);
        contract("IT-V69-C3", t3, b, null);   // 只挂栋无单元:整栋池能带出,四楼池带不出
        int mWest = locMeter("IT-V69C四西灯", b, "四楼西侧", "电表①");
        int mEast = locMeter("IT-V69C四东灯", b, "四楼东侧", "电表①");
        int mThird = locMeter("IT-V69C三西灯", b, "三楼西侧", "电表①");
        reading(mWest, "2099-11", "0", "60");
        String url = "/api/alloc/pool-candidates";
        mvc.perform(get(url).param("ym", "2099-11").param("buildingId", String.valueOf(b))
                        .param("floor", "四楼").param("side", "西侧").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.meters[?(@.meterId==" + mWest + ")].label").value("四楼西侧·电表①"))
                .andExpect(jsonPath("$.data.meters[?(@.meterId==" + mWest + ")].usage").value(60.0))
                .andExpect(jsonPath("$.data.meters[?(@.meterId==" + mWest + ")].ownership").value("share"))
                .andExpect(jsonPath("$.data.meters[?(@.meterId==" + mEast + ")]").isEmpty())
                .andExpect(jsonPath("$.data.meters[?(@.meterId==" + mThird + ")]").isEmpty())
                // 侧向不参与租户过滤(unit 无侧向字段,契约已注明):四楼在租=户甲,预勾
                .andExpect(jsonPath("$.data.tenants[?(@.tenantId==" + t4 + ")].preChecked").value(true))
                .andExpect(jsonPath("$.data.tenants[?(@.tenantId==" + t4 + ")].unitNo").value("402"))
                .andExpect(jsonPath("$.data.tenants[?(@.tenantId==" + t3 + ")]").isEmpty());
        // 楼层留空=整栋:三楼东侧两块表都是候选,只挂栋合同的户也带出
        mvc.perform(get(url).param("ym", "2099-11").param("buildingId", String.valueOf(b))
                        .header("Authorization", auth()))
                .andExpect(jsonPath("$.data.meters[?(@.meterId==" + mEast + ")].label").value("四楼东侧·电表①"))
                .andExpect(jsonPath("$.data.meters[?(@.meterId==" + mThird + ")]").isNotEmpty())
                .andExpect(jsonPath("$.data.tenants[?(@.tenantId==" + t3 + ")].preChecked").value(true));
    }

    // ── member-diff:该定位本月在租租户 与 池受益人 的差集(首次配置=全 added;走人的进 removed) ──
    @Test
    void memberDiff_addedRemoved() throws Exception {
        int b = building("IT-V69-D座");
        int u = unit(b, 4, "403");
        int tIn = createTenant("IT-V69在租户");
        int tGone = createTenant("IT-V69走了的户");
        contract("IT-V69-D1", tIn, b, u);
        int m = locMeter("IT-V69D四西灯", b, "四楼西侧", "电表①");
        int rule = postId("/api/alloc/rules", "{\"zone\":\"p1\",\"method\":\"floor\",\"coefficient\":1,"
                + "\"feeKey\":\"share_elec_floor\",\"meterIds\":[" + m + "],\"buildingId\":" + b + ","
                + "\"floorLabel\":\"四楼\",\"side\":\"西侧\",\"feeName\":\"走廊灯\","
                + "\"members\":[{\"tenantId\":" + tGone + ",\"weight\":1}]}");
        String my = "$.data[?(@.ruleId==" + rule + ")]";
        // 侧向池不产出 added(unit 无侧向字段,同层对侧的户报成"新在租"是瞎猜);removed 仍照出
        mvc.perform(get("/api/alloc/member-diff").param("ym", "2099-11").header("Authorization", auth()))
                .andExpect(jsonPath(my + ".poolName").value("IT-V69-D座·四楼西侧·走廊灯"))
                .andExpect(jsonPath(my + ".added[0]").isEmpty())
                .andExpect(jsonPath(my + ".removed[?(@.tenantId==" + tGone + ")].inForce").value("no"))
                .andExpect(jsonPath(my + ".removed[?(@.tenantId==" + tGone + ")].unitNo")
                        .value(org.hamcrest.Matchers.contains(org.hamcrest.Matchers.nullValue())));
        // 候选列表照旧列全楼层的户(给人勾用,不受 added 抑制影响)
        mvc.perform(get("/api/alloc/pool-candidates").param("ym", "2099-11")
                        .param("buildingId", String.valueOf(b)).param("floor", "四楼").param("side", "西侧")
                        .header("Authorization", auth()))
                .andExpect(jsonPath("$.data.tenants[?(@.tenantId==" + tIn + ")].inForce").value("yes"));
        // 无侧向的同层池:added 照常产出(定位可判定)
        int rNoSide = postId("/api/alloc/rules", "{\"zone\":\"p1\",\"method\":\"floor\",\"coefficient\":1,"
                + "\"feeKey\":\"share_elec_floor\",\"meterIds\":[" + m + "],\"buildingId\":" + b + ","
                + "\"floorLabel\":\"四楼\",\"feeName\":\"IT-V69整层灯\","
                + "\"members\":[{\"tenantId\":" + tGone + ",\"weight\":1}]}");
        mvc.perform(get("/api/alloc/member-diff").param("ym", "2099-11").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.ruleId==" + rNoSide + ")].added[?(@.tenantId==" + tIn + ")].unitNo")
                        .value("403"));
        // 缺起止日期的受益人:判不了在租 → 不算退租,不进 removed(旧口径写成"已退租")
        int tNoDate = createTenant("IT-V69缺日期户");
        postId("/api/contracts", "{\"contractNo\":\"IT-V69-D9\",\"tenantId\":" + tNoDate
                + ",\"buildingId\":" + b + ",\"rentArea\":500,\"status\":\"active\"}");
        mvc.perform(put("/api/alloc/rules/" + rule).header("Authorization", auth()).contentType("application/json")
                .content("{\"zone\":\"p1\",\"method\":\"floor\",\"coefficient\":1,\"feeKey\":\"share_elec_floor\","
                        + "\"meterIds\":[" + m + "],\"buildingId\":" + b + ",\"floorLabel\":\"四楼\","
                        + "\"side\":\"西侧\",\"feeName\":\"走廊灯\",\"members\":[{\"tenantId\":" + tNoDate + ",\"weight\":1}]}"))
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(get("/api/alloc/pools").param("ym", "2099-11").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.rows[?(@.ruleId==" + rule + ")].members[0].inForce").value("unknown"));
        // added 抑制 + removed 只收 'no' → 该池整条不进提醒条
        mvc.perform(get("/api/alloc/member-diff").param("ym", "2099-11").header("Authorization", auth()))
                .andExpect(jsonPath(my).isEmpty());
        // 生成时点名报数:缺日期户未进自动名册
        price("elec_commercial", "2099-11", "0.79416875");
        p2Prices("2099-11");
        mvc.perform(post("/api/alloc/generate").param("ym", "2099-11").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.warnings", org.hamcrest.Matchers.hasItem(
                        org.hamcrest.Matchers.containsString("户因合同缺起止日期无法判定是否在租,未进入自动在租名册参与分摊"))));
    }

    // ── 园区级池受益人 fallback(用户 2026-07-30 拍板):不勾人=该期全园在租名册自动摊 ──
    // 此前 building_id IS NULL 的池 members=0 → area 分支 for 空转,全额静默挂亏(实测 9 池 11194 元无声无息)。
    // 锚点:AB=1.11416875;cost=r2(100×AB)=111.42;std=ROUND(100/1000×AB,2)=0.11;两户各 500㎡ → 55.00×2,盈亏 −1.42
    @Test
    void poolParkLevel_autoMembers_explicitWins_warnWhenNobody() throws Exception {
        int b = building("IT-B2-A座");
        int tA = createTenant("IT-B2全园户甲");
        int tB = createTenant("IT-B2全园户乙");
        contract("IT-B2-C1", tA, b, unit(b, 4, "B2-401"));
        contract("IT-B2-C2", tB, b, unit(b, 4, "B2-402"));
        locMeter("IT-B2栋内公共表", b, "四楼西侧", "电表①");   // 该栋期别由栋内表的 zone 定(p1)
        int mPark = createMeter("IT-B2园区路灯", "p1", "share", null, null);   // 园区级:不挂栋
        reading(mPark, "2099-11", "0", "100");
        int rAuto = postId("/api/alloc/rules", "{\"zone\":\"p1\",\"method\":\"area\",\"coefficient\":1000,"
                + "\"feeKey\":\"share_elec_light\",\"meterIds\":[" + mPark + "],\"feeName\":\"IT-B2园区路灯\"}");
        // 楼栋级池不回退(受益人只能人工勾)→ 报出未摊金额:cost=r2(200×AB)=222.83
        int mBld = createMeter("IT-B2栋级无人池表", "p1", "share", null, null);
        reading(mBld, "2099-11", "0", "200");
        int rNobody = postId("/api/alloc/rules", "{\"zone\":\"p1\",\"method\":\"area\",\"coefficient\":1000,"
                + "\"feeKey\":\"share_elec_floor\",\"meterIds\":[" + mBld + "],\"buildingId\":" + b + ","
                + "\"feeName\":\"IT-B2栋级无人池\"}");
        price("elec_commercial", "2099-11", "0.79416875");
        p2Prices("2099-11");
        mvc.perform(post("/api/alloc/generate").param("ym", "2099-11").header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.warnings", org.hamcrest.Matchers.hasItem(
                        org.hamcrest.Matchers.containsString("IT-B2栋级无人池」无受益人,应分摊 222.83 元未摊到户"))));
        String my = "$.data.rows[?(@.ruleId==" + rAuto + ")]";
        mvc.perform(get("/api/alloc/pools").param("ym", "2099-11").header("Authorization", auth()))
                .andExpect(jsonPath(my + ".autoMembers").value(true))
                .andExpect(jsonPath(my + ".members.length()").value(0))     // 自动=不列 130 个勾
                .andExpect(jsonPath(my + ".costAmount").value(111.42))
                .andExpect(jsonPath(my + ".stdValue").value(0.11))
                .andExpect(jsonPath(my + ".allocatedAmount").value(110.0))
                .andExpect(jsonPath(my + ".gapAmount").value(-1.42))
                .andExpect(jsonPath("$.data.rows[?(@.ruleId==" + rNobody + ")].autoMembers").value(false))
                .andExpect(jsonPath("$.data.rows[?(@.ruleId==" + rNobody + ")].allocatedAmount").value(0.0));
        mvc.perform(get("/api/alloc/result").param("ym", "2099-11").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.tenantId==" + tA + "&&@.feeKey=='share_elec_light')].amount").value(55.00))
                .andExpect(jsonPath("$.data[?(@.tenantId==" + tB + "&&@.feeKey=='share_elec_light')].amount").value(55.00));
        // member-diff 降噪:走 fallback 的池不进提醒条(否则全园在租户全被列成 added,真提醒被淹)
        mvc.perform(get("/api/alloc/member-diff").param("ym", "2099-11").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.ruleId==" + rAuto + ")]").isEmpty());
        // 显式勾了受益人 → 以显式为准(只摊户乙 55.00),且重回提醒条(户甲成 added)
        mvc.perform(put("/api/alloc/rules/" + rAuto).header("Authorization", auth()).contentType("application/json")
                .content("{\"zone\":\"p1\",\"method\":\"area\",\"coefficient\":1000,\"feeKey\":\"share_elec_light\","
                        + "\"meterIds\":[" + mPark + "],\"feeName\":\"IT-B2园区路灯\","
                        + "\"members\":[{\"tenantId\":" + tB + "}]}"))
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(post("/api/alloc/generate").param("ym", "2099-11").header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(get("/api/alloc/pools").param("ym", "2099-11").header("Authorization", auth()))
                .andExpect(jsonPath(my + ".autoMembers").value(false))
                .andExpect(jsonPath(my + ".allocatedAmount").value(55.0));
        mvc.perform(get("/api/alloc/member-diff").param("ym", "2099-11").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.ruleId==" + rAuto + ")].added[?(@.tenantId==" + tA + ")]").isNotEmpty());
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

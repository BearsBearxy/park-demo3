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
    // suspect 无写接口(§F2 起 shadow 只由 V75 回填/人工认对产生),池侧护栏用例直接落库造样本。
    // 必须走 mapper:同一事务里 MyBatis 一级缓存会把上一次 selectList 的表档案缓住,绕过 mapper 写库读不到新值。
    @Autowired com.park.demo3.mapper.MeterMapper meterMapper;
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
        // 账期数据驱动:池屏默认月靠这个取 max —— 不能拿 /pools 的 rows 判有无(config 左连,任何月都非空)
        assertMonths("/api/alloc/pool-months", "2099-01");
    }

    // ── F1:@Pattern 值域漏 carrier(V73 冲减载体)/manual(V81 无表人工指定行)——
    //    库里 5 个存量池(17/92-95)打开抽屉什么都没改、点保存就被 400。
    //    不依赖生产库具体 id(本类"探针"模式,自建自证无顺序依赖):自建 carrier/manual 池验证同一条校验。 ──
    @Test
    void carrierAndManualMethod_savableViaApi() throws Exception {
        int rCarrier = postId("/api/alloc/rules", "{\"zone\":\"p1\",\"method\":\"carrier\","
                + "\"feeKey\":\"share_elec_floor\",\"feeName\":\"IT冲减载体\"}");
        int rManual = postId("/api/alloc/rules", "{\"zone\":\"p1\",\"method\":\"manual\","
                + "\"feeKey\":\"share_elec_floor\",\"feeName\":\"IT人工指定\"}");
        // 原样 PUT 回去 → 200,字段一字未变
        mvc.perform(put("/api/alloc/rules/" + rCarrier).header("Authorization", auth()).contentType("application/json")
                .content("{\"zone\":\"p1\",\"method\":\"carrier\",\"feeKey\":\"share_elec_floor\",\"feeName\":\"IT冲减载体\"}"))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.method").value("carrier"))
                .andExpect(jsonPath("$.data.feeKey").value("share_elec_floor"))
                .andExpect(jsonPath("$.data.name").value("一期园区·IT冲减载体"));
        mvc.perform(put("/api/alloc/rules/" + rManual).header("Authorization", auth()).contentType("application/json")
                .content("{\"zone\":\"p1\",\"method\":\"manual\",\"feeKey\":\"share_elec_floor\",\"feeName\":\"IT人工指定\"}"))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.method").value("manual"))
                .andExpect(jsonPath("$.data.name").value("一期园区·IT人工指定"));
    }

    // ── F3:direct 恰一户,开两个例外(理由不同,分开写)——
    //    ①park_loss_pool:整笔挂亏池的净量喂园区损耗池 G,语义上就不该有受益人(库里 23/96-99 全是 0 户,
    //      种子直接写入绕过了本校验);②已存在的池允许编辑为 0 户(既成事实),新建仍硬拦(配置错误当场拦住)。
    //    n>1 无论哪个例外都不放行——整笔归户只能归一户。 ──
    @Test
    void directException_parkLossZeroMembers_existingZeroMembers_twoAlwaysRejected() throws Exception {
        // 例外一:park_loss_pool + 0 户,新建直接 200(不是"已存在"例外,是语义例外)
        postId("/api/alloc/rules", "{\"zone\":\"p1\",\"method\":\"direct\",\"feeKey\":\"park_loss_pool\",\"members\":[]}");

        // 例外二:已存在的 direct 池编辑为 0 户 → 200(既成事实,不该逼用户先指定受益户才能改备注)
        int t1 = createTenant("IT恰一户甲");
        int rDirect = postId("/api/alloc/rules", "{\"zone\":\"p1\",\"method\":\"direct\",\"feeKey\":\"share_elec_fire\","
                + "\"members\":[{\"tenantId\":" + t1 + "}]}");
        mvc.perform(put("/api/alloc/rules/" + rDirect).header("Authorization", auth()).contentType("application/json")
                .content("{\"zone\":\"p1\",\"method\":\"direct\",\"feeKey\":\"share_elec_fire\",\"members\":[]}"))
                .andExpect(jsonPath("$.code").value(0));

        // n>1 恒非法:两个例外都不放行 2 户
        int t2 = createTenant("IT恰一户乙");
        mvc.perform(post("/api/alloc/rules").header("Authorization", auth()).contentType("application/json")
                .content("{\"zone\":\"p1\",\"method\":\"direct\",\"feeKey\":\"park_loss_pool\","
                        + "\"members\":[{\"tenantId\":" + t1 + "},{\"tenantId\":" + t2 + "}]}"))
                .andExpect(jsonPath("$.code").value(400));
        mvc.perform(put("/api/alloc/rules/" + rDirect).header("Authorization", auth()).contentType("application/json")
                .content("{\"zone\":\"p1\",\"method\":\"direct\",\"feeKey\":\"share_elec_fire\","
                        + "\"members\":[{\"tenantId\":" + t1 + "},{\"tenantId\":" + t2 + "}]}"))
                .andExpect(jsonPath("$.code").value(400));

        // 新建 direct + 0 户(非 park_loss_pool)仍被拦 —— 配置错误当场拦住,不靠事后告警
        // (回归探针:与既有 ruleCrud_generate_floorAnchor_deleteGuard 里的"IT坏整笔"用例同款断言)
        mvc.perform(post("/api/alloc/rules").header("Authorization", auth()).contentType("application/json")
                .content("{\"zone\":\"p1\",\"method\":\"direct\",\"feeKey\":\"share_elec_fire\",\"members\":[]}"))
                .andExpect(jsonPath("$.code").value(400));
    }

    // /months 系列的三条通用断言:格式 YYYY-MM、升序、无重复(去重排序后须与原样等长同序),外加本例月在内
    private void assertMonths(String path, String mustContain) throws Exception {
        java.util.List<String> ms = JsonPath.read(mvc.perform(get(path).header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0)).andReturn().getResponse().getContentAsString(), "$.data");
        org.junit.jupiter.api.Assertions.assertEquals(ms.stream().distinct().sorted().toList(), ms,
                "账期须升序无重复: " + ms);
        org.junit.jupiter.api.Assertions.assertTrue(ms.stream().allMatch(m -> m.matches("\\d{4}-\\d{2}")),
                "账期格式须 YYYY-MM: " + ms);
        org.junit.jupiter.api.Assertions.assertTrue(ms.contains(mustContain), path + " 应含 " + mustContain + ": " + ms);
    }

    // ── 三态挂零:绑定表本月全部停用 → 池行空、无"缺读数/缺抄"假警报(原册对停用表=挂零陈列);
    //    停用表与在用表混绑 → 停用者静默跳过,池照常算不受污染 ──
    @Test
    void generate_allBoundMetersRetired_silentZeroPool() throws Exception {
        String ym = "2091-01";   // 独占槽:全库(含种子与其它用例)无数据落该月
        int t1 = createTenant("IT停用池户");
        int mOff = createMeter("IT已停公共电", "p1", "share", null, null);
        mvc.perform(put("/api/meters/" + mOff).header("Authorization", auth()).contentType("application/json")
                .content("{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT已停公共电\",\"ownership\":\"share\",\"retiredYm\":\"2090-12\"}"))
                .andExpect(jsonPath("$.code").value(0));
        int rOff = postId("/api/alloc/rules", "{\"zone\":\"p1\",\"name\":\"IT全停池\",\"method\":\"direct\","
                + "\"feeKey\":\"share_elec_floor\",\"meterIds\":[" + mOff + "],"
                + "\"members\":[{\"tenantId\":" + t1 + "}]}");
        int mLive = createMeter("IT在用电梯", "p1", "share", null, null);
        reading(mLive, ym, "0", "100");
        int rMix = postId("/api/alloc/rules", "{\"zone\":\"p1\",\"name\":\"IT混绑池\",\"method\":\"direct\","
                + "\"feeKey\":\"share_elec_elevator\",\"meterIds\":[" + mLive + "," + mOff + "],"
                + "\"members\":[{\"tenantId\":" + t1 + "}]}");
        price("elec_commercial", ym, "0.79416875");
        p2Prices(ym);
        String gen = mvc.perform(post("/api/alloc/generate").param("ym", ym).header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsString();
        java.util.List<String> warns = JsonPath.read(gen, "$.data.warnings");
        org.junit.jupiter.api.Assertions.assertTrue(warns.stream().noneMatch(w -> w.contains("IT已停公共电")),
                "停用表不得报缺抄/缺读数假警报: " + warns);
        // 池行:全停池 warn 空、用量金额空;混绑池照常出数(100×1.11417 种子 price_flat)且 warn 空
        String pools = mvc.perform(get("/api/alloc/pools").param("ym", ym).header("Authorization", auth()))
                .andReturn().getResponse().getContentAsString();
        java.util.List<java.util.Map<String, Object>> rows = JsonPath.read(pools, "$.data.rows");
        java.util.Map<String, Object> offRow = rows.stream()
                .filter(r -> Integer.valueOf(rOff).equals(r.get("ruleId"))).findFirst().orElseThrow();
        java.util.Map<String, Object> mixRow = rows.stream()
                .filter(r -> Integer.valueOf(rMix).equals(r.get("ruleId"))).findFirst().orElseThrow();
        org.junit.jupiter.api.Assertions.assertNull(offRow.get("warn"), "全停池不许出\"!\": " + offRow.get("warn"));
        org.junit.jupiter.api.Assertions.assertNull(offRow.get("qtyTotal"), "全停池用量应为空");
        org.junit.jupiter.api.Assertions.assertNull(offRow.get("costAmount"), "全停池应分摊应为空");
        org.junit.jupiter.api.Assertions.assertEquals(111.42, ((Number) mixRow.get("costAmount")).doubleValue(), 0.001);
        org.junit.jupiter.api.Assertions.assertNull(mixRow.get("warn"), "混绑池不许被停用表污染出警告: " + mixRow.get("warn"));
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
                // S5 后 warnings[0] 可能是「无租金计费行回退」全局警告,缺抄断言改全数组包含(禁位置依赖)
                .andExpect(jsonPath("$.data.warnings[?(@ =~ /.*缺抄.*/)]").isNotEmpty());
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
        // S8:面积基数按账期取(covers),合同须带起止日期覆盖 2099-05
        postId("/api/contracts", "{\"contractNo\":\"IT-PB-C1\",\"tenantId\":" + t2 + ",\"buildingId\":" + b
                + ",\"rentArea\":120,\"status\":\"active\",\"startDate\":\"2099-01-01\",\"endDate\":\"2100-12-31\"}");
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
        // 参数月行与默认行并存:当月 park_share_div 月行覆盖默认(默认行不动;S21 注册表门:price_flat 已退役不可写)
        mvc.perform(put("/api/alloc/cfg").header("Authorization", auth()).contentType("application/json")
                .content("{\"scope\":\"p1\",\"cfgKey\":\"park_share_div\",\"acctMonth\":\"2099-05\",\"value\":7}"))
                .andExpect(status().isOk());
        mvc.perform(get("/api/alloc/cfg").param("ym", "2099-05").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.scope=='p1'&&@.cfgKey=='park_share_div'&&@.acctMonth=='2099-05')].value").value(7.0))
                .andExpect(jsonPath("$.data[?(@.scope=='p1'&&@.cfgKey=='park_share_div'&&@.acctMonth=='')]").exists());
        // 退役键 / 注册表外键 → 400
        mvc.perform(put("/api/alloc/cfg").header("Authorization", auth()).contentType("application/json")
                .content("{\"scope\":\"p1\",\"cfgKey\":\"price_flat\",\"acctMonth\":\"2099-05\",\"value\":2}"))
                .andExpect(jsonPath("$.code").value(400));
        mvc.perform(put("/api/alloc/cfg").header("Authorization", auth()).contentType("application/json")
                .content("{\"scope\":\"building:" + b + "\",\"cfgKey\":\"loss_g_adj\",\"value\":-1}"))
                .andExpect(jsonPath("$.code").value(400));
        mvc.perform(put("/api/alloc/cfg").header("Authorization", auth()).contentType("application/json")
                .content("{\"scope\":\"p1\",\"cfgKey\":\"loss_variant\",\"value\":1}"))   // 键在表但作用域形态不允许(栋级键)
                .andExpect(jsonPath("$.code").value(400));
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
        // §H4.2e 无表行(V81 的 4 条 manual):生成后快照仍全空 —— 用量/应分摊/分摊标准 NULL(不进屏上合计),
        // 且**不报「缺读数」**(它们本就没有表可抄)。computePool 的 manual 早退分支就锁在这里。
        String withManual = mvc.perform(get("/api/alloc/pools").param("ym", "2099-06")
                        .header("Authorization", auth()))
                .andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        java.util.List<java.util.Map<String, Object>> manual =
                JsonPath.read(withManual, "$.data.rows[?(@.method=='manual')]");
        org.junit.jupiter.api.Assertions.assertEquals(4, manual.size());
        org.junit.jupiter.api.Assertions.assertTrue(manual.stream().allMatch(r ->
                        r.get("qtyTotal") == null && r.get("costAmount") == null
                                && r.get("stdValue") == null && r.get("warn") == null),
                "manual 池不该出用量/金额/标准,也不该报缺读数");
    }

    // ── §F3 池侧护栏(2099-04):shadow 表不进池分母 + 行级 warn 点名。
    //    池分母走显式 alloc_rule_meter 绑定,不经 inSubSigma —— 刀E 只挡楼栋分表Σ 等于没挡
    //    (实测 meter 1139 已标 shadow 仍绑在 rule 61 上)。 ──
    @Test
    void poolShadowMeter_outOfPoolQty_rowWarn() throws Exception {
        int t = createTenant("IT-F3池户");
        int mReal = createMeter("IT-F3真表", "p1", "share", null, null);
        int mDup = createMeter("IT-F3重复档", "p1", "share", null, null);
        reading(mReal, "2099-04", "0", "100");
        reading(mDup, "2099-04", "0", "50");
        int rule = postId("/api/alloc/rules", "{\"zone\":\"p1\",\"name\":\"IT-F3货梯池\",\"method\":\"floor\","
                + "\"coefficient\":2,\"feeKey\":\"share_elec_floor\",\"meterIds\":[" + mReal + "," + mDup + "],"
                + "\"members\":[{\"tenantId\":" + t + ",\"weight\":1}]}");
        price("elec_commercial", "2099-04", "0.79416875");
        p2Prices("2099-04");
        String my = "$.data.rows[?(@.ruleId==" + rule + ")]";
        // 打标前:两块表都进池分母 = 100+50
        mvc.perform(post("/api/alloc/generate").param("ym", "2099-04").header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(get("/api/alloc/pools").param("ym", "2099-04").header("Authorization", auth()))
                .andExpect(jsonPath(my + ".qtyTotal").value(150.0));
        // 人工认对后打 shadow → 重新生成:那 50 度退出池分母(150→100),行级 warn 点名该表
        com.park.demo3.entity.Meter mk = meterMapper.selectById(mDup);
        mk.setSuspect("shadow");
        meterMapper.updateById(mk);
        mvc.perform(post("/api/alloc/generate").param("ym", "2099-04").header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.warnings", org.hamcrest.Matchers.hasItem(
                        org.hamcrest.Matchers.containsString("公摊池分母"))));
        mvc.perform(get("/api/alloc/pools").param("ym", "2099-04").header("Authorization", auth()))
                .andExpect(jsonPath(my + ".qtyTotal").value(100.0))
                // 过滤表达式是 indefinite path,取回的是 JSONArray → 用 hasItem 包一层
                .andExpect(jsonPath(my + ".warn", org.hamcrest.Matchers.hasItem(
                        org.hamcrest.Matchers.containsString("疑似重复建档"))));
        // ⚠ 这里**故意不断言 costAmount**:p1 逐表 ROUND 口径的 cost 在 computePool 里直接遍历 bindsByRule,
        //   尚未跳过 shadow(computePool 属红线方法体,本刀不许改)→ qty 已排除而 cost 未排除。
        //   断言它等于 150×价 就是把这个缺口写死成「正确行为」,断言 100×价 又会立刻变红。见提交物 notDone。
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
        // S21/V96:loss_g_adj 退役并入 loss_adj_qty(G+g ≡ E−G−a,a=g);注册表门下 loss_g_adj 写入 400
        allocCfg("building:" + b1, "loss_adj_qty", "-50");   // b1 a=-50 ⇒ E−G−a=-100-86.8+50=-136.8
        allocCfg("building:" + b1, "loss_recon", "0");       // b1 独立供电链路,排除对账
        allocCfg("building:" + b2, "loss_variant", "1");     // b2=纯公摊式
        allocCfg("building:" + b2, "loss_adj_rate", "0.005");
        allocCfg("p1", "loss_supply_meter", String.valueOf(mSupply));
        price("elec_commercial", "2099-07", "0.79416875");
        p2Prices("2099-07");
        mvc.perform(post("/api/alloc/generate").param("ym", "2099-07").header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0));
        // b1 net:I=-r4((-100-86.8+50)/1000)=0.1368;b2 share_only:I=r4(86.8/500)+0.005=0.1786
        mvc.perform(get("/api/alloc/loss").param("ym", "2099-07").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.generated").value(true))
                .andExpect(jsonPath("$.data.units[?(@.headBuildingId==" + b1 + ")].label").value("IT-PE-A座"))
                .andExpect(jsonPath("$.data.units[?(@.headBuildingId==" + b1 + ")].variant").value("net"))
                .andExpect(jsonPath("$.data.units[?(@.headBuildingId==" + b1 + ")].cQty").value(1000.0))
                .andExpect(jsonPath("$.data.units[?(@.headBuildingId==" + b1 + ")].dQty").value(900.0))
                .andExpect(jsonPath("$.data.units[?(@.headBuildingId==" + b1 + ")].eQty").value(-100.0))
                .andExpect(jsonPath("$.data.units[?(@.headBuildingId==" + b1 + ")].rawRate").value(-0.1))
                .andExpect(jsonPath("$.data.units[?(@.headBuildingId==" + b1 + ")].gQty").value(86.8))
                .andExpect(jsonPath("$.data.units[?(@.headBuildingId==" + b1 + ")].adjQty").value(-50.0))
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

    // ── 刀I §I1:园区损耗池 G 基数 = Σ(fee_key='park_loss_pool' 的 p1 规则当月净量),跨多条规则、跨 method ──
    // 原册 `一期园区损耗!G4/G6..G10 = ROUND(SUM(公共电分摊明细!S5:S9)/6,2)` 取的是 r5–r9 **五行的 Σ**,
    // 不是某一个池的量。V84 前该费键只挂 1 条池(招商中心靠 fold_qty 折进去),测不出「Σ 跨规则」这条性质;
    // 本例按原册铺 5 条(4 条 direct 独立行 + 1 条净额行),数量与 method 都不同,任何"只取某一个池"的写法都会红。
    // 锚点全取原册块1:29.51/18.55/101.51/219.19 + 152.06 = 520.82 → G=ROUND(520.82/6,2)=86.80;
    //             A座另 损耗调整度数 loss_adj_qty=-1500(S21/V96:原 loss_g_adj 并入,G 各栋同值不再分栋加减)
    //             → g_qty 两栋皆 86.80、A座 adj_qty=-1500;4 条独立行应分摊=逐表ROUND(度×1.11416875)。
    @Test
    void parkLossPool_sumsAcrossRules_gBase() throws Exception {
        String ym = "2099-09";
        int bA = postId("/api/buildings", "{\"name\":\"IT-I1-A座\",\"phase\":1,\"floorCount\":5,"
                + "\"totalArea\":10000,\"rentableArea\":9000}");
        int bB = postId("/api/buildings", "{\"name\":\"IT-I1-B座\",\"phase\":1,\"floorCount\":5,"
                + "\"totalArea\":10000,\"rentableArea\":9000}");
        int t = createTenant("IT-I1公摊户");
        // 两栋各 总表+户表 → 出两个损耗组(G 挂在组上,与池的条数无关)
        int iA = createMeter("IT-I1总表A", "p1", "infra", null, bA);
        int tA = createMeter("IT-I1户表A", "p1", "tenant", t, bA);
        int iB = createMeter("IT-I1总表B", "p1", "infra", null, bB);
        int tB = createMeter("IT-I1户表B", "p1", "tenant", t, bB);
        reading(iA, ym, "0", "1000"); reading(tA, ym, "0", "900");
        reading(iB, ym, "0", "500");  reading(tB, ym, "0", "480");
        // 原册 r5/r6/r7/r9:4 条独立行,各绑 1 块表,direct(AC=AD=整额)
        String[][] book = {{"地下车库东侧照明", "29.51", "32.88"}, {"地下车库西侧照明", "18.55", "20.67"},
                           {"大堂", "101.51", "113.10"}, {"生活加压泵", "219.19", "244.21"}};
        int[] rid = new int[book.length];
        for (int i = 0; i < book.length; i++) {
            int m = createMeter("IT-I1" + book[i][0], "p1", "share", null, null);
            reading(m, ym, "0", book[i][1]);
            rid[i] = postId("/api/alloc/rules", "{\"zone\":\"p1\",\"name\":\"IT-I1" + book[i][0] + "\","
                    + "\"method\":\"direct\",\"feeKey\":\"park_loss_pool\",\"meterIds\":[" + m + "],"
                    + "\"members\":[{\"tenantId\":" + t + "}]}");
        }
        // 原册 r8 招商中心净额行:method 换一种(loss),证明 Σ 按费键取而不是按 method 取
        int mZs = createMeter("IT-I1招商净电", "p1", "share", null, null);
        reading(mZs, ym, "0", "152.06");
        postId("/api/alloc/rules", "{\"zone\":\"p1\",\"name\":\"IT-I1招商中心净电\",\"method\":\"loss\","
                + "\"feeKey\":\"park_loss_pool\",\"meterIds\":[" + mZs + "]}");
        allocCfg("building:" + bA, "loss_adj_qty", "-1500");
        price("elec_commercial", ym, "0.79416875");
        p2Prices(ym);
        mvc.perform(post("/api/alloc/generate").param("ym", ym).header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0));
        // G 基数:五行 Σ=520.82 → 86.80(六座 g_qty 口径由此一处决定);A座调整度数 -1500 落 adj_qty
        mvc.perform(get("/api/alloc/loss").param("ym", ym).header("Authorization", auth()))
                .andExpect(jsonPath("$.data.units[?(@.headBuildingId==" + bB + ")].gQty").value(86.80))
                .andExpect(jsonPath("$.data.units[?(@.headBuildingId==" + bA + ")].gQty").value(86.80))
                .andExpect(jsonPath("$.data.units[?(@.headBuildingId==" + bA + ")].adjQty").value(-1500.0));
        // 拆出的 4 条各自应分摊(原册 AD5/AD6/AD7/AD9),direct → 分摊标准 = 应分摊(原册 AC=AD)
        for (int i = 0; i < book.length; i++)
            mvc.perform(get("/api/alloc/pools").param("ym", ym).header("Authorization", auth()))
                    .andExpect(jsonPath("$.data.rows[?(@.ruleId==" + rid[i] + ")].qtyTotal")
                            .value(Double.parseDouble(book[i][1])))
                    .andExpect(jsonPath("$.data.rows[?(@.ruleId==" + rid[i] + ")].costAmount")
                            .value(Double.parseDouble(book[i][2])))
                    .andExpect(jsonPath("$.data.rows[?(@.ruleId==" + rid[i] + ")].stdValue")
                            .value(Double.parseDouble(book[i][2])));
    }

    // ── 刀I §I2:净额池只占 1 行,7 块绑定表 + 硬编码扣度全进 netParts 构成(2098-09) ──
    // 原册「公共电分摊明细」r8 招商中心在这张 sheet 上**只有一行**,用量写的是净额:
    //   S8 = 一期园区电!X50 + N8 = (S49+S50−SUM(S44:S48)) − 670
    //      = 697.60+444.80−(4.74+0+315.60+0+0)−670 = 152.06;应分摊 = ROUND(152.06×1.11416875,2) = 169.42。
    // 7 块表全是 X50 的中间量 —— 5 块 sign=-1 扣减表固然不是行,两块 sign=+1 总表在这张 sheet 上同样没有行,
    // 逐表行照出会把原册 1 行撑成 2 行、且显 697.60/444.80 而不是净额,正是本刀要治的病。
    // 2099-01..12 十二个槽本类已用尽 → 本例用 2098-09(同为远期槽;@Transactional 回滚、自建自证无顺序依赖)。
    @Test
    void netPool_singleRow_netPartsChain() throws Exception {
        String ym = "2098-09";
        int t = createTenant("IT-I2招商户");
        int zs1 = createMeter("IT-I2招商中心电1", "p1", "share", null, null);   // 原册 S49
        int zs2 = createMeter("IT-I2招商中心电2", "p1", "share", null, null);   // 原册 S50
        reading(zs1, ym, "0", "697.60");
        reading(zs2, ym, "0", "444.80");
        // 原册 S44:S48 五块扣减表;三块本月零度 —— 零度也必须出构成项,否则 hover 那条链讲不完整
        String[][] neg = {{"中大A304公共电1", "4.74"}, {"优凯A305电", "0"}, {"双成电2", "315.60"},
                          {"中大4楼公共", "0"}, {"4楼空调外机电", "0"}};
        int[] nid = new int[neg.length];
        StringBuilder binds = new StringBuilder("{\"meterId\":" + zs1 + ",\"sign\":1},"
                + "{\"meterId\":" + zs2 + ",\"sign\":1}");
        for (int i = 0; i < neg.length; i++) {
            nid[i] = createMeter("IT-I2" + neg[i][0], "p1", "share", null, null);
            reading(nid[i], ym, "0", neg[i][1]);
            binds.append(",{\"meterId\":").append(nid[i]).append(",\"sign\":-1}");
        }
        int rid = postId("/api/alloc/rules", "{\"zone\":\"p1\",\"name\":\"IT-I2招商中心\",\"method\":\"direct\","
                + "\"feeKey\":\"share_elec_floor\",\"meters\":[" + binds + "],"
                + "\"members\":[{\"tenantId\":" + t + "}]}");
        allocCfg("rule:" + rid, "extra_qty", "-670");   // 原册 N8 公式原文 `=-670`,写在「本月行至」列位
        price("elec_commercial", ym, "0.79416875");
        p2Prices(ym);
        mvc.perform(post("/api/alloc/generate").param("ym", ym).header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0));
        String my = "$.data.rows[?(@.ruleId==" + rid + ")]";
        String pools = mvc.perform(get("/api/alloc/pools").param("ym", ym).header("Authorization", auth()))
                .andExpect(jsonPath(my + ".lines.length()").value(0))       // 逐表行一条不出 = 屏上只占 1 行
                .andExpect(jsonPath(my + ".qtyTotal").value(152.06))
                .andExpect(jsonPath(my + ".costAmount").value(169.42))
                // 构成 = 7 块表 + 扣度;qty 是**有符号**净量,相加即得 152.06
                .andExpect(jsonPath(my + ".netParts.length()").value(8))
                .andExpect(jsonPath(my + ".netParts[?(@.meterId==" + zs1 + ")].qty").value(697.60))
                .andExpect(jsonPath(my + ".netParts[?(@.meterId==" + zs2 + ")].qty").value(444.80))
                .andExpect(jsonPath(my + ".netParts[?(@.meterId==" + nid[0] + ")].qty").value(-4.74))
                .andExpect(jsonPath(my + ".netParts[?(@.meterId==" + nid[2] + ")].qty").value(-315.60))
                .andExpect(jsonPath(my + ".netParts[?(@.label=='账册扣度')].qty").value(-670.0))
                // 绑定表一块没少(池级 qty/cost 仍由 computePool 出,与逐表行的去留无关)
                .andExpect(jsonPath(my + ".meters.length()").value(7))
                .andReturn().getResponse().getContentAsString();
        // 扣度不是电表:8 项构成里有且只有它的 meterId 为 null ——
        // 前端「电表」列尾 −N 角标数的是「meterId 非空且 sign<0」,扣度不能被数成一块表
        java.util.List<?> partMeterIds = JsonPath.read(pools,
                "$.data.rows[?(@.ruleId==" + rid + ")].netParts[*].meterId");
        org.junit.jupiter.api.Assertions.assertEquals(1,
                partMeterIds.stream().filter(java.util.Objects::isNull).count());
        // 5 块扣减表各自 sign=-1(前端「电表」列尾 −5 角标就数这几条:meterId 非空且 sign<0)
        for (int id : nid)
            org.junit.jupiter.api.Assertions.assertEquals(java.util.List.of(-1),
                    JsonPath.read(pools, "$.data.rows[?(@.ruleId==" + rid + ")].netParts[?(@.meterId=="
                            + id + ")].sign"));
        // 链自洽:Σ netParts.qty ≡ 池净量 152.06(hover 讲的和主行显的必须是同一个数)
        java.math.BigDecimal sum = java.math.BigDecimal.ZERO;
        java.util.List<Object> qs = JsonPath.read(pools,
                "$.data.rows[?(@.ruleId==" + rid + ")].netParts[*].qty");
        for (Object o : qs) sum = sum.add(new java.math.BigDecimal(String.valueOf(o)));
        org.junit.jupiter.api.Assertions.assertEquals(0, sum.compareTo(new java.math.BigDecimal("152.06")),
                "Σ netParts.qty 应等于池净量 152.06,实得 " + sum);
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

    // ── 刀二(2091-12):电梯池首层不摊——纸约「首层租户不承担电梯维保费和维修费」+B座货梯先例(2/3/4F 各1份)。
    // 首层户(户内表定层一楼,L2)电梯整桶剔除不落行;高层户独占其桶份额不被首层稀释;
    // 同成员同读数的消防 floor 池首层照摊——锁「只砍电梯,不砍消防」。
    @Test
    void poolFloorElevator_firstFloorExcluded() throws Exception {
        String ym = "2091-12";
        int b = postId("/api/buildings", "{\"name\":\"IT-EL栋\",\"phase\":2,\"floorCount\":3,"
                + "\"totalArea\":1000,\"rentableArea\":900}");
        int t1 = createTenant("IT电梯首层户");
        int t2 = createTenant("IT电梯三楼户");
        // 户内表定层(合同单元为空 → §D.1 回退 L2 电表 floor_label)
        postId("/api/meters", "{\"kind\":\"elec\",\"zone\":\"p2\",\"name\":\"IT-EL首层户表\","
                + "\"ownership\":\"tenant\",\"tenantId\":" + t1 + ",\"buildingId\":" + b + ",\"floorLabel\":\"一楼\"}");
        postId("/api/meters", "{\"kind\":\"elec\",\"zone\":\"p2\",\"name\":\"IT-EL三楼户表\","
                + "\"ownership\":\"tenant\",\"tenantId\":" + t2 + ",\"buildingId\":" + b + ",\"floorLabel\":\"三楼\"}");
        int mLift = createMeter("IT-EL电梯表", "p2", "share", null, b);
        reading(mLift, ym, "0", "100");
        int mFire = createMeter("IT-EL消防表", "p2", "share", null, b);
        reading(mFire, ym, "0", "100");
        // 无分时段回退平价:cost=100×(0.72076875+0.16)=88.08,std=ROUND(88.076875/2,2)=44.04 元/层
        int rLift = postId("/api/alloc/rules", "{\"zone\":\"p2\",\"name\":\"IT-EL电梯池\",\"method\":\"floor\","
                + "\"coefficient\":2,\"feeKey\":\"share_elec_elevator\",\"buildingId\":" + b + ","
                + "\"meterIds\":[" + mLift + "],"
                + "\"members\":[{\"tenantId\":" + t1 + "},{\"tenantId\":" + t2 + "}]}");
        int rFire = postId("/api/alloc/rules", "{\"zone\":\"p2\",\"name\":\"IT-EL消防池\",\"method\":\"floor\","
                + "\"coefficient\":2,\"feeKey\":\"share_elec_fire\",\"buildingId\":" + b + ","
                + "\"meterIds\":[" + mFire + "],"
                + "\"members\":[{\"tenantId\":" + t1 + "},{\"tenantId\":" + t2 + "}]}");
        p2Prices(ym);
        price("elec_commercial", ym, "0.79416875");
        mvc.perform(post("/api/alloc/generate").param("ym", ym).header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0));
        String res = mvc.perform(get("/api/alloc/result").param("ym", ym).header("Authorization", auth()))
                .andReturn().getResponse().getContentAsString();
        // 电梯:首层户无行(整桶剔除);三楼户独占本桶一份 44.04,不因首层剔除而变
        java.util.List<Object> liftT1 = JsonPath.read(res,
                "$.data[?(@.ruleId==" + rLift + " && @.tenantId==" + t1 + ")].amount");
        java.util.List<Object> liftT2 = JsonPath.read(res,
                "$.data[?(@.ruleId==" + rLift + " && @.tenantId==" + t2 + ")].amount");
        org.junit.jupiter.api.Assertions.assertTrue(liftT1.isEmpty(), "首层户不应有电梯行,实得 " + liftT1);
        org.junit.jupiter.api.Assertions.assertEquals(java.util.List.of(44.04), liftT2);
        // 消防:首层照摊(每桶一份)——别把消防也砍了(力灏消防 3 层 342.39 含首层)
        java.util.List<Object> fireT1 = JsonPath.read(res,
                "$.data[?(@.ruleId==" + rFire + " && @.tenantId==" + t1 + ")].amount");
        org.junit.jupiter.api.Assertions.assertEquals(java.util.List.of(44.04), fireT1);
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
        // 损耗屏默认月:查 alloc_loss_result 自己的账期,不借 /alloc/years(那是抄表年∪结果年)
        assertMonths("/api/alloc/loss-months", "2099-10");
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

    // ── §E2 复现:编辑态改费项(池名末段)必须存得住 —— 按前端 submitPool 的完整 payload 往返 ──
    @Test
    void poolFeeName_editRoundTrip() throws Exception {
        int b = building("IT-E2-A座");
        int m = locMeter("IT-E2四楼西侧灯", b, "四楼西侧", "电表①");
        int t = createTenant("IT-E2受益户");
        // 建池:费项=走廊灯
        int rule = postId("/api/alloc/rules", "{\"zone\":\"p1\",\"name\":\"IT-E2-A座·四楼西侧·走廊灯\","
                + "\"buildingId\":" + b + ",\"floorLabel\":\"四楼\",\"side\":\"西侧\",\"feeName\":\"走廊灯\","
                + "\"method\":\"floor\",\"coefficient\":3,\"extraQty\":null,\"feeKey\":\"share_elec_floor\","
                + "\"note\":null,\"meterIds\":[" + m + "],\"meters\":[{\"meterId\":" + m + ",\"sign\":1}],"
                + "\"members\":[{\"tenantId\":" + t + ",\"weight\":null}],\"memberMonth\":null,"
                + "\"roundScale\":2,\"stdKind\":null,\"baseKey\":null,\"links\":[]}");
        // 只改费项 → 走廊灯 → 消防(其余字段与前端回填一致)
        mvc.perform(put("/api/alloc/rules/" + rule).header("Authorization", auth()).contentType("application/json")
                        .content("{\"zone\":\"p1\",\"name\":\"IT-E2-A座·四楼西侧·消防\","
                                + "\"buildingId\":" + b + ",\"floorLabel\":\"四楼\",\"side\":\"西侧\",\"feeName\":\"消防\","
                                + "\"method\":\"floor\",\"coefficient\":3,\"extraQty\":null,\"feeKey\":\"share_elec_floor\","
                                + "\"note\":null,\"meterIds\":[" + m + "],\"meters\":[{\"meterId\":" + m + ",\"sign\":1}],"
                                + "\"members\":[{\"tenantId\":" + t + ",\"weight\":null}],\"memberMonth\":null,"
                                + "\"roundScale\":2,\"stdKind\":null,\"baseKey\":null,\"links\":[]}"))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.feeName").value("消防"));
        // 前端保存后就是重新 GET /pools 刷新表格 —— 这里断言 feeName 与 autoName/name 末段都跟着改
        String my = "$.data.rows[?(@.ruleId==" + rule + ")]";
        mvc.perform(get("/api/alloc/pools").param("ym", "2099-11").header("Authorization", auth()))
                .andExpect(jsonPath(my + ".feeName").value("消防"))
                .andExpect(jsonPath(my + ".autoName").value("IT-E2-A座·四楼西侧·消防"))
                .andExpect(jsonPath(my + ".name").value("IT-E2-A座·四楼西侧·消防"));
    }

    // ── §E2 根因:基数取价目簿键的 area 池(coefficient 恒 NULL,V65 种子 10 个)必须能改能存 ──
    @Test
    void poolBaseKeyRule_editableWithoutCoefficient() throws Exception {
        int m = createMeter("IT-E2路灯表", "p1", "share", null, null);
        // 基数键池:base 由 priceCfg.resolve(baseKey) 给,coefficient 留空是正常态
        int rule = postId("/api/alloc/rules", "{\"zone\":\"p1\",\"method\":\"area\",\"coefficient\":null,"
                + "\"baseKey\":\"lamp_area_base\",\"feeKey\":\"share_elec_light\",\"feeName\":\"IT-E2路灯\","
                + "\"meterIds\":[" + m + "]}");
        // 只改费项(前端回填的 coefficient 依旧为空)→ 旧判据在这里 400,用户看到的就是「保存无反应」
        mvc.perform(put("/api/alloc/rules/" + rule).header("Authorization", auth()).contentType("application/json")
                        .content("{\"zone\":\"p1\",\"method\":\"area\",\"coefficient\":null,"
                                + "\"baseKey\":\"lamp_area_base\",\"feeKey\":\"share_elec_light\","
                                + "\"feeName\":\"IT-E2绿化水\",\"meterIds\":[" + m + "]}"))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.feeName").value("IT-E2绿化水"))
                .andExpect(jsonPath("$.data.name").value("一期园区·IT-E2绿化水"));
        // 系数与基数键都没有 → 仍旧 400(护栏没被拆掉)
        mvc.perform(put("/api/alloc/rules/" + rule).header("Authorization", auth()).contentType("application/json")
                        .content("{\"zone\":\"p1\",\"method\":\"area\",\"coefficient\":null,\"baseKey\":null,"
                                + "\"feeKey\":\"share_elec_light\",\"feeName\":\"IT-E2绿化水\","
                                + "\"meterIds\":[" + m + "]}"))
                .andExpect(jsonPath("$.code").value(400));   // BizException 走 HTTP200+body.code
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
                // V73:标签补全为「区域·位置·用途·表号」(用途取 tenant_name,空则回退标识名);
                // 原实现只有「位置·表号」,同层多块表全同名分不出谁是谁
                .andExpect(jsonPath(my + ".meters[0].label").value("四楼西侧·IT-V69四楼西侧灯·电表①"))
                .andExpect(jsonPath(my + ".meters[0].spot").value("四楼西侧"))
                // V73 逐表明细快照:一表一行,行至/倍率/用量/逐表应分摊(p1 逐表ROUND口径)
                .andExpect(jsonPath(my + ".lines.length()").value(1))
                .andExpect(jsonPath(my + ".lines[0].meterId").value(m))
                .andExpect(jsonPath(my + ".lines[0].prevTotal").value(0.0))
                .andExpect(jsonPath(my + ".lines[0].currTotal").value(100.0))
                .andExpect(jsonPath(my + ".lines[0].qtyTotal").value(100.0))
                .andExpect(jsonPath(my + ".lines[0].costAmount").value(111.42))
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

    // ── 刀D §D.2/§D.3:按层池一层一份 ──
    // 3 户分居 2/3/4 层(合同挂单元 → §D.1 一级回退)→ 摊出=元每层×3=应分摊,盈亏 0。
    // 刀前实现把 weight=NULL 的成员**合摊一份**,18 个按层池每月只摊 1 份(2024-02 少摊 7992.32 元)。
    @Test
    void poolFloorBuckets_oneSharePerFloor() throws Exception {
        int b = building("IT-D1-B座");
        int t2 = createTenant("IT-D1二楼户");
        int t3 = createTenant("IT-D1三楼户");
        int t4 = createTenant("IT-D1四楼户");
        contract("IT-D1-C2", t2, b, unit(b, 2, "D1-201"));
        contract("IT-D1-C3", t3, b, unit(b, 3, "D1-301"));
        contract("IT-D1-C4", t4, b, unit(b, 4, "D1-401"));
        int m = locMeter("IT-D1天面货梯表", b, "天面", "电表①");
        reading(m, "2099-11", "0", "100");
        // cost=r2(100×AB)=111.42;元/层=ROUND(100/3×AB,2)=37.14;三个楼层桶各一份 → 摊出 111.42
        int rule = postId("/api/alloc/rules", "{\"zone\":\"p1\",\"method\":\"floor\",\"coefficient\":3,"
                + "\"feeKey\":\"share_elec_floor\",\"meterIds\":[" + m + "],\"buildingId\":" + b + ","
                + "\"floorLabel\":\"天面\",\"feeName\":\"IT-D1货梯\",\"members\":[{\"tenantId\":" + t2 + "},"
                + "{\"tenantId\":" + t3 + "},{\"tenantId\":" + t4 + "}]}");
        price("elec_commercial", "2099-11", "0.79416875");
        p2Prices("2099-11");
        mvc.perform(post("/api/alloc/generate").param("ym", "2099-11").header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0));
        String my = "$.data.rows[?(@.ruleId==" + rule + ")]";
        mvc.perform(get("/api/alloc/pools").param("ym", "2099-11").header("Authorization", auth()))
                .andExpect(jsonPath(my + ".stdValue").value(37.14))
                .andExpect(jsonPath(my + ".costAmount").value(111.42))
                .andExpect(jsonPath(my + ".allocatedAmount").value(111.42))     // 37.14×3,不是刀前的 37.14
                .andExpect(jsonPath(my + ".gapAmount").value(0.0))
                // §D.6 分桶明细串(前端「摊出」列 title)+ 逐户楼层(§D.1 现算不落库)
                .andExpect(jsonPath(my + ".allocNote").value("按 3 层拆:二楼 1 户 / 三楼 1 户 / 四楼 1 户"))
                .andExpect(jsonPath(my + ".members[?(@.tenantId==" + t2 + ")].floorLabel").value("二楼"))
                .andExpect(jsonPath(my + ".members[?(@.tenantId==" + t4 + ")].floorLabel").value("四楼"));
        mvc.perform(get("/api/alloc/result").param("ym", "2099-11").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.tenantId==" + t2 + "&&@.feeKey=='share_elec_floor')].amount").value(37.14))
                .andExpect(jsonPath("$.data[?(@.tenantId==" + t3 + "&&@.feeKey=='share_elec_floor')].amount").value(37.14))
                .andExpect(jsonPath("$.data[?(@.tenantId==" + t4 + "&&@.feeKey=='share_elec_floor')].amount").value(37.14));
    }

    // ── §F8 §D.2 分支边界:显式份额户**不进桶**(weight 与 null 混合的真实调度路径) ──
    // 同池三户:tE 有 weight=0.5(账册人工覆盖) + t2/t3 无 weight(按 §D.1 自动分桶)。
    // tE 的合同挂在四楼,楼层解析得出来(members[].floorLabel=四楼)——所以它没进桶只能是 weight 分支拦下的,
    // 不是「定不出楼层」的副作用。这是 AllocServiceTest 那条纯函数用例盖不住的地方:它自己写 filter 划分支,
    // 删掉 AllocService 里 `if (m.getWeight() != null) continue;` 照样绿;本用例走 memberAmounts 真实调度,
    // 删掉那行 → tE 独占四楼桶拿整份 37.14(≠18.57)、摊出变 111.42(≠92.85)、盈亏变 0.00,三处同时变红。
    @Test
    void poolFloorMixedWeight_explicitShareNotBucketed() throws Exception {
        int b = building("IT-F8-B座");
        int t2 = createTenant("IT-F8二楼户");
        int t3 = createTenant("IT-F8三楼户");
        int tE = createTenant("IT-F8显式份额户");
        contract("IT-F8-C2", t2, b, unit(b, 2, "F8-201"));
        contract("IT-F8-C3", t3, b, unit(b, 3, "F8-301"));
        contract("IT-F8-CE", tE, b, unit(b, 4, "F8-401"));
        int m = locMeter("IT-F8天面楼梯间表", b, "天面", "电表①");
        reading(m, "2099-11", "0", "100");
        // cost=r2(100×AB)=111.42;元/层=ROUND(100/3×AB,2)=37.14
        int rule = postId("/api/alloc/rules", "{\"zone\":\"p1\",\"method\":\"floor\",\"coefficient\":3,"
                + "\"feeKey\":\"share_elec_floor\",\"meterIds\":[" + m + "],\"buildingId\":" + b + ","
                + "\"floorLabel\":\"天面\",\"feeName\":\"IT-F8楼梯间\",\"members\":[{\"tenantId\":" + t2 + "},"
                + "{\"tenantId\":" + t3 + "},{\"tenantId\":" + tE + ",\"weight\":0.5}]}");
        price("elec_commercial", "2099-11", "0.79416875");
        p2Prices("2099-11");
        mvc.perform(post("/api/alloc/generate").param("ym", "2099-11").header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0));
        String my = "$.data.rows[?(@.ruleId==" + rule + ")]";
        mvc.perform(get("/api/alloc/pools").param("ym", "2099-11").header("Authorization", auth()))
                .andExpect(jsonPath(my + ".stdValue").value(37.14))
                .andExpect(jsonPath(my + ".costAmount").value(111.42))
                // 摊出=显式 18.57 + 二楼/三楼两桶各 37.14 = 92.85(不是三桶的 111.42)
                .andExpect(jsonPath(my + ".allocatedAmount").value(92.85))
                .andExpect(jsonPath(my + ".gapAmount").value(-18.57))
                // 分桶明细只数入桶的两户;tE 的楼层照样解析得出(证明它是被 weight 分支拦下的)
                .andExpect(jsonPath(my + ".allocNote").value("按 2 层拆:二楼 1 户 / 三楼 1 户"))
                .andExpect(jsonPath(my + ".members[?(@.tenantId==" + tE + ")].floorLabel").value("四楼"));
        mvc.perform(get("/api/alloc/result").param("ym", "2099-11").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.tenantId==" + tE + "&&@.feeKey=='share_elec_floor')].amount").value(18.57))
                .andExpect(jsonPath("$.data[?(@.tenantId==" + t2 + "&&@.feeKey=='share_elec_floor')].amount").value(37.14))
                .andExpect(jsonPath("$.data[?(@.tenantId==" + t3 + "&&@.feeKey=='share_elec_floor')].amount").value(37.14));
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
                .andExpect(jsonPath("$.data.meters[?(@.meterId==" + mWest + ")].label").value("四楼西侧·IT-V69C四西灯·电表①"))
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
                .andExpect(jsonPath("$.data.meters[?(@.meterId==" + mEast + ")].label").value("四楼东侧·IT-V69C四东灯·电表①"))
                .andExpect(jsonPath("$.data.meters[?(@.meterId==" + mThird + ")]").isNotEmpty())
                .andExpect(jsonPath("$.data.tenants[?(@.tenantId==" + t3 + ")].preChecked").value(true));
        // §E6:method=direct(户对户)→ 不推「该定位在租租户」,tenants 空 + tenantNote 说明原因;
        // 表候选不受影响(direct 池照样要绑表)。控制器不透传 method 时这条必红。
        mvc.perform(get(url).param("ym", "2099-11").param("buildingId", String.valueOf(b))
                        .param("floor", "四楼").param("method", "direct").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.tenants").isEmpty())
                .andExpect(jsonPath("$.data.tenantNote").value("整笔归户池只摊给一户,不按定位推在租租户,请直接指定该户"))
                .andExpect(jsonPath("$.data.meters[?(@.meterId==" + mWest + ")]").isNotEmpty());
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
        // §D.4:direct=户对户,受益人由人指定的那一户 → 整条不进提醒条
        // (用户截图里 C座一个 direct 池被推了 13 户「新在租」就是这么来的)
        int rDirect = postId("/api/alloc/rules", "{\"zone\":\"p1\",\"method\":\"direct\","
                + "\"feeKey\":\"share_elec_fire\",\"meterIds\":[" + m + "],\"buildingId\":" + b + ","
                + "\"floorLabel\":\"四楼\",\"feeName\":\"IT-V69整笔归户\","
                + "\"members\":[{\"tenantId\":" + tGone + ",\"weight\":1}]}");
        mvc.perform(get("/api/alloc/member-diff").param("ym", "2099-11").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.ruleId==" + rDirect + ")]").isEmpty());
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

    // 未入池的公摊表:只报 share 且当月有读数且没被任何池绑定的
    @Test
    void meterDiff_reportsUnboundShareMeterOnly() throws Exception {
        int bid = building("IT三期创业大厦");
        int lonely = locMeter("IT孤儿公摊表", bid, "四楼", "电表①");   // kind=elec zone=p1 ownership=share
        reading(lonely, "2099-11", "0", "100");
        String my = "$.data[?(@.meterId==" + lonely + ")]";
        mvc.perform(get("/api/alloc/meter-diff").param("ym", "2099-11").header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath(my).isNotEmpty());
        // 绑进一个池之后就不再报
        int rule = postId("/api/alloc/rules", "{\"zone\":\"p1\",\"name\":\"IT池\",\"buildingId\":" + bid
                + ",\"method\":\"floor\",\"coefficient\":1,\"feeKey\":\"share_elec_floor\",\"feeName\":\"走廊灯\","
                + "\"meterIds\":[" + lonely + "],\"members\":[]}");
        org.junit.jupiter.api.Assertions.assertTrue(rule > 0);
        mvc.perform(get("/api/alloc/meter-diff").param("ym", "2099-11").header("Authorization", auth()))
                .andExpect(jsonPath(my).isEmpty());
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

    // P7 fix round 2:未配「计费口径」(zone_calc_kind)的新期区不是算不出钱——computePool 仍会按平价制(商业电价)把该池算出成本并摊到户。
    // 这正是本任务要消除的「算错了还不报错」——没人能从对账行中发现(p3 池不配口径就不出对账行),所以必须在生成阶段点名。
    // p1/p2 已回填口径(V114),不应该多出这条新警告——同一条断言里一并验证。
    @Test
    void computePool_warnsUnconfiguredZoneCalcKind_configuredZonesStayQuiet() throws Exception {
        int m = createMeter("IT-P7-p9表", "p9", "share", null, null);   // 园区级:不挂栋,直接试新期区
        reading(m, "2099-12", "0", "100");
        postId("/api/alloc/rules", "{\"zone\":\"p9\",\"method\":\"area\",\"coefficient\":1000,"
                + "\"feeKey\":\"share_elec_light\",\"meterIds\":[" + m + "],\"feeName\":\"IT-P7-p9池\"}");
        price("elec_commercial", "2099-12", "0.79416875");
        p2Prices("2099-12");   // p2 规则常驻,任意月生成都要过分时门禁
        mvc.perform(post("/api/alloc/generate").param("ym", "2099-12").header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.warnings", org.hamcrest.Matchers.hasItem(
                        org.hamcrest.Matchers.containsString("p9 未配「计费口径」"))))
                .andExpect(jsonPath("$.data.warnings[?(@ =~ /.*p1 未配「计费口径」.*/)]").isEmpty())
                .andExpect(jsonPath("$.data.warnings[?(@ =~ /.*p2 未配「计费口径」.*/)]").isEmpty());
    }

    // ── §H4.2 b/d/f(V80):原册块与自然键 —— 分带与块内序按原册,不按 building_id ──
    //    锚点全部来自 BOOK-STRUCTURE-2024-02.md §1 与直读原册,块名与 B11/B31/B45/B62/B74/B85/B97 逐字相同。
    @Test
    void poolBookBlock_orderKeysAndZsFeeName() throws Exception {
        // ⚠必须显式给 UTF-8:MockHttpServletResponse.getContentAsString() 无参时按响应 characterEncoding
        // (默认 ISO-8859-1)解,中文会变成「Aåº§」双重编码;andExpect(jsonPath) 内部是自己钉死 UTF-8 的,故不受影响。
        String body = mvc.perform(get("/api/alloc/pools").param("ym", "2099-12").header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        java.util.List<java.util.Map<String, Object>> p1 = JsonPath.read(body, "$.data.rows[?(@.zone=='p1')]");
        // 种子 67 条一期规则全部回填到位,V81(§H4.2e)再补 4 个无表行 → 71;
        // V84(刀I §I1)把块1 的「园区公共电」池拆回原册 r5/r6/r7/r9 四条独立行 → 71−1+4=74
        // (原册 85 个数据行 ≠ 74:另有 11 行是同一个池的多块表,由多表绑定折进这 74 条里)
        org.junit.jupiter.api.Assertions.assertEquals(74, p1.size());
        org.junit.jupiter.api.Assertions.assertTrue(
                p1.stream().allMatch(r -> r.get("bookBlock") != null),
                "有一期池没回填 book_block");
        // book_key=原册 A 列原文;V81 那 4 个无表行 A 列本就是空的 → 只有它们允许 NULL
        org.junit.jupiter.api.Assertions.assertTrue(
                p1.stream().allMatch(r -> r.get("bookKey") != null || "manual".equals(r.get("method"))),
                "有非 manual 的一期池没回填 book_key");
        // 1) 屏序 = 原册 7 块,块名逐字、块序照原册;同块的行必须连续(不许被 building_id 打散)
        java.util.List<String> bands = new java.util.ArrayList<>();
        for (java.util.Map<String, Object> r : p1) {
            String bk = (String) r.get("bookBlock");
            if (bands.isEmpty() || !bands.get(bands.size() - 1).equals(bk)) bands.add(bk);
        }
        org.junit.jupiter.api.Assertions.assertEquals(java.util.List.of(
                "A座及园区公共表合计：", "A座电梯及楼层公共电合计", "B座电梯及楼层公共电合计",
                "C座电梯及楼层公共电合计", "D座电梯及楼层公共电合计", "E座电梯及楼层公共电合计",
                "F座电梯及楼层公共电合计"), bands);
        // 2) 块内 = 原册行序:V84 拆池后块1 = 原册 r5..r10 **六行**,一行不多一行不少
        //    (按 sort_no 排会把 r8 顶到 r5 前面 —— 这正是 V80 另开 book_row 的原因;
        //     新拆的 4 条 sort_no 追加在 p1 末尾 95..98,能排对全靠 book_row 5/6/7/9)
        org.junit.jupiter.api.Assertions.assertEquals(
                java.util.List.of("地下车库东侧照明", "地下车库西侧照明", "A1大堂",
                        "招商中心电1", "生活加压泵", "园区路灯"),
                p1.stream().filter(r -> "A座及园区公共表合计：".equals(r.get("bookBlock")))
                        .map(r -> r.get("bookKey")).toList());
        // 3) 招商中心 3 行分别落在块1(r8)与块2(r17/r18),不再自成一带
        java.util.Map<String, String> blockOf = p1.stream().filter(r -> r.get("bookKey") != null)
                .collect(java.util.stream.Collectors.toMap(
                        r -> (String) r.get("bookKey"), r -> (String) r.get("bookBlock")));
        org.junit.jupiter.api.Assertions.assertEquals("A座及园区公共表合计：", blockOf.get("招商中心电1"));
        org.junit.jupiter.api.Assertions.assertEquals("A座电梯及楼层公共电合计", blockOf.get("中大4楼公共"));
        org.junit.jupiter.api.Assertions.assertEquals("A座电梯及楼层公共电合计", blockOf.get("4楼空调外机电"));
        // 4) §H4.2f:「净电」全簿查无此词 → 该池费项改回原册 D8='招商中心'
        //    ⚠只断言本刀负责的这一行:V70 那批改名按 id 写,而自增起点在 dev 与全新迁移链上差 1,
        //    全新库里 p1 的费项/定位整体错位一行(「净电」在这里落到了 sort_no=23 的损耗池上)。
        //    那是 V70 的存量问题,归 H4c「一期定位归一」处理,本刀不越界替它擦屁股。
        org.junit.jupiter.api.Assertions.assertEquals("招商中心",
                p1.stream().filter(r -> "招商中心电1".equals(r.get("bookKey")))
                        .map(r -> r.get("feeName")).findFirst().orElseThrow());
        // 5) §H4.2e V81 的 4 个无表行:r12 归块2、r47/48/49 归块4,且 r12 排在块2 首位(原册它就在 r13 之前)
        java.util.List<String> manualBlocks = p1.stream().filter(r -> "manual".equals(r.get("method")))
                .map(r -> (String) r.get("bookBlock")).toList();
        org.junit.jupiter.api.Assertions.assertEquals(java.util.List.of(
                "A座电梯及楼层公共电合计", "C座电梯及楼层公共电合计",
                "C座电梯及楼层公共电合计", "C座电梯及楼层公共电合计"), manualBlocks);
        org.junit.jupiter.api.Assertions.assertEquals("一期 A座·一楼·联塑精铟",
                p1.stream().filter(r -> "A座电梯及楼层公共电合计".equals(r.get("bookBlock")))
                        .map(r -> r.get("name")).findFirst().orElseThrow());
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

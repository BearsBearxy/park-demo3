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

// 园区抄表(METER-SPEC):档案 CRUD 守卫、读数快照口径、导入自动建档+幂等覆盖+行级错误。
// @Transactional 回滚;写数据用 2099 远期槽;无种子表,各用例自建自证无顺序依赖。
@AutoConfigureMockMvc
@org.springframework.transaction.annotation.Transactional
class MeterApiIT extends AbstractMysqlIT {

    @Autowired MockMvc mvc;
    // suspect 无写接口(§F2 起 shadow 只由 V75 回填/人工认对产生),护栏用例直接落库造样本。
    // 用 mapper 而非 JdbcTemplate:同一事务里 MyBatis 一级缓存会把上一次 selectList 的表档案缓住,
    // 绕过 mapper 写库则后续读仍是旧快照;走 mapper 的 update 会清掉本会话缓存。
    @Autowired com.park.demo3.mapper.MeterMapper meterMapper;
    @Autowired com.park.demo3.mapper.BuildingMapper buildingMapper;   // V77 用例:按中文栋名取 id(响应体读中文会乱码)
    // §H5 批量删除用例:manual 行造样(无写接口不校租户)+ 审计留痕核对
    @Autowired com.park.demo3.mapper.AllocResultMapper allocResultMapper;
    @Autowired com.park.demo3.mapper.ImportLogMapper importLogMapper;
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

    private int createMeter(String name, String factor) throws Exception {
        String res = mvc.perform(post("/api/meters").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"" + name + "\",\"factor\":" + factor + "}"))
                .andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(res, "$.data.id");
    }

    // ── 档案 CRUD:建→查→同键重名 409→改→删守卫 ──
    @Test
    void meterCrud_dupKey409_deleteGuard() throws Exception {
        int id = createMeter("IT一车间总电", "500");
        // 同(kind,zone,name) 重名 409;不同 zone 同名放行
        mvc.perform(post("/api/meters").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT一车间总电\"}"))
                .andExpect(jsonPath("$.code").value(409));
        mvc.perform(post("/api/meters").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"kind\":\"elec\",\"zone\":\"p2\",\"name\":\"IT一车间总电\"}"))
                .andExpect(jsonPath("$.code").value(0));
        // 过滤查询只见 p1 一块
        mvc.perform(get("/api/meters").param("kind", "elec").param("zone", "p1").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.name=='IT一车间总电')].zone").value("p1"));
        // 编辑描述与倍率
        mvc.perform(put("/api/meters/" + id).header("Authorization", auth())
                .contentType("application/json")
                .content("{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT一车间总电\",\"tenantName\":\"锂朋\",\"factor\":600}"))
                .andExpect(jsonPath("$.data.tenantName").value("锂朋"))
                .andExpect(jsonPath("$.data.factor").value(600));
        // 有读数删除 409;删读数后放行
        mvc.perform(post("/api/meters/readings").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"meterId\":" + id + ",\"ym\":\"2099-01\",\"prevTotal\":100,\"currTotal\":110}"))
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(delete("/api/meters/" + id).header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(409));
    }

    // ── 删守卫二:零读数但绑进公摊池 → 409 点名池,不再穿 FK 报"违反完整性约束"(实测 1139 误读成"有读数") ──
    @Test
    void delete_zeroReadingButPoolBound_409NamesPool() throws Exception {
        int id = createMeter("IT池绑定守卫表", "1");
        mvc.perform(post("/api/alloc/rules").header("Authorization", auth()).contentType("application/json")
                .content("{\"zone\":\"p1\",\"method\":\"none\",\"feeKey\":\"share_elec_fire\","
                        + "\"feeName\":\"IT池守卫\",\"meterIds\":[" + id + "]}"))
                .andExpect(jsonPath("$.code").value(0));
        String res = utf8(mvc.perform(delete("/api/meters/" + id).header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(409)).andReturn());
        String msg = JsonPath.read(res, "$.message");
        org.junit.jupiter.api.Assertions.assertTrue(msg.contains("公摊池"), "守卫信息应点名公摊池: " + msg);
        org.junit.jupiter.api.Assertions.assertFalse(msg.contains("读数"), "零读数的表不得误报有读数: " + msg);
        org.junit.jupiter.api.Assertions.assertNotNull(meterMapper.selectById(id));
    }

    // ── 读数:倍率快照口径——录入后改表倍率,历史用量不漂移;同表同月 409;用量派生 ──
    @Test
    void reading_factorSnapshot_usageDerived() throws Exception {
        int id = createMeter("IT快照表", "500");
        String res = mvc.perform(post("/api/meters/readings").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"meterId\":" + id + ",\"ym\":\"2099-02\",\"prevTotal\":473.65,\"currTotal\":543.99,"
                        + "\"prevSharp\":123.06,\"currSharp\":142.42}"))
                .andExpect(jsonPath("$.code").value(0))
                // 用量=(543.99−473.65)×500=35170;尖段=(142.42−123.06)×500=9680
                .andExpect(jsonPath("$.data.usageTotal").value(35170.0))
                .andExpect(jsonPath("$.data.usageSharp").value(9680.0))
                // 峰平谷未填=null 不硬算
                .andExpect(jsonPath("$.data.usagePeak").doesNotExist())
                .andReturn().getResponse().getContentAsString();
        int rid = JsonPath.read(res, "$.data.id");
        // 同表同月 409
        mvc.perform(post("/api/meters/readings").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"meterId\":" + id + ",\"ym\":\"2099-02\",\"currTotal\":1}"))
                .andExpect(jsonPath("$.code").value(409));
        // 改表倍率 500→9999:历史读数 factor_snap 不回溯,用量不漂移
        mvc.perform(put("/api/meters/" + id).header("Authorization", auth())
                .contentType("application/json")
                .content("{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT快照表\",\"factor\":9999}"))
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(get("/api/meters/" + id + "/readings").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[0].factorSnap").value(500.0))
                .andExpect(jsonPath("$.data[0].usageTotal").value(35170.0));
        // 编辑读数:factor_snap 保持原快照
        mvc.perform(put("/api/meters/readings/" + rid).header("Authorization", auth())
                .contentType("application/json")
                .content("{\"meterId\":" + id + ",\"ym\":\"2099-02\",\"prevTotal\":100,\"currTotal\":101}"))
                .andExpect(jsonPath("$.data.factorSnap").value(500.0))
                .andExpect(jsonPath("$.data.usageTotal").value(500.0))
                .andExpect(jsonPath("$.data.source").value("manual"));
        // 漏抄行照收:currTotal 空 → usage null(前端标黄,不是错误)
        mvc.perform(post("/api/meters/readings").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"meterId\":" + id + ",\"ym\":\"2099-03\",\"prevTotal\":50}"))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.usageTotal").doesNotExist());
    }

    // ── 导入:自动建档+描述刷新;行级错误(空名/非法分区/非法月)跳过;重导幂等覆盖;行倍率优先快照 ──
    @Test
    void import_autoCreate_rowErrors_idempotent() throws Exception {
        String body = "{\"rows\":["
                + "{\"kind\":\"elec\",\"zone\":\"p2\",\"name\":\"IT二期总电\",\"ym\":\"2099-05\","
                + "\"area\":\"二期园区变压器\",\"meterType\":\"总电表\",\"factor\":12000,"
                + "\"prevTotal\":459.21,\"currTotal\":508.85},"
                + "{\"kind\":\"water\",\"zone\":\"dorm\",\"name\":\"IT宿舍总水\",\"ym\":\"2099-05\",\"prevTotal\":1567,\"currTotal\":2137},"
                + "{\"kind\":\"elec\",\"zone\":\"px\",\"name\":\"IT坏分区\",\"ym\":\"2099-05\"},"
                + "{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"\",\"ym\":\"2099-05\"},"
                + "{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT坏月份\",\"ym\":\"2099/05\"}"
                + "]}";
        mvc.perform(post("/api/meters/import").header("Authorization", auth())
                .contentType("application/json").content(body))
                .andExpect(jsonPath("$.data.imported").value(2))
                .andExpect(jsonPath("$.data.skipped").value(3));
        // 自动建档落地(含描述),读数 source=import,用量=(508.85−459.21)×12000=595680
        mvc.perform(get("/api/meters").param("kind", "elec").param("zone", "p2").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.name=='IT二期总电')].meterType").value("总电表"))
                .andExpect(jsonPath("$.data[?(@.name=='IT二期总电')].readingCount").value(1));
        mvc.perform(get("/api/meters/readings").param("ym", "2099-05").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.length()").value(2))
                .andExpect(jsonPath("$.data[0].usageTotal").value(595680.0))
                .andExpect(jsonPath("$.data[0].source").value("import"));
        // 重导同表同月:值覆盖仍单行,档案不重复建;描述空值不清既有
        mvc.perform(post("/api/meters/import").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":[{\"kind\":\"elec\",\"zone\":\"p2\",\"name\":\"IT二期总电\",\"ym\":\"2099-05\","
                        + "\"factor\":12000,\"prevTotal\":459.21,\"currTotal\":500}]}"))
                .andExpect(jsonPath("$.data.imported").value(1));
        mvc.perform(get("/api/meters/readings").param("ym", "2099-05").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.length()").value(2))
                .andExpect(jsonPath("$.data[0].currTotal").value(500.0));
        mvc.perform(get("/api/meters").param("kind", "elec").param("zone", "p2").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.name=='IT二期总电')].meterType").value("总电表"));
        // 年份数据驱动
        mvc.perform(get("/api/meters/years").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@==2099)]").exists());
        // 账期数据驱动:前端默认月直接取 max,顶掉原先 12→1 逐月试探(本表数据最新只到 2024-02 时空打 11 次)
        java.util.List<String> months = JsonPath.read(utf8(mvc.perform(get("/api/meters/months")
                .header("Authorization", auth())).andExpect(jsonPath("$.code").value(0)).andReturn()), "$.data");
        org.junit.jupiter.api.Assertions.assertEquals(months.stream().distinct().sorted().toList(), months,
                "账期须升序无重复: " + months);
        org.junit.jupiter.api.Assertions.assertTrue(months.contains("2099-05")
                && months.stream().allMatch(m -> m.matches("\\d{4}-\\d{2}")), "格式须 YYYY-MM 且含本例月: " + months);
    }

    // ── v2 结构化档案(§6.1):导入行 tenantId/buildingId/ownership 落库;非法 ownership 行级错误;空值不覆盖既有 ──
    @Test
    void import_v2Fields_ownershipRowError() throws Exception {
        String body = "{\"rows\":["
                + "{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"ITv2户内表\",\"ym\":\"2099-06\","
                + "\"tenantId\":12345,\"buildingId\":3,\"ownership\":\"tenant\",\"prevTotal\":10,\"currTotal\":20},"
                + "{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"ITv2坏归属\",\"ym\":\"2099-06\",\"ownership\":\"boss\"}"
                + "]}";
        mvc.perform(post("/api/meters/import").header("Authorization", auth())
                .contentType("application/json").content(body))
                .andExpect(jsonPath("$.data.imported").value(1))
                .andExpect(jsonPath("$.data.skipped").value(1))
                .andExpect(jsonPath("$.data.errors[0].reason").value("归属非法(tenant|share|ops|infra|park|register)"));
        mvc.perform(get("/api/meters").param("kind", "elec").param("zone", "p1").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.name=='ITv2户内表')].tenantId").value(12345))
                .andExpect(jsonPath("$.data[?(@.name=='ITv2户内表')].buildingId").value(3))
                .andExpect(jsonPath("$.data[?(@.name=='ITv2户内表')].ownership").value("tenant"))
                .andExpect(jsonPath("$.data[?(@.name=='ITv2坏归属')]").doesNotExist());
        // 重导空 v2 字段:不覆盖既有(与描述字段同规);缺省 ownership 建档=share(DB 默认)
        mvc.perform(post("/api/meters/import").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":["
                        + "{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"ITv2户内表\",\"ym\":\"2099-07\",\"prevTotal\":20,\"currTotal\":30},"
                        + "{\"kind\":\"water\",\"zone\":\"p1\",\"name\":\"ITv2公共水\",\"ym\":\"2099-07\",\"currTotal\":5}]}"))
                .andExpect(jsonPath("$.data.imported").value(2));
        mvc.perform(get("/api/meters").param("zone", "p1").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.name=='ITv2户内表')].tenantId").value(12345))
                .andExpect(jsonPath("$.data[?(@.name=='ITv2户内表')].ownership").value("tenant"))
                .andExpect(jsonPath("$.data[?(@.name=='ITv2公共水')].ownership").value("share"));
    }

    // ── 刀H §H2(V79):ownership 第 6 值 register(非计费计度寄存器)—— 档案 PUT 与导入两条入口都收 ──
    // (不进Σ 由白名单 AllocService.inSubSigma 保证,那条口径在 AllocApiIT 侧)
    @Test
    void ownershipRegister_acceptedByPutAndImport() throws Exception {
        int id = createMeter("IT永龙反向有功", "100");
        mvc.perform(put("/api/meters/" + id).header("Authorization", auth()).contentType("application/json")
                .content("{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT永龙反向有功\",\"ownership\":\"register\",\"factor\":100}"))
                .andExpect(jsonPath("$.data.ownership").value("register"));
        // 导入行同样收(前端 classifyOwnership 按名称关键词判出 register 后带过来)
        mvc.perform(post("/api/meters/import").header("Authorization", auth()).contentType("application/json")
                .content("{\"rows\":[{\"kind\":\"elec\",\"zone\":\"p2\",\"name\":\"IT某表最大需量\",\"ym\":\"2099-06\","
                        + "\"ownership\":\"register\",\"prevTotal\":0,\"currTotal\":155.27}]}"))
                .andExpect(jsonPath("$.data.imported").value(1))
                .andExpect(jsonPath("$.data.errors").isEmpty());
        mvc.perform(get("/api/meters").param("kind", "elec").param("zone", "p2").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.name=='IT某表最大需量')].ownership").value("register"));
    }

    // ── 身份分层匹配(METER-IMPORT-SPEC §3):无标识列建档 → 编码命中 → 位置命中(编码写回)→ 换表护栏 ──
    @Test
    void import_identityPipeline_codeThenAddr() throws Exception {
        // ① 无标识列(name 空)但有区域/位置/表名 → 合成标签建档,matchBy=new
        mvc.perform(post("/api/meters/import").header("Authorization", auth()).contentType("application/json")
                .content("{\"rows\":[{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"\",\"ym\":\"2099-08\","
                        + "\"area\":\"ITA座\",\"spot\":\"负一层\",\"subName\":\"电表①\",\"code\":\"IT900001\","
                        + "\"factor\":1,\"prevTotal\":686.24,\"currTotal\":715.75}]}"))
                .andExpect(jsonPath("$.data.imported").value(1))
                .andExpect(jsonPath("$.data.matches[0].matchBy").value("new"))
                .andExpect(jsonPath("$.data.matches[0].label").value("ITA座-负一层-电表①"));
        // ② 同一块表换了区域写法/换了租户 → 编码命中,不建新档
        mvc.perform(post("/api/meters/import").header("Authorization", auth()).contentType("application/json")
                .content("{\"rows\":[{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"\",\"ym\":\"2099-09\","
                        + "\"area\":\"ITA座\",\"spot\":\"地下一层车库\",\"subName\":\"电表①\",\"code\":\"IT900001\","
                        + "\"prevTotal\":715.75,\"currTotal\":720}]}"))
                .andExpect(jsonPath("$.data.matches[0].matchBy").value("code"));
        mvc.perform(get("/api/meters").param("kind", "elec").param("zone", "p1").header("Authorization", auth()))
                // value(单值) 在过滤结果 >1 条时会拿到数组而断言失败 → 同时证「只有一块表带这个编码」
                .andExpect(jsonPath("$.data[?(@.code=='IT900001')].readingCount").value(2))
                .andExpect(jsonPath("$.data[?(@.code=='IT900001')].spot").value("地下一层车库"));
        // ③ 无码老档案在新模板里第一次拿到编码 → 位置命中(不是新建),编码写回档案
        mvc.perform(post("/api/meters/import").header("Authorization", auth()).contentType("application/json")
                .content("{\"rows\":[{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT无码老表\",\"ym\":\"2099-08\","
                        + "\"area\":\"ITB座\",\"spot\":\"二层\",\"subName\":\"电表②\",\"prevTotal\":1,\"currTotal\":2}]}"))
                .andExpect(jsonPath("$.data.matches[0].matchBy").value("new"));
        mvc.perform(post("/api/meters/import").header("Authorization", auth()).contentType("application/json")
                .content("{\"rows\":[{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"\",\"ym\":\"2099-09\","
                        + "\"area\":\"ITB座\",\"spot\":\"二层\",\"subName\":\"电表②\",\"code\":\"IT900002\","
                        + "\"prevTotal\":2,\"currTotal\":3}]}"))
                .andExpect(jsonPath("$.data.matches[0].matchBy").value("addr"));
        mvc.perform(get("/api/meters").param("kind", "elec").param("zone", "p1").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.name=='IT无码老表')].code").value("IT900002"))
                .andExpect(jsonPath("$.data[?(@.name=='IT无码老表')].readingCount").value(2));
        // ④ 换表护栏:同位置但编码不同 = 另一块物理表,不继承历史
        mvc.perform(post("/api/meters/import").header("Authorization", auth()).contentType("application/json")
                .content("{\"rows\":[{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT换新表\",\"ym\":\"2099-10\","
                        + "\"area\":\"ITB座\",\"spot\":\"二层\",\"subName\":\"电表②\",\"code\":\"IT999999\","
                        + "\"prevTotal\":0,\"currTotal\":9}]}"))
                .andExpect(jsonPath("$.data.matches[0].matchBy").value("new"));
        mvc.perform(get("/api/meters").param("kind", "elec").param("zone", "p1").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.name=='IT无码老表')].code").value("IT900002"))
                .andExpect(jsonPath("$.data[?(@.name=='IT换新表')].code").value("IT999999"));
    }

    // ── 歧义不猜:同址多块表且行无编码 → 该行不落库、不建档,错误清单列候选 id(§3.4) ──
    @Test
    void import_ambiguousAddr_notWritten() throws Exception {
        mvc.perform(post("/api/meters/import").header("Authorization", auth()).contentType("application/json")
                .content("{\"rows\":["
                        + "{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT天面东\",\"ym\":\"2099-11\",\"area\":\"ITD座\",\"spot\":\"天面\",\"subName\":\"电表①\",\"code\":\"ITX1\",\"prevTotal\":1,\"currTotal\":2},"
                        + "{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT天面西\",\"ym\":\"2099-11\",\"area\":\"ITD座\",\"spot\":\"天面\",\"subName\":\"电表①\",\"code\":\"ITX2\",\"prevTotal\":1,\"currTotal\":3}]}"))
                .andExpect(jsonPath("$.data.imported").value(2));
        mvc.perform(post("/api/meters/import").header("Authorization", auth()).contentType("application/json")
                .content("{\"rows\":[{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT天面无码\",\"ym\":\"2099-12\","
                        + "\"area\":\"ITD座\",\"spot\":\"天面\",\"subName\":\"电表①\",\"prevTotal\":5,\"currTotal\":6}]}"))
                .andExpect(jsonPath("$.data.imported").value(0))
                .andExpect(jsonPath("$.data.skipped").value(1))
                .andExpect(jsonPath("$.data.errors[0].reason").value(org.hamcrest.Matchers.containsString("匹配到多块表")));
        mvc.perform(get("/api/meters").param("kind", "elec").param("zone", "p1").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.name=='IT天面无码')]").doesNotExist());
        mvc.perform(get("/api/meters/readings").param("ym", "2099-12").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.length()").value(0));
    }

    // ── §J1 位置歧义按企业名称收窄:原册「B座-天面-电表①」三行同键无码,只有企业名称两两不同;
    //    用户文件又丢了标识列(name 空)→ L1/L3 全落空,唯一出路是 D 列企业名称 ──
    @Test
    void import_addrAmbiguity_narrowedByTenantName() throws Exception {
        int east = createAddrMeter("ITJ-B东侧楼梯间", "ITJ座", "IT东侧楼梯间消防照明");
        int west = createAddrMeter("ITJ-B西侧楼梯间", "ITJ座", "IT西侧楼梯间消防照明");
        int lift = createAddrMeter("ITJ-B东侧货梯", "ITJ座", "IT东侧货梯");
        // ① 三行各自命中、零歧义、零新建(matchBy 全是 addr,meterId 全是既有档案)
        mvc.perform(post("/api/meters/import").header("Authorization", auth()).contentType("application/json")
                .content("{\"rows\":["
                        + addrRow("2099-02", "ITJ座", "IT东侧楼梯间消防照明") + ","
                        + addrRow("2099-02", "ITJ座", "IT西侧楼梯间消防照明") + ","
                        + addrRow("2099-02", "ITJ座", "IT东侧货梯") + "]}"))
                .andExpect(jsonPath("$.data.imported").value(3))
                .andExpect(jsonPath("$.data.skipped").value(0))
                .andExpect(jsonPath("$.data.matches[0].matchBy").value("addr"))
                .andExpect(jsonPath("$.data.matches[1].matchBy").value("addr"))
                .andExpect(jsonPath("$.data.matches[2].matchBy").value("addr"))
                .andExpect(jsonPath("$.data.matches[0].meterId").value(east))
                .andExpect(jsonPath("$.data.matches[1].meterId").value(west))
                .andExpect(jsonPath("$.data.matches[2].meterId").value(lift));
        mvc.perform(get("/api/meters/readings").param("ym", "2099-02").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.length()").value(3));
        // ③ 近名不许并:精确相等才收窄,「许振虎」与「许振虎临电」必须落到各自的表
        int zhh = createAddrMeter("ITJ-许振虎电", "ITJ许座", "IT许振虎");
        int zhl = createAddrMeter("ITJ-许振虎临电", "ITJ许座", "IT许振虎临电");
        mvc.perform(post("/api/meters/import").header("Authorization", auth()).contentType("application/json")
                .content("{\"rows\":["
                        + addrRow("2099-03", "ITJ许座", "IT许振虎") + ","
                        + addrRow("2099-03", "ITJ许座", "IT许振虎临电") + "]}"))
                .andExpect(jsonPath("$.data.imported").value(2))
                .andExpect(jsonPath("$.data.skipped").value(0))
                .andExpect(jsonPath("$.data.matches[0].meterId").value(zhh))
                .andExpect(jsonPath("$.data.matches[1].meterId").value(zhl));
        // ④ 导入行企业名称为空 → 跳过这一层,行为与改前一致(仍抛歧义、不落库);文案给「缺标识列」那条出路
        mvc.perform(post("/api/meters/import").header("Authorization", auth()).contentType("application/json")
                .content("{\"rows\":[{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"\",\"ym\":\"2099-04\","
                        + "\"area\":\"ITJ座\",\"spot\":\"天面\",\"subName\":\"电表①\",\"prevTotal\":1,\"currTotal\":2}]}"))
                .andExpect(jsonPath("$.data.imported").value(0))
                .andExpect(jsonPath("$.data.skipped").value(1))
                .andExpect(jsonPath("$.data.errors[0].reason")
                        .value(org.hamcrest.Matchers.containsString("匹配到多块表")))
                .andExpect(jsonPath("$.data.errors[0].reason")
                        .value(org.hamcrest.Matchers.containsString("本文件缺原册首列(标识名)")))
                .andExpect(jsonPath("$.data.errors[0].reason")
                        .value(org.hamcrest.Matchers.containsString("导出当月")));
        mvc.perform(get("/api/meters/readings").param("ym", "2099-04").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.length()").value(0));
    }

    // ── §J2 ② 企业名称也相同 → 仍歧义(不猜),且文案换成「标识名与企业名称都没命中,请核对档案」──
    @Test
    void import_addrAmbiguity_sameTenantStillAmbiguous() throws Exception {
        createAddrMeter("ITJ2甲表", "ITJ2座", "IT同名企业");
        createAddrMeter("ITJ2乙表", "ITJ2座", "IT同名企业");
        mvc.perform(post("/api/meters/import").header("Authorization", auth()).contentType("application/json")
                .content("{\"rows\":[{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"ITJ2丙表\",\"ym\":\"2099-05\","
                        + "\"area\":\"ITJ2座\",\"spot\":\"天面\",\"subName\":\"电表①\","
                        + "\"tenantName\":\"IT同名企业\",\"prevTotal\":1,\"currTotal\":2}]}"))
                .andExpect(jsonPath("$.data.imported").value(0))
                .andExpect(jsonPath("$.data.skipped").value(1))
                .andExpect(jsonPath("$.data.errors[0].reason")
                        .value(org.hamcrest.Matchers.containsString("匹配到多块表")))
                .andExpect(jsonPath("$.data.errors[0].reason")
                        .value(org.hamcrest.Matchers.containsString("标识名「ITJ2丙表」与企业名称「IT同名企业」")))
                .andExpect(jsonPath("$.data.errors[0].reason")
                        .value(org.hamcrest.Matchers.containsString("请核对档案")));
        // 歧义行不建档、不落读数
        mvc.perform(get("/api/meters").param("kind", "elec").param("zone", "p1").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.name=='ITJ2丙表')]").doesNotExist());
        mvc.perform(get("/api/meters/readings").param("ym", "2099-05").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.length()").value(0));
    }

    // §J1 收窄只准用于位置歧义:编码重复是**档案脏**,必须报出来让人去重。
    // 用企业名称把它静默绑掉会掩盖问题,且重复编码的两块表未必同栋(可能跨楼栋写错表)。
    @Test
    void import_codeAmbiguity_notRescuedByTenantName() throws Exception {
        // 两块**不同栋、不同位置**的表共用一个编码(档案脏的真实形态),企业名称互异
        createDupCodeMeter("ITJ3甲", "ITJ3甲座", "一楼", "IT甲企业");
        createDupCodeMeter("ITJ3乙", "ITJ3乙座", "二楼", "IT乙企业");
        // 导入行带该编码 + 其中一个企业名称:若收窄误接到 L1,这行会被静默绑到「IT甲企业」那块
        mvc.perform(post("/api/meters/import").header("Authorization", auth()).contentType("application/json")
                .content("{\"rows\":[{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"ITJ3甲\",\"ym\":\"2099-06\","
                        + "\"area\":\"ITJ3甲座\",\"spot\":\"一楼\",\"subName\":\"电表①\",\"code\":\"ITJ3DUP\","
                        + "\"tenantName\":\"IT甲企业\",\"prevTotal\":1,\"currTotal\":2}]}"))
                .andExpect(jsonPath("$.data.imported").value(0))
                .andExpect(jsonPath("$.data.skipped").value(1))
                .andExpect(jsonPath("$.data.errors[0].reason")
                        .value(org.hamcrest.Matchers.containsString("按编码匹配到多块表")))
                .andExpect(jsonPath("$.data.errors[0].reason")
                        .value(org.hamcrest.Matchers.containsString("该编码在档案里重复,请先去重")));
        mvc.perform(get("/api/meters/readings").param("ym", "2099-06").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.length()").value(0));
    }

    // 编码重复的脏档案(不同栋、不同位置、同一个 code):用于锁「L1 编码歧义不许被企业名称救」
    private void createDupCodeMeter(String name, String area, String spot, String tenantName) throws Exception {
        mvc.perform(post("/api/meters").header("Authorization", auth()).contentType("application/json")
                .content("{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"" + name + "\",\"area\":\"" + area
                        + "\",\"spot\":\"" + spot + "\",\"subName\":\"电表①\",\"code\":\"ITJ3DUP\","
                        + "\"tenantName\":\"" + tenantName + "\"}"))
                .andExpect(jsonPath("$.code").value(0));
    }

    // 同 area+spot+subName、无编码、只有企业名称不同的档案(原册 r108–r111 那种)
    private int createAddrMeter(String name, String area, String tenantName) throws Exception {
        String res = mvc.perform(post("/api/meters").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"" + name + "\",\"area\":\"" + area
                        + "\",\"spot\":\"天面\",\"subName\":\"电表①\",\"tenantName\":\"" + tenantName + "\"}"))
                .andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(res, "$.data.id");
    }

    // 缺标识列(name 空)、无编码的导入行 —— 复刻用户那份文件的形状
    private String addrRow(String ym, String area, String tenantName) {
        return "{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"\",\"ym\":\"" + ym + "\",\"area\":\"" + area
                + "\",\"spot\":\"天面\",\"subName\":\"电表①\",\"tenantName\":\"" + tenantName
                + "\",\"prevTotal\":1,\"currTotal\":2}";
    }

    // ── 存疑两级 + §F2 探针「只提示不打标」+ §F4 清标条件:
    //    导入自动只落 incomplete(四空=档案不全,照常计入Σ);疑似重复只出提示清单、不打 shadow、不影响计算;
    //    档案完整的两块表读数全等(225/226 那类真·不同表)一律不提示不打标;
    //    shadow(V75 回填/人工认对)才踢出分表Σ;改倍率不清标,补了区域才清标 ──
    @Test
    void import_dupNoticeOnly_incompleteInSigma_shadowOutOfSigma_clearOnlyWhenIdentified() throws Exception {
        String bRes = mvc.perform(post("/api/buildings").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"name\":\"IT-F1-A座\",\"phase\":1,\"floorCount\":5,\"totalArea\":10000,\"rentableArea\":9000}"))
                .andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsString();
        int b = JsonPath.read(bRes, "$.data.id");
        // ① 楼栋总表(C=20000)+ 档案完整的真分表(位置/编码齐全,用量 4169.89−4153.80=16.09)
        String r1 = mvc.perform(post("/api/meters/import").header("Authorization", auth()).contentType("application/json")
                .content("{\"rows\":["
                        + "{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT-F1总表\",\"ym\":\"2099-04\","
                        + "\"buildingId\":" + b + ",\"ownership\":\"infra\",\"area\":\"ITA座\",\"spot\":\"配电房\","
                        + "\"code\":\"IT770000\",\"prevTotal\":0,\"currTotal\":20000},"
                        + "{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT影子真档案\",\"ym\":\"2099-04\","
                        + "\"buildingId\":" + b + ",\"ownership\":\"share\",\"area\":\"ITA座\",\"spot\":\"四楼437室\","
                        + "\"code\":\"IT770001\",\"prevTotal\":4153.80,\"currTotal\":4169.89}]}"))
                .andExpect(jsonPath("$.data.imported").value(2))
                .andReturn().getResponse().getContentAsString();
        int realId = JsonPath.read(r1, "$.data.matches[1].meterId");
        // ② 换了租户名的同一块物理表:三层身份键全落空 → 新建。§F2:只出「疑似重复建档」提示(点名真表 id),
        //    **不打 shadow**——四空只落 incomplete,照常计入Σ;提示不算跳过,skipped 仍为 0。
        //    另一块同样四空、读数与谁都不等 → incomplete 且无提示。
        String res = mvc.perform(post("/api/meters/import").header("Authorization", auth()).contentType("application/json")
                .content("{\"rows\":["
                        + "{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT影子新档案\",\"ym\":\"2099-04\","
                        + "\"buildingId\":" + b + ",\"ownership\":\"share\",\"prevTotal\":4153.80,\"currTotal\":4169.89},"
                        + "{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT档案不全表\",\"ym\":\"2099-04\","
                        + "\"buildingId\":" + b + ",\"ownership\":\"share\",\"prevTotal\":0,\"currTotal\":999}]}"))
                .andExpect(jsonPath("$.data.imported").value(2))
                .andExpect(jsonPath("$.data.skipped").value(0))
                .andExpect(jsonPath("$.data.matches[0].matchBy").value("new"))
                .andExpect(jsonPath("$.data.notices.length()").value(1))
                .andExpect(jsonPath("$.data.notices[0].reason")
                        .value(org.hamcrest.Matchers.containsString("id " + realId)))
                .andReturn().getResponse().getContentAsString();
        // 中文名过滤只在断言里做(getContentAsString 无字符集,直接读中文会乱码)→ id 走 matches 拿
        int shadowId = JsonPath.read(res, "$.data.matches[0].meterId");
        mvc.perform(get("/api/meters").param("kind", "elec").param("zone", "p1")
                        .header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.name=='IT影子新档案')].suspect").value("incomplete"))
                .andExpect(jsonPath("$.data[?(@.name=='IT档案不全表')].suspect").value("incomplete"))
                // 档案完整的表两级都不标(字段序列化为 null,故按值过滤断言「不存在这样的行」)
                .andExpect(jsonPath("$.data[?(@.name=='IT影子真档案' && @.suspect=='shadow')]").doesNotExist())
                .andExpect(jsonPath("$.data[?(@.name=='IT影子真档案' && @.suspect=='incomplete')]").doesNotExist());
        // ③ §F2 反例(实测 225 A4东侧总1 / 226 A4东侧总2 都 0.10 那类):两块**档案完整**的表读数三格全等,
        //    是真·不同表 —— 旧判据「同月 curr_total 相等」会误报并当场踢出Σ,新判据第一道(四空)就过不了
        mvc.perform(post("/api/meters/import").header("Authorization", auth()).contentType("application/json")
                .content("{\"rows\":["
                        + "{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"ITA4东侧总1\",\"ym\":\"2099-04\","
                        + "\"buildingId\":" + b + ",\"area\":\"ITA4\",\"code\":\"IT770010\",\"prevTotal\":0,\"currTotal\":0.10},"
                        + "{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"ITA4东侧总2\",\"ym\":\"2099-04\","
                        + "\"buildingId\":" + b + ",\"area\":\"ITA4\",\"code\":\"IT770011\",\"prevTotal\":0,\"currTotal\":0.10}]}"))
                .andExpect(jsonPath("$.data.imported").value(2))
                .andExpect(jsonPath("$.data.notices.length()").value(0));
        mvc.perform(get("/api/meters").param("kind", "elec").param("zone", "p1").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.code=='IT770010' && @.suspect=='shadow')]").doesNotExist())
                .andExpect(jsonPath("$.data[?(@.code=='IT770010' && @.suspect=='incomplete')]").doesNotExist())
                .andExpect(jsonPath("$.data[?(@.code=='IT770011' && @.suspect=='shadow')]").doesNotExist())
                .andExpect(jsonPath("$.data[?(@.code=='IT770011' && @.suspect=='incomplete')]").doesNotExist());
        // ④ incomplete 照常入Σ:D = 真档案 16.09 + 疑似重复档 16.09 + 999 + 0.10 + 0.10 = 1031.38
        //    (这一档保住 5 块挂栋的 p2 临电;导入自动打 shadow 的话这里就少 16.09)
        mvc.perform(get("/api/alloc/recon").param("ym", "2099-04").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.lossRows[?(@.buildingId==" + b + ")].headQty").value(20000.0))
                .andExpect(jsonPath("$.data.lossRows[?(@.buildingId==" + b + ")].subQty").value(1031.38));
        // ⑤ 人工认对后打 shadow(V75 回填走同一判据;无写接口故直接落库)→ 护栏生效,那 16.09 退出Σ
        com.park.demo3.entity.Meter mk = meterMapper.selectById(shadowId);
        mk.setSuspect("shadow");
        meterMapper.updateById(mk);
        mvc.perform(get("/api/alloc/recon").param("ym", "2099-04").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.lossRows[?(@.buildingId==" + b + ")].subQty").value(1015.29));
        // ⑥ 重导同一行:标记不被导入刷掉(applyDesc 不碰 suspect)
        mvc.perform(post("/api/meters/import").header("Authorization", auth()).contentType("application/json")
                .content("{\"rows\":[{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT影子新档案\",\"ym\":\"2099-04\","
                        + "\"buildingId\":" + b + ",\"prevTotal\":4153.80,\"currTotal\":4169.89}]}"))
                .andExpect(jsonPath("$.data.imported").value(1));
        mvc.perform(get("/api/meters").param("kind", "elec").param("zone", "p1").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.name=='IT影子新档案')].suspect").value("shadow"));
        // ⑦ §F4:抽屉里改个倍率也走全量 PUT —— 没补齐任何识别信息,标必须留住(否则护栏一改倍率就失效)
        mvc.perform(put("/api/meters/" + shadowId).header("Authorization", auth()).contentType("application/json")
                .content("{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT影子新档案\",\"factor\":60}"))
                .andExpect(jsonPath("$.data.factor").value(60))
                .andExpect(jsonPath("$.data.suspect").value("shadow"));
        // ⑧ 补上区域(识别信息由空变非空)=认领该档案 → 清标,重新计入Σ
        mvc.perform(put("/api/meters/" + shadowId).header("Authorization", auth()).contentType("application/json")
                .content("{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT影子新档案\",\"factor\":60,\"area\":\"ITA座\"}"))
                .andExpect(jsonPath("$.data.suspect").value(org.hamcrest.Matchers.nullValue()));
    }

    // ── 位置三列(§E8 三态 + §F6 loc_manual;V78 §G5 起是位掩码 bit0=1楼层/bit1=2方位/bit2=4房号):
    //    未人工设定(该位=0)→ 导入跟着 spot 重解析,表挪了地方楼层自动跟上(否则 floor 池桶数与逐户金额算错);
    //    人工设定过(该位=1)→ 导入该列不动,原文变了只落一条 warn(不跳行);
    //    PUT ""=显式清除(不被 spot 解析回来,且清除本身算人工设定,保得住);PUT 不传=按 spot 解析(恢复自动跟随)。
    //    PUT 返回体是 updateById 之后重新 selectById 的,等价于查库 ──
    @Test
    void meterLoc_autoFollowsSpot_manualPinnedWithWarn_blankClears() throws Exception {
        // 【要求③】新建表 loc_manual=0:建档不传三列 = 按 spot 解析,与解析一致故不算人工设定
        String res = mvc.perform(post("/api/meters").header("Authorization", auth()).contentType("application/json")
                .content("{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT位置表\",\"spot\":\"三楼\",\"code\":\"IT740001\"}"))
                .andExpect(jsonPath("$.data.floorLabel").value("三楼"))
                .andExpect(jsonPath("$.data.locManual").value(0))
                .andReturn().getResponse().getContentAsString();
        int id = JsonPath.read(res, "$.data.id");
        // 【要求①】未人工确认 + 导入改 spot(按编码命中同一块表)→ 三列全部跟着新原文重解析
        mvc.perform(post("/api/meters/import").header("Authorization", auth()).contentType("application/json")
                .content("{\"rows\":[{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT位置表\",\"ym\":\"2099-06\","
                        + "\"spot\":\"四楼西侧\",\"code\":\"IT740001\",\"prevTotal\":1,\"currTotal\":2}]}"))
                .andExpect(jsonPath("$.data.matches[0].matchBy").value("code"))
                .andExpect(jsonPath("$.data.notices.length()").value(0));   // 自动跟随不吵人
        mvc.perform(get("/api/meters").param("kind", "elec").param("zone", "p1").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.code=='IT740001')].spot").value("四楼西侧"))
                .andExpect(jsonPath("$.data[?(@.code=='IT740001')].floorLabel").value("四楼"))
                .andExpect(jsonPath("$.data[?(@.code=='IT740001')].side").value("西侧"))
                .andExpect(jsonPath("$.data[?(@.code=='IT740001')].locManual").value(0));
        // ② 人工把楼层改成六楼(主数据比位置原文准的真实场景:spot 写错/写粗)→ 与解析不同,置人工标志
        mvc.perform(put("/api/meters/" + id).header("Authorization", auth()).contentType("application/json")
                .content("{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT位置表\",\"spot\":\"四楼西侧\",\"code\":\"IT740001\","
                        + "\"floorLabel\":\"六楼\"}"))
                .andExpect(jsonPath("$.data.floorLabel").value("六楼"))
                .andExpect(jsonPath("$.data.locManual").value(1));
        // 【要求②】人工改过楼层 + 导入又换了位置原文 → **被人工设定的那一列**不动(楼层仍是六楼),
        //          只落一条 warn 点名新原文与人工楼层;提示不算跳过(skipped=0),行照常导入。
        //          V78 §G5:方位没被人工碰过(西侧本就是原文解析结果)→ 照常跟着新原文变成东侧,
        //          这正是本刀要修的「只改一列却把三列一起冻住」。
        mvc.perform(post("/api/meters/import").header("Authorization", auth()).contentType("application/json")
                .content("{\"rows\":[{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT位置表\",\"ym\":\"2099-07\","
                        + "\"spot\":\"五楼东侧\",\"code\":\"IT740001\",\"prevTotal\":2,\"currTotal\":3}]}"))
                .andExpect(jsonPath("$.data.imported").value(1))
                .andExpect(jsonPath("$.data.skipped").value(0))
                .andExpect(jsonPath("$.data.notices.length()").value(1))
                .andExpect(jsonPath("$.data.notices[0].reason")
                        .value(org.hamcrest.Matchers.containsString("五楼东侧")))
                .andExpect(jsonPath("$.data.notices[0].reason")
                        .value(org.hamcrest.Matchers.containsString("六楼")));
        mvc.perform(get("/api/meters").param("kind", "elec").param("zone", "p1").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.code=='IT740001')].spot").value("五楼东侧"))
                .andExpect(jsonPath("$.data[?(@.code=='IT740001')].floorLabel").value("六楼"))
                .andExpect(jsonPath("$.data[?(@.code=='IT740001')].side").value("东侧"));
        // ③ 空串=显式清除(§E8「留空=跨层」):落 NULL,不被同请求里的 spot 解析回五楼;清除也算人工设定
        mvc.perform(put("/api/meters/" + id).header("Authorization", auth()).contentType("application/json")
                .content("{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT位置表\",\"spot\":\"五楼东侧\",\"code\":\"IT740001\","
                        + "\"floorLabel\":\"\",\"side\":\"\"}"))
                .andExpect(jsonPath("$.data.spot").value("五楼东侧"))
                .andExpect(jsonPath("$.data.floorLabel").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.data.side").value(org.hamcrest.Matchers.nullValue()))
                // 楼层(1)+方位(2)两列都被显式清空,房号本就与解析一致(都是 null)→ 掩码=3,房号那位仍自动
                .andExpect(jsonPath("$.data.locManual").value(3));
        // ④ 原文没变的重导:跨层设定保得住,且**不重复报 warn**(人工值与解析不同本就是常态,每次都报=噪音)
        mvc.perform(post("/api/meters/import").header("Authorization", auth()).contentType("application/json")
                .content("{\"rows\":[{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT位置表\",\"ym\":\"2099-08\","
                        + "\"spot\":\"五楼东侧\",\"code\":\"IT740001\",\"prevTotal\":3,\"currTotal\":4}]}"))
                .andExpect(jsonPath("$.data.notices.length()").value(0));
        mvc.perform(get("/api/meters").param("kind", "elec").param("zone", "p1").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.code=='IT740001' && @.floorLabel=='五楼')]").doesNotExist());
        // ⑤ 不传(null)=不指定 → 按 spot 解析,与原文重新一致 → 人工标志撤回 0(恢复自动跟随,不需要另开一个开关)
        mvc.perform(put("/api/meters/" + id).header("Authorization", auth()).contentType("application/json")
                .content("{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT位置表\",\"spot\":\"五楼东侧\",\"code\":\"IT740001\"}"))
                .andExpect(jsonPath("$.data.floorLabel").value("五楼"))
                .andExpect(jsonPath("$.data.side").value("东侧"))
                .andExpect(jsonPath("$.data.locManual").value(0));
    }

    // ── 归属两列(V77 §G2 owner_manual):
    //    未人工改过(=0)→ 导入照常回写 ownership/building_id(自动分类继续起作用);
    //    人工在档案抽屉改过(=1)→ 导入两列一列不动,判定不同只落一条 warn(不跳行)。
    //    这是首审 P0「导入无条件回写归属,每重导一次就把人工修正静默推翻」的护栏 ──
    @Test
    void meterOwner_importOverwritesUntilManual_thenPinnedWithWarn() throws Exception {
        String b1Res = mvc.perform(post("/api/buildings").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"name\":\"IT-G2-A座\",\"phase\":1,\"floorCount\":5,\"totalArea\":100,\"rentableArea\":90}"))
                .andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsString();
        int b1 = JsonPath.read(b1Res, "$.data.id");
        String b2Res = mvc.perform(post("/api/buildings").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"name\":\"IT-G2-招商中心\",\"phase\":1,\"floorCount\":3,\"totalArea\":100,\"rentableArea\":90}"))
                .andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsString();
        int b2 = JsonPath.read(b2Res, "$.data.id");
        // 【要求②】未人工改过:导入判 infra + 挂 b2(area=招商中心/meter_type=总电表 的真实自动分类结果)→ 照常回写
        String res = mvc.perform(post("/api/meters/import").header("Authorization", auth()).contentType("application/json")
                .content("{\"rows\":[{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT归属表\",\"ym\":\"2099-09\","
                        + "\"code\":\"IT770020\",\"area\":\"IT招商中心\",\"ownership\":\"infra\",\"buildingId\":" + b2 + ","
                        + "\"prevTotal\":0,\"currTotal\":10}]}"))
                .andExpect(jsonPath("$.data.imported").value(1))
                .andExpect(jsonPath("$.data.notices.length()").value(0))
                .andReturn().getResponse().getContentAsString();
        int id = JsonPath.read(res, "$.data.matches[0].meterId");
        mvc.perform(get("/api/meters").param("kind", "elec").param("zone", "p1").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.code=='IT770020')].ownership").value("infra"))
                .andExpect(jsonPath("$.data[?(@.code=='IT770020')].buildingId").value(b2))
                .andExpect(jsonPath("$.data[?(@.code=='IT770020')].ownerManual").value(0));
        // 【要求①上半】人工在抽屉改归属(share + 挂 b1,即 V66 对招商中心两块总表做的那件事)→ 置人工标志
        mvc.perform(put("/api/meters/" + id).header("Authorization", auth()).contentType("application/json")
                .content("{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT归属表\",\"code\":\"IT770020\",\"area\":\"IT招商中心\","
                        + "\"ownership\":\"share\",\"buildingId\":" + b1 + "}"))
                .andExpect(jsonPath("$.data.ownership").value("share"))
                .andExpect(jsonPath("$.data.buildingId").value(b1))
                .andExpect(jsonPath("$.data.ownerManual").value(1));
        // 【要求①下半】再导入同一块表(自动分类仍判 infra/b2)→ 两列纹丝不动,只落一条点名 warn;提示不算跳过
        mvc.perform(post("/api/meters/import").header("Authorization", auth()).contentType("application/json")
                .content("{\"rows\":[{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT归属表\",\"ym\":\"2099-10\","
                        + "\"code\":\"IT770020\",\"area\":\"IT招商中心\",\"ownership\":\"infra\",\"buildingId\":" + b2 + ","
                        + "\"prevTotal\":10,\"currTotal\":20}]}"))
                .andExpect(jsonPath("$.data.imported").value(1))
                .andExpect(jsonPath("$.data.skipped").value(0))
                .andExpect(jsonPath("$.data.notices.length()").value(1))
                .andExpect(jsonPath("$.data.notices[0].reason")
                        .value(org.hamcrest.Matchers.containsString("infra")))
                .andExpect(jsonPath("$.data.notices[0].reason")
                        .value(org.hamcrest.Matchers.containsString(String.valueOf(b2))));
        mvc.perform(get("/api/meters").param("kind", "elec").param("zone", "p1").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.code=='IT770020')].ownership").value("share"))
                .andExpect(jsonPath("$.data[?(@.code=='IT770020')].buildingId").value(b1))
                .andExpect(jsonPath("$.data[?(@.code=='IT770020')].ownerManual").value(1));
        // 判定与人工值一致的重导不吵人(否则每块人工设定过的表每次导入都要报一遍)
        mvc.perform(post("/api/meters/import").header("Authorization", auth()).contentType("application/json")
                .content("{\"rows\":[{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT归属表\",\"ym\":\"2099-11\","
                        + "\"code\":\"IT770020\",\"ownership\":\"share\",\"buildingId\":" + b1 + ","
                        + "\"prevTotal\":20,\"currTotal\":30}]}"))
                .andExpect(jsonPath("$.data.notices.length()").value(0));
    }

    // ── 【要求③】V77 §G1:招商中心电1/2 恢复到「一期A座 + share + 人工标志」,导入再也推不翻。
    //    依据 V66 §4(S92 净效果=这两块表 1142.40 度计入 A座分表Σ);V65 已把两块表与「一期 A座」种进库,
    //    故 CI 容器与 dev 库同样成立 ──
    @Test
    void v77_zsMeterOwnerRestored() throws Exception {
        // 楼栋走 mapper 取:getContentAsString 无字符集,拿中文名过滤会乱码(同上面 §F2 用例的注释)
        java.util.List<com.park.demo3.entity.Building> as = buildingMapper.selectList(
                new com.baomidou.mybatisplus.core.conditions.query.QueryWrapper<com.park.demo3.entity.Building>()
                        .eq("name", "一期 A座"));
        org.junit.jupiter.api.Assertions.assertEquals(1, as.size(), "V65 应种有唯一的「一期 A座」");
        Integer aId = as.get(0).getId();
        for (String n : new String[]{"招商中心电1", "招商中心电2"}) {
            com.park.demo3.entity.Meter m = meterMapper.selectByKey("elec", "p1", n);
            org.junit.jupiter.api.Assertions.assertNotNull(m, n + " 应由 V65 种入");
            org.junit.jupiter.api.Assertions.assertEquals(aId, m.getBuildingId(), n + " 应挂一期A座");
            org.junit.jupiter.api.Assertions.assertEquals("share", m.getOwnership(), n + " 应为 share");
            org.junit.jupiter.api.Assertions.assertEquals(Integer.valueOf(1), m.getOwnerManual(), n + " 应标人工归属");
        }
    }

    // ── 【要求①】V78 §G5:loc_manual 拆成按列判定(位掩码)——只改房号,楼层不被冻结,
    //    之后导入换了位置原文,楼层/方位照常跟着重解析,只有房号保住人工值。
    //    旧口径(三列共用一个布尔)下这块表的楼层会永久停在三楼:floor 池桶数与逐户金额跟着错,零告警 ──
    @Test
    void meterLoc_perColumnPin_roomOnlyKeepsFloorAuto() throws Exception {
        String res = mvc.perform(post("/api/meters").header("Authorization", auth()).contentType("application/json")
                .content("{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT分列位置表\",\"spot\":\"三楼西侧301室\","
                        + "\"code\":\"IT740100\"}"))
                .andExpect(jsonPath("$.data.floorLabel").value("三楼"))
                .andExpect(jsonPath("$.data.side").value("西侧"))
                .andExpect(jsonPath("$.data.roomNo").value("301室"))
                .andExpect(jsonPath("$.data.locManual").value(0))
                .andReturn().getResponse().getContentAsString();
        int id = JsonPath.read(res, "$.data.id");
        // 人工**只**改房号(原文写的是 301,实地是 302)→ 只置房号位(4),楼层/方位仍与原文解析一致
        mvc.perform(put("/api/meters/" + id).header("Authorization", auth()).contentType("application/json")
                .content("{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT分列位置表\",\"spot\":\"三楼西侧301室\","
                        + "\"code\":\"IT740100\",\"roomNo\":\"302室\"}"))
                .andExpect(jsonPath("$.data.roomNo").value("302室"))
                .andExpect(jsonPath("$.data.locManual").value(4));
        // 表挪到五楼东侧:导入按 spot 重解析**楼层与方位**(未被人工设定),房号保住人工值;
        // 楼层没被冻结 → 不落 warn(warn 只为「楼层被冻住而原文变了」这一种真冲突而设)
        mvc.perform(post("/api/meters/import").header("Authorization", auth()).contentType("application/json")
                .content("{\"rows\":[{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT分列位置表\",\"ym\":\"2099-06\","
                        + "\"spot\":\"五楼东侧305室\",\"code\":\"IT740100\",\"prevTotal\":1,\"currTotal\":2}]}"))
                .andExpect(jsonPath("$.data.imported").value(1))
                .andExpect(jsonPath("$.data.notices.length()").value(0));
        mvc.perform(get("/api/meters").param("kind", "elec").param("zone", "p1").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.code=='IT740100')].floorLabel").value("五楼"))
                .andExpect(jsonPath("$.data[?(@.code=='IT740100')].side").value("东侧"))
                .andExpect(jsonPath("$.data[?(@.code=='IT740100')].roomNo").value("302室"))
                .andExpect(jsonPath("$.data[?(@.code=='IT740100')].locManual").value(4));
    }

    // ── 【要求②】§G5 shadow 只能打不能解:自动清标的唯一条件是「识别信息由空变非空」,
    //    档案本来就齐全的表(被误判重复的那种)永远解不掉、永远不进分表Σ。
    //    新入口 = PUT suspect:""(抽屉「认领为独立表」),解除后用量立即重新计入Σ ──
    @Test
    void meterSuspect_manualClaimClearsShadow_backIntoSigma() throws Exception {
        String bRes = mvc.perform(post("/api/buildings").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"name\":\"IT-G5-A座\",\"phase\":1,\"floorCount\":5,\"totalArea\":100,\"rentableArea\":90}"))
                .andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsString();
        int b = JsonPath.read(bRes, "$.data.id");
        // 楼栋总表 C=1000 + 一块**档案齐全**的分表 D=100
        String r = mvc.perform(post("/api/meters/import").header("Authorization", auth()).contentType("application/json")
                .content("{\"rows\":["
                        + "{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT-G5总表\",\"ym\":\"2099-04\","
                        + "\"buildingId\":" + b + ",\"ownership\":\"infra\",\"area\":\"ITG5区\",\"spot\":\"配电房\","
                        + "\"code\":\"IT770030\",\"prevTotal\":0,\"currTotal\":1000},"
                        + "{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT-G5分表\",\"ym\":\"2099-04\","
                        + "\"buildingId\":" + b + ",\"ownership\":\"share\",\"area\":\"ITG5区\",\"spot\":\"三楼\","
                        + "\"code\":\"IT770031\",\"prevTotal\":0,\"currTotal\":100}]}"))
                .andExpect(jsonPath("$.data.imported").value(2))
                .andReturn().getResponse().getContentAsString();
        int subId = JsonPath.read(r, "$.data.matches[1].meterId");
        mvc.perform(get("/api/alloc/recon").param("ym", "2099-04").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.lossRows[?(@.buildingId==" + b + ")].subQty").value(100.0));
        // ① 打 shadow(V75 回填/人工认对走同一判据;无写接口故直接落库)→ 退出分表Σ
        com.park.demo3.entity.Meter mk = meterMapper.selectById(subId);
        mk.setSuspect("shadow");
        meterMapper.updateById(mk);
        mvc.perform(get("/api/alloc/recon").param("ym", "2099-04").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.lossRows[?(@.buildingId==" + b + ")].subQty").value(0.0));
        // ② 不带 suspect 的普通 PUT:识别信息本就齐全,§F4 自动清标条件永远不成立 → 标留住(这正是「解不掉」)。
        //    PUT 恒带全量档案(抽屉 reqOf 口径):楼栋/归属漏带就等于把它们清空,该表会整个掉出损耗组
        mvc.perform(put("/api/meters/" + subId).header("Authorization", auth()).contentType("application/json")
                .content("{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT-G5分表\",\"area\":\"ITG5区\",\"spot\":\"三楼\","
                        + "\"code\":\"IT770031\",\"buildingId\":" + b + ",\"ownership\":\"share\",\"factor\":2}"))
                .andExpect(jsonPath("$.data.suspect").value("shadow"));
        // ③ 显式解除(抽屉「认领为独立表」发 suspect:"")→ 清标
        mvc.perform(put("/api/meters/" + subId).header("Authorization", auth()).contentType("application/json")
                .content("{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT-G5分表\",\"area\":\"ITG5区\",\"spot\":\"三楼\","
                        + "\"code\":\"IT770031\",\"buildingId\":" + b + ",\"ownership\":\"share\",\"suspect\":\"\"}"))
                .andExpect(jsonPath("$.data.suspect").value(org.hamcrest.Matchers.nullValue()));
        // ④ 立即重新计入分表Σ
        mvc.perform(get("/api/alloc/recon").param("ym", "2099-04").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.lossRows[?(@.buildingId==" + b + ")].subQty").value(100.0));
        // ⑤ 非法值仍被 @Pattern 挡住(只收 ''/shadow/incomplete)
        mvc.perform(put("/api/meters/" + subId).header("Authorization", auth()).contentType("application/json")
                .content("{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT-G5分表\",\"buildingId\":" + b
                        + ",\"ownership\":\"share\",\"suspect\":\"whatever\"}"))
                .andExpect(jsonPath("$.code").value(400));
    }

    // ── 【刀H §H5】按账期批量删除:预览数字=实删数字、manual 行不被删、
    //    撞 alloc_rule_meter FK 的表档案跳过并出现在返回里。
    //    槽位 2097-03/02:全库(含种子与其它用例)无任何数据落这两个月,数字才敢写死。 ──
    @Test
    void batchDelete_previewEqualsActual_keepsManual_skipsFkBoundMeter() throws Exception {
        String ym = "2097-03", prev = "2097-02";
        int a = createMeter("IT-H5-A", "1");   // 只有本月读数 → 删完零读数,连带删档案
        int b = createMeter("IT-H5-B", "1");   // 本月+上月 → 删完仍有读数,档案留下
        int c = createMeter("IT-H5-C", "1");   // 只有本月读数,但绑进池 → FK 挡住,跳过并点名
        addReading(a, ym); addReading(b, ym); addReading(b, prev); addReading(c, ym);
        // C 绑进一条池规则 → alloc_rule_meter 有行,表档案删不得
        mvc.perform(post("/api/alloc/rules").header("Authorization", auth()).contentType("application/json")
                .content("{\"zone\":\"p1\",\"method\":\"none\",\"feeKey\":\"share_elec_fire\","
                        + "\"feeName\":\"ITH5消防\",\"meterIds\":[" + c + "]}"))
                .andExpect(jsonPath("$.code").value(0));
        // 该月派生结果:1 条 gen(应被级联删)+ 1 条 manual(必须留下并在预览里点名)
        allocRow(ym, 970001, "share_elec_fire", "gen");
        allocRow(ym, 970002, "share_elec_light", "manual");

        // ① 预览:只算不删 —— 3 条读数 / 3 块表 / 其中 2 块删完零读数 / 派生快照 1 条(gen)
        String pv = utf8(mvc.perform(get("/api/meters/readings/delete-preview").param("ym", ym)
                .header("Authorization", auth()))
                .andExpect(jsonPath("$.data.readings").value(3))
                .andExpect(jsonPath("$.data.meters").value(3))
                .andExpect(jsonPath("$.data.metersEmptied").value(2))
                .andExpect(jsonPath("$.data.derived").value(1))
                .andExpect(jsonPath("$.data.manualKept.length()").value(1))
                .andExpect(jsonPath("$.data.meterDeleted.length()").value(1))
                .andExpect(jsonPath("$.data.meterBlocked.length()").value(1))
                .andReturn());
        // 预览不能动数据:读数原封不动
        mvc.perform(get("/api/meters/readings").param("ym", ym).header("Authorization", auth()))
                .andExpect(jsonPath("$.data.length()").value(3));

        // ② 实删:返回体与预览逐格相同(同一个 batchDelete,预览撒谎当场穿帮)
        String del = utf8(mvc.perform(delete("/api/meters/readings").param("ym", ym).header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0)).andReturn());
        org.junit.jupiter.api.Assertions.assertEquals(
                (Object) JsonPath.read(pv, "$.data"), (Object) JsonPath.read(del, "$.data"),
                "预览数字与实删不一致");
        // 点名清单确实指向 A(可删)与 C(被 FK 挡住)
        org.junit.jupiter.api.Assertions.assertTrue(
                JsonPath.<String>read(del, "$.data.meterDeleted[0]").contains("id " + a));
        org.junit.jupiter.api.Assertions.assertTrue(
                JsonPath.<String>read(del, "$.data.meterBlocked[0]").contains("id " + c));

        // ③ 本月读数清空,上月读数不受影响
        mvc.perform(get("/api/meters/readings").param("ym", ym).header("Authorization", auth()))
                .andExpect(jsonPath("$.data.length()").value(0));
        mvc.perform(get("/api/meters/readings").param("ym", prev).header("Authorization", auth()))
                .andExpect(jsonPath("$.data.length()").value(1));
        // ④ 档案:A 已删;B(仍有读数)与 C(撞 FK)都还在
        org.junit.jupiter.api.Assertions.assertNull(meterMapper.selectById(a));
        org.junit.jupiter.api.Assertions.assertNotNull(meterMapper.selectById(b));
        org.junit.jupiter.api.Assertions.assertNotNull(meterMapper.selectById(c));
        // ⑤ manual 行不被删,gen 行被删
        var left = allocResultMapper.selectByYm(ym);
        org.junit.jupiter.api.Assertions.assertEquals(1, left.size());
        org.junit.jupiter.api.Assertions.assertEquals("manual", left.get(0).getSource());
        // ⑥ 审计留痕:import_log 一条 meter_delete,ok=删除条数
        var log = importLogMapper.selectList(new com.baomidou.mybatisplus.core.conditions.query.QueryWrapper
                <com.park.demo3.entity.ImportLog>().eq("data_type", "meter_delete").eq("target", ym));
        org.junit.jupiter.api.Assertions.assertEquals(1, log.size());
        org.junit.jupiter.api.Assertions.assertEquals(3, log.get(0).getOk());
    }

    private void addReading(int meterId, String ym) throws Exception {
        mvc.perform(post("/api/meters/readings").header("Authorization", auth()).contentType("application/json")
                .content("{\"meterId\":" + meterId + ",\"ym\":\"" + ym + "\",\"prevTotal\":0,\"currTotal\":10}"))
                .andExpect(jsonPath("$.code").value(0));
    }

    // alloc_result 直接落库:manual 行的写接口(saveManual)会校验租户存在,这里只要一行占位数据
    private void allocRow(String ym, int tenantId, String feeKey, String source) {
        var r = new com.park.demo3.entity.AllocResult();
        r.setTenantId(tenantId); r.setYm(ym); r.setFeeKey(feeKey);
        r.setAmount(java.math.BigDecimal.ONE); r.setSource(source);
        allocResultMapper.insert(r);
    }

    private static String utf8(org.springframework.test.web.servlet.MvcResult r) {
        return new String(r.getResponse().getContentAsByteArray(), java.nio.charset.StandardCharsets.UTF_8);
    }

    // ── 鉴权门:无 token 401;viewer 读 200 写 403 ──
    @Test
    void auth_noToken401_viewerReadOnly() throws Exception {
        mvc.perform(get("/api/meters")).andExpect(status().isUnauthorized());
        String body = mvc.perform(post("/api/auth/login").contentType("application/json")
                .content("{\"username\":\"viewer\",\"password\":\"viewer123\"}"))
                .andReturn().getResponse().getContentAsString();
        String viewer = JsonPath.read(body, "$.data.token");
        mvc.perform(get("/api/meters").header("Authorization", "Bearer " + viewer))
                .andExpect(status().isOk());
        mvc.perform(post("/api/meters/import").header("Authorization", "Bearer " + viewer)
                .contentType("application/json").content("{\"rows\":[]}"))
                .andExpect(status().isForbidden());
        // §H5:批量删除是 DELETE → 同一道门自动 403(前端另把入口藏起来,不靠前端把关)
        mvc.perform(delete("/api/meters/readings").param("ym", "2097-03")
                .header("Authorization", "Bearer " + viewer))
                .andExpect(status().isForbidden());
    }

    // ── 期区候选接口:三期即使一栋楼都没标注,也必须选得出来(破鸡生蛋) ──
    @Test
    void zones_listIncludesP3AndDormLast() throws Exception {
        mvc.perform(get("/api/zones").header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data[?(@.code=='p3')].name").value("三期"))
                .andExpect(jsonPath("$.data[?(@.code=='p1')].name").value("一期"))
                .andExpect(jsonPath("$.data[-1:].code").value("dorm"));
    }

    // ── 三期:zone=p3 建档/过滤/导入全通(值域 p1|p2|dorm → p\d+|dorm) ──
    @Test
    void zone_p3_createListImport() throws Exception {
        String res = mvc.perform(post("/api/meters").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"kind\":\"elec\",\"zone\":\"p3\",\"name\":\"IT三期总电\",\"factor\":1}"))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.zone").value("p3"))
                .andReturn().getResponse().getContentAsString();
        int id = JsonPath.read(res, "$.data.id");
        // 列表 zone 过滤参数不再 400
        mvc.perform(get("/api/meters").param("kind", "elec").param("zone", "p3").header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data[?(@.name=='IT三期总电')].zone").value("p3"));
        // 导入:p3 行进(MeterService.validZone 也放宽了),形态非法行仍跳
        mvc.perform(post("/api/meters/import").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":["
                        + "{\"kind\":\"elec\",\"zone\":\"p3\",\"name\":\"IT三期总电\",\"ym\":\"2099-05\",\"prevTotal\":10,\"currTotal\":20},"
                        + "{\"kind\":\"elec\",\"zone\":\"px\",\"name\":\"IT坏分区\",\"ym\":\"2099-05\"}]}"))
                .andExpect(jsonPath("$.data.imported").value(1))
                .andExpect(jsonPath("$.data.skipped").value(1));
        org.junit.jupiter.api.Assertions.assertEquals("p3", meterMapper.selectById(id).getZone());
    }
}

package com.park.demo3.api;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.jayway.jsonpath.JsonPath;
import com.park.demo3.AbstractMysqlIT;
import com.park.demo3.entity.DataChangeLog;
import com.park.demo3.entity.MeterArchiveLog;
import com.park.demo3.entity.MeterAssign;
import com.park.demo3.entity.MeterBookSeen;
import com.park.demo3.service.MeterTimelineService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

import static org.assertj.core.api.Assertions.assertThat;
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
    @Autowired com.park.demo3.service.MeterTimelineService timeline;
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

    /** POST 任一新建接口,取回 data.id(同 AllocApiIT 的同名助手)。 */
    private int postId(String url, String body) throws Exception {
        String res = mvc.perform(post(url).header("Authorization", auth())
                .contentType("application/json").content(body))
                .andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(res, "$.data.id");
    }

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
        // 编辑倍率(资产列,PUT /{id})与企业名称(归属,按月 PUT /assign;建表没给月份 = 1900-01 那一段,更正它)
        mvc.perform(put("/api/meters/" + id).header("Authorization", auth())
                .contentType("application/json")
                .content("{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT一车间总电\",\"factor\":600}"))
                .andExpect(jsonPath("$.data.factor").value(600));
        assign("2099-01", "correct", "{\"tenantName\":\"锂朋\"}", id);
        org.junit.jupiter.api.Assertions.assertEquals("锂朋", meterAt("IT一车间总电", null).get("tenantName"));
        // 有读数删除 409;删读数后放行
        mvc.perform(post("/api/meters/readings").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"meterId\":" + id + ",\"ym\":\"2099-01\",\"prevTotal\":100,\"currTotal\":110}"))
                .andExpect(jsonPath("$.code").value(0));
        String del = utf8(mvc.perform(delete("/api/meters/" + id).header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(409)).andReturn());
        // V129 已删「退场账期」:提示指到抽屉里真有的入口
        assertThat((String) JsonPath.read(del, "$.message")).contains("「档案变更」的「在册状态」").doesNotContain("退场账期");
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

    // ── 刀H §H2(V79):ownership 第 6 值 register(非计费计度寄存器)—— 改归属(PUT /assign)与导入两条入口都收 ──
    // (不进Σ 由白名单 AllocService.inSubSigma 保证,那条口径在 AllocApiIT 侧)
    @Test
    void ownershipRegister_acceptedByPutAndImport() throws Exception {
        int id = createMeter("IT永龙反向有功", "100");
        assign("2099-06", "correct", "{\"ownership\":\"register\"}", id);
        org.junit.jupiter.api.Assertions.assertEquals("register", meterAt("IT永龙反向有功", null).get("ownership"));
        // 导入行同样收(前端 classifyOwnership 按名称关键词判出 register 后带过来)
        mvc.perform(post("/api/meters/import").header("Authorization", auth()).contentType("application/json")
                .content("{\"rows\":[{\"kind\":\"elec\",\"zone\":\"p2\",\"name\":\"IT某表最大需量\",\"ym\":\"2099-06\","
                        + "\"ownership\":\"register\",\"prevTotal\":0,\"currTotal\":155.27}]}"))
                .andExpect(jsonPath("$.data.imported").value(1))
                .andExpect(jsonPath("$.data.errors").isEmpty());
        mvc.perform(get("/api/meters").param("kind", "elec").param("zone", "p2").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.name=='IT某表最大需量')].ownership").value("register"));
    }

    /**
     * 编码命中却把表挑到另一栋楼 → 落 warn(照旧行为仍然写回,只是不再静默)。
     *
     * 2026-09-23 南盛物流案:一份二期文件里「广聚运通 二车间一楼102室」那行的编码栏填了
     * 220605000144 —— 一期A座四楼428室 南盛物流 的码。L1 编码命中后 applyDesc 把表 243
     * 从一期A座搬到了二期二车间,而 owner_manual=0 那一支当时不落任何提示 ——
     * 半年后才被人问「为什么一期的抄表里会出现二车间」。
     * 前置做足:先证 warn 只在**真换楼**时出,否则「报了」可能只是每行都报。
     */
    @Test
    void import_codeMatchMovesBuilding_warns() throws Exception {
        int bA = postId("/api/buildings", "{\"name\":\"IT-MV-甲座\",\"phase\":1,\"floorCount\":5,"
                + "\"totalArea\":10000,\"rentableArea\":9000}");
        int bB = postId("/api/buildings", "{\"name\":\"IT-MV-乙车间\",\"phase\":2,\"floorCount\":5,"
                + "\"totalArea\":10000,\"rentableArea\":9000}");
        // 建档:挂甲座
        mvc.perform(post("/api/meters/import").header("Authorization", auth()).contentType("application/json")
                .content("{\"rows\":[{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT-MV表\",\"ym\":\"2099-10\","
                        + "\"area\":\"IT-MV-甲座\",\"spot\":\"四楼428室\",\"subName\":\"电表①\",\"code\":\"IT-MV-0001\","
                        + "\"buildingId\":" + bA + ",\"factor\":1,\"prevTotal\":0,\"currTotal\":10}]}"))
                .andExpect(jsonPath("$.data.matches[0].matchBy").value("new"));
        // 前置:同一栋楼再导一次 → 编码命中,但**不报**换楼
        mvc.perform(post("/api/meters/import").header("Authorization", auth()).contentType("application/json")
                .content("{\"rows\":[{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT-MV表\",\"ym\":\"2099-11\","
                        + "\"area\":\"IT-MV-甲座\",\"spot\":\"四楼428室\",\"subName\":\"电表①\",\"code\":\"IT-MV-0001\","
                        + "\"buildingId\":" + bA + ",\"prevTotal\":10,\"currTotal\":20}]}"))
                .andExpect(jsonPath("$.data.matches[0].matchBy").value("code"))
                .andExpect(jsonPath("$.data.notices[?(@.reason =~ /.*换到了.*/)]").doesNotExist());
        // 真换楼:同一个编码,路人甲座 → 乙车间
        mvc.perform(post("/api/meters/import").header("Authorization", auth()).contentType("application/json")
                .content("{\"rows\":[{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT-MV表\",\"ym\":\"2099-12\","
                        + "\"area\":\"IT-MV-乙车间\",\"spot\":\"一楼102室\",\"subName\":\"电表①\",\"code\":\"IT-MV-0001\","
                        + "\"buildingId\":" + bB + ",\"prevTotal\":20,\"currTotal\":30}]}"))
                .andExpect(jsonPath("$.data.matches[0].matchBy").value("code"))
                .andExpect(jsonPath("$.data.imported").value(1))          // 仍然写回,不是拒导
                .andExpect(jsonPath("$.data.errors").isEmpty())           // 是提示不是错误(刀G 分开那两条)
                .andExpect(jsonPath("$.data.notices[0].reason").value(
                        org.hamcrest.Matchers.allOf(
                                org.hamcrest.Matchers.containsString("按编码"),
                                org.hamcrest.Matchers.containsString("IT-MV-甲座"),
                                org.hamcrest.Matchers.containsString("IT-MV-乙车间"))));
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
                        .value(org.hamcrest.Matchers.containsString("该编码有 2 块表")))
                .andExpect(jsonPath("$.data.errors[0].reason")   // 建表没给起始月 = 自 1900-01 起,说成「一直在册」
                        .value(org.hamcrest.Matchers.containsString("ITJ3甲(一直在册)")))
                .andExpect(jsonPath("$.data.errors[0].reason")
                        .value(org.hamcrest.Matchers.containsString("该编码在档案里重复,请先去重")));
        mvc.perform(get("/api/meters/readings").param("ym", "2099-06").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.length()").value(0));
    }

    // 编码重复的脏档案(不同栋、不同位置、同一个 code,两块都一直在册):用于锁「L1 编码歧义不许被企业名称救」。
    // 建表接口现在拒同码同月在册,只能先建无码表再直接落库补编码
    private void createDupCodeMeter(String name, String area, String spot, String tenantName) throws Exception {
        int id = postId("/api/meters", "{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"" + name + "\",\"area\":\"" + area
                        + "\",\"spot\":\"" + spot + "\",\"subName\":\"电表①\",\"tenantName\":\"" + tenantName + "\"}");
        com.park.demo3.entity.Meter m = meterMapper.selectById(id);
        m.setCode("ITJ3DUP");
        meterMapper.updateById(m);
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
        // ⑧ 补上区域(识别信息由空变非空)=认领该档案 → 清标,重新计入Σ(区域是归属列,走按月 PUT /assign)
        assign("2099-04", "correct", "{\"area\":\"ITA座\"}", shadowId);
        org.junit.jupiter.api.Assertions.assertNull(meterAt("IT影子新档案", null).get("suspect"));
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
        //    (位置是归属列,按月改:更正 2099-06 导入写下的那一段)
        assign("2099-06", "correct", "{\"floorLabel\":\"六楼\"}", id);
        org.junit.jupiter.api.Assertions.assertEquals("六楼", meterAt("IT位置表", null).get("floorLabel"));
        org.junit.jupiter.api.Assertions.assertEquals(1, meterAt("IT位置表", null).get("locManual"));
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
        // ③ 空串=显式清除(§E8「留空=跨层」):落 NULL,不被 spot 解析回五楼;清除也算人工设定
        assign("2099-07", "correct", "{\"spot\":\"五楼东侧\",\"floorLabel\":\"\",\"side\":\"\"}", id);
        var cleared = meterAt("IT位置表", null);
        org.junit.jupiter.api.Assertions.assertEquals("五楼东侧", cleared.get("spot"));
        org.junit.jupiter.api.Assertions.assertNull(cleared.get("floorLabel"));
        org.junit.jupiter.api.Assertions.assertNull(cleared.get("side"));
        // 楼层(1)+方位(2)两列都被显式清空,房号本就与解析一致(都是 null)→ 掩码=3,房号那位仍自动
        org.junit.jupiter.api.Assertions.assertEquals(3, cleared.get("locManual"));
        // ④ 原文没变的重导:跨层设定保得住,且**不重复报 warn**(人工值与解析不同本就是常态,每次都报=噪音)
        mvc.perform(post("/api/meters/import").header("Authorization", auth()).contentType("application/json")
                .content("{\"rows\":[{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT位置表\",\"ym\":\"2099-08\","
                        + "\"spot\":\"五楼东侧\",\"code\":\"IT740001\",\"prevTotal\":3,\"currTotal\":4}]}"))
                .andExpect(jsonPath("$.data.notices.length()").value(0));
        mvc.perform(get("/api/meters").param("kind", "elec").param("zone", "p1").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.code=='IT740001' && @.floorLabel=='五楼')]").doesNotExist());
        // ⑤「改回按册子」(clear-manual)→ 按 spot 解析,与原文重新一致 → 人工标志撤回 0(恢复自动跟随)
        clearManual(id, "2099-08");
        var back = meterAt("IT位置表", null);
        org.junit.jupiter.api.Assertions.assertEquals("五楼", back.get("floorLabel"));
        org.junit.jupiter.api.Assertions.assertEquals("东侧", back.get("side"));
        org.junit.jupiter.api.Assertions.assertEquals(0, back.get("locManual"));
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
        assign("2099-09", "correct", "{\"ownership\":\"share\",\"buildingId\":" + b1 + "}", id);
        var owned = meterAt("IT归属表", null);
        org.junit.jupiter.api.Assertions.assertEquals("share", owned.get("ownership"));
        org.junit.jupiter.api.Assertions.assertEquals(b1, owned.get("buildingId"));
        org.junit.jupiter.api.Assertions.assertEquals(1, owned.get("ownerManual"));
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
            // V129 起归属与人工标记在 meter_assign(按月分段,V128 灌数把表级值复制到每一段)
            java.util.List<com.park.demo3.entity.MeterAssign> segs = timeline.rows(m.getId()).assign();
            org.junit.jupiter.api.Assertions.assertFalse(segs.isEmpty(), n + " 应有归属行(V128 灌数)");
            for (com.park.demo3.entity.MeterAssign a : segs) {
                org.junit.jupiter.api.Assertions.assertEquals(aId, a.getBuildingId(), n + "@" + a.getFromYm() + " 应挂一期A座");
                org.junit.jupiter.api.Assertions.assertEquals("share", a.getOwnership(), n + "@" + a.getFromYm() + " 应为 share");
                org.junit.jupiter.api.Assertions.assertEquals(Integer.valueOf(1), a.getOwnerManual(), n + "@" + a.getFromYm() + " 应标人工归属");
            }
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
        //    (建表没给月份 = 1900-01 那一段,更正它)
        assign("2099-05", "correct", "{\"roomNo\":\"302室\"}", id);
        org.junit.jupiter.api.Assertions.assertEquals("302室", meterAt("IT分列位置表", null).get("roomNo"));
        org.junit.jupiter.api.Assertions.assertEquals(4, meterAt("IT分列位置表", null).get("locManual"));
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
        // ② 不带 suspect 的普通 PUT(资产列:改倍率):识别信息本就齐全,§F4 自动清标条件永远不成立 → 标留住(这正是「解不掉」)
        mvc.perform(put("/api/meters/" + subId).header("Authorization", auth()).contentType("application/json")
                .content("{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT-G5分表\",\"code\":\"IT770031\",\"factor\":2}"))
                .andExpect(jsonPath("$.data.suspect").value("shadow"));
        // ③ 显式解除(抽屉「认领为独立表」发 suspect:"")→ 清标
        mvc.perform(put("/api/meters/" + subId).header("Authorization", auth()).contentType("application/json")
                .content("{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT-G5分表\",\"code\":\"IT770031\",\"suspect\":\"\"}"))
                .andExpect(jsonPath("$.data.suspect").value(org.hamcrest.Matchers.nullValue()));
        // ④ 立即重新计入分表Σ
        mvc.perform(get("/api/alloc/recon").param("ym", "2099-04").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.lossRows[?(@.buildingId==" + b + ")].subQty").value(100.0));
        // ⑤ 非法值仍被 @Pattern 挡住(只收 ''/shadow/incomplete)
        mvc.perform(put("/api/meters/" + subId).header("Authorization", auth()).contentType("application/json")
                .content("{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT-G5分表\",\"suspect\":\"whatever\"}"))
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

    // ══ METER-TIMELINE-SPEC(A2 换读侧):归属/状态按月分段,GET /api/meters?ym= 站在该月看 ══

    private void importOne(String name, String ym, String tenantName) throws Exception {
        mvc.perform(post("/api/meters/import").header("Authorization", auth()).contentType("application/json")
                .content("{\"rows\":[{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"" + name + "\",\"ym\":\"" + ym
                        + "\",\"area\":\"ITA区\",\"tenantName\":\"" + tenantName + "\",\"prevTotal\":0,\"currTotal\":1}]}"))
                .andExpect(jsonPath("$.data.imported").value(1));
    }

    /** 站在 ym(null = 最新一行)看名为 name 的那块表的 MeterDTO。 */
    private java.util.Map<String, Object> meterAt(String name, String ym) throws Exception {
        var req = get("/api/meters").param("kind", "elec").param("zone", "p1").header("Authorization", auth());
        if (ym != null) req = req.param("ym", ym);
        java.util.List<java.util.Map<String, Object>> hit =
                JsonPath.read(utf8(mvc.perform(req).andReturn()), "$.data[?(@.name=='" + name + "')]");
        org.junit.jupiter.api.Assertions.assertEquals(1, hit.size(), name + " 应恰有一块");
        return hit.get(0);
    }

    // §3.2 导入每个月写自己那一行(R1/R3/R4)+ §2 站在 ym 看 + PLAN §1 投影(段起止含当月、本月有变化)
    @Test
    void timeline_importWritesOwnMonth_listStandsAtYm() throws Exception {
        String n = "ITA2时间线表";
        importOne(n, "2095-03", "IT甲");   // 新表:自 2095-03 起在册
        importOne(n, "2095-06", "IT乙");   // 6 月换户:只写 6 月那一行
        importOne(n, "2095-01", "IT零");   // 早月后导:只写 1 月那一行,3 月起不受影响;状态自愈到 1 月

        var latest = meterAt(n, null);
        org.junit.jupiter.api.Assertions.assertEquals("IT乙", latest.get("tenantName"), "早月后导不许改后面的月(R4)");

        var feb = meterAt(n, "2095-02");
        org.junit.jupiter.api.Assertions.assertEquals("IT零", feb.get("tenantName"));
        org.junit.jupiter.api.Assertions.assertEquals("active", feb.get("status"));
        org.junit.jupiter.api.Assertions.assertEquals("2095-01", feb.get("statusFrom"), "更早月份的册子含这块表 = 状态自愈到那个月");
        org.junit.jupiter.api.Assertions.assertEquals("2095-01", feb.get("assignFrom"));
        org.junit.jupiter.api.Assertions.assertEquals("2095-02", feb.get("assignUntil"), "until = 本段最后一个月(含)");

        var apr = meterAt(n, "2095-04");
        org.junit.jupiter.api.Assertions.assertEquals("IT甲", apr.get("tenantName"), "6 月的册子不许改到 4 月(R3)");
        org.junit.jupiter.api.Assertions.assertEquals("2095-03", apr.get("assignFrom"));
        org.junit.jupiter.api.Assertions.assertEquals("2095-05", apr.get("assignUntil"));
        org.junit.jupiter.api.Assertions.assertEquals(false, apr.get("changedThisMonth"), "4 月没有自己的行");
        org.junit.jupiter.api.Assertions.assertEquals(true, meterAt(n, "2095-03").get("changedThisMonth"), "3 月的行与 1 月的不同");

        var jun = meterAt(n, "2095-06");
        org.junit.jupiter.api.Assertions.assertEquals("IT乙", jun.get("tenantName"));
        org.junit.jupiter.api.Assertions.assertEquals(true, jun.get("changedThisMonth"));
        org.junit.jupiter.api.Assertions.assertNull(jun.get("assignUntil"), "链尾 = 一直到以后");

        org.junit.jupiter.api.Assertions.assertNull(meterAt(n, "2094-12").get("status"), "早于第一条状态 = 不在册");
    }

    // PUT /{id} 只收资产列:抽屉整条回传的归属字段一行归属都不碰;归属按月改(PUT /assign),状态按行改(/{id}/status)。
    // (取代 A2 的过渡写法「PUT 不带月份 = 改到的字段对全部归属行做同一更正 + 三个旧账期三态」)
    @Test
    void timeline_putAssetOnly_assignByMonth_statusRows() throws Exception {
        String n = "ITA2更正表";
        importOne(n, "2096-01", "IT甲");
        importOne(n, "2096-05", "IT乙");
        int id = ((Number) meterAt(n, null).get("id")).intValue();
        long logs = archiveMapper.selectCount(new QueryWrapper<MeterArchiveLog>().eq("meter_id", id));
        mvc.perform(put("/api/meters/" + id).header("Authorization", auth()).contentType("application/json")
                .content("{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"" + n + "\",\"area\":\"ITA区\","
                        + "\"tenantName\":\"IT丙\",\"subName\":\"IT一号\",\"factor\":2}"))
                .andExpect(jsonPath("$.data.factor").value(2));
        assertThat(archiveMapper.selectCount(new QueryWrapper<MeterArchiveLog>().eq("meter_id", id)))
                .as("PUT /{id} 带着归属字段也不写任何归属行").isEqualTo(logs);
        org.junit.jupiter.api.Assertions.assertEquals("IT甲", meterAt(n, "2096-02").get("tenantName"));
        org.junit.jupiter.api.Assertions.assertEquals("IT乙", meterAt(n, "2096-06").get("tenantName"));

        assign("2096-02", "correct", "{\"subName\":\"IT一号\"}", id);
        org.junit.jupiter.api.Assertions.assertEquals("IT一号", meterAt(n, "2096-02").get("subName"), "更正 2 月所在的那一段(1 月起)");
        org.junit.jupiter.api.Assertions.assertNull(meterAt(n, "2096-06").get("subName"), "5 月那一段原样(R4)");

        statusReq(id, "2096-03", "retired", null).andExpect(jsonPath("$.code").value(0));
        org.junit.jupiter.api.Assertions.assertEquals("active", meterAt(n, "2096-02").get("status"));
        var apr = meterAt(n, "2096-04");
        org.junit.jupiter.api.Assertions.assertEquals("retired", apr.get("status"));
        org.junit.jupiter.api.Assertions.assertEquals("2096-03", apr.get("statusFrom"));
        org.junit.jupiter.api.Assertions.assertNull(meterAt(n, "2095-12").get("status"), "写停用不动启用月");

        statusReq(id, "2096-08", "removed", null).andExpect(jsonPath("$.code").value(0));
        org.junit.jupiter.api.Assertions.assertEquals("retired", meterAt(n, "2096-04").get("status"), "写拆除不动停用");
        org.junit.jupiter.api.Assertions.assertEquals("removed", meterAt(n, "2096-08").get("status"));

        mvc.perform(delete("/api/meters/" + id + "/status/2096-03").header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0));
        org.junit.jupiter.api.Assertions.assertEquals("active", meterAt(n, "2096-04").get("status"), "删停用那一行 = 撤销停用");
        org.junit.jupiter.api.Assertions.assertEquals("removed", meterAt(n, "2096-08").get("status"), "拆除保留");
    }

    // ══ METER-TIMELINE-SPEC §3.2 导入护栏 G1–G11 · changes / batchId · §3.5 撤销导入与批删连带档案行(B1)。独占 2093 年 ══

    @Autowired com.park.demo3.mapper.MeterArchiveLogMapper archiveMapper;
    @Autowired com.park.demo3.mapper.DataChangeLogMapper changeLogMapper;
    @Autowired com.park.demo3.mapper.TenantMapper tenantMapper;
    @Autowired com.park.demo3.mapper.BillNoticeMapper noticeMapper;
    @Autowired com.park.demo3.mapper.BillNoticeLineMapper noticeLineMapper;

    /** 一行导入 JSON(elec / p1),extra 以逗号开头补字段。 */
    private static String irow(String name, String ym, String extra) {
        return "{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"" + name + "\",\"ym\":\"" + ym + "\"" + extra + "}";
    }

    /** 导入若干行(fileName 可空),回 UTF-8 解码的整个响应体。 */
    private String imp(String fileName, String... rows) throws Exception {
        String body = "{\"rows\":[" + String.join(",", rows) + "]"
                + (fileName == null ? "" : ",\"fileName\":\"" + fileName + "\"") + "}";
        return utf8(mvc.perform(post("/api/meters/import").header("Authorization", auth())
                .contentType("application/json").content(body))
                .andExpect(jsonPath("$.code").value(0)).andReturn());
    }

    private static java.util.List<String> reasons(String res, String list) {
        return JsonPath.read(res, "$.data." + list + "[*].reason");
    }

    private static int idOf(String res) { return JsonPath.read(res, "$.data.matches[0].meterId"); }

    private static String batchOf(String res) { return JsonPath.read(res, "$.data.batchId"); }

    private MeterAssign assignRow(int id, String ym) {
        return timeline.rows(id).assign().stream().filter(a -> ym.equals(a.getFromYm())).findFirst().orElse(null);
    }

    private java.util.List<String> statusChain(int id) {
        return timeline.rows(id).status().stream().map(s -> s.getFromYm() + ":" + s.getStatus()).toList();
    }

    /** 明细含这块表、已导出的催缴单 = 这块表该月冻结(SPEC §4 来源 2)。 */
    private void exportedNotice(int meterId, String ym) {
        var t = new com.park.demo3.entity.Tenant();
        t.setCompanyName("IT冻结户" + System.nanoTime()); t.setBusinessType("factory");
        tenantMapper.insert(t);
        var n = new com.park.demo3.entity.BillNotice();
        n.setYm(ym); n.setTenantId(t.getId()); n.setNoticeKind("combined"); n.setStatus("exported");
        n.setTotalAmount(java.math.BigDecimal.ZERO); n.setGeneratedAt(java.time.LocalDateTime.now());
        noticeMapper.insert(n);
        var l = new com.park.demo3.entity.BillNoticeLine();
        l.setNoticeId(n.getId()); l.setLineNo(1); l.setFeeKey("elec"); l.setMeterId(meterId);
        l.setAmount(java.math.BigDecimal.ZERO);
        noticeLineMapper.insert(l);
    }

    // G1:企业名称空 → 沿用底子上的企业名称,出提示
    @Test
    void importG1_blankTenantKeepsBase_warns() throws Exception {
        int id = idOf(imp(null, irow("ITG1表", "2093-01", ",\"tenantName\":\"IT甲\",\"currTotal\":1")));
        String res = imp(null, irow("ITG1表", "2093-02", ",\"currTotal\":2"));
        assertThat(reasons(res, "notices")).singleElement().asString().contains("企业名称为空").contains("IT甲");
        assertThat(assignRow(id, "2093-02").getTenantName()).isEqualTo("IT甲");
    }

    // G2:这一段的租户是人工设定的 → 册子不同也不改,人工标记带进 M 行,出提示;册子相同不吵人
    @Test
    void importG2_manualTenantKept_flagCarriedIntoMonthRow_warns() throws Exception {
        int id = idOf(imp(null, irow("ITG2表", "2093-01", ",\"tenantName\":\"IT甲\",\"currTotal\":1")));
        MeterAssign jan = assignRow(id, "2093-01");
        jan.setTenantManual(1);
        timeline.writeAssign(jan, MeterTimelineService.Ctx.of("manual"));
        String res = imp(null, irow("ITG2表", "2093-03", ",\"tenantName\":\"IT乙\",\"currTotal\":2"));
        assertThat(reasons(res, "notices")).singleElement().asString().contains("人工设定").contains("IT乙");
        MeterAssign mar = assignRow(id, "2093-03");
        assertThat(mar.getTenantName()).isEqualTo("IT甲");
        assertThat(mar.getTenantManual()).isEqualTo(1);
        assertThat(reasons(imp(null, irow("ITG2表", "2093-04", ",\"tenantName\":\"IT甲\",\"currTotal\":3")), "notices")).isEmpty();
    }

    // G3:换了企业名称却认不出是谁 → 这一段租户 id 置空(进待核),不沿用老户;同名没给 id = 同一户照挂
    @Test
    void importG3_renamedButUnrecognized_dropsTenantIdForThatSegmentOnly() throws Exception {
        int id = idOf(imp(null, irow("ITG3表", "2093-01", ",\"tenantName\":\"IT甲\",\"tenantId\":12345,\"currTotal\":1")));
        imp(null, irow("ITG3表", "2093-02", ",\"tenantName\":\"IT甲\",\"currTotal\":2"));
        assertThat(assignRow(id, "2093-02").getTenantId()).isEqualTo(12345);
        String res = imp(null, irow("ITG3表", "2093-03", ",\"tenantName\":\"IT乙\",\"currTotal\":3"));
        assertThat(assignRow(id, "2093-03").getTenantName()).isEqualTo("IT乙");
        assertThat(assignRow(id, "2093-03").getTenantId()).isNull();
        assertThat(assignRow(id, "2093-01").getTenantId()).isEqualTo(12345);
        assertThat(reasons(res, "notices")).singleElement().asString().contains("没认出").contains("IT乙");
    }

    // G4:企业名称写「停用」→ 停用@M,名字不写;编码写「已拆」→ 有读数次月起已拆(当月照收)、无读数当月起已拆,编码不写回
    @Test
    void importG4_retiredWordAndRemovedCode_becomeStatusNotNameOrCode() throws Exception {
        int a = idOf(imp(null, irow("ITG4甲", "2093-01", ",\"tenantName\":\"IT甲\",\"currTotal\":1")));
        String res = imp(null, irow("ITG4甲", "2093-03", ",\"tenantName\":\"空调外机/已停用\",\"currTotal\":5"));
        assertThat(statusChain(a)).containsExactly("2093-01:active", "2093-03:retired");
        assertThat(assignRow(a, "2093-03").getTenantName()).isEqualTo("IT甲");
        assertThat(reasons(res, "notices")).singleElement().asString().contains("停用").contains("2093-03");
        java.util.List<java.util.Map<String, Object>> ch = JsonPath.read(res, "$.data.changes");
        assertThat(ch).hasSize(1);
        assertThat(ch.get(0)).containsEntry("field", "status").containsEntry("before", "active")
                .containsEntry("after", "retired").containsEntry("from", "2093-03");

        int b = idOf(imp(null, irow("ITG4乙", "2093-01", ",\"code\":\"ITG4-B\",\"currTotal\":1")));
        String rb = imp(null, irow("ITG4乙", "2093-02", ",\"code\":\"已拆除\",\"currTotal\":2"));
        assertThat(idOf(rb)).isEqualTo(b);
        assertThat(statusChain(b)).containsExactly("2093-01:active", "2093-03:removed");
        assertThat(meterMapper.selectById(b).getCode()).isEqualTo("ITG4-B");
        assertThat(reasons(rb, "notices")).singleElement().asString().contains("已拆").contains("2093-03");

        int c = idOf(imp(null, irow("ITG4丙", "2093-01", ",\"currTotal\":1")));
        imp(null, irow("ITG4丙", "2093-02", ",\"code\":\"已拆\",\"prevTotal\":1"));
        assertThat(statusChain(c)).containsExactly("2093-01:active", "2093-02:removed");
    }

    // G5:编码认到的表在别的期区 = 编码填错 → 行级错误,整行不写(档案、读数、新建都没有)
    @Test
    void importG5_codeHitsMeterInOtherZone_rowErrorNothingWritten() throws Exception {
        int id = idOf(imp(null, irow("ITG5表", "2093-01", ",\"code\":\"ITG5-1\",\"currTotal\":1")));
        String res = imp(null, "{\"kind\":\"elec\",\"zone\":\"p2\",\"name\":\"ITG5乙\",\"ym\":\"2093-02\","
                + "\"code\":\"ITG5-1\",\"tenantName\":\"IT乙\",\"currTotal\":9}");
        assertThat((Integer) JsonPath.read(res, "$.data.imported")).isZero();
        assertThat(reasons(res, "errors")).singleElement().asString().contains("ITG5-1").contains("填错");
        assertThat(timeline.rows(id).assign()).extracting(MeterAssign::getFromYm).containsExactly("2093-01");
        mvc.perform(get("/api/meters/readings").param("ym", "2093-02").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.length()").value(0));
        assertThat(meterMapper.selectByKey("elec", "p2", "ITG5乙")).isNull();
    }

    // G6:同一批里同一块表同一月第二次出现且读数不同 → 后一行行级错误,不覆盖;读数相同的重复行照过
    @Test
    void importG6_sameMeterSameMonthTwice_differentReadingRejected() throws Exception {
        String res = imp(null,
                irow("ITG6表", "2093-01", ",\"prevTotal\":0,\"currTotal\":10"),
                irow("ITG6表", "2093-01", ",\"prevTotal\":0,\"currTotal\":20"),
                irow("ITG6表", "2093-01", ",\"prevTotal\":0,\"currTotal\":10"));
        assertThat((Integer) JsonPath.read(res, "$.data.imported")).isEqualTo(2);
        assertThat((Integer) JsonPath.read(res, "$.data.errors[0].rowIndex")).isEqualTo(1);
        assertThat(reasons(res, "errors")).singleElement().asString().contains("第 1 行");
        mvc.perform(get("/api/meters/readings").param("ym", "2093-01").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].currTotal").value(10.0));
    }

    // G7:倍率只在导入月不早于该表最新读数月时写回档案;旧册的倍率只进本行 factor_snap
    @Test
    void importG7_factorWrittenBackOnlyWhenNotOlderThanLatestReading() throws Exception {
        int id = idOf(imp(null, irow("ITG7表", "2093-05", ",\"factor\":1,\"currTotal\":1")));
        imp(null, irow("ITG7表", "2093-03", ",\"factor\":80,\"currTotal\":1"));
        assertThat(meterMapper.selectById(id).getFactor()).isEqualByComparingTo("1");
        mvc.perform(get("/api/meters/" + id + "/readings").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.ym=='2093-03')].factorSnap").value(80.0));
        imp(null, irow("ITG7表", "2093-06", ",\"factor\":50,\"currTotal\":2"));
        assertThat(meterMapper.selectById(id).getFactor()).isEqualByComparingTo("50");
    }

    // G8:M 月已拆的表按标识认不到(新建);按编码认到且有读数 → 读数照写,提示这个月不计费
    @Test
    void importG8_removedMeterNotClaimedByName_codeHitWarnsUnbilled() throws Exception {
        int id = idOf(imp(null, irow("ITG8表", "2093-01", ",\"code\":\"ITG8-1\",\"currTotal\":1")));
        timeline.writeStatus(id, "2093-03", "removed", MeterTimelineService.Ctx.of("manual"));
        String byName = imp(null, irow("ITG8表", "2093-04", ",\"currTotal\":2"));
        assertThat((String) JsonPath.read(byName, "$.data.matches[0].matchBy")).isEqualTo("new");
        assertThat(idOf(byName)).isNotEqualTo(id);
        String byCode = imp(null, irow("ITG8表", "2093-05", ",\"code\":\"ITG8-1\",\"currTotal\":3"));
        assertThat((String) JsonPath.read(byCode, "$.data.matches[0].matchBy")).isEqualTo("code");
        assertThat(idOf(byCode)).isEqualTo(id);
        assertThat(reasons(byCode, "notices")).singleElement().asString()
                .contains("2093-03").contains("已拆").contains("不计费");
    }

    // G9:按位置新建的表与在册旧表同址 → 提示可能是换表;同一个月的册子里旧表也在 = 两块都在用,不提示
    @Test
    void importG9_newMeterSameAddrAsInRegisterMeter_swapHint() throws Exception {
        String loc = ",\"area\":\"ITG9区\",\"spot\":\"二楼\"";
        imp(null, irow("ITG9旧", "2093-01", loc + ",\"code\":\"ITG9-1\",\"currTotal\":1"));
        String res = imp(null, irow("ITG9新", "2093-02", loc + ",\"code\":\"ITG9-2\",\"currTotal\":1"));
        assertThat((String) JsonPath.read(res, "$.data.matches[0].matchBy")).isEqualTo("new");
        assertThat(reasons(res, "notices")).singleElement().asString().contains("可能是换表").contains("ITG9旧");
        // 新表那行排在前面也不误报:判定在批末,看的是整本册子
        String both = imp(null,
                irow("ITG9三", "2093-03", loc + ",\"code\":\"ITG9-3\",\"currTotal\":1"),
                irow("ITG9旧", "2093-03", loc + ",\"code\":\"ITG9-1\",\"currTotal\":2"),
                irow("ITG9新", "2093-03", loc + ",\"code\":\"ITG9-2\",\"currTotal\":2"));
        assertThat(reasons(both, "notices")).isEmpty();
    }

    // G10:导入月早于该表第一条状态 → 本行有读数才补 active@M(自愈);空读数不补,但归属照写 M 行
    @Test
    void importG10_earlierMonthSelfHealsOnlyWithReading() throws Exception {
        int id = idOf(imp(null, irow("ITG10表", "2093-05", ",\"currTotal\":1")));
        imp(null, irow("ITG10表", "2093-03", ",\"prevTotal\":1"));
        assertThat(statusChain(id)).containsExactly("2093-05:active");
        assertThat(assignRow(id, "2093-03")).isNotNull();
        imp(null, irow("ITG10表", "2093-02", ",\"currTotal\":1"));
        assertThat(statusChain(id)).containsExactly("2093-02:active", "2093-05:active");
    }

    // G11:单表冻结(含这块表的催缴单已导出)→ 读数照写、档案一格不改 + 提示;同批别的表照常
    @Test
    void importG11_frozenMeter_readingWrittenArchiveUntouched() throws Exception {
        int id = idOf(imp(null, irow("ITG11表", "2093-01", ",\"tenantName\":\"IT甲\",\"currTotal\":1")));
        int other = idOf(imp(null, irow("ITG11对照", "2093-01", ",\"tenantName\":\"IT甲\",\"currTotal\":1")));
        exportedNotice(id, "2093-02");
        String res = imp(null,
                irow("ITG11表", "2093-02", ",\"tenantName\":\"IT乙\",\"currTotal\":5"),
                irow("ITG11对照", "2093-02", ",\"tenantName\":\"IT乙\",\"currTotal\":5"));
        assertThat((Integer) JsonPath.read(res, "$.data.imported")).isEqualTo(2);
        assertThat(timeline.rows(id).assign()).extracting(MeterAssign::getFromYm).containsExactly("2093-01");
        assertThat(assignRow(other, "2093-02").getTenantName()).isEqualTo("IT乙");
        assertThat(reasons(res, "notices")).singleElement().asString()
                .contains("冻结").contains("2093-02").contains("已导出").contains("企业名称");
        mvc.perform(get("/api/meters/" + id + "/readings").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.ym=='2093-02')].currTotal").value(5.0));
        java.util.List<Integer> changed = JsonPath.read(res, "$.data.changes[*].meterId");
        assertThat(changed).containsExactly(other);
    }

    // changes 一表一字段一条(影响 from ~ until);batchId + fileName 落变更记录;同一份册子重导一格不写
    @Test
    void import_changesBatchIdFileName_identicalReimportWritesNothing() throws Exception {
        int id = idOf(imp(null, irow("ITCH表", "2093-01", ",\"tenantName\":\"IT甲\",\"currTotal\":1")));
        String res = imp("2093年4月抄表.xlsx", irow("ITCH表", "2093-04", ",\"tenantName\":\"IT乙\",\"currTotal\":2"));
        String batch = batchOf(res);
        assertThat(batch).hasSize(36);
        java.util.List<java.util.Map<String, Object>> ch = JsonPath.read(res, "$.data.changes");
        assertThat(ch).hasSize(1);
        assertThat(ch.get(0)).containsEntry("meterId", id).containsEntry("field", "tenant")
                .containsEntry("before", "IT甲").containsEntry("after", "IT乙").containsEntry("from", "2093-04");
        assertThat(ch.get(0).get("until")).isNull();
        java.util.List<MeterArchiveLog> logs = archiveMapper.selectList(new QueryWrapper<MeterArchiveLog>().eq("batch_id", batch));
        assertThat(logs).isNotEmpty().allSatisfy(l -> {
            assertThat(l.getFileName()).isEqualTo("2093年4月抄表.xlsx");
            assertThat(l.getMeterId()).isEqualTo(id);
        });
        String mid = imp(null, irow("ITCH表", "2093-02", ",\"tenantName\":\"IT丙\",\"currTotal\":1"));
        assertThat((String) JsonPath.read(mid, "$.data.changes[0].until")).isEqualTo("2093-03");
        String again = imp(null, irow("ITCH表", "2093-04", ",\"tenantName\":\"IT乙\",\"currTotal\":2"));
        assertThat((java.util.List<?>) JsonPath.read(again, "$.data.changes")).isEmpty();
        assertThat(archiveMapper.selectCount(new QueryWrapper<MeterArchiveLog>().eq("batch_id", batchOf(again)))).isZero();
    }

    private org.springframework.test.web.servlet.ResultActions revert(String batch) throws Exception {
        return mvc.perform(post("/api/meters/import-batches/" + batch + "/revert").header("Authorization", auth()));
    }

    // §3.5 撤销导入:逆序还原前像(更新的改回、插入的删掉),读数不动;撤过的再撤、波及冻结月都整批拒并点名
    @Test
    void revertImport_restoresBeforeImages_readingsStay_refusesTwiceAndWhenFrozen() throws Exception {
        imp(null, irow("ITRV表", "2093-01", ",\"tenantName\":\"IT甲\",\"currTotal\":1"));
        int id = meterMapper.selectByKey("elec", "p1", "ITRV表").getId();
        String b2 = batchOf(imp(null, irow("ITRV表", "2093-03", ",\"tenantName\":\"IT乙\",\"currTotal\":2")));
        String b3 = batchOf(imp(null, irow("ITRV表", "2093-01", ",\"tenantName\":\"IT丁\",\"currTotal\":1")));
        revert(b3).andExpect(jsonPath("$.data").value(1));
        MeterAssign jan = assignRow(id, "2093-01");
        assertThat(jan.getTenantName()).isEqualTo("IT甲");
        assertThat(jan.getSrc()).isEqualTo("import");
        revert(b2).andExpect(jsonPath("$.data").value(1));
        assertThat(assignRow(id, "2093-03")).isNull();
        assertThat(meterAt("ITRV表", "2093-03").get("tenantName")).isEqualTo("IT甲");
        mvc.perform(get("/api/meters/readings").param("ym", "2093-03").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.length()").value(1));
        String twice = utf8(revert(b2).andExpect(jsonPath("$.code").value(409)).andReturn());
        assertThat((String) JsonPath.read(twice, "$.message")).contains("又改过");
        String b4 = batchOf(imp(null, irow("ITRV表", "2093-05", ",\"tenantName\":\"IT戊\",\"currTotal\":3")));
        exportedNotice(id, "2093-05");
        String frozen = utf8(revert(b4).andExpect(jsonPath("$.code").value(409)).andReturn());
        assertThat((String) JsonPath.read(frozen, "$.message")).contains("2093-05").contains("已导出");
        assertThat(assignRow(id, "2093-05").getTenantName()).isEqualTo("IT戊");
        revert(java.util.UUID.randomUUID().toString()).andExpect(jsonPath("$.code").value(404));
    }

    // §3.5 批量删除本期:连带删本期导入写下的归属行 / 状态行(含 G10 自愈),预览多报两个数且与实删一致
    @Test
    void batchDelete_takesThatMonthsImportRowsAlong_previewCountsThem() throws Exception {
        int a = idOf(imp(null, irow("ITBD甲", "2093-07", ",\"tenantName\":\"IT甲\",\"currTotal\":1")));
        imp(null, irow("ITBD甲", "2093-08", ",\"tenantName\":\"IT乙\",\"currTotal\":2"));
        int b = idOf(imp(null, irow("ITBD乙", "2093-09", ",\"currTotal\":1")));
        imp(null, irow("ITBD乙", "2093-08", ",\"currTotal\":1"));
        assertThat(statusChain(b)).containsExactly("2093-08:active", "2093-09:active");
        String pv = utf8(mvc.perform(get("/api/meters/readings/delete-preview").param("ym", "2093-08")
                        .param("dropEmptyMeters", "false").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.assignRows").value(2))
                .andExpect(jsonPath("$.data.statusRows").value(1)).andReturn());
        String del = utf8(mvc.perform(delete("/api/meters/readings").param("ym", "2093-08")
                        .param("dropEmptyMeters", "false").header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0)).andReturn());
        assertThat((Object) JsonPath.read(del, "$.data")).isEqualTo(JsonPath.read(pv, "$.data"));
        assertThat(assignRow(a, "2093-08")).isNull();
        assertThat(meterAt("ITBD甲", "2093-08").get("tenantName")).isEqualTo("IT甲");
        assertThat(assignRow(b, "2093-08")).isNull();
        assertThat(statusChain(b)).containsExactly("2093-09:active");
    }

    // SPEC §1.5:手工录读数与导入读数都对该月记 data_change_log(source = meter-reading)
    @Test
    void readingWrites_recordDataChangeLog() throws Exception {
        DataChangeLog last = changeLogMapper.selectOne(new QueryWrapper<DataChangeLog>().orderByDesc("id").last("limit 1"));
        long mark = last == null ? 0 : last.getId();
        addReading(createMeter("ITDCL表", "1"), "2093-10");
        imp(null, irow("ITDCL导入", "2093-11", ",\"currTotal\":1"));
        assertThat(changeLogMapper.selectList(new QueryWrapper<DataChangeLog>().gt("id", mark).eq("source", "meter-reading")))
                .extracting(DataChangeLog::getYm).contains("2093-10", "2093-11");
    }

    // ══ METER-TIMELINE-SPEC §10 本月册子已核(meter_book_seen)。独占 2082 年 ══

    @Autowired com.park.demo3.mapper.MeterBookSeenMapper bookSeenMapper;

    /** 这块表的「册子里有」记录,id 升序,形如 月|批次号|文件名。 */
    private java.util.List<String> bookOf(int id) {
        return bookSeenMapper.selectList(new QueryWrapper<MeterBookSeen>().eq("meter_id", id).orderByAsc("id")).stream()
                .map(b -> b.getYm() + "|" + b.getBatchId() + "|" + b.getFileName()).toList();
    }

    // §10.2 导入时新建的表也记一笔(带批次号与文件名);同一份册子重导:档案一格不写,但照记一笔(第二个批次)。
    //   只有这一条用导入新建的表;下面几条的表都先经 POST /api/meters 建好,新建那条路坏了不连累它们
    @Test
    void bookSeen_newMeterAndIdenticalReimport_recordedWhileArchiveUntouched() throws Exception {
        String row = irow("ITBS表", "2082-01", ",\"tenantName\":\"IT甲\",\"currTotal\":1");
        String first = imp("ITBS一月.xlsx", row);
        int id = idOf(first);
        String b1 = batchOf(first);
        assertThat(bookOf(id)).as("新建的表也记").containsExactly("2082-01|" + b1 + "|ITBS一月.xlsx");
        String b2 = batchOf(imp("ITBS一月重导.xlsx", row));
        assertThat(archiveMapper.selectCount(new QueryWrapper<MeterArchiveLog>().eq("batch_id", b2)))
                .as("同值重导不改档案").isZero();
        assertThat(bookOf(id)).as("同值重导照记一笔")
                .containsExactly("2082-01|" + b1 + "|ITBS一月.xlsx", "2082-01|" + b2 + "|ITBS一月重导.xlsx");
    }

    // §10.2 G5(编码认到别的期区的表)是行级错误:不记;G11 冻结、档案没改的行照记(册子里确实有这块表)
    @Test
    void bookSeen_g5RowNotRecorded_g11FrozenRowRecorded() throws Exception {
        int g5 = postId("/api/meters", "{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"ITBS五\",\"code\":\"ITBS-5\"}");
        String bad = imp(null, "{\"kind\":\"elec\",\"zone\":\"p2\",\"name\":\"ITBS五乙\",\"ym\":\"2082-03\","
                + "\"code\":\"ITBS-5\",\"currTotal\":9}");
        assertThat(reasons(bad, "errors")).singleElement().asString().contains("填错");
        assertThat(bookOf(g5)).as("G5 行不记").isEmpty();

        int g11 = createMeter("ITBS十一", "1");
        exportedNotice(g11, "2082-03");
        String frozen = imp(null, irow("ITBS十一", "2082-03", ",\"tenantName\":\"IT乙\",\"currTotal\":5"));
        assertThat(reasons(frozen, "notices")).singleElement().asString().contains("冻结");
        assertThat(bookOf(g11)).as("G11 冻结行照记").containsExactly("2082-03|" + batchOf(frozen) + "|null");
    }

    // §10.2 撤销这次导入:只删本批的记录,同一块表同一个月别的批次照留
    @Test
    void bookSeen_revertDeletesOnlyThatBatch() throws Exception {
        int id = createMeter("ITBS撤", "1");
        String b1 = batchOf(imp(null, irow("ITBS撤", "2082-04", ",\"tenantName\":\"IT甲\",\"currTotal\":1")));
        String b2 = batchOf(imp(null, irow("ITBS撤", "2082-04", ",\"tenantName\":\"IT乙\",\"currTotal\":1")));
        assertThat(bookOf(id)).as("撤销前两批各一笔").hasSize(2);
        revert(b2);
        assertThat(bookOf(id)).containsExactly("2082-04|" + b1 + "|null");
    }

    // §10.2 批量删除本期:按 kind / zone 删该月的记录,预览多报一个数且与实删一致;别的月、筛选外的表照留
    @Test
    void bookSeen_batchDeleteDropsThatMonthWithinKindZone_previewCounts() throws Exception {
        int a = createMeter("ITBS删甲", "1");
        int w = postId("/api/meters", "{\"kind\":\"water\",\"zone\":\"p1\",\"name\":\"ITBS删水\"}");
        imp(null, irow("ITBS删甲", "2082-05", ",\"currTotal\":1"));
        imp(null, irow("ITBS删甲", "2082-06", ",\"currTotal\":2"));
        imp(null, "{\"kind\":\"water\",\"zone\":\"p1\",\"name\":\"ITBS删水\",\"ym\":\"2082-05\",\"currTotal\":1}");
        String pv = utf8(mvc.perform(get("/api/meters/readings/delete-preview").param("ym", "2082-05")
                        .param("kind", "elec").param("zone", "p1").param("dropEmptyMeters", "false")
                        .header("Authorization", auth()))
                .andExpect(jsonPath("$.data.bookRows").value(1)).andReturn());
        String del = utf8(mvc.perform(delete("/api/meters/readings").param("ym", "2082-05")
                        .param("kind", "elec").param("zone", "p1").param("dropEmptyMeters", "false")
                        .header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0)).andReturn());
        assertThat((Object) JsonPath.read(del, "$.data")).isEqualTo(JsonPath.read(pv, "$.data"));
        assertThat(bookOf(a)).as("只删该月").singleElement().asString().startsWith("2082-06|");
        assertThat(bookOf(w)).as("水表不在 kind=elec 的筛选里").singleElement().asString().startsWith("2082-05|");
    }

    // §10.3 list(ym):站在 ym 给 bookSeen / bookFile / bookAt;该月册子里没有的表(档案沿用前一行)= false;
    //   同月多笔取最近一笔;不带 ym 恒 false
    @Test
    void bookSeen_listStandsAtYm_latestRecordWins() throws Exception {
        createMeter("ITBS列甲", "1");
        createMeter("ITBS列乙", "1");
        imp("ITBS七月.xlsx", irow("ITBS列甲", "2082-07", ",\"currTotal\":1"), irow("ITBS列乙", "2082-07", ",\"currTotal\":1"));
        imp("ITBS八月.xlsx", irow("ITBS列乙", "2082-08", ",\"tenantName\":\"IT甲\",\"currTotal\":2"));
        imp("ITBS八月补.xlsx", irow("ITBS列乙", "2082-08", ",\"tenantName\":\"IT乙\",\"currTotal\":2"));
        var jul = meterAt("ITBS列甲", "2082-07");
        assertThat(jul.get("bookSeen")).isEqualTo(true);
        assertThat(jul.get("bookFile")).isEqualTo("ITBS七月.xlsx");
        assertThat(jul.get("bookAt")).isNotNull();
        var aug = meterAt("ITBS列甲", "2082-08");
        assertThat(aug.get("bookSeen")).as("8 月册子里没有甲:档案沿用 7 月那一行,不算核过").isEqualTo(false);
        assertThat(aug.get("bookFile")).isNull();
        assertThat(aug.get("bookAt")).isNull();
        assertThat(meterAt("ITBS列乙", "2082-08").get("bookFile")).as("同月多笔取最近一笔").isEqualTo("ITBS八月补.xlsx");
        assertThat(meterAt("ITBS列乙", null).get("bookSeen")).as("不带 ym 恒 false").isEqualTo(false);
    }

    // ══ METER-TIMELINE-SPEC §3.3 §3.4 屏上按月改归属 / 状态 / 建表 / 手录读数自愈(B2)。独占 2088 年 ══

    @Autowired com.park.demo3.mapper.ReviewStateMapper reviewStateMapper;

    private org.springframework.test.web.servlet.ResultActions assignReq(String ym, String mode, String patch,
                                                                        boolean copies, int... ids) throws Exception {
        String body = "{\"ym\":\"" + ym + "\",\"mode\":\"" + mode + "\",\"meterIds\":" + java.util.Arrays.toString(ids)
                + ",\"patch\":" + patch + ",\"alsoMigrateCopies\":" + copies + "}";
        return mvc.perform(put("/api/meters/assign").header("Authorization", auth())
                .contentType("application/json").content(body));
    }

    /** PUT /api/meters/assign(不带 migrate 复本),须成功。 */
    private void assign(String ym, String mode, String patch, int... ids) throws Exception {
        assignReq(ym, mode, patch, false, ids).andExpect(jsonPath("$.code").value(0));
    }

    private void clearManual(int id, String ym) throws Exception {
        mvc.perform(post("/api/meters/assign/clear-manual").header("Authorization", auth()).contentType("application/json")
                .content("{\"meterId\":" + id + ",\"ym\":\"" + ym + "\"}")).andExpect(jsonPath("$.code").value(0));
    }

    private org.springframework.test.web.servlet.ResultActions statusReq(int id, String fromYm, String status,
                                                                        String replaceFromYm) throws Exception {
        return mvc.perform(post("/api/meters/" + id + "/status").header("Authorization", auth()).contentType("application/json")
                .content("{\"fromYm\":\"" + fromYm + "\",\"status\":\"" + status + "\""
                        + (replaceFromYm == null ? "" : ",\"replaceFromYm\":\"" + replaceFromYm + "\"") + "}"));
    }

    private org.springframework.test.web.servlet.ResultActions readingReq(int id, String ym, String fields) throws Exception {
        return mvc.perform(post("/api/meters/readings").header("Authorization", auth()).contentType("application/json")
                .content("{\"meterId\":" + id + ",\"ym\":\"" + ym + "\"," + fields + "}"));
    }

    /** 该月园区抄表已审核(SPEC §4 冻结来源 1)。 */
    private void lockReview(String ym) { lockReview(com.park.demo3.security.ReviewKind.METERS, ym); }

    private void lockReview(com.park.demo3.security.ReviewKind kind, String ym) {
        var s = new com.park.demo3.entity.ReviewState();
        s.setReviewKey(com.park.demo3.security.ReviewKey.of(kind, null, ym).raw());
        s.setKind(kind.code()); s.setPeriod(ym); s.setStatus("approved");
        reviewStateMapper.insert(s);
    }

    private int meterId(String name) throws Exception {
        return ((Number) meterAt(name, null).get("id")).intValue();
    }

    private static MeterAssign seg(int meterId, String ym) {
        MeterAssign a = new MeterAssign();
        a.setMeterId(meterId); a.setFromYm(ym); a.setTenantName("IT甲"); a.setOwnership("tenant");
        return a;
    }

    // §3.3 两种模式:from = 只在 V 写一行(前后两段不动,R3/R4);correct = 改 V 所在的那一段 F,不新写 V;
    // 改到的组置人工标记;「改回按册子」清标记、值不动
    @Test
    void assign_fromWritesOnlyV_correctRewritesF_manualFlags_clearManual() throws Exception {
        String n = "ITB2归属表";
        importOne(n, "2088-01", "IT甲");
        importOne(n, "2088-06", "IT乙");
        int id = meterId(n);
        String res = utf8(assignReq("2088-03", "from", "{\"tenantName\":\"IT丙\",\"tenantId\":null}", false, id)
                .andExpect(jsonPath("$.code").value(0)).andReturn());
        java.util.List<String> written = JsonPath.read(res, "$.data[*].fromYm");
        assertThat(written).containsExactly("2088-03");
        assertThat((String) JsonPath.read(res, "$.data[0].until")).isEqualTo("2088-05");
        assertThat(timeline.rows(id).assign()).extracting(MeterAssign::getFromYm)
                .containsExactly("2088-01", "2088-03", "2088-06");
        assertThat(assignRow(id, "2088-01").getTenantName()).isEqualTo("IT甲");
        assertThat(assignRow(id, "2088-06").getTenantName()).isEqualTo("IT乙");
        MeterAssign mar = assignRow(id, "2088-03");
        assertThat(mar.getTenantName()).isEqualTo("IT丙");
        assertThat(mar.getSrc()).isEqualTo("manual");
        assertThat(mar.getTenantManual()).isEqualTo(1);
        assertThat(mar.getOwnerManual()).isZero();
        assertThat(assignRow(id, "2088-01").getTenantManual()).isZero();

        assign("2088-04", "correct", "{\"subName\":\"IT一号\"}", id);
        assertThat(timeline.rows(id).assign()).extracting(MeterAssign::getFromYm)
                .containsExactly("2088-01", "2088-03", "2088-06");
        assertThat(assignRow(id, "2088-03").getSubName()).isEqualTo("IT一号");
        assertThat(assignRow(id, "2088-01").getSubName()).isNull();
        assertThat(assignRow(id, "2088-06").getSubName()).isNull();

        clearManual(id, "2088-04");
        assertThat(assignRow(id, "2088-03").getTenantManual()).isZero();
        assertThat(assignRow(id, "2088-03").getTenantName()).isEqualTo("IT丙");
    }

    // §3.3「一并更正后面 N 段(上线时复制的)」:只动紧挨着的、src=migrate 且与改前相同的段;timeline 报的 N 与之同数
    @Test
    void assign_alsoMigrateCopies_onlyContiguousUnchangedMigrateRows() throws Exception {
        int id = createMeter("ITB2复本表", "1");
        for (String ym : new String[]{"2088-01", "2088-03", "2088-05", "2088-09"})
            timeline.writeAssign(seg(id, ym), MeterTimelineService.Ctx.of("migrate"));
        timeline.writeAssign(seg(id, "2088-07"), MeterTimelineService.Ctx.of("import"));   // 不是上线复本,挡住后面
        mvc.perform(get("/api/meters/" + id + "/timeline").param("ym", "2088-02").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.impact.migrateCopies").value(2));
        String res = utf8(assignReq("2088-02", "correct", "{\"tenantName\":\"IT丁\"}", true, id)
                .andExpect(jsonPath("$.code").value(0)).andReturn());
        java.util.List<String> written = JsonPath.read(res, "$.data[*].fromYm");
        assertThat(written).containsExactly("2088-01", "2088-03", "2088-05");
        for (String ym : new String[]{"2088-01", "2088-03", "2088-05"})
            assertThat(assignRow(id, ym).getTenantName()).as(ym).isEqualTo("IT丁");
        assertThat(assignRow(id, "2088-07").getTenantName()).isEqualTo("IT甲");
        assertThat(assignRow(id, "2088-09").getTenantName()).as("隔着一段导入行,不算紧挨着").isEqualTo("IT甲");
        assertThat(assignRow(id, "1900-01").getTenantName()).isNull();
    }

    // §3.3 同房间一起写 + §4:任一块表的区间里有冻结月 → 整批 409 点名、一块都不改;审核锁 → 423
    @Test
    void assign_meterIdsTogether_oneFrozenRefusesAll_reviewLock423() throws Exception {
        int a = idOf(imp(null, irow("ITB2同房A", "2088-01", ",\"tenantName\":\"IT甲\",\"currTotal\":1")));
        int b = idOf(imp(null, irow("ITB2同房B", "2088-01", ",\"tenantName\":\"IT甲\",\"currTotal\":1")));
        exportedNotice(b, "2088-02");
        String res = utf8(assignReq("2088-03", "correct", "{\"tenantName\":\"IT乙\"}", false, a, b)
                .andExpect(jsonPath("$.code").value(409)).andReturn());
        assertThat((String) JsonPath.read(res, "$.message")).contains("id " + b + ")").contains("2088-02")
                .contains("已导出").doesNotContain("id " + a + ")");
        assertThat(assignRow(a, "2088-01").getTenantName()).as("一块都没改").isEqualTo("IT甲");
        assign("2088-03", "from", "{\"tenantName\":\"IT乙\"}", a, b);   // 自 3 月起:区间不含 2 月
        assertThat(assignRow(a, "2088-03").getTenantName()).isEqualTo("IT乙");
        assertThat(assignRow(b, "2088-03").getTenantName()).isEqualTo("IT乙");
        lockReview("2088-03");
        assignReq("2088-03", "correct", "{\"subName\":\"IT一号\"}", false, a).andExpect(jsonPath("$.code").value(423));
        assertThat(assignRow(a, "2088-03").getSubName()).isNull();
    }

    // PLAN §1 GET /{id}/timeline:两条链 + 变更记录 + 两个选项的区间与冻结月 + 同楼栋同房号的表
    @Test
    void timelineGet_rowsLogImpactSiblings() throws Exception {
        int bld = postId("/api/buildings",
                "{\"name\":\"IT-B2-楼\",\"phase\":1,\"floorCount\":5,\"totalArea\":100,\"rentableArea\":90}");
        String at = ",\"buildingId\":" + bld + ",\"area\":\"ITB2区\",\"currTotal\":1";
        int x = idOf(imp(null, irow("ITB2同房X", "2088-01", at + ",\"spot\":\"三楼301室\",\"code\":\"ITB2-X\"")));
        int y = idOf(imp(null, irow("ITB2同房Y", "2088-01", at + ",\"spot\":\"三楼301室\",\"code\":\"ITB2-Y\"")));
        idOf(imp(null, irow("ITB2别房Z", "2088-01", at + ",\"spot\":\"三楼302室\",\"code\":\"ITB2-Z\"")));
        exportedNotice(x, "2088-02");
        String res = utf8(mvc.perform(get("/api/meters/" + x + "/timeline").param("ym", "2088-03")
                .header("Authorization", auth())).andExpect(jsonPath("$.code").value(0)).andReturn());
        java.util.List<String> assignFroms = JsonPath.read(res, "$.data.assign[*].fromYm");
        assertThat(assignFroms).containsExactly("2088-01");
        java.util.List<String> statuses = JsonPath.read(res, "$.data.status[*].status");
        assertThat(statuses).containsExactly("active");
        assertThat((Integer) JsonPath.read(res, "$.data.log.length()")).isPositive();
        assertThat((String) JsonPath.read(res, "$.data.impact.correct.from")).isEqualTo("2088-01");
        assertThat((Object) JsonPath.read(res, "$.data.impact.correct.until")).isNull();
        java.util.List<String> lockedYms = JsonPath.read(res, "$.data.impact.correct.locked[*].ym");
        assertThat(lockedYms).contains("2088-02");
        assertThat((String) JsonPath.read(res, "$.data.impact.correct.locked[0].reason")).contains("已导出");
        assertThat((String) JsonPath.read(res, "$.data.impact.from.from")).isEqualTo("2088-03");
        assertThat((java.util.List<?>) JsonPath.read(res, "$.data.impact.from.locked")).isEmpty();
        java.util.List<Integer> sib = JsonPath.read(res, "$.data.siblings[*].meterId");
        assertThat(sib).containsExactly(y);
    }

    // §3.4 状态列表:加一行 / 改月 / 撤回误标;第一行不能删只能改月;区间里有冻结月 409 一行不写
    @Test
    void statusRows_addMoveDelete_firstRowOnlyMoves_frozenRefused() throws Exception {
        int id = idOf(imp(null, irow("ITB2状态表", "2088-01", ",\"currTotal\":1")));
        statusReq(id, "2088-04", "retired", null).andExpect(jsonPath("$.code").value(0));
        assertThat(statusChain(id)).containsExactly("2088-01:active", "2088-04:retired");
        statusReq(id, "2088-05", "retired", "2088-04").andExpect(jsonPath("$.code").value(0));
        assertThat(statusChain(id)).containsExactly("2088-01:active", "2088-05:retired");
        mvc.perform(delete("/api/meters/" + id + "/status/2088-01").header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(409));
        assertThat(statusChain(id)).containsExactly("2088-01:active", "2088-05:retired");
        mvc.perform(delete("/api/meters/" + id + "/status/2088-05").header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0));
        statusReq(id, "2088-03", "active", "2088-01").andExpect(jsonPath("$.code").value(0));
        assertThat(statusChain(id)).containsExactly("2088-03:active");
        exportedNotice(id, "2088-06");
        String res = utf8(statusReq(id, "2088-06", "removed", null).andExpect(jsonPath("$.code").value(409)).andReturn());
        assertThat((String) JsonPath.read(res, "$.message")).contains("2088-06").contains("已导出");
        assertThat(statusChain(id)).containsExactly("2088-03:active");
    }

    // §3.4 写停用 / 拆除前的确认数:区间、区间里的非零用量月、所在公摊池、钉的合同
    @Test
    void statusImpact_nonZeroReadingsPoolsPinnedContract() throws Exception {
        int id = createMeter("ITB2影响表", "1");
        addReading(id, "2088-02");                                                          // 用量 10
        readingReq(id, "2088-03", "\"prevTotal\":10,\"currTotal\":10").andExpect(jsonPath("$.code").value(0));   // 用量 0
        mvc.perform(post("/api/alloc/rules").header("Authorization", auth()).contentType("application/json")
                .content("{\"zone\":\"p1\",\"name\":\"ITB2影响池\",\"method\":\"none\",\"feeKey\":\"share_elec_fire\","
                        + "\"feeName\":\"ITB2影响池\",\"meterIds\":[" + id + "]}"))
                .andExpect(jsonPath("$.code").value(0));
        int tenant = postId("/api/tenants", "{\"companyName\":\"ITB2钉户\",\"businessType\":\"IT\"}");
        int bld = postId("/api/buildings",
                "{\"name\":\"IT-B2-钉楼\",\"phase\":1,\"floorCount\":5,\"totalArea\":100,\"rentableArea\":90}");
        String no = "IT-B2-" + System.nanoTime();
        int contract = postId("/api/contracts", "{\"contractNo\":\"" + no + "\",\"tenantId\":" + tenant
                + ",\"buildingId\":" + bld + ",\"startDate\":\"2088-01-01\",\"endDate\":\"2088-12-31\","
                + "\"rentArea\":100,\"monthlyRent\":1000,\"deposit\":0,\"status\":\"active\"}");
        mvc.perform(put("/api/meters/" + id + "/bind").header("Authorization", auth()).contentType("application/json")
                .content("{\"contractId\":" + contract + ",\"ym\":\"2088-02\",\"mode\":\"correct\"}"))
                .andExpect(jsonPath("$.code").value(0));
        String res = utf8(mvc.perform(get("/api/meters/" + id + "/status-impact").param("fromYm", "2088-02")
                .param("status", "removed").header("Authorization", auth())).andExpect(jsonPath("$.code").value(0)).andReturn());
        assertThat((String) JsonPath.read(res, "$.data.from")).isEqualTo("2088-02");
        assertThat((Object) JsonPath.read(res, "$.data.until")).isNull();
        java.util.List<String> readMonths = JsonPath.read(res, "$.data.readings[*].ym");
        assertThat(readMonths).containsExactly("2088-02");
        assertThat(((Number) JsonPath.read(res, "$.data.readings[0].usage")).doubleValue()).isEqualTo(10.0);
        java.util.List<String> pools = JsonPath.read(res, "$.data.pools[*].name");
        assertThat(pools).singleElement().asString().endsWith("ITB2影响池");   // 池名带期区前缀
        assertThat((String) JsonPath.read(res, "$.data.contractNo")).isEqualTo(no);
        mvc.perform(get("/api/meters/" + id + "/status-impact").param("fromYm", "2088-02").param("status", "active")
                .header("Authorization", auth())).andExpect(jsonPath("$.data.readings").isEmpty());
    }

    // §3.4 新增表自 fromYm 起在册(之前的月份不在册);这段月份里有审核锁 → 423,表不建
    @Test
    void create_fromYm_inRegisterFromThatMonth_reviewLockRefuses() throws Exception {
        addReading(createMeter("ITB2垫底表", "1"), "2088-06");   // 最大已生成月 ≥ 2088-06
        int id = postId("/api/meters", "{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"ITB2新装表\",\"fromYm\":\"2088-04\"}");
        assertThat(statusChain(id)).containsExactly("2088-04:active");
        assertThat(timeline.rows(id).assign()).extracting(MeterAssign::getFromYm).containsExactly("2088-04");
        assertThat(meterAt("ITB2新装表", "2088-03").get("status")).isNull();
        assertThat(meterAt("ITB2新装表", "2088-04").get("status")).isEqualTo("active");
        lockReview("2088-05");
        mvc.perform(post("/api/meters").header("Authorization", auth()).contentType("application/json")
                .content("{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"ITB2晚装表\",\"fromYm\":\"2088-04\"}"))
                .andExpect(jsonPath("$.code").value(423));
        assertThat(meterMapper.selectByKey("elec", "p1", "ITB2晚装表")).isNull();
        postId("/api/meters", "{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"ITB2再装表\",\"fromYm\":\"2088-06\"}");
    }

    // §3.4 抽屉给早于第一条状态的月份补读数 → 自 M 起在册(状态 + 归属照最早一行补 M);
    // 只有底数(本月止全空)不自愈;补上的区间里有冻结月 → 整条拒,读数也不写
    @Test
    void createReading_beforeFirstStatus_selfHeals_blankDoesNot_frozenRefuses() throws Exception {
        int id = idOf(imp(null, irow("ITB2自愈表", "2088-05", ",\"tenantName\":\"IT甲\",\"currTotal\":1")));
        readingReq(id, "2088-03", "\"prevTotal\":5").andExpect(jsonPath("$.code").value(0));
        assertThat(statusChain(id)).containsExactly("2088-05:active");
        readingReq(id, "2088-02", "\"prevTotal\":0,\"currTotal\":3").andExpect(jsonPath("$.code").value(0));
        assertThat(statusChain(id)).containsExactly("2088-02:active", "2088-05:active");
        assertThat(assignRow(id, "2088-02").getTenantName()).isEqualTo("IT甲");
        assertThat(assignRow(id, "2088-02").getSrc()).isEqualTo("manual");

        int j = idOf(imp(null, irow("ITB2自愈乙", "2088-05", ",\"currTotal\":1")));
        exportedNotice(j, "2088-03");
        readingReq(j, "2088-02", "\"currTotal\":1").andExpect(jsonPath("$.code").value(409));
        assertThat(statusChain(j)).containsExactly("2088-05:active");
        mvc.perform(get("/api/meters/" + j + "/readings").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.ym=='2088-02')]").isEmpty());
    }

    // ══ E 阶段修补:对抗复查坐实的洞。独占 2084 年 ══

    // §3.4 状态行改月只在前后两行之间挪:越过相邻行、或挪到相邻行那个月 → 409,一行不动;两行之间照挪
    @Test
    void statusMove_cannotCrossNeighbourRows() throws Exception {
        int id = idOf(imp(null, irow("ITE挪月表", "2084-01", ",\"currTotal\":1")));
        statusReq(id, "2084-03", "retired", null).andExpect(jsonPath("$.code").value(0));
        statusReq(id, "2084-06", "active", null).andExpect(jsonPath("$.code").value(0));
        String res = utf8(statusReq(id, "2084-08", "retired", "2084-03").andExpect(jsonPath("$.code").value(409)).andReturn());
        assertThat((String) JsonPath.read(res, "$.message")).contains("2084-01 之后").contains("2084-06 之前");
        statusReq(id, "2084-02", "active", "2084-06").andExpect(jsonPath("$.code").value(409));
        statusReq(id, "2084-06", "retired", "2084-03").andExpect(jsonPath("$.code").value(409));
        assertThat(statusChain(id)).containsExactly("2084-01:active", "2084-03:retired", "2084-06:active");
        statusReq(id, "2084-05", "retired", "2084-03").andExpect(jsonPath("$.code").value(0));
        assertThat(statusChain(id)).containsExactly("2084-01:active", "2084-05:retired", "2084-06:active");
    }

    // §3.3 同房间的表与主表(meterIds 第一块)用同一个起始月一起写:主表那一段自 05 起,
    // 更正它时同房间的表也自 05 起写,它自己自 01 起的那一段不动(历史月不许被静默改挂)
    @Test
    void assign_siblingsShareMainMetersStartMonth() throws Exception {
        int a = idOf(imp(null, irow("ITE同房主表", "2084-01", ",\"tenantName\":\"IT甲\",\"currTotal\":1")));
        imp(null, irow("ITE同房主表", "2084-05", ",\"tenantName\":\"IT甲\",\"currTotal\":2"));
        int b = idOf(imp(null, irow("ITE同房副表", "2084-01", ",\"tenantName\":\"IT甲\",\"currTotal\":1")));
        assertThat(a).isNotEqualTo(b);
        assertThat(timeline.rows(a).assign()).extracting(MeterAssign::getFromYm).containsExactly("2084-01", "2084-05");
        String res = utf8(assignReq("2084-06", "correct", "{\"tenantName\":\"IT丙\"}", false, a, b)
                .andExpect(jsonPath("$.code").value(0)).andReturn());
        java.util.List<String> froms = JsonPath.read(res, "$.data[*].fromYm");
        assertThat(froms).containsExactly("2084-05", "2084-05");
        assertThat(assignRow(b, "2084-01").getTenantName()).isEqualTo("IT甲");
        assertThat(assignRow(b, "2084-05").getTenantName()).isEqualTo("IT丙");
        assertThat(assignRow(a, "2084-01").getTenantName()).isEqualTo("IT甲");
    }

    // §3.5 同一行先撤后一批、再撤前一批:撤掉后一批时批次号被清空,值与前一批的后像相同,不算「之后又改过」
    @Test
    void revertImport_laterThenEarlierBatchOnSameRow() throws Exception {
        imp(null, irow("ITE撤销链表", "2084-01", ",\"tenantName\":\"IT甲\",\"currTotal\":1"));
        int id = meterMapper.selectByKey("elec", "p1", "ITE撤销链表").getId();
        String a = batchOf(imp(null, irow("ITE撤销链表", "2084-01", ",\"tenantName\":\"IT乙\",\"currTotal\":1")));
        String b = batchOf(imp(null, irow("ITE撤销链表", "2084-01", ",\"tenantName\":\"IT丙\",\"currTotal\":1")));
        revert(b).andExpect(jsonPath("$.code").value(0));
        assertThat(assignRow(id, "2084-01").getTenantName()).isEqualTo("IT乙");
        revert(a).andExpect(jsonPath("$.code").value(0));
        assertThat(assignRow(id, "2084-01").getTenantName()).isEqualTo("IT甲");
        revert(a).andExpect(jsonPath("$.code").value(409));   // 撤过的再撤照样拒
    }

    // §3.6 导入换户写的新行不继承合同钉(钉的是上一户的合同);同户的新行照带
    @Test
    void import_tenantChangeNewRow_dropsContractPin() throws Exception {
        int id = idOf(imp(null, irow("ITE换户钉表", "2084-01", ",\"tenantName\":\"IT甲\",\"currTotal\":1")));
        int tenant = postId("/api/tenants", "{\"companyName\":\"ITE钉户\",\"businessType\":\"IT\"}");
        int bld = postId("/api/buildings",
                "{\"name\":\"IT-E-钉楼\",\"phase\":1,\"floorCount\":5,\"totalArea\":100,\"rentableArea\":90}");
        int contract = postId("/api/contracts", "{\"contractNo\":\"IT-E-" + System.nanoTime() + "\",\"tenantId\":" + tenant
                + ",\"buildingId\":" + bld + ",\"startDate\":\"2084-01-01\",\"endDate\":\"2084-12-31\","
                + "\"rentArea\":100,\"monthlyRent\":1000,\"deposit\":0,\"status\":\"active\"}");
        mvc.perform(put("/api/meters/" + id + "/bind").header("Authorization", auth()).contentType("application/json")
                .content("{\"contractId\":" + contract + ",\"ym\":\"2084-01\",\"mode\":\"correct\"}"))
                .andExpect(jsonPath("$.code").value(0));
        imp(null, irow("ITE换户钉表", "2084-02", ",\"tenantName\":\"IT甲\",\"currTotal\":2"));
        imp(null, irow("ITE换户钉表", "2084-03", ",\"tenantName\":\"IT乙\",\"currTotal\":3"));
        assertThat(assignRow(id, "2084-01").getContractId()).isEqualTo(contract);
        assertThat(assignRow(id, "2084-02").getContractId()).as("同户的新行照带").isEqualTo(contract);
        assertThat(assignRow(id, "2084-03").getContractId()).as("换户的新行不继承").isNull();
    }

    // ══ 用户 2026-09-24「想删除南盛物流删不了,想批量删除也删不了」:删表 / 批删被催缴单挡住时说清楚、给出路。独占 2081 年 ══

    /** 该月一张催缴单(新建一户),明细 lines 行都记在这块表上;回单 id。 */
    private int noticeOn(int meterId, String ym, String status, String tenantName, int lines) {
        var t = new com.park.demo3.entity.Tenant();
        t.setCompanyName(tenantName); t.setBusinessType("factory");
        tenantMapper.insert(t);
        var n = new com.park.demo3.entity.BillNotice();
        n.setYm(ym); n.setTenantId(t.getId()); n.setNoticeKind("combined"); n.setStatus(status);
        n.setTotalAmount(java.math.BigDecimal.ZERO); n.setGeneratedAt(java.time.LocalDateTime.now());
        noticeMapper.insert(n);
        for (int i = 1; i <= lines; i++) {
            var l = new com.park.demo3.entity.BillNoticeLine();
            l.setNoticeId(n.getId()); l.setLineNo(i); l.setFeeKey("elec"); l.setMeterId(meterId);
            l.setAmount(java.math.BigDecimal.ZERO);
            noticeLineMapper.insert(l);
        }
        return n.getId();
    }

    private org.springframework.test.web.servlet.ResultActions batchDel(String ym, boolean dropDrafts) throws Exception {
        return mvc.perform(delete("/api/meters/readings").param("ym", ym)
                .param("dropDraftNotices", String.valueOf(dropDrafts)).header("Authorization", auth()));
    }

    private long noticesOf(String ym) {
        return noticeMapper.selectCount(new QueryWrapper<com.park.demo3.entity.BillNotice>().eq("ym", ym));
    }

    private void readingsLeft(String ym, int n) throws Exception {
        mvc.perform(get("/api/meters/readings").param("ym", ym).header("Authorization", auth()))
                .andExpect(jsonPath("$.data.length()").value(n));
    }

    // 批删:有已确认的单 409 点户名 → 作废后只剩草稿/作废单,不勾 409 告诉人勾哪项 → 勾了单、读数、删完零读数的表一起删
    @Test
    void batchDelete_lockedNotice409NamesTenant_draftsNeedTick_tickDropsNoticesWithReadings() throws Exception {
        String ym = "2081-03";
        int a = createMeter("IT批删单表", "1");
        addReading(a, ym);
        int draft = noticeOn(a, ym, "draft", "IT批删草稿户", 2);
        int voided = noticeOn(a, ym, "void", "IT批删作废户", 1);
        int locked = noticeOn(a, ym, "confirmed", "IT批删确认户", 1);

        // ① 预览分两类报数,锁定单点户名
        String pv = utf8(mvc.perform(get("/api/meters/readings/delete-preview").param("ym", ym)
                .header("Authorization", auth())).andExpect(jsonPath("$.code").value(0)).andReturn());
        assertThat((Integer) JsonPath.read(pv, "$.data.notices")).isEqualTo(3);
        assertThat((Integer) JsonPath.read(pv, "$.data.draftNotices")).isEqualTo(1);
        assertThat((Integer) JsonPath.read(pv, "$.data.voidNotices")).isEqualTo(1);
        assertThat((Integer) JsonPath.read(pv, "$.data.lockedNotices")).isEqualTo(1);
        assertThat(JsonPath.<java.util.List<String>>read(pv, "$.data.lockedTenants")).containsExactly("IT批删确认户");

        // ② 有已确认的单:勾了也 409,点户名、指到作废;单与读数一样都不动
        String m1 = JsonPath.read(utf8(batchDel(ym, true).andExpect(jsonPath("$.code").value(409)).andReturn()), "$.message");
        assertThat(m1).contains("1 张已确认/已导出的催缴单(IT批删确认户)").contains("先在催缴单屏作废这些单");
        assertThat(noticesOf(ym)).isEqualTo(3);
        readingsLeft(ym, 1);

        // ③ 照屏上说的作废那张已确认的单 → 只剩草稿/作废单;不勾 409,告诉人勾哪一项
        mvc.perform(post("/api/bill-notices/" + locked + "/void").header("Authorization", auth())
                .contentType("application/json").content("{\"reason\":\"IT重出\"}")).andExpect(jsonPath("$.code").value(0));
        String m2 = JsonPath.read(utf8(batchDel(ym, false).andExpect(jsonPath("$.code").value(409)).andReturn()), "$.message");
        assertThat(m2).contains("3 张草稿催缴单(含已作废 2 张)").contains("勾选「同时删除该月的草稿催缴单」");
        assertThat(noticesOf(ym)).isEqualTo(3);
        readingsLeft(ym, 1);

        // ④ 勾了:单(连明细行)、读数、删完零读数的表一起删 —— 表在本月单的明细里,先删单才删得掉表
        String done = utf8(batchDel(ym, true).andExpect(jsonPath("$.code").value(0)).andReturn());
        assertThat((Integer) JsonPath.read(done, "$.data.draftNotices")).isEqualTo(1);
        assertThat((Integer) JsonPath.read(done, "$.data.voidNotices")).isEqualTo(2);
        assertThat(noticesOf(ym)).isZero();
        assertThat(noticeLineMapper.selectCount(new QueryWrapper<com.park.demo3.entity.BillNoticeLine>()
                .in("notice_id", draft, voided, locked))).isZero();
        readingsLeft(ym, 0);
        assertThat(meterMapper.selectById(a)).isNull();
    }

    // 批删连带删草稿单与 generate 同一道闸:催缴单该月已审核 → 423,单与读数都不动
    @Test
    void batchDelete_dropDrafts_billNoticeReviewLock423() throws Exception {
        String ym = "2081-04";
        int a = createMeter("IT批删审核表", "1");
        addReading(a, ym);
        noticeOn(a, ym, "draft", "IT批删审核户", 1);
        lockReview(com.park.demo3.security.ReviewKind.BILL_NOTICES, ym);
        batchDel(ym, true).andExpect(jsonPath("$.code").value(423));
        assertThat(noticesOf(ym)).isEqualTo(1);
        readingsLeft(ym, 1);
    }

    // 批删「删完零读数的表档案」:这块表还在别的月的单里 → 跳过点名(不然整批撞 FK),读数照删
    @Test
    void batchDelete_emptiedMeterStillInOtherMonthsNotice_skippedAndNamed() throws Exception {
        String ym = "2081-08";
        int e = createMeter("IT批删别月单表", "1");
        addReading(e, ym);
        noticeOn(e, "2081-02", "draft", "IT批删别月户", 1);
        String pv = utf8(mvc.perform(get("/api/meters/readings/delete-preview").param("ym", ym)
                .header("Authorization", auth())).andExpect(jsonPath("$.code").value(0)).andReturn());
        assertThat(JsonPath.<java.util.List<String>>read(pv, "$.data.meterDeleted")).isEmpty();
        assertThat(JsonPath.<java.util.List<String>>read(pv, "$.data.meterBlocked")).singleElement().asString()
                .contains("id " + e).contains("别的月的催缴单里还有它");
        batchDel(ym, false).andExpect(jsonPath("$.code").value(0));
        assertThat(meterMapper.selectById(e)).isNotNull();
        readingsLeft(ym, 0);
    }

    // ── 用户 2026-09-24「为什么删除南盛物流要去计费参数重新生成」→ 删表确认框列出挂着它的单,勾上连草稿单一起删 ──

    @Autowired com.park.demo3.mapper.AuthAuditLogMapper auditMapper;
    @Autowired com.park.demo3.mapper.BillNoticeWarnMapper warnMapper;

    private org.springframework.test.web.servlet.ResultActions delMeter(int id, boolean dropDrafts) throws Exception {
        return mvc.perform(delete("/api/meters/" + id).param("dropDraftNotices", String.valueOf(dropDrafts))
                .header("Authorization", auth()));
    }

    private String deleteImpact(int id) throws Exception {
        return utf8(mvc.perform(get("/api/meters/" + id + "/delete-impact").header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0)).andReturn());
    }

    private java.util.List<String> staleSources(String ym) throws Exception {
        return JsonPath.read(utf8(mvc.perform(get("/api/params/status").param("ym", ym).header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0)).andReturn()), "$.data.staleSources");
    }

    private long noticesIn(Integer... ids) {
        return noticeMapper.selectCount(new QueryWrapper<com.park.demo3.entity.BillNotice>().in("id", (Object[]) ids));
    }

    // 只挂在草稿/已作废单里:影响报数 → 不勾 409 指到确认框的勾选项 → 勾了只删挂着它的那几张单(整张,连明细)
    // 与表;同月别户、别月的单不动;那几个月各记一笔档案改动,屏上说「改过抄表」需重算
    @Test
    void deleteMeter_draftsOnly_409AsksTick_tickDropsThoseNoticesAndMeter_monthsStaleFromArchive() throws Exception {
        int m = createMeter("IT删表单据表", "1");
        int d1 = noticeOn(m, "2081-05", "draft", "IT删表草稿户甲", 2);
        int d2 = noticeOn(m, "2081-06", "draft", "IT删表草稿户乙", 1);
        int v = noticeOn(m, "2081-06", "void", "IT删表作废户", 1);
        int o = createMeter("IT删表别户表", "1");
        int sameMonth = noticeOn(o, "2081-05", "draft", "IT删表同月别户", 1);
        int otherMonth = noticeOn(o, "2081-10", "draft", "IT删表别月户", 1);
        // 同月别户那张单是一小时前生成的:这次删表记下的改动晚于它 = 该月需重算(generated_at 只到秒,同一秒比不出先后)
        var old = noticeMapper.selectById(sameMonth);
        old.setGeneratedAt(java.time.LocalDateTime.now().minusHours(1));
        noticeMapper.updateById(old);

        String imp = deleteImpact(m);
        assertThat((Integer) JsonPath.read(imp, "$.data.readings")).isZero();
        assertThat(JsonPath.<java.util.List<String>>read(imp, "$.data.poolBindings")).isEmpty();
        assertThat((Integer) JsonPath.read(imp, "$.data.draftCount")).isEqualTo(3);
        assertThat((Integer) JsonPath.read(imp, "$.data.lockedCount")).isZero();
        assertThat(JsonPath.<java.util.List<Integer>>read(imp, "$.data.notices[*].noticeId")).containsExactly(d1, d2, v);
        assertThat(JsonPath.<String>read(imp, "$.data.notices[0].tenantName")).isEqualTo("IT删表草稿户甲");
        assertThat((Integer) JsonPath.read(imp, "$.data.notices[0].lines")).isEqualTo(2);
        assertThat(JsonPath.<String>read(imp, "$.data.notices[2].status")).isEqualTo("void");

        String msg = JsonPath.read(utf8(delMeter(m, false).andExpect(jsonPath("$.code").value(409)).andReturn()), "$.message");
        assertThat(msg).contains("3 张草稿/已作废催缴单里:2081-05 IT删表草稿户甲(草稿 2 行)")
                .contains("勾选「同时删掉这 3 张草稿/已作废催缴单」").doesNotContain("重新生成");
        assertThat(noticesIn(d1, d2, v)).isEqualTo(3);
        assertThat(meterMapper.selectById(m)).isNotNull();

        // 建表那一刻起写的档案改动先清掉:下面数到的只能是这次删表记的
        changeLogMapper.delete(new QueryWrapper<DataChangeLog>().in("ym", "2081-05", "2081-06"));
        assertThat(staleSources("2081-05")).doesNotContain("meter");

        delMeter(m, true).andExpect(jsonPath("$.code").value(0));
        assertThat(meterMapper.selectById(m)).isNull();
        assertThat(noticesIn(d1, d2, v)).as("挂着它的三张单整张删掉").isZero();
        assertThat(noticeLineMapper.selectCount(new QueryWrapper<com.park.demo3.entity.BillNoticeLine>()
                .in("notice_id", d1, d2, v))).isZero();
        assertThat(noticesIn(sameMonth, otherMonth)).as("同月别户、别月的单不动").isEqualTo(2);
        for (String ym : java.util.List.of("2081-05", "2081-06"))
            assertThat(changeLogMapper.selectList(new QueryWrapper<DataChangeLog>().eq("ym", ym)))
                    .as(ym + " 记一笔档案改动").extracting(DataChangeLog::getSource).containsExactly("meter-archive");
        assertThat(staleSources("2081-05")).as("同月别户的单是删表前出的 → 需重算,来源抄表").contains("meter");
        // 2081-05 只有催缴单、没有池快照:站在别的月看,矩阵的「需重算」全集里也得有它
        assertThat(JsonPath.<java.util.List<String>>read(utf8(mvc.perform(get("/api/params/status").param("ym", "2081-10")
                .header("Authorization", auth())).andExpect(jsonPath("$.code").value(0)).andReturn()), "$.data.otherMonthsAffected"))
                .as("只有催缴单的月也进 others").contains("2081-05");
        // 不可逆:操作日志里记下谁删了哪块表、连带删了哪几张单
        assertThat(auditMapper.selectList(new QueryWrapper<com.park.demo3.entity.AuthAuditLog>()
                .eq("action", "meter.delete").eq("target", "IT删表单据表(id " + m + ")")))
                .singleElement().extracting(com.park.demo3.entity.AuthAuditLog::getDetail).asString()
                .startsWith("删表;连带删催缴单:2081-05 IT删表草稿户甲(草稿 2 行)、2081-06 IT删表草稿户乙(草稿 1 行)");
    }

    // 零读数、挂了户没挂合同的表:generate 只给那户的单出一条指着它的告警(payload = 表 id),没有明细行。
    // 删它不拦、单不删,但那个月的单是删表前出的 → 记一笔档案改动;操作日志照记
    @Test
    void deleteMeter_onlyInNoticeWarnPayload_monthStaleFromArchive_auditLogged() throws Exception {
        int m = createMeter("IT删表告警表", "1");
        int n = noticeOn(m, "2081-12", "draft", "IT删表告警户", 0);
        var w = new com.park.demo3.entity.BillNoticeWarn();
        w.setNoticeId(n); w.setCode("W_METER_NO_CONTRACT"); w.setPayload(String.valueOf(m)); w.setHint("IT删表告警表");
        warnMapper.insert(w);
        changeLogMapper.delete(new QueryWrapper<DataChangeLog>().eq("ym", "2081-12"));

        delMeter(m, false).andExpect(jsonPath("$.code").value(0));
        assertThat(meterMapper.selectById(m)).isNull();
        assertThat(noticesIn(n)).as("单上只有告警,不删").isEqualTo(1);
        assertThat(changeLogMapper.selectList(new QueryWrapper<DataChangeLog>().eq("ym", "2081-12")))
                .extracting(DataChangeLog::getSource).containsExactly("meter-archive");
        assertThat(auditMapper.selectList(new QueryWrapper<com.park.demo3.entity.AuthAuditLog>()
                .eq("action", "meter.delete").eq("target", "IT删表告警表(id " + m + ")")))
                .singleElement().extracting(com.park.demo3.entity.AuthAuditLog::getDetail).isEqualTo("删表");
    }

    // 有已确认/已导出的单:勾了也 409,只点锁定的那几张(月份 + 户名),单与表都不动;影响分两类报数
    @Test
    void deleteMeter_lockedNotice409NamesMonthAndTenant_evenWithTick() throws Exception {
        int m = createMeter("IT删表锁单表", "1");
        noticeOn(m, "2081-07", "exported", "IT删表导出户", 1);
        noticeOn(m, "2081-09", "draft", "IT删表草稿户丙", 1);
        String imp = deleteImpact(m);
        assertThat((Integer) JsonPath.read(imp, "$.data.draftCount")).isEqualTo(1);
        assertThat((Integer) JsonPath.read(imp, "$.data.lockedCount")).isEqualTo(1);

        String msg = JsonPath.read(utf8(delMeter(m, true).andExpect(jsonPath("$.code").value(409)).andReturn()), "$.message");
        assertThat(msg).contains("这块表在已确认/已导出/已签发的催缴单里:2081-07 IT删表导出户(已导出 1 行)")
                .contains("先到催缴单屏作废").doesNotContain("草稿户丙");
        assertThat(noticesOf("2081-07") + noticesOf("2081-09")).isEqualTo(2);
        assertThat(meterMapper.selectById(m)).isNotNull();
    }

    // 勾了连带删单与 generate 同一道闸:那个月催缴单已审核 → 423,单与表都不动
    @Test
    void deleteMeter_tickDrops_billNoticeReviewLock423() throws Exception {
        int m = createMeter("IT删表审核表", "1");
        noticeOn(m, "2081-11", "draft", "IT删表审核户", 1);
        lockReview(com.park.demo3.security.ReviewKind.BILL_NOTICES, "2081-11");
        delMeter(m, true).andExpect(jsonPath("$.code").value(423));
        assertThat(noticesOf("2081-11")).isEqualTo(1);
        assertThat(meterMapper.selectById(m)).isNotNull();
    }

    // ══ 同一个编码两块表:一块物理表拆下装到别处(甲 2083-03 ~ 2083-05 在册,乙 2083-06 起在册)。独占 2083 年 ══

    private static final String MOVED = "ITK-0144";

    private int codeMeter(String name, String code, String fromYm) throws Exception {
        return postId("/api/meters", "{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"" + name + "\",\"code\":\"" + code
                + "\",\"fromYm\":\"" + fromYm + "\"}");
    }

    /** 甲自 2083-03 在册、2083-06 起已拆;乙自 2083-06 在册 —— 建得出乙本身就证了首尾相接不算叠。 */
    private int[] movedMeter() throws Exception {
        int a = codeMeter("ITK甲", MOVED, "2083-03");
        statusReq(a, "2083-06", "removed", null).andExpect(jsonPath("$.code").value(0));
        return new int[]{a, codeMeter("ITK乙", MOVED, "2083-06")};
    }

    private java.util.List<String> readYms(int meterId) throws Exception {
        return JsonPath.read(utf8(mvc.perform(get("/api/meters/" + meterId + "/readings").header("Authorization", auth()))
                .andReturn()), "$.data[*].ym");
    }

    /** 须 409,回 message。 */
    private static String conflict(org.springframework.test.web.servlet.ResultActions r) throws Exception {
        return JsonPath.read(utf8(r.andExpect(jsonPath("$.code").value(409)).andReturn()), "$.message");
    }

    // 按编码认到两块表 → 按这一行的月份认在册的那块,读数落对表;
    // 哪块都不在册 / 两块都在册 → 照旧报重复,点名各块的在册区间,读数不写
    @Test
    void sameCode_importPicksMeterInRegisterThatMonth_elseNamesEach() throws Exception {
        int[] ab = movedMeter();
        String res = imp(null, irow("IT册行", "2083-04", ",\"code\":\"" + MOVED + "\",\"prevTotal\":1,\"currTotal\":4"),
                irow("IT册行", "2083-07", ",\"code\":\"" + MOVED + "\",\"prevTotal\":4,\"currTotal\":9"));
        java.util.List<Integer> hit = JsonPath.read(res, "$.data.matches[*].meterId");
        assertThat(hit).containsExactly(ab[0], ab[1]);
        assertThat(readYms(ab[0])).containsExactly("2083-04");
        assertThat(readYms(ab[1])).containsExactly("2083-07");

        String none = imp(null, irow("IT册行", "2083-01", ",\"code\":\"" + MOVED + "\",\"currTotal\":1"));
        assertThat(reasons(none, "errors")).singleElement().asString().contains("该编码有 2 块表:")
                .contains("ITK甲(2083-03 ~ 2083-05 在册)").contains("ITK乙(2083-06 起在册)")
                .contains("这一行的月份 2083-01 哪块都不在册;请核对这一行的月份,"
                        + "月份没错就到「档案变更」的「在册状态」里改那块表的在册区间,再重导这一行");
        timeline.writeStatus(ab[0], "2083-06", "active", MeterTimelineService.Ctx.of("manual"));   // 绕过接口造两块都在册的脏档案
        String both = imp(null, irow("IT册行", "2083-08", ",\"code\":\"" + MOVED + "\",\"currTotal\":1"));
        assertThat(reasons(both, "errors")).singleElement().asString().contains("ITK甲(2083-03 起在册)")
                .contains("这一行的月份 2083-08 有 2 块同时在册").contains("请先去重");
        assertThat(readYms(ab[0])).containsExactly("2083-04");
        assertThat(readYms(ab[1])).containsExactly("2083-07");
    }

    // 写完后同码的另一块表同一个月也在册 → 409 点名,一格不写;挪开不叠的照写
    @Test
    void sameCode_writesThatWouldOverlap_409() throws Exception {
        int[] ab = movedMeter();
        int a = ab[0], b = ab[1];
        assertThat(conflict(mvc.perform(post("/api/meters").header("Authorization", auth()).contentType("application/json")
                .content("{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"ITK丙\",\"code\":\"" + MOVED
                        + "\",\"fromYm\":\"2083-04\"}"))))
                .isEqualTo("编码 ITK-0144 在 2083-04 已有「ITK甲」在册");                                           // 新建表
        assertThat(meterMapper.selectByKey("elec", "p1", "ITK丙")).isNull();
        assertThat(conflict(statusReq(a, "2083-08", "active", null))).contains("在 2083-08 已有「ITK乙」在册");       // 加一行
        assertThat(conflict(statusReq(b, "2083-05", "active", "2083-06"))).contains("在 2083-05 已有「ITK甲」在册");  // 改月
        assertThat(conflict(mvc.perform(delete("/api/meters/" + a + "/status/2083-06").header("Authorization", auth()))))
                .contains("在 2083-06 已有「ITK乙」在册");                                                             // 删行
        int d = codeMeter("ITK丁", "ITK-0999", "2083-01");
        assertThat(conflict(mvc.perform(put("/api/meters/" + d).header("Authorization", auth()).contentType("application/json")
                .content("{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"ITK丁\",\"code\":\"" + MOVED + "\"}"))))
                .contains("在 2083-03 已有「ITK甲」在册");                                                             // 改编码
        assertThat(meterMapper.selectById(d).getCode()).isEqualTo("ITK-0999");
        assertThat(conflict(readingReq(b, "2083-04", "\"currTotal\":1"))).contains("在 2083-04 已有「ITK甲」在册");   // 补早月读数自愈
        String res = imp(null, irow("ITK乙", "2083-05", ",\"currTotal\":1"));                                       // 导入自愈(按名认到乙)
        assertThat(reasons(res, "errors")).singleElement().asString()
                .isEqualTo("编码 ITK-0144 在 2083-05 已有「ITK甲」在册,本行没有导入(读数也没写)");
        assertThat(readYms(b)).isEmpty();
        assertThat(statusChain(a)).containsExactly("2083-03:active", "2083-06:removed");
        assertThat(statusChain(b)).containsExactly("2083-06:active");

        statusReq(a, "2083-05", "removed", "2083-06").andExpect(jsonPath("$.code").value(0));   // 甲早一个月拆
        statusReq(b, "2083-05", "active", "2083-06").andExpect(jsonPath("$.code").value(0));    // 乙跟着早一个月装
        assertThat(statusChain(b)).containsExactly("2083-05:active");
    }

    // 上线前就叠着的两块同码表:给其中一块标拆除照放(那是在去重),只拦新叠上的月份
    @Test
    void sameCode_alreadyOverlapping_markingOneRemovedAllowed() throws Exception {
        int a = codeMeter("ITK甲", "ITK-0145", "2083-03");
        int b = codeMeter("ITK乙", "ITK-0146", "2083-03");
        com.park.demo3.entity.Meter mb = meterMapper.selectById(b);
        mb.setCode("ITK-0145");
        meterMapper.updateById(mb);   // 绕过接口造叠着的旧档案
        statusReq(a, "2083-09", "removed", null).andExpect(jsonPath("$.code").value(0));
        assertThat(statusChain(a)).containsExactly("2083-03:active", "2083-09:removed");
        assertThat(conflict(statusReq(a, "2083-10", "active", null))).contains("在 2083-10 已有「ITK乙」在册");
    }

    private org.springframework.test.web.servlet.ResultActions codePut(int id, String name, String code) throws Exception {
        return mvc.perform(put("/api/meters/" + id).header("Authorization", auth()).contentType("application/json")
                .content("{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"" + name + "\",\"code\":\"" + code + "\"}"));
    }

    // 撤销导入 / 批删本期删掉导入写的「已拆」行,甲重新在册、与同码的乙叠上 → 409 点名,一格不动
    @Test
    void sameCode_revertOrBatchDeleteReopeningOverlap_409() throws Exception {
        int a = codeMeter("ITK甲", MOVED, "2083-03");
        String batch = batchOf(imp(null, irow("ITK甲", "2083-06", ",\"code\":\"已拆\"")));   // removed@2083-06,前像为空
        codeMeter("ITK乙", MOVED, "2083-06");
        assertThat(conflict(revert(batch))).contains("编码 ITK-0144 在 2083-06 已有「ITK乙」在册");
        assertThat(conflict(batchDel("2083-06", false))).contains("编码 ITK-0144 在 2083-06 已有「ITK乙」在册");
        assertThat(statusChain(a)).containsExactly("2083-03:active", "2083-06:removed");
    }

    // 同码的另一块表那一行也在同一批里一起撤 / 一起删:拿它撤后 / 删后的链比(那一段也没了),不算叠
    @Test
    void sameCode_revertOrBatchDelete_rivalInSameBatchJudgedOnItsNewChain() throws Exception {
        int a = codeMeter("ITK甲", MOVED, "2083-03");
        String batch = batchOf(imp(null, irow("ITK甲", "2083-06", ",\"code\":\"已拆\""),
                irow("ITK乙", "2083-06", ",\"currTotal\":1")));                 // 甲拆、乙按名字新建,同一批
        int b = meterMapper.selectByKey("elec", "p1", "ITK乙").getId();
        codePut(b, "ITK乙", MOVED).andExpect(jsonPath("$.code").value(0));
        revert(batch).andExpect(jsonPath("$.code").value(0));
        assertThat(statusChain(a)).containsExactly("2083-03:active");
        assertThat(statusChain(b)).isEmpty();

        imp(null, irow("ITK甲", "2083-09", ",\"code\":\"已拆\""), irow("ITK丙", "2083-09", ",\"currTotal\":1"));
        int c = meterMapper.selectByKey("elec", "p1", "ITK丙").getId();
        codePut(c, "ITK丙", MOVED).andExpect(jsonPath("$.code").value(0));
        batchDel("2083-09", false).andExpect(jsonPath("$.code").value(0));
        assertThat(statusChain(a)).containsExactly("2083-03:active");
    }

    // 编码只差大小写 / 全半角算同一个(meter.code 的排序规则也这么比):按当月在册认到甲、乙,不误报「已被其他表占用」,
    // 档案里的编码原样不动;库认作同码而导入索引不归的(重音),新建表那条路照查 → 行级错误,不建表
    @Test
    void sameCode_caseAndWidthVariantsAreTheSameCode() throws Exception {
        int[] ab = movedMeter();
        String res = imp(null, irow("IT册行", "2083-04", ",\"code\":\"itk-0144\",\"currTotal\":1"),
                irow("IT册行", "2083-07", ",\"code\":\"ＩＴＫ－０１４４\",\"currTotal\":2"));
        java.util.List<Integer> hit = JsonPath.read(res, "$.data.matches[*].meterId");
        assertThat(hit).containsExactly(ab[0], ab[1]);
        assertThat(reasons(res, "notices")).isEmpty();
        assertThat(meterMapper.selectById(ab[0]).getCode()).isEqualTo(MOVED);
        assertThat(meterMapper.selectById(ab[1]).getCode()).isEqualTo(MOVED);
        String acc = imp(null, irow("IT重音行", "2083-04", ",\"code\":\"ÍTK-0144\",\"currTotal\":1"));
        assertThat(reasons(acc, "errors")).singleElement().asString()
                .isEqualTo("编码 ÍTK-0144 在 2083-04 已有「ITK甲」在册,本行没有导入(读数也没写)");
        assertThat(meterMapper.selectByKey("elec", "p1", "IT重音行")).isNull();
    }

    // 同一批里新表那一行(补在册)排在旧表「已拆」那一行前面:「已拆」行先走,新表照写读数;
    // 报错、提示、认表清单仍按行号排
    @Test
    void sameCode_removedRowLaterInFile_stillFreesTheCode() throws Exception {
        int[] ab = movedMeter();                                                       // 甲 03 ~ 05,乙 06 起
        int f = createMeter("ITK停用表", "1");
        statusReq(f, "2083-02", "retired", null).andExpect(jsonPath("$.code").value(0));
        String bad = "{\"kind\":\"gas\",\"zone\":\"p1\",\"name\":\"ITK坏\",\"ym\":\"2083-04\"";
        String res = imp(null,
                irow("ITK乙", "2083-04", ",\"currTotal\":1"),                            // 0 乙早两个月装上:补在册
                bad + "}",                                                               // 1 行级错误
                irow("ITK停用表", "2083-04", ",\"currTotal\":1"),                         // 2 停用还有读数:提示
                irow("ITK甲", "2083-04", ",\"code\":\"已拆\""),                            // 3 甲这个月拆
                bad + ",\"code\":\"已拆\"}");                                              // 4 行级错误,先走
        java.util.List<Integer> errRows = JsonPath.read(res, "$.data.errors[*].rowIndex");
        java.util.List<Integer> noticeRows = JsonPath.read(res, "$.data.notices[*].rowIndex");
        java.util.List<Integer> hit = JsonPath.read(res, "$.data.matches[*].meterId");
        assertThat(errRows).containsExactly(1, 4);
        assertThat(noticeRows).containsExactly(2, 3);
        assertThat(hit).containsExactly(ab[1], f, ab[0]);
        assertThat(readYms(ab[1])).containsExactly("2083-04");
        assertThat(statusChain(ab[1])).containsExactly("2083-04:active", "2083-06:active");
        assertThat(statusChain(ab[0])).containsExactly("2083-03:active", "2083-04:removed", "2083-06:removed");
    }
}

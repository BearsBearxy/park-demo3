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
                + "{\"kind\":\"elec\",\"zone\":\"p9\",\"name\":\"IT坏分区\",\"ym\":\"2099-05\"},"
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
                .andExpect(jsonPath("$.data.errors[0].reason").value("归属非法(tenant|share|ops|infra)"));
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
    }
}

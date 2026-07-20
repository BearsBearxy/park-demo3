package com.park.demo3.api;

import com.jayway.jsonpath.JsonPath;
import com.park.demo3.AbstractMysqlIT;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// 电费成本模型(ELEC-COST-SPEC):V42 种子锚点、电表 CRUD(删有数据 409)、费项 upsert 拆分口径
// (合计行与拆分行并存照存照返,黄警前端判)、导入行级错误、电价参数回退规则、metrics 缺源 missing。
// @Transactional 回滚不污染共享容器;写数据用 2099 远期槽(模拟填充的 2025 写入在 SimulateIT,同样回滚)。
@AutoConfigureMockMvc
@Transactional
class ElecCostApiIT extends AbstractMysqlIT {

    @Autowired MockMvc mvc;
    private String token;

    @BeforeEach
    void login() throws Exception { token = login("admin", "admin123"); }

    private String login(String user, String pass) throws Exception {
        String body = mvc.perform(post("/api/auth/login").contentType("application/json")
                .content("{\"username\":\"" + user + "\",\"password\":\"" + pass + "\"}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$.data.token");
    }

    private String auth() { return "Bearer " + token; }

    private static String utf8(MvcResult r) {
        return new String(r.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
    }

    private int meterId(String name) throws Exception {
        String body = utf8(mvc.perform(get("/api/elec-cost/meters").header("Authorization", auth())).andReturn());
        List<Integer> ids = JsonPath.read(body, "$.data[?(@.name=='" + name + "')].id");
        return ids.get(0);
    }

    // ── V42 种子:8 表在位(2 master+1 dorm+5 ops,sort 升序);电价参数默认行 0.453 / 0.005 ──
    @Test
    void seed_eightMeters_andDefaultPriceCfg() throws Exception {
        String body = utf8(mvc.perform(get("/api/elec-cost/meters").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.length()").value(8))
                .andExpect(jsonPath("$.data[0].name").value("一期总表"))
                .andExpect(jsonPath("$.data[0].kind").value("master"))
                .andExpect(jsonPath("$.data[1].name").value("二期总表"))
                .andExpect(jsonPath("$.data[2].name").value("宿舍电表"))
                .andExpect(jsonPath("$.data[2].kind").value("dorm"))
                .andExpect(jsonPath("$.data[7].name").value("办公用电"))
                .andExpect(jsonPath("$.data[7].kind").value("ops"))
                .andReturn());
        List<String> kinds = JsonPath.read(body, "$.data[*].kind");
        assertThat(kinds.stream().filter("ops"::equals).count()).isEqualTo(5);

        // 默认行种子:pv_grid_price=0.453 / pf_reward_rate=0.005;公告/执行价两级都缺 → value null
        String cfg = utf8(mvc.perform(get("/api/elec-cost/price-cfg").header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.length()").value(4))
                .andExpect(jsonPath("$.data[?(@.cfgKey=='pv_grid_price')].value").value(0.453))
                .andExpect(jsonPath("$.data[?(@.cfgKey=='pv_grid_price')].source").value("default"))
                .andExpect(jsonPath("$.data[?(@.cfgKey=='pf_reward_rate')].value").value(0.005))
                .andReturn());
        assertThat((List<Object>) JsonPath.read(cfg, "$.data[?(@.cfgKey=='third_party_price')].value"))
                .containsExactly((Object) null);
        assertThat((List<Object>) JsonPath.read(cfg, "$.data[?(@.cfgKey=='grid_posted_price')].value"))
                .containsExactly((Object) null);
    }

    // ── 电表 CRUD:新增/重名 409/编辑/删除;有费项数据删 409、改类型 409 ──
    @Test
    void meter_crud_deleteWithData409_kindChangeWithData409() throws Exception {
        String created = utf8(mvc.perform(post("/api/elec-cost/meters").header("Authorization", auth())
                .contentType("application/json").content("{\"name\":\"测试电表X\",\"kind\":\"ops\"}"))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.kind").value("ops")).andReturn());
        int id = JsonPath.read(created, "$.data.id");

        mvc.perform(post("/api/elec-cost/meters").header("Authorization", auth())
                .contentType("application/json").content("{\"name\":\"测试电表X\",\"kind\":\"dorm\"}"))
                .andExpect(jsonPath("$.code").value(409));

        // 无数据可自由改名/改类
        mvc.perform(put("/api/elec-cost/meters/" + id).header("Authorization", auth())
                .contentType("application/json").content("{\"name\":\"测试电表X改\",\"kind\":\"dorm\"}"))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.kind").value("dorm"));

        // 录一条费项 → 删 409、改类 409;改名仍可
        String entry = utf8(mvc.perform(put("/api/elec-cost/entries").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"meterId\":" + id + ",\"acctMonth\":\"2099-01\",\"feeKey\":\"usage\",\"amount\":100}"))
                .andExpect(jsonPath("$.code").value(0)).andReturn());
        int entryId = JsonPath.read(entry, "$.data.id");
        mvc.perform(delete("/api/elec-cost/meters/" + id).header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(409));
        mvc.perform(put("/api/elec-cost/meters/" + id).header("Authorization", auth())
                .contentType("application/json").content("{\"name\":\"测试电表X改\",\"kind\":\"ops\"}"))
                .andExpect(jsonPath("$.code").value(409));
        mvc.perform(put("/api/elec-cost/meters/" + id).header("Authorization", auth())
                .contentType("application/json").content("{\"name\":\"测试电表X再改\",\"kind\":\"dorm\"}"))
                .andExpect(jsonPath("$.code").value(0));

        // 清数据后可删;再删 404
        mvc.perform(delete("/api/elec-cost/entries/" + entryId).header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(delete("/api/elec-cost/meters/" + id).header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(delete("/api/elec-cost/meters/" + id).header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(404));
    }

    // ── 费项 upsert:同键改值不增行;拆分口径=合计行与拆分行并存照存照返(黄警前端判);值域校验 400 ──
    @Test
    void entry_upsert_splitCoexistsWithTotal_validation() throws Exception {
        int m1 = meterId("一期总表");
        int pump = meterId("水泵房");

        // 合计行(sub 空串归一化)
        String first = utf8(mvc.perform(put("/api/elec-cost/entries").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"meterId\":" + m1 + ",\"acctMonth\":\"2099-01\",\"feeKey\":\"tou_industrial\",\"amount\":1000,\"qty\":2000}"))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.subKey").value(""))
                .andExpect(jsonPath("$.data.source").value("manual")).andReturn());
        int id = JsonPath.read(first, "$.data.id");

        // 同键 upsert:同 id 改值,不增行
        mvc.perform(put("/api/elec-cost/entries").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"meterId\":" + m1 + ",\"acctMonth\":\"2099-01\",\"feeKey\":\"tou_industrial\",\"amount\":1500}"))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.id").value(id))
                .andExpect(jsonPath("$.data.amount").value(1500.0));

        // 拆分行 ×2:与合计行并存,三行照返(拆分Σ 1100 ≠ 合计 1500 → 黄警数据结构=两类行都在,前端判)
        mvc.perform(put("/api/elec-cost/entries").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"meterId\":" + m1 + ",\"acctMonth\":\"2099-01\",\"feeKey\":\"tou_industrial\",\"subKey\":\"bg\",\"amount\":600}"))
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(put("/api/elec-cost/entries").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"meterId\":" + m1 + ",\"acctMonth\":\"2099-01\",\"feeKey\":\"tou_industrial\",\"subKey\":\"t3_industry\",\"amount\":500}"))
                .andExpect(jsonPath("$.code").value(0));
        String list = utf8(mvc.perform(get("/api/elec-cost/entries")
                .param("year", "2099").param("month", "1").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.length()").value(3)).andReturn());
        List<String> subs = JsonPath.read(list, "$.data[*].subKey");
        assertThat(subs).containsExactlyInAnyOrder("", "bg", "t3_industry");

        // 年份数据驱动
        mvc.perform(get("/api/elec-cost/years").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[0]").value(2099));

        // 值域校验:费项不适用类型 / 费项不支持拆分 → 400
        mvc.perform(put("/api/elec-cost/entries").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"meterId\":" + pump + ",\"acctMonth\":\"2099-01\",\"feeKey\":\"tou_industrial\",\"amount\":1}"))
                .andExpect(jsonPath("$.code").value(400));
        mvc.perform(put("/api/elec-cost/entries").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"meterId\":" + m1 + ",\"acctMonth\":\"2099-01\",\"feeKey\":\"pv_grid_income\",\"subKey\":\"bg\",\"amount\":1}"))
                .andExpect(jsonPath("$.code").value(400));
        // 商业拆分值域是 a/t3_chuangye,bg 不合法
        mvc.perform(put("/api/elec-cost/entries").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"meterId\":" + m1 + ",\"acctMonth\":\"2099-01\",\"feeKey\":\"commercial\",\"subKey\":\"bg\",\"amount\":1}"))
                .andExpect(jsonPath("$.code").value(400));

        // 删行:0 → 再删 404
        mvc.perform(delete("/api/elec-cost/entries/" + id).header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(delete("/api/elec-cost/entries/" + id).header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(404));
    }

    // ── 导入:中文费项名映射、(表,月,费项,拆分) upsert 幂等、行级错误跳过不整批拦 ──
    @Test
    void import_labelMapping_rowErrors_idempotent() throws Exception {
        String rows = """
            {"rows":[
              {"meter":"一期总表","fee":"工业分时电价","split":"","month":"2099-03","amount":1111.11,"qty":2222},
              {"meter":"一期总表","fee":"商业用电","split":"A座","month":"2099-03","amount":500},
              {"meter":"宿舍电表","fee":"用电费用","split":"","month":"2099-03","amount":300},
              {"meter":"不存在表","fee":"工业分时电价","split":"","month":"2099-03","amount":1},
              {"meter":"一期总表","fee":"未知费项","split":"","month":"2099-03","amount":1},
              {"meter":"一期总表","fee":"工业分时电价","split":"","month":"2099-13","amount":1}
            ]}""";
        mvc.perform(post("/api/elec-cost/import").header("Authorization", auth())
                .contentType("application/json").content(rows))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.imported").value(3))
                .andExpect(jsonPath("$.data.skipped").value(3))
                .andExpect(jsonPath("$.data.errors.length()").value(3));
        String list = utf8(mvc.perform(get("/api/elec-cost/entries")
                .param("year", "2099").param("month", "3").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.length()").value(3)).andReturn());
        List<String> sources = JsonPath.read(list, "$.data[*].source");
        assertThat(sources).containsOnly("import");
        List<String> subs = JsonPath.read(list, "$.data[?(@.feeKey=='commercial')].subKey");
        assertThat(subs).containsExactly("a");   // 中文拆分名 → sub_key

        // 重导幂等:同键 upsert 覆盖,行数不翻倍
        mvc.perform(post("/api/elec-cost/import").header("Authorization", auth())
                .contentType("application/json").content(rows))
                .andExpect(jsonPath("$.data.imported").value(3));
        mvc.perform(get("/api/elec-cost/entries")
                .param("year", "2099").param("month", "3").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.length()").value(3));
    }

    // ── 电价参数:月度行优先、缺省回退默认、value=null 删行回退;未知键 400 ──
    @Test
    void priceCfg_monthOverridesDefault_nullDeletesFallsBack() throws Exception {
        mvc.perform(put("/api/elec-cost/price-cfg").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"acctMonth\":\"2099-01\",\"cfgKey\":\"pv_grid_price\",\"value\":0.5}"))
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(get("/api/elec-cost/price-cfg").param("acctMonth", "2099-01").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.cfgKey=='pv_grid_price')].value").value(0.5))
                .andExpect(jsonPath("$.data[?(@.cfgKey=='pv_grid_price')].source").value("month"))
                .andExpect(jsonPath("$.data[?(@.cfgKey=='pv_grid_price')].defaultValue").value(0.453));
        // 相邻月无月度行 → 回退默认
        mvc.perform(get("/api/elec-cost/price-cfg").param("acctMonth", "2099-02").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.cfgKey=='pv_grid_price')].value").value(0.453))
                .andExpect(jsonPath("$.data[?(@.cfgKey=='pv_grid_price')].source").value("default"));
        // value=null 删月度行 → 回退默认
        mvc.perform(put("/api/elec-cost/price-cfg").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"acctMonth\":\"2099-01\",\"cfgKey\":\"pv_grid_price\",\"value\":null}"))
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(get("/api/elec-cost/price-cfg").param("acctMonth", "2099-01").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.cfgKey=='pv_grid_price')].value").value(0.453))
                .andExpect(jsonPath("$.data[?(@.cfgKey=='pv_grid_price')].source").value("default"));
        // 未知键 400
        mvc.perform(put("/api/elec-cost/price-cfg").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"cfgKey\":\"bogus_key\",\"value\":1}"))
                .andExpect(jsonPath("$.code").value(400));
    }

    // ── metrics 缺源:空月 7 卡齐全、value=null、missing 指名缺失源;有 ops 数据的月第 6 卡可算 ──
    @Test
    void metrics_missingSources_thenOpsComputable() throws Exception {
        // 2099-05 全空:结构 7 卡,缺源卡 value null + missing 指名
        String body = utf8(mvc.perform(get("/api/elec-cost/metrics")
                .param("year", "2099").param("month", "5").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(7)).andReturn());
        List<String> keys = JsonPath.read(body, "$.data[*].key");
        assertThat(keys).containsExactly("parkElecProfit", "pvInvestIncome", "pvLoss",
                "basicElecProfit", "chargingProfit", "opsElecCost", "sellAgreementPnl");
        assertThat((List<Object>) JsonPath.read(body, "$.data[?(@.key=='parkElecProfit')].value"))
                .containsExactly((Object) null);
        List<String> m1miss = JsonPath.read(body, "$.data[?(@.key=='parkElecProfit')].missing[*]");
        assertThat(m1miss).anyMatch(s -> s.contains("附表10")).anyMatch(s -> s.contains("总表电费"));
        List<String> m5miss = JsonPath.read(body, "$.data[?(@.key=='chargingProfit')].missing[*]");
        assertThat(m5miss).anyMatch(s -> s.contains("第三方售电执行电价"));
        List<String> m7miss = JsonPath.read(body, "$.data[?(@.key=='sellAgreementPnl')].missing[*]");
        assertThat(m7miss).anyMatch(s -> s.contains("公告电价")).anyMatch(s -> s.contains("附表11"));

        // 2099-07 录 ops 费用/分摊 → 第 6 卡 value=1000−400=600,missing 清空
        int pump = meterId("水泵房");
        mvc.perform(put("/api/elec-cost/entries").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"meterId\":" + pump + ",\"acctMonth\":\"2099-07\",\"feeKey\":\"usage\",\"amount\":1000}"))
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(put("/api/elec-cost/entries").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"meterId\":" + pump + ",\"acctMonth\":\"2099-07\",\"feeKey\":\"allocated\",\"amount\":400}"))
                .andExpect(jsonPath("$.code").value(0));
        String after = utf8(mvc.perform(get("/api/elec-cost/metrics")
                .param("year", "2099").param("month", "7").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.key=='opsElecCost')].value").value(600.0))
                .andReturn());
        assertThat((List<String>) JsonPath.read(after, "$.data[?(@.key=='opsElecCost')].missing[*]")).isEmpty();
    }

    // ── ENERGY-ANALYSIS §4 metrics-year:12 元素月序 1..12×7 卡;抽样月(空月+有数据月)与单月端点全等
    //    (同一计算体);单月端点 month 必填历史行为回归 400 ──
    @Test
    void metricsYear_twelveMonths_sampleEqualsSingleMonth() throws Exception {
        // 2099-07 录 ops 费用/分摊 → 第 6 卡可算(同 metrics 单月测试口径)
        int pump = meterId("水泵房");
        mvc.perform(put("/api/elec-cost/entries").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"meterId\":" + pump + ",\"acctMonth\":\"2099-07\",\"feeKey\":\"usage\",\"amount\":1000}"))
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(put("/api/elec-cost/entries").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"meterId\":" + pump + ",\"acctMonth\":\"2099-07\",\"feeKey\":\"allocated\",\"amount\":400}"))
                .andExpect(jsonPath("$.code").value(0));

        String yearBody = utf8(mvc.perform(get("/api/elec-cost/metrics-year")
                .param("year", "2099").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.length()").value(12))
                .andExpect(jsonPath("$.data[0].month").value(1))
                .andExpect(jsonPath("$.data[11].month").value(12))
                .andExpect(jsonPath("$.data[6].metrics.length()").value(7))
                .andExpect(jsonPath("$.data[6].metrics[?(@.key=='opsElecCost')].value").value(600.0))
                .andReturn());

        // 抽样全等:空月(5)与有数据月(7)整卡逐字段与单月端点一致
        for (int m : new int[]{5, 7}) {
            String monthBody = utf8(mvc.perform(get("/api/elec-cost/metrics")
                    .param("year", "2099").param("month", String.valueOf(m)).header("Authorization", auth()))
                    .andExpect(jsonPath("$.code").value(0)).andReturn());
            assertThat((Object) JsonPath.read(yearBody, "$.data[" + (m - 1) + "].metrics"))
                    .isEqualTo(JsonPath.read(monthBody, "$.data"));
        }

        // month 必填历史行为:单月端点缺 month 仍 400;metrics-year 缺 year 400
        mvc.perform(get("/api/elec-cost/metrics").param("year", "2099").header("Authorization", auth()))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/api/elec-cost/metrics-year").header("Authorization", auth()))
                .andExpect(status().isBadRequest());
    }

    // ── 角色门:viewer 可读不可写;无 token 401(SecurityConfig 统一门) ──
    @Test
    void viewerReadOk_writeForbidden_noToken401() throws Exception {
        String viewer = login("viewer", "viewer123");
        mvc.perform(get("/api/elec-cost/meters").header("Authorization", "Bearer " + viewer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(post("/api/elec-cost/simulate").param("year", "2025")
                .header("Authorization", "Bearer " + viewer))
                .andExpect(status().isForbidden());
        mvc.perform(put("/api/elec-cost/entries").header("Authorization", "Bearer " + viewer)
                .contentType("application/json")
                .content("{\"meterId\":1,\"acctMonth\":\"2099-01\",\"feeKey\":\"tou_industrial\",\"amount\":1}"))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/elec-cost/meters")).andExpect(status().isUnauthorized());
    }
}

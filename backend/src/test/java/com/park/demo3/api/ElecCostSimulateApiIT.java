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

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// 模拟填充(ELEC-COST-SPEC §5):种子附表11/6/13 推导锚点、幂等(第二跑 filled=0)、绝不覆盖 manual、
// 手工覆盖 simulated 后 source 翻 manual 且再模拟不回写;售电双价参数月度行;metrics 用模拟数据可算。
// 锚点均为 V11/V7/V15 种子的手算值(2025-01):
//   一期 tou=Σp1能量(大工业)qty×price=102815.15  商业=Σp3(一般工商业)=28151.95  基本=1250×32=40000
//   二期 tou=80784.47 基本=32000  pf奖励=(tou+基本+商业)×0.005  pv上网=45520×0.453=20620.56
//   办公用电=3072×0.8123=2495.39(附13);种子无居民生活行 → dorm_usage 计 0。
// @Transactional 回滚:simulate 写入的 2025 行不落共享容器。
@AutoConfigureMockMvc
@Transactional
class ElecCostSimulateApiIT extends AbstractMysqlIT {

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

    private static String utf8(MvcResult r) {
        return new String(r.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
    }

    private String entriesOf(int year, int month) throws Exception {
        return utf8(mvc.perform(get("/api/elec-cost/entries")
                .param("year", String.valueOf(year)).param("month", String.valueOf(month))
                .header("Authorization", auth())).andExpect(status().isOk()).andReturn());
    }

    private static double amountOf(String body, String meter, String feeKey) {
        List<Double> v = JsonPath.read(body,
            "$.data[?(@.meterName=='" + meter + "' && @.feeKey=='" + feeKey + "')].amount");
        assertThat(v).hasSize(1);
        return v.get(0);
    }

    // ── 推导锚点 + 幂等:首跑 filled=247(byRule 分解),第二跑 filled=0 ──
    @Test
    void simulate_seedAnchors_idempotentSecondRunFillsZero() throws Exception {
        String first = utf8(mvc.perform(post("/api/elec-cost/simulate").param("year", "2025")
                .header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                // tou/basic 各 12月×2表;商业=p3 全年 12;种子无居民生活 → dorm 0;
                // pv上网:一期12+二期7(6-12月,p3 12月并入一期同月);pf 24;ops=12月×(办公2+4表×2)=120;售电双价 12月×2=24
                .andExpect(jsonPath("$.data.byRule.tou_industrial").value(24))
                .andExpect(jsonPath("$.data.byRule.basic_industrial").value(24))
                .andExpect(jsonPath("$.data.byRule.commercial").value(12))
                .andExpect(jsonPath("$.data.byRule.dorm_usage").value(0))
                .andExpect(jsonPath("$.data.byRule.pv_grid_income").value(19))
                .andExpect(jsonPath("$.data.byRule.pf_reward").value(24))
                .andExpect(jsonPath("$.data.byRule.ops").value(120))
                .andExpect(jsonPath("$.data.byRule.sell_price").value(24))
                .andExpect(jsonPath("$.data.filled").value(247))
                .andReturn());
        assertThat((Integer) JsonPath.read(first, "$.data.skipped")).isZero();

        // 2025-01 锚点(手算种子值);note 带推导来源;source 全 simulated
        String jan = entriesOf(2025, 1);
        assertThat(amountOf(jan, "一期总表", "tou_industrial")).isEqualTo(102815.15);
        assertThat(amountOf(jan, "一期总表", "basic_industrial")).isEqualTo(40000.00);
        assertThat(amountOf(jan, "一期总表", "commercial")).isEqualTo(28151.95);
        assertThat(amountOf(jan, "一期总表", "pv_grid_income")).isEqualTo(20620.56);   // 45520×0.453
        assertThat(amountOf(jan, "一期总表", "pf_reward")).isEqualTo(854.84);          // 170967.10×0.005
        assertThat(amountOf(jan, "二期总表", "tou_industrial")).isEqualTo(80784.47);
        assertThat(amountOf(jan, "二期总表", "basic_industrial")).isEqualTo(32000.00);
        assertThat(amountOf(jan, "二期总表", "pf_reward")).isEqualTo(563.92);          // 112784.47×0.005
        assertThat(amountOf(jan, "办公用电", "usage")).isEqualTo(2495.39);             // 3072×0.8123
        assertThat(amountOf(jan, "办公用电", "allocated")).isEqualTo(1247.70);         // ×50% 假设
        assertThat(amountOf(jan, "水泵房", "usage")).isEqualTo(1996.31);               // 办公×0.8 假设
        List<String> sources = JsonPath.read(jan, "$.data[*].source");
        assertThat(sources).containsOnly("simulated");
        List<String> notes = JsonPath.read(jan, "$.data[*].note");
        assertThat(notes).allMatch(n -> n != null && n.startsWith("模拟:"));

        // p3 光伏 2025-12 并入一期同月:(47920+2040)×0.453=22631.88
        assertThat(amountOf(entriesOf(2025, 12), "一期总表", "pv_grid_income")).isEqualTo(22631.88);

        // 售电双价:月度行已插,公告价=执行价+0.02(执行价=附表11 实际均价)
        String cfg = utf8(mvc.perform(get("/api/elec-cost/price-cfg").param("acctMonth", "2025-01")
                .header("Authorization", auth())).andReturn());
        List<Double> third = JsonPath.read(cfg, "$.data[?(@.cfgKey=='third_party_price')].value");
        List<Double> posted = JsonPath.read(cfg, "$.data[?(@.cfgKey=='grid_posted_price')].value");
        List<String> srcs = JsonPath.read(cfg, "$.data[?(@.cfgKey=='third_party_price')].source");
        assertThat(srcs).containsExactly("month");
        assertThat(BigDecimal.valueOf(posted.get(0)).subtract(BigDecimal.valueOf(third.get(0))).doubleValue())
                .isCloseTo(0.02, org.assertj.core.data.Offset.offset(1e-9));

        // 年份数据驱动:模拟写入后 years=[2025]
        mvc.perform(get("/api/elec-cost/years").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0]").value(2025));

        // 幂等:第二跑 filled=0,skipped=247
        mvc.perform(post("/api/elec-cost/simulate").param("year", "2025").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.filled").value(0))
                .andExpect(jsonPath("$.data.skipped").value(247));
    }

    // ── 绝不覆盖 manual:先手录 → 模拟跳过该位;模拟后手工覆盖 → source 翻 manual 且再模拟不回写 ──
    @Test
    void simulate_neverOverwritesManual_manualEditFlipsSource() throws Exception {
        // 预置 manual 行占住 (一期总表, 2025-02, tou_industrial)
        String meters = utf8(mvc.perform(get("/api/elec-cost/meters").header("Authorization", auth())).andReturn());
        int m1 = ((List<Integer>) JsonPath.read(meters, "$.data[?(@.name=='一期总表')].id")).get(0);
        mvc.perform(put("/api/elec-cost/entries").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"meterId\":" + m1 + ",\"acctMonth\":\"2025-02\",\"feeKey\":\"tou_industrial\",\"amount\":123.45}"))
                .andExpect(jsonPath("$.code").value(0));

        // 首跑:manual 占位被跳过 → filled=246, skipped=1
        mvc.perform(post("/api/elec-cost/simulate").param("year", "2025").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.filled").value(246))
                .andExpect(jsonPath("$.data.skipped").value(1));
        String feb = entriesOf(2025, 2);
        List<Double> amt = JsonPath.read(feb, "$.data[?(@.meterName=='一期总表' && @.feeKey=='tou_industrial')].amount");
        List<String> src = JsonPath.read(feb, "$.data[?(@.meterName=='一期总表' && @.feeKey=='tou_industrial')].source");
        assertThat(amt).containsExactly(123.45);
        assertThat(src).containsExactly("manual");

        // 手工覆盖一条 simulated(pf_reward)→ source 翻 manual(真实替换模拟,永不混淆)
        mvc.perform(put("/api/elec-cost/entries").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"meterId\":" + m1 + ",\"acctMonth\":\"2025-02\",\"feeKey\":\"pf_reward\",\"amount\":999}"))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.source").value("manual"));

        // 再模拟:两处 manual 占位都不回写(filled=0, skipped=247)
        mvc.perform(post("/api/elec-cost/simulate").param("year", "2025").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.filled").value(0))
                .andExpect(jsonPath("$.data.skipped").value(247));
        String after = entriesOf(2025, 2);
        List<Double> pf = JsonPath.read(after, "$.data[?(@.meterName=='一期总表' && @.feeKey=='pf_reward')].amount");
        assertThat(pf).containsExactly(999.0);
    }

    // ── metrics 消费模拟数据:第 6/7 卡可算(种子锚点),缺分栋抄表的第 2/3 卡 missing ──
    @Test
    void metrics_computableFromSimulatedData() throws Exception {
        mvc.perform(post("/api/elec-cost/simulate").param("year", "2025").header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0));
        String body = utf8(mvc.perform(get("/api/elec-cost/metrics")
                .param("year", "2025").param("month", "1").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(7)).andReturn());

        // 6 经营性用电费用 = ops usage Σ 7236.63 − allocated Σ 3618.33 = 3618.30(种子附13 推导锚点)
        List<Double> ops = JsonPath.read(body, "$.data[?(@.key=='opsElecCost')].value");
        assertThat(ops).containsExactly(3618.30);

        // 7 售电协议损益 = 0.02 × 当月购电量 318320(种子 Σqty) = 6366.40
        List<Double> sell = JsonPath.read(body, "$.data[?(@.key=='sellAgreementPnl')].value");
        assertThat(sell).containsExactly(6366.40);

        // 2/3 依赖光伏分栋抄表(无记录)→ value null + missing 指名
        assertThat((List<Object>) JsonPath.read(body, "$.data[?(@.key=='pvLoss')].value"))
                .containsExactly((Object) null);
        List<String> miss = JsonPath.read(body, "$.data[?(@.key=='pvInvestIncome')].missing[*]");
        assertThat(miss).anyMatch(s -> s.contains("分栋抄表"));
    }
}

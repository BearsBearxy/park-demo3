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

// 光伏模拟填充(PV-METER simulate):附表6 真实 phase 月度汇总(pv_record)推导分栋抄表明细——
// a) 补站配置只填空位:容量=年消纳(self+grid)÷950h×站内假设比例(一期 B0.25/C、D0.3/E·F·G各0.15)round1,
//    单价=年自消纳均价 self_amt÷self_kwh round4;已有值的站不动。
// b) 逐月按容量占比拆 self/grid(round2,末站补差保 Σ=真实值);再整月逐日拆分:
//    日权重=确定性伪随机(seed=站id×100000+年×100+月)晴雨波动 0.55~1.45,self_d=月量×(w_d/Σw) round2 末日补差,
//    gen_d=(self_d+grid_d)×1.03 round2 末日以 月gen(=月消纳×1.03)−Σ前日 补差;price_snap=写入时站单价。
// 幂等(确定性权重 → 二跑 filled=0);该站该月含任何 manual/import 行 → 整月跳过;缺站记 skipped 不报错。
// 2099 远期槽 + @Transactional 回滚,不污染共享容器;pv_station 种子容量/单价全空(V36)。
@AutoConfigureMockMvc
@Transactional
class PvMeterSimulateApiIT extends AbstractMysqlIT {

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

    // 造附表6 phase 月度汇总行(simulate 的推导源)
    private void pvRecord(String phase, String month, String selfKwh, String selfAmt, String gridKwh, String gridAmt) throws Exception {
        mvc.perform(post("/api/pv/records").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"phase\":\"" + phase + "\",\"acctMonth\":\"" + month + "\",\"occurMonth\":\"" + month
                        + "\",\"selfKwh\":" + selfKwh + ",\"selfAmt\":" + selfAmt
                        + ",\"gridKwh\":" + gridKwh + ",\"gridAmt\":" + gridAmt + "}"))
                .andExpect(jsonPath("$.code").value(0));
    }

    private String stationsBody() throws Exception {
        return utf8(mvc.perform(get("/api/pv-meter/stations").header("Authorization", auth()))
                .andExpect(status().isOk()).andReturn());
    }

    private String readingsOf(int year, int month) throws Exception {
        return utf8(mvc.perform(get("/api/pv-meter/readings")
                .param("year", String.valueOf(year)).param("month", String.valueOf(month))
                .header("Authorization", auth())).andExpect(status().isOk()).andReturn());
    }

    private static double one(String body, String path) {
        List<Double> v = JsonPath.read(body, path);
        assertThat(v).hasSize(1);
        return v.get(0);
    }

    private static double sum(String body, String path) {
        List<Number> v = JsonPath.read(body, path);
        return v.stream().mapToDouble(Number::doubleValue).sum();
    }

    // ── 容量/单价反推 + 容量占比拆站 + 整月日拆恒等 + 幂等:p1 两月(31+28 天)→ 5 配置+295 日记录;二跑 filled=0 ──
    @Test
    void simulate_fillsConfigAndSplitsDailyWithMonthIdentity_idempotent() throws Exception {
        // 年消纳合计 = 100000+50000+1000.01+999.99 = 152000 → B座容量 152000×0.25/950 = 40.0(C、D 48.0,E/F/G 24.0)
        // 年自消纳均价 = 65650/101000.01 = 0.6500
        pvRecord("p1", "2099-01", "100000", "65000", "50000", "22650");
        pvRecord("p1", "2099-02", "1000.01", "650", "999.99", "453");

        // 首跑:5 站配置(容量+单价空位) + 5 站×(31+28)日记录 = 300(2099 非闰年)
        mvc.perform(post("/api/pv-meter/simulate").param("year", "2099").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.filled").value(300))
                .andExpect(jsonPath("$.data.skipped").value(0));

        // 站配置:容量=年消纳÷950h×假设比例 round1;单价=年自消纳均价 round4
        String st = stationsBody();
        assertThat(one(st, "$.data[?(@.name=='B座')].capacityKwp")).isEqualTo(40.0);
        assertThat(one(st, "$.data[?(@.name=='C、D座')].capacityKwp")).isEqualTo(48.0);
        assertThat(one(st, "$.data[?(@.name=='G座')].capacityKwp")).isEqualTo(24.0);
        assertThat(one(st, "$.data[?(@.name=='B座')].priceYuan")).isEqualTo(0.65);
        assertThat(one(st, "$.data[?(@.name=='G座')].priceYuan")).isEqualTo(0.65);

        // 1 月 B座:capSum=160 占 0.25 → 月 self 25000/grid 12500;日拆 31 条(1 日~31 日),Σ日=月真实值分毫不差,
        // Σgen=月消纳×1.03(末日补差恒等)
        String rd1 = readingsOf(2099, 1);
        List<String> dates = JsonPath.read(rd1, "$.data[?(@.stationName=='B座')].readDate");
        assertThat(dates).hasSize(31).doesNotHaveDuplicates();
        assertThat(dates.get(0)).isEqualTo("2099-01-01");
        assertThat(dates.get(30)).isEqualTo("2099-01-31");
        assertThat(sum(rd1, "$.data[?(@.stationName=='B座')].selfUse"))
                .isCloseTo(25000.00, org.assertj.core.data.Offset.offset(1e-6));
        assertThat(sum(rd1, "$.data[?(@.stationName=='B座')].gridFeed"))
                .isCloseTo(12500.00, org.assertj.core.data.Offset.offset(1e-6));
        assertThat(sum(rd1, "$.data[?(@.stationName=='B座')].genTotal"))
                .isCloseTo(38625.00, org.assertj.core.data.Offset.offset(1e-6));   // 37500×1.03
        // 日权重晴雨波动:31 天并非均摊(至少两种取值)
        List<Number> bSelfs = JsonPath.read(rd1, "$.data[?(@.stationName=='B座')].selfUse");
        assertThat(bSelfs.stream().map(Number::doubleValue).distinct().count()).isGreaterThan(1);
        // price_snap 快照 + 收益派生 self_d×0.65(取 1 月 1 日抽查)
        List<Number> snaps = JsonPath.read(rd1, "$.data[?(@.stationName=='B座')].priceSnap");
        assertThat(snaps.stream().map(Number::doubleValue)).containsOnly(0.65);
        double s0 = one(rd1, "$.data[?(@.stationName=='B座' && @.readDate=='2099-01-01')].selfUse");
        double rev0 = one(rd1, "$.data[?(@.stationName=='B座' && @.readDate=='2099-01-01')].revenue");
        assertThat(rev0).isCloseTo(s0 * 0.65, org.assertj.core.data.Offset.offset(0.006));
        // Σ全站日 self = phase 真实月量(站级末站补差 + 日级末日补差链式恒等)
        List<Number> selfs1 = JsonPath.read(rd1, "$.data[*].selfUse");
        assertThat(selfs1).hasSize(155);   // 5 站×31 日
        assertThat(sum(rd1, "$.data[*].selfUse"))
                .isCloseTo(100000.00, org.assertj.core.data.Offset.offset(1e-6));
        // source 全 simulated,note 带推导来源/日拆声明/假设声明
        List<String> sources = JsonPath.read(rd1, "$.data[*].source");
        assertThat(sources).hasSize(155).containsOnly("simulated");
        List<String> notes = JsonPath.read(rd1, "$.data[*].note");
        assertThat(notes).allMatch(n -> n != null && n.startsWith("模拟:附表6 p1 2099-01")
                && n.contains("日拆(日照波动权重)") && n.contains("容量比例/损耗3%假设"));

        // 2 月零头:末站 G座 月 self=1000.01−850=150.01,grid=149.99;28 日拆后 Σ 恒等,Σgen=300×1.03=309
        String rd2 = readingsOf(2099, 2);
        List<String> gDates = JsonPath.read(rd2, "$.data[?(@.stationName=='G座')].readDate");
        assertThat(gDates).hasSize(28);
        assertThat(sum(rd2, "$.data[?(@.stationName=='G座')].selfUse"))
                .isCloseTo(150.01, org.assertj.core.data.Offset.offset(1e-6));
        assertThat(sum(rd2, "$.data[?(@.stationName=='G座')].gridFeed"))
                .isCloseTo(149.99, org.assertj.core.data.Offset.offset(1e-6));
        assertThat(sum(rd2, "$.data[?(@.stationName=='G座')].genTotal"))
                .isCloseTo(309.00, org.assertj.core.data.Offset.offset(1e-6));
        assertThat(sum(rd2, "$.data[*].selfUse"))
                .isCloseTo(1000.01, org.assertj.core.data.Offset.offset(1e-6));

        // 幂等:第二跑 filled=0(配置已有值不动;确定性权重 → 295 条日记录值未变 = skipped 295)
        mvc.perform(post("/api/pv-meter/simulate").param("year", "2099").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.filled").value(0))
                .andExpect(jsonPath("$.data.skipped").value(295));

        // 手工改写某日 simulated → source 翻 manual(真实替换模拟),再模拟该站该月整月跳过(skipped=1+4×31+5×28=265)
        int id = ((List<Integer>) JsonPath.read(rd1, "$.data[?(@.stationName=='B座' && @.readDate=='2099-01-15')].id")).get(0);
        int stId = ((List<Integer>) JsonPath.read(rd1, "$.data[?(@.stationName=='B座' && @.readDate=='2099-01-15')].stationId")).get(0);
        mvc.perform(put("/api/pv-meter/readings/" + id).header("Authorization", auth())
                .contentType("application/json")
                .content("{\"stationId\":" + stId + ",\"readDate\":\"2099-01-15\",\"genTotal\":999,\"selfUse\":999,\"gridFeed\":0}"))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.source").value("manual"));
        mvc.perform(post("/api/pv-meter/simulate").param("year", "2099").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.filled").value(0))
                .andExpect(jsonPath("$.data.skipped").value(265));
        String rd3 = readingsOf(2099, 1);
        assertThat(one(rd3, "$.data[?(@.stationName=='B座' && @.readDate=='2099-01-15')].selfUse")).isEqualTo(999.00);
        List<String> bSources = JsonPath.read(rd3, "$.data[?(@.stationName=='B座')].source");
        assertThat(bSources).hasSize(31);   // 整月跳过=既有日记录原样,manual 1 条 + simulated 30 条
        assertThat(bSources.stream().filter("manual"::equals)).hasSize(1);
    }

    // ── 绝不覆盖:某日 manual 行 → 该站该月整月跳过(不产生任何 simulated 补日);已配值的站配置 simulate 不动 ──
    @Test
    void simulate_manualRowSkipsWholeMonthAndPresetStationConfigUntouched() throws Exception {
        String st = stationsBody();
        int b = ((List<Integer>) JsonPath.read(st, "$.data[?(@.name=='B座')].id")).get(0);
        int cd = ((List<Integer>) JsonPath.read(st, "$.data[?(@.name=='C、D座')].id")).get(0);
        // 预置:B座 某日 manual 记录(月中任意一日即触发整月保护);C、D座 容量/单价已配(用户真实值)
        mvc.perform(post("/api/pv-meter/readings").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"stationId\":" + b + ",\"readDate\":\"2099-01-15\",\"genTotal\":1,\"selfUse\":111,\"gridFeed\":2}"))
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(put("/api/pv-meter/stations/" + cd).header("Authorization", auth())
                .contentType("application/json")
                .content("{\"name\":\"C、D座\",\"phase\":1,\"capacityKwp\":100,\"priceYuan\":0.8}"))
                .andExpect(jsonPath("$.code").value(0));
        pvRecord("p1", "2099-01", "100000", "65000", "50000", "22650");

        // filled = 4 站配置(B/E/F/G) + 4 站×31 日记录(C、D/E/F/G)= 128;skipped = 1(B座 整月)
        mvc.perform(post("/api/pv-meter/simulate").param("year", "2099").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.filled").value(128))
                .andExpect(jsonPath("$.data.skipped").value(1));

        // B座 整月只剩那条 manual 原样(不补其余 30 日);C、D座 配置原样,其 31 条日记录 price_snap=0.8(预置价快照)
        String rd = readingsOf(2099, 1);
        assertThat(one(rd, "$.data[?(@.stationName=='B座')].selfUse")).isEqualTo(111.00);
        List<String> src = JsonPath.read(rd, "$.data[?(@.stationName=='B座')].source");
        assertThat(src).containsExactly("manual");
        String st2 = stationsBody();
        assertThat(one(st2, "$.data[?(@.name=='C、D座')].capacityKwp")).isEqualTo(100.0);
        assertThat(one(st2, "$.data[?(@.name=='C、D座')].priceYuan")).isEqualTo(0.8);
        List<Number> cdSnaps = JsonPath.read(rd, "$.data[?(@.stationName=='C、D座')].priceSnap");
        assertThat(cdSnaps).hasSize(31);
        assertThat(cdSnaps.stream().map(Number::doubleValue)).containsOnly(0.8);
    }

    // ── 缺站(该期电站被删光)记 skipped 不报错,不产生任何记录 ──
    @Test
    void simulate_missingPhaseStationsCountsSkippedNoError() throws Exception {
        String st = stationsBody();
        for (String name : new String[]{"创业大厦", "工业大厦"}) {
            int id = ((List<Integer>) JsonPath.read(st, "$.data[?(@.name=='" + name + "')].id")).get(0);
            mvc.perform(delete("/api/pv-meter/stations/" + id).header("Authorization", auth()))
                    .andExpect(jsonPath("$.code").value(0));
        }
        pvRecord("p3", "2099-03", "100", "65", "50", "22");

        mvc.perform(post("/api/pv-meter/simulate").param("year", "2099").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.filled").value(0))
                .andExpect(jsonPath("$.data.skipped").value(1));
        List<Object> rows = JsonPath.read(readingsOf(2099, 3), "$.data[*]");
        assertThat(rows).isEmpty();
    }
}

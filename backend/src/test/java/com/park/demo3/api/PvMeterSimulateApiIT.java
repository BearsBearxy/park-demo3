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
import java.util.Collections;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// 光伏模拟填充(PV-METER simulate):附表6 真实 phase 月度汇总(pv_record)推导分栋抄表明细——
// a) 补站配置只填空位:容量=年消纳(self+grid)÷950h×站内假设比例(一期 B0.25/C、D0.3/E·F·G各0.15)round1,
//    单价=年自消纳均价 self_amt÷self_kwh round4;已有值的站不动。
// b) 逐月按**容量×逐栋先天水平(±8%,确定性)**拆 self/grid(round2,末站补差保 Σ=真实值);再整月逐日拆分:
//    日权重=确定性伪随机(seed=站id×100000+年×100+月)晴雨波动 0.55~1.45,self_d=月量×(w_d/Σw) round2 末日补差,
//    gen_d=(self_d+grid_d)×**逐栋逐季损耗系数**(2.5~5.7%)round2 末日补差;price_snap=写入时站单价。
// 拆分权重不含 siteEff 的话每栋严格正比于容量 → 等效小时全园一个数;损耗写死 1.03 的话 loss% ≡ 2.913%
// 十二个月不变。两者都让分析屏上对应的通道按构造失去信息,所以这里钉的是**恒等式 + 差异存在**,
// 不再钉某一站的精确拆分值(那正是被换掉的那条规则)。
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
        // self : grid 的比例照抄 phase 真实值(2:1),不受先天水平影响 —— 权重同乘分子分母对消
        double bSelf = sum(rd1, "$.data[?(@.stationName=='B座')].selfUse");
        double bGrid = sum(rd1, "$.data[?(@.stationName=='B座')].gridFeed");
        double bGen  = sum(rd1, "$.data[?(@.stationName=='B座')].genTotal");
        assertThat(bSelf / bGrid).isCloseTo(2.0, org.assertj.core.data.Offset.offset(1e-3));
        // 拆到 B座 的份额**不等于**纯容量占比 0.25 —— 先天水平真的动了它(不动就是没接上)
        assertThat(bSelf / 100000.0).isNotCloseTo(0.25, org.assertj.core.data.Offset.offset(1e-4));
        assertThat(bSelf / 100000.0).isBetween(0.20, 0.30);
        // 损耗率落在逐栋逐季区间内(1 月非夏季 → 2.5%~4.5%)
        assertThat(bGen / (bSelf + bGrid)).isBetween(1.025, 1.045);
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
                && n.contains("日拆(日照波动权重)") && n.contains("逐栋先天水平"));

        // **新性质:各栋不再一个样。** 这两条一红就说明 siteEff / genFactor 没接上,
        // 「各站发电效率」与「损耗率」两条通道会退回按构造零信息
        var yields = new java.util.ArrayList<Double>();
        var losses = new java.util.ArrayList<Double>();
        for (String n : List.of("B座", "C、D座", "E座", "F座", "G座")) {
            double sf = sum(rd1, "$.data[?(@.stationName=='" + n + "')].selfUse");
            double gf = sum(rd1, "$.data[?(@.stationName=='" + n + "')].gridFeed");
            double gn = sum(rd1, "$.data[?(@.stationName=='" + n + "')].genTotal");
            double cap = one(st, "$.data[?(@.name=='" + n + "')].capacityKwp");
            yields.add(gn / cap);            // 等效小时 —— 全同就是排名图那堵齐平的墙
            losses.add(gn / (sf + gf));      // 损耗系数 —— 全同就是那条水平直线
        }
        assertThat(java.util.Set.copyOf(yields)).hasSizeGreaterThan(1);
        assertThat(Collections.max(yields) / Collections.min(yields)).isGreaterThan(1.05);
        // **判跨度不判「不全等」**:末日补差的浮点尾数天然让它们不全等,
        // Set.size()>1 测的是舍入噪声不是设计性质(破坏验证时这条没咬住 = 假绿)。
        // 真实跨度 2.63%~5.70% ⇒ 比值 ≈1.030;写死 1.03 时比值 ≈1.000
        assertThat(Collections.max(losses) / Collections.min(losses)).isGreaterThan(1.01);

        // 2 月零头:末站 G座 月 self=1000.01−850=150.01,grid=149.99;28 日拆后 Σ 恒等,Σgen=300×1.03=309
        String rd2 = readingsOf(2099, 2);
        List<String> gDates = JsonPath.read(rd2, "$.data[?(@.stationName=='G座')].readDate");
        assertThat(gDates).hasSize(28);
        // G座 是末站,吃站级补差 —— 拆分规则变了它的份额就变,这里钉的是「Σ 恒等」不是它的具体值。
        // 零头 1000.01/999.99 全部落到它身上,所以 Σ全站 仍分毫不差(见下)
        double gSelf = sum(rd2, "$.data[?(@.stationName=='G座')].selfUse");
        double gGrid = sum(rd2, "$.data[?(@.stationName=='G座')].gridFeed");
        assertThat(gSelf).isGreaterThan(0);
        assertThat(gGrid).isGreaterThan(0);
        assertThat(sum(rd2, "$.data[?(@.stationName=='G座')].genTotal") / (gSelf + gGrid))
                .isBetween(1.025, 1.045);
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

    // ══ 检测信号(PV-ANALYSIS-SPEC §08):不满足这两条,分栋分析屏永远显示「全部正常」——
    //    一块**无法区分「真没事」和「算错了」**的绿。 ══════════════════════════════

    /** 取某站某月的逐日 genTotal(按日期升序) */
    private List<Double> dailyGen(int year, int month, String station) throws Exception {
        List<Number> v = JsonPath.read(readingsOf(year, month), "$.data[?(@.stationName=='" + station + "')].genTotal");
        return v.stream().map(Number::doubleValue).toList();
    }

    private static double pearson(List<Double> a, List<Double> b) {
        int n = Math.min(a.size(), b.size());
        double ma = a.stream().limit(n).mapToDouble(d -> d).average().orElse(0);
        double mb = b.stream().limit(n).mapToDouble(d -> d).average().orElse(0);
        double cov = 0, va = 0, vb = 0;
        for (int i = 0; i < n; i++) {
            double da = a.get(i) - ma, db = b.get(i) - mb;
            cov += da * db; va += da * da; vb += db * db;
        }
        return cov / Math.sqrt(va * vb);
    }

    // ① 全园共享天气因子 β(d):同期两站的逐日出力必须**同涨同落**。
    //    日权重种子若含站 id(改造前),每站各晒各的太阳 → 相关系数 ≈ 0 → 抛光算不出 β(d),
    //    残差退化成纯独立噪声,任何检验都通不过,工作台的残差 ACF 也画不出东西(§08 验收 ④)。
    @Test
    void simulate_同期两站逐日出力强相关_说明有共享天气因子() throws Exception {
        pvRecord("p1", "2099-06", "30000", "19500", "15000", "6795");

        mvc.perform(post("/api/pv-meter/simulate").param("year", "2099").header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0));

        List<Double> b = dailyGen(2099, 6, "B座");
        List<Double> e = dailyGen(2099, 6, "E座");
        assertThat(b).hasSize(30);
        assertThat(e).hasSize(30);
        assertThat(pearson(b, e)).isGreaterThan(0.5);
    }

    // ② 种入故障必须**持续存在**,不能被月度恒等吃掉。
    //    只把日权重 w[d] 乘 0.72 是不够的:self_d = 月量 × w_d/Σw,整月同乘一个数分子分母对消,
    //    8 月往后完全看不见。故障必须打在**站间拆分权重**上(F座少拿、同期其余站分掉),
    //    这样 Σ全站 仍等于 phase 月真实值(月度恒等不破),而 F座的相对水平真的掉下来了。
    //    用「F座 ÷ B座」而不是 F座绝对值:两站容量固定,这个比值把年度总量、容量反推全约掉了。
    @Test
    void simulate_种入的F座阶跃在故障后的整月里持续可见() throws Exception {
        pvRecord("p1", "2099-06", "30000", "19500", "15000", "6795");   // 故障前
        pvRecord("p1", "2099-08", "30000", "19500", "15000", "6795");   // 故障后(整月)

        mvc.perform(post("/api/pv-meter/simulate").param("year", "2099").header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0));

        double fJun = sum(readingsOf(2099, 6), "$.data[?(@.stationName=='F座')].genTotal");
        double bJun = sum(readingsOf(2099, 6), "$.data[?(@.stationName=='B座')].genTotal");
        double fAug = sum(readingsOf(2099, 8), "$.data[?(@.stationName=='F座')].genTotal");
        double bAug = sum(readingsOf(2099, 8), "$.data[?(@.stationName=='B座')].genTotal");

        double rel = (fAug / bAug) / (fJun / bJun);
        assertThat(rel).isCloseTo(0.72, org.assertj.core.data.Offset.offset(0.01));

        // 月度恒等不能被故障破坏:Σ全站 = phase 月真实值(既有口径,IT 已锁 1 月,这里锁故障月)
        assertThat(sum(readingsOf(2099, 8), "$.data[*].selfUse"))
                .isCloseTo(30000.00, org.assertj.core.data.Offset.offset(1e-6));
    }

    // ③ 变点日期要能落在 7/18:故障当月内部也得有那一跳,否则整个 7 月只是「水平低一点」,
    //    变点扫描找不到日子,§08 验收 ① 的「±3 周」无从谈起。
    //    同样用「F座 ÷ B座」逐日比,把两站共享的天气因子约掉。
    @Test
    void simulate_故障当月内部在18日前后有阶跃() throws Exception {
        pvRecord("p1", "2099-07", "30000", "19500", "15000", "6795");

        mvc.perform(post("/api/pv-meter/simulate").param("year", "2099").header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0));

        List<Double> f = dailyGen(2099, 7, "F座");
        List<Double> b = dailyGen(2099, 7, "B座");
        assertThat(f).hasSize(31);

        double before = 0, after = 0;
        for (int d = 0; d < 18; d++) before += f.get(d) / b.get(d);
        for (int d = 18; d < 31; d++) after += f.get(d) / b.get(d);
        before /= 18; after /= 13;

        // 站内扰动 ±8%,18/13 个样本下 SE 约 3% —— 给 0.08 的容差
        assertThat(after / before).isCloseTo(0.72, org.assertj.core.data.Offset.offset(0.08));
    }
}

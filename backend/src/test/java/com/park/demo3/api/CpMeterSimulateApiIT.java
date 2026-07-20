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

// 充电桩模拟填充(CP-METER simulate):附表7/8 真实月度汇总推导分桩月末记录——
// dingding→叮叮充、dianxin→电信、wancheng→万城万、xiaoju 按 60/40 拆快充1/慢充1(假设比例);
// revenue=真实 fee(充电收入口径)、fee=revenue×5%(通道费假设);电表行=当月Σcharge_kwh×1.05(5% 损耗假设,只插空位)。
// 幂等(二跑 filled=0)、绝不覆盖 manual/import 与已有电表行、缺桩记 skipped 不报错。
// 种子 charging_record 为空(V19 清空待导入)→ 各测自造附表记录;2099 远期槽 + @Transactional 回滚,不污染共享容器。
@AutoConfigureMockMvc
@Transactional
class CpMeterSimulateApiIT extends AbstractMysqlIT {

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

    // 造附表7/8 月度汇总行(simulate 的推导源)
    private void chargingRecord(int no, String cat, String month, String kwh, String fee) throws Exception {
        mvc.perform(post("/api/charging/" + no + "/records").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"scheduleNo\":" + no + ",\"cat\":\"" + cat + "\",\"acctMonth\":\"" + month
                        + "\",\"kwh\":" + kwh + ",\"fee\":" + fee + ",\"cost\":0}"))
                .andExpect(jsonPath("$.code").value(0));
    }

    private String readingsOf(int year, int month) throws Exception {
        return utf8(mvc.perform(get("/api/cp-meter/readings")
                .param("year", String.valueOf(year)).param("month", String.valueOf(month))
                .header("Authorization", auth())).andExpect(status().isOk()).andReturn());
    }

    private String powerOf(int year, int month) throws Exception {
        return utf8(mvc.perform(get("/api/cp-meter/power-usage")
                .param("year", String.valueOf(year)).param("month", String.valueOf(month))
                .header("Authorization", auth())).andExpect(status().isOk()).andReturn());
    }

    private static double one(String body, String path) {
        List<Double> v = JsonPath.read(body, path);
        assertThat(v).hasSize(1);
        return v.get(0);
    }

    // ── 推导对账 + 幂等:4 运营商×2099-01 → 5 记录+4 电表行;抽样数值与 charging_record 全等;二跑 filled=0 ──
    @Test
    void simulate_anchorsMatchChargingRecord_idempotentSecondRunFillsZero() throws Exception {
        chargingRecord(7, "wancheng", "2099-01", "800", "700");
        chargingRecord(7, "xiaoju", "2099-01", "1111.11", "999.99");
        chargingRecord(8, "dingding", "2099-01", "1000", "900");
        chargingRecord(8, "dianxin", "2099-01", "500", "450");

        // 首跑:充电记录 5(叮叮充/电信/万城万/快充1/慢充1) + 电表 4(小桔/万城万 car,叮叮充/电信 ebike)
        mvc.perform(post("/api/cp-meter/simulate").param("year", "2099").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.filled").value(9))
                .andExpect(jsonPath("$.data.skipped").value(0));

        String rd = readingsOf(2099, 1);
        // 叮叮充:charge_kwh=真实 kwh、revenue=真实 fee(充电收入口径)、fee=revenue×5%;月末日一条
        assertThat(one(rd, "$.data[?(@.stationName=='叮叮充')].chargeKwh")).isEqualTo(1000.00);
        assertThat(one(rd, "$.data[?(@.stationName=='叮叮充')].revenue")).isEqualTo(900.00);
        assertThat(one(rd, "$.data[?(@.stationName=='叮叮充')].fee")).isEqualTo(45.00);
        List<String> dates = JsonPath.read(rd, "$.data[?(@.stationName=='叮叮充')].readDate");
        assertThat(dates).containsExactly("2099-01-31");
        // xiaoju 60/40 拆分:快充1+慢充1 = 真实 kwh(r2 半进位误差互消,恒等)
        double fast = one(rd, "$.data[?(@.stationName=='快充1')].chargeKwh");
        double slow = one(rd, "$.data[?(@.stationName=='慢充1')].chargeKwh");
        assertThat(fast).isEqualTo(666.67);
        assertThat(slow).isEqualTo(444.44);
        assertThat(fast + slow).isCloseTo(1111.11, org.assertj.core.data.Offset.offset(1e-9));
        // source 全 simulated,note 带推导来源;拆分行注明假设
        List<String> sources = JsonPath.read(rd, "$.data[*].source");
        assertThat(sources).hasSize(5).containsOnly("simulated");
        List<String> notes = JsonPath.read(rd, "$.data[*].note");
        assertThat(notes).allMatch(n -> n != null && n.startsWith("模拟:附表"));
        List<String> splitNote = JsonPath.read(rd, "$.data[?(@.stationName=='快充1')].note");
        assertThat(splitNote.get(0)).contains("60/40拆分(假设)");

        // 电表=当月Σcharge_kwh×1.05:小桔 1111.11×1.05=1166.67,叮叮充 1000×1.05=1050;损耗派生=电表−Σ
        String pu = powerOf(2099, 1);
        assertThat(one(pu, "$.data[?(@.operator=='小桔')].meterKwh")).isEqualTo(1166.67);
        assertThat(one(pu, "$.data[?(@.operator=='小桔')].sumChargeKwh")).isEqualTo(1111.11);
        assertThat(one(pu, "$.data[?(@.operator=='叮叮充')].meterKwh")).isEqualTo(1050.00);
        assertThat(one(pu, "$.data[?(@.operator=='叮叮充')].lossKwh")).isEqualTo(50.00);
        assertThat(one(pu, "$.data[?(@.operator=='万城万')].meterKwh")).isEqualTo(840.00);
        assertThat(one(pu, "$.data[?(@.operator=='电信')].meterKwh")).isEqualTo(525.00);

        // 幂等:第二跑 filled=0(值未变的 simulated 5 + 已有电表行 4 = skipped 9)
        mvc.perform(post("/api/cp-meter/simulate").param("year", "2099").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.filled").value(0))
                .andExpect(jsonPath("$.data.skipped").value(9));

        // 手工改写 simulated → source 翻 manual(真实替换模拟),再模拟不回写
        int dd = ((List<Integer>) JsonPath.read(rd, "$.data[?(@.stationName=='叮叮充')].id")).get(0);
        int ddSt = ((List<Integer>) JsonPath.read(rd, "$.data[?(@.stationName=='叮叮充')].stationId")).get(0);
        mvc.perform(put("/api/cp-meter/readings/" + dd).header("Authorization", auth())
                .contentType("application/json")
                .content("{\"stationId\":" + ddSt + ",\"readDate\":\"2099-01-31\",\"chargeKwh\":999,\"fee\":9,\"revenue\":888}"))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.source").value("manual"));
        mvc.perform(post("/api/cp-meter/simulate").param("year", "2099").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.filled").value(0))
                .andExpect(jsonPath("$.data.skipped").value(9));
        assertThat(one(readingsOf(2099, 1), "$.data[?(@.stationName=='叮叮充')].chargeKwh")).isEqualTo(999.00);
    }

    // ── 绝不覆盖:manual 记录占 (桩,月末日) 槽、手录电表行,simulate 全跳过 ──
    @Test
    void simulate_neverOverwritesManualReadingAndExistingPowerRow() throws Exception {
        String stations = utf8(mvc.perform(get("/api/cp-meter/stations").header("Authorization", auth())).andReturn());
        int dd = ((List<Integer>) JsonPath.read(stations, "$.data[?(@.name=='叮叮充')].id")).get(0);
        // 预置 manual 记录占月末槽 + 手录电表行
        mvc.perform(post("/api/cp-meter/readings").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"stationId\":" + dd + ",\"readDate\":\"2099-01-31\",\"chargeKwh\":111,\"fee\":22,\"revenue\":33}"))
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(put("/api/cp-meter/power-usage").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"operator\":\"叮叮充\",\"vehicleType\":\"ebike\",\"year\":2099,\"month\":1,\"meterKwh\":777}"))
                .andExpect(jsonPath("$.code").value(0));
        chargingRecord(8, "dingding", "2099-01", "1000", "900");

        // manual 槽 + 已有电表行都跳过,一条不写
        mvc.perform(post("/api/cp-meter/simulate").param("year", "2099").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.filled").value(0))
                .andExpect(jsonPath("$.data.skipped").value(2));

        String rd = readingsOf(2099, 1);
        assertThat(one(rd, "$.data[?(@.stationName=='叮叮充')].chargeKwh")).isEqualTo(111.00);
        List<String> src = JsonPath.read(rd, "$.data[?(@.stationName=='叮叮充')].source");
        assertThat(src).containsExactly("manual");
        assertThat(one(powerOf(2099, 1), "$.data[?(@.operator=='叮叮充')].meterKwh")).isEqualTo(777.00);
    }

    // ── 缺桩(被用户改名)记 skipped 不报错;电表行也随之不产生 ──
    @Test
    void simulate_missingStationCountsSkippedNoError() throws Exception {
        String stations = utf8(mvc.perform(get("/api/cp-meter/stations").header("Authorization", auth())).andReturn());
        int dd = ((List<Integer>) JsonPath.read(stations, "$.data[?(@.name=='叮叮充')].id")).get(0);
        mvc.perform(put("/api/cp-meter/stations/" + dd).header("Authorization", auth())
                .contentType("application/json")
                .content("{\"name\":\"叮叮充X\",\"operator\":\"叮叮充\",\"vehicleType\":\"ebike\"}"))
                .andExpect(jsonPath("$.code").value(0));
        chargingRecord(8, "dingding", "2099-05", "100", "90");

        mvc.perform(post("/api/cp-meter/simulate").param("year", "2099").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.filled").value(0))
                .andExpect(jsonPath("$.data.skipped").value(1));
        // 改名桩未被写入任何模拟记录
        List<Object> rows = JsonPath.read(readingsOf(2099, 5), "$.data[*]");
        assertThat(rows).isEmpty();
    }
}

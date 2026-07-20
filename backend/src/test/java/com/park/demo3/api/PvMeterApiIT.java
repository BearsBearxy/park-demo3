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

// 光伏分栋抄表:13 站种子锚点、电站 CRUD(重名/删除守卫)、抄表 CRUD 与 price_snap 快照语义
// (改站单价后旧记录收益不变——本刀核心口径)。@Transactional 回滚,不污染共享容器;写数据用 2099 远期槽。
@AutoConfigureMockMvc
@Transactional
class PvMeterApiIT extends AbstractMysqlIT {

    @Autowired MockMvc mvc;
    private String token;

    @BeforeEach
    void login() throws Exception {
        token = login("admin", "admin123");
    }

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

    // ── V36 种子:13 站在位,sort 升序(一期 5 / 二期 6 / 三期 2),容量单价留空 ──
    @Test
    void seed_thirteenStations_anchors() throws Exception {
        String body = utf8(mvc.perform(get("/api/pv-meter/stations").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.length()").value(13))
                .andExpect(jsonPath("$.data[0].name").value("B座"))
                .andExpect(jsonPath("$.data[0].phase").value(1))
                .andExpect(jsonPath("$.data[1].name").value("C、D座"))
                .andExpect(jsonPath("$.data[5].name").value("8栋"))
                .andExpect(jsonPath("$.data[5].phase").value(2))
                .andExpect(jsonPath("$.data[11].name").value("创业大厦"))
                .andExpect(jsonPath("$.data[12].name").value("工业大厦"))
                .andExpect(jsonPath("$.data[12].phase").value(3))
                .andReturn());
        List<Integer> phases = JsonPath.read(body, "$.data[*].phase");
        assertThat(phases.stream().filter(p -> p == 1).count()).isEqualTo(5);
        assertThat(phases.stream().filter(p -> p == 2).count()).isEqualTo(6);
        assertThat(phases.stream().filter(p -> p == 3).count()).isEqualTo(2);
        // 种子容量/单价留空,待界面补录
        mvc.perform(get("/api/pv-meter/stations").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[0].capacityKwp").isEmpty())
                .andExpect(jsonPath("$.data[0].priceYuan").isEmpty());
    }

    // ── 电站 CRUD:新增/重名 409/编辑/删除/删不存在 404 ──
    @Test
    void station_crud_dupName409_deleteOk() throws Exception {
        String created = utf8(mvc.perform(post("/api/pv-meter/stations").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"name\":\"测试站X\",\"phase\":2,\"capacityKwp\":120.5,\"priceYuan\":0.65}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.name").value("测试站X"))
                .andReturn());
        int id = JsonPath.read(created, "$.data.id");

        // 重名 409(业务错误 HTTP 200 + code 409,项目口径)
        mvc.perform(post("/api/pv-meter/stations").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"name\":\"测试站X\",\"phase\":1}"))
                .andExpect(jsonPath("$.code").value(409));

        // 编辑(名称/容量/单价)
        mvc.perform(put("/api/pv-meter/stations/" + id).header("Authorization", auth())
                .contentType("application/json")
                .content("{\"name\":\"测试站X改\",\"phase\":2,\"capacityKwp\":130,\"priceYuan\":0.7}"))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.name").value("测试站X改"));

        mvc.perform(get("/api/pv-meter/stations").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.length()").value(14));

        // 无抄表记录可删;再删 404
        mvc.perform(delete("/api/pv-meter/stations/" + id).header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(get("/api/pv-meter/stations").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.length()").value(13));
        mvc.perform(delete("/api/pv-meter/stations/" + id).header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(404));
    }

    // ── 删站守卫:有抄表记录 409;清空记录后可删 ──
    @Test
    void stationDelete_withReadings_409() throws Exception {
        String created = utf8(mvc.perform(post("/api/pv-meter/stations").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"name\":\"测试站Y\",\"phase\":1,\"priceYuan\":0.6}"))
                .andExpect(jsonPath("$.code").value(0)).andReturn());
        int sid = JsonPath.read(created, "$.data.id");

        String reading = utf8(mvc.perform(post("/api/pv-meter/readings").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"stationId\":" + sid + ",\"readDate\":\"2099-03-31\",\"genTotal\":100,\"selfUse\":80,\"gridFeed\":20}"))
                .andExpect(jsonPath("$.code").value(0)).andReturn());
        int rid = JsonPath.read(reading, "$.data.id");

        mvc.perform(delete("/api/pv-meter/stations/" + sid).header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(409));

        mvc.perform(delete("/api/pv-meter/readings/" + rid).header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(delete("/api/pv-meter/stations/" + sid).header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0));
    }

    // ── price_snap 快照语义(本刀核心口径,锁死):改站单价后旧记录收益不变;新记录用新价;PUT 记录不改快照 ──
    @Test
    void priceSnap_oldReadingsStable_afterStationPriceChange() throws Exception {
        String created = utf8(mvc.perform(post("/api/pv-meter/stations").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"name\":\"快照站\",\"phase\":3,\"priceYuan\":0.65}"))
                .andExpect(jsonPath("$.code").value(0)).andReturn());
        int sid = JsonPath.read(created, "$.data.id");

        // 录入时快照 0.65 → 收益 1000×0.65=650.00
        String reading = utf8(mvc.perform(post("/api/pv-meter/readings").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"stationId\":" + sid + ",\"readDate\":\"2099-01-31\",\"genTotal\":1200,\"selfUse\":1000,\"gridFeed\":200}"))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.priceSnap").value(0.65))
                .andExpect(jsonPath("$.data.revenue").value(650.0))
                .andExpect(jsonPath("$.data.source").value("manual"))
                .andReturn());
        int rid = JsonPath.read(reading, "$.data.id");

        // 调站单价 0.65 → 0.8
        mvc.perform(put("/api/pv-meter/stations/" + sid).header("Authorization", auth())
                .contentType("application/json")
                .content("{\"name\":\"快照站\",\"phase\":3,\"priceYuan\":0.8}"))
                .andExpect(jsonPath("$.code").value(0));

        // 旧记录快照与收益不漂移
        mvc.perform(get("/api/pv-meter/readings").param("year", "2099").param("month", "1")
                .param("stationId", String.valueOf(sid)).header("Authorization", auth()))
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].priceSnap").value(0.65))
                .andExpect(jsonPath("$.data[0].revenue").value(650.0));

        // 新记录用新价 0.8
        mvc.perform(post("/api/pv-meter/readings").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"stationId\":" + sid + ",\"readDate\":\"2099-02-15\",\"selfUse\":100}"))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.priceSnap").value(0.8))
                .andExpect(jsonPath("$.data.revenue").value(80.0));

        // PUT 改量不改快照:2000×0.65=1300
        mvc.perform(put("/api/pv-meter/readings/" + rid).header("Authorization", auth())
                .contentType("application/json")
                .content("{\"stationId\":" + sid + ",\"readDate\":\"2099-01-31\",\"genTotal\":2400,\"selfUse\":2000,\"gridFeed\":400}"))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.priceSnap").value(0.65))
                .andExpect(jsonPath("$.data.revenue").value(1300.0));
    }

    // ── 抄表校验:同站同日 409 / 日期非法 400 / 负量 400 / 站不存在 409 / 无价站快照空收益 0 ──
    @Test
    void reading_validation_dupDate_badDate_negative_unknownStation() throws Exception {
        String stations = utf8(mvc.perform(get("/api/pv-meter/stations").header("Authorization", auth()))
                .andReturn());
        List<Integer> ids = JsonPath.read(stations, "$.data[?(@.name=='B座')].id");
        int bId = ids.get(0);

        // 种子 B座 无单价:快照空,收益按 0
        mvc.perform(post("/api/pv-meter/readings").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"stationId\":" + bId + ",\"readDate\":\"2099-05-31\",\"selfUse\":500}"))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.priceSnap").isEmpty())
                .andExpect(jsonPath("$.data.revenue").value(0.0));

        // 同站同日 409
        mvc.perform(post("/api/pv-meter/readings").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"stationId\":" + bId + ",\"readDate\":\"2099-05-31\",\"selfUse\":1}"))
                .andExpect(jsonPath("$.code").value(409));

        // 日期非法:格式过 Pattern 但非法历日(13 月)→ 业务 400;格式不符 → 参数 400
        mvc.perform(post("/api/pv-meter/readings").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"stationId\":" + bId + ",\"readDate\":\"2099-13-99\",\"selfUse\":1}"))
                .andExpect(jsonPath("$.code").value(400));
        mvc.perform(post("/api/pv-meter/readings").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"stationId\":" + bId + ",\"readDate\":\"2099/05/31\",\"selfUse\":1}"))
                .andExpect(status().isBadRequest());

        // 三量 ≥0 硬校验
        mvc.perform(post("/api/pv-meter/readings").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"stationId\":" + bId + ",\"readDate\":\"2099-06-01\",\"selfUse\":-1}"))
                .andExpect(status().isBadRequest());

        // 站不存在 409
        mvc.perform(post("/api/pv-meter/readings").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"stationId\":999999,\"readDate\":\"2099-06-01\",\"selfUse\":1}"))
                .andExpect(jsonPath("$.code").value(409));
    }

    // ── 年份数据驱动:空表=[];录 2026+2023 两条 → years=[2023,2026] 升序 ──
    @Test
    void years_emptyThenSortedAsc() throws Exception {
        mvc.perform(get("/api/pv-meter/years").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data").isEmpty());
        String stations = utf8(mvc.perform(get("/api/pv-meter/stations").header("Authorization", auth()))
                .andReturn());
        List<Integer> ids = JsonPath.read(stations, "$.data[?(@.name=='B座')].id");
        int bId = ids.get(0);
        mvc.perform(post("/api/pv-meter/readings").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"stationId\":" + bId + ",\"readDate\":\"2026-01-15\",\"selfUse\":1}"))
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(post("/api/pv-meter/readings").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"stationId\":" + bId + ",\"readDate\":\"2023-06-30\",\"selfUse\":1}"))
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(get("/api/pv-meter/years").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.length()").value(2))
                .andExpect(jsonPath("$.data[0]").value(2023))
                .andExpect(jsonPath("$.data[1]").value(2026));
    }

    // ── ENERGY-ANALYSIS §4:readings month 可空=全年(各月并集,跨年不混);month 传值行为不变 ──
    @Test
    void readings_monthOptional_yearEqualsUnionOfMonths() throws Exception {
        String stations = utf8(mvc.perform(get("/api/pv-meter/stations").header("Authorization", auth()))
                .andReturn());
        List<Integer> ids = JsonPath.read(stations, "$.data[?(@.name=='B座')].id");
        int bId = ids.get(0);
        for (String d : List.of("2099-01-15", "2099-06-30", "2098-12-31"))
            mvc.perform(post("/api/pv-meter/readings").header("Authorization", auth())
                    .contentType("application/json")
                    .content("{\"stationId\":" + bId + ",\"readDate\":\"" + d + "\",\"selfUse\":10}"))
                    .andExpect(jsonPath("$.code").value(0));

        // 全年 = 1 月+6 月两条并集(2098 不混入),read_date 升序
        mvc.perform(get("/api/pv-meter/readings").param("year", "2099").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.length()").value(2))
                .andExpect(jsonPath("$.data[0].readDate").value("2099-01-15"))
                .andExpect(jsonPath("$.data[1].readDate").value("2099-06-30"));
        // month 传值行为不变:单月只见当月
        mvc.perform(get("/api/pv-meter/readings").param("year", "2099").param("month", "6")
                .header("Authorization", auth()))
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].readDate").value("2099-06-30"));
    }

    // ── 角色门:viewer 可读不可写;无 token 401(SecurityConfig 统一门,无需本控制器代码) ──
    @Test
    void viewerReadOk_writeForbidden_noToken401() throws Exception {
        String viewer = login("viewer", "viewer123");
        mvc.perform(get("/api/pv-meter/stations").header("Authorization", "Bearer " + viewer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(post("/api/pv-meter/stations").header("Authorization", "Bearer " + viewer)
                .contentType("application/json").content("{\"name\":\"越权站\",\"phase\":1}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value(403));
        mvc.perform(delete("/api/pv-meter/readings/1").header("Authorization", "Bearer " + viewer))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/pv-meter/stations"))
                .andExpect(status().isUnauthorized());
    }
}

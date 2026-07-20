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

// 充电桩分桩明细:5 桩种子锚点(V38+V41)、桩 CRUD(重名/删除守卫)、充电记录 CRUD(三金额≥0 全手填)、
// 电表 upsert 与 lossKwh 派生(含损耗为负——本刀核心口径)。@Transactional 回滚,不污染共享容器;写数据用 2099 远期槽。
@AutoConfigureMockMvc
@Transactional
class CpMeterApiIT extends AbstractMysqlIT {

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

    private int stationId(String name) throws Exception {
        String body = utf8(mvc.perform(get("/api/cp-meter/stations").header("Authorization", auth())).andReturn());
        List<Integer> ids = JsonPath.read(body, "$.data[?(@.name=='" + name + "')].id");
        return ids.get(0);
    }

    // ── V38+V41 种子:5 桩在位,sort 升序;car=小桔×2+万城万,ebike=叮叮充/电信(2026-07-18 用户澄清) ──
    @Test
    void seed_threeStations_anchors() throws Exception {
        mvc.perform(get("/api/cp-meter/stations").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.length()").value(5))
                .andExpect(jsonPath("$.data[0].name").value("快充1"))
                .andExpect(jsonPath("$.data[0].operator").value("小桔"))
                .andExpect(jsonPath("$.data[0].vehicleType").value("car"))
                .andExpect(jsonPath("$.data[1].name").value("慢充1"))
                .andExpect(jsonPath("$.data[1].operator").value("小桔"))
                .andExpect(jsonPath("$.data[1].vehicleType").value("car"))
                .andExpect(jsonPath("$.data[2].name").value("万城万"))
                .andExpect(jsonPath("$.data[2].operator").value("万城万"))
                .andExpect(jsonPath("$.data[2].vehicleType").value("car"))
                .andExpect(jsonPath("$.data[3].name").value("叮叮充"))
                .andExpect(jsonPath("$.data[3].vehicleType").value("ebike"))
                .andExpect(jsonPath("$.data[4].name").value("电信"))
                .andExpect(jsonPath("$.data[4].vehicleType").value("ebike"));
    }

    // ── 桩 CRUD:新增/重名 409/编辑/删除/删不存在 404;类型非法 400 ──
    @Test
    void station_crud_dupName409_deleteOk() throws Exception {
        String created = utf8(mvc.perform(post("/api/cp-meter/stations").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"name\":\"测试桩X\",\"operator\":\"小桔\",\"vehicleType\":\"car\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.name").value("测试桩X"))
                .andReturn());
        int id = JsonPath.read(created, "$.data.id");

        // 重名 409(业务错误 HTTP 200 + code 409,项目口径)
        mvc.perform(post("/api/cp-meter/stations").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"name\":\"测试桩X\",\"operator\":\"别家\",\"vehicleType\":\"ebike\"}"))
                .andExpect(jsonPath("$.code").value(409));

        // 类型非法 400(参数校验)
        mvc.perform(post("/api/cp-meter/stations").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"name\":\"测试桩Z\",\"operator\":\"小桔\",\"vehicleType\":\"truck\"}"))
                .andExpect(status().isBadRequest());

        // 编辑(名称/运营商/类型)
        mvc.perform(put("/api/cp-meter/stations/" + id).header("Authorization", auth())
                .contentType("application/json")
                .content("{\"name\":\"测试桩X改\",\"operator\":\"万城万\",\"vehicleType\":\"ebike\"}"))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.name").value("测试桩X改"))
                .andExpect(jsonPath("$.data.operator").value("万城万"))
                .andExpect(jsonPath("$.data.vehicleType").value("ebike"));

        mvc.perform(get("/api/cp-meter/stations").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.length()").value(6));

        // 无充电记录可删;再删 404
        mvc.perform(delete("/api/cp-meter/stations/" + id).header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(get("/api/cp-meter/stations").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.length()").value(5));
        mvc.perform(delete("/api/cp-meter/stations/" + id).header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(404));
    }

    // ── 删桩守卫:有充电记录 409;清空记录后可删 ──
    @Test
    void stationDelete_withReadings_409() throws Exception {
        String created = utf8(mvc.perform(post("/api/cp-meter/stations").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"name\":\"测试桩Y\",\"operator\":\"小桔\",\"vehicleType\":\"car\"}"))
                .andExpect(jsonPath("$.code").value(0)).andReturn());
        int sid = JsonPath.read(created, "$.data.id");

        String reading = utf8(mvc.perform(post("/api/cp-meter/readings").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"stationId\":" + sid + ",\"readDate\":\"2099-03-31\",\"chargeKwh\":100,\"fee\":5,\"revenue\":90}"))
                .andExpect(jsonPath("$.code").value(0)).andReturn());
        int rid = JsonPath.read(reading, "$.data.id");

        mvc.perform(delete("/api/cp-meter/stations/" + sid).header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(409));

        mvc.perform(delete("/api/cp-meter/readings/" + rid).header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(delete("/api/cp-meter/stations/" + sid).header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0));
    }

    // ── 充电记录 CRUD 与校验:三金额全手填、同桩同日 409、日期非法、负金额 400、桩不存在 409 ──
    @Test
    void reading_crud_validation() throws Exception {
        int kId = stationId("快充1");

        // 新增:三金额全手填(无 price_snap/自动换算)
        String created = utf8(mvc.perform(post("/api/cp-meter/readings").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"stationId\":" + kId + ",\"readDate\":\"2099-05-31\",\"chargeKwh\":120.5,\"fee\":6.05,\"revenue\":110,\"note\":\"平台对账单\"}"))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.stationName").value("快充1"))
                .andExpect(jsonPath("$.data.chargeKwh").value(120.5))
                .andExpect(jsonPath("$.data.fee").value(6.05))
                .andExpect(jsonPath("$.data.revenue").value(110.0))
                .andExpect(jsonPath("$.data.source").value("manual"))
                .andReturn());
        int rid = JsonPath.read(created, "$.data.id");

        // 同桩同日 409
        mvc.perform(post("/api/cp-meter/readings").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"stationId\":" + kId + ",\"readDate\":\"2099-05-31\",\"chargeKwh\":1}"))
                .andExpect(jsonPath("$.code").value(409));

        // 日期非法:格式过 Pattern 但非法历日 → 业务 400;格式不符 → 参数 400
        mvc.perform(post("/api/cp-meter/readings").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"stationId\":" + kId + ",\"readDate\":\"2099-13-99\",\"chargeKwh\":1}"))
                .andExpect(jsonPath("$.code").value(400));
        mvc.perform(post("/api/cp-meter/readings").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"stationId\":" + kId + ",\"readDate\":\"2099/05/31\",\"chargeKwh\":1}"))
                .andExpect(status().isBadRequest());

        // 三金额 ≥0 硬校验(逐个)
        for (String field : new String[]{"chargeKwh", "fee", "revenue"}) {
            mvc.perform(post("/api/cp-meter/readings").header("Authorization", auth())
                    .contentType("application/json")
                    .content("{\"stationId\":" + kId + ",\"readDate\":\"2099-06-01\",\"" + field + "\":-1}"))
                    .andExpect(status().isBadRequest());
        }

        // 桩不存在 409
        mvc.perform(post("/api/cp-meter/readings").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"stationId\":999999,\"readDate\":\"2099-06-01\",\"chargeKwh\":1}"))
                .andExpect(jsonPath("$.code").value(409));

        // PUT 改金额;GET 按桩过滤单行
        mvc.perform(put("/api/cp-meter/readings/" + rid).header("Authorization", auth())
                .contentType("application/json")
                .content("{\"stationId\":" + kId + ",\"readDate\":\"2099-05-31\",\"chargeKwh\":200,\"fee\":10,\"revenue\":180}"))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.chargeKwh").value(200.0))
                .andExpect(jsonPath("$.data.revenue").value(180.0));
        mvc.perform(get("/api/cp-meter/readings").param("year", "2099").param("month", "5")
                .param("stationId", String.valueOf(kId)).header("Authorization", auth()))
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].chargeKwh").value(200.0));

        // 删除;再删 404
        mvc.perform(delete("/api/cp-meter/readings/" + rid).header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(delete("/api/cp-meter/readings/" + rid).header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(404));
    }

    // ── 电表与损耗(本刀核心口径,锁死):行=运营商×类型;lossKwh=电表−Σ充电量 读时派生;
    //    未录电表 null;upsert 覆盖仍一行;电表<充电量 → 损耗为负不阻断 ──
    @Test
    void powerUsage_upsert_lossDerived_negativeLossAllowed() throws Exception {
        int kId = stationId("快充1");
        int mId = stationId("慢充1");

        // 未录任何数据:种子桩库四组合(小桔×car/万城万×car/叮叮充×ebike/电信×ebike,V41 后),电表与损耗均空,Σ充电量 0
        mvc.perform(get("/api/cp-meter/power-usage").param("year", "2099").param("month", "7")
                .header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.length()").value(4))
                .andExpect(jsonPath("$.data[0].operator").value("小桔"))
                .andExpect(jsonPath("$.data[0].vehicleType").value("car"))
                .andExpect(jsonPath("$.data[0].meterKwh").isEmpty())
                .andExpect(jsonPath("$.data[0].sumChargeKwh").value(0.0))
                .andExpect(jsonPath("$.data[0].lossKwh").isEmpty())
                .andExpect(jsonPath("$.data[1].operator").value("万城万"))
                .andExpect(jsonPath("$.data[1].vehicleType").value("car"));

        // 小桔 car 两桩当月充电 60+40=100
        mvc.perform(post("/api/cp-meter/readings").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"stationId\":" + kId + ",\"readDate\":\"2099-07-10\",\"chargeKwh\":60,\"fee\":3,\"revenue\":55}"))
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(post("/api/cp-meter/readings").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"stationId\":" + mId + ",\"readDate\":\"2099-07-10\",\"chargeKwh\":40,\"fee\":2,\"revenue\":36}"))
                .andExpect(jsonPath("$.code").value(0));

        // 录电表 110 → 损耗 110−100=10
        mvc.perform(put("/api/cp-meter/power-usage").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"operator\":\"小桔\",\"vehicleType\":\"car\",\"year\":2099,\"month\":7,\"meterKwh\":110}"))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.meterKwh").value(110.0))
                .andExpect(jsonPath("$.data.sumChargeKwh").value(100.0))
                .andExpect(jsonPath("$.data.lossKwh").value(10.0));

        // 改电表 80(upsert 覆盖) → 损耗 80−100=−20:电表<充电量为负,不阻断(前端黄警示)
        mvc.perform(put("/api/cp-meter/power-usage").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"operator\":\"小桔\",\"vehicleType\":\"car\",\"year\":2099,\"month\":7,\"meterKwh\":80,\"note\":\"表读数存疑\"}"))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.lossKwh").value(-20.0))
                .andExpect(jsonPath("$.data.note").value("表读数存疑"));

        // GET 复核:仍四行(upsert 未新增行,V41 后组合=4);小桔行 80/100/−20;其余行不受影响
        mvc.perform(get("/api/cp-meter/power-usage").param("year", "2099").param("month", "7")
                .header("Authorization", auth()))
                .andExpect(jsonPath("$.data.length()").value(4))
                .andExpect(jsonPath("$.data[0].meterKwh").value(80.0))
                .andExpect(jsonPath("$.data[0].sumChargeKwh").value(100.0))
                .andExpect(jsonPath("$.data[0].lossKwh").value(-20.0))
                .andExpect(jsonPath("$.data[1].meterKwh").isEmpty());

        // 电表负值 400
        mvc.perform(put("/api/cp-meter/power-usage").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"operator\":\"小桔\",\"vehicleType\":\"car\",\"year\":2099,\"month\":7,\"meterKwh\":-1}"))
                .andExpect(status().isBadRequest());
    }

    // ── P0-1a 独苗桩改运营商(旧键无其他桩=改名语义):历史电表行跟随迁移到新键,损耗恢复正确;孤儿行消灭 ──
    @Test
    void operatorRename_soleStation_usageMigrates() throws Exception {
        String created = utf8(mvc.perform(post("/api/cp-meter/stations").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"name\":\"孤桩A\",\"operator\":\"独苗商\",\"vehicleType\":\"car\"}"))
                .andExpect(jsonPath("$.code").value(0)).andReturn());
        int sid = JsonPath.read(created, "$.data.id");

        mvc.perform(post("/api/cp-meter/readings").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"stationId\":" + sid + ",\"readDate\":\"2099-08-10\",\"chargeKwh\":50,\"fee\":2,\"revenue\":45}"))
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(put("/api/cp-meter/power-usage").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"operator\":\"独苗商\",\"vehicleType\":\"car\",\"year\":2099,\"month\":8,\"meterKwh\":60}"))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.lossKwh").value(10.0));

        // 改运营商(独苗商→新商名):旧键已无任何桩 → 电表行整体迁移
        mvc.perform(put("/api/cp-meter/stations/" + sid).header("Authorization", auth())
                .contentType("application/json")
                .content("{\"name\":\"孤桩A\",\"operator\":\"新商名\",\"vehicleType\":\"car\"}"))
                .andExpect(jsonPath("$.code").value(0));

        String body = utf8(mvc.perform(get("/api/cp-meter/power-usage").param("year", "2099").param("month", "8")
                .header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0)).andReturn());
        assertThat((List<?>) JsonPath.read(body, "$.data[?(@.operator=='独苗商')]")).isEmpty();   // 孤儿行已消灭
        List<Double> meter = JsonPath.read(body, "$.data[?(@.operator=='新商名')].meterKwh");
        List<Double> loss = JsonPath.read(body, "$.data[?(@.operator=='新商名')].lossKwh");
        assertThat(meter).containsExactly(60.0);
        assertThat(loss).containsExactly(10.0);   // 60−50:损耗跟随迁移恢复正确
    }

    // ── P0-1b 一商两桩改其一(旧键仍有其他桩=重新归属语义):电表行留在旧运营商不动 ──
    @Test
    void operatorReassign_otherStationRemains_usageStays() throws Exception {
        int kId = stationId("快充1");
        mvc.perform(put("/api/cp-meter/power-usage").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"operator\":\"小桔\",\"vehicleType\":\"car\",\"year\":2099,\"month\":11,\"meterKwh\":70}"))
                .andExpect(jsonPath("$.code").value(0));

        // 快充1 改归别商;慢充1 仍留 (小桔,car) → 旧键仍有效,电表行不迁移
        mvc.perform(put("/api/cp-meter/stations/" + kId).header("Authorization", auth())
                .contentType("application/json")
                .content("{\"name\":\"快充1\",\"operator\":\"别商\",\"vehicleType\":\"car\"}"))
                .andExpect(jsonPath("$.code").value(0));

        String body = utf8(mvc.perform(get("/api/cp-meter/power-usage").param("year", "2099").param("month", "11")
                .header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0)).andReturn());
        List<Double> oldMeter = JsonPath.read(body, "$.data[?(@.operator=='小桔')].meterKwh");
        assertThat(oldMeter).containsExactly(70.0);   // 电表行留在旧运营商
        assertThat((List<?>) JsonPath.read(body, "$.data[?(@.operator=='别商')]")).hasSize(1);   // 新键行在(未录电表)
    }

    // ── P0-1c 迁移遇同期冲突:目标行保留、源行删除(目标键是用户现在认的口径) ──
    @Test
    void operatorRename_periodConflict_targetRowWins() throws Exception {
        String created = utf8(mvc.perform(post("/api/cp-meter/stations").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"name\":\"冲桩\",\"operator\":\"旧商\",\"vehicleType\":\"car\"}"))
                .andExpect(jsonPath("$.code").value(0)).andReturn());
        int sid = JsonPath.read(created, "$.data.id");

        // 源键与目标键同期(2099-09)各有一行电表
        mvc.perform(put("/api/cp-meter/power-usage").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"operator\":\"旧商\",\"vehicleType\":\"car\",\"year\":2099,\"month\":9,\"meterKwh\":30}"))
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(put("/api/cp-meter/power-usage").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"operator\":\"小桔\",\"vehicleType\":\"car\",\"year\":2099,\"month\":9,\"meterKwh\":100}"))
                .andExpect(jsonPath("$.code").value(0));

        // 冲桩改归小桔:旧商已无桩 → 迁移;2099-09 目标已有行 → 目标 100 保留,源 30 删除
        mvc.perform(put("/api/cp-meter/stations/" + sid).header("Authorization", auth())
                .contentType("application/json")
                .content("{\"name\":\"冲桩\",\"operator\":\"小桔\",\"vehicleType\":\"car\"}"))
                .andExpect(jsonPath("$.code").value(0));

        String body = utf8(mvc.perform(get("/api/cp-meter/power-usage").param("year", "2099").param("month", "9")
                .header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0)).andReturn());
        assertThat((List<?>) JsonPath.read(body, "$.data[?(@.operator=='旧商')]")).isEmpty();
        List<Double> meter = JsonPath.read(body, "$.data[?(@.operator=='小桔')].meterKwh");
        assertThat(meter).containsExactly(100.0);
    }

    // ── 年份数据驱动:空表=[];录 2026+2023 两条 → years=[2023,2026] 升序 ──
    @Test
    void years_emptyThenSortedAsc() throws Exception {
        mvc.perform(get("/api/cp-meter/years").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data").isEmpty());
        int kId = stationId("快充1");
        mvc.perform(post("/api/cp-meter/readings").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"stationId\":" + kId + ",\"readDate\":\"2026-01-15\",\"chargeKwh\":1}"))
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(post("/api/cp-meter/readings").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"stationId\":" + kId + ",\"readDate\":\"2023-06-30\",\"chargeKwh\":1}"))
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(get("/api/cp-meter/years").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.length()").value(2))
                .andExpect(jsonPath("$.data[0]").value(2023))
                .andExpect(jsonPath("$.data[1]").value(2026));
    }

    // ── ENERGY-ANALYSIS §4:readings/power-usage month 可空=全年(各月并集);power-usage 行含 month,
    //    无电表月 lossKwh=null(前端断点不连线);month 传值行为不变 ──
    @Test
    void readings_powerUsage_monthOptional_yearUnion() throws Exception {
        int kId = stationId("快充1");
        mvc.perform(post("/api/cp-meter/readings").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"stationId\":" + kId + ",\"readDate\":\"2099-02-10\",\"chargeKwh\":60,\"fee\":3,\"revenue\":55}"))
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(post("/api/cp-meter/readings").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"stationId\":" + kId + ",\"readDate\":\"2099-03-05\",\"chargeKwh\":40,\"fee\":2,\"revenue\":36}"))
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(put("/api/cp-meter/power-usage").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"operator\":\"小桔\",\"vehicleType\":\"car\",\"year\":2099,\"month\":2,\"meterKwh\":70}"))
                .andExpect(jsonPath("$.code").value(0));

        // readings 全年 = 2、3 月两条并集,read_date 升序
        mvc.perform(get("/api/cp-meter/readings").param("year", "2099").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.length()").value(2))
                .andExpect(jsonPath("$.data[0].readDate").value("2099-02-10"))
                .andExpect(jsonPath("$.data[1].readDate").value("2099-03-05"));

        // power-usage 全年 = 各月并集:4 组合×12 月=48 行,行含 month
        String body = utf8(mvc.perform(get("/api/cp-meter/power-usage").param("year", "2099")
                .header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.length()").value(48))
                .andReturn());
        // 2 月小桔 car:电表 70,Σ60,损耗 10;3 月未录电表:Σ40,损耗 null(断点)
        List<Double> febLoss = JsonPath.read(body, "$.data[?(@.month==2 && @.operator=='小桔' && @.vehicleType=='car')].lossKwh");
        assertThat(febLoss).containsExactly(10.0);
        List<Object> marLoss = JsonPath.read(body, "$.data[?(@.month==3 && @.operator=='小桔' && @.vehicleType=='car')].lossKwh");
        assertThat(marLoss).containsExactly((Object) null);
        List<Double> marSum = JsonPath.read(body, "$.data[?(@.month==3 && @.operator=='小桔' && @.vehicleType=='car')].sumChargeKwh");
        assertThat(marSum).containsExactly(40.0);

        // month 传值行为不变:单月仍 4 行,行 month=当月
        mvc.perform(get("/api/cp-meter/power-usage").param("year", "2099").param("month", "2")
                .header("Authorization", auth()))
                .andExpect(jsonPath("$.data.length()").value(4))
                .andExpect(jsonPath("$.data[0].month").value(2))
                .andExpect(jsonPath("$.data[0].meterKwh").value(70.0))
                .andExpect(jsonPath("$.data[0].lossKwh").value(10.0));
    }

    // ── 角色门:viewer 可读不可写;无 token 401(SecurityConfig 统一门,无需本控制器代码) ──
    @Test
    void viewerReadOk_writeForbidden_noToken401() throws Exception {
        String viewer = login("viewer", "viewer123");
        mvc.perform(get("/api/cp-meter/stations").header("Authorization", "Bearer " + viewer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(get("/api/cp-meter/power-usage").param("year", "2099").param("month", "7")
                .header("Authorization", "Bearer " + viewer))
                .andExpect(status().isOk());
        mvc.perform(post("/api/cp-meter/stations").header("Authorization", "Bearer " + viewer)
                .contentType("application/json")
                .content("{\"name\":\"越权桩\",\"operator\":\"小桔\",\"vehicleType\":\"car\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value(403));
        mvc.perform(put("/api/cp-meter/power-usage").header("Authorization", "Bearer " + viewer)
                .contentType("application/json")
                .content("{\"operator\":\"小桔\",\"vehicleType\":\"car\",\"year\":2099,\"month\":7,\"meterKwh\":1}"))
                .andExpect(status().isForbidden());
        mvc.perform(delete("/api/cp-meter/readings/1").header("Authorization", "Bearer " + viewer))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/cp-meter/stations"))
                .andExpect(status().isUnauthorized());
    }
}

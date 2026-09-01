package com.park.demo3.api;

import com.jayway.jsonpath.JsonPath;
import com.park.demo3.AbstractMysqlIT;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// 外部天气与辐射(PV-ANALYSIS-SPEC §03)。两组断言:
//   ① V117/V118/V119 三个迁移**真的跑过** —— Flyway 失败会让上下文起不来,但「起来了」不等于「列建对了」,
//      列漏了要等前端算不出效率才发现。
//   ② 导入幂等 / 日聚合口径 / hours 护栏 / 权限门。
// @Transactional 回滚,不污染共享容器;写数据用 2099 远期槽(同 PvMeterApiIT 约定)。
@AutoConfigureMockMvc
@Transactional
class WeatherApiIT extends AbstractMysqlIT {

    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;
    private String token;

    @BeforeEach
    void login() throws Exception {
        token = tokenOf("admin", "admin123");
    }

    private String tokenOf(String user, String pass) throws Exception {
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

    /** 造 n 个整点行(2099-03-01 00:00 起),每点 ghi 固定 —— 便于反推日累计 */
    private static String hours(int n, String ghi) {
        StringBuilder sb = new StringBuilder("{\"rows\":[");
        for (int h = 0; h < n; h++) {
            if (h > 0) sb.append(',');
            sb.append("{\"obsTime\":\"2099-03-01 ").append(String.format("%02d", h)).append(":00\"")
              .append(",\"ghi\":").append(ghi)
              .append(",\"tempC\":25,\"precipMm\":0,\"humidity\":60,\"weatherTxt\":\"晴\"}");
        }
        return sb.append("]}").toString();
    }

    // V117:表建出来了,且唯一键落在 obs_time 上 —— 幂等 upsert 全靠它
    @Test
    void v117_建了_weather_hour_且_obs_time_唯一() {
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM weather_hour", Integer.class)).isNotNull();

        // information_schema 查唯一索引:NON_UNIQUE=0 且只覆盖 obs_time 一列
        List<String> uniqCols = jdbc.queryForList("""
                SELECT COLUMN_NAME FROM information_schema.STATISTICS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'weather_hour'
                  AND INDEX_NAME = 'uk_weather_hour' AND NON_UNIQUE = 0
                ORDER BY SEQ_IN_INDEX
                """, String.class);
        assertThat(uniqCols).containsExactly("obs_time");
    }

    // V117:三个辐射列都在。dni/dhi 当前没人读,但漏建的话将来做遮挡分析要重导一年数据
    @Test
    void v117_三个辐射列都在() {
        List<String> cols = jdbc.queryForList("""
                SELECT COLUMN_NAME FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'weather_hour'
                """, String.class);
        assertThat(cols).contains("ghi", "dni", "dhi", "temp_c", "precip_mm", "humidity", "weather_txt");
    }

    // V118:metered 默认 1。默认给 0 的话 13 站会集体从分析里静默消失,屏上一片空白且没人报错。
    // 查 information_schema 的列默认值而不是数行:容器是 withReuse 的,行数会被上一轮残渣带偏(假红)
    @Test
    void v118_pv_station_metered_默认_1() {
        assertThat(jdbc.queryForObject("""
                SELECT COLUMN_DEFAULT FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pv_station' AND COLUMN_NAME = 'metered'
                """, String.class)).isEqualTo("1");
        // 既有 13 站也确实都是 1(NOT NULL DEFAULT 1 对存量行的效果)
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM pv_station WHERE metered <> 1", Integer.class)).isZero();
    }

    // V118 只建列不够:列不透出到 DTO 的话,分析屏拿不到 metered,「未装表」与「漏抄」还是混在一起。
    // 建表那一刀差点只改 SQL —— 这条断言就是防它。
    @Test
    void v118_metered_透出到_stations_接口() throws Exception {
        mvc.perform(get("/api/pv-meter/stations").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].metered").value(1));
    }

    // V119:三个断闸键都种进去了,且**全部默认关**——演示库/开发环境不该往外发付费请求
    @Test
    void v119_三个断闸键默认关() {
        assertThat(jdbc.queryForObject(
                "SELECT cfg_value FROM alloc_cfg WHERE scope = '' AND cfg_key = 'weather_api_enabled'",
                java.math.BigDecimal.class)).isEqualByComparingTo("0");
        assertThat(jdbc.queryForObject(
                "SELECT cfg_value FROM alloc_cfg WHERE scope = '' AND cfg_key = 'weather_source'",
                java.math.BigDecimal.class)).isEqualByComparingTo("0");
        assertThat(jdbc.queryForObject(
                "SELECT cfg_value FROM alloc_cfg WHERE scope = '' AND cfg_key = 'weather_api_monthly_cap'",
                java.math.BigDecimal.class)).isEqualByComparingTo("400");
    }

    // ── ② 行为 ────────────────────────────────────────────────────────────

    // 日聚合口径:GHI 是 W/m2 的**瞬时功率**,逐小时 × 1h ÷ 1000 才是 kWh/m2。
    // 忘了除 1000 或忘了这是功率不是能量,整屏的「应发多少度」都会差三个数量级
    @Test
    void 日聚合_24点500瓦每平米_等于12度每平米() throws Exception {
        mvc.perform(post("/api/weather/import").header("Authorization", auth())
                .contentType("application/json").content(hours(24, "500")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.imported").value(24))
                .andExpect(jsonPath("$.data.skipped").value(0));

        mvc.perform(get("/api/weather/daily").param("year", "2099").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].date").value("2099-03-01"))
                .andExpect(jsonPath("$.data[0].ghiKwh").value(12.0))   // 500 × 24 ÷ 1000
                .andExpect(jsonPath("$.data[0].hours").value(24));
    }

    // hours 是护栏,不是装饰:当日不足 24 点必须**如实报出**,前端据此剔除该日(§07)。
    // 补齐成 24 或整日丢弃都不行 —— 补齐会让日累计虚高,丢弃会让「今天数据不全」这件事消失
    @Test
    void hours不足24_如实报出_不补齐也不丢日() throws Exception {
        mvc.perform(post("/api/weather/import").header("Authorization", auth())
                .contentType("application/json").content(hours(20, "500")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.imported").value(20));

        mvc.perform(get("/api/weather/daily").param("year", "2099").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.length()").value(1))       // 该日仍出现
                .andExpect(jsonPath("$.data[0].hours").value(20))      // 如实 20,不是 24
                .andExpect(jsonPath("$.data[0].ghiKwh").value(10.0));  // 也不按 24 点外推
    }

    // hour_mask:第 h 位 = 该整点有记录。剔日的判据是它**连不连续**,不是 hours 的个数 ——
    // 真实天气源常常只给白天那几个小时,而且日照长度按季节变,只数个数分不清
    // 「当天日照短」和「漏了几行」。位图不透出来,前端就只能退回「不满 24 就剔」,把真实数据全剔光。
    @Test
    void hourMask_透出每个整点在不在() throws Exception {
        // 只导 6、7、8、10 点(缺 9 点)—— 位图应当是 0b0101_1100_0000 = 1472
        String body = "{\"rows\":["
                + "{\"obsTime\":\"2099-04-01 06:00\",\"ghi\":100},"
                + "{\"obsTime\":\"2099-04-01 07:00\",\"ghi\":300},"
                + "{\"obsTime\":\"2099-04-01 08:00\",\"ghi\":500},"
                + "{\"obsTime\":\"2099-04-01 10:00\",\"ghi\":600}"
                + "]}";
        mvc.perform(post("/api/weather/import").header("Authorization", auth())
                .contentType("application/json").content(body))
                .andExpect(jsonPath("$.data.imported").value(4));

        int expected = (1 << 6) | (1 << 7) | (1 << 8) | (1 << 10);
        mvc.perform(get("/api/weather/daily").param("year", "2099").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[0].hours").value(4))
                .andExpect(jsonPath("$.data[0].hourMask").value(expected));
    }

    // 幂等 upsert:同 obs_time 重导覆盖仍单行,值取后一次 —— 重导即修正,与 PvMeterService.importRows 同口径
    @Test
    void 同一时刻重导_覆盖不重复() throws Exception {
        mvc.perform(post("/api/weather/import").header("Authorization", auth())
                .contentType("application/json").content(hours(24, "500")))
                .andExpect(status().isOk());
        mvc.perform(post("/api/weather/import").header("Authorization", auth())
                .contentType("application/json").content(hours(24, "250")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.imported").value(24));

        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM weather_hour WHERE DATE(obs_time) = '2099-03-01'", Integer.class))
                .isEqualTo(24);
        mvc.perform(get("/api/weather/daily").param("year", "2099").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[0].ghiKwh").value(6.0));   // 取后一次的 250
    }

    // 行级错误跳过不整批拦(同 pvMeter 口径):非法时间 / 负辐射逐行报告,合法行照样入库
    @Test
    void 非法时间与负辐射_行级跳过_合法行照入() throws Exception {
        String body = "{\"rows\":["
                + "{\"obsTime\":\"2099-03-02 00:00\",\"ghi\":100},"
                + "{\"obsTime\":\"03/02/2099 01:00\",\"ghi\":100},"   // 非法格式
                + "{\"obsTime\":\"2099-03-02 02:00\",\"ghi\":-5}"     // 负辐射
                + "]}";
        String res = utf8(mvc.perform(post("/api/weather/import").header("Authorization", auth())
                .contentType("application/json").content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.imported").value(1))
                .andExpect(jsonPath("$.data.skipped").value(2))
                .andReturn());
        List<Integer> badIdx = JsonPath.read(res, "$.data.errors[*].rowIndex");
        assertThat(badIdx).containsExactly(1, 2);
    }

    // 鉴权门(RBAC-SPEC v2「读全开,写分权」):viewer 读得到、写不进。
    // 写端点漏登记 PermissionRegistry 的话 WriteAccessManager.resolve 返回 null → 这里会变 403 通过但
    // PermissionCoverageTest 红;反过来登记错了权限则这条会变 200
    @Test
    void 权限_viewer读通写403() throws Exception {
        String viewer = tokenOf("viewer", "viewer123");
        mvc.perform(get("/api/weather/daily").param("year", "2099").header("Authorization", "Bearer " + viewer))
                .andExpect(status().isOk());
        mvc.perform(post("/api/weather/import").header("Authorization", "Bearer " + viewer)
                .contentType("application/json").content(hours(1, "100")))
                .andExpect(status().isForbidden());
    }
}

package com.park.demo3.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jayway.jsonpath.JsonPath;
import com.park.demo3.AbstractMysqlIT;
import com.park.demo3.security.UserPermissionCache;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

/**
 * 逐屏放行的真 HTTP 验收(RBAC-SPEC §15.10)。v1 的病根(§0.1)是只给某一屏查看权的角色打开那一屏,有接口 403 就整屏加载失败 ——
 * 这里拿只勾一屏的角色把那屏实际会调的读接口全打一遍,一个都不许 403;再钉 URL 分不出屏、在 service 里再判的几处。
 * 整类 @Transactional:建的角色、账号、池、参数全部回滚;快照不随库回滚,@AfterTransaction 重载一次。
 */
@AutoConfigureMockMvc
@Transactional
class ScreenPermIT extends AbstractMysqlIT {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired UserPermissionCache cache;
    @Autowired ObjectMapper json;

    private static final String PASS = "init-pass-123";
    private static final String CHAIN = "/api/params/status?ym=2025-01 /api/alloc/pool-months /api/alloc/loss-months "
        + "/api/bill-notices/months /api/meters/months";

    @org.springframework.test.context.transaction.AfterTransaction
    void reloadCacheAfterRollback() { cache.reload(); }

    // ══════════ 只勾一屏查看:那屏的每个读接口都不是 403 ══════════

    /**
     * 六个单屏角色。读接口清单 = 勘察清单里这屏进屏、换期、开抽屉会调的(§15.5 的「依据」列)。
     * 破坏验证:读规则 /api/alloc/loss-months 去掉出账链 → 楼栋损耗那一组红(v3 的出账链月索引就是这样断的);
     *          /api/buildings/{id} 去掉 park → 出租与楼栋那一组红;/api/pv-meter/months 去掉 anomaly → 异常中心那一组红。
     */
    @Test
    void singleScreenRoles_everyReadTheirScreenMakesIsAllowed() throws Exception {
        String a = admin();
        int buildingId = jdbc.queryForObject("SELECT MIN(id) FROM building", Integer.class);
        Map<String, String> cases = new LinkedHashMap<>();
        cases.put("alloc-loss:view", CHAIN + " /api/alloc/loss?ym=2025-01 /api/params?ym=2025-01&key=loss_adj_qty");
        cases.put("rent-pnl:view", "/api/pnl/s1/overview /api/pnl/s1/2025 /api/s10/year-summary?year=2025 /api/pv/records?year=2025 "
            + "/api/charging/7/records?year=2025 /api/charging/8/records?year=2025 /api/elec/records?year=2025 "
            + "/api/utilities/13/records?year=2025 /api/utilities/14/records?year=2025 /api/salary/lunch-totals?year=2025");
        cases.put("pv-meter-analysis:view", "/api/analysis/months /api/analysis/settings /api/params?ym=2025-01 "
            + "/api/pv-meter/stations /api/pv-meter/readings?year=2025 /api/elec-cost/price-cfg?year=2025");
        cases.put("park:view", "/api/analysis/months /api/analysis/settings /api/tenants /api/buildings /api/buildings/summary "
            + "/api/buildings/" + buildingId + " /api/contracts");
        cases.put("anomaly:view", "/api/analysis/months /api/analysis/settings /api/analysis/s10-tenant-months "
            + "/api/analysis/ledger-tenant-months /api/params?ym=2025-01 /api/pv-meter/months /api/pv-meter/stations "
            + "/api/pv-meter/readings?year=2025 /api/charging/7/records?year=2025 /api/charging/8/records?year=2025 "
            + "/api/elec/records?year=2025 /api/utilities/13/records?year=2025");
        cases.put("reports-home:view,income-statement:view", "/api/s10/month-totals?year=2025&month=1 /api/reports/is/all/2025/1 "
            + "/api/companies /api/reports/is/1/years");
        for (Map.Entry<String, String> c : cases.entrySet()) {
            String t = userWith(a, c.getKey().split(","));
            for (String path : c.getValue().split(" ")) assertNot403(t, path, c.getKey());
        }
    }

    /**
     * 51 屏逐屏:只勾这一屏的查看,把 ScreenAccessMatrixTest 夹具里这屏会调的读接口真打一遍,一个都不许 403。
     * 单测只验 URL 规则;service 里还有按屏收窄的几处(参数表、充电桩车型、打码)只有真请求看得到。
     * 夹具路径不带查询参数:缺参的 400、id 不在的 404 都不算,只认 403。
     * 破坏验证:读规则 /api/budget/all 去掉 cockpit → 驾驶舱那一屏红;
     *          CpMeterService 对没有 charging-analysis:view 的人 years 一律 403 → 汽车、电动车两屏红。
     */
    @Test
    void everyScreen_viewOnly_noReadOfThatScreenIs403() throws Exception {
        String a = admin();
        Map<String, List<String>> reads = com.park.demo3.security.ScreenAccessMatrixTest.readsByScreen();
        assertThat(reads).as("前提:51 屏都在夹具里").hasSize(51);
        List<String> bad = new ArrayList<>();
        for (Map.Entry<String, List<String>> e : reads.entrySet()) {
            String t = userWith(a, e.getKey() + ":view");
            for (String path : e.getValue()) {
                MvcResult r = mvc.perform(get(path).header("Authorization", hdr(t))).andReturn();
                String b = body(r);
                if (r.getResponse().getStatus() == 403 || bizCode(b) == 403) bad.add(e.getKey() + " GET " + path + " → " + b);
            }
        }
        assertThat(bad).isEmpty();
    }

    /**
     * 报表中心只拿合计:勾稽③读 /api/s10/month-totals,附表10 的逐租户宽表不给;卡片上的数要对应报表的查看。
     * 破坏验证:读规则 /api/s10/** 并上 reports-home → 宽表那条红;/api/reports/is/all/** 并上 reports-home → 最后一条红。
     */
    @Test
    void reportsHome_readsTotalsOnly() throws Exception {
        String a = admin();
        String withIs = userWith(a, "reports-home:view", "income-statement:view");
        assertThat(status(get("/api/s10/1/2025/1"), withIs)).as("附表10 宽表只给本屏").isEqualTo(403);
        String totals = body(mvc.perform(get("/api/s10/month-totals").param("year", "2025").param("month", "1")
            .header("Authorization", hdr(withIs))).andReturn());
        assertThat(JsonPath.<Map<String, Object>>read(totals, "$.data")).containsOnlyKeys("1", "2", "3", "4");
        String homeOnly = userWith(a, "reports-home:view");
        assertThat(status(get("/api/s10/month-totals?year=2025&month=1"), homeOnly)).isEqualTo(200);
        assertThat(status(get("/api/reports/is/all/2025/1"), homeOnly)).isEqualTo(403);
    }

    // ══════════ URL 分不出屏、service 再判的几处 ══════════

    /**
     * 汽车、电动车两屏共用一组接口:只看汽车桩的人只拿到汽车桩;有汽车桩库的人建汽车桩照常、改电动车桩 403。
     * 破坏验证:CpMeterService.stationList 不按车型过滤 → 第一条红;updateStation 不判桩原来的车型 → 「改电动车桩」那条红。
     */
    @Test
    void chargingScreens_splitByVehicleType() throws Exception {
        String a = admin();
        int ebike = ebikeStation(a);
        assertThat(code(post("/api/cp-meter/stations").contentType("application/json")
            .content("{\"name\":\"IT夹具汽车桩\",\"operator\":\"IT\",\"vehicleType\":\"car\"}"), a)).isZero();
        String car = userWith(a, "car-charging:archive");
        List<String> types = JsonPath.read(body(mvc.perform(get("/api/cp-meter/stations").header("Authorization", hdr(car))).andReturn()),
            "$.data[*].vehicleType");
        assertThat(types).as("前提:库里两种桩都有").isNotEmpty();
        assertThat(types).containsOnly("car");
        assertThat(JsonPath.<List<String>>read(body(mvc.perform(get("/api/cp-meter/stations").header("Authorization", hdr(a)))
            .andReturn()), "$.data[*].vehicleType")).contains("car", "ebike");
        assertThat(code(put("/api/cp-meter/stations/" + ebike).contentType("application/json")
            .content("{\"name\":\"IT改电动车桩\",\"operator\":\"IT\",\"vehicleType\":\"ebike\"}"), car)).isEqualTo(403);
        assertThat(code(post("/api/cp-meter/stations").contentType("application/json")
            .content("{\"name\":\"IT汽车桩" + System.nanoTime() % 100000 + "\",\"operator\":\"IT\",\"vehicleType\":\"car\"}"), car))
            .isZero();
        assertThat(code(get("/api/cp-meter/months").param("vehicleType", "ebike"), car)).as("电动车那屏的账期").isEqualTo(403);
    }

    /**
     * /api/params 不带 key 会回当月全表:只勾异常提醒中心的人只拿到 pv_ 开头的键(户级例外里有租户名)。
     * 夹具先落一个 pv_ 键,不然「全是 pv_」可能是空集合在空转。
     * 破坏验证:ParamController.list 去掉按屏收窄 → 红。
     */
    @Test
    void paramsList_isNarrowedToWhatTheScreenUses() throws Exception {
        String a = admin();
        assertThat(code(put("/api/params").contentType("application/json")
            .content("{\"key\":\"pv_band_sigma\",\"scope\":\"\",\"acctMonth\":\"2079-01\",\"mode\":\"from\",\"value\":2}"), a)).isZero();
        String anomaly = userWith(a, "anomaly:view");
        List<String> keys = JsonPath.read(body(mvc.perform(get("/api/params").param("ym", "2079-01")
            .header("Authorization", hdr(anomaly))).andReturn()), "$.data[*].key");
        assertThat(keys).contains("pv_band_sigma").allMatch(k -> k.startsWith("pv_"));
        List<String> all = JsonPath.read(body(mvc.perform(get("/api/params").param("ym", "2079-01")
            .header("Authorization", hdr(a))).andReturn()), "$.data[*].key");
        assertThat(all).as("对照:有计费参数查看的照旧全表").anyMatch(k -> !k.startsWith("pv_"));
    }

    /**
     * 系数簿与池配置写同一个端点:只有「催缴单 · 系数簿」的人只许改二期电梯 / 消防池受益户的层份。
     * 夹具的二期电梯池在初始版之后按月改过分母,请求照系数簿原样带初始版的 coefficient(GET /alloc/rules 不带 ym 拿到的)。
     * 破坏验证:AllocService.coefBookOnlyShares 恒 true → 「改受益户 / 一期池 / 照明池」三条红;
     *          恒 false 或改成逐字段比请求原文(含 coefficient)→ 「改层份 200」那条红。
     */
    @Test
    void coefBookOnly_mayChangeFloorSharesOfPhase2ElevatorAndFirePoolsOnly() throws Exception {
        String a = admin();
        List<Integer> t = jdbc.queryForList("SELECT id FROM tenant ORDER BY id LIMIT 3", Integer.class);
        int p2Elevator = pool(a, "p2", "share_elec_elevator", t);
        int p1Elevator = pool(a, "p1", "share_elec_elevator", t);
        int p2Light = pool(a, "p2", "share_elec_light", t);
        assertThat(code(put("/api/params").contentType("application/json").content("{\"key\":\"coefficient\",\"scope\":\"rule:"
            + p2Elevator + "\",\"acctMonth\":\"2079-02\",\"mode\":\"from\",\"value\":12}"), a)).as("分母按月改过版").isZero();
        String coef = userWith(a, "bill-notices:coef");

        Map<String, Object> dto = ruleOf(coef, p2Elevator);
        assertThat(((Number) dto.get("coefficient")).doubleValue()).as("系数簿拿到的是初始版分母").isEqualTo(10.0);
        assertThat(code(put("/api/alloc/rules/" + p2Elevator).contentType("application/json")
            .content(shares(dto, t.subList(0, 2), "0.5")), coef)).as("只改层份").isZero();
        assertThat(code(put("/api/alloc/rules/" + p2Elevator).contentType("application/json")
            .content(shares(dto, t, "1")), coef)).as("多加一户 = 改受益户").isEqualTo(403);
        assertThat(code(put("/api/alloc/rules/" + p1Elevator).contentType("application/json")
            .content(shares(ruleOf(coef, p1Elevator), t.subList(0, 2), "0.5")), coef)).as("一期的池").isEqualTo(403);
        assertThat(code(put("/api/alloc/rules/" + p2Light).contentType("application/json")
            .content(shares(ruleOf(coef, p2Light), t.subList(0, 2), "0.5")), coef)).as("二期照明池").isEqualTo(403);

        // PUT /api/params:系数簿只认 12 个白名单键的户级作用域
        // 破坏验证:ParamService.requireWritePerm 对户级一律放系数簿 → 后两条红
        String tenant = "tenant:" + t.get(0);
        assertThat(code(put("/api/params").contentType("application/json").content("{\"key\":\"lamp_rate\",\"scope\":\"" + tenant
            + "\",\"acctMonth\":\"2079-01\",\"mode\":\"from\",\"value\":1.2}"), coef)).isZero();
        assertThat(code(put("/api/params").contentType("application/json").content("{\"key\":\"loss_base_park_meter\",\"scope\":\""
            + tenant + "\",\"acctMonth\":\"2079-01\",\"mode\":\"from\",\"value\":1}"), coef)).isEqualTo(403);
        assertThat(code(put("/api/params").contentType("application/json").content("{\"key\":\"loss_base_form_b1\",\"scope\":\""
            + tenant + "\",\"acctMonth\":\"2079-01\",\"mode\":\"from\",\"value\":2}"), coef)).isEqualTo(403);
    }

    /**
     * 账册模板按账册所属屏判(URL 只有 bookId):只有附表10 更换版本的人换不了月度台账的版;
     * 只有利润表编辑的人能交利润表的审(v3 URL 门漏了报表编辑,交审在 URL 层就 403)。
     * 破坏验证:BookService.requireBookAction 去掉 → 第一条红;写规则 submit 去掉 income-statement:edit → 第三条红。
     */
    @Test
    void bookVersionByScreen_andReportEditCanSubmitItsReview() throws Exception {
        String a = admin();
        int ledgerBook = jdbc.queryForObject("SELECT MIN(id) FROM ledger_book WHERE screen='ledger' AND company_id IS NOT NULL", Integer.class);
        int s10Book = jdbc.queryForObject("SELECT MIN(id) FROM ledger_book WHERE screen='s10'", Integer.class);
        String s10v = userWith(a, "sales-income:version");
        String pin = "{\"ver\":1,\"year\":2079,\"month\":1}";
        assertThat(code(post("/api/books/" + ledgerBook + "/template/pin").contentType("application/json").content(pin), s10v))
            .isEqualTo(403);
        assertThat(code(post("/api/books/" + s10Book + "/template/pin").contentType("application/json").content(pin), s10v))
            .as("自己那一屏的账册:过了权限,后面怎样是业务的事").isNotEqualTo(403);

        String is = userWith(a, "income-statement:edit");
        int companyId = jdbc.queryForObject("SELECT MIN(id) FROM management_company", Integer.class);
        MvcResult r = mvc.perform(post("/api/review/report-is:" + companyId + ":2079-01/submit").header("Authorization", hdr(is))).andReturn();
        assertThat(r.getResponse().getStatus()).as("URL 门放行").isNotEqualTo(403);
        assertThat((int) JsonPath.read(body(r), "$.code")).as("kind 的交审权也是它").isNotEqualTo(403);
        assertThat(code(post("/api/review/report-bs:" + companyId + ":2079-01/submit"), is)).as("别的报表不行").isEqualTo(403);
    }

    /**
     * 附表7、8 两屏共用一组按 id 的写:批删只删 URL 那张附表的行,送进来的别屏 id 按不存在算(同单条删除)。
     * 一批里混一行本屏的,证明这不是整批被拒的空转。
     * 破坏验证:ChargingService.batchDelete 去掉 scheduleNo 判断 → 「电动车那行还在」红。
     */
    @Test
    void chargingBatchDelete_onlyTouchesTheScheduleInTheUrl() throws Exception {
        String a = admin();
        long ebike = record(a, 8, "dingding");
        long car = record(a, 7, "wancheng");
        String carEditor = userWith(a, "car-charging:edit");
        String r = body(mvc.perform(delete("/api/charging/7/batch").header("Authorization", hdr(carEditor))
            .contentType("application/json").content("{\"ids\":[" + ebike + "," + car + "]}")).andReturn());
        assertThat((int) JsonPath.read(r, "$.data.deleted")).as(r).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM charging_record WHERE id = ?", Integer.class, ebike))
            .as("电动车那行还在").isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM charging_record WHERE id = ?", Integer.class, car))
            .as("汽车那行删了").isZero();
    }

    /**
     * 三张报表的自定义行按 id 删:id 是别的报表的 → 404,两边都不动(原来会按 URL 的报表去删同名 row_key,删掉本报表里另一行)。
     * 破坏验证:ReportService.deleteCustomRow 去掉 statement 判断 → 红。
     */
    @Test
    void reportCustomRowDelete_idOfAnotherStatementIsNotFound() throws Exception {
        String a = admin();
        int co = jdbc.queryForObject("SELECT MIN(id) FROM management_company", Integer.class);
        String key = "it-x" + System.nanoTime() % 100000;
        jdbc.update("INSERT INTO report_custom_row (company_id, statement, row_key, parent_key, label, level, created_at) "
            + "VALUES (?, 'bs', ?, 'IT', 'IT资产负债表行', 1, NOW()), (?, 'is', ?, 'IT', 'IT利润表行', 1, NOW())", co, key, co, key);
        long bsRow = jdbc.queryForObject("SELECT id FROM report_custom_row WHERE company_id = ? AND statement = 'bs' AND row_key = ?",
            Long.class, co, key);
        String is = userWith(a, "income-statement:edit");
        assertThat(code(delete("/api/reports/is/custom-row/" + bsRow), is)).isEqualTo(404);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM report_custom_row WHERE company_id = ? AND row_key = ?",
            Integer.class, co, key)).as("两张报表的行都还在").isEqualTo(2);
    }

    /** 破坏验证:写规则 POST /api/auth/approvals 挪到 /approvals/** 后面 → 第一条红;铁律 4 的拒绝规则去掉 → 第二条红。 */
    @Test
    void viewerCannotAskRemotely_andNonLiteralSegmentsAreDeniedEvenForAdmin() throws Exception {
        String v = login("viewer", "viewer123");
        assertThat(mvc.perform(post("/api/auth/approvals").header("Authorization", hdr(v)).contentType("application/json")
            .content("{\"perms\":[\"ledger:edit\"],\"approver\":\"admin\"}")).andReturn().getResponse().getStatus()).isEqualTo(403);
        String a = admin();
        assertThat(status(get("/api/charging/07/records?year=2025"), a)).as("07 不是 7:显式拒绝,系统管理员也一样").isEqualTo(403);
        assertThat(status(get("/api/charging/7/records?year=2025"), a)).isEqualTo(200);
    }

    // ══════════ helpers ══════════

    private int pool(String a, String zone, String fee, List<Integer> tenants) throws Exception {
        String members = tenants.subList(0, 2).stream().map(id -> "{\"tenantId\":" + id + ",\"weight\":1}")
            .collect(Collectors.joining(",", "[", "]"));
        String r = body(mvc.perform(post("/api/alloc/rules").header("Authorization", hdr(a)).contentType("application/json")
            .content("{\"zone\":\"" + zone + "\",\"method\":\"floor\",\"coefficient\":10,\"feeKey\":\"" + fee + "\",\"members\":" + members
                + ",\"floorLabel\":\"IT层\",\"side\":\"IT\",\"feeName\":\"IT系数簿" + System.nanoTime() % 1000000
                + "\",\"memberMonth\":\"2079-01\"}")).andReturn());
        assertThat((int) JsonPath.read(r, "$.code")).as(r).isZero();
        return JsonPath.read(r, "$.data.id");
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> ruleOf(String token, int id) throws Exception {
        List<Map<String, Object>> hit = JsonPath.read(body(mvc.perform(get("/api/alloc/rules").header("Authorization", hdr(token)))
            .andReturn()), "$.data[?(@.id==" + id + ")]");
        assertThat(hit).hasSize(1);
        return hit.get(0);
    }

    /** 照系数簿的做法:把读到的池原样送回,只换受益户和层份,写进 2079-02 起的版本。 */
    private String shares(Map<String, Object> dto, List<Integer> tenants, String weight) throws Exception {
        Map<String, Object> req = new LinkedHashMap<>(dto);
        for (String k : List.of("id", "sortNo")) req.remove(k);
        req.put("members", tenants.stream().map(id -> Map.of("tenantId", id, "weight", new java.math.BigDecimal(weight))).toList());
        req.put("memberMonth", "2079-02");
        return json.writeValueAsString(req);
    }

    /** 在附表 no 建一行 2096-03 的手工记录,返回 id。 */
    private long record(String a, int no, String cat) throws Exception {
        String r = body(mvc.perform(post("/api/charging/" + no + "/records").header("Authorization", hdr(a)).contentType("application/json")
            .content("{\"scheduleNo\":" + no + ",\"cat\":\"" + cat + "\",\"acctMonth\":\"2096-03\",\"kwh\":1,\"fee\":1,\"cost\":0}")).andReturn());
        assertThat((int) JsonPath.read(r, "$.code")).as(r).isZero();
        return ((Number) JsonPath.read(r, "$.data.id")).longValue();
    }

    /** 回包里的业务码;不是 JSON 信封(数组、空体)回 0。 */
    private static int bizCode(String b) {
        if (!b.startsWith("{")) return 0;
        try {
            Object c = JsonPath.read(b, "$.code");
            return c instanceof Number n ? n.intValue() : 0;
        } catch (com.jayway.jsonpath.PathNotFoundException e) { return 0; }
    }

    private int ebikeStation(String a) throws Exception {
        List<Integer> ids = jdbc.queryForList("SELECT id FROM cp_station WHERE vehicle_type='ebike' ORDER BY id LIMIT 1", Integer.class);
        if (!ids.isEmpty()) return ids.get(0);
        String r = body(mvc.perform(post("/api/cp-meter/stations").header("Authorization", hdr(a)).contentType("application/json")
            .content("{\"name\":\"IT电动车桩\",\"operator\":\"IT\",\"vehicleType\":\"ebike\"}")).andReturn());
        return JsonPath.read(r, "$.data.id");
    }

    /** 建一个只带这几个点的自建角色,挂一个新账号,返回它的令牌。 */
    private String userWith(String admin, String... perms) throws Exception {
        String ps = Arrays.stream(perms).map(p -> "\"" + p + "\"").collect(Collectors.joining(","));
        String r = body(mvc.perform(post("/api/system/roles").header("Authorization", hdr(admin)).contentType("application/json")
            .content("{\"code\":\"it_scr_" + System.nanoTime() % 1_000_000_000L + "\",\"name\":\"单屏\",\"navLayers\":[\"data\"],"
                   + "\"perms\":[" + ps + "]}")).andReturn());
        assertThat((int) JsonPath.read(r, "$.code")).as(r).isZero();
        assertThat(JsonPath.<List<String>>read(r, "$.data.perms")).as("夹具的键都认得").containsExactlyInAnyOrder(perms);
        int roleId = JsonPath.read(r, "$.data.id");
        String u = "it-scr-" + System.nanoTime();
        String c = body(mvc.perform(post("/api/system/users").header("Authorization", hdr(admin)).contentType("application/json")
            .content("{\"username\":\"" + u + "\",\"displayName\":\"单屏\",\"password\":\"" + PASS + "\",\"roleIds\":[" + roleId + "]}"))
            .andReturn());
        assertThat((int) JsonPath.read(c, "$.code")).as(c).isZero();
        passwordAlreadyChanged(u);
        return login(u, PASS);
    }

    private void assertNot403(String token, String path, String who) throws Exception {
        MvcResult r = mvc.perform(get(path).header("Authorization", hdr(token))).andReturn();
        assertThat(r.getResponse().getStatus()).as(who + " GET " + path + " → " + body(r)).isNotEqualTo(403);
        String b = body(r);
        if (b.startsWith("{")) assertThat((int) JsonPath.read(b, "$.code")).as(who + " GET " + path + " → " + b).isNotEqualTo(403);
    }

    private int status(MockHttpServletRequestBuilder req, String token) throws Exception {
        return mvc.perform(req.header("Authorization", hdr(token))).andReturn().getResponse().getStatus();
    }

    /** 业务 403 是 HTTP 200 + code 403(BizException);URL 门的 403 是 HTTP 403。两种都算 403。 */
    private int code(MockHttpServletRequestBuilder req, String token) throws Exception {
        MvcResult r = mvc.perform(req.header("Authorization", hdr(token))).andReturn();
        if (r.getResponse().getStatus() == 403) return 403;
        return JsonPath.read(body(r), "$.code");
    }

    private String admin() throws Exception { return login("admin", "admin123"); }

    private String login(String u, String p) throws Exception {
        return JsonPath.read(body(mvc.perform(post("/api/auth/login").contentType("application/json")
            .content("{\"username\":\"" + u + "\",\"password\":\"" + p + "\"}")).andReturn()), "$.data.token");
    }

    private static String hdr(String t) { return "Bearer " + t; }

    private static String body(MvcResult r) {
        return new String(r.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
    }
}

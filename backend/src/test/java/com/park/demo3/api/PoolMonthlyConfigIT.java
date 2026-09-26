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

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

// 公摊池按月配置(docs/superpowers/2026-09-26-pool-monthly-config-plan.md D1–D6,V131)端到端:
// 绑定表/折入链的版本组(含空组)在读侧与引擎上的取值、写入「相同不写」、冻结守卫区间、取整位按月、G1。
// @Transactional 回滚;数据落 2099 远期槽,自建自证(同 AllocApiIT 的探针模式)。
@AutoConfigureMockMvc
@org.springframework.transaction.annotation.Transactional
class PoolMonthlyConfigIT extends AbstractMysqlIT {

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    private String token;

    @BeforeEach
    void login() throws Exception {
        token = JsonPath.read(body(mvc.perform(post("/api/auth/login").contentType("application/json")
            .content("{\"username\":\"admin\",\"password\":\"admin123\"}")).andReturn()), "$.data.token");
    }

    private static String body(MvcResult r) { return new String(r.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8); }
    private String auth() { return "Bearer " + token; }

    private String send(org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder b, String json) throws Exception {
        return body(mvc.perform(b.header("Authorization", auth()).contentType("application/json").content(json)).andReturn());
    }

    private int code(String res) { return JsonPath.read(res, "$.code"); }

    private int postId(String url, String json) throws Exception {
        String res = send(post(url), json);
        assertThat(code(res)).as(res).isZero();
        return JsonPath.read(res, "$.data.id");
    }

    private int putRule(int id, String json) throws Exception { return code(send(put("/api/alloc/rules/" + id), json)); }

    private int meter(String name, String zone) throws Exception {
        return postId("/api/meters", "{\"kind\":\"elec\",\"zone\":\"" + zone + "\",\"name\":\"" + name + "\",\"ownership\":\"share\"}");
    }

    private void reading(int meterId, String ym, String prev, String curr) throws Exception {
        assertThat(code(send(post("/api/meters/readings"), "{\"meterId\":" + meterId + ",\"ym\":\"" + ym
            + "\",\"prevTotal\":" + prev + ",\"currTotal\":" + curr + "}"))).isZero();
    }

    // 池引擎门禁:有规则的期区缺当月电价整区拒绝生成(同 AllocApiIT.price/p2Prices)
    private void prices(String ym) throws Exception {
        for (String[] kv : new String[][]{{"elec_commercial", "0.79416875"}, {"elec_sharp", "1.50076875"},
                {"elec_peak", "1.20606875"}, {"elec_flat", "0.72076875"}, {"elec_valley", "0.29116875"}})
            send(put("/api/price-cfg"), "{\"scope\":\"\",\"cfgKey\":\"" + kv[0] + "\",\"acctMonth\":\"" + ym + "\",\"value\":" + kv[1] + "}");
    }

    private void generate(String ym) throws Exception {
        String res = body(mvc.perform(post("/api/alloc/generate").param("ym", ym).header("Authorization", auth())).andReturn());
        assertThat(code(res)).as(res).isZero();
    }

    private Map<String, Object> poolRow(String ym, int ruleId) throws Exception {
        String res = body(mvc.perform(get("/api/alloc/pools").param("ym", ym).header("Authorization", auth())).andReturn());
        List<Map<String, Object>> rows = JsonPath.read(res, "$.data.rows[?(@.ruleId==" + ruleId + ")]");
        assertThat(rows).hasSize(1);
        return rows.get(0);
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> list(Map<String, Object> row, String field) {
        return (List<Map<String, Object>>) row.get(field);
    }

    private static List<Object> col(List<Map<String, Object>> rows, String field) {
        return rows.stream().map(m -> m.get(field)).toList();
    }

    private Map<String, Object> ruleDto(String ym, int ruleId) throws Exception {
        var req = get("/api/alloc/rules").header("Authorization", auth());
        if (ym != null) req = req.param("ym", ym);
        List<Map<String, Object>> rows = JsonPath.read(body(mvc.perform(req).andReturn()), "$.data[?(@.id==" + ruleId + ")]");
        assertThat(rows).hasSize(1);
        return rows.get(0);
    }

    private int rows(String sql, Object... args) { return jdbc.queryForObject(sql, Integer.class, args); }

    private Map<String, Object> paramRow(String ym, String scope, String key) throws Exception {
        List<Map<String, Object>> rs = JsonPath.read(body(mvc.perform(get("/api/params").param("ym", ym).param("scope", scope)
            .param("key", key).header("Authorization", auth())).andReturn()), "$.data[?(@.scope=='" + scope + "')]");
        assertThat(rs).hasSize(1);
        return rs.get(0);
    }

    private static String none(String zone, String feeName, String extra) {
        return "{\"zone\":\"" + zone + "\",\"method\":\"none\",\"feeKey\":\"share_elec_floor\",\"feeName\":\"" + feeName + "\"" + extra + "}";
    }

    // ── D1/D3/D7:绑定表按月版本 —— '' → 2099-02 加一块 → 2099-03 空组;读侧(/pools /rules)与引擎(qty)同一份 ──
    @Test
    void bindingVersions_readSideAndEngine_includingEmptyGroup() throws Exception {
        int a = meter("IT-V131甲表", "p1"), b = meter("IT-V131乙表", "p1");
        for (String ym : List.of("2099-01", "2099-02", "2099-03")) {
            reading(a, ym, "0", "100"); reading(b, ym, "0", "10"); prices(ym);
        }
        int p = postId("/api/alloc/rules", none("p1", "IT-V131按月", ",\"meterIds\":[" + a + "]"));
        assertThat(putRule(p, none("p1", "IT-V131按月", ",\"meterIds\":[" + a + "," + b + "],\"memberMonth\":\"2099-02\""))).isZero();
        assertThat(putRule(p, none("p1", "IT-V131按月", ",\"meterIds\":[],\"memberMonth\":\"2099-03\""))).isZero();

        Map<String, Object> jan = poolRow("2099-01", p), feb = poolRow("2099-02", p), mar = poolRow("2099-03", p);
        assertThat(col(list(jan, "meters"), "meterId")).containsExactly(a);
        assertThat(col(list(jan, "meters"), "src")).containsExactly("default");
        assertThat(col(list(feb, "meters"), "meterId")).containsExactlyInAnyOrder(a, b);
        assertThat(col(list(feb, "meters"), "src")).containsOnly("month");
        assertThat(list(mar, "meters")).isEmpty();                     // 空组:不回退到 02 或 ''
        assertThat((List<Object>) ruleDto("2099-02", p).get("meterIds")).containsExactlyInAnyOrder(a, b);
        assertThat((List<Object>) ruleDto(null, p).get("meterIds")).containsExactly(a);   // ym 空 = 初始版
        assertThat(rows("SELECT COUNT(*) FROM alloc_rule_version WHERE rule_id=? AND part='meter'", p)).isEqualTo(2);

        generate("2099-01"); generate("2099-02"); generate("2099-03");
        assertThat(((Number) poolRow("2099-01", p).get("qtyTotal")).doubleValue()).isEqualTo(100.0);
        assertThat(((Number) poolRow("2099-02", p).get("qtyTotal")).doubleValue()).isEqualTo(110.0);
        mar = poolRow("2099-03", p);
        assertThat(mar.get("qtyTotal")).isNull();
        assertThat(mar.get("warn")).as("有意不绑的空组是挂零陈列,不是缺读数").isNull();
    }

    // ── D4 写入:相同不写 / 不同才写 / 同月整组覆盖 / null 调用方 = 清空初始版(旧语义)且不碰别的月 ──
    @Test
    void writeSemantics_sameSkips_differentWrites_sameMonthReplaces_nullClearsInitialOnly() throws Exception {
        int a = meter("IT-V131写甲", "p1"), b = meter("IT-V131写乙", "p1");
        int p = postId("/api/alloc/rules", none("p1", "IT-V131写入", ",\"meterIds\":[" + a + "]"));
        String inMay = "SELECT COUNT(*) FROM alloc_rule_meter WHERE rule_id=? AND acct_month='2099-05'";

        // 与站在 05 的有效组('' 组 {a})相同 → 一行不写、不登记版本
        assertThat(putRule(p, none("p1", "IT-V131写入", ",\"meterIds\":[" + a + "],\"memberMonth\":\"2099-05\""))).isZero();
        assertThat(rows(inMay, p)).isZero();
        assertThat(rows("SELECT COUNT(*) FROM alloc_rule_version WHERE rule_id=?", p)).isZero();
        // 所以之后改初始版,05 起跟着变(没被拍成 05 月快照)
        assertThat(putRule(p, none("p1", "IT-V131写入", ",\"meterIds\":[" + b + "]"))).isZero();
        assertThat(col(list(poolRow("2099-05", p), "meters"), "meterId")).containsExactly(b);

        // 不同 → 写 05 组并登记
        assertThat(putRule(p, none("p1", "IT-V131写入", ",\"meters\":[{\"meterId\":" + a + ",\"sign\":1}],\"memberMonth\":\"2099-05\""))).isZero();
        assertThat(rows(inMay, p)).isEqualTo(1);
        // 改池日志:acct_month=05(「需重算」只点 05 起的月),note 写出增减的表
        Map<String, Object> log = jdbc.queryForMap("SELECT acct_month, note FROM param_change_log WHERE scope=? ORDER BY id DESC LIMIT 1", "rule:" + p);
        assertThat(log.get("acct_month")).isEqualTo("2099-05");
        assertThat((String) log.get("note")).contains("绑定表 +IT-V131写甲 −IT-V131写乙");
        assertThat(col(list(poolRow("2099-05", p), "meters"), "meterId")).containsExactly(a);
        assertThat(col(list(poolRow("2099-04", p), "meters"), "meterId")).containsExactly(b);

        // 同月再写 = 整组替换,不叠加
        assertThat(putRule(p, none("p1", "IT-V131写入", ",\"meters\":[{\"meterId\":" + a + ",\"sign\":1},{\"meterId\":" + b
            + ",\"sign\":-1}],\"memberMonth\":\"2099-05\""))).isZero();
        assertThat(rows(inMay, p)).isEqualTo(2);
        assertThat(col(list(poolRow("2099-05", p), "meters"), "sign")).containsExactlyInAnyOrder(1, -1);

        // null 调用方(不带 meters/meterIds、不带 memberMonth):旧语义「清空」只作用于初始版 '',05 组不动
        assertThat(putRule(p, none("p1", "IT-V131写入", ""))).isZero();
        assertThat(rows("SELECT COUNT(*) FROM alloc_rule_meter WHERE rule_id=? AND acct_month=''", p)).isZero();
        assertThat(rows(inMay, p)).isEqualTo(2);

        // 折入链同一套(按 dst 池分组):05 起折入 s,07 起空组
        int s = postId("/api/alloc/rules", none("p1", "IT-V131折入源", ""));
        String keepMay = ",\"meters\":[{\"meterId\":" + a + ",\"sign\":1},{\"meterId\":" + b + ",\"sign\":-1}]";
        assertThat(putRule(p, none("p1", "IT-V131写入", keepMay + ",\"links\":[{\"ruleId\":" + s
            + ",\"type\":\"fold_price\"}],\"memberMonth\":\"2099-05\""))).isZero();
        assertThat(putRule(p, none("p1", "IT-V131写入", keepMay + ",\"links\":[],\"memberMonth\":\"2099-07\""))).isZero();
        assertThat(rows(inMay, p)).as("绑定表与 05 组相同,折入那次保存不重写它").isEqualTo(2);
        assertThat(rows("SELECT COUNT(*) FROM alloc_rule_meter WHERE rule_id=? AND acct_month='2099-07'", p)).isZero();
        assertThat(list(poolRow("2099-04", p), "links")).isEmpty();
        assertThat(col(list(poolRow("2099-06", p), "links"), "ruleId")).containsExactly(s);
        assertThat(col(list(poolRow("2099-06", p), "links"), "src")).containsExactly("month");
        assertThat(list(poolRow("2099-07", p), "links")).isEmpty();
        assertThat(rows("SELECT COUNT(*) FROM alloc_rule_version WHERE rule_id=? AND part='link'", p)).isEqualTo(2);
    }

    // ── D4 守卫:M 起到该部分下一个版本之前(无下一个 = 最大已生成月),三部分取并集;受益人一起修 ──
    @Test
    void guard_coversEffectiveRangeOfWrittenParts() throws Exception {
        int a = meter("IT-V131守甲", "p1"), b = meter("IT-V131守乙", "p1");
        int t1 = postId("/api/tenants", "{\"companyName\":\"IT-V131守户甲\",\"businessType\":\"IT\"}");
        int t2 = postId("/api/tenants", "{\"companyName\":\"IT-V131守户乙\",\"businessType\":\"IT\"}");
        String m1 = ",\"members\":[{\"tenantId\":" + t1 + "}]", m2 = ",\"members\":[{\"tenantId\":" + t2 + "}]";
        int p = postId("/api/alloc/rules", none("p1", "IT-V131守卫", ",\"meterIds\":[" + a + "]" + m1));
        // 06 起:绑定表与受益人各有一个更晚的版本
        assertThat(putRule(p, none("p1", "IT-V131守卫", ",\"meterIds\":[" + a + "," + b + "]" + m2 + ",\"memberMonth\":\"2099-06\""))).isZero();
        int q = postId("/api/alloc/rules", none("p1", "IT-V131守卫二", ",\"meterIds\":[" + a + "]" + m1));
        int src = postId("/api/alloc/rules", none("p1", "IT-V131守卫源", ""));
        // 没有受益人的池(园区自担):绑定表 06 起另有一组
        int n = postId("/api/alloc/rules", none("p1", "IT-V131守卫无户", ",\"meterIds\":[" + a + "]"));
        assertThat(putRule(n, none("p1", "IT-V131守卫无户", ",\"meterIds\":[" + a + "," + b + "],\"memberMonth\":\"2099-06\""))).isZero();
        reading(a, "2099-09", "0", "1");   // 最大已生成月 = 2099-09
        jdbc.update("INSERT INTO review_state (review_key, kind, period, scope, status) VALUES ('alloc:2099-07','alloc','2099-07',NULL,'approved')");

        // 改 05 的绑定表:绑定表管到 06 之前;受益人 m1 与站在 05 的有效组相同,不写 → 只守 05 → 放行
        assertThat(putRule(p, none("p1", "IT-V131守卫", ",\"meterIds\":[" + b + "]" + m1 + ",\"memberMonth\":\"2099-05\""))).isZero();
        // 改 05 的折入链:折入链没有更晚的版本 → 守 [05, 09],07 已审 → 423
        assertThat(putRule(p, none("p1", "IT-V131守卫", ",\"meterIds\":[" + b + "]" + m1 + ",\"links\":[{\"ruleId\":" + src
            + ",\"type\":\"fold_price\"}],\"memberMonth\":\"2099-05\""))).isEqualTo(423);
        // 只改受益人:受益人只有 '' 组 → 前滚到 09,07 已审 → 423(旧实现只守 05 一个月,这里会放行)
        assertThat(putRule(q, none("p1", "IT-V131守卫二", ",\"meterIds\":[" + a + "]" + m2 + ",\"memberMonth\":\"2099-05\""))).isEqualTo(423);
        // 对抗复查 A3:无受益人的池只改 05 的绑定表 → 受益人一行没写,不进守卫;绑定表管到 06 之前 → 放行
        assertThat(putRule(n, none("p1", "IT-V131守卫无户", ",\"meterIds\":[" + b + "],\"memberMonth\":\"2099-05\""))).isZero();
        // 08 起改:[08, 09] 不含 07 → 放行
        assertThat(putRule(q, none("p1", "IT-V131守卫二", ",\"meterIds\":[" + a + "]" + m2 + ",\"memberMonth\":\"2099-08\""))).isZero();
    }

    // ── D5 取整位:没有行 = 2;参数页按月写 3 → 该月起 std 取 3 位;值域只许 2/3;既有池 PUT roundScale 被忽略 ──
    @Test
    void roundScale_resolvedPerMonth_defaultTwo() throws Exception {
        int m = meter("IT-V131取整表", "p1");
        for (String ym : List.of("2099-10", "2099-11")) { reading(m, ym, "0", "100"); prices(ym); }
        // p1 ref:std = ROUND(100 ÷ 7 × (0.79416875 + 0.32), 位数) = 15.9166964… → 2 位 15.92 / 3 位 15.917
        int p = postId("/api/alloc/rules", "{\"zone\":\"p1\",\"method\":\"ref\",\"feeKey\":\"share_elec_floor\","
            + "\"feeName\":\"IT-V131取整\",\"coefficient\":7,\"meterIds\":[" + m + "]}");
        assertThat(rows("SELECT COUNT(*) FROM alloc_cfg WHERE scope=? AND cfg_key='round_scale'", "rule:" + p)).isZero();
        String param = "{\"key\":\"round_scale\",\"scope\":\"rule:" + p + "\",\"acctMonth\":\"2099-11\",\"mode\":\"from\",\"value\":";
        assertThat(code(send(put("/api/params"), param + "4}"))).isEqualTo(400);
        // 参数页每个池都出这一行(新池一行都没有也有 [改…] 入口);没有行 = 2 位
        assertThat(paramRow("2099-10", "rule:" + p, "round_scale").get("valueText")).isEqualTo("四舍五入到 2 位");
        assertThat(code(send(put("/api/params"), param + "3}"))).isZero();
        assertThat(paramRow("2099-11", "rule:" + p, "round_scale").get("valueText")).isEqualTo("四舍五入到 3 位");
        generate("2099-10"); generate("2099-11");
        Map<String, Object> oct = poolRow("2099-10", p), nov = poolRow("2099-11", p);
        assertThat(((Number) oct.get("stdValue")).doubleValue()).isEqualTo(15.92);
        assertThat(((Number) nov.get("stdValue")).doubleValue()).isEqualTo(15.917);
        assertThat(oct.get("roundScale")).isEqualTo(2);
        assertThat(nov.get("roundScale")).isEqualTo(3);
        assertThat(ruleDto("2099-11", p).get("roundScale")).isEqualTo(3);

        // 新建池选 3 → '' 初始版本行;既有池 PUT roundScale=2 不改它(只在参数页改)
        int q = postId("/api/alloc/rules", "{\"zone\":\"p1\",\"method\":\"none\",\"feeKey\":\"share_elec_floor\","
            + "\"feeName\":\"IT-V131取整二\",\"roundScale\":3}");
        assertThat(rows("SELECT COUNT(*) FROM alloc_cfg WHERE scope=? AND cfg_key='round_scale' AND acct_month='' AND mode='from' AND cfg_value=3",
            "rule:" + q)).isEqualTo(1);
        assertThat(putRule(q, "{\"zone\":\"p1\",\"method\":\"none\",\"feeKey\":\"share_elec_floor\",\"feeName\":\"IT-V131取整二\",\"roundScale\":2}")).isZero();
        assertThat(ruleDto(null, q).get("roundScale")).isEqualTo(3);
        // V131:列值 ≠2 的存量池都搬成了 '' from 行
        assertThat(rows("SELECT COUNT(*) FROM alloc_rule r WHERE r.round_scale<>2")).isPositive();
        assertThat(rows("SELECT COUNT(*) FROM alloc_rule r WHERE r.round_scale<>2 AND NOT EXISTS (SELECT 1 FROM alloc_cfg c"
            + " WHERE c.scope=CONCAT('rule:', r.id) AND c.cfg_key='round_scale' AND c.acct_month='' AND c.mode='from'"
            + " AND c.cfg_value=r.round_scale)")).isZero();
    }

    // ── D6 G1:任一版本里是 fold_price 源的 ref 池有应分摊(= 同表普通池),户级不出行;折入目标型 ref 仍为 null ──
    // 对抗复查 A2:源册 2023-08/09 两块广告字池没折进任何池(M9 给消防设施 / 绿化水泵配了空折入组),W76/W106 照样出
    @Test
    void g1_foldPriceSourceRefHasCost_evenInMonthsNotFoldedYet() throws Exception {
        int mx = meter("IT-G1广告字表", "p2"), my = meter("IT-G1加价档表", "p2");
        for (String ym : List.of("2099-10", "2099-11")) { reading(mx, ym, "0", "100"); reading(my, ym, "0", "50"); prices(ym); }
        int t = postId("/api/tenants", "{\"companyName\":\"IT-G1户\",\"businessType\":\"IT\"}");
        // 源:ref + 一户没设层份的受益人(ref 分支只给带层份的出行 —— 有 cost 后也不能因此收到户头上)
        int s = postId("/api/alloc/rules", "{\"zone\":\"p2\",\"method\":\"ref\",\"feeKey\":\"share_elec_light\","
            + "\"feeName\":\"IT-G1广告字\",\"coefficient\":100,\"meterIds\":[" + mx + "],\"members\":[{\"tenantId\":" + t + "}]}");
        int twin = postId("/api/alloc/rules", none("p2", "IT-G1对照", ",\"meterIds\":[" + mx + "]"));
        int dst = postId("/api/alloc/rules", none("p2", "IT-G1消防", ""));
        assertThat(putRule(dst, none("p2", "IT-G1消防", ",\"links\":[{\"ruleId\":" + s + ",\"type\":\"fold_price\"}],\"memberMonth\":\"2099-11\""))).isZero();
        // #12 型:ref 是 fold_price 的**目标**(与源共用表),不出应分摊
        int r12 = postId("/api/alloc/rules", "{\"zone\":\"p2\",\"method\":\"ref\",\"feeKey\":\"share_elec_elevator\","
            + "\"feeName\":\"IT-G1加价档\",\"coefficient\":18,\"meterIds\":[" + my + "],\"links\":[{\"ruleId\":" + twin + ",\"type\":\"fold_price\"}]}");

        generate("2099-10"); generate("2099-11");
        Object twinOct = poolRow("2099-10", twin).get("costAmount");
        assertThat(twinOct).isNotNull();
        assertThat(poolRow("2099-10", s).get("costAmount")).as("10 月还没折进 dst(11 月起才折),照样出").isEqualTo(twinOct);
        Map<String, Object> sNov = poolRow("2099-11", s);
        Object twinCost = poolRow("2099-11", twin).get("costAmount");
        assertThat(twinCost).isNotNull();
        assertThat(sNov.get("costAmount")).as("源池应分摊 = 同表普通池").isEqualTo(twinCost);
        assertThat(((Number) sNov.get("allocatedAmount")).doubleValue()).isZero();
        assertThat(((Number) sNov.get("gapAmount")).doubleValue()).isEqualTo(-((Number) twinCost).doubleValue());
        assertThat(poolRow("2099-11", r12).get("costAmount")).isNull();
        List<Object> tRows = JsonPath.read(body(mvc.perform(get("/api/alloc/result").param("ym", "2099-11")
            .header("Authorization", auth())).andReturn()), "$.data[?(@.tenantId==" + t + ")]");
        assertThat(tRows).as("源池的受益人没有层份,户级一行不出").isEmpty();
    }

    // ── 对抗复查 A1:带 memberMonth 的保存改了不分月的字段(费项 / 方法 / 名称…)→ 这些对所有月生效,
    //    改池日志记 ''(同改初始版),「需重算」点亮全部已生成月;字段都没变才记 M ──
    @Test
    void unversionedFieldChange_withMemberMonth_logsForAllMonths() throws Exception {
        int p = postId("/api/alloc/rules", none("p1", "IT-V131不分月", ""));
        String fire = "{\"zone\":\"p1\",\"method\":\"none\",\"feeKey\":\"share_elec_fire\",\"feeName\":\"IT-V131不分月\","
            + "\"memberMonth\":\"2099-12\"}";
        String last = "SELECT acct_month FROM param_change_log WHERE scope=? ORDER BY id DESC LIMIT 1";
        assertThat(putRule(p, fire)).isZero();
        assertThat(jdbc.queryForObject(last, String.class, "rule:" + p)).isEqualTo("");
        assertThat(putRule(p, fire)).isZero();   // 同一份再存:什么都没变 → 记 M
        assertThat(jdbc.queryForObject(last, String.class, "rule:" + p)).isEqualTo("2099-12");
    }

    // ── 对抗复查 A4:勾「只改本月起」只改表,受益人原样带回 → 与站在 M 的有效组相同就不写 M 组(同 D4 绑定表),
    //    之后改长期名单 M 起跟着变;名单真变了才写 M 组 ──
    @Test
    void members_sameSetAtMonth_notSnapshotted() throws Exception {
        int a = meter("IT-V131户表甲", "p1"), b = meter("IT-V131户表乙", "p1");
        int t1 = postId("/api/tenants", "{\"companyName\":\"IT-V131名单甲\",\"businessType\":\"IT\"}");
        int t2 = postId("/api/tenants", "{\"companyName\":\"IT-V131名单乙\",\"businessType\":\"IT\"}");
        String w1 = ",\"members\":[{\"tenantId\":" + t1 + ",\"weight\":1}]";   // 库里存 1.000(DECIMAL(6,3)),按同一层份比
        String inMar = "SELECT COUNT(*) FROM alloc_rule_member WHERE rule_id=? AND acct_month='2099-03'";
        int p = postId("/api/alloc/rules", none("p1", "IT-V131名单", ",\"meterIds\":[" + a + "]" + w1));
        assertThat(putRule(p, none("p1", "IT-V131名单", ",\"meterIds\":[" + a + "," + b + "]" + w1 + ",\"memberMonth\":\"2099-03\""))).isZero();
        assertThat(rows(inMar, p)).isZero();
        assertThat(rows("SELECT COUNT(*) FROM alloc_rule_meter WHERE rule_id=? AND acct_month='2099-03'", p)).isEqualTo(2);
        assertThat(putRule(p, none("p1", "IT-V131名单", ",\"meterIds\":[" + a + "],\"members\":[{\"tenantId\":" + t2 + "}]"))).isZero();
        assertThat(col(list(poolRow("2099-03", p), "members"), "tenantId")).containsExactly(t2);
        assertThat(putRule(p, none("p1", "IT-V131名单", ",\"meterIds\":[" + a + "," + b + "]" + w1 + ",\"memberMonth\":\"2099-03\""))).isZero();
        assertThat(rows(inMar, p)).isEqualTo(1);
    }
}

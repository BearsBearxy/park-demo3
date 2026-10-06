package com.park.demo3;

import com.park.demo3.config.AdminInitializer;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.InputStream;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 新园区的起点脚本 db/baseline/V137__baseline.sql 由这里生成,不手改(2026-10-04 用户拍板:产品卖给别的园区,
 * 每个园区一个库,客户能读到库里的一切;我园生产照旧跑老迁移链,新园区从一份「只有表结构 + 通用行」的起点开始)。
 *
 * 做法:在共享的 Testcontainers MySQL 里建一个临时库,用老链(db/migration V1–V137 + V35 那个 Java 迁移)迁到底,
 * 逐表 SHOW CREATE TABLE(按外键依赖排好序、去掉 AUTO_INCREMENT=n、换掉写了我园名字和单价的列注释),
 * 再把 {@link #GENERIC} 里那几张表的通用行导成 INSERT、接上 {@link #PLACEHOLDER} 的占位行,写进起点脚本,最后删掉临时库。
 * 用 JDBC 而不是 mysqldump:不依赖本机装客户端,和守卫测试跑在同一个 MySQL 上。
 *
 * 重新生成(切版号变了、或者改了下面几张表):cd backend && ./mvnw -q test -Dtest=BaselineSqlGenerator
 * 名字不以 Test/IT 结尾,全量测试不会跑它(否则每次全量都会改写起点脚本)。
 * 生成后跑 BaselineChainIT / BaselineBootIT / MigrationLayoutTest 确认两条链等价、新库干净、应用起得来。
 */
class BaselineSqlGenerator {
    /** 老链冻结在这一版。起点脚本叫 V{CUT}__baseline.sql,以后的迁移从 CUT+1 起写在 db/common。 */
    static final int CUT = 137;
    static final Path OUT = Path.of("src/main/resources/db/baseline/V" + CUT + "__baseline.sql");

    static final String[] LEGACY_CHAIN = {"classpath:db/migration", "classpath:db/common"};
    static final String[] BASELINE_CHAIN = {"classpath:db/baseline", "classpath:db/common"};

    /**
     * 每个园区都要的行:表 → 取哪些行。其余每张表在新园区库里都是空的(BaselineChainIT 逐表查)。
     * alloc_cfg 只带五条光伏判据线的默认值;pv_yield_anchor_h(年等效小时锚点 950)是按我园所在地实测调的,
     * 备注写着地名,不带 —— 前端拿不到会退回自己的默认。我园的单价、口径、楼栋/电表/公摊池参数一律不带。
     */
    static final Map<String, String> GENERIC = new LinkedHashMap<>();
    static {
        GENERIC.put("auth_role", "1=1");
        GENERIC.put("auth_role_perm", "1=1");
        GENERIC.put("auth_user", "username='admin'");
        GENERIC.put("auth_user_role", "user_id IN (SELECT id FROM auth_user WHERE username='admin')");
        GENERIC.put("alloc_cfg", "scope='' AND cfg_key IN "
                + "('pv_crit_cover_month','pv_crit_ledger','pv_crit_yield_ratio','pv_band_sigma','pv_band_run')");
    }

    /**
     * 占位行:起点链上固定写这几行,不跟老链比(老链上是我园的期别名、工程成本、运营商名)。
     * 2026-10-05 用户拍板「按你建议修改」:还没有第二个客户,别的园区分几期、有哪些充电运营商都不知道,不为它们设计;
     * 只让空库录得进数:光伏(附表6)/电费(附表11)按期别录,期别字典里查不到就 409,应用里又没有加期别的地方;
     * 充电(附表7/8)录入和导入只认 charging_cat 里有的类别(charging_record 对它有外键)。
     *   - pv_phase / elec_phase:p1/p2/p3 = 一期/二期/三期(应用里期区 p1..p3 写死,见 ZoneService.label / PvService.PHASES)。
     *     光伏工程成本、装机容量两列 NOT NULL,取列默认 0 —— 不是我园的数;投资回收屏把 0 当「投资额未填」出空态。并网月留 NULL。
     *   - charging_cat:附表7/8 各两类「运营商一 / 运营商二」,形状照老链 V19(每表两类,色点 slate/blue、cyan/slate),名字中性。
     *     导入按 Excel「充电桩类别」列的文字对 name,客户表里写「运营商一」才对得上;换成真名要改库(应用里没有字典屏)。
     * 每行是 dataColumns 全列的 SQL 值元组,写法与 genericRows 渲染的逐字一致、按全部列排好序(BaselineChainIT 逐字比)。
     */
    static final Map<String, List<String>> PLACEHOLDER = new LinkedHashMap<>();
    static {
        PLACEHOLDER.put("pv_phase", List.of(
                "('p1', '一期', '一期', NULL, 0.00, 0.000000, NULL, 1)",
                "('p2', '二期', '二期', NULL, 0.00, 0.000000, NULL, 2)",
                "('p3', '三期', '三期', NULL, 0.00, 0.000000, NULL, 3)"));
        PLACEHOLDER.put("elec_phase", List.of(
                "('p1', '一期', '一期', 1)",
                "('p2', '二期', '二期', 2)",
                "('p3', '三期', '三期', 3)"));
        PLACEHOLDER.put("charging_cat", List.of(
                "(7, 'op1', '运营商一', '运营商一', 'slate', 1)",
                "(7, 'op2', '运营商二', '运营商二', 'blue', 2)",
                "(8, 'op1', '运营商一', '运营商一', 'cyan', 1)",
                "(8, 'op2', '运营商二', '运营商二', 'slate', 2)"));
    }

    /**
     * 通用行里要换掉的值(表.列 → 新值)。管理员显示名在 V2 里是我园总经理的真名。
     * 管理员口令列换成谁都比不上的占位(2026-10-05 实测:带 admin123 的哈希,新园区首次启动头几秒 admin/admin123 登得进,
     * 见 AdminInitializer.UNSET_HASH);首次启动由 AdminInitializer 写进 ADMIN_PASSWORD。
     */
    static final Map<String, String> VALUE_OVERRIDE = Map.of(
            "auth_user.display_name", "管理员",
            "auth_user.password_hash", AdminInitializer.UNSET_HASH);

    /**
     * 列注释里写了我园楼名、租户名、单价、栋数或源册单元格的(表.列 → 新注释)。注释存在库里,客户读得到。
     * 只换说明文字,不动列定义;两条链的结构比对(BaselineChainIT)不比注释。
     */
    static final Map<String, String> COMMENT_OVERRIDE = new TreeMap<>();
    static {
        COMMENT_OVERRIDE.put("alloc_cfg.cfg_value", "价格类参数需8位小数");
        COMMENT_OVERRIDE.put("alloc_loss_result.g_qty", "公摊分摊度数(园区公共池÷分摊栋数+g_adj;不分摊的期区为NULL)");
        COMMENT_OVERRIDE.put("alloc_loss_result.adj_qty", "调整度数");
        COMMENT_OVERRIDE.put("alloc_loss_result.adj_rate", "调整损耗加点");
        COMMENT_OVERRIDE.put("alloc_loss_result.variant", "net=净额式/share_only=纯公摊式/none=不核算");
        COMMENT_OVERRIDE.put("alloc_loss_result.tenant_rate", "收取租户损耗率");
        COMMENT_OVERRIDE.put("alloc_rule.book_block", "原册块名=源册合计行标签原文;无块=NULL");
        COMMENT_OVERRIDE.put("alloc_rule.book_key", "原册自然键=源册行标签原文(下游查找键);多行折一池的取首行");
        COMMENT_OVERRIDE.put("alloc_rule.book_row", "原册行号(book_key 所在行)=块内排序依据;多行折一池的取首行");
        COMMENT_OVERRIDE.put("alloc_pool_result.cost_amount", "应分摊");
        COMMENT_OVERRIDE.put("alloc_pool_result.base_snap", "分摊基数快照(层数/面积)");
        COMMENT_OVERRIDE.put("alloc_pool_result.std_value", "分摊标准(元每层/元每平米/整额)");
        COMMENT_OVERRIDE.put("alloc_pool_result.fold_add", "折入叠加档,std_value已含");
        COMMENT_OVERRIDE.put("alloc_pool_result.allocated_amount", "引擎按受益人试算摊出(非实收)");
        COMMENT_OVERRIDE.put("alloc_pool_result.gap_amount", "差额=摊出−应分摊");
        COMMENT_OVERRIDE.put("alloc_rule_link.link_type",
                "fold_price=src池分摊标准叠加进dst池标准;fold_qty=src池净度数计入dst池度数");
        COMMENT_OVERRIDE.put("alloc_rule_meter.sign", "+1计入/-1从池剔除(分表、转供子表这类)");
        COMMENT_OVERRIDE.put("bill_notice_line.premise", "场地段(如 1栋201室);多场地租户分段小计用");
        COMMENT_OVERRIDE.put("contract.elevator_count", "货梯数N(电梯维护费按货梯数×计费层数派生)");
        COMMENT_OVERRIDE.put("contract.transformer_fee", "变压器维护费覆盖月额(优先于按KVA的规则派生)");
        COMMENT_OVERRIDE.put("meter.is_dorm_room", "宿舍房间表(房号计费分间);判定树②居民价的唯一判据,建档时定死不在派生时猜");
        COMMENT_OVERRIDE.put("tenant.offbook", "账外户:出单但不入应收(notice_kind=offbook)");
    }

    @Test
    void regenerate() throws Exception {
        String schema = createSchema("gen");
        try {
            // 只迁到切版号:db/common 有了 V138+ 以后不截住,V138 的结构会被烤进起点脚本,起点链再跑一遍 V138 就撞(复查 SAFE-F8)
            Flyway.configure().dataSource(url(schema), "root", AbstractMysqlIT.MYSQL.getPassword())
                    .locations(LEGACY_CHAIN).target(String.valueOf(CUT)).load().migrate();
            Files.createDirectories(OUT.getParent());
            Files.writeString(OUT, render(schema), StandardCharsets.UTF_8);
        } finally {
            dropSchema(schema);
        }
    }

    // ── 临时库:都建在共享 Testcontainers MySQL 里,以 park_fds_ 打头,用完即删 ──

    static String createSchema(String tag) {
        String schema = "park_fds_" + tag + "_" + UUID.randomUUID().toString().substring(0, 8);
        exec(null, "CREATE DATABASE " + schema + " DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci");
        return schema;
    }

    static void dropSchema(String schema) {
        exec(null, "DROP DATABASE IF EXISTS " + schema);
    }

    static String url(String schema) {
        return "jdbc:mysql://" + AbstractMysqlIT.MYSQL.getHost() + ":" + AbstractMysqlIT.MYSQL.getMappedPort(3306)
                + "/" + (schema == null ? "" : schema)
                + "?useUnicode=true&characterEncoding=utf8&allowPublicKeyRetrieval=true&useSSL=false";
    }

    /** 建库/删库要 root(容器里的 test 账号只对 park_demo3 有权限);root 口令就是容器口令。 */
    static Connection connect(String schema) throws SQLException {
        return DriverManager.getConnection(url(schema), "root", AbstractMysqlIT.MYSQL.getPassword());
    }

    static void migrate(String schema, String... locations) {
        Flyway.configure().dataSource(url(schema), "root", AbstractMysqlIT.MYSQL.getPassword())
                .locations(locations).load().migrate();
    }

    private static void exec(String schema, String sql) {
        try (Connection c = connect(schema); Statement s = c.createStatement()) {
            s.execute(sql);
        } catch (SQLException e) {
            throw new IllegalStateException(sql, e);
        }
    }

    static List<String> strings(Connection c, String sql) throws SQLException {
        List<String> out = new ArrayList<>();
        try (Statement s = c.createStatement(); ResultSet rs = s.executeQuery(sql)) {
            while (rs.next()) out.add(rs.getString(1));
        }
        return out;
    }

    /** 本库的业务表(不含 Flyway 自己的历史表),按名排序。 */
    static List<String> tables(Connection c, String schema) throws SQLException {
        return strings(c, "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='" + schema
                + "' AND TABLE_TYPE='BASE TABLE' AND TABLE_NAME<>'flyway_schema_history' ORDER BY TABLE_NAME");
    }

    /** 通用行要比/要导的列:去掉 DEFAULT CURRENT_TIMESTAMP 这类按写入时刻生成的列,两条链上它们本来就不同。 */
    static List<String> dataColumns(Connection c, String schema, String table) throws SQLException {
        return strings(c, "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='" + schema
                + "' AND TABLE_NAME='" + table + "' AND EXTRA NOT LIKE '%DEFAULT_GENERATED%' ORDER BY ORDINAL_POSITION");
    }

    /**
     * 通用行,每行渲染成 SQL 值元组 "(v1, v2, …)",按全部列排序(结果稳定)。不在 GENERIC 里的表取整表(占位表就这么比)。
     * override=true 时套上 VALUE_OVERRIDE(读老链时用;读起点链时不套,否则真名混进去也看不出来)。
     */
    static List<String> genericRows(Connection c, String schema, String table, boolean override) throws SQLException {
        List<String> cols = dataColumns(c, schema, table);
        List<String> out = new ArrayList<>();
        try (Statement s = c.createStatement(); ResultSet rs = s.executeQuery(
                "SELECT `" + String.join("`,`", cols) + "` FROM `" + table + "` WHERE " + GENERIC.getOrDefault(table, "1=1")
                        + " ORDER BY `" + String.join("`,`", cols) + "`")) {
            while (rs.next()) {
                List<String> vals = new ArrayList<>();
                for (int i = 1; i <= cols.size(); i++) {
                    String replaced = override ? VALUE_OVERRIDE.get(table + "." + cols.get(i - 1)) : null;
                    Object v = rs.getObject(i);
                    if (replaced != null) vals.add(quote(replaced));
                    else if (v == null) vals.add("NULL");
                    else if (v instanceof Number) vals.add(v instanceof BigDecimal b ? b.toPlainString() : v.toString());
                    else if (v instanceof Boolean b) vals.add(b ? "1" : "0");
                    else vals.add(quote(rs.getString(i)));
                }
                out.add("(" + String.join(", ", vals) + ")");
            }
        }
        return out;
    }

    private static String quote(String s) {
        return "'" + s.replace("\\", "\\\\").replace("'", "''") + "'";
    }

    // ── 真名扫描(BaselineChainIT 查迁完的起点链,BaselineBootIT 查应用起完之后的库) ──

    /** 测试资源 baseline/real-names.txt:一行一个,# 开头是注释。 */
    static List<String> realNames() throws IOException {
        try (InputStream in = BaselineSqlGenerator.class.getResourceAsStream("/baseline/real-names.txt")) {
            return new String(in.readAllBytes(), StandardCharsets.UTF_8).lines()
                    .map(String::strip).filter(s -> !s.isEmpty() && !s.startsWith("#")).toList();
        }
    }

    /**
     * 库里出现的我园真名,一处一条:每张表(含 Flyway 历史表)的每个文本列,外加表/列/索引注释(注释也存在客户库里,客户读得到)。
     * 起点脚本之外,应用启动时还有代码往库里写(BookSeeder 补附表10 册),所以 BaselineBootIT 起完应用再扫一遍。
     */
    static List<String> realNameHits(String schema) throws SQLException, IOException {
        List<String> names = realNames();
        List<String> hits = new ArrayList<>();
        try (Connection c = connect(schema)) {
            for (String tc : strings(c, "SELECT CONCAT(TABLE_NAME, '.', COLUMN_NAME) FROM information_schema.COLUMNS"
                    + " WHERE TABLE_SCHEMA='" + schema + "' AND DATA_TYPE IN ('char','varchar','tinytext','text',"
                    + "'mediumtext','longtext','json','enum','set')")) {
                String[] p = tc.split("\\.");
                for (String v : strings(c, "SELECT `" + p[1] + "` FROM `" + p[0] + "` WHERE `" + p[1] + "` IS NOT NULL")) {
                    scan(tc, v, names, hits);
                }
            }
            for (String q : List.of(
                    "SELECT CONCAT(TABLE_NAME, '|', TABLE_COMMENT) FROM information_schema.TABLES WHERE TABLE_SCHEMA='" + schema + "'",
                    "SELECT CONCAT(TABLE_NAME, '.', COLUMN_NAME, '|', COLUMN_COMMENT) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='" + schema + "'",
                    "SELECT CONCAT(TABLE_NAME, '.', INDEX_NAME, '|', INDEX_COMMENT) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='" + schema + "'")) {
                for (String v : strings(c, q)) scan("注释", v, names, hits);
            }
        }
        return hits;
    }

    private static void scan(String where, String value, List<String> names, List<String> hits) {
        for (String n : names) {
            if (value.contains(n)) hits.add(where + " 含「" + n + "」: " + value);
        }
    }

    // ── 渲染 ──

    static String render(String schema) throws SQLException {
        StringBuilder sql = new StringBuilder();
        sql.append("-- V").append(CUT).append("__baseline.sql — 新园区库的起点:老链 V1–V").append(CUT)
                .append(" 迁到底之后的表结构 + 每个园区都要的通用行(角色、权限、管理员账号、光伏判据线默认值)\n")
                .append("-- + 占位行(光伏/电费期别 一期~三期、充电类别 运营商一/二,让空库录得进数)。\n")
                .append("-- 不含任何园区数据。由 backend/src/test/java/com/park/demo3/BaselineSqlGenerator.java 生成,不要手改;\n")
                .append("-- 重新生成:cd backend && ./mvnw -q test -Dtest=BaselineSqlGenerator\n")
                .append("-- 管理员没有口令(password_hash 是任何口令都比不上的占位),部署时必须设 ADMIN_PASSWORD,首次启动时写进去(AdminInitializer)。\n\n");
        try (Connection c = connect(schema)) {
            for (String t : fkOrder(c, schema)) {
                sql.append(overrideComments(t, showCreate(c, t).replaceAll(" AUTO_INCREMENT=\\d+", ""))).append(";\n\n");
            }
            for (Map.Entry<String, String> g : GENERIC.entrySet()) {
                String t = g.getKey();
                List<String> rows = genericRows(c, schema, t, true);
                if (rows.isEmpty()) throw new IllegalStateException("通用表 " + t + " 在老链上没有行,检查 GENERIC 的条件");
                insert(sql, t, dataColumns(c, schema, t), rows);
            }
            for (Map.Entry<String, List<String>> p : PLACEHOLDER.entrySet()) {
                if (GENERIC.containsKey(p.getKey())) throw new IllegalStateException(p.getKey() + " 既是通用表又是占位表");
                insert(sql, p.getKey(), dataColumns(c, schema, p.getKey()), p.getValue());
            }
        }
        for (String k : COMMENT_OVERRIDE.keySet()) {
            if (!usedOverrides.contains(k)) throw new IllegalStateException("COMMENT_OVERRIDE 的 " + k + " 没有命中任何列");
        }
        if (sql.indexOf("${") >= 0) throw new IllegalStateException("起点脚本里出现 ${,会被 Flyway 当占位符");
        return sql.toString();
    }

    private static void insert(StringBuilder sql, String table, List<String> cols, List<String> rows) {
        sql.append("INSERT INTO `").append(table).append("` (`")
                .append(String.join("`, `", cols)).append("`) VALUES\n  ")
                .append(String.join(",\n  ", rows)).append(";\n\n");
    }

    private static String showCreate(Connection c, String table) throws SQLException {
        try (Statement s = c.createStatement(); ResultSet rs = s.executeQuery("SHOW CREATE TABLE `" + table + "`")) {
            rs.next();
            return rs.getString(2);
        }
    }

    /** 被引用的表排在前面(自引用不算),同层按名排,结果稳定。 */
    private static List<String> fkOrder(Connection c, String schema) throws SQLException {
        Map<String, Set<String>> deps = new TreeMap<>();
        for (String t : tables(c, schema)) deps.put(t, new TreeSet<>());
        try (Statement s = c.createStatement(); ResultSet rs = s.executeQuery(
                "SELECT TABLE_NAME, REFERENCED_TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA='"
                        + schema + "' AND REFERENCED_TABLE_NAME IS NOT NULL")) {
            while (rs.next()) {
                if (!rs.getString(1).equals(rs.getString(2))) deps.get(rs.getString(1)).add(rs.getString(2));
            }
        }
        List<String> out = new ArrayList<>();
        while (!deps.isEmpty()) {
            String next = deps.entrySet().stream().filter(e -> out.containsAll(e.getValue())).map(Map.Entry::getKey)
                    .findFirst().orElseThrow(() -> new IllegalStateException("外键成环:" + deps.keySet()));
            out.add(next);
            deps.remove(next);
        }
        return out;
    }

    private static final Set<String> usedOverrides = new TreeSet<>();
    private static final Pattern COMMENT = Pattern.compile(" COMMENT '(?:[^'\\\\]|\\\\.|'')*'");

    /** SHOW CREATE TABLE 一列一行;按「  `列名` 」找到那一行,把它的 COMMENT '…' 换掉。每条都必须恰好命中一次。 */
    private static String overrideComments(String table, String ddl) {
        String[] lines = ddl.split("\n", -1);
        for (Map.Entry<String, String> e : COMMENT_OVERRIDE.entrySet()) {
            String[] tc = e.getKey().split("\\.", 2);
            if (!tc[0].equals(table)) continue;
            int hits = 0;
            for (int i = 0; i < lines.length; i++) {
                if (!lines[i].startsWith("  `" + tc[1] + "` ")) continue;
                Matcher m = COMMENT.matcher(lines[i]);
                if (!m.find()) throw new IllegalStateException(e.getKey() + " 这一列没有注释");
                lines[i] = lines[i].substring(0, m.start()) + " COMMENT " + quote(e.getValue()) + lines[i].substring(m.end());
                hits++;
            }
            if (hits != 1) throw new IllegalStateException(e.getKey() + " 命中 " + hits + " 次");
            usedOverrides.add(e.getKey());
        }
        return String.join("\n", lines);
    }
}

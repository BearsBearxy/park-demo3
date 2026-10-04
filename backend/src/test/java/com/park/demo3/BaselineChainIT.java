package com.park.demo3;

import com.park.demo3.config.AdminInitializer;
import org.assertj.core.api.SoftAssertions;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;

import static com.park.demo3.BaselineSqlGenerator.*;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * 两条迁移链等价、起点链干净(2026-10-04 用户拍板:产品卖给别的园区,每园一个库,客户能读到库里的一切;
 * 我园生产照旧跑老链,新园区从 db/baseline 起步,以后的迁移在 db/common 两条链共用)。
 *
 * 在共享 Testcontainers MySQL 里建两个临时库,一个跑老链、一个跑起点链,比:
 *   1. 表结构(表/列/索引/外键/约束;不比注释 —— 起点脚本有意换掉了写着我园名字和单价的注释)
 *   2. 通用行(角色、权限、管理员、光伏判据线默认值;管理员显示名、口令列按 VALUE_OVERRIDE 换过)
 *   3. 起点链上除通用行外每张表都是空的(占位表逐字等于 PLACEHOLDER,不跟老链比),
 *      任何文本列、表/列/索引注释里都没有我园真名(清单在测试资源里)
 * 用完删库。老链在 Windows Docker 上迁一遍要 5–6 分钟,两条链并行迁。
 */
class BaselineChainIT {
    private static String legacy;
    private static String baseline;

    @BeforeAll
    static void migrateBothChains() {
        legacy = createSchema("legacy");
        baseline = createSchema("base");
        CompletableFuture<Void> legacyDone = CompletableFuture.runAsync(() -> migrate(legacy, LEGACY_CHAIN));
        try {
            migrate(baseline, BASELINE_CHAIN);
        } finally {
            legacyDone.join();   // 起点链抛错也等老链迁完,否则 @AfterAll 会在它迁到一半时删库
        }
    }

    @AfterAll
    static void dropSchemas() {
        if (legacy != null) dropSchema(legacy);
        if (baseline != null) dropSchema(baseline);
    }

    /** information_schema 里描述结构的几张视图;不取注释列,不取库名列。 */
    private static final String[] STRUCTURE = {
        "SELECT TABLE_NAME, TABLE_TYPE, ENGINE, TABLE_COLLATION, CREATE_OPTIONS FROM information_schema.TABLES"
            + " WHERE TABLE_SCHEMA=?",
        "SELECT TABLE_NAME, ORDINAL_POSITION, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA,"
            + " CHARACTER_SET_NAME, COLLATION_NAME, GENERATION_EXPRESSION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=?",
        "SELECT TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX, COLUMN_NAME, EXPRESSION, NON_UNIQUE, SUB_PART, COLLATION,"
            + " INDEX_TYPE, IS_VISIBLE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=?",
        "SELECT k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION, k.COLUMN_NAME, k.REFERENCED_TABLE_NAME,"
            + " k.REFERENCED_COLUMN_NAME, r.UPDATE_RULE, r.DELETE_RULE FROM information_schema.KEY_COLUMN_USAGE k"
            + " JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA"
            + " AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME AND r.TABLE_NAME=k.TABLE_NAME WHERE k.TABLE_SCHEMA=?",
        "SELECT TABLE_NAME, CONSTRAINT_NAME, CONSTRAINT_TYPE, ENFORCED FROM information_schema.TABLE_CONSTRAINTS"
            + " WHERE TABLE_SCHEMA=?",
        "SELECT CONSTRAINT_NAME, CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=?",
        "SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE, ACTION_TIMING, EVENT_MANIPULATION, ACTION_STATEMENT"
            + " FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=?",
        "SELECT TABLE_NAME, VIEW_DEFINITION FROM information_schema.VIEWS WHERE TABLE_SCHEMA=?",
        "SELECT ROUTINE_NAME, ROUTINE_TYPE FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=?",
        "SELECT EVENT_NAME FROM information_schema.EVENTS WHERE EVENT_SCHEMA=?",
    };

    /** 每行各列用 | 连起来,NULL 写成 ∅;整体排序后比,和返回顺序无关。 */
    private static List<String> rows(String sql, String schema) throws SQLException {
        List<String> out = new ArrayList<>();
        try (Connection c = connect(null); PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, schema);
            try (ResultSet rs = ps.executeQuery()) {
                int n = rs.getMetaData().getColumnCount();
                while (rs.next()) {
                    StringBuilder row = new StringBuilder();
                    for (int i = 1; i <= n; i++) {
                        String v = rs.getString(i);
                        row.append(i > 1 ? "|" : "").append(v == null ? "∅" : v);
                    }
                    out.add(row.toString());
                }
            }
        }
        out.sort(null);
        return out;
    }

    @Test
    void schemaIdenticalOnBothChains() throws SQLException {
        assertThat(rows(STRUCTURE[1], baseline)).as("起点链得有表").isNotEmpty();
        for (String q : STRUCTURE) {
            assertThat(rows(q, baseline)).as(q).containsExactlyElementsOf(rows(q, legacy));
        }
    }

    @Test
    void genericRowsIdenticalOnBothChains() throws SQLException {
        try (Connection l = connect(legacy); Connection b = connect(baseline)) {
            for (String t : GENERIC.keySet()) {
                List<String> expected = genericRows(l, legacy, t, true);
                assertThat(expected).as(t + " 老链上应有通用行").isNotEmpty();
                assertThat(genericRows(b, baseline, t, false)).as(t).containsExactlyElementsOf(expected);
            }
        }
    }

    /**
     * 新园区库刚迁完、应用还没跑 AdminInitializer 时,admin 拿什么口令都登不进(2026-10-05 实测:AdminInitializer 是
     * ApplicationRunner,跑在端口打开之后;原来起点脚本带 admin123 的哈希,首次启动头几秒 admin/admin123 登得进)。
     * 编码器同 SecurityConfig.passwordEncoder();口令列还得正好是 AdminInitializer 认得的占位,否则首次启动也换不成 ADMIN_PASSWORD。
     */
    @Test
    void baselineAdminCannotLogInBeforeFirstStart() throws SQLException {
        String hash;
        try (Connection c = connect(baseline)) {
            hash = strings(c, "SELECT password_hash FROM auth_user WHERE username='admin'").get(0);
        }
        PasswordEncoder enc = new BCryptPasswordEncoder();
        SoftAssertions.assertSoftly(s -> {
            s.assertThat(List.of("admin123", "", hash).stream().filter(p -> enc.matches(p, hash)).toList())
                    .as("这些口令登得进").isEmpty();
            s.assertThat(hash).isEqualTo(AdminInitializer.UNSET_HASH);
        });
    }

    @Test
    void baselineChainCarriesNoParkData() throws Exception {
        assertThat(realNames()).hasSizeGreaterThan(100);
        List<String> hits = new ArrayList<>();
        try (Connection c = connect(baseline)) {
            for (String t : tables(c, baseline)) {
                // 占位表(期别、充电类别):整表必须逐字等于生成器里列的那几行,多一行少一行改一个字都不行
                if (PLACEHOLDER.containsKey(t)) {
                    List<String> rows = genericRows(c, baseline, t, false);
                    if (!rows.equals(PLACEHOLDER.get(t))) hits.add(t + " 占位行和 PLACEHOLDER 不一致: " + rows);
                    continue;
                }
                String where = GENERIC.getOrDefault(t, "1=0");
                long all = count(c, "SELECT COUNT(*) FROM `" + t + "`");
                long generic = count(c, "SELECT COUNT(*) FROM `" + t + "` WHERE " + where);
                if (all != generic) hits.add(t + " 有 " + (all - generic) + " 行不是通用行");
            }
        }
        hits.addAll(realNameHits(baseline));   // 每个文本列(含 Flyway 历史表)+ 表/列/索引注释
        assertThat(hits).isEmpty();
    }

    private static long count(Connection c, String sql) throws SQLException {
        return Long.parseLong(strings(c, sql).get(0));
    }
}

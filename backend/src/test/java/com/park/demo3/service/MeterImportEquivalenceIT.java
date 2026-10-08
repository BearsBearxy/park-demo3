package com.park.demo3.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.park.demo3.AbstractMysqlIT;
import com.park.demo3.dto.ImportError;
import com.park.demo3.dto.MeterImportRequest;
import com.park.demo3.dto.MeterImportResultDTO;
import com.park.demo3.security.Perm;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.function.Supplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.fail;

/**
 * 抄表整册导入提速前后结果逐字节一致(用户 2026-10-05「两个都按你建议」:提速,结果一格不变)。
 *
 * 造一本像真册子的书(分时表、新表、改倍率有 / 没有表档案权限(F15)、同月重复、换租、换楼、停用 / 已拆、空读数、
 * 坏行、编码认到别的期区、按位置歧义、冻结月(催缴单已确认 + 审核锁)、人工钉住的租户 / 归属 / 楼层),
 * 分三批导进去,把导入碰过的每张表和每批的返回体落成规范文本,与仓里存的快照逐行比。
 * 快照是**提速之前**的代码跑出来的;改了导入的任何结果,这里就红,先看 target 下的 actual 文件和快照差在哪。
 * 确实要改结果(用户拍板的行为变化)时,把 actual 拷成快照、在提交里说明为什么变。
 *
 * 规范化:自增 id 换成本用例里的名次(表 M1…、归属行 A1…、状态行 S1…)、批次号换成 B1…、时间戳不比;
 * 文案里的「id N」也换成表名次。其余一格不动(含提示的顺序、档案前后像 JSON、需重算流水的顺序)。
 *
 * 独占 p77 / p78 两个期区与 2077 年(全仓无人用),整类回滚。共享测试库里若已有晚于 2076-12 的读数 / 单 / 池快照,
 * 「最大已生成月」会变,快照就对不上 —— 开头先断言它。
 *
 * 量时间:-DmeterImport.perf=3(或 12)只导第一批那样的整本(1,090 块表 × N 个月),打印耗时与语句数,
 * 规范文本写到 target/meter-import-perf-N.txt(改前改后各跑一次 diff)。
 */
@Transactional
class MeterImportEquivalenceIT extends AbstractMysqlIT {
    @Autowired MeterService svc;
    @Autowired MeterTimelineService timeline;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;

    private static final Path GOLDEN = Path.of("src/test/resources/meter-import/equivalence.txt");
    private static final String Z = "p77", Z2 = "p78", MINE = "('p77','p78')";
    private static final List<String> ADMIN = List.of(Perm.METERS_ARCHIVE, "meters:edit");
    private static final List<String> CLERK = List.of("meters:edit");

    private final List<String> batches = new ArrayList<>();
    private int sortBase;
    private long dclFrom, fixtureMax;

    @AfterEach
    void clearAuth() { SecurityContextHolder.clearContext(); }

    /**
     * 第一批 170 块表 × 3 个月 = 500 多行:过了读数攒批的 500 行,批中途冲一次库,「最大已生成月」在批里变了
     * (需重算流水跟着变)也在快照里。第二批专员导(没有表档案权限),第三批管理员导旧月 + 新月。
     */
    @Test
    void importResultsMatchTheStoredSnapshot() throws Exception {
        seed();
        List<Object[]> runs = new ArrayList<>();
        runs.add(new Object[]{"P1", as("it-admin", ADMIN, () -> svc.importRows(req(book(170, months("2077-01", 3), 1), "一期册.xlsx")))});
        runs.add(new Object[]{"P2", as("it-clerk", CLERK, () -> svc.importRows(req(book(170, months("2077-02", 3), 2), "专员册.xlsx")))});
        runs.add(new Object[]{"P3", as("it-admin", ADMIN, () -> svc.importRows(req(book(90, List.of("2077-01", "2077-05"), 3), null)))});
        List<String> actual = canon(runs);

        Path out = Path.of("target/meter-import-equivalence.actual.txt");
        Files.createDirectories(out.getParent());
        Files.writeString(out, String.join("\n", actual) + "\n", StandardCharsets.UTF_8);
        List<String> expected = Files.readAllLines(GOLDEN, StandardCharsets.UTF_8);
        for (int k = 0; k < Math.max(expected.size(), actual.size()); k++) {
            String e = k < expected.size() ? expected.get(k) : "<没有这一行>";
            String a = k < actual.size() ? actual.get(k) : "<没有这一行>";
            if (!e.equals(a))
                fail("导入结果与快照第 " + (k + 1) + " 行起不同(全文见 " + out.toAbsolutePath() + "):\n快照:" + e + "\n现在:" + a);
        }
        assertThat(actual).as("快照不该是空的").hasSizeGreaterThan(2000);
        // 提速前的导入从不动已在库的表的 updated_at:updateById 把读进来的原值写回去(MyBatisPlusConfig 用 strictUpdateFill,只补空值),
        // 列被显式赋值时 MySQL 的 ON UPDATE 不触发。提速不许多出一条刷它的写(对抗复查 IMP-T2-updated-at,「两个都按你建议」2026-10-05)
        assertThat(jdbc.queryForList("SELECT name FROM meter WHERE zone IN " + MINE + " AND id <= ? AND updated_at <> '2000-01-01 00:00:00'",
            String.class, fixtureMax)).as("导入动了已在库的表的 updated_at").isEmpty();
    }

    @Test
    @EnabledIfSystemProperty(named = "meterImport.perf", matches = "\\d+")
    void perf() throws Exception {
        int n = Integer.parseInt(System.getProperty("meterImport.perf"));
        seed();
        MeterImportRequest r = req(book(1090, months("2078-01", n), 1), "整本.xlsx");   // 2078:躲开夹具的审核锁月
        Map<String, Long> s0 = sessionStatus();
        long t0 = System.nanoTime();
        MeterImportResultDTO d = as("it-admin", ADMIN, () -> svc.importRows(r));
        long ms = (System.nanoTime() - t0) / 1_000_000;
        Map<String, Long> s1 = sessionStatus();
        String counts = s1.keySet().stream().map(k -> k + "=" + (s1.get(k) - s0.get(k) - ("Questions".equals(k) ? 1 : 0)))
            .collect(Collectors.joining(" "));
        System.out.println("METER-IMPORT-PERF months=" + n + " rows=" + r.rows().size() + " imported=" + d.imported()
            + " ms=" + ms + " " + counts);
        Path out = Path.of("target/meter-import-perf-" + n + ".txt");
        Files.writeString(out, String.join("\n", canon(List.<Object[]>of(new Object[]{"P1", d}))) + "\n", StandardCharsets.UTF_8);
    }

    // ══════════ 夹具:导入之前就在的表 ══════════

    /**
     * F1 冻结(2077-03 催缴单已确认 → 冻 2077-02)、F2 后面还有一段(2077-08)且 2077-06 审核已锁、F3 人工钉住租户 / 归属 / 楼层、
     * F4/F5 共用一个编码(F4 2077-02 起拆、F5 2077-02 起在册)、F6 在 p78(编码被 p77 的行填错)、F7/F8 同址无码(歧义)、
     * F9 2076-06 起停用、F10 2076-12 起已拆、F11/F12 同码(F12 在册,F11 从没在册 → 自愈补在册会撞码)。
     */
    private void seed() {
        sortBase = jdbc.queryForObject("SELECT COALESCE(MAX(sort_no), 0) FROM meter", Integer.class);
        int f1 = fixture("F1冻结表", "Z77-F1", "A9座", "1楼901室", null);
        status(f1, "1900-01", "active"); assign(f1, "1900-01", "老户一", null, 0, 0, 0, null);
        jdbc.update("INSERT INTO meter_reading (meter_id, ym, prev_total, curr_total, factor_snap, source) VALUES (?, '2076-12', 0, 10, 1, 'manual')", f1);
        int f2 = fixture("F2审核锁表", "Z77-F2", "A9座", "2楼902室", null);
        status(f2, "1900-01", "active"); assign(f2, "1900-01", "老户二", null, 0, 0, 0, null); assign(f2, "2077-08", "后来户", null, 0, 0, 0, null);
        int f3 = fixture("F3人工表", "Z77-F3", "A9座", "3楼903室", null);
        status(f3, "1900-01", "active"); assign(f3, "1900-01", "人工户", 9001, 1, 1, 1, "九楼");
        int f4 = fixture("F4同码旧表", "Z77-DUP", "A9座", "4楼904室", null);
        status(f4, "1900-01", "active"); status(f4, "2077-02", "removed"); assign(f4, "1900-01", "同码户", null, 0, 0, 0, null);
        int f5 = fixture("F5同码新表", "Z77-DUP", "A9座", "5楼905室", null);
        status(f5, "2077-02", "active"); assign(f5, "2077-02", "同码户", null, 0, 0, 0, null);
        int f6 = jdbcMeter("elec", Z2, "F6八期表", "Z78-X", BigDecimal.ONE);
        status(f6, "1900-01", "active"); assign(f6, "1900-01", "八期户", null, 0, 0, 0, null);
        for (String nm : List.of("F7同址甲", "F8同址乙")) {
            int f = fixture(nm, null, "A9座", "6楼906室", null);
            status(f, "1900-01", "active"); assign(f, "1900-01", nm.substring(2) + "户", null, 0, 0, 0, null);
        }
        int f9 = fixture("F9停用表", "Z77-F9", "A9座", "7楼907室", null);
        status(f9, "1900-01", "active"); status(f9, "2076-06", "retired"); assign(f9, "1900-01", "停用户", null, 0, 0, 0, null);
        int f10 = fixture("F10已拆表", null, "A9座", "8楼908室", null);
        status(f10, "1900-01", "active"); status(f10, "2076-12", "removed"); assign(f10, "1900-01", "拆表户", null, 0, 0, 0, null);
        int f11 = fixture("F11没在册", "Z77-G10", null, null, null);
        assign(f11, "1900-01", null, null, 0, 0, 0, null);
        int f12 = fixture("F12同码在册", "Z77-G10", null, null, null);
        status(f12, "1900-01", "active"); assign(f12, "1900-01", null, null, 0, 0, 0, null);
        int f13 = fixture("F13同月两行", "Z77-F13", "A9座", "9楼909室", null);
        status(f13, "1900-01", "active"); assign(f13, "1900-01", "原户", null, 0, 0, 0, null);
        int f14 = fixture("F14改已有状态", "Z77-F14", "A9座", "10楼910室", null);
        status(f14, "1900-01", "active"); status(f14, "2077-03", "active"); assign(f14, "1900-01", "原户", null, 0, 0, 0, null);

        int tenant = jdbc.queryForObject("SELECT MIN(id) FROM tenant", Integer.class);
        jdbc.update("INSERT INTO bill_notice (ym, tenant_id, notice_kind, status, total_amount, generated_at) VALUES ('2077-03', ?, 'combined', 'confirmed', 0, NOW())", tenant);
        Integer notice = jdbc.queryForObject("SELECT id FROM bill_notice WHERE ym = '2077-03' AND tenant_id = ?", Integer.class, tenant);
        jdbc.update("INSERT INTO bill_notice_line (notice_id, line_no, fee_key, meter_id, amount) VALUES (?, 1, 'elec', ?, 0)", notice, f1);
        jdbc.update("INSERT INTO review_state (review_key, kind, period, status, reviewed_by) VALUES ('meters:2077-06', 'meters', '2077-06', 'approved', 'it')");
        // 夹具表的 updated_at 钉在 2000 年(规范文本不比时间戳,单独断言,见 importResultsMatchTheStoredSnapshot 末尾)
        jdbc.update("UPDATE meter SET updated_at = '2000-01-01 00:00:00' WHERE zone IN " + MINE);
        fixtureMax = jdbc.queryForObject("SELECT MAX(id) FROM meter WHERE zone IN " + MINE, Long.class);
        dclFrom =jdbc.queryForObject("SELECT COALESCE(MAX(id), 0) FROM data_change_log", Long.class);
        // 夹具全用 JdbcTemplate 写、这里才第一次经 MyBatis 查:同一事务里 MyBatis 会缓存查过的句子,
        // 要是在夹具落库之前查过,导入开头读到的就是夹具之前的旧值(那是测试自己造出来的假象,线上一次导入一个新事务)
        String maxGen = timeline.maxGeneratedYm();
        assertThat(maxGen).as("夹具的催缴单把最大已生成月定在 2077-02;共享测试库里有更晚的读数 / 单 / 池快照时快照对不上").isEqualTo("2077-02");
    }

    private int fixture(String name, String code, String area, String spot, String sub) {
        int id = jdbcMeter("elec", Z, name, code, BigDecimal.ONE);
        fixtureAddr.put(name, new String[]{area, spot, sub});
        return id;
    }
    private final Map<String, String[]> fixtureAddr = new LinkedHashMap<>();

    private int jdbcMeter(String kind, String zone, String name, String code, BigDecimal factor) {
        jdbc.update("INSERT INTO meter (kind, zone, name, code, factor, sort_no) VALUES (?, ?, ?, ?, ?, ?)",
            kind, zone, name, code, factor, sortBase + 1 + fixtureAddr.size());
        return jdbc.queryForObject("SELECT id FROM meter WHERE kind = ? AND zone = ? AND name = ?", Integer.class, kind, zone, name);
    }

    private void status(int id, String from, String st) {
        jdbc.update("INSERT INTO meter_status (meter_id, from_ym, status, src) VALUES (?, ?, ?, 'migrate')", id, from, st);
    }

    private void assign(int id, String from, String tenant, Integer bld, int tm, int om, int lm, String floor) {
        String[] addr = fixtureAddr.getOrDefault(jdbc.queryForObject("SELECT name FROM meter WHERE id = ?", String.class, id), new String[3]);
        jdbc.update("INSERT INTO meter_assign (meter_id, from_ym, tenant_name, building_id, ownership, area, spot, floor_label, sub_name,"
                + " tenant_manual, owner_manual, loc_manual, src) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'migrate')",
            id, from, tenant, bld, om == 1 ? "tenant" : "share", addr[0], addr[1], floor, addr[2], tm, om, lm);
    }

    // ══════════ 造册子 ══════════

    private static List<String> months(String from, int n) {
        java.time.YearMonth a = java.time.YearMonth.parse(from);
        return IntStream.range(0, n).mapToObj(k -> a.plusMonths(k).toString()).toList();
    }

    private static MeterImportRequest req(List<MeterImportRequest.Row> rows, String file) {
        return new MeterImportRequest(rows, file);
    }

    /** 一行册子(字段同 MeterImportRequest.Row)。 */
    private static final class R implements Cloneable {
        String kind = "elec", zone = Z, name, ym, area, spot, tenantName, ownership, meterType, subName, code, note;
        Integer tenantId, buildingId;
        BigDecimal factor, pt, ct, ps, pp, pf, pv, cs, cp, cf, cv;

        MeterImportRequest.Row row() {
            return new MeterImportRequest.Row(kind, zone, name, ym, area, spot, tenantName, tenantId, buildingId, ownership,
                meterType, subName, code, factor, pt, ct, ps, pp, pf, pv, cs, cp, cf, cv, note);
        }

        R copy() {
            try { return (R) clone(); } catch (CloneNotSupportedException e) { throw new IllegalStateException(e); }
        }
    }

    private static BigDecimal d(double v) { return BigDecimal.valueOf(v).setScale(2, java.math.RoundingMode.HALF_UP); }

    /**
     * phase 1:建档那一批(管理员);2:专员(没有表档案权限)改倍率被拒、换租、换楼、停用、已拆、补码、换表;
     * 3:管理员导一个旧月(倍率只进快照)和一个新月(倍率写回档案)。
     */
    static List<MeterImportRequest.Row> book(int n, List<String> months, int phase) {
        Random rnd = new Random(7919L * phase + n);
        List<MeterImportRequest.Row> rows = new ArrayList<>();
        for (int t = 0; t < months.size(); t++) {
            String ym = months.get(t);
            int mi = Integer.parseInt(ym.substring(5));
            for (int i = 0; i < n; i++) {
                if (phase == 1 && t == 0 && i % 13 == 12) continue;               // 第二个月才头一回出现 = 那个月新建
                if (phase == 2 && t == 2 && i % 20 == 1 && i < 80) continue;      // 这块表这个月不在册子里(换表那一行见下)
                R r = new R();
                r.ym = ym;
                r.kind = i % 7 == 0 ? "water" : "elec";
                r.name = i % 17 == 0 ? null : (r.kind.equals("elec") ? "电表" : "水表") + i;
                r.area = "A" + (i % 6) + "座";
                r.spot = (i % 9 + 1) + "楼" + (i % 2 == 0 ? "东侧" : "") + (100 + i) + "室";
                r.subName = i % 3 == 0 ? "电表" + (i % 4) : null;
                r.code = i % 5 != 0 ? "Z77-" + i : (phase >= 2 && i % 10 == 5 ? "Z77-" + i : null);   // 无码表第二批补码
                if (phase == 2 && i == 35) r.code = "Z77-36";                                       // 填了别的表的码:不写回
                r.tenantName = i % 37 == 0 ? "甲公司、乙公司" : "租户" + (i % 60);
                r.ownership = i % 3 == 0 ? "tenant" : i % 3 == 1 ? "share" : null;
                r.tenantId = i % 9 == 0 ? 900000 + i : null;
                r.buildingId = i % 8 == 0 ? 9001 + i % 3 : null;
                r.meterType = i % 11 == 4 ? "总电表" : null;
                if ("elec".equals(r.kind)) r.factor = i % 10 == 3 ? d(80) : i % 10 == 4 ? d(40) : null;
                if (phase == 2 && i % 10 == 3) r.factor = d(100);                                   // F15:专员改倍率,被拒
                if (phase == 3 && i % 10 == 3) r.factor = d(120);                                   // 旧月只进快照,新月写回
                if (phase == 3 && i % 10 == 6 && t == 0) r.factor = d(2);
                if (phase == 2 && t >= 1 && i % 11 == 0) { r.tenantName = "新租户" + i; r.tenantId = null; }   // 换租(G3)
                if (phase == 2 && t >= 1 && i % 19 == 0) { r.area = "B座"; r.buildingId = 9005; }             // 换楼
                if (phase == 2 && t == 1 && i % 29 == 3) r.tenantName = "停用";                                 // G4 停用
                if (phase == 2 && t == 2 && i % 31 == 4) r.code = "已拆";                                       // G4 已拆
                // 读数:分时表四段 + 总;每隔几格空一行(只有上月止)
                double base = 1000 + i * 10 + mi * 50;
                boolean blank = (i + mi) % 23 == 0 || (phase == 2 && t == 2 && i % 31 == 4 && i % 2 == 1);
                double use = 20 + rnd.nextInt(60) + rnd.nextInt(100) / 100.0;
                r.pt = d(base);
                if (!blank) r.ct = d(base + use);
                if ("elec".equals(r.kind) && i % 4 == 1) {
                    r.ps = d(base / 4); r.pp = d(base / 4); r.pf = d(base / 4); r.pv = d(base / 4);
                    if (!blank) { r.cs = d(base / 4 + use / 4); r.cp = d(base / 4 + use / 4); r.cf = d(base / 4 + use / 4); r.cv = d(base / 4 + use / 4); }
                }
                if (i % 15 == 2) r.note = "备注" + i;
                rows.add(r.row());
                if (i % 41 == 7) rows.add(r.copy().row());                                         // 同月重复,读数相同:放行
                if (i % 43 == 8) { R x = r.copy(); x.ct = d(base + use + 1); rows.add(x.row()); }   // 同月重复,读数不同:G6
                if (i % 47 == 9) { R x = r.copy(); x.code = null; rows.add(x.row()); }              // 另一张 sheet 无码,读数相同
                if (i % 53 == 10 && r.ct != null) {                                                 // 同址无码临电,读数不同:新建
                    R x = r.copy(); x.code = null; x.name = "临电" + i; x.ct = d(base + 3); rows.add(x.row());
                }
            }
            if (phase == 2 && t == 2) for (int k = 0; k < 4; k++) {                                // 换表:同址新码新名
                R x = new R(); x.ym = ym; int o = k * 20 + 1;
                x.name = "换上的表" + k; x.area = "A" + (o % 6) + "座"; x.spot = (o % 9 + 1) + "楼" + (100 + o) + "室";
                x.subName = o % 3 == 0 ? "电表" + (o % 4) : null; x.code = "Z77-N" + k; x.pt = d(0); x.ct = d(5 + k);
                rows.add(x.row());
                if (k == 2) { R y = x.copy(); y.code = null; y.name = "无码临电" + o; rows.add(y.row()); }   // 同址有码异名:不认它,新建并提示
            }
            if (phase == 3 && t == 1) {                                                         // 同址有码异名、那块表本批不在:不认它,新建并提示
                R y = new R(); y.ym = ym; int o = 101;
                y.name = "无码临电" + o; y.area = "A" + (o % 6) + "座"; y.spot = (o % 9 + 1) + "楼" + (100 + o) + "室";
                y.pt = d(0); y.ct = d(9); rows.add(y.row());
            }
            rows.addAll(oddRows(ym, phase, t));
        }
        return rows;
    }

    /** 夹具表的行、坏行。 */
    private static List<MeterImportRequest.Row> oddRows(String ym, int phase, int t) {
        List<R> out = new ArrayList<>();
        R f1 = fix("F1冻结表", "Z77-F1", ym); f1.tenantName = "冻结月换租" + phase; out.add(f1);
        R f2 = fix("F2审核锁表", "Z77-F2", ym); f2.tenantName = "审核锁换租" + phase; out.add(f2);
        R f3 = fix("F3人工表", "Z77-F3", ym); f3.tenantName = "册子户"; f3.ownership = "share"; f3.buildingId = 9002;
        f3.area = "A9座"; f3.spot = (phase == 2 ? "4楼" : "3楼") + "903室"; out.add(f3);
        R f3b = fix("F3人工表", "Z77-F3", ym); f3b.code = null; f3b.tenantName = null; f3b.area = null; f3b.spot = null;
        if (t == 0 && phase == 3) out.add(f3b);                                       // 企业名称为空,档案有名(G1)
        out.add(fix(null, "Z77-DUP", ym));                                            // 同码两块,按月挑在册的
        R g5 = fix("填错八期码", "Z78-X", ym); out.add(g5);                            // G5:编码认到 p78
        R amb = fix(null, null, ym); amb.area = "A9座"; amb.spot = "6楼906室"; amb.tenantName = null; out.add(amb);   // 位置歧义
        R amb2 = amb.copy(); amb2.name = "同址乙"; amb2.tenantName = "同址乙户"; out.add(amb2);                         // 企业名称收窄
        R f9 = fix("F9停用表", "Z77-F9", ym); f9.pt = d(11); f9.ct = d(21); out.add(f9);   // G8 停用有读数
        R blank4 = new R(); blank4.ym = ym; blank4.name = "四空重复"; blank4.pt = d(11); blank4.ct = d(21);
        out.add(blank4);                                                              // 四空新表与 F9 同月读数全等:疑似重复建档
        R f10 = fix("F10已拆表", null, ym); f10.area = "A9座"; f10.spot = "8楼908室"; out.add(f10);   // G8:已拆,按位置不认 → 新建
        R g10 = fix("F11没在册", null, ym); g10.area = null; g10.spot = null; out.add(g10);           // G10 自愈补在册撞码
        if (phase == 2 && t == 0) {                                                   // 同一块表同一个月两行、读数相同、企业名称不同:改本批刚写的那行
            R a = fix("F13同月两行", "Z77-F13", ym); a.tenantName = "甲户"; out.add(a);
            R b = a.copy(); b.tenantName = "乙户"; out.add(b);
        }
        if (phase == 2 && t == 1) {                                                   // 同月先「已拆」后「停用」(都没读数):状态行本批写两次
            R c = fix("F13同月两行", "已拆", ym); c.area = "A9座"; c.spot = "9楼909室"; c.ct = null; out.add(c);
            R e = fix("F13同月两行", "Z77-F13", ym); e.tenantName = "停用"; e.ct = null; out.add(e);
        }
        if (phase == 1 && t == 1) {                                                   // 拆表有读数 → 次月(已有一行 active)改成已拆
            R x = fix("F14改已有状态", "已拆", ym); x.area = "A9座"; x.spot = "10楼910室"; out.add(x);
        }
        if (t == 1) {
            R bad = fix("坏类别", null, ym); bad.kind = "gas"; out.add(bad);
            R badZ = fix("坏期区", null, ym); badZ.zone = "x9"; out.add(badZ);
            R badY = fix("坏月份", null, "2077-13"); out.add(badY);
            R empty = new R(); empty.ym = ym; out.add(empty);
            R badO = fix("坏归属", null, ym); badO.ownership = "bogus"; out.add(badO);
        }
        return out.stream().map(R::row).toList();
    }

    private static R fix(String name, String code, String ym) {
        R r = new R(); r.ym = ym; r.name = name; r.code = code; r.tenantName = name == null ? null : name + "户";
        r.pt = d(10); r.ct = d(20 + ym.hashCode() % 7);
        return r;
    }

    // ══════════ 规范文本 ══════════

    private MeterImportResultDTO as(String user, List<String> perms, Supplier<MeterImportResultDTO> call) {
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(user, null,
            perms.stream().map(SimpleGrantedAuthority::new).toList()));
        try {
            MeterImportResultDTO d = call.get();
            batches.add(d.batchId());
            return d;
        } finally {
            SecurityContextHolder.clearContext();
        }
    }

    private Map<String, Long> sessionStatus() {
        Map<String, Long> m = new LinkedHashMap<>();
        jdbc.query("SHOW SESSION STATUS WHERE Variable_name IN ('Questions','Com_select','Com_insert','Com_update','Com_delete')",
            rs -> { m.put(rs.getString(1), rs.getLong(2)); });
        return m;
    }

    private List<String> canon(List<Object[]> runs) throws Exception {
        Map<Long, String> label = new HashMap<>();
        List<Long> ids = jdbc.queryForList("SELECT id FROM meter WHERE zone IN " + MINE + " ORDER BY id", Long.class);
        for (int k = 0; k < ids.size(); k++) label.put(ids.get(k), "M" + (k + 1));
        Map<Long, String> aRank = rank("meter_assign", "A"), sRank = rank("meter_status", "S");
        List<String> out = new ArrayList<>();
        for (Object[] run : runs) {
            MeterImportResultDTO d = (MeterImportResultDTO) run[1];
            out.add("## " + run[0] + " imported=" + d.imported() + " skipped=" + d.skipped() + " batch=" + batch(d.batchId()));
            for (ImportError e : d.errors()) out.add("E " + e.rowIndex() + " | " + e.label() + " | " + ids(e.reason(), label));
            for (ImportError e : d.notices()) out.add("N " + e.rowIndex() + " | " + e.label() + " | " + ids(e.reason(), label));
            for (MeterImportResultDTO.Match m : d.matches())
                out.add("H " + m.rowIndex() + " | " + m.label() + " | " + m.matchBy() + " | " + lab(label, m.meterId()));
            for (MeterImportResultDTO.Change c : d.changes())
                out.add("C " + lab(label, c.meterId()) + " | " + c.label() + " | " + c.field() + " | " + c.before() + " | " + c.after()
                    + " | " + c.from() + " | " + c.until());
        }
        String mine = "(SELECT id FROM meter WHERE zone IN " + MINE + ")";
        out.add("## meter");
        jdbc.query("SELECT id, kind, zone, name, code, factor, meter_type, device_type, suspect, is_dorm_room, sort_no FROM meter"
            + " WHERE zone IN " + MINE + " ORDER BY id", rs -> {
            out.add(label.get(rs.getLong(1)) + " | " + cells(rs, 2, 10) + " | sort+" + (rs.getInt(11) - sortBase));
        });
        out.add("## meter_assign");
        jdbc.query("SELECT * FROM meter_assign WHERE meter_id IN " + mine + " ORDER BY id", rs -> {
            out.add(aRank.get(rs.getLong("id")) + " | " + label.get(rs.getLong("meter_id")) + " | " + rs.getString("from_ym")
                + " | " + cells(rs, 4, 18) + " | " + batch(rs.getString("batch_id")));
        });
        out.add("## meter_status");
        jdbc.query("SELECT * FROM meter_status WHERE meter_id IN " + mine + " ORDER BY id", rs -> {
            out.add(sRank.get(rs.getLong("id")) + " | " + label.get(rs.getLong("meter_id")) + " | " + rs.getString("from_ym")
                + " | " + rs.getString("status") + " | " + rs.getString("src") + " | " + batch(rs.getString("batch_id")));
        });
        out.add("## meter_reading");
        jdbc.query("SELECT meter_id, ym, prev_total, curr_total, prev_sharp, prev_peak, prev_flat, prev_valley, curr_sharp, curr_peak,"
            + " curr_flat, curr_valley, factor_snap, note, source FROM meter_reading WHERE meter_id IN " + mine + " ORDER BY meter_id, ym", rs -> {
            out.add(label.get(rs.getLong(1)) + " | " + cells(rs, 2, 15));
        });
        out.add("## meter_book_seen");
        List<String> seen = new ArrayList<>();
        jdbc.query("SELECT meter_id, ym, batch_id, file_name FROM meter_book_seen WHERE meter_id IN " + mine, rs -> {
            seen.add(label.get(rs.getLong(1)) + " | " + rs.getString(2) + " | " + batch(rs.getString(3)) + " | " + rs.getString(4));
        });
        seen.sort(null);
        out.addAll(seen);
        out.add("## meter_archive_log");
        jdbc.query("SELECT meter_id, tbl, from_ym, action, before_json, after_json, src, batch_id, file_name, row_ref, operator"
            + " FROM meter_archive_log WHERE meter_id IN " + mine + " ORDER BY id", rs -> {
            Map<Long, String> r = "assign".equals(rs.getString(2)) ? aRank : sRank;
            try {
                out.add(label.get(rs.getLong(1)) + " | " + rs.getString(2) + " | " + rs.getString(3) + " | " + rs.getString(4)
                    + " | " + js(rs.getString(5), r, label) + " | " + js(rs.getString(6), r, label) + " | " + rs.getString(7)
                    + " | " + batch(rs.getString(8)) + " | " + rs.getString(9) + " | " + rs.getString(10) + " | " + rs.getString(11));
            } catch (Exception e) { throw new IllegalStateException(e); }
        });
        out.add("## data_change_log");
        jdbc.query("SELECT ym, source FROM data_change_log WHERE id > ? ORDER BY id", rs -> {
            out.add(rs.getString(1) + " | " + rs.getString(2));
        }, dclFrom);
        return out;
    }

    private Map<Long, String> rank(String table, String p) {
        List<Long> ids = jdbc.queryForList("SELECT id FROM " + table + " WHERE meter_id IN (SELECT id FROM meter WHERE zone IN "
            + MINE + ") ORDER BY id", Long.class);
        Map<Long, String> m = new HashMap<>();
        for (int k = 0; k < ids.size(); k++) m.put(ids.get(k), p + (k + 1));
        return m;
    }

    private String batch(String id) {
        if (id == null) return "∅";
        int k = batches.indexOf(id);
        return k < 0 ? "B?" : "B" + (k + 1);
    }

    private static String lab(Map<Long, String> label, Integer id) {
        return id == null ? "∅" : label.getOrDefault(id.longValue(), "id?");
    }

    private static String cells(java.sql.ResultSet rs, int from, int to) throws java.sql.SQLException {
        List<String> c = new ArrayList<>();
        for (int k = from; k <= to; k++) {
            Object v = rs.getObject(k);
            c.add(v == null ? "∅" : v instanceof BigDecimal b ? b.toPlainString() : String.valueOf(v));
        }
        return String.join(" | ", c);
    }

    private String js(String s, Map<Long, String> rank, Map<Long, String> label) throws Exception {
        if (s == null) return "∅";
        ObjectNode n = (ObjectNode) json.readTree(s);
        if (n.hasNonNull("id")) n.put("id", rank.getOrDefault(n.get("id").asLong(), "id?"));
        if (n.hasNonNull("meterId")) n.put("meterId", label.getOrDefault(n.get("meterId").asLong(), "id?"));
        if (n.hasNonNull("batchId")) n.put("batchId", batch(n.get("batchId").asText()));
        return json.writeValueAsString(n);
    }

    private static final Pattern ID_LIST = Pattern.compile("id (\\d+(?:、\\d+)*)");

    private static String ids(String s, Map<Long, String> label) {
        Matcher m = ID_LIST.matcher(s);
        StringBuilder b = new StringBuilder();
        while (m.find()) {
            String r = java.util.Arrays.stream(m.group(1).split("、"))
                .map(x -> label.getOrDefault(Long.parseLong(x), "id?")).collect(Collectors.joining("、"));
            m.appendReplacement(b, Matcher.quoteReplacement("id " + r));
        }
        m.appendTail(b);
        return b.toString();
    }
}

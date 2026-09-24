package com.park.demo3.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import com.park.demo3.entity.BillNotice;
import com.park.demo3.entity.MeterArchiveLog;
import com.park.demo3.entity.MeterAssign;
import com.park.demo3.entity.MeterStatus;
import com.park.demo3.entity.ReviewState;
import com.park.demo3.mapper.DataChangeLogMapper;
import com.park.demo3.mapper.MeterArchiveLogMapper;
import com.park.demo3.mapper.MeterAssignMapper;
import com.park.demo3.mapper.MeterMapper;
import com.park.demo3.mapper.MeterStatusMapper;
import com.park.demo3.mapper.ReviewStateMapper;
import com.park.demo3.security.ReviewKind;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.Collection;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.function.Function;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * 表档案按月记录(METER-TIMELINE-SPEC)的唯一读写入口。
 *
 * 读:带月份的读取一律 viewAt(ym) —— 一次装全部行,内存取值,禁止逐表子查询(§2);没有月份语境取 latest()。
 * 写:任何写都是「在某月写一行」(插入或更新该月那行),绝不顺手改别的行(§3.1);每次写留一条 meter_archive_log
 *    前后像,并对受影响区间逐月记 data_change_log(src=migrate 除外)。
 *
 * 本类**不做**冻结与审核闸:写端点所在的 service 方法自己先调
 * reviewGuard.assertEditable(ReviewKind.METERS, months, null),再按 frozenMonths 决定拒绝还是降级(导入 G11)。
 * 守卫必须写在调用方的方法体里 —— ReviewGuardCoverageTest 只认那里的 reviewGuard.assert,认不到本类。
 */
@Service
public class MeterTimelineService {
    public static final String ASSIGN = "assign", STATUS = "status";
    public static final String SRC_MIGRATE = "migrate";
    public static final String SOURCE_ARCHIVE = "meter-archive";
    private static final Pattern YM = Pattern.compile("\\d{4}-(0[1-9]|1[0-2])");
    private static final Set<String> SRCS = Set.of("import", "manual", "migrate", "contract");
    private static final Set<String> STATUSES = Set.of("active", "retired", "removed");
    private static final Set<String> REVIEW_LOCKING = Set.of("submitted", "approved");   // 同 ReviewGuard.LOCKING

    /** 一次写的来源:src 必填(import/manual/migrate/contract);operator 空则取当前登录名。 */
    public record Ctx(String src, String batchId, String fileName, String rowRef, String operator) {
        public static Ctx of(String src) { return new Ctx(src, null, null, null, null); }
    }

    /** 冻结月:ym + 人话原因(同月多个原因用「、」连)。 */
    public record Frozen(String ym, String reason) {}

    /** 一块表的全部行,各按 from_ym 升序。 */
    public record Rows(List<MeterAssign> assign, List<MeterStatus> status) {}

    /** 站在 ym 看到的档案。assign 早于第一行取第一行;status 早于第一行 = null(不在册)。 */
    public record View(String ym, Map<Integer, List<MeterAssign>> assigns, Map<Integer, List<MeterStatus>> statuses) {
        public MeterAssign assign(int meterId) { return MeterTimeline.assignAt(assigns.getOrDefault(meterId, List.of()), ym); }
        public MeterStatus status(int meterId) { return MeterTimeline.statusAt(statuses.getOrDefault(meterId, List.of()), ym); }
    }

    private final MeterAssignMapper assigns;
    private final MeterStatusMapper statuses;
    private final MeterArchiveLogMapper archive;
    private final DataChangeLogMapper changes;
    private final ReviewStateMapper reviewStates;
    private final ObjectMapper json;
    private final MeterMapper meters;

    public MeterTimelineService(MeterAssignMapper assigns, MeterStatusMapper statuses, MeterArchiveLogMapper archive,
                                DataChangeLogMapper changes, ReviewStateMapper reviewStates, ObjectMapper json,
                                MeterMapper meters) {
        this.assigns = assigns; this.statuses = statuses; this.archive = archive;
        this.changes = changes; this.reviewStates = reviewStates; this.json = json; this.meters = meters;
    }

    // ══════════ 读 ══════════

    // 对外(viewAt / rows / 写方法的返回值)一律给副本,不给 MyBatis 查出来的那个对象:
    // 一级缓存在同一事务里对同一句查询回**同一批对象**。调用方改了拿到的行再交给 writeAssign,
    // writeAssign 自己查出的「旧行」就是被改过的同一个对象,判成「一格没变」直接返回 —— 写丢了且不报错
    // (A2 实测:同一事务里先 rows() 再改 contract_id,绑定整个没落库)。
    public View viewAt(String ym) {
        checkYm(ym);
        return new View(ym,
            group(copies(assigns.selectList(new QueryWrapper<MeterAssign>().orderByAsc("meter_id", "from_ym")), MeterAssign::new),
                MeterAssign::getMeterId),
            group(copies(statuses.selectList(new QueryWrapper<MeterStatus>().orderByAsc("meter_id", "from_ym")), MeterStatus::new),
                MeterStatus::getMeterId));
    }

    public View latest() { return viewAt(MeterTimeline.LATEST); }

    /**
     * 站在 ym 的全部表(资产 + assignAt(ym) + statusAt(ym)),sort_no → id 序。带月份的消费点一律走这里(§2);
     * 没有月份语境传 MeterTimeline.LATEST。不在册的表也在内(status = null),在不在服务由调用方按
     * MeterService.outOfService 判 —— 那是唯一定义点。
     */
    public List<MeterAt> metersAt(String ym) {
        View v = viewAt(ym);
        return meters.selectFiltered(null, null).stream()
            .map(m -> MeterAt.of(m, v.assign(m.getId()), v.status(m.getId()), ym)).toList();
    }

    public Rows rows(int meterId) {
        return new Rows(copies(assignRows(meterId), MeterAssign::new), copies(statusRows(meterId), MeterStatus::new));
    }

    /** 库里最大已生成月(读数 / 催缴单 / 池快照);全库无数据 = null。 */
    public String maxGeneratedYm() { return blankToNull(assigns.maxGeneratedYm()); }

    /** 改动 tbl(assign|status)里 fromYm 那一段会影响到的月份:[from, 下一行) 或链尾到最大已生成月(§4)。 */
    public List<String> affectedMonths(int meterId, String tbl, String fromYm) {
        checkYm(fromYm);
        List<String> froms = switch (tbl) {
            case ASSIGN -> assignRows(meterId).stream().map(MeterAssign::getFromYm).toList();
            case STATUS -> statusRows(meterId).stream().map(MeterStatus::getFromYm).toList();
            default -> throw new IllegalArgumentException("tbl 只能是 assign / status:" + tbl);
        };
        return MeterTimeline.affectedMonths(fromYm, MeterTimeline.until(froms, fromYm), maxGeneratedYm());
    }

    /**
     * §4 冻结:这块表在 months 里哪些月冻结、为什么。两个来源:
     *   1. 该月抄表审核锁定(review_state meters:YYYY-MM 为 submitted / approved);
     *   2. 该月有已确认 / 已导出(含历史 issued)的催缴单,且明细含这块表。
     * 按 ym 升序;一个都没有回空列表。
     */
    public List<Frozen> frozenMonths(int meterId, Collection<String> months) {
        Set<String> want = new HashSet<>(months);
        Map<String, Set<String>> why = new TreeMap<>();
        for (ReviewState s : reviewStates.byKindAndScope(ReviewKind.METERS.code(), null))
            if (want.contains(s.getPeriod()) && REVIEW_LOCKING.contains(s.getStatus()))
                why.computeIfAbsent(s.getPeriod(), k -> new LinkedHashSet<>())
                   .add(ReviewKind.METERS.label() + ("approved".equals(s.getStatus()) ? "已审核" : "待审核"));
        for (BillNotice n : assigns.lockedNotices(meterId))
            if (want.contains(n.getYm()))
                why.computeIfAbsent(n.getYm(), k -> new LinkedHashSet<>()).add("含这块表的催缴单" + switch (n.getStatus()) {
                    case "confirmed" -> "已确认";
                    case "exported" -> "已导出";
                    default -> "已出单";   // issued:V94 之前的历史态
                });
        return why.entrySet().stream().map(e -> new Frozen(e.getKey(), String.join("、", e.getValue()))).toList();
    }

    // ══════════ 写 ══════════

    /** 在 row.fromYm 写这块表的归属行(有则整行覆盖,无则插入)。src/batchId 取自 ctx。值一格没变 = 没写,不留底。 */
    @Transactional
    public MeterAssign writeAssign(MeterAssign row, Ctx ctx) {
        checkYm(row.getFromYm());
        checkSrc(ctx);
        row.setSrc(ctx.src());
        row.setBatchId(ctx.batchId());
        if (row.getOwnership() == null) row.setOwnership("share");   // 同 meter_assign.ownership 列默认
        if (row.getTenantManual() == null) row.setTenantManual(0);
        if (row.getOwnerManual() == null) row.setOwnerManual(0);
        if (row.getLocManual() == null) row.setLocManual(0);
        List<MeterAssign> cur = assignRows(row.getMeterId());
        MeterAssign old = find(cur, MeterAssign::getFromYm, row.getFromYm());
        if (old == null) {
            row.setId(null);
            assigns.insert(row);
        } else {
            row.setId(old.getId());
            if (old.equals(row)) return row;   // 值同旧行;回调用方自己的对象,不回缓存里那个
            assigns.updateById(row);
        }
        record(ASSIGN, row.getMeterId(), row.getFromYm(), old == null ? "insert" : "update", old, row,
            MeterTimeline.until(cur.stream().map(MeterAssign::getFromYm).toList(), row.getFromYm()), ctx);
        return row;
    }

    /** 在 fromYm 写这块表的状态行(active / retired / removed)。 */
    @Transactional
    public MeterStatus writeStatus(int meterId, String fromYm, String status, Ctx ctx) {
        checkYm(fromYm);
        checkSrc(ctx);
        if (!STATUSES.contains(status)) throw new BizException(ResultCode.BAD_REQUEST, "状态只能是 active / retired / removed:" + status);
        List<MeterStatus> cur = statusRows(meterId);
        MeterStatus old = find(cur, MeterStatus::getFromYm, fromYm);
        MeterStatus row = new MeterStatus();
        row.setMeterId(meterId); row.setFromYm(fromYm); row.setStatus(status);
        row.setSrc(ctx.src()); row.setBatchId(ctx.batchId());
        if (old == null) {
            statuses.insert(row);
        } else {
            row.setId(old.getId());
            if (old.equals(row)) return row;
            statuses.updateById(row);
        }
        record(STATUS, meterId, fromYm, old == null ? "insert" : "update", old, row,
            MeterTimeline.until(cur.stream().map(MeterStatus::getFromYm).toList(), fromYm), ctx);
        return row;
    }

    /** 删 fromYm 那一行状态(撤回误标 / 撤销导入)。「第一行不能删」是端点的规矩(SPEC §3.4),撤销导入要能删自愈行,本方法不拦。 */
    @Transactional
    public void deleteStatus(int meterId, String fromYm, Ctx ctx) {
        checkSrc(ctx);
        List<MeterStatus> cur = statusRows(meterId);
        MeterStatus old = find(cur, MeterStatus::getFromYm, fromYm);
        if (old == null) throw new BizException(ResultCode.NOT_FOUND, "这块表没有自 " + fromYm + " 起的状态行");
        statuses.deleteById(old.getId());
        record(STATUS, meterId, fromYm, "delete", old, null,
            MeterTimeline.until(cur.stream().map(MeterStatus::getFromYm).toList(), fromYm), ctx);
    }

    /** 删 fromYm 那一行归属(撤销导入「插入的删掉」、批量删除本期连带删 import 行,SPEC §3.5)。 */
    @Transactional
    public void deleteAssign(int meterId, String fromYm, Ctx ctx) {
        checkSrc(ctx);
        List<MeterAssign> cur = assignRows(meterId);
        MeterAssign old = find(cur, MeterAssign::getFromYm, fromYm);
        if (old == null) throw new BizException(ResultCode.NOT_FOUND, "这块表没有自 " + fromYm + " 起的归属行");
        assigns.deleteById(old.getId());
        record(ASSIGN, meterId, fromYm, "delete", old, null,
            MeterTimeline.until(cur.stream().map(MeterAssign::getFromYm).toList(), fromYm), ctx);
    }

    /**
     * 给 months 逐月记一条 data_change_log(source = meter-archive | meter-reading),changed_at 取 Java 时钟。
     *
     * ponytail: 早于「库里最早已生成月」的月份不记 —— 那些月没有任何快照,将来生成的快照必然晚于这次改动,
     *   永远不会因它「需重算」。不裁的话,一次从 1900-01 起生效的写会落上千条无用行。
     */
    public void recordChange(Collection<String> months, String source) {
        String min = blankToNull(assigns.minGeneratedYm());
        if (min == null) return;
        List<String> keep = new TreeSet<>(months).stream().filter(m -> m.compareTo(min) >= 0).toList();
        if (!keep.isEmpty()) changes.insertMonths(keep, source, LocalDateTime.now());
    }

    // ══════════ 内部 ══════════

    private void record(String tbl, int meterId, String fromYm, String action, Object before, Object after,
                        String until, Ctx ctx) {
        MeterArchiveLog l = new MeterArchiveLog();
        l.setMeterId(meterId); l.setTbl(tbl); l.setFromYm(fromYm); l.setAction(action);
        l.setBeforeJson(toJson(before)); l.setAfterJson(toJson(after));
        l.setSrc(ctx.src()); l.setBatchId(ctx.batchId()); l.setFileName(ctx.fileName()); l.setRowRef(ctx.rowRef());
        l.setOperator(ctx.operator() != null ? ctx.operator() : currentUser());
        l.setAt(LocalDateTime.now());
        archive.insert(l);
        if (!SRC_MIGRATE.equals(ctx.src()))
            recordChange(MeterTimeline.affectedMonths(fromYm, until, maxGeneratedYm()), SOURCE_ARCHIVE);
    }

    private List<MeterAssign> assignRows(int meterId) {
        return assigns.selectList(new QueryWrapper<MeterAssign>().eq("meter_id", meterId).orderByAsc("from_ym"));
    }

    private List<MeterStatus> statusRows(int meterId) {
        return statuses.selectList(new QueryWrapper<MeterStatus>().eq("meter_id", meterId).orderByAsc("from_ym"));
    }

    private String toJson(Object o) {
        if (o == null) return null;
        try {
            return json.writeValueAsString(o);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);   // 两个平铺实体,序列化失败只可能是编程错误
        }
    }

    private static <T> T find(List<T> rows, Function<T, String> from, String ym) {
        return rows.stream().filter(r -> ym.equals(from.apply(r))).findFirst().orElse(null);
    }

    private static <T> List<T> copies(List<T> rows, java.util.function.Supplier<T> fresh) {
        return rows.stream().map(r -> {
            T c = fresh.get();
            org.springframework.beans.BeanUtils.copyProperties(r, c);
            return c;
        }).collect(Collectors.toList());   // 可变:import 把本批写的行随写随进
    }

    private static <T> Map<Integer, List<T>> group(List<T> rows, Function<T, Integer> key) {
        return rows.stream().collect(Collectors.groupingBy(key));   // 组内保持查询的 from_ym 升序
    }

    private static void checkYm(String ym) {
        if (ym == null || !YM.matcher(ym).matches()) throw new BizException(ResultCode.BAD_REQUEST, "月份格式应为 YYYY-MM:" + ym);
    }

    private static void checkSrc(Ctx ctx) {
        if (ctx == null || !SRCS.contains(ctx.src()))
            throw new BizException(ResultCode.BAD_REQUEST, "档案写入来源只能是 import / manual / migrate / contract");
    }

    private static String blankToNull(String s) { return s == null || s.isBlank() ? null : s; }

    private static String currentUser() {
        var a = SecurityContextHolder.getContext().getAuthentication();
        return a == null || a.getName() == null ? "" : a.getName();
    }
}

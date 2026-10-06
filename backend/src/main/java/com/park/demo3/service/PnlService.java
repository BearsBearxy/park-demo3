package com.park.demo3.service;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import com.park.demo3.common.YearSpan;
import com.park.demo3.dto.ImportResultDTO;
import com.park.demo3.dto.PnlImportRequest;
import com.park.demo3.dto.PnlOverviewDTO;
import com.park.demo3.dto.PnlOverviewDTO.YearMeta;
import com.park.demo3.dto.PnlRowDTO;
import com.park.demo3.dto.PnlSaveRequest;
import com.park.demo3.dto.PnlYearDTO;
import com.park.demo3.entity.PnlRow;
import com.park.demo3.mapper.PnlRowMapper;
import com.park.demo3.security.NoReviewGuard;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDateTime;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeSet;
import java.util.stream.Collectors;

@Service
public class PnlService {
    private static final List<String> SCHEDULES = List.of("s1", "s2", "s3", "s4", "s5");
    private final PnlRowMapper rows;
    private final ReviewService review;      // 整月锁账的月(closedMonths):改到就整次拒
    private final ChangeLogService changes;  // 手改的每一格进数据修改记录

    public PnlService(PnlRowMapper rows, ReviewService review, ChangeLogService changes) {
        this.rows = rows; this.review = review; this.changes = changes;
    }

    private static void check(String schedule) {
        if (!SCHEDULES.contains(schedule)) throw new BizException(ResultCode.BAD_REQUEST, "未知附表");
    }
    // NULL 保留(未录,区分 0),非空四舍五入到分
    private static BigDecimal r2n(BigDecimal v) { return v == null ? null : v.setScale(2, RoundingMode.HALF_UP); }

    // kind:客端已识别则存其值;否则按标签识别(损益→pnl、小计→subtotal、合计|总计→total、否则 detail)
    static String kindOf(String kind, String label) {
        if (kind != null && !kind.isBlank()) return kind;
        String l = label == null ? "" : label;
        if (l.contains("损益")) return "pnl";
        if (l.contains("小计")) return "subtotal";
        if (l.contains("合计") || l.contains("总计")) return "total";
        return "detail";
    }

    // ── overview:年份范围 = [min(2024,最小数据年) .. max(数据年)+1];无数据 → [去年..明年](YearSpan) ──
    public PnlOverviewDTO overview(String schedule) {
        check(schedule);
        Map<Integer, Integer> countByYear = new LinkedHashMap<>();
        for (Map<String, Object> m : rows.years(schedule)) {
            countByYear.put(((Number) m.get("year")).intValue(), ((Number) m.get("cnt")).intValue());
        }
        YearSpan span = YearSpan.of(countByYear.keySet());
        List<YearMeta> years = new ArrayList<>();
        for (int y = span.lo(); y <= span.hi(); y++) {
            years.add(new YearMeta(y, countByYear.containsKey(y), countByYear.getOrDefault(y, 0)));
        }
        return new PnlOverviewDTO(years);
    }

    // ── 某年全部行(按 sort_order) ──
    public PnlYearDTO year(String schedule, int year) {
        check(schedule);
        return new PnlYearDTO(year, rows.year(schedule, year).stream().map(PnlService::toDTO).toList());
    }

    // ── 保存整年:只写真变了的格(用户 2026-10-05 拍板「2按你建议，3，4一起做」第 3 条) ──
    // 改前是整年 clear+insert:没动的格也删了重写,改到「整月锁账」的月也拦不住,改了什么也没留下。
    // 现在送来的行和库里的逐行对上(match),只增 / 改 / 删变了的;变了的格落在整月锁账的月 → 整次拒(refuseClosed);
    // 手改的每一格进数据修改记录。auto = 屏上打开这一年时自动补行(PnlScheduleView.tryGenerate):只许加行(见 apply)。
    @NoReviewGuard(reason = "损益附表按年落库(pnl 行只有 year 没有 acct_month),没有月度审核键可挂;"
        + "改到「整月锁账」的月由 apply 自己拒(读 ReviewService.closedMonths),不走 ReviewGuard")
    @Transactional
    public PnlYearDTO save(String schedule, int year, PnlSaveRequest req, boolean auto) {
        check(schedule);
        apply(schedule, year, req == null ? null : req.rows(), true, auto);
        return year(schedule, year);
    }

    // ── 导入整年:同 save 只写变了的、锁账月照拒;不逐格记(同一拍板:导入由 import_log 记谁、何时、哪个文件) ──
    @NoReviewGuard(reason = "同 save:按年落库,无月度审核键可挂;锁账月由 apply 自己拒")
    @Transactional
    public ImportResultDTO importRows(String schedule, int year, PnlImportRequest req) {
        check(schedule);
        int imported = apply(schedule, year, req == null ? null : req.rows(), false, false);
        return new ImportResultDTO(imported, 0, List.of());
    }

    // ── helpers ──
    /** 数据修改记录里的附表名(照屏上标题 pnlSchedules.ts)。 */
    private static final Map<String, String> SCHEDULE_NAME = Map.of(
        "s1", "附表1 租金损益明细", "s2", "附表2 电费损益明细", "s3", "附表3 水费损益明细",
        "s4", "附表4 其他运管费用收益", "s5", "附表5 费用支出明细");
    /** 行的类别(kind)照屏上新增行弹窗的叫法(PnlScheduleView KIND_TEXT)。 */
    private static final Map<String, String> KIND_NAME = Map.of(
        "detail", "明细", "subtotal", "小计", "pnl", "损益", "total", "合计");

    /**
     * 送来的行就是这一年的全部行:和库里的逐行对上,只删没了的、只改变了的、只加新的,返回送来的行数。
     * 一格都没变 → 一次写都没有。log = 手改:变了的每一格(各月金额、备注、类别)进数据修改记录;导入传 false。
     */
    private int apply(String schedule, int year, List<PnlRowDTO> dtos, boolean log, boolean auto) {
        List<PnlRow> old = rows.year(schedule, year);
        List<PnlRow> next = new ArrayList<>();
        if (dtos != null) for (PnlRowDTO dto : dtos) next.add(toRow(schedule, year, dto, next.size()));
        int[] pair = match(old, next);
        boolean[] kept = new boolean[old.size()];
        for (int p : pair) if (p >= 0) kept[p] = true;
        if (auto) {
            // 进年自动补行只许加行:它送来的是几秒前读到的整年,已有的行有一格不一样 = 这期间别人存过,
            // 照写就把别人的数改回去,记录还会写成「自动补的行」、记在恰好打开这屏的人名下。屏上这一句不显示(tryGenerate 吞掉)
            boolean edits = false;
            for (boolean k : kept) edits |= !k;
            for (int j = 0; j < next.size(); j++) edits |= pair[j] >= 0 && !sameContent(old.get(pair[j]), next.get(j));
            if (edits) throw new BizException(ResultCode.CONFLICT, "这一年刚被别人改过，自动补的行没存");
        }

        String head = SCHEDULE_NAME.get(schedule) + " · " + year + " 年";
        List<ChangeLogService.Cell> cells = new ArrayList<>();
        Set<Integer> touched = new TreeSet<>();
        for (int i = 0; i < old.size(); i++) if (!kept[i]) diff(cells, touched, head, old.get(i), null);
        for (int j = 0; j < next.size(); j++) diff(cells, touched, head, pair[j] < 0 ? null : old.get(pair[j]), next.get(j));
        refuseClosed(year, touched);

        List<Long> gone = new ArrayList<>();
        int top = 0;   // 新行的 row_key 接着留下的行往后编:uk_pnl 要唯一,留下的行不改 key(改了就是每行一次写)
        for (int i = 0; i < old.size(); i++) {
            if (kept[i]) top = Math.max(top, keyNo(old.get(i).getRowKey()));
            else gone.add(old.get(i).getId());
        }
        if (!gone.isEmpty()) rows.deleteBatchIds(gone);
        for (int j = 0; j < next.size(); j++) {
            PnlRow n = next.get(j);
            if (pair[j] < 0) { n.setRowKey("r" + (++top)); rows.insert(n); continue; }
            PnlRow o = old.get(pair[j]);
            if (sameRow(o, n)) continue;
            UpdateWrapper<PnlRow> w = new UpdateWrapper<PnlRow>().eq("id", o.getId())
                .set("kind", n.getKind()).set("note", n.getNote()).set("sort_order", n.getSortOrder())
                .set("updated_at", LocalDateTime.now());
            BigDecimal[] v = months(n);
            for (int i = 0; i < 12; i++) w.set("m" + (i + 1), v[i]);   // 逐列显式 set:清空一格(→ NULL)用 updateById 会被跳过
            rows.update(null, w);
        }
        if (log) changes.record(ChangeLogService.Tbl.PNL, cells, auto ? "打开这一年时自动补的行" : null);
        return next.size();
    }

    /**
     * 按「分组 + 科目」对行,返回 next 每行对上的 old 下标,-1 = 新行。同名的行按出现先后对(第 k 个对第 k 个)。
     * 不拿 row_key 对:它按行序合成,删一行、或在中间插一行(进年自动补行就插在组中间),后面每行的 key 都变,
     * 拿它对会把后面每一格都当成改了 —— 记录满屏,还会把根本没动的锁账月误拒。
     * 也不管先后:原来按先后对(最长公共子序列),导入文件的行序和屏上不同(屏上新增的行排在最后、表里排在组中),
     * 那一行就被拆成删一行加一行,它在锁账月的数算改了,整次误拒;那张表还要 旧行数 × 新行数 的内存。
     * 改了科目名算删一行加一行(屏上改不了名,只有导入会)。
     */
    static int[] match(List<PnlRow> old, List<PnlRow> next) {
        Map<String, ArrayDeque<Integer>> byKey = new HashMap<>();
        for (int i = 0; i < old.size(); i++) byKey.computeIfAbsent(key(old.get(i)), k -> new ArrayDeque<>()).add(i);
        int[] pair = new int[next.size()];
        for (int j = 0; j < next.size(); j++) {
            ArrayDeque<Integer> q = byKey.get(key(next.get(j)));
            pair[j] = q == null || q.isEmpty() ? -1 : q.poll();
        }
        return pair;
    }
    private static String key(PnlRow r) { return r.getGroupLabel() + "\n" + r.getLabel(); }
    private static int keyNo(String rowKey) {
        return rowKey != null && rowKey.matches("r\\d{1,9}") ? Integer.parseInt(rowKey.substring(1)) : 0;
    }

    /** 一行写前写后逐格比(before = null 新行,after = null 删掉的行):变了的月记进 touched,每格一条进 cells。 */
    private static void diff(List<ChangeLogService.Cell> cells, Set<Integer> touched, String head,
                             PnlRow before, PnlRow after) {
        PnlRow r = after == null ? before : after;
        String ref = head + (r.getGroupLabel().isEmpty() ? "" : " · " + r.getGroupLabel()) + " · " + r.getLabel();
        BigDecimal[] b = months(before), a = months(after);
        for (int i = 0; i < 12; i++) {
            if (same(b[i], a[i])) continue;
            touched.add(i + 1);
            cells.add(new ChangeLogService.Cell(ref, (i + 1) + "月", b[i], a[i]));
        }
        String bn = note(before), an = note(after);
        if (!Objects.equals(bn, an)) cells.add(new ChangeLogService.Cell(ref, "备注", bn, an));
        // 类别决定这一行进不进经营分析的收入 / 成本 / 损益(AnalysisService.isPnlBandRow、anaData.extractPnlBand):
        // 改了类别等于改了这一行有数的每个月的口径 —— 那几个月算「动了」,锁账月照拒;并记一格。屏上改不了类别,只有导入 / 直接调接口会
        if (before != null && after != null && !Objects.equals(before.getKind(), after.getKind())) {
            for (int i = 0; i < 12; i++) if (b[i] != null || a[i] != null) touched.add(i + 1);
            cells.add(new ChangeLogService.Cell(ref, "类别",
                KIND_NAME.getOrDefault(before.getKind(), before.getKind()), KIND_NAME.getOrDefault(after.getKind(), after.getKind())));
        }
    }
    private static boolean sameRow(PnlRow o, PnlRow n) {
        return sameContent(o, n) && Objects.equals(o.getSortOrder(), n.getSortOrder());
    }
    /** 金额、备注、类别都没变(行序不算)。 */
    private static boolean sameContent(PnlRow o, PnlRow n) {
        BigDecimal[] a = months(o), b = months(n);
        for (int i = 0; i < 12; i++) if (!same(a[i], b[i])) return false;
        return Objects.equals(note(o), note(n)) && Objects.equals(o.getKind(), n.getKind());
    }
    private static boolean same(BigDecimal a, BigDecimal b) { return a == null ? b == null : b != null && a.compareTo(b) == 0; }
    private static String note(PnlRow r) { return r == null || r.getNote() == null || r.getNote().isBlank() ? null : r.getNote(); }
    private static BigDecimal[] months(PnlRow r) {
        return r == null ? new BigDecimal[12] : new BigDecimal[] { r.getM1(), r.getM2(), r.getM3(), r.getM4(),
            r.getM5(), r.getM6(), r.getM7(), r.getM8(), r.getM9(), r.getM10(), r.getM11(), r.getM12() };
    }

    /**
     * 变了的格落在「整月锁账」的月 → 整次拒,点名哪几个月。一格数都没动(只改备注、行序)不去算:closedMonths 要跑好几条聚合。
     * 屏上那一行叫「本月锁账」(数据中心 → 本月出账);一个月要每张表都审核通过才算锁,撤掉其中任一张的审核就解开,
     * 而撤销审核只有审核员能做(Perm REVIEW_APPROVE)—— 这句话照这个说,不说内部的「整月锁账」。
     */
    private void refuseClosed(int year, Set<Integer> touched) {
        if (touched.isEmpty()) return;
        List<String> closed = review.closedMonths();
        List<Integer> hit = touched.stream().filter(m -> closed.contains(String.format("%04d-%02d", year, m))).toList();
        if (hit.isEmpty()) return;
        throw new BizException(ResultCode.LOCKED, year + " 年 "
            + hit.stream().map(m -> m + " 月").collect(Collectors.joining("、"))
            + "已锁账（本月出账里「本月锁账」打了勾），改不了。要改，先请审核员撤销"
            + (hit.size() == 1 ? "那个月" : "每个月") + "其中一张表的审核。");
    }

    private static PnlRow toRow(String schedule, int year, PnlRowDTO dto, int sortOrder) {
        PnlRow r = new PnlRow();
        r.setSchedule(schedule);
        r.setYear(year);
        r.setGroupLabel(dto.groupLabel() == null ? "" : dto.groupLabel());
        r.setLabel(dto.label());
        r.setKind(kindOf(dto.kind(), dto.label()));
        r.setNote(dto.note() == null || dto.note().isBlank() ? null : dto.note());
        List<BigDecimal> m = dto.m();
        BigDecimal[] v = new BigDecimal[12];
        if (m != null) for (int i = 0; i < Math.min(12, m.size()); i++) v[i] = r2n(m.get(i));
        r.setM1(v[0]); r.setM2(v[1]); r.setM3(v[2]); r.setM4(v[3]);
        r.setM5(v[4]); r.setM6(v[5]); r.setM7(v[6]); r.setM8(v[7]);
        r.setM9(v[8]); r.setM10(v[9]); r.setM11(v[10]); r.setM12(v[11]);
        r.setSortOrder(sortOrder);
        return r;
    }

    private static PnlRowDTO toDTO(PnlRow r) {
        return new PnlRowDTO(r.getRowKey(), r.getGroupLabel(), r.getLabel(), r.getKind(), r.getNote(),
            Arrays.asList(r.getM1(), r.getM2(), r.getM3(), r.getM4(), r.getM5(), r.getM6(),
                          r.getM7(), r.getM8(), r.getM9(), r.getM10(), r.getM11(), r.getM12()),
            r.getSortOrder() == null ? 0 : r.getSortOrder());
    }
}

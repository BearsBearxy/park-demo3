package com.park.demo3.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import com.park.demo3.dto.DataHomeOverviewDTO;
import com.park.demo3.dto.ReviewDtos.ReviewRowDTO;
import com.park.demo3.entity.ReviewLog;
import com.park.demo3.entity.ReviewState;
import com.park.demo3.mapper.ElecCostEntryMapper;
import com.park.demo3.mapper.ReviewLogMapper;
import com.park.demo3.mapper.ReviewStateMapper;
import com.park.demo3.security.Perm;
import com.park.demo3.security.ReviewKey;
import com.park.demo3.security.ReviewKind;
import com.park.demo3.security.UserPermissionCache;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 审核机制的状态机与读侧聚合(SIDEBAR-UX-REDESIGN §7.2 / §7.4)。
 *
 * 四个动作 submit / approve / return / withdraw,每一步落一行 review_log。
 * 写路径的闸不在这里 —— 那是 ReviewGuard,挂在 12 个业务 service 上。
 */
@Service
public class ReviewService {

    /** 通过前置(§7.2):这把键要 approved,先得这些上游都 approved。 */
    private static final Map<ReviewKind, List<ReviewKind>> UPSTREAM = Map.of(
        ReviewKind.ALLOC,        List.of(ReviewKind.PARAMS, ReviewKind.METERS),
        ReviewKind.BILL_NOTICES, List.of(ReviewKind.ALLOC, ReviewKind.ALLOC_LOSS));

    /**
     * 撤销前置(D19)的反向图:撤这把键之前,这些下游不许还挂着 approved。
     *
     * ⚠ 比 UPSTREAM 多两条边:params → alloc-loss 与 meters → alloc-loss。
     * spec §7.2 只写了通过前置那两条,漏了这个 —— 楼栋损耗与公共电核算是
     * AllocService.generate(ym) **同一次**算出来的,同样吃 meters 的读数与 params 的电价。
     * 只照字面连 alloc 的话,「meters 已审 → alloc-loss 已审 → 撤 meters」这条路会放行,
     * 抄表员改完读数,已审核的损耗结果就和读数对不上了。
     */
    private static final Map<ReviewKind, List<ReviewKind>> DOWNSTREAM = Map.of(
        ReviewKind.PARAMS,     List.of(ReviewKind.ALLOC, ReviewKind.ALLOC_LOSS),
        ReviewKind.METERS,     List.of(ReviewKind.ALLOC, ReviewKind.ALLOC_LOSS),
        ReviewKind.ALLOC,      List.of(ReviewKind.BILL_NOTICES),
        ReviewKind.ALLOC_LOSS, List.of(ReviewKind.BILL_NOTICES));

    private final ReviewStateMapper states;
    private final ReviewLogMapper logs;
    private final DataHomeService dataHome;
    private final ElecCostEntryMapper elecCostEntries;
    private final UserPermissionCache cache;

    public ReviewService(ReviewStateMapper states, ReviewLogMapper logs, DataHomeService dataHome,
                         ElecCostEntryMapper elecCostEntries, UserPermissionCache cache) {
        this.states = states; this.logs = logs; this.dataHome = dataHome;
        this.elecCostEntries = elecCostEntries; this.cache = cache;
    }

    // ══ 读侧 ═════════════════════════════════════════════════════════════════

    /**
     * 某月全部审核键的当前态,含派生的 entered 与通过前置缺项。
     *
     * 键集合(§7.2)= 出账 5 + 台账公司数 + 附10 期区数 + 其余 7 张(+ elec-model,它不进整月锁账)。
     * 公司全集与期区全集**从 overview 拿**,不另查 management_company ——
     * §12:六项计数与审核键集合必须与屏内 / 后端同源,源缺显「—」,假绿栽过三次。
     */
    public List<ReviewRowDTO> list(String period) {
        DataHomeOverviewDTO ov = dataHome.overview(period);
        Map<String, ReviewState> rows = states.byPeriod(period).stream()
            .collect(java.util.stream.Collectors.toMap(ReviewState::getReviewKey, s -> s, (a, b) -> a));

        List<ReviewRowDTO> out = new ArrayList<>();
        for (ReviewKey key : keysOf(period, ov)) out.add(rowOf(key, rows));
        return out;
    }

    /** 某月的全部审核键。整月锁账的判据 = 这个集合里 countsTowardMonthClose() 为真的全部 approved。 */
    private List<ReviewKey> keysOf(String period, DataHomeOverviewDTO ov) {
        List<ReviewKey> keys = new ArrayList<>();
        for (ReviewKind k : List.of(ReviewKind.PARAMS, ReviewKind.METERS, ReviewKind.ALLOC,
                                    ReviewKind.ALLOC_LOSS, ReviewKind.BILL_NOTICES))
            keys.add(ReviewKey.of(k, null, period));

        for (DataHomeOverviewDTO.Company c : companiesOf(ov))
            keys.add(ReviewKey.of(ReviewKind.LEDGER, String.valueOf(c.id()), period));
        for (DataHomeOverviewDTO.Phase p : phasesOf(ov))
            keys.add(ReviewKey.of(ReviewKind.S10, String.valueOf(p.no()), period));

        keys.add(ReviewKey.of(ReviewKind.SALARY, null, period));
        for (String s : List.of("office", "phase3"))
            keys.add(ReviewKey.of(ReviewKind.UTILITIES, s, period));
        for (ReviewKind k : List.of(ReviewKind.PV, ReviewKind.CHARGING_CAR, ReviewKind.CHARGING_EBIKE,
                                    ReviewKind.ELEC_COST, ReviewKind.ELEC_MODEL))
            keys.add(ReviewKey.of(k, null, period));
        return keys;
    }

    private ReviewRowDTO rowOf(ReviewKey key, Map<String, ReviewState> rows) {
        ReviewState s = rows.get(key.raw());
        List<String> blocked = missingUpstream(key, rows);
        if (s == null) return new ReviewRowDTO(key.raw(), key.kind().code(), key.scope(),
            "entered", null, null, null, null, null, blocked);
        return new ReviewRowDTO(key.raw(), key.kind().code(), key.scope(), s.getStatus(),
            s.getSubmittedBy(), s.getSubmittedAt(), s.getReviewedBy(), s.getReviewedAt(),
            s.getReason(), blocked);
    }

    /** 通过前置缺哪些上游(人话名)。没有前置的 kind 恒返回空 list,不是 null。 */
    private List<String> missingUpstream(ReviewKey key, Map<String, ReviewState> rows) {
        List<String> out = new ArrayList<>();
        for (ReviewKind up : UPSTREAM.getOrDefault(key.kind(), List.of())) {
            ReviewState s = rows.get(ReviewKey.of(up, null, key.period()).raw());
            if (s == null || !"approved".equals(s.getStatus())) out.add(up.label());
        }
        return out;
    }

    /** ping 用:全库待审核条数。见 PresenceService。 */
    public int pendingCount() {
        return Math.toIntExact(states.selectCount(
            new QueryWrapper<ReviewState>().eq("status", "submitted")));
    }

    // ══ 四个动作 ═════════════════════════════════════════════════════════════

    @Transactional
    public void submit(String rawKey) {
        ReviewKey key = ReviewKey.parse(rawKey);
        requireAnyPerm(key.kind().perms(),
            "没有「" + key.kind().label() + "」的录入权限,交不了审");

        ReviewState s = states.selectById(key.raw());
        String cur = s == null ? "entered" : s.getStatus();
        if (!("entered".equals(cur) || "returned".equals(cur)))
            throw new BizException(ResultCode.CONFLICT,
                key.human() + " 当前是「" + human(cur) + "」,不能交审");

        if (!isDone(key))
            throw new BizException(ResultCode.CONFLICT, key.human() + " 还没录完,未做不能交审");

        LocalDateTime now = LocalDateTime.now();
        if (s == null) {
            s = new ReviewState();
            s.setReviewKey(key.raw()); s.setKind(key.kind().code());
            s.setPeriod(key.period()); s.setScope(key.scope());
            s.setStatus("submitted"); s.setSubmittedBy(me()); s.setSubmittedAt(now);
            states.insert(s);
        } else {
            // 重新交审要把上一轮退回的痕迹清掉,否则屏上会同时显示「待审核」与上次的退回理由
            setCols(key, Map.of("status", "submitted", "submitted_by", me(), "submitted_at", now),
                    List.of("reviewed_by", "reviewed_at", "reason"));
        }
        log(key, "submit", null);
    }

    @Transactional
    public void approve(String rawKey) {
        ReviewKey key = ReviewKey.parse(rawKey);
        requireStatus(key, "submitted", "通过");

        Map<String, ReviewState> rows = states.byPeriod(key.period()).stream()
            .collect(java.util.stream.Collectors.toMap(ReviewState::getReviewKey, x -> x, (a, b) -> a));
        List<String> missing = missingUpstream(key, rows);
        if (!missing.isEmpty())
            throw new BizException(ResultCode.CONFLICT,
                "先通过 " + String.join(" / ", missing) + " 的审核,再来审 " + key.kind().label());

        setCols(key, Map.of("status", "approved", "reviewed_by", me(), "reviewed_at", LocalDateTime.now()),
                List.of("reason"));
        log(key, "approve", null);
    }

    @Transactional
    public void returnBack(String rawKey, String reason) {
        ReviewKey key = ReviewKey.parse(rawKey);
        requireStatus(key, "submitted", "退回");
        setCols(key, Map.of("status", "returned", "reviewed_by", me(),
                            "reviewed_at", LocalDateTime.now(), "reason", reason), List.of());
        log(key, "return", reason);
    }

    /**
     * 撤销审核 —— 回到派生态「录入中」,所以是**删行**不是置某个状态。
     *
     * 不留 returned:那个态的语义是「审核员退回了,改完再交」,而撤销的语义是「这条审核作废」。
     * 理由留在 review_log 里,查得到。
     */
    @Transactional
    public void withdraw(String rawKey, String reason) {
        ReviewKey key = ReviewKey.parse(rawKey);
        requireStatus(key, "approved", "撤销");

        Map<String, ReviewState> rows = states.byPeriod(key.period()).stream()
            .collect(java.util.stream.Collectors.toMap(ReviewState::getReviewKey, x -> x, (a, b) -> a));
        List<String> blockers = new ArrayList<>();
        for (ReviewKind down : DOWNSTREAM.getOrDefault(key.kind(), List.of())) {
            ReviewState d = rows.get(ReviewKey.of(down, null, key.period()).raw());
            if (d != null && "approved".equals(d.getStatus())) blockers.add(down.label());
        }
        if (!blockers.isEmpty())
            throw new BizException(ResultCode.CONFLICT,
                "先撤销 " + String.join(" / ", blockers) + " 的审核");

        states.deleteById(key.raw());
        log(key, "withdraw", reason);
    }

    // ══ 内部 ═════════════════════════════════════════════════════════════════

    /**
     * 交审前置的「已做」判据。
     *
     * ponytail: 调一遍首页聚合(约十几条 count 查询)换「done 判据与屏上同源」。不另写一份 ——
     *   METRIC-SOURCE-SPEC §1:同一件事不许有第二份实现,首页和交审报的数一旦差一份,
     *   用户不知道该信谁。交审是低频动作(一个月十几次),这个代价可接受。
     *   升级路径:等 DataHomeService 拆出单键 done 查询后换过去。
     */
    private boolean isDone(ReviewKey key) {
        // elec-model 没有清单行(本月出账屏记账列 8 行里没有园区电费模型),判该月有没有费项行
        if (key.kind() == ReviewKind.ELEC_MODEL)
            return !elecCostEntries.selectByMonth(key.period()).isEmpty();

        DataHomeOverviewDTO ov = dataHome.overview(key.period());
        return switch (key.kind()) {
            // 出账链五步的 step.key 逐字就是这五个 kind code(DataHomeService.buildChain 里写死的)
            case PARAMS, METERS, ALLOC, ALLOC_LOSS, BILL_NOTICES -> ov.chain().steps().stream()
                .anyMatch(st -> st.key().equals(key.kind().code()) && "done".equals(st.status()));
            case LEDGER -> companiesOf(ov).stream()
                .anyMatch(c -> String.valueOf(c.id()).equals(key.scope()) && c.done());
            case S10 -> phasesOf(ov).stream()
                .anyMatch(p -> String.valueOf(p.no()).equals(key.scope()) && p.done());
            // 附13/附14 两项的 go 都是 utilities,只能按 tag 分 —— DataHomeService.scheduleSources 的既有形状
            case UTILITIES -> itemsOf(ov).stream()
                .anyMatch(it -> "utilities".equals(it.go())
                    && ("office".equals(key.scope()) ? "附13" : "附14").equals(it.tag()) && it.done());
            case SALARY         -> itemDone(ov, "salary");
            case PV             -> itemDone(ov, "pv-income");
            case CHARGING_CAR   -> itemDone(ov, "car-charging");
            case CHARGING_EBIKE -> itemDone(ov, "ebike-charging");
            case ELEC_COST      -> itemDone(ov, "elec-cost");
            case ELEC_MODEL     -> true;   // 上面已提前返回,这里只是让 switch 穷尽
        };
    }

    private boolean itemDone(DataHomeOverviewDTO ov, String go) {
        return itemsOf(ov).stream().anyMatch(it -> go.equals(it.go()) && it.done());
    }

    private static List<DataHomeOverviewDTO.Item> itemsOf(DataHomeOverviewDTO ov) {
        return ov.schedules() == null || ov.schedules().items() == null ? List.of() : ov.schedules().items();
    }

    private static List<DataHomeOverviewDTO.Company> companiesOf(DataHomeOverviewDTO ov) {
        return itemsOf(ov).stream().filter(it -> "ledger".equals(it.go()))
            .map(DataHomeOverviewDTO.Item::companies).filter(java.util.Objects::nonNull)
            .findFirst().orElse(List.of());
    }

    private static List<DataHomeOverviewDTO.Phase> phasesOf(DataHomeOverviewDTO ov) {
        return itemsOf(ov).stream().filter(it -> "sales-income".equals(it.go()))
            .map(DataHomeOverviewDTO.Item::phases).filter(java.util.Objects::nonNull)
            .findFirst().orElse(List.of());
    }

    private ReviewState requireStatus(ReviewKey key, String expect, String action) {
        ReviewState s = states.selectById(key.raw());
        String cur = s == null ? "entered" : s.getStatus();
        if (!expect.equals(cur))
            throw new BizException(ResultCode.CONFLICT,
                key.human() + " 当前是「" + human(cur) + "」,不能" + action);
        return s;
    }

    /**
     * 交审的权限收窄:URL 层(PermissionRegistry)对 `POST /api/review/{key}/submit` 放行的是「任一相关 edit 权」,
     * 因为要哪个权限点取决于 key 里的 kind,URL 判不出来 —— 真正的判定在这里,表在 ReviewKind.perms()。
     * 这一道是**承重的**:只有 entry:edit 的人能交附表的审,交不了 alloc 的审。
     *
     * approve / return / withdraw 三个动作**没有**对应的 service 自守:URL 层挂的就是 review:approve,
     * 每一条路径都过得了那道闸,且没有任何内部调用方 —— 再加一道恒为真的检查只会让人以为有两层保护
     * (同 BookService 里那句「一个永远为真的守卫比没有守卫更糟」)。哪天出现内部调用方,再在这里补。
     */
    private void requireAnyPerm(List<String> anyOf, String message) {
        UserPermissionCache.UserAuth ua = cache.get(me());
        boolean ok = ua != null && anyOf.stream().anyMatch(p -> ua.perms().contains(p));
        if (!ok) throw new BizException(ResultCode.FORBIDDEN, message);
    }

    /**
     * 按列更新,**并且能把列真的置回 NULL**。
     *
     * ⚠ 不能用 updateById:MyBatis-Plus 默认的 updateStrategy 是 NOT_NULL —— setXxx(null) 的字段
     * 压根不会进 UPDATE 语句。于是「重新交审时清掉上一轮的退回理由」这类动作会静默失效,
     * 屏上同时显示「待审核」和上次的退回理由(2026-09-07 ReviewApiIT 抓到的)。
     *
     * @param sets   要写成具体值的列(列名是**下划线**的数据库列名,不是驼峰属性名)
     * @param nulls  要显式置 NULL 的列
     */
    private void setCols(ReviewKey key, Map<String, Object> sets, List<String> nulls) {
        UpdateWrapper<ReviewState> w = new UpdateWrapper<ReviewState>().eq("review_key", key.raw());
        sets.forEach(w::set);
        nulls.forEach(c -> w.set(c, null));
        states.update(null, w);
    }

    private void log(ReviewKey key, String action, String reason) {
        ReviewLog l = new ReviewLog();
        l.setReviewKey(key.raw()); l.setAction(action); l.setActor(me());
        l.setAt(LocalDateTime.now()); l.setReason(reason);
        logs.insert(l);
    }

    private static String human(String status) {
        return switch (status) {
            case "entered"   -> "录入中";
            case "submitted" -> "待审核";
            case "approved"  -> "已审核";
            case "returned"  -> "已退回";
            default          -> status;
        };
    }

    private static String me() {
        var a = SecurityContextHolder.getContext().getAuthentication();
        return a == null || a.getName() == null ? "" : a.getName();
    }
}

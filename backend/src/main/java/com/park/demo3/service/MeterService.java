package com.park.demo3.service;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import com.park.demo3.dto.ImportError;
import com.park.demo3.dto.ImportLogReq;
import com.park.demo3.dto.MeterAssetReq;
import com.park.demo3.dto.MeterAssignReq;
import com.park.demo3.dto.MeterClearManualReq;
import com.park.demo3.dto.MeterDeleteDTO;
import com.park.demo3.dto.MeterImportResultDTO;
import com.park.demo3.dto.MeterDTO;
import com.park.demo3.dto.MeterImportRequest;
import com.park.demo3.dto.MeterReadingDTO;
import com.park.demo3.dto.MeterReadingReq;
import com.park.demo3.dto.MeterReq;
import com.park.demo3.dto.MeterStatusReq;
import com.park.demo3.dto.MeterTimelineDTO;
import com.park.demo3.entity.AllocResult;
import com.park.demo3.entity.AllocRule;
import com.park.demo3.entity.AllocRuleMeter;
import com.park.demo3.entity.BillNotice;
import com.park.demo3.entity.BillNoticeLine;
import com.park.demo3.entity.Meter;
import com.park.demo3.entity.MeterArchiveLog;
import com.park.demo3.entity.MeterAssign;
import com.park.demo3.entity.MeterBookSeen;
import com.park.demo3.entity.MeterReading;
import com.park.demo3.entity.MeterStatus;
import com.park.demo3.entity.Tenant;
import com.park.demo3.mapper.AllocLossResultMapper;
import com.park.demo3.mapper.AllocPoolMeterResultMapper;
import com.park.demo3.mapper.AllocPoolResultMapper;
import com.park.demo3.mapper.AllocResultMapper;
import com.park.demo3.mapper.AllocRuleMapper;
import com.park.demo3.mapper.AllocRuleMeterMapper;
import com.park.demo3.mapper.BillNoticeLineMapper;
import com.park.demo3.mapper.BillNoticeMapper;
import com.park.demo3.mapper.BuildingMapper;
import com.park.demo3.mapper.ContractMapper;
import com.park.demo3.mapper.MeterArchiveLogMapper;
import com.park.demo3.mapper.MeterBookSeenMapper;
import com.park.demo3.mapper.MeterMapper;
import com.park.demo3.mapper.MeterReadingMapper;
import com.park.demo3.mapper.TenantMapper;
import com.park.demo3.security.NoReviewGuard;
import com.park.demo3.security.Perm;
import com.park.demo3.security.PermissionGuard;
import com.park.demo3.security.ReviewGuard;
import com.park.demo3.security.ReviewKind;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeMap;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

// 园区抄表(METER-SPEC)。P-A 刀:表档案+月度读数;分摊/损耗/账单是 P-B/P-C。
// factor_snap 快照口径:读数落库时快照当时表倍率,之后改倍率不回溯历史(同 PvMeterService price_snap)。
// 用量=(curr−prev)×factor_snap 派生绝不落库;漏抄/倒走由前端 meterLogic 派生只标不拦。
@Service
public class MeterService {
    private static final Pattern YM = Pattern.compile("\\d{4}-\\d{2}");
    /** 审核闸送月份用的严格版(月份 01-12),与 ReviewKey 同口径;上面那份是既有的宽正则,不在本期动它。 */
    private static final Pattern REVIEW_YM = Pattern.compile("\\d{4}-(0[1-9]|1[0-2])");
    private final MeterMapper meters;
    private final MeterReadingMapper readings;
    // §H5 批量删除的级联面:四张派生快照表 + 池绑定(FK 守卫)+ 审计日志。
    // 直接注 mapper 而不是依赖 AllocService:要用的 deleteByYm/deleteGenByYm 各 mapper 早就有,
    // 转手一层只多一条服务间依赖(且 AllocService 的删除是 generate 内部步骤,不对外)。
    private final AllocPoolResultMapper poolResults;
    private final AllocPoolMeterResultMapper poolMeterResults;
    private final AllocLossResultMapper lossResults;
    private final AllocResultMapper allocResults;
    private final AllocRuleMeterMapper ruleMeters;
    private final AllocRuleMapper rules;
    private final BillNoticeMapper billNotices;   // S4-2 守卫:该月已出催缴单 → 批量删读数 409
    private final BuildingMapper buildings;       // 只为档案列表带上「所在楼栋的期区」一格
    private final ImportLogService importLogs;
    private final ReviewGuard reviewGuard;
    private final MeterTimelineService timeline;   // 归属/状态按月分段的唯一读写入口(METER-TIMELINE-SPEC)
    private final MeterArchiveLogMapper archive;   // 撤销导入读前像、批级断言数本批写到的月份(SPEC §3.2 §3.5)
    private final ObjectMapper json;
    private final ContractMapper contracts;        // 只为状态影响里报「钉的合同」号(SPEC §3.4)
    private final MeterBookSeenMapper bookSeen;    // 本月册子已核(SPEC §10):导入记、撤销与批删删、列表读
    private final BillNoticeLineMapper noticeLines; // 删表前查 fk_line_meter(RESTRICT):先说清在哪几个月的单里,不撞 FK
    private final TenantMapper tenants;             // 批删被已确认的单挡住时点户名
    private final PermissionGuard perms;            // 批删连带删草稿催缴单 = 出账运行那一档(同 generate)
    private final AuditLogService audit;            // 删表(连带删掉的催缴单)不可逆,要留痕

    public MeterService(MeterMapper meters, MeterReadingMapper readings,
                        AllocPoolResultMapper poolResults, AllocPoolMeterResultMapper poolMeterResults,
                        AllocLossResultMapper lossResults, AllocResultMapper allocResults,
                        AllocRuleMeterMapper ruleMeters, AllocRuleMapper rules,
                        BillNoticeMapper billNotices, ImportLogService importLogs, ReviewGuard reviewGuard,
                        BuildingMapper buildings, MeterTimelineService timeline,
                        MeterArchiveLogMapper archive, ObjectMapper json, ContractMapper contracts,
                        MeterBookSeenMapper bookSeen, BillNoticeLineMapper noticeLines, TenantMapper tenants,
                        PermissionGuard perms, AuditLogService audit) {
        this.noticeLines = noticeLines; this.tenants = tenants; this.perms = perms; this.audit = audit;
        this.reviewGuard = reviewGuard; this.buildings = buildings; this.timeline = timeline;
        this.archive = archive; this.json = json; this.contracts = contracts; this.bookSeen = bookSeen;
        this.meters = meters; this.readings = readings;
        this.poolResults = poolResults; this.poolMeterResults = poolMeterResults;
        this.lossResults = lossResults; this.allocResults = allocResults;
        this.ruleMeters = ruleMeters; this.rules = rules;
        this.billNotices = billNotices; this.importLogs = importLogs;
    }

    private static BigDecimal one(BigDecimal v) { return v == null ? BigDecimal.ONE : v; }
    private static String blankToNull(String s) { return s == null || s.isBlank() ? null : s.trim(); }
    private static boolean validKind(String s) { return "elec".equals(s) || "water".equals(s); }
    private static final java.util.regex.Pattern ZONE_RE = java.util.regex.Pattern.compile(ZoneService.ZONE_REGEX);
    private static boolean validZone(String s) { return s != null && ZONE_RE.matcher(s).matches(); }
    private static boolean validOwnership(String s) {
        return "tenant".equals(s) || "share".equals(s) || "ops".equals(s) || "infra".equals(s)
            || "park".equals(s)        // V68 园区自担
            || "register".equals(s);   // V79 刀H §H2 非计费计度寄存器(反向有功/需量等),不进任何Σ
    }
    // 账期内不在服务中 = 该月的状态段不是「在用」:不在册(早于第一条状态)/ 停用 / 已拆 三种都不计
    // (METER-TIMELINE-SPEC §1.3;取代 V68/V87/V88 三个账期列)。唯一定义点,MeterBindingService/AllocService 统一走它。
    // 不收 ym:m 本身就是站在某个账期取的(MeterTimelineService.metersAt(ym)),拿别的月的 m 来问是编程错误。
    public static boolean outOfService(MeterAt m) {
        return m == null || !"active".equals(m.getStatus());
    }
    // 用量派生:缺任一读数=null(漏抄不硬算)。public:AllocService(P-B)复用同一公式(PB-ALLOCATION-SPEC §5)
    public static BigDecimal usage(BigDecimal prev, BigDecimal curr, BigDecimal factor) {
        return prev == null || curr == null ? null : curr.subtract(prev).multiply(one(factor));
    }

    // ── 表档案(METER-TIMELINE-SPEC §2:站在 ym 看;ym 空 = 各表最新一行)。不在册的表也返回(status=null),屏上自己筛 ──
    public List<MeterDTO> list(String kind, String zone, String ym) {
        String at = blankToNull(ym) == null ? MeterTimeline.LATEST : ym.trim();
        MeterTimelineService.View v = timeline.viewAt(at);
        Map<Integer, Long> counts = readingCounts();
        List<MeterAt> ms = meters.selectFiltered(kind, zone).stream()
            .map(m -> MeterAt.of(m, v.assign(m.getId()), v.status(m.getId()), at)).toList();
        Map<Integer, String> bZone = buildingZones(ms);
        // SPEC §10.3:该月的册子记录一次查全月,每块表留最近一笔(id 升序,后写的压前面的);站在最新看不查
        Map<Integer, MeterBookSeen> seen = MeterTimeline.LATEST.equals(at) ? Map.of()
            : bookSeen.selectList(new QueryWrapper<MeterBookSeen>().eq("ym", at).orderByAsc("id")).stream()
                .collect(Collectors.toMap(MeterBookSeen::getMeterId, x -> x, (a, b) -> b));
        return ms.stream()
            .map(m -> toDTO(m, v, counts.getOrDefault(m.getId(), 0L),
                m.getBuildingId() == null ? null : bZone.get(m.getBuildingId()), seen.get(m.getId()))).toList();
    }

    /**
     * 楼栋id → 期区,给档案列表比「表上期区 vs 所在楼期区」用。
     * 按本次这批表实际挂到的 id 集合收,不走 selectList(null) —— 本仓 QueryHygieneTest 不许
     * service 层新增全表查(口径 API-CONTRACT-SPEC §3)。楼栋表现在只有几十行,但那是今天的事。
     */
    private Map<Integer, String> buildingZones(List<MeterAt> ms) {
        Set<Integer> ids = ms.stream().map(MeterAt::getBuildingId)
            .filter(java.util.Objects::nonNull).collect(Collectors.toSet());
        if (ids.isEmpty()) return Map.of();
        return buildings.selectList(new QueryWrapper<com.park.demo3.entity.Building>()
                .select("id", "zone").in("id", ids)).stream()
            .filter(b -> b.getZone() != null)
            .collect(Collectors.toMap(com.park.demo3.entity.Building::getId,
                com.park.demo3.entity.Building::getZone, (a, b) -> a));
    }

    // 全库 表id → 读数条数,一次分组取回(避免逐表 count N+1)。档案列表与 §H5「删完是否零读数」共用。
    private Map<Integer, Long> readingCounts() {
        return readings.selectMaps(
                new QueryWrapper<MeterReading>().select("meter_id", "count(*) cnt").groupBy("meter_id"))
            .stream().collect(Collectors.toMap(
                m -> ((Number) m.get("meter_id")).intValue(), m -> ((Number) m.get("cnt")).longValue()));
    }

    /** 不带月份的写从这个月起生效(= 一直在册 / 对所有月份),与 V128 灌数给「启用月为空」的表的首月同口径。 */
    static final String FIRST_YM = "1900-01";

    // SPEC §3.4 新增表自 fromYm 起在册:归属行 + active 状态行都写在 fromYm。
    // 新表不在任何催缴单里,冻结只可能来自审核锁 —— 自 fromYm 起到库里最大已生成月,任一月审过/待审 → 423。
    @Transactional
    public MeterDTO create(MeterReq req) {
        String name = req.name().trim();
        if (meters.selectByKey(req.kind(), req.zone(), name) != null)
            throw new BizException(ResultCode.CONFLICT, "同区同类已有同名表");
        String from = blankToNull(req.fromYm()) == null ? FIRST_YM : req.fromYm().trim();
        // 落库之前拒:新表还没有 id,按 0 号表问 frozenMonths —— 没有哪张单的明细含 0 号表,查出来的只有审核锁
        String bad = frozenOf(0, name, MeterTimeline.affectedMonths(from, null, timeline.maxGeneratedYm()));
        if (bad != null) throw new BizException(ResultCode.CONFLICT, "要改的月份里有冻结的,这次没有改:" + bad);
        refuseCodeClash(req.kind(), req.code(), null, List.of(), List.of(statusRow(from, "active")));
        MeterAt x = new MeterAt();
        apply(x, req, name);
        x.setSortNo(meters.maxSortNo() + 1);
        Meter m = new Meter();
        x.assetInto(m);
        meters.insert(m);
        x.setId(m.getId());
        MeterTimelineService.Ctx ctx = MeterTimelineService.Ctx.of("manual");
        timeline.writeAssign(x.toAssign(from), ctx);
        timeline.writeStatus(m.getId(), from, "active", ctx);
        return dtoOf(m.getId(), 0L);
    }

    // PUT /{id}:只写资产列(SPEC §1.1,不分月)。归属 / 位置走 assignByMonth,状态走 writeStatusRow,合同钉走 bind。
    @NoReviewGuard(reason = "只写 meter 的资产列(名称/编码/表类/表类型/倍率/存疑标),这些列没有月份这一维:倍率只影响之后新录的读数(已录读数各带 factor_snap 快照),归属/位置/状态/合同钉一格不碰 —— 它们各走按月写的端点并逐月查冻结")
    @Transactional
    public MeterDTO update(Integer id, MeterAssetReq req) {
        Meter m = meters.selectById(id);
        if (m == null) throw new BizException(ResultCode.NOT_FOUND, "表不存在");
        String name = req.name().trim();
        Meter clash = meters.selectByKey(req.kind(), req.zone(), name);
        if (clash != null && !clash.getId().equals(id))
            throw new BizException(ResultCode.CONFLICT, "同区同类已有同名表");
        // §F4:补齐了编码(由空变非空)= 认领这份档案,清「存疑」;区域/位置/企业名称的那一半在 assignByMonth
        boolean identified = newlyFilled(m.getCode(), req.code());
        // 换了编码(或表类):这块表在册的每个月都按新编码核一遍占用;写之前它不占这个编码,before 为空
        String code = blankToNull(req.code());
        if (code != null && (!code.equals(m.getCode()) || !req.kind().equals(m.getKind())))
            refuseCodeClash(req.kind(), code, id, List.of(), timeline.rows(id).status());
        m.setKind(req.kind()); m.setZone(req.zone()); m.setName(name);
        m.setMeterType(blankToNull(req.meterType())); m.setDeviceType(req.deviceType());
        m.setCode(blankToNull(req.code()));
        m.setFactor(one(req.factor()));   // 改倍率只影响之后新录读数,历史 factor_snap 不回溯
        if (identified) m.setSuspect(null);
        if (req.suspect() != null) m.setSuspect(blankToNull(req.suspect()));   // 显式值优先(三态见 MeterAssetReq)
        meters.updateById(m);
        return dtoOf(id, readings.countByMeter(id));
    }

    // ══ METER-TIMELINE-SPEC §3.3 §3.4:屏上按月改归属与状态 ══
    //   任何写都是「在某月写一行」,受影响区间 = 那一行起到下一行之前(链尾取到库里最大已生成月);
    //   区间里有冻结月(SPEC §4)就整批拒并点名,不降级、不部分写。

    /** PUT /assign 的 patch 收的键:归属与位置。资产列走 PUT /{id},合同钉走 /bind。 */
    private static final java.util.Set<String> PATCH_KEYS = java.util.Set.of("tenantId", "tenantName", "buildingId",
        "ownership", "area", "spot", "floorLabel", "side", "roomNo", "subName");

    @Transactional
    public List<MeterTimelineDTO.Written> assignByMonth(MeterAssignReq req) {
        for (String k : req.patch().keySet())
            if (!PATCH_KEYS.contains(k)) throw new BizException(ResultCode.BAD_REQUEST, "patch 里有不认识的字段:" + k);
        record Plan(Meter meter, List<String> froms, List<MeterAssign> writes, boolean claim) {}
        String maxGen = timeline.maxGeneratedYm();
        List<Plan> plans = new ArrayList<>();
        List<String> frozen = new ArrayList<>();
        String from = null;   // SPEC §3.3:同房间的表与主表(meterIds 第一块)用同一个起始月一起写,不各按自己的段
        for (Integer id : new java.util.LinkedHashSet<>(req.meterIds())) {
            Meter m = requireMeter(id);
            List<MeterAssign> rows = timeline.rows(id).assign();
            List<String> froms = fromsOf(rows, MeterAssign::getFromYm);
            if (from == null) from = targetFrom(rows, req.ym(), req.mode());
            MeterAssign before = rowAt(rows, id, from);
            MeterAssign after = patched(before, req.patch());
            // SPEC §3.6:换租写新行时不继承合同钉(钉的是上一户的合同)
            if (!froms.contains(from) && tenantChanged(before, after)) after.setContractId(null);
            List<MeterAssign[]> pairs = new ArrayList<>();
            pairs.add(new MeterAssign[]{before, after});
            if (req.alsoMigrateCopies())
                for (MeterAssign c : migrateCopies(rows, from, before)) pairs.add(new MeterAssign[]{c, patched(c, req.patch())});
            List<MeterAssign> writes = pairs.stream().filter(p -> !sameRow(p[0], p[1])).map(p -> p[1]).toList();
            java.util.Set<String> months = new java.util.TreeSet<>();
            for (MeterAssign w : writes) months.addAll(span(froms, w.getFromYm(), maxGen));
            String bad = frozenOf(m.getId(), label(m), months);
            if (bad != null) frozen.add(bad);
            // §F4:区域 / 位置 / 企业名称由空变非空 = 认领这份档案,清「存疑」(编码那一半在 update)
            boolean claim = newlyFilled(before.getArea(), after.getArea()) || newlyFilled(before.getSpot(), after.getSpot())
                || newlyFilled(before.getTenantName(), after.getTenantName());
            plans.add(new Plan(m, froms, writes, claim));
        }
        if (!frozen.isEmpty())
            throw new BizException(ResultCode.CONFLICT, "要改的月份里有冻结的,这次一块表都没有改:" + cap(frozen));
        MeterTimelineService.Ctx ctx = MeterTimelineService.Ctx.of("manual");
        List<MeterTimelineDTO.Written> out = new ArrayList<>();
        for (Plan p : plans) {
            for (MeterAssign w : p.writes()) {
                timeline.writeAssign(w, ctx);
                out.add(new MeterTimelineDTO.Written(p.meter().getId(), w.getFromYm(),
                    lastMonth(MeterTimeline.until(p.froms(), w.getFromYm()))));
            }
            if (p.claim() && p.meter().getSuspect() != null) {
                p.meter().setSuspect(null);
                meters.updateById(p.meter());
            }
        }
        return out;
    }

    // SPEC §3.3「改回按册子」:清掉 ym 所在那一段的三组人工标记;位置三列回到按位置原文解析的值
    // (册子上只有位置原文,楼层 / 方位 / 房号本来就是从它解析的)。租户与归属的值不动,下次导入照册子写。
    @Transactional
    public void clearManual(MeterClearManualReq req) {
        Meter m = requireMeter(req.meterId());
        List<MeterAssign> rows = timeline.rows(m.getId()).assign();
        MeterAssign cur = MeterTimeline.assignAt(rows, req.ym());
        if (cur == null) throw new BizException(ResultCode.NOT_FOUND, "这块表还没有归属行");
        int mask = cur.getLocManual() == null ? 0 : cur.getLocManual();
        if (mask == 0 && !Objects.equals(cur.getTenantManual(), 1) && !Objects.equals(cur.getOwnerManual(), 1)) return;
        refuseFrozen(m, span(fromsOf(rows, MeterAssign::getFromYm), cur.getFromYm(), timeline.maxGeneratedYm()));
        MeterAssign x = copy(cur);
        MeterAt auto = autoOf(x.getSpot());
        if ((mask & LOC_FLOOR) != 0) x.setFloorLabel(auto.getFloorLabel());
        if ((mask & LOC_SIDE) != 0) x.setSide(auto.getSide());
        if ((mask & LOC_ROOM) != 0) x.setRoomNo(auto.getRoomNo());
        x.setTenantManual(0); x.setOwnerManual(0); x.setLocManual(0);
        timeline.writeAssign(x, MeterTimelineService.Ctx.of("manual"));
    }

    // 抽屉「档案变更」与改归属对话框的取数(PLAN §1 GET /{id}/timeline)
    public MeterTimelineDTO timelineOf(Integer id, String ym) {
        requireMeter(id);
        MeterTimelineService.Rows rs = timeline.rows(id);
        String maxGen = timeline.maxGeneratedYm();
        List<String> froms = fromsOf(rs.assign(), MeterAssign::getFromYm);
        MeterAssign f = MeterTimeline.pick(rs.assign(), MeterAssign::getFromYm, ym);   // 更正的目标行;早于第一行 = 没有
        MeterTimelineDTO.Impact impact = new MeterTimelineDTO.Impact(
            f == null ? null : spanOf(id, froms, f.getFromYm(), maxGen),
            spanOf(id, froms, ym, maxGen),
            f == null ? 0 : migrateCopies(rs.assign(), f.getFromYm(), f).size());
        // 同房间 = 站在 ym 看同楼栋、同房号,且在册未拆(SPEC §3.3)
        MeterAssign a = MeterTimeline.assignAt(rs.assign(), ym);
        List<MeterTimelineDTO.Sibling> siblings = a == null || a.getBuildingId() == null || blankToNull(a.getRoomNo()) == null
            ? List.of()
            : timeline.metersAt(ym).stream()
                .filter(x -> !x.getId().equals(id) && a.getBuildingId().equals(x.getBuildingId())
                    && MeterTimeline.canon(a.getRoomNo()).equals(MeterTimeline.canon(x.getRoomNo()))
                    && x.getStatus() != null && !"removed".equals(x.getStatus()))
                .map(x -> new MeterTimelineDTO.Sibling(x.getId(), x.getName(), x.getKind(), x.getTenantName())).toList();
        List<MeterArchiveLog> log = archive.selectList(new QueryWrapper<MeterArchiveLog>().eq("meter_id", id).orderByDesc("id"));
        return new MeterTimelineDTO(rs.assign(), rs.status(), log, impact, siblings);
    }

    // SPEC §3.4 状态列表「自 M 起:在用 / 停用 / 已拆」加一行或改一行;replaceFromYm = 把那一行挪到 fromYm(改月)
    @Transactional
    public void writeStatusRow(Integer id, MeterStatusReq req) {
        Meter m = requireMeter(id);
        List<MeterStatus> rows = timeline.rows(id).status();
        List<String> froms = fromsOf(rows, MeterStatus::getFromYm);
        String maxGen = timeline.maxGeneratedYm();
        java.util.Set<String> months = new java.util.TreeSet<>(span(froms, req.fromYm(), maxGen));
        String old = blankToNull(req.replaceFromYm());
        if (old != null) {
            if (!froms.contains(old)) throw new BizException(ResultCode.NOT_FOUND, "这块表没有自 " + old + " 起的状态行");
            // 挪月只在前后两行之间挪:越过相邻行 = 两行对调、中间各月翻成别的状态,确认框按「只挪这一行」数出的月份和读数就不对了
            int i = froms.indexOf(old);
            String prev = i > 0 ? froms.get(i - 1) : null, next = i + 1 < froms.size() ? froms.get(i + 1) : null;
            if (!old.equals(req.fromYm()) && ((prev != null && req.fromYm().compareTo(prev) <= 0)
                    || (next != null && req.fromYm().compareTo(next) >= 0)))
                throw new BizException(ResultCode.CONFLICT, "自 " + old + " 起的这一行只能挪到"
                    + (prev == null ? "" : " " + prev + " 之后") + (prev != null && next != null ? "、" : "")
                    + (next == null ? "" : " " + next + " 之前") + ";要越过相邻的那一行,请先撤回或改那一行");
            months.addAll(span(froms, old, maxGen));
        }
        refuseFrozen(m, months);
        List<MeterStatus> after = new ArrayList<>(rows);
        if (old != null) after.removeIf(s -> old.equals(s.getFromYm()));
        upsert(after, statusRow(req.fromYm(), req.status()), MeterStatus::getFromYm);
        refuseCodeClash(m.getKind(), m.getCode(), id, rows, after);
        MeterTimelineService.Ctx ctx = MeterTimelineService.Ctx.of("manual");
        if (old != null && !old.equals(req.fromYm())) timeline.deleteStatus(id, old, ctx);
        timeline.writeStatus(id, req.fromYm(), req.status(), ctx);
    }

    // SPEC §3.4 删一行 = 撤回误标;第一行不能删(删了这块表在那段月份就不在册了),只能改月
    @Transactional
    public void dropStatusRow(Integer id, String fromYm) {
        Meter m = requireMeter(id);
        List<MeterStatus> rows = timeline.rows(id).status();
        List<String> froms = fromsOf(rows, MeterStatus::getFromYm);
        if (!froms.contains(fromYm)) throw new BizException(ResultCode.NOT_FOUND, "这块表没有自 " + fromYm + " 起的状态行");
        if (froms.get(0).equals(fromYm))
            throw new BizException(ResultCode.CONFLICT, "自 " + fromYm + " 起的这一行是这块表的第一行状态,不能删;要改在册的起始月,请改这一行的月份");
        refuseFrozen(m, span(froms, fromYm, timeline.maxGeneratedYm()));
        List<MeterStatus> after = new ArrayList<>(rows);
        after.removeIf(s -> fromYm.equals(s.getFromYm()));   // 删掉一行已拆 = 后面的月份接着在册
        refuseCodeClash(m.getKind(), m.getCode(), id, rows, after);
        timeline.deleteStatus(id, fromYm, MeterTimelineService.Ctx.of("manual"));
    }

    // SPEC §3.4 写停用 / 拆除之前给确认框的数:区间、冻结月、区间里的非零用量月(之后不再计费)、所在公摊池、钉的合同
    public MeterTimelineDTO.StatusImpact statusImpact(Integer id, String fromYm, String status) {
        requireMeter(id);
        MeterTimelineService.Rows rs = timeline.rows(id);
        String next = MeterTimeline.until(fromsOf(rs.status(), MeterStatus::getFromYm), fromYm);
        List<String> months = MeterTimeline.affectedMonths(fromYm, next, timeline.maxGeneratedYm());
        java.util.Set<String> in = new java.util.HashSet<>(months);
        List<MeterTimelineDTO.Usage> used = "active".equals(status) ? List.of() : readings.selectByMeter(id).stream()
            .filter(r -> in.contains(r.getYm()))
            .map(r -> new MeterTimelineDTO.Usage(r.getYm(), usage(r.getPrevTotal(), r.getCurrTotal(), r.getFactorSnap())))
            .filter(u -> u.usage() != null && u.usage().signum() != 0).toList();
        List<Integer> ruleIds = ruleMeters.selectList(new QueryWrapper<AllocRuleMeter>().eq("meter_id", id))
            .stream().map(AllocRuleMeter::getRuleId).distinct().toList();
        List<MeterTimelineDTO.Pool> pools = ruleIds.isEmpty() ? List.of() : rules.selectBatchIds(ruleIds).stream()
            .map(r -> new MeterTimelineDTO.Pool(r.getId(), r.getName())).toList();
        MeterAssign a = MeterTimeline.assignAt(rs.assign(), fromYm);
        com.park.demo3.entity.Contract c = a == null || a.getContractId() == null ? null : contracts.selectById(a.getContractId());
        return new MeterTimelineDTO.StatusImpact(fromYm, lastMonth(next),
            locked(timeline.frozenMonths(id, months)), used, pools, c == null ? null : c.getContractNo());
    }

    private Meter requireMeter(Integer id) {
        Meter m = meters.selectById(id);
        if (m == null) throw new BizException(ResultCode.NOT_FOUND, "表不存在");
        return m;
    }

    /**
     * SPEC §4 冻结闸(PLAN §2.1:先审核闸、再冻结)。months 里审核锁定的月 → 423(与全站同一句);
     * 其余冻结(含这块表的催缴单已确认 / 已导出)→ 回一句点名,由调用方拒。
     *
     * ponytail: 交给 reviewGuard 的是 frozenMonths 查出来的那几个月,不是整段区间 —— frozenMonths 判审核锁读的是
     *   同一张 review_state(METERS、scope 为空、submitted / approved),一条查询查完;整段交给 reviewGuard 是逐月一次
     *   selectById,自 1900-01 起生效的行链尾到最大已生成月是两千多次。两者锁住的月份集合相同。
     */
    private String frozenOf(int meterId, String who, java.util.Collection<String> months) {
        List<MeterTimelineService.Frozen> f = timeline.frozenMonths(meterId, months);
        reviewGuard.assertEditable(ReviewKind.METERS, f.stream().map(MeterTimelineService.Frozen::ym).toList(), null);
        return f.isEmpty() ? null : who + ":" + frozenText(f);
    }

    private void refuseFrozen(Meter m, java.util.Collection<String> months) {
        String bad = frozenOf(m.getId(), label(m), months);
        if (bad != null) throw new BizException(ResultCode.CONFLICT, "要改的月份里有冻结的,这次没有改:" + bad);
    }

    // ══ 同一个编码,两块表不许同一个月都在册(用户 2026-09-25 拍板) ══
    //   一块物理表拆下来装到别处,档案里是两条表记录共用编码、在册区间首尾相接(220605000144:二期二车间
    //   102 室 2023-08 ~ 2024-02,2024-03 起一期 A座 428 室)。在册 = 该月状态段 active / retired;removed 与尚未在册不算。
    //   导入按编码认表时按这一行的月份挑在册的那块(Index.pickByCode);各写入口都过 codeClash,不让两段叠上。

    /** 同 kind + 编码的另一块表:id + 名称 + 状态链(升序)。 */
    private record Rival(int id, String name, List<MeterStatus> status) {}

    /**
     * 编码归一:全半角、大小写、首尾空白不算不同(meter.code 的排序规则 utf8mb4_0900_ai_ci 也这么比,库里查同码按它)。
     * ponytail: 重音(É = E)这里不归,库会归;表号里没有带重音的。导入新建表那条路查库兜住,真遇上再换 NFKD 去 \p{M}。
     */
    static String codeNorm(String c) {
        return c == null ? null : java.text.Normalizer.normalize(c, java.text.Normalizer.Form.NFKC).trim().toUpperCase(java.util.Locale.ROOT);
    }

    static boolean onBook(List<MeterStatus> rows, String ym) {
        MeterStatus s = MeterTimeline.statusAt(rows, ym);
        return s != null && !"removed".equals(s.getStatus());
    }

    /** 在册区间的人话:「2023-08 ~ 2024-02 在册」「2024-03 起在册」,多段用「、」连。 */
    static String onBookText(List<MeterStatus> rows) {
        List<String> out = new ArrayList<>();
        String start = null;
        for (MeterStatus s : rows) {
            boolean on = !"removed".equals(s.getStatus());
            if (on && start == null) start = s.getFromYm();
            if (!on && start != null) {
                String end = lastMonth(s.getFromYm());
                out.add((FIRST_YM.equals(start) ? end + " 及以前" : start + " ~ " + end) + " 在册");
                start = null;
            }
        }
        if (start != null) out.add(FIRST_YM.equals(start) ? "一直在册" : start + " 起在册");
        return out.isEmpty() ? "没有在册的月份" : String.join("、", out);
    }

    /**
     * 写完后(after)这块表与 other 同时在册、而写之前(before)这块表那个月还不在册的第一个月;没有 → null。
     * 只拦新叠上的月份:已经叠着的旧档案标拆除 / 停用、把起始月挪开照放(那正是在去重)。
     * 三条链在相邻两个起始月之间都不变,逐个起始月看一遍就够。
     */
    static String newOverlap(List<MeterStatus> before, List<MeterStatus> after, List<MeterStatus> other) {
        java.util.TreeSet<String> edges = new java.util.TreeSet<>();
        for (List<MeterStatus> l : List.of(before, after, other)) l.forEach(s -> edges.add(s.getFromYm()));
        for (String ym : edges)
            if (onBook(after, ym) && !onBook(before, ym) && onBook(other, ym)) return ym;
        return null;
    }

    /** 编码占用的唯一判定,各写入口共用:冲突 →「编码 X 在 YYYY-MM 已有「表名」在册」(最早叠上的那个月),没有 → null。 */
    private static String codeClash(String code, List<MeterStatus> before, List<MeterStatus> after, List<Rival> rivals) {
        String hit = null, who = null;
        for (Rival r : rivals) {
            String ym = newOverlap(before, after, r.status());
            if (ym != null && (hit == null || ym.compareTo(hit) < 0)) { hit = ym; who = r.name(); }
        }
        return hit == null ? null : "编码 " + code.trim() + " 在 " + hit + " 已有「" + who + "」在册";
    }

    /** 库里同 kind + 编码的其它表;编码空 = 没有。 */
    private List<Rival> rivals(String kind, String code, Integer selfId) {
        String c = blankToNull(code);
        if (c == null) return List.of();
        return meters.selectList(new QueryWrapper<Meter>().eq("kind", kind).eq("code", c).ne(selfId != null, "id", selfId))
            .stream().map(o -> new Rival(o.getId(), o.getName(), timeline.rows(o.getId()).status())).toList();
    }

    private void refuseCodeClash(String kind, String code, Integer selfId, List<MeterStatus> before, List<MeterStatus> after) {
        String bad = codeClash(code, before, after, rivals(kind, code, selfId));
        if (bad != null) throw new BizException(ResultCode.CONFLICT, bad);
    }

    /**
     * 一批表的状态链一起改(撤销导入、批删本期)时逐块过 codeClash:before / after 同键,只放状态链会变的表;
     * 同码的另一块表也在这批里的,拿它改后的链比。冲突 →「表名(id N):编码 X 在 YYYY-MM 已有「表名」在册」。
     */
    private List<String> codeClashes(Map<Integer, Meter> who, Map<Integer, List<MeterStatus>> before,
                                     Map<Integer, List<MeterStatus>> after) {
        List<String> out = new ArrayList<>();
        before.forEach((id, was) -> {
            Meter m = who.get(id);
            if (m == null) return;   // 撤销时日志里的表可能已经删了
            List<Rival> rs = rivals(m.getKind(), m.getCode(), id).stream()
                .map(r -> after.containsKey(r.id()) ? new Rival(r.id(), r.name(), after.get(r.id())) : r).toList();
            String bad = codeClash(m.getCode(), was, after.get(id), rs);
            if (bad != null) out.add(label(m) + ":" + bad);
        });
        return out;
    }

    /** rows 按 plan(起始月 → 状态)写完的样子,不落库:codeClash 的 after。 */
    private static List<MeterStatus> planned(List<MeterStatus> rows, Map<String, String> plan) {
        List<MeterStatus> out = new ArrayList<>(rows);
        plan.forEach((f, s) -> upsert(out, statusRow(f, s), MeterStatus::getFromYm));
        return out;
    }

    private static MeterStatus statusRow(String fromYm, String status) {
        MeterStatus s = new MeterStatus();
        s.setFromYm(fromYm); s.setStatus(status);
        return s;
    }

    private MeterTimelineDTO.Span spanOf(int id, List<String> froms, String from, String maxGen) {
        String next = MeterTimeline.until(froms, from);
        return new MeterTimelineDTO.Span(from, lastMonth(next),
            locked(timeline.frozenMonths(id, MeterTimeline.affectedMonths(from, next, maxGen))));
    }

    private static List<MeterTimelineDTO.Locked> locked(List<MeterTimelineService.Frozen> f) {
        return f.stream().map(x -> new MeterTimelineDTO.Locked(x.ym(), x.reason())).toList();
    }

    /** 写到哪一行:mode=correct 且 ym 落在某一段里 → 那一段的起始月 F;否则(from / 早于第一行 / 还没有行)→ ym。 */
    static String targetFrom(List<MeterAssign> rows, String ym, String mode) {
        MeterAssign f = MeterTimeline.pick(rows, MeterAssign::getFromYm, ym);
        return "correct".equals(mode) && f != null ? f.getFromYm() : ym;
    }

    /** from 那一行改前的样子:有这一行 → 它的副本;没有 → 照 from 那个月看到的一段复制一行;链是空的 → 空行。 */
    static MeterAssign rowAt(List<MeterAssign> rows, int meterId, String from) {
        MeterAssign base = MeterTimeline.assignAt(rows, from);
        MeterAssign r = base == null ? new MeterAssign() : copy(base);
        if (base == null || !from.equals(base.getFromYm())) { r.setId(null); r.setMeterId(meterId); r.setFromYm(from); }
        return r;
    }

    /** from 之后紧挨着的、上线时复制的同一份档案(src=migrate 且与改前没有差别);遇到第一行不是就停(R4)。 */
    static List<MeterAssign> migrateCopies(List<MeterAssign> rows, String from, MeterAssign before) {
        List<MeterAssign> out = new ArrayList<>();
        for (MeterAssign r : rows) {
            if (r.getFromYm().compareTo(from) <= 0) continue;
            if (!MeterTimelineService.SRC_MIGRATE.equals(r.getSrc()) || !MeterTimeline.diff(before, r).isEmpty()) break;
            out.add(r);
        }
        return out;
    }

    // patch 叠到 base 的副本上,改到的组置人工标记(SPEC §3.3):
    //   租户组(tenantId / tenantName)变了 → tenant_manual=1;归属组(ownership / buildingId)变了 → owner_manual=1;
    //   位置三列逐列(V78 位掩码,口径同建表的 locManualMask):给了值且与「按位置原文解析」不同 → 该位 1,相同 → 0;
    //   没给、该位为 0、而位置原文改了 → 跟着新原文重解析(同导入 applyDesc)。
    static MeterAssign patched(MeterAssign base, Map<String, Object> patch) {
        MeterAssign r = copy(base);
        patch.forEach((k, v) -> {
            switch (k) {
                case "tenantId" -> r.setTenantId(intOf(k, v));
                case "buildingId" -> r.setBuildingId(intOf(k, v));
                case "tenantName" -> r.setTenantName(textOf(k, v));
                case "ownership" -> {
                    String o = textOf(k, v);
                    if (!validOwnership(o)) throw new BizException(ResultCode.BAD_REQUEST, "归属非法(tenant|share|ops|infra|park|register)");
                    r.setOwnership(o);
                }
                case "area" -> r.setArea(textOf(k, v));
                case "spot" -> r.setSpot(textOf(k, v));
                case "subName" -> r.setSubName(textOf(k, v));
                case "floorLabel" -> r.setFloorLabel(textOf(k, v));
                case "side" -> r.setSide(textOf(k, v));
                case "roomNo" -> r.setRoomNo(textOf(k, v));
                default -> throw new BizException(ResultCode.BAD_REQUEST, "patch 里有不认识的字段:" + k);
            }
        });
        MeterAt auto = autoOf(r.getSpot());
        boolean moved = patch.containsKey("spot");
        int mask = r.getLocManual() == null ? 0 : r.getLocManual();
        if (patch.containsKey("floorLabel")) mask = Objects.equals(auto.getFloorLabel(), r.getFloorLabel()) ? mask & ~LOC_FLOOR : mask | LOC_FLOOR;
        else if (moved && (mask & LOC_FLOOR) == 0) r.setFloorLabel(auto.getFloorLabel());
        if (patch.containsKey("side")) mask = Objects.equals(auto.getSide(), r.getSide()) ? mask & ~LOC_SIDE : mask | LOC_SIDE;
        else if (moved && (mask & LOC_SIDE) == 0) r.setSide(auto.getSide());
        if (patch.containsKey("roomNo")) mask = Objects.equals(auto.getRoomNo(), r.getRoomNo()) ? mask & ~LOC_ROOM : mask | LOC_ROOM;
        else if (moved && (mask & LOC_ROOM) == 0) r.setRoomNo(auto.getRoomNo());
        r.setLocManual(mask);
        if (tenantChanged(base, r)) r.setTenantManual(1);
        if (!Objects.equals(base.getOwnership(), r.getOwnership()) || !Objects.equals(base.getBuildingId(), r.getBuildingId()))
            r.setOwnerManual(1);
        return r;
    }

    private static boolean tenantChanged(MeterAssign a, MeterAssign b) {
        return !Objects.equals(a.getTenantId(), b.getTenantId())
            || !MeterTimeline.canon(a.getTenantName()).equals(MeterTimeline.canon(b.getTenantName()));
    }

    // 值一格不差(行 id、来源、批次号除外)= 这一行不用写
    private static boolean sameRow(MeterAssign a, MeterAssign b) {
        MeterAssign x = copy(b);
        x.setId(a.getId()); x.setSrc(a.getSrc()); x.setBatchId(a.getBatchId());
        return x.equals(a);
    }

    static MeterAssign copy(MeterAssign a) {
        MeterAssign x = new MeterAssign();
        org.springframework.beans.BeanUtils.copyProperties(a, x);
        return x;
    }

    private static Integer intOf(String k, Object v) {
        if (v == null || v instanceof Integer) return (Integer) v;
        throw new BizException(ResultCode.BAD_REQUEST, "patch." + k + " 应为整数或 null");
    }

    private static String textOf(String k, Object v) {
        if (v == null || v instanceof String) return blankToNull((String) v);
        throw new BizException(ResultCode.BAD_REQUEST, "patch." + k + " 应为文本或 null");
    }

    // 用户 2026-09-24「为什么删除南盛物流要去计费参数重新生成」:表只挂在草稿/已作废的催缴单里时,
    // 确认框列出这几张单,勾了 dropDraftNotices 就连单一起删(整张单 —— 只删那几行,单的合计就和明细对不上了),
    // 那几个月记一笔档案改动 → 屏上亮「需重算」。已确认/已导出的单仍然拦住,先作废。
    @NoReviewGuard(reason = "表档案不带期间;有读数的表本来就删不掉(既有 409),删得掉的表没有任何月的行;"
        + "连带删草稿催缴单那条分支另守 BILL_NOTICES 月锁(guardOpenNotices)")
    @Transactional
    public void delete(Integer id, boolean dropDraftNotices) {
        Meter meter = meters.selectById(id);
        if (meter == null) throw new BizException(ResultCode.NOT_FOUND, "表不存在");
        if (readings.countByMeter(id) > 0)
            throw new BizException(ResultCode.CONFLICT, "该表已有读数记录,不可删除(历史账要保留);不再用了请在「档案变更」的「在册状态」里加一行已拆或停用,之前的月份不受影响");
        // 池绑定守卫:不先查直接 deleteById 会撞 fk_arm_meter,穿出来是句"违反完整性约束"——
        // 用户对着零读数的表和"有读数不可删"的按钮文案,只能误读成"一直显示有读数"(实测 1139)。
        List<String> pools = poolNames(id);
        if (!pools.isEmpty())
            throw new BizException(ResultCode.CONFLICT,
                "该表还绑定在公摊池「" + String.join("、", pools) + "」上,不可删除;请先到公共电核算把它从池成员中解绑再删");
        // 催缴单明细守卫:bill_notice_line.meter_id 是 RESTRICT FK(fk_line_meter)。读数删光了、单还在的表
        // (实测表 243:2023-08 草稿 5 行、2024-02 草稿 2 行)不先查就撞 FK,穿出来又是那句「违反完整性约束」。
        // 锁定读:并发提交的确认读得到。走到这里读数已是 0,generate 缺读数不出行,不会有新单再挂上它。
        List<MeterDeleteDTO.Notice> billed = billedNotices(id, true);
        List<MeterDeleteDTO.Notice> locked = billed.stream().filter(n -> !OPEN_NOTICE.contains(n.status())).toList();
        // 勾选项原文与确认框(MeterDeleteDialog)逐字一致:这句 409 就是叫人去勾它
        String kinds = billed.stream().anyMatch(n -> "void".equals(n.status())) ? "草稿/已作废" : "草稿";
        java.util.Set<String> months = billed.stream().map(MeterDeleteDTO.Notice::ym)
            .collect(Collectors.toCollection(java.util.TreeSet::new));
        guardOpenNotices(billed.stream().map(MeterDeleteDTO.Notice::status).toList(), months, dropDraftNotices,
            "这块表在已确认/已导出/已签发的催缴单里:" + noticeList(locked) + "。先到催缴单屏作废这些单,再回来删这块表",
            "这块表还在 " + billed.size() + " 张" + kinds + "催缴单里:" + noticeList(billed)
                + "。在删除确认框里勾选「同时删掉这 " + billed.size() + " 张" + kinds + "催缴单」再删,那几个月会显示需重算");
        if (!billed.isEmpty()) dropNotices(billed.stream().map(MeterDeleteDTO.Notice::noticeId).toList());
        // 零读数、挂了户没挂合同 / 绑定过期的表:generate 只给那户的单出一条指着它的告警,不出明细行。
        // 这种单不删(告警留到重算),但那几个月的单也是删表前出的
        months.addAll(warnedMonths(id));
        // 单删了 / 告警指着的表没了、那几个月的快照没变 = 需重算;记成档案改动(屏上说「改过抄表」)
        timeline.recordChange(months, MeterTimelineService.SOURCE_ARCHIVE);
        // meter_assign / meter_status 随表 CASCADE,不经 timeline,meter_archive_log 不落 —— 操作日志只有这一条
        audit.log("meter.delete", label(meter), billed.isEmpty() ? "删表" : "删表;连带删催缴单:" + noticeList(billed));
        meters.deleteById(id);
    }

    // generate 给「挂了户没挂合同 / 绑定过期」的表出的告警(payload = 表 id)在哪几个月的单上。id 是整数,拼 inSql 无注入面
    private List<String> warnedMonths(Integer meterId) {
        return billNotices.selectObjs(new QueryWrapper<BillNotice>().select("DISTINCT ym")
                .inSql("id", "SELECT notice_id FROM bill_notice_warn WHERE code IN ('" + WarnCode.W_METER_NO_CONTRACT.name()
                    + "','" + WarnCode.W_METER_BIND_STALE.name() + "') AND payload = '" + meterId + "'"))
            .stream().map(String::valueOf).toList();
    }

    /** GET /{id}/delete-impact:删这块表会被什么挡住(口径同 delete 的三道闸),给确认框列单用。只读。 */
    public MeterDeleteDTO.Impact deleteImpact(Integer id) {
        if (meters.selectById(id) == null) throw new BizException(ResultCode.NOT_FOUND, "表不存在");
        List<MeterDeleteDTO.Notice> ns = billedNotices(id, false);
        int open = (int) ns.stream().filter(n -> OPEN_NOTICE.contains(n.status())).count();
        return new MeterDeleteDTO.Impact(Math.toIntExact(readings.countByMeter(id)), poolNames(id), ns, open, ns.size() - open);
    }

    private List<String> poolNames(Integer meterId) {
        List<Integer> ruleIds = ruleMeters.selectList(new QueryWrapper<AllocRuleMeter>().eq("meter_id", meterId))
            .stream().map(AllocRuleMeter::getRuleId).distinct().toList();
        return ruleIds.isEmpty() ? List.of() : rules.selectBatchIds(ruleIds).stream().map(AllocRule::getName).toList();
    }

    /** 重新生成会删掉重出的两种单;其余(已确认 / 已导出 / 历史签发)锁着,要先作废。 */
    private static final List<String> OPEN_NOTICE = List.of("draft", "void");
    private static final Map<String, String> NOTICE_STATUS = Map.of("draft", "草稿", "void", "已作废",
        "confirmed", "已确认", "exported", "已导出", "issued", "已签发");

    // 明细里有这块表的催缴单,按月、单号升序;lines = 这张单里它占几行。forUpdate = 锁住这几张单再读状态。
    private List<MeterDeleteDTO.Notice> billedNotices(Integer meterId, boolean forUpdate) {
        Map<Integer, Long> lines = noticeLines.selectList(new QueryWrapper<BillNoticeLine>()
                .select("notice_id").eq("meter_id", meterId)).stream()
            .collect(Collectors.groupingBy(BillNoticeLine::getNoticeId, Collectors.counting()));
        if (lines.isEmpty()) return List.of();
        QueryWrapper<BillNotice> q = new QueryWrapper<BillNotice>().select("id", "ym", "tenant_id", "status")
            .in("id", lines.keySet()).orderByAsc("ym", "id");
        if (forUpdate) q.last("FOR UPDATE");
        List<BillNotice> ns = billNotices.selectList(q);
        // ⚠ 空集守卫:锁定读看到的是最新版,明细快照里的单可能已被并发重出删掉;MP 的 in(空集) 是 SQL 语法错
        Map<Integer, String> names = ns.isEmpty() ? Map.of()
            : tenants.selectBatchIds(ns.stream().map(BillNotice::getTenantId).distinct().toList())
                .stream().collect(Collectors.toMap(Tenant::getId, Tenant::getCompanyName));
        return ns.stream().map(n -> new MeterDeleteDTO.Notice(n.getId(), n.getYm(), names.get(n.getTenantId()),
            n.getStatus(), lines.get(n.getId()))).toList();
    }

    // 「2081-05 南盛物流(草稿 2 行)」,前 6 张
    private static String noticeList(List<MeterDeleteDTO.Notice> ns) {
        return ns.stream().limit(6).map(n -> n.ym() + " " + n.tenantName() + "(" + NOTICE_STATUS.getOrDefault(n.status(), n.status())
                + " " + n.lines() + " 行)").collect(Collectors.joining("、"))
            + (ns.size() > 6 ? " 等 " + ns.size() + " 张" : "");
    }

    /**
     * 删草稿/已作废催缴单之前的同一道闸(批删整月的单、删表时明细里有它的那几张共用)。statuses 须是锁定读
     * (FOR UPDATE)读到的:并发提交的确认读得到。有已确认/已导出(含历史签发)→ 409 locked;只有草稿/已作废而
     * 没勾 → 409 ask;勾了 → 催缴单这几个月的审核锁 423 + 出账运行权限(与 generate 先删 draft/void 再重出同一道闸)。
     * 只判不写:真正的删(dropNotices)由调用方在自己其余的检查之后做。
     */
    private void guardOpenNotices(List<String> statuses, java.util.Collection<String> months, boolean drop,
                                  String locked, String ask) {
        if (!OPEN_NOTICE.containsAll(statuses)) throw new BizException(ResultCode.CONFLICT, locked);
        if (statuses.isEmpty()) return;
        if (!drop) throw new BizException(ResultCode.CONFLICT, ask);
        reviewGuard.assertEditable(ReviewKind.BILL_NOTICES, months, null);
        perms.require(Perm.BILLING_RUN_EDIT, "催缴单");
    }

    // 明细行与告警随单 FK CASCADE 连删(V89 fk_line_notice、V126 fk_warn_notice)
    private void dropNotices(List<Integer> ids) {
        if (!ids.isEmpty()) billNotices.delete(new QueryWrapper<BillNotice>().in("id", ids));
    }

    // ── 读数 ──
    public List<Integer> years() { return readings.selectDistinctYears(); }
    // 有读数的账期升序,空表=[](前端默认月直接取 max,不再 12→1 逐月试探)
    public List<String> months() { return readings.selectDistinctYms(); }

    public List<MeterReadingDTO> readingsByYm(String ym) {
        requireYm(ym);
        return readings.selectByYm(ym).stream().map(MeterService::toReadingDTO).toList();
    }

    public List<MeterReadingDTO> readingsByMeter(Integer meterId) {
        if (meters.selectById(meterId) == null) throw new BizException(ResultCode.NOT_FOUND, "表不存在");
        return readings.selectByMeter(meterId).stream().map(MeterService::toReadingDTO).toList();
    }

    @Transactional
    public MeterReadingDTO createReading(MeterReadingReq req) {
        reviewGuard.assertEditable(ReviewKind.METERS, req.ym(), null);
        Meter m = meters.selectById(req.meterId());
        if (m == null) throw new BizException(ResultCode.CONFLICT, "表不存在");
        if (readings.selectByMeterAndYm(m.getId(), req.ym()) != null)
            throw new BizException(ResultCode.CONFLICT, "该表该月已有读数");
        healBeforeFirst(m, req);
        MeterReading r = new MeterReading();
        r.setMeterId(m.getId());
        r.setYm(req.ym());
        fill(r, req);
        r.setFactorSnap(one(m.getFactor()));   // 快照当时表倍率
        r.setSource("manual");
        readings.insert(r);
        timeline.recordChange(List.of(req.ym()), READING_CHANGE);   // SPEC §1.5:读数改了,该月的快照需重算
        return toReadingDTO(readings.selectById(r.getId()));
    }

    /** data_change_log.source:读数改动(档案改动由 MeterTimelineService 自己记 meter-archive)。 */
    private static final String READING_CHANGE = "meter-reading";

    // SPEC §3.4 / G10:给早于第一条状态的月份 M 补读数、且本月止有值 = 这块表从 M 起在册 ——
    // 状态补 active@M;归属若也晚于 M,照最早一行在 M 补一行。补上的月份里有冻结的就整条拒(读数也不写)。
    private void healBeforeFirst(Meter m, MeterReadingReq req) {
        boolean read = java.util.stream.Stream.of(req.currTotal(), req.currSharp(), req.currPeak(), req.currFlat(),
            req.currValley()).anyMatch(Objects::nonNull);
        String ym = req.ym();
        MeterTimelineService.Rows rs = timeline.rows(m.getId());
        if (!read || MeterTimeline.statusAt(rs.status(), ym) != null) return;
        String maxGen = timeline.maxGeneratedYm();
        java.util.Set<String> months = new java.util.TreeSet<>(span(fromsOf(rs.status(), MeterStatus::getFromYm), ym, maxGen));
        MeterAssign first = rs.assign().isEmpty() ? null : rs.assign().get(0);
        boolean assign = first != null && first.getFromYm().compareTo(ym) > 0;
        if (assign) months.addAll(span(fromsOf(rs.assign(), MeterAssign::getFromYm), ym, maxGen));
        refuseFrozen(m, months);
        List<MeterStatus> after = new ArrayList<>(rs.status());
        upsert(after, statusRow(ym, "active"), MeterStatus::getFromYm);
        refuseCodeClash(m.getKind(), m.getCode(), m.getId(), rs.status(), after);
        MeterTimelineService.Ctx ctx = MeterTimelineService.Ctx.of("manual");
        timeline.writeStatus(m.getId(), ym, "active", ctx);
        if (assign) timeline.writeAssign(rowAt(rs.assign(), m.getId(), ym), ctx);
    }

    // PUT:改月份/读数/备注;meter 与 factor_snap 保持不变(快照语义)
    public MeterReadingDTO updateReading(Integer id, MeterReadingReq req) {
        MeterReading r = readings.selectById(id);
        if (r == null) throw new BizException(ResultCode.NOT_FOUND, "记录不存在");
        // 旧月与新月都要判:只守新月的话,把已审月的读数「挪」进未审月改完再挪回去就绕过了整道闸
        reviewGuard.assertEditable(ReviewKind.METERS, List.of(r.getYm(), req.ym()), null);
        MeterReading clash = readings.selectByMeterAndYm(r.getMeterId(), req.ym());
        if (clash != null && !clash.getId().equals(id))
            throw new BizException(ResultCode.CONFLICT, "该表该月已有读数");
        String oldYm = r.getYm();
        r.setYm(req.ym());
        fill(r, req);
        r.setSource("manual");
        readings.updateById(r);
        timeline.recordChange(List.of(oldYm, req.ym()), READING_CHANGE);   // 挪月 = 两个月都变了
        return toReadingDTO(readings.selectById(id));
    }

    // 先取行再删:被删行的 ym 是审核闸的唯一来源,只判存在性拿不到它
    public void deleteReading(Integer id) {
        MeterReading r = readings.selectById(id);
        if (r == null) throw new BizException(ResultCode.NOT_FOUND, "记录不存在");
        reviewGuard.assertEditable(ReviewKind.METERS, r.getYm(), null);
        readings.deleteById(id);
        timeline.recordChange(List.of(r.getYm()), READING_CHANGE);
    }

    // ── 刀H §H5 按账期批量删除(用户 2026-07-31 点名:自己测试导入的 2023-10 那 80 条要能自己删掉) ──
    // 粒度选「账期」而不是「导入批次」:import_log 只记摘要、无行级关联,批次回滚根本做不到;
    // 而读数按 (表,ym) 唯一,账期是唯一无歧义、且正好对上用户诉求的批次单位。
    // 预览与实删走同一个方法(apply 开关),数字必然一致 —— 两条代码路径各算一遍迟早分叉。
    // 不可逆:二次确认由前端把预览数字复述一遍 + 让人手打账期串(§H5.4)。
    @Transactional
    public MeterDeleteDTO batchDelete(String ym, String kind, String zone, boolean cascade,
                                      boolean dropEmptyMeters, boolean dropDraftNotices, boolean apply) {
        requireYm(ym);
        // 作用域:该 ym 的读数 ∩ kind/zone 过滤后的表档案
        Map<Integer, Meter> scope = meters.selectFiltered(kind, zone).stream()
            .collect(Collectors.toMap(Meter::getId, m -> m));
        List<MeterReading> hits = readings.selectByYm(ym).stream()
            .filter(r -> scope.containsKey(r.getMeterId())).toList();
        List<Integer> readingIds = hits.stream().map(MeterReading::getId).toList();
        // 一表一月一条(uk),故「删完是否零读数」= 该表总读数条数是否只剩本次这一条
        Map<Integer, Long> counts = readingCounts();
        List<Integer> meterIds = hits.stream().map(MeterReading::getMeterId).distinct().toList();
        List<Integer> emptied = meterIds.stream()
            .filter(id -> counts.getOrDefault(id, 0L) <= 1L).toList();
        // 撞 alloc_rule_meter FK 的跳过:池成员表删不得(也正是 V65 那 109 块种子表的护栏 ——
        // 种子表全部有池绑定,「非种子建档」这条与 FK 守卫是同一条线,不另立标志列)
        // 收敛下推:bound 只被下面两行对 emptied 里的 id 做 contains 判定,查这批绑定即可
        // ⚠ 空集守卫:emptied 经常为空(涉及的表都还有别月读数时),MP 的 in(空集) 生成 `IN ()` 是 SQL 语法错
        java.util.Set<Integer> bound = emptied.isEmpty() ? java.util.Set.of()
            : ruleMeters.selectList(new QueryWrapper<AllocRuleMeter>().in("meter_id", emptied)).stream()
                .map(AllocRuleMeter::getMeterId).collect(Collectors.toSet());
        // 别的月的催缴单明细里还有它(fk_line_meter RESTRICT)→ 同样跳过点名,不然整批撞 FK 回一句「违反完整性约束」。
        // 本月的单不算:要么随本次一起删(勾了连带删草稿),要么整批 409。ym 已由 requireYm 校验,inSql 拼接安全。
        java.util.Set<Integer> billed = emptied.isEmpty() || !dropEmptyMeters ? java.util.Set.of()
            : noticeLines.selectObjs(new QueryWrapper<BillNoticeLine>().select("DISTINCT meter_id").in("meter_id", emptied)
                    .notInSql("notice_id", "SELECT id FROM bill_notice WHERE ym = '" + ym + "'"))
                .stream().map(o -> ((Number) o).intValue()).collect(Collectors.toSet());
        List<Integer> dropIds = dropEmptyMeters
            ? emptied.stream().filter(id -> !bound.contains(id) && !billed.contains(id)).toList() : List.of();
        List<String> blocked = dropEmptyMeters
            ? emptied.stream().filter(id -> bound.contains(id) || billed.contains(id))
                .map(id -> label(scope.get(id)) + (billed.contains(id) ? "(别的月的催缴单里还有它)" : "")).toList()
            : List.of();
        List<String> dropped = dropIds.stream().map(id -> label(scope.get(id))).toList();
        // 派生快照(整月口径,见 MeterDeleteDTO 头注);manual 行保留并点名。
        // 用各 mapper 现成的 selectByYm 取行再数,不为一个计数另开 count 方法:一个月至多千余行。
        List<AllocResult> allocs = allocResults.selectByYm(ym);
        List<AllocResult> manual = allocs.stream().filter(r -> "manual".equals(r.getSource())).toList();
        int derived = cascade
            ? poolResults.selectByYm(ym).size() + poolMeterResults.selectByYm(ym).size()
                + lossResults.selectByYm(ym).size() + (allocs.size() - manual.size())
            : 0;
        // S4-2 守卫(防「读数删了单还在」),用户 2026-09-24 反馈批删是死胡同(作废只能逐张,也没有删整月单的入口)后分两类:
        //   已确认/已导出(含历史签发)锁着 → 整批 409 点户名,先去催缴单屏作废;
        //   草稿/已作废随时能重新生成 → 勾了 dropDraftNotices 连带删掉,没勾 409 让人勾。
        //   单是按户整月出的,删就删该月全部这两类单,不随 kind/zone 收窄。预览把两类数字都报出来,执行才 409。
        // 实删走锁定读(RR 下普通读是快照):并发提交的确认读得到、下面 409 判得到;idx_notice_ym 的 next-key 锁
        // 同时挡住并发 generate 往这个月插新单。下面只删这次读到的 draft/void 的 id。
        QueryWrapper<BillNotice> nq = new QueryWrapper<BillNotice>().select("id", "ym", "tenant_id", "status").eq("ym", ym);
        if (apply) nq.last("FOR UPDATE");
        List<BillNotice> monthNotices = billNotices.selectList(nq);
        int notices = monthNotices.size();
        int drafts = (int) monthNotices.stream().filter(n -> "draft".equals(n.getStatus())).count();
        int voids = (int) monthNotices.stream().filter(n -> "void".equals(n.getStatus())).count();
        int open = drafts + voids;
        List<Integer> lockedTids = monthNotices.stream().filter(n -> !OPEN_NOTICE.contains(n.getStatus()))
            .map(BillNotice::getTenantId).distinct().toList();
        List<String> lockedTenants = lockedTids.isEmpty() ? List.of()
            : tenants.selectBatchIds(lockedTids).stream().map(Tenant::getCompanyName).toList();
        // METER-TIMELINE-SPEC §3.5:连带删本期导入写下的档案行(from_ym = 本期 且 src = import);
        // 导入自愈补的 active@本期 也在其中,删掉即回退自愈。作用域同读数(kind/zone 过滤后的表)。
        MeterTimelineService.View tl = timeline.latest();
        List<MeterAssign> aDel = scope.keySet().stream().flatMap(id -> tl.assigns().getOrDefault(id, List.of()).stream())
            .filter(a -> ym.equals(a.getFromYm()) && "import".equals(a.getSrc())).toList();
        List<MeterStatus> sDel = scope.keySet().stream().flatMap(id -> tl.statuses().getOrDefault(id, List.of()).stream())
            .filter(s -> ym.equals(s.getFromYm()) && "import".equals(s.getSrc())).toList();
        // SPEC §10.2:本月「册子里有这块表」的记录一并删,作用域同读数(kind/zone)
        List<Long> bookIds = bookSeen.selectList(new QueryWrapper<MeterBookSeen>().select("id", "meter_id").eq("ym", ym))
            .stream().filter(b -> scope.containsKey(b.getMeterId())).map(MeterBookSeen::getId).toList();
        MeterDeleteDTO dto = new MeterDeleteDTO(ym, hits.size(), meterIds.size(), emptied.size(), derived,
            notices,
            manual.stream().map(r -> "租户#" + r.getTenantId() + " " + r.getFeeKey()).toList(),
            dropped, blocked, aDel.size(), sDel.size(), bookIds.size(),
            drafts, voids, notices - open, lockedTenants);
        if (!apply) return dto;
        // 审核闸只在实删这一侧:apply=false 是预览,预览被拒的话用户连「为什么删不了」都看不见
        reviewGuard.assertEditable(ReviewKind.METERS, ym, null);
        String names = String.join("、", lockedTenants.subList(0, Math.min(5, lockedTenants.size())))
            + (lockedTenants.size() > 5 ? " 等 " + lockedTenants.size() + " 户" : "");
        guardOpenNotices(monthNotices.stream().map(BillNotice::getStatus).toList(), List.of(ym), dropDraftNotices,
            "该月有 " + (notices - open) + " 张已确认/已导出的催缴单(" + names
                + "),读数删了单上的数就对不上了。先在催缴单屏作废这些单,再回来删",
            "该月有 " + open + " 张草稿催缴单" + (voids > 0 ? "(含已作废 " + voids + " 张)" : "") + ",读数删了单还在。"
                + "勾选「同时删除该月的草稿催缴单」再删,删后可在催缴单屏重新生成");
        // 删掉本期那一行,它那一段的月份回落到上一行:其中有冻结月(SPEC §4)就整批不删,点名
        String maxGen = timeline.maxGeneratedYm();
        Map<Integer, java.util.Set<String>> spans = new TreeMap<>();
        for (MeterAssign a : aDel)
            spans.computeIfAbsent(a.getMeterId(), k -> new java.util.TreeSet<>()).addAll(span(
                tl.assigns().get(a.getMeterId()).stream().map(MeterAssign::getFromYm).toList(), ym, maxGen));
        for (MeterStatus s : sDel)
            spans.computeIfAbsent(s.getMeterId(), k -> new java.util.TreeSet<>()).addAll(span(
                tl.statuses().get(s.getMeterId()).stream().map(MeterStatus::getFromYm).toList(), ym, maxGen));
        List<String> frozen = new ArrayList<>();
        spans.forEach((id, ms) -> {
            List<MeterTimelineService.Frozen> f = timeline.frozenMonths(id, ms);
            if (!f.isEmpty()) frozen.add(label(scope.get(id)) + ":" + frozenText(f));
        });
        if (!frozen.isEmpty())
            throw new BizException(ResultCode.CONFLICT, "删掉本期导入写下的档案行会改到冻结的月份,本次没有删:" + cap(frozen));
        // 删掉导入写的「已拆」行,旧表重新在册,可能和同码的另一块表同一个月都在册(用户 2026-09-25:不许)
        Map<Integer, List<MeterStatus>> sWas = new TreeMap<>(), sLeft = new java.util.HashMap<>();
        for (MeterStatus s : sDel) {
            List<MeterStatus> was = tl.statuses().get(s.getMeterId());
            sWas.put(s.getMeterId(), was);
            sLeft.put(s.getMeterId(), was.stream().filter(x -> !ym.equals(x.getFromYm())).toList());
        }
        List<String> clash = codeClashes(scope, sWas, sLeft);
        if (!clash.isEmpty())
            throw new BizException(ResultCode.CONFLICT, "删掉本期导入写下的状态行后,同一个编码会有两块表同一个月都在册,本次没有删:" + cap(clash));
        // 先删单再删读数与表档案,同一事务(方法级 @Transactional)。generate 删单时不记「需重算」,这里同样不记
        // (读数删了,下面照记 meter-reading)。
        dropNotices(monthNotices.stream().filter(n -> OPEN_NOTICE.contains(n.getStatus())).map(BillNotice::getId).toList());
        MeterTimelineService.Ctx del = MeterTimelineService.Ctx.of("manual");
        for (MeterAssign a : aDel) timeline.deleteAssign(a.getMeterId(), ym, del);
        for (MeterStatus s : sDel) timeline.deleteStatus(s.getMeterId(), ym, del);
        if (!bookIds.isEmpty()) bookSeen.delete(new QueryWrapper<MeterBookSeen>().in("id", bookIds));
        if (!readingIds.isEmpty()) {
            readings.delete(new QueryWrapper<MeterReading>().in("id", readingIds));
            timeline.recordChange(List.of(ym), READING_CHANGE);
        }
        if (cascade) {
            poolResults.deleteByYm(ym);
            poolMeterResults.deleteByYm(ym);
            lossResults.deleteByYm(ym);
            allocResults.deleteGenByYm(ym);   // manual 行不在其列
        }
        if (!dropIds.isEmpty()) meters.delete(new QueryWrapper<Meter>().in("id", dropIds));   // 读数已删,FK 无残留
        // 审计:不可逆操作必须留痕(operator 由 ImportLogService 从鉴权上下文解析)
        importLogs.record(new ImportLogReq("meter_delete", "抄表批量删除", "批量删除 " + ym, ym,
            hits.size(), hits.size(), blocked.size(), "complete"));
        return dto;
    }

    // 表档案在返回清单里的可读标签(id 给人工复核用,名字给人看)
    static String label(Meter m) {
        return m == null ? "?" : m.getName() + "(id " + m.getId() + ")";
    }

    // ── 导入(METER-IMPORT-SPEC §3):表身份走分层匹配管道 编码 → 位置 → 标识 → 新建,
    //   命中唯一才算命中,多候选=歧义不落库;读数按 (表,ym) upsert 覆盖(跨批重导=覆盖;同批同表同月读数不同=G6 行级错误)。
    //   factor_snap = 行倍率(空则表档案倍率)。非法 kind/zone/ym、无从取名=行级错误跳过,不整批拦。
    //   档案按月记(METER-TIMELINE-SPEC §3.2):每行只写导入月 M 那一行归属(和上一行一样也写),护栏 G1–G11 标在各处。 ──
    // 读数写入攒批(2026-08-11 审计 P3):500 行一条 upsert(MeterReadingMapper.upsertBatch),
    // 语义与原「先删后插」等价。攒批不影响任何判定 —— readByYm 每个 ym 只在**首次遇到**时从库装载一次,
    // 之后全走内存 map(本批新行随写随进),所以推迟落库改变不了 §E3.4 探针看见的东西。
    private static final int READING_BATCH = 500;

    @Transactional
    public MeterImportResultDTO importRows(MeterImportRequest req) {
        // 一批可跨月:把本批**真会落库**的月份去重后一次闸掉,任一月被审就整批拒(同一 @Transactional,半批落库更糟)。
        // ⚠ 只送格式合法的月份:月份非法的行本来是行级错误(跳过并进 errors),送进闸会被 ReviewKey 的严格校验
        //   打成整批 400 —— 行级容错变批级拒收。本类的 YM 是宽正则(放行 2024-13),故这里另用与 ReviewKey 同口径的一份。
        java.util.Set<String> months = req.rows().stream().map(MeterImportRequest.Row::ym)
            .filter(y -> y != null && REVIEW_YM.matcher(y).matches()).collect(Collectors.toSet());
        if (!months.isEmpty()) reviewGuard.assertEditable(ReviewKind.METERS, months, null);
        // 表身份没有月份语境:索引站在各表最新一行认表(§2);写入的底子另按导入月取 assignAt(M)(SPEC §3.2)。
        // 两条链整份装进内存,本批写过的行随写随进 —— 同一块表同批跨月时,后一行的底子看得见前一行。
        MeterTimelineService.View latest = timeline.latest();
        Map<Integer, List<MeterAssign>> assignRows = new java.util.HashMap<>();
        latest.assigns().forEach((k, v) -> assignRows.put(k, new ArrayList<>(v)));
        Map<Integer, List<MeterStatus>> statusRows = new java.util.HashMap<>();
        latest.statuses().forEach((k, v) -> statusRows.put(k, new ArrayList<>(v)));
        Map<Integer, Meter> assetById = new java.util.HashMap<>();
        List<MeterAt> all = new ArrayList<>();
        for (Meter m : meters.selectList(null)) {
            assetById.put(m.getId(), m);
            all.add(MeterAt.of(m, latest.assign(m.getId()), latest.status(m.getId()), MeterTimeline.LATEST));
        }
        Index idx = new Index(all, statusRows);
        idx.bldNames = buildings.selectList(new QueryWrapper<com.park.demo3.entity.Building>().select("id", "name")).stream()
                .collect(Collectors.toMap(com.park.demo3.entity.Building::getId, com.park.demo3.entity.Building::getName, (a, b) -> a));
        // 本批档案写入共用一个批次号(撤销导入按它逆序还原,SPEC §3.5);文件名进 meter_archive_log.file_name(列宽 255)
        String batchId = java.util.UUID.randomUUID().toString();
        String fileName = blankToNull(req.fileName());
        if (fileName != null && fileName.length() > 255) fileName = fileName.substring(0, 255);
        MeterTimelineService.Ctx ctx = new MeterTimelineService.Ctx("import", batchId, fileName, null, null);
        String maxGen = timeline.maxGeneratedYm();
        Map<Integer, String> lastRead = lastReadingYms();                   // G7
        Map<String, Integer> seen = new java.util.HashMap<>();               // G6:表id|月 → 本批第一次认到它的行号
        java.util.Set<String> allowed = new java.util.HashSet<>();           // 批级断言:本批只许写到这些起始月
        java.util.Set<String> readMonths = new java.util.TreeSet<>();        // 读数写到的月(需重算)
        List<MeterImportResultDTO.Change> changes = new ArrayList<>();
        List<Swap> swaps = new ArrayList<>();                                // G9 候选,批末判
        // §E3.4 重复建档探针:ym → (表id → 本月读数),按需装载;本批新导入的行随写随进,同批重复也照抓
        Map<Integer, MeterAt> meterById = new java.util.HashMap<>();
        for (MeterAt m : all) meterById.put(m.getId(), m);
        Map<String, Map<Integer, MeterReading>> readByYm = new java.util.HashMap<>();
        List<ImportError> errors = new ArrayList<>();
        // 「只提示不打标/不跳行」清单(§F2 疑似重复建档、§F6 位置原文与人工楼层冲突):
        // 单列出来,末尾才并进 errors —— skipped 只数真正跳过的行
        List<ImportError> notices = new ArrayList<>();
        List<MeterImportResultDTO.Match> matches = new ArrayList<>();
        List<MeterReading> pending = new ArrayList<>();   // 待落库读数,满 READING_BATCH 冲一次
        int imported = 0, sortNo = meters.maxSortNo();
        List<MeterImportRequest.Row> rows = req.rows();
        // G10 判同码在册看的是同批别的表已经写到哪:编码栏「已拆」的行先走(换表的旧表先拆掉,新表那一行补在册才不被误拒),
        // 与行序无关。停用照算在册,不提前。报错、提示、认表清单末尾按行号排回去。
        // 其次有码行先走(编码优先占位):真表档案里还没有编码时,有码那一行先认上、把编码写回,同址无码的临电行随后才让得开它
        List<Integer> order = java.util.stream.IntStream.range(0, rows.size()).boxed()
            .sorted(java.util.Comparator.comparing((Integer k) -> !removedMark(rows.get(k)))
                .thenComparing(k -> rowCode(rows.get(k)) == null)).toList();
        // 编码优先占位(2026-09-25 用户拍板):按编码认得上的行先占住「那块表 · 那个月」,别的行按位置 / 标识认表时让开它。
        // 二期原册:无码的「谢福兵临电」在前、按位置认到了有码的「谢福兵电」,真表那一行反被 G6 拒掉,真读数丢了。
        // 期区对不上的不占(那一行是 G5 行级错误)
        Map<String, Integer> codeClaim = new java.util.HashMap<>();   // 表id|月 → 按编码认到它的第一行
        for (int k = 0; k < rows.size(); k++) {
            Match c = idx.byCodeOf(rows.get(k));
            if (c != null && c.meter() != null && c.meter().getZone().equals(rows.get(k).zone()))
                codeClaim.putIfAbsent(c.meter().getId() + "|" + rows.get(k).ym(), k);
        }
        for (int i : order) {
            MeterImportRequest.Row row = rows.get(i);
            // 标识列可缺(用户新模板没有):合成 区域-位置-表名 → 编码 作标签(§3.1)
            String name = blankToNull(row.name()) != null ? row.name().trim() : fallbackName(row);
            if (name.isEmpty()) {
                errors.add(new ImportError(i, "", "无法识别表标识(标识/区域/位置/表名/编码全空)")); continue;
            }
            if (!validKind(row.kind()) || !validZone(row.zone())) {
                errors.add(new ImportError(i, name, "分区/类别非法(kind=elec|water,zone=p1/p2/p3…或 dorm)")); continue;
            }
            // 严格月份(01–12):宽正则放过的 2024-13 走到档案写入会被 MeterTimelineService 拒成整批 400
            if (row.ym() == null || !REVIEW_YM.matcher(row.ym()).matches()) {
                errors.add(new ImportError(i, name, "月份格式非法(应为 YYYY-MM)")); continue;
            }
            if (blankToNull(row.ownership()) != null && !validOwnership(row.ownership().trim())) {
                errors.add(new ImportError(i, name, "归属非法(tenant|share|ops|infra|park|register)")); continue;
            }
            String ym = row.ym();
            // G8:按位置 / 标识不认 M 月已拆的表(同址来的是换上去的新表);按编码照认,下面出提示
            Match hit = idx.resolve(row, name, x -> "removed".equals(statusOf(statusRows, x.getId(), ym))
                || yields(rows, codeClaim.get(x.getId() + "|" + ym), i, x));
            if (hit.ambiguous != null) {   // 歧义不猜:猜错=把 A 表读数写进 B 表,不可逆无痕(§3.4)
                errors.add(new ImportError(i, name, hit.ambiguous)); continue;
            }
            // G5:编码认到的表在别的期区 = 编码填错(2026-09-23 南盛物流案,表 243):整行不写,读数也不写
            if (hit.meter != null && "code".equals(hit.by) && !row.zone().equals(hit.meter.getZone())) {
                errors.add(new ImportError(i, name, "编码 " + rowCode(row) + " 认到的是" + ZoneService.label(hit.meter.getZone())
                    + "的表「" + hit.meter.getName() + "」(id " + hit.meter.getId() + "),本行是" + ZoneService.label(row.zone())
                    + ";编码多半填错了,本行没有导入(读数也没写)"));
                continue;
            }
            // G6:同一批里同一块表同一月第二次出现且读数不同 → 后一行不覆盖前一行
            Integer first = hit.meter == null ? null : seen.get(hit.meter.getId() + "|" + ym);
            if (first != null && !sameReading(rows.get(first), row)) {
                errors.add(new ImportError(i, name, "与本批第 " + (first + 1) + " 行认到同一块表的同一个月(" + ym
                    + "),读数不同;本行没有导入,以第 " + (first + 1) + " 行为准"));
                continue;
            }
            Map<Integer, MeterReading> readOfYm = readByYm.computeIfAbsent(ym, y ->
                readings.selectByYm(y).stream()
                    .collect(java.util.stream.Collectors.toMap(MeterReading::getMeterId, x -> x,
                        (a, b) -> a, java.util.HashMap::new)));
            String g4 = removedMark(row) ? "removed" : retiredMark(row) ? "retired" : null;
            boolean read = hasReading(row);
            boolean applied = true;   // G11 冻结时档案不改
            MeterAt m;
            if (hit.meter == null) {   // 自动建档
                m = new MeterAt();
                m.setKind(row.kind()); m.setZone(row.zone()); m.setName(idx.freeName(row.kind(), row.zone(), name));
                applyDesc(m, row, idx, "new");
                // 新建的表写完会与同码的另一块表同一个月都在册 → 行级错误,不建表(同 G10)
                String clash = codeClash(m.getCode(), List.of(), planned(List.of(), statusPlan(List.of(), ym, g4, read, true)),
                    rivals(m.getKind(), m.getCode(), null));
                if (clash != null) {
                    errors.add(new ImportError(i, name, clash + ",本行没有导入(读数也没写)"));
                    continue;
                }
                m.setSortNo(++sortNo);
                m.setFactor(one(row.factor()));   // G7:新表没有更晚的读数,倍率就取这一行
                // §F2:自动只落 incomplete(四空=档案不全,照常入Σ,纯屏上提示)。
                // shadow 会把表踢出Σ 与池分母,不能由导入自动打 —— 见下面 dupeOf 的「只提示不打标」。
                m.setSuspect(archiveBlank(m) ? "incomplete" : null);
                Meter asset = new Meter();
                m.assetInto(asset);
                meters.insert(asset);
                m.setId(asset.getId());
                assetById.put(asset.getId(), asset);
                // G9:按这一行新建了表,同址却还有在册的旧表 → 多半是换表而旧表没标拆。
                // 批末才判:旧表若也在本批同一个月的册子里,两块都在用,不是换表(行序不定,边走边判会误报)
                List<MeterAt> olds = idx.sameAddr(row).stream()
                    .filter(o -> statusOf(statusRows, o.getId(), ym) != null && !"removed".equals(statusOf(statusRows, o.getId(), ym)))
                    .toList();
                if (!olds.isEmpty()) swaps.add(new Swap(i, name, m.getName(), olds, ym));
                if (hit.passed != null) notices.add(new ImportError(i, name, "本行没有编码,按位置认到的「"
                    + hit.passed.getName() + "」有编码 " + hit.passed.getCode() + "、名字也不同,没有认它,已按新表建了「"
                    + m.getName() + "」(读数记在它名下)。若两块其实是同一块表:在册子这一行补上编码 " + hit.passed.getCode()
                    + " 重导,再到抄表屏删掉「" + m.getName() + "」的读数和这块表"));
                idx.add(m);
                MeterAt dup = dupeOf(m, row, readOfYm, meterById);
                if (dup != null) notices.add(new ImportError(i, name,
                    "疑似重复建档:与已有表「" + dup.getName() + "」(id " + dup.getId()
                        + ")同类同区同栋,且本月上月止/本月止/倍率三格全等。"
                        + "仅提示 —— 未标存疑、未影响任何计算;请在抄表屏档案页人工认对后再合并"));
                meterById.put(m.getId(), m);
                List<MeterStatus> sRows = statusRows.computeIfAbsent(m.getId(), k -> new ArrayList<>());
                putAssign(assignRows.computeIfAbsent(m.getId(), k -> new ArrayList<>()), m.toAssign(ym), ctx);
                putStatus(m, sRows, statusPlan(sRows, ym, g4, read, true), ctx, null);   // 新表不进 changes(matchBy=new 已说明)
            } else {           // 刷新描述字段(导入是档案的事实源;身份/人工资产字段不动,§3.2)
                int id = hit.meter.getId();
                Meter asset = assetById.get(id);
                List<MeterAssign> aRows = assignRows.computeIfAbsent(id, k -> new ArrayList<>());
                List<MeterStatus> sRows = statusRows.computeIfAbsent(id, k -> new ArrayList<>());
                // 底子 = 导入月 M 的样子(assignAt(M)),不是最新一行:册子只改 M 这一行(R1)
                MeterAssign base = MeterTimeline.assignAt(aRows, ym);
                m = MeterAt.of(asset, base, null, ym);
                // G1 G2 G3 G4:人工设定过的组保留并随底子带进 M 行,只提示
                List<String> warns = applyDesc(m, row, idx, hit.by);
                MeterAssign want = m.toAssign(ym);
                // SPEC §3.6:换租写新行时不继承合同钉(钉的是上一户的合同;同 assignByMonth)
                if (base != null && !fromsOf(aRows, MeterAssign::getFromYm).contains(ym) && tenantChanged(base, want))
                    want.setContractId(null);
                List<String> diff = base == null ? List.of() : MeterTimeline.diff(base, want);
                TreeMap<String, String> plan = statusPlan(sRows, ym, g4, read, false);
                // G11 单表冻结(SPEC §4):这一行要改的段波及冻结月 → 读数照写,档案(含编码/倍率)一格不改
                // ponytail: 每个认到的表查一次 frozenMonths(一条 lockedNotices + 审核态,千行约两千次查询);
                //   整册三个月一起导嫌慢时,给 MeterTimelineService 加一个按表批量取冻结月的入口
                java.util.Set<String> reach = new java.util.TreeSet<>(span(fromsOf(aRows, MeterAssign::getFromYm), ym, maxGen));
                if (!plan.isEmpty()) reach.addAll(span(fromsOf(sRows, MeterStatus::getFromYm), plan.firstKey(), maxGen));
                List<MeterTimelineService.Frozen> frozen = timeline.frozenMonths(id, reach);
                if (!frozen.isEmpty()) {
                    applied = false;
                    if (!diff.isEmpty() || !plan.isEmpty())
                        notices.add(new ImportError(i, name, "表「" + m.getName() + "」本行要改的档案波及冻结的月份("
                            + frozenText(frozen) + "):读数已写入,档案没有改(" + fieldsText(diff, plan) + ")"));
                    m = hit.meter;
                } else {
                    // G10 自愈补在册会让这块表与同码的另一块表同一个月都在册 → 行级错误,整行不写(同 G5)
                    String clash = codeClash(m.getCode(), sRows, planned(sRows, plan), idx.sameCode(m.getKind(), m.getCode(), id));
                    if (clash != null) {
                        errors.add(new ImportError(i, name, clash + ",本行没有导入(读数也没写)"));
                        continue;
                    }
                    for (String w : warns) notices.add(new ImportError(i, name, w));
                    // G7:倍率只在 M 不早于这块表已有的最新读数月时写回;更早的旧册只进本行 factor_snap
                    String last = lastRead.get(id);
                    if (row.factor() != null && (last == null || ym.compareTo(last) >= 0)) m.setFactor(row.factor());
                    if (m.getFactor() == null) m.setFactor(BigDecimal.ONE);
                    idx.remove(hit.meter);
                    m.assetInto(asset);   // 资产列(编码/表类/倍率)不分月
                    meters.updateById(asset);
                    idx.add(m);
                    // SPEC §3.2:每个导入的月份都写自己那一行,值和上一行一样也写(R4 的地基:后面有册子的月份各有一行挡着)
                    putAssign(aRows, want, ctx);
                    String until = lastMonth(MeterTimeline.until(fromsOf(aRows, MeterAssign::getFromYm), ym));
                    for (String f : diff)
                        changes.add(new MeterImportResultDTO.Change(id, m.getName(), f, valueOf(base, f), valueOf(want, f), ym, until));
                    putStatus(m, sRows, plan, ctx, changes);
                }
                meterById.put(m.getId(), m);
            }
            List<MeterStatus> sNow = statusRows.getOrDefault(m.getId(), List.of());
            if (g4 != null && applied) {
                MeterStatus s = MeterTimeline.statusAt(sNow, "removed".equals(g4) && read ? next(ym) : ym);
                notices.add(new ImportError(i, name, "retired".equals(g4)
                    ? "表「" + m.getName() + "」本行企业名称是「" + row.tenantName().trim() + "」:没有当企业名称写入;自 "
                        + s.getFromYm() + " 起停用(在册、不计费)"
                    : "表「" + m.getName() + "」本行编码是「" + row.code().trim() + "」:没有当编码写入;自 "
                        + s.getFromYm() + " 起已拆" + (read ? "(拆表当月读数照收)" : "")));
            }
            // G8:认到的表这个月不在服务(停用 / 已拆)而本行有读数 → 读数照写,但说清楚这个月不计费
            MeterStatus sAt = MeterTimeline.statusAt(sNow, ym);
            if (g4 == null && read && sAt != null && !"active".equals(sAt.getStatus()))
                notices.add(new ImportError(i, name, "表「" + m.getName() + "」自 " + sAt.getFromYm() + " 起"
                    + ("removed".equals(sAt.getStatus()) ? "已拆" : "停用") + ",本行有读数:读数已写入,但这个月不计费"));
            seen.putIfAbsent(m.getId() + "|" + ym, i);
            if (rowCode(row) != null) codeClaim.putIfAbsent(m.getId() + "|" + ym, i);   // 档案里原来没码、本行头一回带码的也占
            allowed.add(ym);
            if ("removed".equals(g4) && read) allowed.add(next(ym));
            matches.add(new MeterImportResultDTO.Match(i, name, hit.by, m.getId()));
            MeterReading r = new MeterReading();
            r.setMeterId(m.getId());
            r.setYm(row.ym());
            r.setPrevTotal(row.prevTotal()); r.setCurrTotal(row.currTotal());
            r.setPrevSharp(row.prevSharp()); r.setPrevPeak(row.prevPeak());
            r.setPrevFlat(row.prevFlat()); r.setPrevValley(row.prevValley());
            r.setCurrSharp(row.currSharp()); r.setCurrPeak(row.currPeak());
            r.setCurrFlat(row.currFlat()); r.setCurrValley(row.currValley());
            r.setFactorSnap(one(row.factor() == null ? m.getFactor() : row.factor()));
            r.setNote(blankToNull(row.note()));
            r.setSource("import");
            // 表档案两条分支(insert 新建 / 已在库)都已先于本行落库,FK fk_meter_reading_meter 冲批时必定有主
            pending.add(r);
            if (pending.size() >= READING_BATCH) { readings.upsertBatch(pending); pending.clear(); }
            readOfYm.put(m.getId(), r);   // 探针拿的是这个内存对象,不依赖它是否已落库(也不依赖自增 id)
            lastRead.merge(m.getId(), ym, (a, b) -> a.compareTo(b) >= 0 ? a : b);   // G7:同批更晚的月压住更早的
            readMonths.add(ym);
            imported++;
        }
        if (!pending.isEmpty()) readings.upsertBatch(pending);   // 同一 @Transactional 内,失败照样整批回滚
        errors.sort(java.util.Comparator.comparingInt(ImportError::rowIndex));   // 「已拆」行先走的,排回行号序
        notices.sort(java.util.Comparator.comparingInt(ImportError::rowIndex));
        matches.sort(java.util.Comparator.comparingInt(MeterImportResultDTO.Match::rowIndex));
        for (Swap s : swaps) {
            String olds = s.olds().stream().filter(o -> !seen.containsKey(o.getId() + "|" + s.ym()))
                .map(o -> "「" + o.getName() + "」(id " + o.getId() + ")").collect(Collectors.joining("、"));
            if (!olds.isEmpty()) notices.add(new ImportError(s.row(), s.label(), "表「" + s.fresh()
                + "」是按这一行新建的,与在册的" + olds + "位置相同:可能是换表 —— 旧表仍在册,若已拆请到档案里标拆除"));
        }
        // 批级断言(SPEC §3.2):本批写下的档案行,起始月只能是本批的月份或 G4 拆表的次月。
        // 数的是库里真落下的变更记录,不是上面的计划 —— 计划写错了别的月(R1/R3/R4 的底线)这里才抓得到。
        List<String> stray = archive.selectObjs(new QueryWrapper<MeterArchiveLog>()
                .select("DISTINCT from_ym").eq("batch_id", batchId)).stream()
            .map(String::valueOf).filter(f -> !allowed.contains(f)).sorted().toList();
        if (!stray.isEmpty())
            throw new BizException(ResultCode.INTERNAL,
                "本批写到了本批月份以外的档案行(" + String.join("、", stray) + "),整批没有导入");
        // SPEC §10.2 本月册子已核:认到表(含新建)且没被判行级错误的每一行 = seen 的键(表id|月),
        // G2 人工保留、G11 冻结没改档案的也在内(册子里确实有这块表)。整批一条语句写完
        if (!seen.isEmpty()) {
            java.time.LocalDateTime now = java.time.LocalDateTime.now();
            List<MeterBookSeen> book = new ArrayList<>();
            for (String k : seen.keySet()) {
                int bar = k.indexOf('|');
                MeterBookSeen b = new MeterBookSeen();
                b.setMeterId(Integer.valueOf(k.substring(0, bar))); b.setYm(k.substring(bar + 1));
                b.setBatchId(batchId); b.setFileName(fileName); b.setSeenAt(now);
                book.add(b);
            }
            bookSeen.insertAll(book);
        }
        timeline.recordChange(readMonths, READING_CHANGE);
        // 刀G 复核:提示走独立通道,不再 addAll 进 errors —— 混进去会被前端渲染成「N 行未导入」+警告三角。
        return new MeterImportResultDTO(imported, errors.size(), errors, matches, notices, batchId, changes);
    }

    // ── SPEC §3.5 撤销一次导入的档案改动:按 meter_archive_log 逆序还原前像(插入的删掉、更新的改回),读数不动。
    //   两种情形整批拒并列出,一行不动:
    //   ① 这批写过的行之后又被改过(现状 ≠ 当时的后像)—— 照前像写回会冲掉后来的改动(含已撤销过一次);
    //   ② 还原会波及冻结的月份(SPEC §4)。
    //   还原的行照前像的来源写回(src=migrate 的仍是 migrate),批次号清空;变更记录的 row_ref 写明撤销的是哪一批。 ──
    @Transactional
    public int revertImport(String batchId) {
        List<MeterArchiveLog> logs = archive.selectList(new QueryWrapper<MeterArchiveLog>()
            .eq("batch_id", batchId).orderByDesc("id"));
        if (logs.isEmpty()) throw new BizException(ResultCode.NOT_FOUND, "这次导入没有改过档案,没有可撤销的");
        String maxGen = timeline.maxGeneratedYm();
        Map<Integer, Meter> named = meters.selectBatchIds(logs.stream().map(MeterArchiveLog::getMeterId).distinct().toList())
            .stream().collect(Collectors.toMap(Meter::getId, x -> x));
        Map<Integer, MeterTimelineService.Rows> chains = new java.util.HashMap<>();   // 表 → 两条链,逆序模拟还原时随改随换
        Map<Integer, java.util.Set<String>> reach = new TreeMap<>();
        Map<Integer, List<MeterStatus>> sWas = new TreeMap<>();   // 状态链撤销前的样子(swap 原地改 chains)
        List<String> bad = new ArrayList<>();
        for (MeterArchiveLog l : logs) {
            MeterTimelineService.Rows rs = chains.computeIfAbsent(l.getMeterId(), timeline::rows);
            String who = named.containsKey(l.getMeterId()) ? label(named.get(l.getMeterId())) : "表 id " + l.getMeterId();
            java.util.Set<String> ms = reach.computeIfAbsent(l.getMeterId(), k -> new java.util.TreeSet<>());
            boolean isAssign = MeterTimelineService.ASSIGN.equals(l.getTbl());
            Object now = isAssign ? find(rs.assign(), l.getFromYm(), MeterAssign::getFromYm)
                : find(rs.status(), l.getFromYm(), MeterStatus::getFromYm);
            Object after = isAssign ? parse(l.getAfterJson(), MeterAssign.class) : parse(l.getAfterJson(), MeterStatus.class);
            // 批次号不比:撤掉后一批时照前像写回、批次号清空,这一行的值和这一批的后像一样只差批次号 —— 不算又改过。
            // 撤过的行值或有无本身就和后像不同,防重复撤销不靠它
            if (now instanceof MeterAssign n && after instanceof MeterAssign a) a.setBatchId(n.getBatchId());
            if (now instanceof MeterStatus n && after instanceof MeterStatus a) a.setBatchId(n.getBatchId());
            if (!Objects.equals(now, after))
                bad.add(who + " 自 " + l.getFromYm() + " 起的" + (isAssign ? "归属" : "状态") + "行在这次导入之后又改过(或已撤销过)");
            if (isAssign) {
                ms.addAll(span(fromsOf(rs.assign(), MeterAssign::getFromYm), l.getFromYm(), maxGen));
                swap(rs.assign(), l.getFromYm(), parse(l.getBeforeJson(), MeterAssign.class), MeterAssign::getFromYm);
            } else {
                sWas.computeIfAbsent(l.getMeterId(), k -> new ArrayList<>(rs.status()));
                ms.addAll(span(fromsOf(rs.status(), MeterStatus::getFromYm), l.getFromYm(), maxGen));
                swap(rs.status(), l.getFromYm(), parse(l.getBeforeJson(), MeterStatus.class), MeterStatus::getFromYm);
            }
        }
        reach.forEach((id, ms) -> {
            List<MeterTimelineService.Frozen> f = timeline.frozenMonths(id, ms);
            if (!f.isEmpty()) bad.add((named.containsKey(id) ? label(named.get(id)) : "表 id " + id) + ":" + frozenText(f));
        });
        // 删掉 / 还原状态行后同码两块表同一个月都在册(导入写的「已拆」前像为空,撤掉旧表就重新在册)→ 同样整批拒
        bad.addAll(codeClashes(named, sWas, sWas.keySet().stream()
            .collect(Collectors.toMap(id -> id, id -> chains.get(id).status()))));
        if (!bad.isEmpty()) throw new BizException(ResultCode.CONFLICT, "这次导入的档案改动没有撤销:" + cap(bad));
        java.util.Set<String> all = reach.values().stream().flatMap(java.util.Set::stream)
            .collect(Collectors.toCollection(java.util.TreeSet::new));
        // 冻结月已含审核锁;这一道是写端点的守卫口径(PLAN §2.1,ReviewGuardCoverageTest 认方法体里的这一句)
        reviewGuard.assertEditable(ReviewKind.METERS, all, null);
        String ref = "撤销导入 " + batchId;
        for (MeterArchiveLog l : logs) {
            if (MeterTimelineService.ASSIGN.equals(l.getTbl())) {
                MeterAssign before = parse(l.getBeforeJson(), MeterAssign.class);
                if (before == null) timeline.deleteAssign(l.getMeterId(), l.getFromYm(), undo(l.getSrc(), ref));
                else timeline.writeAssign(before, undo(before.getSrc(), ref));
            } else {
                MeterStatus before = parse(l.getBeforeJson(), MeterStatus.class);
                if (before == null) timeline.deleteStatus(l.getMeterId(), l.getFromYm(), undo(l.getSrc(), ref));
                else timeline.writeStatus(l.getMeterId(), l.getFromYm(), before.getStatus(), undo(before.getSrc(), ref));
            }
        }
        // 还原成 src=migrate 的行 MeterTimelineService 不记需重算,这里对波及的月统一补一次
        timeline.recordChange(all, MeterTimelineService.SOURCE_ARCHIVE);
        bookSeen.delete(new QueryWrapper<MeterBookSeen>().eq("batch_id", batchId));   // SPEC §10.2:本批「册子里有这块表」的记录一并撤掉
        return logs.size();
    }

    private static MeterTimelineService.Ctx undo(String src, String ref) {
        return new MeterTimelineService.Ctx(src, null, null, ref, null);
    }

    private <T> T parse(String s, Class<T> type) {
        if (s == null) return null;
        try {
            return json.readValue(s, type);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("meter_archive_log 前后像解析失败", e);   // 本类自己写的 JSON,读不回只可能是编程错误
        }
    }

    // §F2 疑似重复建档探针(判据与 V75 回填的 shadow 逐条同源):
    //   新表四空 + 对手方档案完整(area/code/tenant_name 至少一项非空)+ 同 (kind, zone, building_id)
    //   + 同月 prev + curr + 倍率三格全等 → 疑似同一块物理表的第二份档案。
    // 刀E 的旧判据只看「同月 curr_total 相等」,实测误报约三成(225 A4东侧总1 / 226 A4东侧总2 都 0.10、
    // 236 A4西侧消防灯 / 253 A6东侧消防灯 2024-05 都 184.69,全是真·不同表),撞上即打 shadow 当场踢出Σ。
    // 现在**只提示不打标**:返回疑似对应的真表,由人工认对,导入不动 suspect、不触发护栏。
    private static MeterAt dupeOf(MeterAt fresh, MeterImportRequest.Row row,
                                Map<Integer, MeterReading> readOfYm, Map<Integer, MeterAt> meterById) {
        if (!archiveBlank(fresh) || row.currTotal() == null) return null;
        BigDecimal factor = one(row.factor() == null ? fresh.getFactor() : row.factor());
        for (Map.Entry<Integer, MeterReading> e : readOfYm.entrySet()) {
            MeterAt o = meterById.get(e.getKey());
            if (o == null || archiveBlank(o)) continue;   // 对手方必须档案完整,否则两块都是「不全」而非「重复」
            if (!fresh.getKind().equals(o.getKind()) || !fresh.getZone().equals(o.getZone())) continue;
            if (!java.util.Objects.equals(fresh.getBuildingId(), o.getBuildingId())) continue;
            MeterReading r = e.getValue();
            if (numEq(row.prevTotal(), r.getPrevTotal()) && numEq(row.currTotal(), r.getCurrTotal())
                    && numEq(factor, one(r.getFactorSnap()))) return o;
        }
        return null;
    }

    // 档案四空 = 区域/位置/企业名称/编码全空(档案完整度,不是重复性)
    private static boolean archiveBlank(MeterAt m) {
        return blankToNull(m.getArea()) == null && blankToNull(m.getSpot()) == null
            && blankToNull(m.getTenantName()) == null && blankToNull(m.getCode()) == null;
    }

    // NULL 安全数值等值(对齐 V75 回填里的 <=>;标度不同也算相等,故用 compareTo)
    private static boolean numEq(BigDecimal a, BigDecimal b) {
        return a == null ? b == null : b != null && a.compareTo(b) == 0;
    }

    // ── 身份匹配管道(METER-IMPORT-SPEC §3) ──
    // 逐层下探(不是短路):某层 0 候选就进下一层——现存 912 块无码表在新模板里第一次拿到编码,
    // 若 L1 落空即新建,这 912 块会全部重复建档。命中后编码写回档案 → 库逐月自愈向 L1 收敛。
    // passed:按位置认到、因无码行不认有码异名的表而没认的那块(新建时出提示用)
    private record Match(MeterAt meter, String by, String ambiguous, MeterAt passed) {
        Match(MeterAt meter, String by, String ambiguous) { this(meter, by, ambiguous, null); }
    }
    /** G9 候选:第 row 行新建了 fresh,同址还有在册的 olds(批末剔掉本批同月也出现的)。 */
    private record Swap(int row, String label, String fresh, List<MeterAt> olds, String ym) {}

    private static final class Index {
        final Map<String, List<MeterAt>> byCode = new java.util.HashMap<>();
        final Map<String, List<MeterAt>> byAddr = new java.util.HashMap<>();
        final Map<String, MeterAt> byName = new java.util.HashMap<>();
        Map<Integer, String> bldNames = Map.of();   // 只给归属护栏提示写楼栋名用
        final Map<Integer, List<MeterStatus>> status;   // importRows 的 statusRows(本批写的随写随进):同码表按月挑

        Index(List<MeterAt> all, Map<Integer, List<MeterStatus>> status) { this.status = status; all.forEach(this::add); }

        static String codeKey(String kind, String code) { return kind + "|" + codeNorm(code); }
        static String addrKey(String kind, String zone, String area, String spot, String sub) {
            return kind + "|" + zone + "|" + area + "|" + n(spot) + "|" + n(sub);
        }
        static String n(String s) { return s == null ? "" : s.trim(); }

        // 编码是否已被(其他)表占用:applyDesc 写回护栏用(调用方先判了 code ≠ m 自己的编码,命中的都是他表)。
        // 同码但这一行的月份不在册的表不算占用 —— 与 pickByCode 同口径
        boolean codeTaken(String kind, String code, String ym) {
            return byCode.getOrDefault(codeKey(kind, code), List.of()).stream().anyMatch(x -> onBook(chain(x), ym));
        }

        /** 同 kind + 编码的其它表(内存里的状态链):导入自愈的编码占用判定用。 */
        List<Rival> sameCode(String kind, String code, int selfId) {
            String c = blankToNull(code);
            return c == null ? List.of() : byCode.getOrDefault(codeKey(kind, c), List.of()).stream()
                .filter(x -> x.getId() != selfId).map(x -> new Rival(x.getId(), x.getName(), chain(x))).toList();
        }

        private List<MeterStatus> chain(MeterAt m) { return status.getOrDefault(m.getId(), List.of()); }

        void add(MeterAt m) {
            byName.put(m.getKind() + "|" + m.getZone() + "|" + m.getName(), m);
            if (blankToNull(m.getCode()) != null)
                byCode.computeIfAbsent(codeKey(m.getKind(), m.getCode().trim()), k -> new ArrayList<>()).add(m);
            if (blankToNull(m.getArea()) != null)
                byAddr.computeIfAbsent(addrKey(m.getKind(), m.getZone(), m.getArea().trim(), m.getSpot(), m.getSubName()),
                    k -> new ArrayList<>()).add(m);
        }

        // applyDesc 会改 code/area/spot/sub_name → 改前先摘出索引,改后再 add(否则索引指向陈旧键)
        // ⚠ 前置条件(调用点唯一,importRows 里 idx.remove(m) 紧挨着 applyDesc 之前):调用时 m 的
        //    键值必须还是它 add 进来时那一套。故这里按键定点删,建键的表达式与 add() 逐行对称 ——
        //    原先是遍历 byCode/byAddr 全部约 1134 个桶挨个 List.remove,每命中一行扫三遍全索引。
        //    定点删与全扫等价:add() 保证一块表只落进一个 byCode 桶、一个 byAddr 桶,
        //    且 MeterAt 的 equals 含 id(各不相同),全扫也只可能在它自己那个桶里命中。
        void remove(MeterAt m) {
            byName.remove(m.getKind() + "|" + m.getZone() + "|" + m.getName(), m);
            if (blankToNull(m.getCode()) != null)
                drop(byCode, codeKey(m.getKind(), m.getCode().trim()), m);
            if (blankToNull(m.getArea()) != null)
                drop(byAddr, addrKey(m.getKind(), m.getZone(), m.getArea().trim(), m.getSpot(), m.getSubName()), m);
        }

        private static void drop(Map<String, List<MeterAt>> bucket, String key, MeterAt m) {
            List<MeterAt> l = bucket.get(key);
            if (l != null) l.remove(m);
        }

        // 合成名撞了 uk_meter(kind,zone,name) 且不是同一块表 → 追加 #2/#3(§3.1)
        String freeName(String kind, String zone, String base) {
            String s = base.length() > 64 ? base.substring(0, 64) : base;
            for (int i = 2; byName.containsKey(kind + "|" + zone + "|" + s); i++)
                s = (base.length() > 60 ? base.substring(0, 60) : base) + "#" + i;
            return s;
        }

        /** 只按编码认(L1);编码为空 / 没认到 = null。 */
        Match byCodeOf(MeterImportRequest.Row row) {
            String code = rowCode(row);
            return code == null ? null : pickByCode(byCode.getOrDefault(codeKey(row.kind(), code), List.of()), row.ym());
        }

        // gone:导入月已拆的表(SPEC §3.2 G8)、本批别的行同月按编码认走的表 —— 按位置 / 标识不认它们;按编码照认(编码是这块物理表自己的)
        Match resolve(MeterImportRequest.Row row, String name, java.util.function.Predicate<MeterAt> gone) {
            String code = rowCode(row);
            Match c = byCodeOf(row);
            if (c != null) return c;
            MeterAt passed = null;
            if (blankToNull(row.area()) != null) {
                Match m = pick(sameAddr(row).stream().filter(x -> !gone.test(x)).toList(), code, name, row);
                // 无码行不认有码且异名的表(2026-09-25 用户拍板):二期「谢福兵临电」无码,同址的「谢福兵电」有码,
                // 按位置认上去就把临电读数写进了真表。不认它,往下走标识(同名的仍认得上),再没有就新建
                if (m != null && m.meter() != null && alien(m.meter(), row)) passed = m.meter();
                else if (m != null) return m;
            }
            MeterAt byN = byName.get(row.kind() + "|" + row.zone() + "|" + name);
            // 没认同址那块时,按标识名只认没有区域或与本行同址的表:别处的同名表认上去,读数串过去、区域也被改掉
            if (byN != null && !gone.test(byN) && !codeConflict(byN, code)
                && (passed == null || blankToNull(byN.getArea()) == null || sameAddr(row).contains(byN)))
                return new Match(byN, "name", null);
            return new Match(null, "new", null, passed);
        }

        // 行没有编码、有自己的标识名(不是缺标识列时拼出来的)、不是「已拆」行,候选有编码,
        // 候选名(去掉新建撞名加的 #n)与这一行的标识名、这一行拼出来的名字都不同
        private static boolean alien(MeterAt m, MeterImportRequest.Row row) {
            String own = ownName(row);
            return rowCode(row) == null && own != null && !removedMark(row) && blankToNull(m.getCode()) != null
                && !sameName(own, m) && !sameName(fallbackName(row), m);
        }

        /** 与这一行同址(kind + zone + 区域 + 位置 + 表名)的表;行没有区域 = 空。 */
        List<MeterAt> sameAddr(MeterImportRequest.Row row) {
            String area = blankToNull(row.area());
            return area == null ? List.of()
                : byAddr.getOrDefault(addrKey(row.kind(), row.zone(), area, row.spot(), row.subName()), List.of());
        }

        // 按编码:只有一块 → 就是它(这个月不在服务照认,G8 另出提示)。多块 = 一块物理表拆下装到别处、
        // 两条档案共用编码 → 只留这一行月份在册的那块;剩零块或多块照旧报重复,点名各块的在册区间。
        // 不拿企业名称消歧:编码重复的两块表未必同栋,静默绑掉一块可能跨楼栋写错表。
        private Match pickByCode(List<MeterAt> cands, String ym) {
            if (cands.isEmpty()) return null;
            if (cands.size() == 1) return new Match(cands.get(0), "code", null);
            List<MeterAt> on = cands.stream().filter(x -> onBook(chain(x), ym)).toList();
            if (on.size() == 1) return new Match(on.get(0), "code", null);
            return new Match(null, "code", "该编码有 " + cands.size() + " 块表:"
                + cands.stream().map(x -> x.getName() + "(" + onBookText(chain(x)) + ")").collect(Collectors.joining("、"))
                + ",这一行的月份 " + ym + (on.isEmpty()
                    ? " 哪块都不在册;请核对这一行的月份,月份没错就到「档案变更」的「在册状态」里改那块表的在册区间,再重导这一行"
                    : " 有 " + on.size() + " 块同时在册,该编码在档案里重复,请先去重"));
        }

        // 按位置:唯一命中→匹配;多候选→(依次用 name、企业名称再筛)仍多则歧义;0 候选→null 交给下一层
        private Match pick(List<MeterAt> cands, String code, String name, MeterImportRequest.Row row) {
            if (cands == null || cands.isEmpty()) return null;
            List<MeterAt> ok = cands.stream().filter(m -> !codeConflict(m, code)).toList();
            if (ok.isEmpty()) return null;
            if (ok.size() == 1) return new Match(ok.get(0), "addr", null);
            if (name != null) {
                List<MeterAt> narrowed = ok.stream().filter(m -> name.equals(m.getName())).toList();
                // 精确没中再去掉表名末尾的 #n 比一次:新建时撞名加了 #2 的表,重导同一本册子要认得回来
                if (narrowed.isEmpty()) narrowed = ok.stream().filter(m -> name.equals(bare(m.getName()))).toList();
                if (narrowed.size() == 1) return new Match(narrowed.get(0), "addr", null);
            }
            // §J1 原册里区分「同区域+同楼层+同表号」那几行的恰恰是企业名称(D 列),故在抛歧义之前
            // 再按企业名称收窄一次。**精确相等**,不做包含/模糊 —— 模糊会把「许振虎」与「许振虎临电」
            // 这类近名并成一块表。导入行企业名称为空则跳过本层(不能拿空值去筛)。
            // 位置同键是原册的正常形态(天面三行本就同 区域+楼层+表号),靠企业名称消歧是还原原册身份。
            String tenant = blankToNull(row.tenantName());
            if (tenant != null) {
                String t = tenant.trim();
                List<MeterAt> narrowed = ok.stream().filter(m -> t.equals(n(m.getTenantName()))).toList();
                if (narrowed.size() == 1) return new Match(narrowed.get(0), "addr", null);
            }
            // §J2 出路要可执行:原册这些行本就无编码(补不了)、「天面」也是原册原文(细化即偏离账册),
            // 故按「本文件有没有标识列」分两种说法 —— 行的 name 为空 = 用户文件丢了原册首列。
            String tail;
            if (blankToNull(row.name()) == null) {
                tail = "且本文件缺原册首列(标识名)、企业名称也未能区分。"
                    + "请用「下载模板」或「导出当月」得到的文件重导(两者都带标识列)";
            } else {
                tail = "标识名「" + n(name) + "」与企业名称「" + n(row.tenantName()) + "」都未能唯一命中,请核对档案";
            }
            return new Match(null, "addr", "按位置匹配到多块表(id "
                + ok.stream().map(m -> String.valueOf(m.getId())).collect(Collectors.joining("、")) + "),"
                + tail);
        }

        // 换表护栏:导入行有编码、候选也有编码且不同 → 是另一块物理表,不继承历史
        private static boolean codeConflict(MeterAt m, String code) {
            return code != null && blankToNull(m.getCode()) != null && !code.trim().equals(m.getCode().trim());
        }
    }

    // 编码优先占位:x 这个月已被本批第 c 行按编码认走 → 本行按位置 / 标识让开它。
    // 读数相同、或本行自己的标识名就是这块表 → 不让,照旧认上交给 G6(读数相同放行,不同报错):
    // 否则同一块表在两个 sheet 各出现一次(一次带码、一次无码),无码那次会悄悄新建「X#2」,一份读数进两块表
    private static boolean yields(List<MeterImportRequest.Row> rows, Integer c, int i, MeterAt x) {
        if (c == null || c == i) return false;
        String own = ownName(rows.get(i));
        return !sameReading(rows.get(c), rows.get(i)) && (own == null || !sameName(own, x));
    }

    // 行自己的标识名;缺标识列时拼出来的(= fallbackName)不算
    private static String ownName(MeterImportRequest.Row row) {
        String s = blankToNull(row.name());
        return s == null || s.equals(fallbackName(row)) ? null : s;
    }

    // 名字相同:规范化后相等,表名末尾新建撞名时加的 #n 不算
    private static boolean sameName(String name, MeterAt m) {
        return MeterTimeline.canon(name).equals(MeterTimeline.canon(bare(m.getName())));
    }

    // 去掉 freeName 加的「#n」
    private static String bare(String name) { return name.replaceFirst("#\\d+$", ""); }

    // 无标识列时的标签(§3.1):区域-位置-表名 → 编码
    private static String fallbackName(MeterImportRequest.Row row) {
        String s = java.util.stream.Stream.of(row.area(), row.spot(), row.subName())
            .map(MeterService::blankToNull).filter(java.util.Objects::nonNull)
            .collect(Collectors.joining("-"));
        if (s.isEmpty()) s = rowCode(row) == null ? "" : rowCode(row);
        return s.length() > 64 ? s.substring(0, 64) : s;
    }

    private static void requireYm(String ym) {
        if (ym == null || !YM.matcher(ym).matches())
            throw new BizException(ResultCode.BAD_REQUEST, "月份格式非法(应为 YYYY-MM)");
    }

    // 建表(create 唯一调用点):请求 → 一块新表的资产列 + 起始归属。编辑走 update(资产)/ assignByMonth(归属)。
    private static void apply(MeterAt m, MeterReq req, String name) {
        m.setKind(req.kind()); m.setZone(req.zone()); m.setName(name);
        m.setArea(blankToNull(req.area())); m.setSpot(blankToNull(req.spot()));
        m.setTenantName(blankToNull(req.tenantName())); m.setMeterType(blankToNull(req.meterType()));
        m.setDeviceType(req.deviceType());   // 已 @Pattern 白名单;contract_id 不在 apply 内(专用 /bind 写)
        m.setTenantId(req.tenantId()); m.setBuildingId(req.buildingId());
        m.setOwnership(req.ownership() == null ? "share" : req.ownership());
        m.setSubName(blankToNull(req.subName())); m.setCode(blankToNull(req.code()));
        m.setFactor(one(req.factor()));
        applyLoc(m, req.floorLabel(), req.side(), req.roomNo());
        // §F6 位置人工标志:与「按 spot 自动解析」有出入 = 人工设定,之后导入不再按 spot 重解析这一列。
        // 抽屉恒带全量三列(§A.3),客户端自报「我改过」不可信,只能拿结果比;
        // 与解析一致(含建档不传三列、人工又改回原文口径)该位保持 0 —— 表挪了地方那一列还能自动跟上。
        // §G5(V78):由布尔改**位掩码**,逐列判定 —— 原先三列共用一个开关,只改房号连楼层一起永久冻结。
        m.setLocManual(locManualMask(m));
        // 建档不是「改过」:租户 / 归属两组人工标志走默认 0;存疑标只收显式值
        if (req.suspect() != null) m.setSuspect(blankToNull(req.suspect()));
    }

    // 「由空变非空」——本次提交真的补齐了这一项(改成另一个非空值不算:那是订正,不是认领)
    private static boolean newlyFilled(String before, String after) {
        return blankToNull(before) == null && blankToNull(after) != null;
    }

    // §G5 loc_manual 位掩码(V78):bit0=楼层 / bit1=方位 / bit2=房号。
    // 选位掩码而不是三个 boolean 列:列不用加、DTO/ts 不用各多两格,判定与消费都是一次位与。
    private static final int LOC_FLOOR = 1, LOC_SIDE = 2, LOC_ROOM = 4;

    // 借一块临时 MeterAt 走同一个 applyLoc 拿「自动解析结果」,不把解析规则抄第二遍——抄了迟早分叉。
    private static MeterAt autoOf(String spot) {
        MeterAt auto = new MeterAt();
        auto.setSpot(spot);
        applyLoc(auto, null, null, null);
        return auto;
    }

    // §F6:逐列与「按 spot 自动解析」的结果比对,有出入的那一列置位
    // (§E8 显式清空成 NULL 而原文解析得出值,同样算人工设定)。
    private static int locManualMask(MeterAt m) {
        MeterAt auto = autoOf(m.getSpot());
        return (java.util.Objects.equals(auto.getFloorLabel(), m.getFloorLabel()) ? 0 : LOC_FLOOR)
            | (java.util.Objects.equals(auto.getSide(), m.getSide()) ? 0 : LOC_SIDE)
            | (java.util.Objects.equals(auto.getRoomNo(), m.getRoomNo()) ? 0 : LOC_ROOM);
    }

    // 导入行描述字段 → 档案(空值不清既有:真实文件同表在不同 sheet 详略不一)。
    // 返回 warn 文案清单(空=无提醒):§F6 位置冲突、§G2 归属冲突。
    private static List<String> applyDesc(MeterAt m, MeterImportRequest.Row row, Index idx, String by) {
        List<String> warns = new ArrayList<>();
        // 换楼栋告警要用改之前的区域名来说话(下面第一句就把 area 覆盖了)
        String area0 = blankToNull(m.getArea());
        if (blankToNull(row.area()) != null) m.setArea(row.area().trim());
        // §F6 spot 照常更新(它是导入身份键),位置三列按人工标志分流 —— §E7 的「已有值一律不动」是个缺口:
        //   该列标志位=0 → 跟着新 spot 重解析(表从三楼挪到五楼,楼层跟上,floor 池桶数与逐户金额才不会算错);
        //   =1 → 该列不动(人工修正保得住),但位置原文真变了且解析出的楼层与人工值不同 → 落 warn 请人核对。
        // §G5(V78):**逐列**分流。原先三列共用一个开关,人工只改了房号也把楼层一并永久冻结,
        // 之后表挪了地方楼层再也不跟随 —— 冻的是没人碰过的列,是纯副作用。
        if (blankToNull(row.spot()) != null) {
            String before = m.getSpot();
            m.setSpot(row.spot().trim());
            int mask = m.getLocManual() == null ? 0 : m.getLocManual();
            MeterAt auto = autoOf(m.getSpot());
            if ((mask & LOC_FLOOR) == 0) m.setFloorLabel(auto.getFloorLabel());
            if ((mask & LOC_SIDE) == 0) m.setSide(auto.getSide());
            if ((mask & LOC_ROOM) == 0) m.setRoomNo(auto.getRoomNo());
            // 只在楼层被冻结、且原文**变了**、解析结果又与人工值不同时提醒(楼层是 floor 池桶数的依据;
            // 否则每块人工设定过的表每次导入都要报一遍 —— 人工值与解析不同本就是常态)
            if ((mask & LOC_FLOOR) != 0 && !java.util.Objects.equals(before, m.getSpot())
                    && !java.util.Objects.equals(auto.getFloorLabel(), m.getFloorLabel()))
                warns.add("表「" + m.getName() + "」的位置原文已变为 " + m.getSpot()
                    + ",而人工设定的楼层仍是 "
                    + (m.getFloorLabel() == null ? "(跨层/不适用)" : m.getFloorLabel())
                    + ",请核对。仅提示 —— 人工设定过的那几项未被改动");
        }
        // 租户组(METER-TIMELINE-SPEC §3.2 G1–G4)。「停用」字样不是企业名称(G4,状态另写),当本行没给名字。
        String impName = retiredMark(row) ? null : blankToNull(row.tenantName());
        Integer impTid = retiredMark(row) ? null : row.tenantId();
        if (m.getTenantManual() != null && m.getTenantManual() == 1) {
            // G2:这一段的租户是人工设定的 → 企业名称与租户 id 一格不动(标记随底子带进 M 行),册子不同才提示
            if (impName != null && !MeterTimeline.canon(impName).equals(MeterTimeline.canon(m.getTenantName()))
                    || impTid != null && !impTid.equals(m.getTenantId()))
                warns.add("表「" + m.getName() + "」本行企业名称「" + nd(impName) + "」与人工设定的「"
                    + nd(m.getTenantName()) + "」不同,已保留人工值");
        } else if (impName != null) {
            String before = m.getTenantName();
            m.setTenantName(impName);
            if (impTid != null) m.setTenantId(impTid);
            else if (m.getTenantId() != null && !MeterTimeline.canon(impName).equals(MeterTimeline.canon(before))) {
                // G3:换了名字却认不出是谁 → 这一段不再挂原来那一户,进「待核」;沿用老户 = 把新户的水电记到老户头上
                warns.add("表「" + m.getName() + "」本行企业名称「" + impName + "」与档案「" + nd(before)
                    + "」不同,且没认出是哪一户:这一段不再挂在原来那一户名下,进「待核」");
                m.setTenantId(null);
            }
            // 复合名共用表提示(2026-08-04 用户拍板:嘉荣、科文=101、102 两户共用一表,财务模板每月复现,
            // 须持续提示修改;账单派生前不单挂任何一户,拆分口径在两户档案 remark)。
            // 只报租户表(2026-09-25 用户:「园区生活水泵、消防控制室」「保安亭、路灯等」是公用表,报了是误报);
            // 归属用这一行带来的 ownership(前端 classifyOwnership 判的)
            if (impName.matches(".*[、/].*") && m.getTenantId() == null && "tenant".equals(blankToNull(row.ownership())))
                warns.add("表「" + m.getName() + "」企业名称「" + impName
                    + "」为复合名且未能唯一挂档:若系两户共用一表(如 嘉荣、科文=101、102),请在模板按户拆分,"
                    + "或按租户档案备注的拆分口径人工处理;账单派生前不会自动分摊");
        }
        // G1 空值不覆盖(护人工档案),但要出提示(2026-08-04 吉罗德案裁定:某月导入行企业名称为空而档案
        // 有名=名字来自其他月份,须让用户看见并自行决定清否;静默保留会造成「当月没有的名字出现在当月」)
        else if (blankToNull(row.tenantName()) == null && blankToNull(m.getTenantName()) != null)
            warns.add("表「" + m.getName() + "」本行企业名称为空,档案现为「" + m.getTenantName()
                + "」(来自其他月份导入),已保留;若该户当月尚未入住/已退租,请在档案页清空");
        if (impName == null && impTid != null && (m.getTenantManual() == null || m.getTenantManual() == 0))
            m.setTenantId(impTid);   // 只给了租户 id(v2 结构化行)
        // §G2 归属护栏(首审 P0):owner_manual=1 → ownership/building_id 两列一列不动。
        // 无条件回写曾把 V66 恢复的「招商中心电1/2 挂A座+share」每导一次推翻一次(area=招商中心→楼栋41、
        // meter_type=总电表→infra),A座分表Σ 因此少 1142.40 度。判定与人工值不同时点名落 warn,不静默。
        String impOwn = blankToNull(row.ownership());
        Integer impBld = row.buildingId();
        if (m.getOwnerManual() != null && m.getOwnerManual() == 1) {
            if ((impOwn != null && !impOwn.equals(m.getOwnership()))
                    || (impBld != null && !impBld.equals(m.getBuildingId())))
                warns.add("表「" + m.getName() + "」按册子推导是「" + ownLabel(impOwn, m.getKind()) + " · " + bldLabel(idx.bldNames, impBld)
                    + "」,与人工设定的「" + ownLabel(m.getOwnership(), m.getKind()) + " · " + bldLabel(idx.bldNames, m.getBuildingId())
                    + "」不同,已保留人工设定");
        } else {
            // 没人工锁住归属的表,原来这一支是**静默换楼**的 —— 导入结果里一个字没有。
            // 2026-09-23 南盛物流案:一份二期文件里「广聚运通 二车间一楼102室」那行的编码栏
            // 填的是 220605000144 —— 一期A座四楼428室南盛物流的码。L1 编码命中后本块无条件
            // 把那块表从一期A座搬到了二期二车间,屏上、结果里都不出声,
            // 直到半年后有人问「为什么一期的抄表里会出现二车间」。
            // owner_manual=1 那一支早就报了,这一支是缺的那半边。照旧行为仍然写回,只是不再静默。
            if (impBld != null && m.getBuildingId() != null && !impBld.equals(m.getBuildingId()))
                warns.add("表「" + m.getName() + "」按" + ("code".equals(by) ? "编码" : "位置")
                    + "认到了这一行,但这一行把它从「" + (area0 == null ? "(未填)" : area0)
                    + "」换到了「" + (blankToNull(m.getArea()) == null ? "(未填)" : m.getArea()) + "」,已按这一行更新。"
                    + "一块表不会自己换楼 —— 若本行编码拄错/拖填错,改掉的是另一块表的档案,请核对原册");
            if (impBld != null) m.setBuildingId(impBld);
            if (impOwn != null) m.setOwnership(impOwn);
        }
        if (blankToNull(row.meterType()) != null) m.setMeterType(row.meterType().trim());
        if (blankToNull(row.subName()) != null) m.setSubName(row.subName().trim());
        // 写回护栏(2026-08-03 水表重复编码案):行编码已被他表占用时不写回,只 warn——
        // 源册批量补码曾拖填/复制错(920620036/062/043 三对),无护栏时错码会静默污染档案再放大成对撞
        String c = rowCode(row);   // 「已拆」字样不是编码(G4)
        if (c != null && !codeNorm(c).equals(codeNorm(m.getCode()))) {   // 只差大小写 / 全半角 = 同一个编码,档案原样不动
            if (idx.codeTaken(row.kind(), c, row.ym()))
                warns.add("表「" + m.getName() + "」行编码 " + c + " 已被其他表占用,未写回档案(源表编码疑复制/拖填错,请核对原册)");
            else m.setCode(c);
        }
        // 倍率不在这里:G7 按「导入月是否不早于最新读数月」在 importRows 里定
        return warns;
    }

    // warn 文案里的空值占位(未给/未挂)
    private static String nd(Object v) { return v == null ? "(未给)" : String.valueOf(v); }
    // 归属展示名与前端 meterSplit.OWNERSHIP_LABEL / ownershipLabel 同一张表(infra 按表类分流),提示里不露英文代号
    private static final Map<String, String> OWN_LABEL = Map.of("tenant", "租户", "share", "园区公摊", "ops", "园区经营",
            "infra", "配电总表", "park", "园区自担", "register", "计度寄存器");
    private static String ownLabel(String o, String kind) {
        if (o == null) return "(未给)";
        if ("infra".equals(o) && "water".equals(kind)) return "供水总表";
        return OWN_LABEL.getOrDefault(o, o);
    }
    private static String bldLabel(Map<Integer, String> names, Integer id) {
        if (id == null) return "(未给楼栋)";
        String n = names.get(id);
        return n == null ? "楼栋#" + id : n;
    }

    private static void fill(MeterReading r, MeterReadingReq req) {
        r.setPrevTotal(req.prevTotal()); r.setCurrTotal(req.currTotal());
        r.setPrevSharp(req.prevSharp()); r.setPrevPeak(req.prevPeak());
        r.setPrevFlat(req.prevFlat()); r.setPrevValley(req.prevValley());
        r.setCurrSharp(req.currSharp()); r.setCurrPeak(req.currPeak());
        r.setCurrFlat(req.currFlat()); r.setCurrValley(req.currValley());
        r.setNote(blankToNull(req.note()));
    }

    // ── V74 位置结构化(§E8 三态):null=不指定(按 spot 解析) / ""=显式清除(置 NULL) / 有值=人工覆盖。
    // 解析规则与 V74 迁移、derive_pool_location.py 同源。二态时清空会被 spot 解析回来(§A.3「留空=跨层」落不住)。
    // spot 原文不动:导入身份键 addrKey 仍走 spot,本函数只影响展示/分组/池选表过滤。
    private static final Pattern FLOOR_RE = Pattern.compile("^(负|地下)?[一二三四五六七八九十0-9]+(楼|层)");
    private static final Pattern SIDE_RE = Pattern.compile("[东西南北]侧");
    private static final Pattern ROOM_RE = Pattern.compile("[0-9]+[A-Za-z]?室");
    private static final Pattern MULTI_ROOM_RE = Pattern.compile("[0-9]+室.*[0-9]+室|[0-9]+[-—–、][0-9]+室");

    static void applyLoc(MeterAt m, String floorLabel, String side, String roomNo) {
        String spot = m.getSpot() == null ? "" : m.getSpot().trim();
        m.setFloorLabel(floorLabel != null ? blankToNull(floorLabel) : parseFloor(spot));
        m.setSide(side != null ? blankToNull(side) : find(SIDE_RE, spot));
        m.setRoomNo(roomNo != null ? blankToNull(roomNo)
            : (MULTI_ROOM_RE.matcher(spot).find() ? null : find(ROOM_RE, spot)));   // 多房号/区间宁可不填
    }

    static String parseFloor(String spot) {
        if (spot == null || spot.isBlank()) return null;
        if (spot.startsWith("天面") || spot.startsWith("屋面") || spot.startsWith("楼顶")) return "天面";
        return find(FLOOR_RE, spot);   // 跨层(1-3楼/六、七楼)与非楼层(门口/车间)取不到 → null=跨层或不适用
    }

    private static String find(Pattern p, String s) {
        var mm = p.matcher(s);
        return mm.find() ? mm.group() : null;
    }

    private MeterDTO dtoOf(int id, long readingCount) {
        Meter m = meters.selectById(id);
        MeterTimelineService.Rows r = timeline.rows(id);
        MeterTimelineService.View v = new MeterTimelineService.View(MeterTimeline.LATEST,
            Map.of(id, r.assign()), Map.of(id, r.status()));
        return toDTO(MeterAt.of(m, v.assign(id), v.status(id), MeterTimeline.LATEST), v, readingCount, null, null);
    }

    // 站在 m.ym 的投影 + 两条段的起止与「本月有变化」(PLAN §1 MeterDTO)+ 本月册子已核(SPEC §10.3,book = 该月最近一笔)
    private static MeterDTO toDTO(MeterAt m, MeterTimelineService.View v, long readingCount, String buildingZone,
                                  MeterBookSeen book) {
        String ym = m.getYm();
        List<MeterAssign> aRows = v.assigns().getOrDefault(m.getId(), List.of());
        List<MeterStatus> sRows = v.statuses().getOrDefault(m.getId(), List.of());
        MeterAssign a = v.assign(m.getId());
        MeterStatus s = v.status(m.getId());
        int ai = aRows.indexOf(a), si = sRows.indexOf(s);
        boolean changed = a != null && ym.equals(a.getFromYm()) && ai > 0 && !MeterTimeline.diff(aRows.get(ai - 1), a).isEmpty()
            || s != null && ym.equals(s.getFromYm()) && si > 0 && !sRows.get(si - 1).getStatus().equals(s.getStatus());
        return new MeterDTO(m.getId(), m.getKind(), m.getZone(), m.getName(),
            m.getArea(), m.getSpot(), m.getTenantName(),
            m.getFloorLabel(), m.getSide(), m.getRoomNo(), m.getLocManual(),
            m.getTenantId(), m.getBuildingId(), m.getOwnership(), buildingZone, m.getOwnerManual(), m.getMeterType(),
            m.getDeviceType(), m.getContractId(),
            m.getSubName(), m.getCode(), m.getFactor(), m.getSuspect(),
            m.getSortNo(), readingCount,
            m.getStatus(), s == null ? null : s.getFromYm(),
            s == null ? null : lastMonth(MeterTimeline.until(sRows.stream().map(MeterStatus::getFromYm).toList(), s.getFromYm())),
            a == null ? null : a.getFromYm(),
            a == null ? null : lastMonth(MeterTimeline.until(aRows.stream().map(MeterAssign::getFromYm).toList(), a.getFromYm())),
            a == null ? null : a.getSrc(), changed, m.getTenantManual(),
            book != null, book == null ? null : book.getFileName(), book == null ? null : book.getSeenAt());
    }

    // 下一段起始月 → 本段最后一个月(含);链尾 null
    private static String lastMonth(String nextFrom) {
        return nextFrom == null ? null : java.time.YearMonth.parse(nextFrom).minusMonths(1).toString();
    }

    // 本批刚写的行放回内存链:同起始月替换,否则按起始月升序插入
    private static <T> void upsert(List<T> rows, T row, java.util.function.Function<T, String> from) {
        String f = from.apply(row);
        for (int i = 0; i < rows.size(); i++) {
            int c = from.apply(rows.get(i)).compareTo(f);
            if (c == 0) { rows.set(i, row); return; }
            if (c > 0) { rows.add(i, row); return; }
        }
        rows.add(row);
    }

    // ── 导入 / 撤销 / 批删的小件(METER-TIMELINE-SPEC §3.2 §3.5) ──

    // G4:企业名称写着「停用」、编码写着「已拆」—— 那是状态,不是名字和编码(实库有「已停用」「空调外机/已停用」)
    private static boolean retiredMark(MeterImportRequest.Row r) { return r.tenantName() != null && r.tenantName().contains("停用"); }
    private static boolean removedMark(MeterImportRequest.Row r) { return r.code() != null && r.code().contains("已拆"); }
    /** 这一行真正的编码:「已拆」字样不算编码,不拿去认表、不写回。 */
    private static String rowCode(MeterImportRequest.Row r) { return removedMark(r) ? null : blankToNull(r.code()); }

    // 「有读数」= 本月止任一格非空(上月止只有底数,算不上这个月抄到了)
    private static boolean hasReading(MeterImportRequest.Row r) {
        return java.util.stream.Stream.of(r.currTotal(), r.currSharp(), r.currPeak(), r.currFlat(), r.currValley())
            .anyMatch(Objects::nonNull);
    }

    // G6 判「读数不同」:十格读数逐格比(倍率、描述不算读数)
    private static boolean sameReading(MeterImportRequest.Row a, MeterImportRequest.Row b) {
        return numEq(a.prevTotal(), b.prevTotal()) && numEq(a.currTotal(), b.currTotal())
            && numEq(a.prevSharp(), b.prevSharp()) && numEq(a.currSharp(), b.currSharp())
            && numEq(a.prevPeak(), b.prevPeak()) && numEq(a.currPeak(), b.currPeak())
            && numEq(a.prevFlat(), b.prevFlat()) && numEq(a.currFlat(), b.currFlat())
            && numEq(a.prevValley(), b.prevValley()) && numEq(a.currValley(), b.currValley());
    }

    private static String next(String ym) { return java.time.YearMonth.parse(ym).plusMonths(1).toString(); }

    private static String statusOf(Map<Integer, List<MeterStatus>> rows, int id, String ym) {
        MeterStatus s = MeterTimeline.statusAt(rows.getOrDefault(id, List.of()), ym);
        return s == null ? null : s.getStatus();
    }

    static <T> List<String> fromsOf(List<T> rows, java.util.function.Function<T, String> from) {
        return rows.stream().map(from).toList();
    }

    /** 改 from 起那一段会波及的月份(内存链上算,口径同 MeterTimelineService.affectedMonths):冻结查询与需重算用。 */
    static List<String> span(List<String> froms, String from, String maxGen) {
        return MeterTimeline.affectedMonths(from, MeterTimeline.until(froms, from), maxGen);
    }

    // 本行要写的状态行(起始月 → 状态,升序),与现状相同的不写:
    //   G4 停用 → retired@M;G4 已拆 → 有读数 removed@M+1(拆表当月读数照收)、无读数 removed@M;
    //   M 月还不在册:新表自 M 起在册(自动建档 = 新装);老表只有本行有读数才补 active@M(G10 自愈,空行不算它在)
    static TreeMap<String, String> statusPlan(List<MeterStatus> rows, String ym, String g4, boolean read, boolean fresh) {
        TreeMap<String, String> out = new TreeMap<>();
        if ("retired".equals(g4)) out.put(ym, "retired");
        else {
            if (MeterTimeline.statusAt(rows, ym) == null && (fresh || read)) out.put(ym, "active");
            if ("removed".equals(g4)) out.put(read ? next(ym) : ym, "removed");
        }
        out.entrySet().removeIf(e -> {
            MeterStatus s = MeterTimeline.statusAt(rows, e.getKey());
            return s != null && e.getValue().equals(s.getStatus());
        });
        return out;
    }

    // 写 M 那一行归属并放回内存链。同月已有一行且值一格不差(来源、批次号除外)就不写:
    // 重导同一份册子不该在「档案变更」里刷一遍、也不该亮「需重算」,原行的来源与批次号照留。
    private void putAssign(List<MeterAssign> rows, MeterAssign want, MeterTimelineService.Ctx ctx) {
        MeterAssign old = find(rows, want.getFromYm(), MeterAssign::getFromYm);
        if (old != null) {
            MeterAssign x = new MeterAssign();
            org.springframework.beans.BeanUtils.copyProperties(want, x);
            x.setId(old.getId()); x.setSrc(old.getSrc()); x.setBatchId(old.getBatchId());
            if (x.equals(old)) return;
        }
        upsert(rows, timeline.writeAssign(want, ctx), MeterAssign::getFromYm);
    }

    // 按计划写状态行并放回内存链;changes 非空时每写一行记一条(新表传 null)
    private void putStatus(MeterAt m, List<MeterStatus> rows, Map<String, String> plan, MeterTimelineService.Ctx ctx,
                           List<MeterImportResultDTO.Change> changes) {
        plan.forEach((from, st) -> {
            MeterStatus was = MeterTimeline.statusAt(rows, from);
            upsert(rows, timeline.writeStatus(m.getId(), from, st, ctx), MeterStatus::getFromYm);
            if (changes != null) changes.add(new MeterImportResultDTO.Change(m.getId(), m.getName(), "status",
                was == null ? null : was.getStatus(), st, from,
                lastMonth(MeterTimeline.until(fromsOf(rows, MeterStatus::getFromYm), from))));
        });
    }

    // changes 里的值:tenant 取企业名称原文(没有名字才给 id),楼栋 / 合同给 id
    private static String valueOf(MeterAssign a, String field) {
        Object v = switch (field) {
            case "tenant" -> a.getTenantName() != null ? a.getTenantName() : a.getTenantId();
            case "buildingId" -> a.getBuildingId();
            case "ownership" -> a.getOwnership();
            case "area" -> a.getArea();
            case "spot" -> a.getSpot();
            case "floorLabel" -> a.getFloorLabel();
            case "side" -> a.getSide();
            case "roomNo" -> a.getRoomNo();
            case "subName" -> a.getSubName();
            case "contractId" -> a.getContractId();
            default -> null;
        };
        return v == null ? null : String.valueOf(v);
    }

    private static final Map<String, String> FIELD_LABEL = Map.ofEntries(
        Map.entry("tenant", "企业名称"), Map.entry("buildingId", "楼栋"), Map.entry("ownership", "归属"),
        Map.entry("area", "区域"), Map.entry("spot", "位置"), Map.entry("floorLabel", "楼层"), Map.entry("side", "方位"),
        Map.entry("roomNo", "房号"), Map.entry("subName", "表名"), Map.entry("contractId", "合同"));

    // G11 提示里「没有改的是哪几项」
    private static String fieldsText(List<String> diff, Map<String, String> plan) {
        List<String> out = new ArrayList<>(diff.stream().map(FIELD_LABEL::get).toList());
        if (!plan.isEmpty()) out.add("状态");
        return String.join("、", out);
    }

    // 冻结月的人话:「2024-02 含这块表的催缴单已导出」;多于三个月只列前三个再报总数
    static String frozenText(List<MeterTimelineService.Frozen> f) {
        String head = f.stream().limit(3).map(x -> x.ym() + " " + x.reason()).collect(Collectors.joining(";"));
        return f.size() > 3 ? head + " 等 " + f.size() + " 个月" : head;
    }

    // 拒绝消息里的清单:最多点名 10 处
    private static String cap(List<String> items) {
        String head = String.join(";", items.subList(0, Math.min(10, items.size())));
        return items.size() > 10 ? head + " 等 " + items.size() + " 处" : head;
    }

    // 表id → 该表最新读数月(G7 倍率写回的判据),一次分组取回
    private Map<Integer, String> lastReadingYms() {
        return readings.selectMaps(new QueryWrapper<MeterReading>().select("meter_id", "max(ym) ym").groupBy("meter_id"))
            .stream().collect(Collectors.toMap(x -> ((Number) x.get("meter_id")).intValue(), x -> (String) x.get("ym"),
                (a, b) -> a, java.util.HashMap::new));
    }

    private static <T> T find(List<T> rows, String from, java.util.function.Function<T, String> key) {
        return rows.stream().filter(r -> from.equals(key.apply(r))).findFirst().orElse(null);
    }

    // 撤销的模拟还原:链上 from 那一行换成 row(null = 删掉),保持升序
    private static <T> void swap(List<T> rows, String from, T row, java.util.function.Function<T, String> key) {
        rows.removeIf(r -> from.equals(key.apply(r)));
        if (row != null) upsert(rows, row, key);
    }

    private static MeterReadingDTO toReadingDTO(MeterReading r) {
        BigDecimal f = r.getFactorSnap();
        return new MeterReadingDTO(r.getId(), r.getMeterId(), r.getYm(),
            r.getPrevTotal(), r.getCurrTotal(),
            r.getPrevSharp(), r.getPrevPeak(), r.getPrevFlat(), r.getPrevValley(),
            r.getCurrSharp(), r.getCurrPeak(), r.getCurrFlat(), r.getCurrValley(),
            f,
            usage(r.getPrevTotal(), r.getCurrTotal(), f),
            usage(r.getPrevSharp(), r.getCurrSharp(), f),
            usage(r.getPrevPeak(), r.getCurrPeak(), f),
            usage(r.getPrevFlat(), r.getCurrFlat(), f),
            usage(r.getPrevValley(), r.getCurrValley(), f),
            r.getNote(), r.getSource());
    }
}

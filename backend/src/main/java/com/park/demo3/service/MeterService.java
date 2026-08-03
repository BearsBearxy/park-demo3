package com.park.demo3.service;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import com.park.demo3.dto.ImportError;
import com.park.demo3.dto.ImportLogReq;
import com.park.demo3.dto.MeterDeleteDTO;
import com.park.demo3.dto.MeterImportResultDTO;
import com.park.demo3.dto.MeterDTO;
import com.park.demo3.dto.MeterImportRequest;
import com.park.demo3.dto.MeterReadingDTO;
import com.park.demo3.dto.MeterReadingReq;
import com.park.demo3.dto.MeterReq;
import com.park.demo3.entity.AllocResult;
import com.park.demo3.entity.AllocRule;
import com.park.demo3.entity.AllocRuleMeter;
import com.park.demo3.entity.Meter;
import com.park.demo3.entity.MeterReading;
import com.park.demo3.mapper.AllocLossResultMapper;
import com.park.demo3.mapper.AllocPoolMeterResultMapper;
import com.park.demo3.mapper.AllocPoolResultMapper;
import com.park.demo3.mapper.AllocResultMapper;
import com.park.demo3.mapper.AllocRuleMapper;
import com.park.demo3.mapper.AllocRuleMeterMapper;
import com.park.demo3.mapper.MeterMapper;
import com.park.demo3.mapper.MeterReadingMapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

// 园区抄表(METER-SPEC)。P-A 刀:表档案+月度读数;分摊/损耗/账单是 P-B/P-C。
// factor_snap 快照口径:读数落库时快照当时表倍率,之后改倍率不回溯历史(同 PvMeterService price_snap)。
// 用量=(curr−prev)×factor_snap 派生绝不落库;漏抄/倒走由前端 meterLogic 派生只标不拦。
@Service
public class MeterService {
    private static final Pattern YM = Pattern.compile("\\d{4}-\\d{2}");
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
    private final ImportLogService importLogs;

    public MeterService(MeterMapper meters, MeterReadingMapper readings,
                        AllocPoolResultMapper poolResults, AllocPoolMeterResultMapper poolMeterResults,
                        AllocLossResultMapper lossResults, AllocResultMapper allocResults,
                        AllocRuleMeterMapper ruleMeters, AllocRuleMapper rules, ImportLogService importLogs) {
        this.meters = meters; this.readings = readings;
        this.poolResults = poolResults; this.poolMeterResults = poolMeterResults;
        this.lossResults = lossResults; this.allocResults = allocResults;
        this.ruleMeters = ruleMeters; this.rules = rules; this.importLogs = importLogs;
    }

    private static BigDecimal one(BigDecimal v) { return v == null ? BigDecimal.ONE : v; }
    private static String blankToNull(String s) { return s == null || s.isBlank() ? null : s.trim(); }
    private static boolean validKind(String s) { return "elec".equals(s) || "water".equals(s); }
    private static boolean validZone(String s) { return "p1".equals(s) || "p2".equals(s) || "dorm".equals(s); }
    private static boolean validOwnership(String s) {
        return "tenant".equals(s) || "share".equals(s) || "ops".equals(s) || "infra".equals(s)
            || "park".equals(s)        // V68 园区自担
            || "register".equals(s);   // V79 刀H §H2 非计费计度寄存器(反向有功/需量等),不进任何Σ
    }
    // 停用判定(V68,账期口径而非布尔):自 retired_ym 起(含当月)不计;NULL=在用。
    // public:MeterBindingService/AllocService 复用同一判定,唯一定义点。
    public static boolean retired(Meter m, String ym) {
        return m != null && m.getRetiredYm() != null && ym != null && ym.compareTo(m.getRetiredYm()) >= 0;
    }
    // 未启用判定(V87,与 retired 对称):active_from_ym 非空且账期早于它=尚不在服务中。
    public static boolean notYetActive(Meter m, String ym) {
        return m != null && m.getActiveFromYm() != null && ym != null && ym.compareTo(m.getActiveFromYm()) < 0;
    }
    // 退场判定(V88):自 removed_ym 起(含当月)不再显示——退租/拆表,历史月不受影响。
    public static boolean removedGone(Meter m, String ym) {
        return m != null && m.getRemovedYm() != null && ym != null && ym.compareTo(m.getRemovedYm()) >= 0;
    }
    // 账期内不在服务中(停用/未启用/已退场)——MeterBindingService/AllocService 统一走这一判定。
    public static boolean outOfService(Meter m, String ym) {
        return retired(m, ym) || notYetActive(m, ym) || removedGone(m, ym);
    }
    // 用量派生:缺任一读数=null(漏抄不硬算)。public:AllocService(P-B)复用同一公式(PB-ALLOCATION-SPEC §5)
    public static BigDecimal usage(BigDecimal prev, BigDecimal curr, BigDecimal factor) {
        return prev == null || curr == null ? null : curr.subtract(prev).multiply(one(factor));
    }

    // ── 表档案 ──
    public List<MeterDTO> list(String kind, String zone) {
        Map<Integer, Long> counts = readingCounts();
        return meters.selectFiltered(kind, zone).stream()
            .map(m -> toDTO(m, counts.getOrDefault(m.getId(), 0L))).toList();
    }

    // 全库 表id → 读数条数,一次分组取回(避免逐表 count N+1)。档案列表与 §H5「删完是否零读数」共用。
    private Map<Integer, Long> readingCounts() {
        return readings.selectMaps(
                new QueryWrapper<MeterReading>().select("meter_id", "count(*) cnt").groupBy("meter_id"))
            .stream().collect(Collectors.toMap(
                m -> ((Number) m.get("meter_id")).intValue(), m -> ((Number) m.get("cnt")).longValue()));
    }

    public MeterDTO create(MeterReq req) {
        String name = req.name().trim();
        if (meters.selectByKey(req.kind(), req.zone(), name) != null)
            throw new BizException(ResultCode.CONFLICT, "同区同类已有同名表");
        Meter m = new Meter();
        apply(m, req, name);
        m.setSortNo(meters.maxSortNo() + 1);
        meters.insert(m);
        return toDTO(meters.selectById(m.getId()), 0L);
    }

    public MeterDTO update(Integer id, MeterReq req) {
        Meter m = meters.selectById(id);
        if (m == null) throw new BizException(ResultCode.NOT_FOUND, "表不存在");
        String name = req.name().trim();
        Meter clash = meters.selectByKey(req.kind(), req.zone(), name);
        if (clash != null && !clash.getId().equals(id))
            throw new BizException(ResultCode.CONFLICT, "同区同类已有同名表");
        apply(m, req, name);   // 改倍率只影响之后新录读数,历史 factor_snap 不回溯
        meters.updateById(m);
        return toDTO(meters.selectById(id), readings.countByMeter(id));
    }

    public void delete(Integer id) {
        if (meters.selectById(id) == null) throw new BizException(ResultCode.NOT_FOUND, "表不存在");
        if (readings.countByMeter(id) > 0)
            throw new BizException(ResultCode.CONFLICT, "该表已有读数记录,不可删除(历史账要保留);退租请在档案页填「退场账期」,该月起不再显示");
        // 池绑定守卫:不先查直接 deleteById 会撞 fk_arm_meter,穿出来是句"违反完整性约束"——
        // 用户对着零读数的表和"有读数不可删"的按钮文案,只能误读成"一直显示有读数"(实测 1139)。
        List<Integer> ruleIds = ruleMeters.selectList(new QueryWrapper<AllocRuleMeter>().eq("meter_id", id))
            .stream().map(AllocRuleMeter::getRuleId).distinct().toList();
        if (!ruleIds.isEmpty()) {
            String names = rules.selectBatchIds(ruleIds).stream()
                .map(AllocRule::getName).collect(Collectors.joining("、"));
            throw new BizException(ResultCode.CONFLICT,
                "该表还绑定在公摊池「" + names + "」上,不可删除;请先到公共电核算把它从池成员中解绑再删");
        }
        meters.deleteById(id);
    }

    // ── 读数 ──
    public List<Integer> years() { return readings.selectDistinctYears(); }

    public List<MeterReadingDTO> readingsByYm(String ym) {
        requireYm(ym);
        return readings.selectByYm(ym).stream().map(MeterService::toReadingDTO).toList();
    }

    public List<MeterReadingDTO> readingsByMeter(Integer meterId) {
        if (meters.selectById(meterId) == null) throw new BizException(ResultCode.NOT_FOUND, "表不存在");
        return readings.selectByMeter(meterId).stream().map(MeterService::toReadingDTO).toList();
    }

    public MeterReadingDTO createReading(MeterReadingReq req) {
        Meter m = meters.selectById(req.meterId());
        if (m == null) throw new BizException(ResultCode.CONFLICT, "表不存在");
        if (readings.selectByMeterAndYm(m.getId(), req.ym()) != null)
            throw new BizException(ResultCode.CONFLICT, "该表该月已有读数");
        MeterReading r = new MeterReading();
        r.setMeterId(m.getId());
        r.setYm(req.ym());
        fill(r, req);
        r.setFactorSnap(one(m.getFactor()));   // 快照当时表倍率
        r.setSource("manual");
        readings.insert(r);
        return toReadingDTO(readings.selectById(r.getId()));
    }

    // PUT:改月份/读数/备注;meter 与 factor_snap 保持不变(快照语义)
    public MeterReadingDTO updateReading(Integer id, MeterReadingReq req) {
        MeterReading r = readings.selectById(id);
        if (r == null) throw new BizException(ResultCode.NOT_FOUND, "记录不存在");
        MeterReading clash = readings.selectByMeterAndYm(r.getMeterId(), req.ym());
        if (clash != null && !clash.getId().equals(id))
            throw new BizException(ResultCode.CONFLICT, "该表该月已有读数");
        r.setYm(req.ym());
        fill(r, req);
        r.setSource("manual");
        readings.updateById(r);
        return toReadingDTO(readings.selectById(id));
    }

    public void deleteReading(Integer id) {
        if (readings.selectById(id) == null) throw new BizException(ResultCode.NOT_FOUND, "记录不存在");
        readings.deleteById(id);
    }

    // ── 刀H §H5 按账期批量删除(用户 2026-07-31 点名:自己测试导入的 2023-10 那 80 条要能自己删掉) ──
    // 粒度选「账期」而不是「导入批次」:import_log 只记摘要、无行级关联,批次回滚根本做不到;
    // 而读数按 (表,ym) 唯一,账期是唯一无歧义、且正好对上用户诉求的批次单位。
    // 预览与实删走同一个方法(apply 开关),数字必然一致 —— 两条代码路径各算一遍迟早分叉。
    // 不可逆:二次确认由前端把预览数字复述一遍 + 让人手打账期串(§H5.4)。
    @Transactional
    public MeterDeleteDTO batchDelete(String ym, String kind, String zone,
                                      boolean cascade, boolean dropEmptyMeters, boolean apply) {
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
        java.util.Set<Integer> bound = ruleMeters.selectList(null).stream()
            .map(AllocRuleMeter::getMeterId).collect(Collectors.toSet());
        List<Integer> dropIds = dropEmptyMeters ? emptied.stream().filter(id -> !bound.contains(id)).toList() : List.of();
        List<String> blocked = dropEmptyMeters
            ? emptied.stream().filter(bound::contains).map(id -> label(scope.get(id))).toList() : List.of();
        List<String> dropped = dropIds.stream().map(id -> label(scope.get(id))).toList();
        // 派生快照(整月口径,见 MeterDeleteDTO 头注);manual 行保留并点名。
        // 用各 mapper 现成的 selectByYm 取行再数,不为一个计数另开 count 方法:一个月至多千余行。
        List<AllocResult> allocs = allocResults.selectByYm(ym);
        List<AllocResult> manual = allocs.stream().filter(r -> "manual".equals(r.getSource())).toList();
        int derived = cascade
            ? poolResults.selectByYm(ym).size() + poolMeterResults.selectByYm(ym).size()
                + lossResults.selectByYm(ym).size() + (allocs.size() - manual.size())
            : 0;
        MeterDeleteDTO dto = new MeterDeleteDTO(ym, hits.size(), meterIds.size(), emptied.size(), derived,
            manual.stream().map(r -> "租户#" + r.getTenantId() + " " + r.getFeeKey()).toList(),
            dropped, blocked);
        if (!apply) return dto;
        if (!readingIds.isEmpty()) readings.delete(new QueryWrapper<MeterReading>().in("id", readingIds));
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
    private static String label(Meter m) {
        return m == null ? "?" : m.getName() + "(id " + m.getId() + ")";
    }

    // ── 导入(METER-IMPORT-SPEC §3):表身份走分层匹配管道 编码 → 位置 → 标识 → 新建,
    //   命中唯一才算命中,多候选=歧义不落库;读数按 (表,ym) 先删后插覆盖(同批重复行=后行覆盖)。
    //   factor_snap = 行倍率(空则表档案倍率)。非法 kind/zone/ym、无从取名=行级错误跳过,不整批拦。 ──
    @Transactional
    public MeterImportResultDTO importRows(MeterImportRequest req) {
        List<Meter> all = meters.selectList(null);
        Index idx = new Index(all);
        // §E3.4 重复建档探针:ym → (表id → 本月读数),按需装载;本批新导入的行随写随进,同批重复也照抓
        Map<Integer, Meter> meterById = new java.util.HashMap<>();
        for (Meter m : all) meterById.put(m.getId(), m);
        Map<String, Map<Integer, MeterReading>> readByYm = new java.util.HashMap<>();
        List<ImportError> errors = new ArrayList<>();
        // 「只提示不打标/不跳行」清单(§F2 疑似重复建档、§F6 位置原文与人工楼层冲突):
        // 单列出来,末尾才并进 errors —— skipped 只数真正跳过的行
        List<ImportError> notices = new ArrayList<>();
        List<MeterImportResultDTO.Match> matches = new ArrayList<>();
        int imported = 0, sortNo = meters.maxSortNo();
        List<MeterImportRequest.Row> rows = req.rows();
        for (int i = 0; i < rows.size(); i++) {
            MeterImportRequest.Row row = rows.get(i);
            // 标识列可缺(用户新模板没有):合成 区域-位置-表名 → 编码 作标签(§3.1)
            String name = blankToNull(row.name()) != null ? row.name().trim() : fallbackName(row);
            if (name.isEmpty()) {
                errors.add(new ImportError(i, "", "无法识别表标识(标识/区域/位置/表名/编码全空)")); continue;
            }
            if (!validKind(row.kind()) || !validZone(row.zone())) {
                errors.add(new ImportError(i, name, "分区/类别非法(kind=elec|water,zone=p1|p2|dorm)")); continue;
            }
            if (row.ym() == null || !YM.matcher(row.ym()).matches()) {
                errors.add(new ImportError(i, name, "月份格式非法(应为 YYYY-MM)")); continue;
            }
            if (blankToNull(row.ownership()) != null && !validOwnership(row.ownership().trim())) {
                errors.add(new ImportError(i, name, "归属非法(tenant|share|ops|infra|park|register)")); continue;
            }
            Match hit = idx.resolve(row, name);
            if (hit.ambiguous != null) {   // 歧义不猜:猜错=把 A 表读数写进 B 表,不可逆无痕(§3.4)
                errors.add(new ImportError(i, name, hit.ambiguous)); continue;
            }
            Map<Integer, MeterReading> readOfYm = readByYm.computeIfAbsent(row.ym(), y ->
                readings.selectByYm(y).stream()
                    .collect(java.util.stream.Collectors.toMap(MeterReading::getMeterId, x -> x,
                        (a, b) -> a, java.util.HashMap::new)));
            Meter m = hit.meter;
            if (m == null) {   // 自动建档
                m = new Meter();
                m.setKind(row.kind()); m.setZone(row.zone()); m.setName(idx.freeName(row.kind(), row.zone(), name));
                m.setSortNo(++sortNo);
                applyDesc(m, row, idx);
                // §F2:自动只落 incomplete(四空=档案不全,照常入Σ,纯屏上提示)。
                // shadow 会把表踢出Σ 与池分母,不能由导入自动打 —— 见下面 dupeOf 的「只提示不打标」。
                m.setSuspect(archiveBlank(m) ? "incomplete" : null);
                m.setActiveFromYm(row.ym());   // V87:新表自首现月起显示(某月导入才出现的表不回溯早月)
                meters.insert(m);
                idx.add(m);
                Meter dup = dupeOf(m, row, readOfYm, meterById);
                if (dup != null) notices.add(new ImportError(i, name,
                    "疑似重复建档:与已有表「" + dup.getName() + "」(id " + dup.getId()
                        + ")同类同区同栋,且本月上月止/本月止/倍率三格全等。"
                        + "仅提示 —— 未标存疑、未影响任何计算;请在抄表屏档案页人工认对后再合并"));
                meterById.put(m.getId(), m);
            } else {           // 刷新描述字段(导入是档案的事实源;身份/人工资产字段不动,§3.2)
                idx.remove(m);
                // V87 自愈:更早月份的源册含此表=它更早就存在,启用账期自动放宽到该月
                if (m.getActiveFromYm() != null && row.ym().compareTo(m.getActiveFromYm()) < 0)
                    m.setActiveFromYm(row.ym());
                // §F6 位置人工标志 / §G2 归属人工标志:人工设定过的列导入不改,只提示
                for (String w : applyDesc(m, row, idx)) notices.add(new ImportError(i, name, w));
                meters.updateById(m);
                idx.add(m);
            }
            matches.add(new MeterImportResultDTO.Match(i, name, hit.by, m.getId()));
            readings.delete(new QueryWrapper<MeterReading>().eq("meter_id", m.getId()).eq("ym", row.ym()));
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
            readings.insert(r);
            readOfYm.put(m.getId(), r);
            imported++;
        }
        // 刀G 复核:提示走独立通道,不再 addAll 进 errors —— 混进去会被前端渲染成「N 行未导入」+警告三角。
        return new MeterImportResultDTO(imported, errors.size(), errors, matches, notices);
    }

    // §F2 疑似重复建档探针(判据与 V75 回填的 shadow 逐条同源):
    //   新表四空 + 对手方档案完整(area/code/tenant_name 至少一项非空)+ 同 (kind, zone, building_id)
    //   + 同月 prev + curr + 倍率三格全等 → 疑似同一块物理表的第二份档案。
    // 刀E 的旧判据只看「同月 curr_total 相等」,实测误报约三成(225 A4东侧总1 / 226 A4东侧总2 都 0.10、
    // 236 A4西侧消防灯 / 253 A6东侧消防灯 2024-05 都 184.69,全是真·不同表),撞上即打 shadow 当场踢出Σ。
    // 现在**只提示不打标**:返回疑似对应的真表,由人工认对,导入不动 suspect、不触发护栏。
    private static Meter dupeOf(Meter fresh, MeterImportRequest.Row row,
                                Map<Integer, MeterReading> readOfYm, Map<Integer, Meter> meterById) {
        if (!archiveBlank(fresh) || row.currTotal() == null) return null;
        BigDecimal factor = one(row.factor() == null ? fresh.getFactor() : row.factor());
        for (Map.Entry<Integer, MeterReading> e : readOfYm.entrySet()) {
            Meter o = meterById.get(e.getKey());
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
    private static boolean archiveBlank(Meter m) {
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
    private record Match(Meter meter, String by, String ambiguous) {}

    private static final class Index {
        final Map<String, List<Meter>> byCode = new java.util.HashMap<>();
        final Map<String, List<Meter>> byAddr = new java.util.HashMap<>();
        final Map<String, Meter> byName = new java.util.HashMap<>();

        Index(List<Meter> all) { all.forEach(this::add); }

        static String codeKey(String kind, String code) { return kind + "|" + code; }
        static String addrKey(String kind, String zone, String area, String spot, String sub) {
            return kind + "|" + zone + "|" + area + "|" + n(spot) + "|" + n(sub);
        }
        static String n(String s) { return s == null ? "" : s.trim(); }

        // 编码是否已被(其他)表占用:applyDesc 写回护栏用。调用时 m 自身已 remove 出索引,任何命中=他表。
        boolean codeTaken(String kind, String code) {
            List<Meter> l = byCode.get(codeKey(kind, code));
            return l != null && !l.isEmpty();
        }

        void add(Meter m) {
            byName.put(m.getKind() + "|" + m.getZone() + "|" + m.getName(), m);
            if (blankToNull(m.getCode()) != null)
                byCode.computeIfAbsent(codeKey(m.getKind(), m.getCode().trim()), k -> new ArrayList<>()).add(m);
            if (blankToNull(m.getArea()) != null)
                byAddr.computeIfAbsent(addrKey(m.getKind(), m.getZone(), m.getArea().trim(), m.getSpot(), m.getSubName()),
                    k -> new ArrayList<>()).add(m);
        }

        // applyDesc 会改 code/area/spot/sub_name → 改前先摘出索引,改后再 add(否则索引指向陈旧键)
        void remove(Meter m) {
            byName.values().remove(m);
            byCode.values().forEach(l -> l.remove(m));
            byAddr.values().forEach(l -> l.remove(m));
        }

        // 合成名撞了 uk_meter(kind,zone,name) 且不是同一块表 → 追加 #2/#3(§3.1)
        String freeName(String kind, String zone, String base) {
            String s = base.length() > 64 ? base.substring(0, 64) : base;
            for (int i = 2; byName.containsKey(kind + "|" + zone + "|" + s); i++)
                s = (base.length() > 60 ? base.substring(0, 60) : base) + "#" + i;
            return s;
        }

        Match resolve(MeterImportRequest.Row row, String name) {
            String code = blankToNull(row.code());
            String area = blankToNull(row.area());
            if (code != null) {
                Match m = pick(byCode.get(codeKey(row.kind(), code)), code, "code", null, row);
                if (m != null) return m;
            }
            if (area != null) {
                List<Meter> cands = byAddr.get(addrKey(row.kind(), row.zone(), area, row.spot(), row.subName()));
                Match m = pick(cands, code, "addr", name, row);
                if (m != null) return m;
            }
            Meter byN = byName.get(row.kind() + "|" + row.zone() + "|" + name);
            if (byN != null && !codeConflict(byN, code)) return new Match(byN, "name", null);
            return new Match(null, "new", null);
        }

        // 唯一命中→匹配;多候选→(依次用 name、企业名称再筛)仍多则歧义;0 候选→null 交给下一层
        private Match pick(List<Meter> cands, String code, String by, String name, MeterImportRequest.Row row) {
            if (cands == null || cands.isEmpty()) return null;
            List<Meter> ok = cands.stream().filter(m -> !codeConflict(m, code)).toList();
            if (ok.isEmpty()) return null;
            if (ok.size() == 1) return new Match(ok.get(0), by, null);
            if (name != null) {
                List<Meter> narrowed = ok.stream().filter(m -> name.equals(m.getName())).toList();
                if (narrowed.size() == 1) return new Match(narrowed.get(0), by, null);
            }
            // §J1 原册里区分「同区域+同楼层+同表号」那几行的恰恰是企业名称(D 列),故在抛歧义之前
            // 再按企业名称收窄一次。**精确相等**,不做包含/模糊 —— 模糊会把「许振虎」与「许振虎临电」
            // 这类近名并成一块表。导入行企业名称为空则跳过本层(不能拿空值去筛)。
            // ⚠ 只用于 by="addr"(位置歧义):位置同键是原册的正常形态(天面三行本就同 区域+楼层+表号),
            //   靠企业名称消歧是还原原册身份。而 by="code" 的编码重复是**档案脏**,必须报出来让人去重 ——
            //   用企业名称把它静默绑掉会掩盖问题,且重复编码的两块表未必同栋,可能跨楼栋写错表。
            String tenant = "addr".equals(by) ? blankToNull(row.tenantName()) : null;
            if (tenant != null) {
                String t = tenant.trim();
                List<Meter> narrowed = ok.stream().filter(m -> t.equals(n(m.getTenantName()))).toList();
                if (narrowed.size() == 1) return new Match(narrowed.get(0), by, null);
            }
            // §J2 出路要可执行:原册这些行本就无编码(补不了)、「天面」也是原册原文(细化即偏离账册),
            // 故按「本文件有没有标识列」分两种说法 —— 行的 name 为空 = 用户文件丢了原册首列。
            String tail;
            if ("code".equals(by)) {
                tail = "该编码在档案里重复,请先去重";
            } else if (blankToNull(row.name()) == null) {
                tail = "且本文件缺原册首列(标识名)、企业名称也未能区分。"
                    + "请用「下载模板」或「导出当月」得到的文件重导(两者都带标识列)";
            } else {
                tail = "标识名「" + n(name) + "」与企业名称「" + n(row.tenantName()) + "」都未能唯一命中,请核对档案";
            }
            return new Match(null, by, ("code".equals(by) ? "按编码" : "按位置") + "匹配到多块表(id "
                + ok.stream().map(m -> String.valueOf(m.getId())).collect(Collectors.joining("、")) + "),"
                + tail);
        }

        // 换表护栏:导入行有编码、候选也有编码且不同 → 是另一块物理表,不继承历史
        private static boolean codeConflict(Meter m, String code) {
            return code != null && blankToNull(m.getCode()) != null && !code.trim().equals(m.getCode().trim());
        }
    }

    // 无标识列时的标签(§3.1):区域-位置-表名 → 编码
    private static String fallbackName(MeterImportRequest.Row row) {
        String s = java.util.stream.Stream.of(row.area(), row.spot(), row.subName())
            .map(MeterService::blankToNull).filter(java.util.Objects::nonNull)
            .collect(Collectors.joining("-"));
        if (s.isEmpty()) s = blankToNull(row.code()) == null ? "" : row.code().trim();
        return s.length() > 64 ? s.substring(0, 64) : s;
    }

    private static void requireYm(String ym) {
        if (ym == null || !YM.matcher(ym).matches())
            throw new BizException(ResultCode.BAD_REQUEST, "月份格式非法(应为 YYYY-MM)");
    }

    private static void apply(Meter m, MeterReq req, String name) {
        // §F4 清标条件(必须在下面的 setter 覆盖之前取旧值):只有本次提交真的**补齐了识别信息**
        // ——区域/位置/编码/企业名称 至少一项由空变非空——才算人工认领了这份档案。
        // 抽屉里每个行内编辑都走全量 update,无条件清标 = 改个倍率就解除存疑、护栏当场失效、红徽标消失无从追溯。
        boolean identified = newlyFilled(m.getArea(), req.area()) || newlyFilled(m.getSpot(), req.spot())
            || newlyFilled(m.getCode(), req.code()) || newlyFilled(m.getTenantName(), req.tenantName());
        // §G2 归属人工标志的旧值(同样必须在 setter 覆盖之前取)
        boolean isUpdate = m.getId() != null;
        String ownBefore = m.getOwnership();
        Integer bldBefore = m.getBuildingId();
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
        // §G2 归属人工标志:人工 PUT 把 ownership / building_id 改成与库内不同的值 = 人工设定,
        // 之后导入不再回写这两列。**取舍**:归属的自动分类(classifyOwnership / buildingIdFor)住在前端
        // meterSplit.ts,后端复算不出「自动结果」,没法像 locDeviates 那样拿结果与自动值比;
        // 退而用「PUT 结果与库内旧值不同」判定 —— 抽屉恒带全量档案(reqOf),没动归属就不会误置 1。
        // 代价是单向闩(无「自动结果」可比 → 不会自动退回 0),要恢复自动跟随需人工清标,暂无入口。
        // 新建走 DB 默认 0(建档不是「改过」),故只在 update 路径判。
        if (isUpdate && (!java.util.Objects.equals(ownBefore, m.getOwnership())
                || !java.util.Objects.equals(bldBefore, m.getBuildingId())))
            m.setOwnerManual(1);
        m.setRetiredYm(blankToNull(req.retiredYm()));   // 空=撤销停用(FieldStrategy.ALWAYS 落库)
        m.setActiveFromYm(blankToNull(req.activeFromYm()));   // V87 启用账期,空=一直在册
        m.setRemovedYm(blankToNull(req.removedYm()));   // V88 退场账期,空=未退场
        // 补齐了识别信息=认领该档案,清「存疑」标(重新计入分表Σ 与池分母);否则原样保留。
        // 导入路径走 applyDesc 不经此处,标记也不会被导入刷掉。
        if (identified) m.setSuspect(null);
        // §G5 存疑标的显式人工入口(原先只能打不能解:配不上「补齐识别信息」这一条的表永远留着红徽标、
        // 永远不进Σ)。三态与 floorLabel/retiredYm 同款:不传(null)=保留原标,""=人工解除(认领为独立表),
        // 'shadow'/'incomplete'=人工打标。放在 identified 之后 = 显式值优先。
        // 痕迹:updated_at 由 MP INSERT_UPDATE 自动写,不另开审计表。
        if (req.suspect() != null) m.setSuspect(blankToNull(req.suspect()));
    }

    // 「由空变非空」——本次提交真的补齐了这一项(改成另一个非空值不算:那是订正,不是认领)
    private static boolean newlyFilled(String before, String after) {
        return blankToNull(before) == null && blankToNull(after) != null;
    }

    // §G5 loc_manual 位掩码(V78):bit0=楼层 / bit1=方位 / bit2=房号。
    // 选位掩码而不是三个 boolean 列:列不用加、DTO/ts 不用各多两格,判定与消费都是一次位与。
    private static final int LOC_FLOOR = 1, LOC_SIDE = 2, LOC_ROOM = 4;

    // 借一块临时 Meter 走同一个 applyLoc 拿「自动解析结果」,不把解析规则抄第二遍——抄了迟早分叉。
    private static Meter autoOf(String spot) {
        Meter auto = new Meter();
        auto.setSpot(spot);
        applyLoc(auto, null, null, null);
        return auto;
    }

    // §F6:逐列与「按 spot 自动解析」的结果比对,有出入的那一列置位
    // (§E8 显式清空成 NULL 而原文解析得出值,同样算人工设定)。
    private static int locManualMask(Meter m) {
        Meter auto = autoOf(m.getSpot());
        return (java.util.Objects.equals(auto.getFloorLabel(), m.getFloorLabel()) ? 0 : LOC_FLOOR)
            | (java.util.Objects.equals(auto.getSide(), m.getSide()) ? 0 : LOC_SIDE)
            | (java.util.Objects.equals(auto.getRoomNo(), m.getRoomNo()) ? 0 : LOC_ROOM);
    }

    // 导入行描述字段 → 档案(空值不清既有:真实文件同表在不同 sheet 详略不一)。
    // 返回 warn 文案清单(空=无提醒):§F6 位置冲突、§G2 归属冲突。
    private static List<String> applyDesc(Meter m, MeterImportRequest.Row row, Index idx) {
        List<String> warns = new ArrayList<>();
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
            Meter auto = autoOf(m.getSpot());
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
        // 空值不覆盖(护人工档案),但要出提示(2026-08-04 吉罗德案裁定:某月导入行企业名称为空而档案
        // 有名=名字来自其他月份,须让用户看见并自行决定清否;静默保留会造成「当月没有的名字出现在当月」)
        if (blankToNull(row.tenantName()) != null) {
            m.setTenantName(row.tenantName().trim());
            // 复合名共用表提示(2026-08-04 用户拍板:嘉荣、科文=101、102 两户共用一表,财务模板每月复现,
            // 须持续提示修改;账单派生前不单挂任何一户,拆分口径在两户档案 remark)
            if (row.tenantName().matches(".*[、/].*") && m.getTenantId() == null)
                warns.add("表「" + m.getName() + "」企业名称「" + row.tenantName().trim()
                    + "」为复合名且未能唯一挂档:若系两户共用一表(如 嘉荣、科文=101、102),请在模板按户拆分,"
                    + "或按租户档案备注的拆分口径人工处理;账单派生前不会自动分摊");
        }
        else if (blankToNull(m.getTenantName()) != null)
            warns.add("表「" + m.getName() + "」本行企业名称为空,档案现为「" + m.getTenantName()
                + "」(来自其他月份导入),已保留;若该户当月尚未入住/已退租,请在档案页清空");
        if (row.tenantId() != null) m.setTenantId(row.tenantId());
        // §G2 归属护栏(首审 P0):owner_manual=1 → ownership/building_id 两列一列不动。
        // 无条件回写曾把 V66 恢复的「招商中心电1/2 挂A座+share」每导一次推翻一次(area=招商中心→楼栋41、
        // meter_type=总电表→infra),A座分表Σ 因此少 1142.40 度。判定与人工值不同时点名落 warn,不静默。
        String impOwn = blankToNull(row.ownership());
        Integer impBld = row.buildingId();
        if (m.getOwnerManual() != null && m.getOwnerManual() == 1) {
            if ((impOwn != null && !impOwn.equals(m.getOwnership()))
                    || (impBld != null && !impBld.equals(m.getBuildingId())))
                warns.add("表「" + m.getName() + "」导入判定归属=" + nd(impOwn) + "/楼栋=" + nd(impBld)
                    + ",与人工设定的 " + nd(m.getOwnership()) + "/" + nd(m.getBuildingId()) + " 不同,已保留人工值");
        } else {
            if (impBld != null) m.setBuildingId(impBld);
            if (impOwn != null) m.setOwnership(impOwn);
        }
        if (blankToNull(row.meterType()) != null) m.setMeterType(row.meterType().trim());
        if (blankToNull(row.subName()) != null) m.setSubName(row.subName().trim());
        // 写回护栏(2026-08-03 水表重复编码案):行编码已被他表占用时不写回,只 warn——
        // 源册批量补码曾拖填/复制错(920620036/062/043 三对),无护栏时错码会静默污染档案再放大成对撞
        if (blankToNull(row.code()) != null) {
            String c = row.code().trim();
            if (!c.equals(m.getCode()) && idx.codeTaken(row.kind(), c))
                warns.add("表「" + m.getName() + "」行编码 " + c + " 已被其他表占用,未写回档案(源表编码疑复制/拖填错,请核对原册)");
            else m.setCode(c);
        }
        if (row.factor() != null) m.setFactor(row.factor());
        else if (m.getFactor() == null) m.setFactor(BigDecimal.ONE);
        return warns;
    }

    // warn 文案里的空值占位(未给/未挂)
    private static String nd(Object v) { return v == null ? "(未给)" : String.valueOf(v); }

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

    static void applyLoc(Meter m, String floorLabel, String side, String roomNo) {
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

    private static MeterDTO toDTO(Meter m, long readingCount) {
        return new MeterDTO(m.getId(), m.getKind(), m.getZone(), m.getName(),
            m.getArea(), m.getSpot(), m.getTenantName(),
            m.getFloorLabel(), m.getSide(), m.getRoomNo(), m.getLocManual(),
            m.getTenantId(), m.getBuildingId(), m.getOwnership(), m.getOwnerManual(), m.getMeterType(),
            m.getDeviceType(), m.getContractId(),
            m.getSubName(), m.getCode(), m.getFactor(), m.getRetiredYm(), m.getActiveFromYm(), m.getRemovedYm(), m.getSuspect(),
            m.getSortNo(), readingCount);
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

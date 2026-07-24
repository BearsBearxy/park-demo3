package com.park.demo3.service;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import com.park.demo3.dto.ImportError;
import com.park.demo3.dto.ImportResultDTO;
import com.park.demo3.dto.MeterDTO;
import com.park.demo3.dto.MeterImportRequest;
import com.park.demo3.dto.MeterReadingDTO;
import com.park.demo3.dto.MeterReadingReq;
import com.park.demo3.dto.MeterReq;
import com.park.demo3.entity.Meter;
import com.park.demo3.entity.MeterReading;
import com.park.demo3.mapper.MeterMapper;
import com.park.demo3.mapper.MeterReadingMapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
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

    public MeterService(MeterMapper meters, MeterReadingMapper readings) {
        this.meters = meters; this.readings = readings;
    }

    private static BigDecimal one(BigDecimal v) { return v == null ? BigDecimal.ONE : v; }
    private static String blankToNull(String s) { return s == null || s.isBlank() ? null : s.trim(); }
    private static boolean validKind(String s) { return "elec".equals(s) || "water".equals(s); }
    private static boolean validZone(String s) { return "p1".equals(s) || "p2".equals(s) || "dorm".equals(s); }
    private static boolean validOwnership(String s) {
        return "tenant".equals(s) || "share".equals(s) || "ops".equals(s) || "infra".equals(s);
    }
    // 用量派生:缺任一读数=null(漏抄不硬算)。public:AllocService(P-B)复用同一公式(PB-ALLOCATION-SPEC §5)
    public static BigDecimal usage(BigDecimal prev, BigDecimal curr, BigDecimal factor) {
        return prev == null || curr == null ? null : curr.subtract(prev).multiply(one(factor));
    }

    // ── 表档案 ──
    public List<MeterDTO> list(String kind, String zone) {
        // 读数条数一次分组取回(避免逐表 count N+1)
        Map<Integer, Long> counts = readings.selectMaps(
                new QueryWrapper<MeterReading>().select("meter_id", "count(*) cnt").groupBy("meter_id"))
            .stream().collect(Collectors.toMap(
                m -> ((Number) m.get("meter_id")).intValue(), m -> ((Number) m.get("cnt")).longValue()));
        return meters.selectFiltered(kind, zone).stream()
            .map(m -> toDTO(m, counts.getOrDefault(m.getId(), 0L))).toList();
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
            throw new BizException(ResultCode.CONFLICT, "该表已有读数记录,不可删除");
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

    // ── 导入:表按 (kind,zone,name) 建档或刷新描述字段,读数按 (表,ym) 先删后插覆盖(同批重复行=后行覆盖)。
    //   factor_snap = 行倍率(空则表档案倍率)。非法 kind/zone/ym、空 name=行级错误跳过,不整批拦。 ──
    @Transactional
    public ImportResultDTO importRows(MeterImportRequest req) {
        // 档案键 → 实体缓存:同批多月同表只建一次档
        Map<String, Meter> byKey = meters.selectList(null).stream()
            .collect(Collectors.toMap(MeterService::key, Function.identity()));
        List<ImportError> errors = new ArrayList<>();
        int imported = 0, sortNo = meters.maxSortNo();
        List<MeterImportRequest.Row> rows = req.rows();
        for (int i = 0; i < rows.size(); i++) {
            MeterImportRequest.Row row = rows.get(i);
            String name = row.name() == null ? "" : row.name().trim();
            if (name.isEmpty()) { errors.add(new ImportError(i, "", "表标识为空")); continue; }
            if (!validKind(row.kind()) || !validZone(row.zone())) {
                errors.add(new ImportError(i, name, "分区/类别非法(kind=elec|water,zone=p1|p2|dorm)")); continue;
            }
            if (row.ym() == null || !YM.matcher(row.ym()).matches()) {
                errors.add(new ImportError(i, name, "月份格式非法(应为 YYYY-MM)")); continue;
            }
            if (blankToNull(row.ownership()) != null && !validOwnership(row.ownership().trim())) {
                errors.add(new ImportError(i, name, "归属非法(tenant|share|ops|infra)")); continue;
            }
            Meter m = byKey.get(row.kind() + "|" + row.zone() + "|" + name);
            if (m == null) {   // 自动建档
                m = new Meter();
                m.setKind(row.kind()); m.setZone(row.zone()); m.setName(name);
                m.setSortNo(++sortNo);
                applyDesc(m, row);
                meters.insert(m);
                byKey.put(key(m), m);
            } else {           // 刷新描述字段(导入是档案的事实源)
                applyDesc(m, row);
                meters.updateById(m);
            }
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
            imported++;
        }
        return new ImportResultDTO(imported, errors.size(), errors);
    }

    // ── helpers ──
    private static String key(Meter m) { return m.getKind() + "|" + m.getZone() + "|" + m.getName(); }

    private static void requireYm(String ym) {
        if (ym == null || !YM.matcher(ym).matches())
            throw new BizException(ResultCode.BAD_REQUEST, "月份格式非法(应为 YYYY-MM)");
    }

    private static void apply(Meter m, MeterReq req, String name) {
        m.setKind(req.kind()); m.setZone(req.zone()); m.setName(name);
        m.setArea(blankToNull(req.area())); m.setSpot(blankToNull(req.spot()));
        m.setTenantName(blankToNull(req.tenantName())); m.setMeterType(blankToNull(req.meterType()));
        m.setTenantId(req.tenantId()); m.setBuildingId(req.buildingId());
        m.setOwnership(req.ownership() == null ? "share" : req.ownership());
        m.setSubName(blankToNull(req.subName())); m.setCode(blankToNull(req.code()));
        m.setFactor(one(req.factor()));
    }

    // 导入行描述字段 → 档案(空值不清既有:真实文件同表在不同 sheet 详略不一)
    private static void applyDesc(Meter m, MeterImportRequest.Row row) {
        if (blankToNull(row.area()) != null) m.setArea(row.area().trim());
        if (blankToNull(row.spot()) != null) m.setSpot(row.spot().trim());
        if (blankToNull(row.tenantName()) != null) m.setTenantName(row.tenantName().trim());
        if (row.tenantId() != null) m.setTenantId(row.tenantId());
        if (row.buildingId() != null) m.setBuildingId(row.buildingId());
        if (blankToNull(row.ownership()) != null) m.setOwnership(row.ownership().trim());
        if (blankToNull(row.meterType()) != null) m.setMeterType(row.meterType().trim());
        if (blankToNull(row.subName()) != null) m.setSubName(row.subName().trim());
        if (blankToNull(row.code()) != null) m.setCode(row.code().trim());
        if (row.factor() != null) m.setFactor(row.factor());
        else if (m.getFactor() == null) m.setFactor(BigDecimal.ONE);
    }

    private static void fill(MeterReading r, MeterReadingReq req) {
        r.setPrevTotal(req.prevTotal()); r.setCurrTotal(req.currTotal());
        r.setPrevSharp(req.prevSharp()); r.setPrevPeak(req.prevPeak());
        r.setPrevFlat(req.prevFlat()); r.setPrevValley(req.prevValley());
        r.setCurrSharp(req.currSharp()); r.setCurrPeak(req.currPeak());
        r.setCurrFlat(req.currFlat()); r.setCurrValley(req.currValley());
        r.setNote(blankToNull(req.note()));
    }

    private static MeterDTO toDTO(Meter m, long readingCount) {
        return new MeterDTO(m.getId(), m.getKind(), m.getZone(), m.getName(),
            m.getArea(), m.getSpot(), m.getTenantName(),
            m.getTenantId(), m.getBuildingId(), m.getOwnership(), m.getMeterType(),
            m.getSubName(), m.getCode(), m.getFactor(), m.getSortNo(), readingCount);
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

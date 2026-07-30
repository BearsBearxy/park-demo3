package com.park.demo3.service;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import com.park.demo3.dto.ImportError;
import com.park.demo3.dto.MeterImportResultDTO;
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
        return "tenant".equals(s) || "share".equals(s) || "ops".equals(s) || "infra".equals(s)
            || "park".equals(s);   // V68 园区自担
    }
    // 停用判定(V68,账期口径而非布尔):自 retired_ym 起(含当月)不计;NULL=在用。
    // public:MeterBindingService/AllocService 复用同一判定,唯一定义点。
    public static boolean retired(Meter m, String ym) {
        return m != null && m.getRetiredYm() != null && ym != null && ym.compareTo(m.getRetiredYm()) >= 0;
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

    // ── 导入(METER-IMPORT-SPEC §3):表身份走分层匹配管道 编码 → 位置 → 标识 → 新建,
    //   命中唯一才算命中,多候选=歧义不落库;读数按 (表,ym) 先删后插覆盖(同批重复行=后行覆盖)。
    //   factor_snap = 行倍率(空则表档案倍率)。非法 kind/zone/ym、无从取名=行级错误跳过,不整批拦。 ──
    @Transactional
    public MeterImportResultDTO importRows(MeterImportRequest req) {
        Index idx = new Index(meters.selectList(null));
        List<ImportError> errors = new ArrayList<>();
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
                errors.add(new ImportError(i, name, "归属非法(tenant|share|ops|infra)")); continue;
            }
            Match hit = idx.resolve(row, name);
            if (hit.ambiguous != null) {   // 歧义不猜:猜错=把 A 表读数写进 B 表,不可逆无痕(§3.4)
                errors.add(new ImportError(i, name, hit.ambiguous)); continue;
            }
            Meter m = hit.meter;
            if (m == null) {   // 自动建档
                m = new Meter();
                m.setKind(row.kind()); m.setZone(row.zone()); m.setName(idx.freeName(row.kind(), row.zone(), name));
                m.setSortNo(++sortNo);
                applyDesc(m, row);
                meters.insert(m);
                idx.add(m);
            } else {           // 刷新描述字段(导入是档案的事实源;身份/人工资产字段不动,§3.2)
                idx.remove(m);
                applyDesc(m, row);
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
            imported++;
        }
        return new MeterImportResultDTO(imported, errors.size(), errors, matches);
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
                Match m = pick(byCode.get(codeKey(row.kind(), code)), code, "code", null);
                if (m != null) return m;
            }
            if (area != null) {
                List<Meter> cands = byAddr.get(addrKey(row.kind(), row.zone(), area, row.spot(), row.subName()));
                Match m = pick(cands, code, "addr", name);
                if (m != null) return m;
            }
            Meter byN = byName.get(row.kind() + "|" + row.zone() + "|" + name);
            if (byN != null && !codeConflict(byN, code)) return new Match(byN, "name", null);
            return new Match(null, "new", null);
        }

        // 唯一命中→匹配;多候选→(可用 name 再筛一次)仍多则歧义;0 候选→null 交给下一层
        private Match pick(List<Meter> cands, String code, String by, String name) {
            if (cands == null || cands.isEmpty()) return null;
            List<Meter> ok = cands.stream().filter(m -> !codeConflict(m, code)).toList();
            if (ok.isEmpty()) return null;
            if (ok.size() == 1) return new Match(ok.get(0), by, null);
            if (name != null) {
                List<Meter> narrowed = ok.stream().filter(m -> name.equals(m.getName())).toList();
                if (narrowed.size() == 1) return new Match(narrowed.get(0), by, null);
            }
            // 报出层级:编码歧义要去重编码,位置歧义要细化「位置」列(实测两类都真实存在)
            return new Match(null, by, ("code".equals(by) ? "按编码" : "按位置") + "匹配到多块表(id "
                + ok.stream().map(m -> String.valueOf(m.getId())).collect(Collectors.joining("、")) + "),"
                + ("code".equals(by) ? "该编码在档案里重复,请先去重" : "请补表编码或细化位置后重导"));
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
        m.setKind(req.kind()); m.setZone(req.zone()); m.setName(name);
        m.setArea(blankToNull(req.area())); m.setSpot(blankToNull(req.spot()));
        m.setTenantName(blankToNull(req.tenantName())); m.setMeterType(blankToNull(req.meterType()));
        m.setDeviceType(req.deviceType());   // 已 @Pattern 白名单;contract_id 不在 apply 内(专用 /bind 写)
        m.setTenantId(req.tenantId()); m.setBuildingId(req.buildingId());
        m.setOwnership(req.ownership() == null ? "share" : req.ownership());
        m.setSubName(blankToNull(req.subName())); m.setCode(blankToNull(req.code()));
        m.setFactor(one(req.factor()));
        m.setRetiredYm(blankToNull(req.retiredYm()));   // 空=撤销停用(FieldStrategy.ALWAYS 落库)
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
            m.getDeviceType(), m.getContractId(),
            m.getSubName(), m.getCode(), m.getFactor(), m.getRetiredYm(), m.getSortNo(), readingCount);
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

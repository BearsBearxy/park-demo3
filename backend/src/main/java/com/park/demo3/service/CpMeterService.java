package com.park.demo3.service;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import com.park.demo3.dto.CpMeterImportRequest;
import com.park.demo3.dto.CpPowerUsageDTO;
import com.park.demo3.dto.CpPowerUsageReq;
import com.park.demo3.dto.CpReadingDTO;
import com.park.demo3.dto.CpReadingReq;
import com.park.demo3.dto.CpSimulateResultDTO;
import com.park.demo3.dto.CpStationDTO;
import com.park.demo3.dto.CpStationReq;
import com.park.demo3.dto.ImportError;
import com.park.demo3.dto.ImportResultDTO;
import com.park.demo3.entity.ChargingRecord;
import com.park.demo3.entity.CpPowerUsage;
import com.park.demo3.entity.CpReading;
import com.park.demo3.entity.CpStation;
import com.park.demo3.mapper.ChargingRecordMapper;
import com.park.demo3.mapper.CpPowerUsageMapper;
import com.park.demo3.mapper.CpReadingMapper;
import com.park.demo3.mapper.CpStationMapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

// 充电桩分桩明细(CP-METER-SPEC)。与附表7/8(ChargingService)完全独立,零共享零改动——功能门只是入口分叉。
// 三金额(充电量/手续费/收益)全手填(从平台对账单抄,无 price_snap/自动换算);
// 用电损耗 = meter_kwh − Σ该运营商该类型桩当月充电量,读时派生不落库(本刀核心口径,IT 锁死)。
@Service
public class CpMeterService {
    private final CpStationMapper stations;
    private final CpReadingMapper readings;
    private final CpPowerUsageMapper usages;
    private final ChargingRecordMapper chargingRecords;   // 附表7/8 真实月度汇总,模拟填充只读

    public CpMeterService(CpStationMapper stations, CpReadingMapper readings, CpPowerUsageMapper usages,
                          ChargingRecordMapper chargingRecords) {
        this.stations = stations; this.readings = readings; this.usages = usages;
        this.chargingRecords = chargingRecords;
    }

    private static BigDecimal nz(BigDecimal v) { return v == null ? BigDecimal.ZERO : v; }
    private static BigDecimal r2(BigDecimal v) { return nz(v).setScale(2, RoundingMode.HALF_UP); }
    private static String blankToNull(String s) { return s == null || s.isBlank() ? null : s; }

    private static LocalDate parseDate(String s) {
        if (s == null || s.isBlank()) return null;
        try { return LocalDate.parse(s.trim()); } catch (DateTimeParseException e) { return null; }
    }

    // 电表行 key:运营商×类型(record 自带 equals/hashCode)
    private record Combo(String operator, String vehicleType) {}

    // ── 桩 CRUD ──
    public List<CpStationDTO> stationList() {
        return stations.selectAllSorted().stream().map(CpMeterService::toStationDTO).toList();
    }

    public CpStationDTO createStation(CpStationReq req) {
        String name = req.name().trim();
        if (stations.selectCount(new QueryWrapper<CpStation>().eq("name", name)) > 0)
            throw new BizException(ResultCode.CONFLICT, "充电桩名称已存在");
        CpStation s = new CpStation();
        s.setName(name);
        s.setOperator(req.operator().trim());
        s.setVehicleType(req.vehicleType());
        s.setSortNo(stations.maxSortNo() + 1);   // 新桩追加末尾
        stations.insert(s);
        return toStationDTO(stations.selectById(s.getId()));
    }

    @Transactional
    public CpStationDTO updateStation(Integer id, CpStationReq req) {
        CpStation s = stations.selectById(id);
        if (s == null) throw new BizException(ResultCode.NOT_FOUND, "充电桩不存在");
        String name = req.name().trim();
        if (stations.selectCount(new QueryWrapper<CpStation>().eq("name", name).ne("id", id)) > 0)
            throw new BizException(ResultCode.CONFLICT, "充电桩名称已存在");
        Combo oldKey = new Combo(s.getOperator(), s.getVehicleType());
        s.setName(name);
        s.setOperator(req.operator().trim());
        s.setVehicleType(req.vehicleType());
        stations.updateById(s);
        Combo newKey = new Combo(s.getOperator(), s.getVehicleType());
        if (!oldKey.equals(newKey)) migrateOrphanUsages(oldKey, newKey);
        return toStationDTO(stations.selectById(id));
    }

    // P0-1 运营商改名联动:旧 (operator, vehicleType) 已无任何桩=改名语义,历史电表行整体迁移到新键,
    // 消灭孤儿行;旧键仍有其他桩=重新归属语义,电表行留在旧键不动(旧键仍有效)。
    // 目标键已存在同期行时:保留目标行、删除源行——目标键是用户现在认的口径。
    private void migrateOrphanUsages(Combo oldKey, Combo newKey) {
        if (stations.selectCount(new QueryWrapper<CpStation>()
                .eq("operator", oldKey.operator()).eq("vehicle_type", oldKey.vehicleType())) > 0) return;
        for (CpPowerUsage u : usages.selectList(new QueryWrapper<CpPowerUsage>()
                .eq("operator", oldKey.operator()).eq("vehicle_type", oldKey.vehicleType()))) {
            if (usages.selectByKey(newKey.operator(), newKey.vehicleType(), u.getPeriod()) != null) {
                usages.deleteById(u.getId());   // 同期冲突:目标行保留,源行删除
            } else {
                u.setOperator(newKey.operator());
                u.setVehicleType(newKey.vehicleType());
                usages.updateById(u);
            }
        }
    }

    public void deleteStation(Integer id) {
        if (stations.selectById(id) == null) throw new BizException(ResultCode.NOT_FOUND, "充电桩不存在");
        if (readings.countByStation(id) > 0)
            throw new BizException(ResultCode.CONFLICT, "该充电桩已有充电记录,不可删除");
        stations.deleteById(id);
    }

    // ── 充电记录 ──
    // 年份数据驱动:有记录的年份升序,空表=[](前端年选择器数据源)
    public List<Integer> years() { return readings.selectDistinctYears(); }

    public List<CpReadingDTO> readingList(int year, Integer month, Integer stationId) {   // month null=全年
        Map<Integer, String> names = stations.selectList(null).stream()
            .collect(Collectors.toMap(CpStation::getId, CpStation::getName));
        return readings.selectByMonth(year, month, stationId).stream()
            .map(r -> toReadingDTO(r, names.get(r.getStationId()))).toList();
    }

    public CpReadingDTO createReading(CpReadingReq req) {
        CpStation station = stations.selectById(req.stationId());
        if (station == null) throw new BizException(ResultCode.CONFLICT, "充电桩不存在");
        LocalDate date = requireDate(req.readDate());
        if (readings.selectByStationAndDate(station.getId(), date) != null)
            throw new BizException(ResultCode.CONFLICT, "该充电桩该日期已有记录");
        CpReading r = new CpReading();
        r.setStationId(station.getId());
        r.setReadDate(date);
        fillAmounts(r, req.chargeKwh(), req.fee(), req.revenue(), req.note());
        r.setSource("manual");
        readings.insert(r);
        return toReadingDTO(readings.selectById(r.getId()), station.getName());
    }

    // PUT:改日期/三金额/备注;station 不可改
    public CpReadingDTO updateReading(Integer id, CpReadingReq req) {
        CpReading r = readings.selectById(id);
        if (r == null) throw new BizException(ResultCode.NOT_FOUND, "记录不存在");
        LocalDate date = requireDate(req.readDate());
        CpReading clash = readings.selectByStationAndDate(r.getStationId(), date);
        if (clash != null && !clash.getId().equals(id))
            throw new BizException(ResultCode.CONFLICT, "该充电桩该日期已有记录");
        r.setReadDate(date);
        fillAmounts(r, req.chargeKwh(), req.fee(), req.revenue(), req.note());
        r.setSource("manual");   // 手工改写统一 manual:覆盖 simulated 即「真实替换模拟」,再模拟不回写(同 ElecCostService.upsertEntry 口径)
        readings.updateById(r);
        CpStation station = stations.selectById(r.getStationId());
        return toReadingDTO(readings.selectById(id), station == null ? null : station.getName());
    }

    public void deleteReading(Integer id) {
        if (readings.selectById(id) == null) throw new BizException(ResultCode.NOT_FOUND, "记录不存在");
        readings.deleteById(id);
    }

    // ── 电表与损耗:行集合 = 桩库(运营商,类型)去重(按桩 sort 序) ∪ 该月已录电表行(运营商改名后的孤儿行仍可见);
    //    month null=全年(各月并集,行含 month,ENERGY-ANALYSIS §4)——整年一次取数,内存按月构行,单月构行逻辑同一实现 ──
    public List<CpPowerUsageDTO> powerUsageList(int year, Integer month) {
        List<CpStation> all = stations.selectAllSorted();
        Map<Integer, CpStation> byId = all.stream()
            .collect(Collectors.toMap(CpStation::getId, Function.identity()));
        List<CpReading> reads = readings.selectByMonth(year, month, null);
        List<CpPowerUsage> uses = month == null ? usages.selectByYear(year)
            : usages.selectByPeriod(LocalDate.of(year, month, 1));
        List<CpPowerUsageDTO> out = new ArrayList<>();
        for (int m = month == null ? 1 : month, end = month == null ? 12 : month; m <= end; m++) {
            final int cur = m;
            monthRows(cur, all, byId,
                reads.stream().filter(r -> r.getReadDate().getMonthValue() == cur).toList(),
                uses.stream().filter(u -> u.getPeriod().getMonthValue() == cur).toList(), out);
        }
        return out;
    }

    // 单月构行(单月与年视角唯一实现,口径一致由此保证)
    private void monthRows(int month, List<CpStation> all, Map<Integer, CpStation> byId,
                           List<CpReading> reads, List<CpPowerUsage> uses, List<CpPowerUsageDTO> out) {
        Map<Combo, BigDecimal> sums = new HashMap<>();   // Σ该运营商该类型桩当月充电量
        for (CpReading r : reads) {
            CpStation s = byId.get(r.getStationId());
            if (s != null) sums.merge(new Combo(s.getOperator(), s.getVehicleType()), nz(r.getChargeKwh()), BigDecimal::add);
        }
        LinkedHashMap<Combo, CpPowerUsage> rows = new LinkedHashMap<>();
        for (CpStation s : all) rows.putIfAbsent(new Combo(s.getOperator(), s.getVehicleType()), null);
        for (CpPowerUsage u : uses)
            rows.put(new Combo(u.getOperator(), u.getVehicleType()), u);
        for (Map.Entry<Combo, CpPowerUsage> e : rows.entrySet()) {
            Combo c = e.getKey();
            CpPowerUsage u = e.getValue();
            BigDecimal sum = r2(sums.getOrDefault(c, BigDecimal.ZERO));
            BigDecimal meter = u == null ? null : r2(u.getMeterKwh());
            // 损耗读时派生:未录电表=null;录了=meter−Σ(可为负,前端黄警示)
            out.add(new CpPowerUsageDTO(u == null ? null : u.getId(), c.operator(), c.vehicleType(),
                meter, sum, meter == null ? null : meter.subtract(sum), u == null ? null : u.getNote(), month));
        }
    }

    // upsert:uk(运营商,类型,月)有则改无则插;返回带派生损耗的行
    public CpPowerUsageDTO upsertPowerUsage(CpPowerUsageReq req) {
        LocalDate period = LocalDate.of(req.year(), req.month(), 1);
        String operator = req.operator().trim();
        CpPowerUsage u = usages.selectByKey(operator, req.vehicleType(), period);
        if (u == null) {
            u = new CpPowerUsage();
            u.setOperator(operator);
            u.setVehicleType(req.vehicleType());
            u.setPeriod(period);
        }
        u.setMeterKwh(r2(req.meterKwh()));
        u.setNote(blankToNull(req.note()));
        if (u.getId() == null) usages.insert(u); else usages.updateById(u);
        // ponytail: 复用 powerUsageList 派生损耗,单一口径;每月行数个位数无性能顾虑
        return powerUsageList(req.year(), req.month()).stream()
            .filter(d -> operator.equals(d.operator()) && req.vehicleType().equals(d.vehicleType()))
            .findFirst().orElseThrow();
    }

    // ── 模拟填充(同 ElecCostService.simulate 模式):按附表7/8 真实月度汇总(charging_record)推导分桩明细。
    //    推导:s8 dingding→桩「叮叮充」、dianxin→「电信」;s7 wancheng→「万城万」、xiaoju 按 60/40 拆「快充1/慢充1」(假设比例)。
    //    字段:charge_kwh=kwh×比例、revenue=fee(手续费及服务费=园区充电收入口径)、fee=revenue×5%(平台通道费假设);记该月末日一条。
    //    幂等:只写空位与既有 simulated 行(值变才更新),绝不覆盖 manual/import;(桩,日)槽被占即跳过;
    //    缺桩(被用户改名/删除)记 skipped 不报错。电表行:每运营商×类型×月 meter_kwh=当月Σcharge_kwh×1.05(5% 损耗假设);
    //    cp_power_usage 无 source 列 → 只插空位、已有行不论谁写一律不动(同 ElecCostService 电价参数模式)。 ──
    private record Split(String station, BigDecimal ratio) {}
    private static final Map<String, List<Split>> SIM_TARGETS = Map.of(
        "wancheng", List.of(new Split("万城万", BigDecimal.ONE)),
        "xiaoju", List.of(new Split("快充1", new BigDecimal("0.6")), new Split("慢充1", new BigDecimal("0.4"))),
        "dingding", List.of(new Split("叮叮充", BigDecimal.ONE)),
        "dianxin", List.of(new Split("电信", BigDecimal.ONE)));
    private static final BigDecimal FEE_RATE = new BigDecimal("0.05");     // 平台通道费假设
    private static final BigDecimal LOSS_FACTOR = new BigDecimal("1.05"); // 电表=Σ充电量×1.05(5% 损耗假设)

    @Transactional
    public CpSimulateResultDTO simulate(int year) {
        Map<String, CpStation> byName = stations.selectList(null).stream()
            .collect(Collectors.toMap(s -> s.getName().trim(), Function.identity(), (a, b) -> a));
        int[] c = new int[2];   // [0]=filled, [1]=skipped
        // 电表推导底数:运营商×类型 → 月首日 → Σ本次推导的 charge_kwh(拆分行合回运营商口径)
        Map<Combo, Map<LocalDate, BigDecimal>> power = new LinkedHashMap<>();

        List<ChargingRecord> src = new ArrayList<>(chargingRecords.selectByScheduleAndYear(7, year));
        src.addAll(chargingRecords.selectByScheduleAndYear(8, year));
        for (ChargingRecord rec : src) {
            List<Split> targets = SIM_TARGETS.get(rec.getCat());
            if (targets == null) continue;   // 未知 cat(用户新增运营商)无推导规则,静默跳过
            LocalDate month1 = LocalDate.parse(rec.getAcctMonth() + "-01");
            LocalDate date = month1.withDayOfMonth(month1.lengthOfMonth());   // 月末日一条
            for (Split t : targets) {
                CpStation st = byName.get(t.station());
                if (st == null) { c[1]++; continue; }   // 缺桩(被改名/删除)→ skipped 不报错
                BigDecimal charge = r2(nz(rec.getKwh()).multiply(t.ratio()));
                BigDecimal revenue = r2(nz(rec.getFee()).multiply(t.ratio()));
                BigDecimal fee = r2(revenue.multiply(FEE_RATE));
                String note = "模拟:附表" + rec.getScheduleNo() + " " + rec.getCat() + " " + rec.getAcctMonth()
                    + (targets.size() > 1 ? ";60/40拆分(假设)" : "") + ";通道费=收益×5%(假设)";
                upsertSimReading(st, date, charge, fee, revenue, note, c);
                power.computeIfAbsent(new Combo(st.getOperator(), st.getVehicleType()), k -> new LinkedHashMap<>())
                    .merge(month1, charge, BigDecimal::add);
            }
        }

        for (Map.Entry<Combo, Map<LocalDate, BigDecimal>> e : power.entrySet()) {
            for (Map.Entry<LocalDate, BigDecimal> m : e.getValue().entrySet()) {
                if (usages.selectByKey(e.getKey().operator(), e.getKey().vehicleType(), m.getKey()) != null) {
                    c[1]++; continue;   // 已有电表行(不论谁写)一律不动
                }
                CpPowerUsage u = new CpPowerUsage();
                u.setOperator(e.getKey().operator());
                u.setVehicleType(e.getKey().vehicleType());
                u.setPeriod(m.getKey());
                u.setMeterKwh(r2(m.getValue().multiply(LOSS_FACTOR)));
                u.setNote("模拟:Σ充电量×1.05(5% 损耗假设)");
                usages.insert(u);
                c[0]++;
            }
        }
        return new CpSimulateResultDTO(c[0], c[1]);
    }

    // 模拟 upsert:空位插 simulated;既有 simulated 值有变才改(幂等第二跑 filled=0);manual/import 绝不覆盖
    private void upsertSimReading(CpStation st, LocalDate date, BigDecimal charge, BigDecimal fee,
                                  BigDecimal revenue, String note, int[] c) {
        CpReading existing = readings.selectByStationAndDate(st.getId(), date);
        if (existing != null && !"simulated".equals(existing.getSource())) { c[1]++; return; }
        if (existing != null && r2(existing.getChargeKwh()).compareTo(charge) == 0
                && r2(existing.getFee()).compareTo(fee) == 0
                && r2(existing.getRevenue()).compareTo(revenue) == 0) { c[1]++; return; }
        CpReading r = existing == null ? new CpReading() : existing;
        r.setStationId(st.getId());
        r.setReadDate(date);
        r.setChargeKwh(charge);
        r.setFee(fee);
        r.setRevenue(revenue);
        r.setNote(note);
        r.setSource("simulated");
        if (existing == null) readings.insert(r); else readings.updateById(r);
        c[0]++;
    }

    // ── 导入:行自带 station(桩名)+readDate。(桩,日)幂等 upsert=先删同(桩,日)再插,重导修正即覆盖。
    //   未知桩名/非法日期/负金额=行级错误跳过,不整批拦截(风格同 PvMeterService.importRows)。 ──
    @Transactional
    public ImportResultDTO importRows(CpMeterImportRequest req) {
        Map<String, CpStation> byName = stations.selectList(null).stream()
            .collect(Collectors.toMap(s -> s.getName().trim(), Function.identity()));
        List<ImportError> errors = new ArrayList<>();
        int imported = 0;
        List<CpMeterImportRequest.Row> rows = req.rows();
        for (int i = 0; i < rows.size(); i++) {
            CpMeterImportRequest.Row row = rows.get(i);
            String name = row.station() == null ? "" : row.station().trim();
            CpStation station = byName.get(name);
            if (station == null) {
                errors.add(new ImportError(i, name, "桩名不匹配任何充电桩"));
                continue;
            }
            LocalDate date = parseDate(row.readDate());
            if (date == null) {
                errors.add(new ImportError(i, String.valueOf(row.readDate()), "日期格式非法(应为 YYYY-MM-DD)"));
                continue;
            }
            if (neg(row.chargeKwh()) || neg(row.fee()) || neg(row.revenue())) {
                errors.add(new ImportError(i, name + " " + date, "金额不能为负"));
                continue;
            }
            // upsert:同(桩,日)先删后插(同批重复行=后行覆盖前行)
            readings.delete(new QueryWrapper<CpReading>()
                .eq("station_id", station.getId()).eq("read_date", date));
            CpReading r = new CpReading();
            r.setStationId(station.getId());
            r.setReadDate(date);
            fillAmounts(r, row.chargeKwh(), row.fee(), row.revenue(), row.note());
            r.setSource("import");
            readings.insert(r);
            imported++;
        }
        return new ImportResultDTO(imported, errors.size(), errors);
    }

    // ── helpers ──
    private static boolean neg(BigDecimal v) { return v != null && v.signum() < 0; }

    private LocalDate requireDate(String s) {
        LocalDate d = parseDate(s);
        if (d == null) throw new BizException(ResultCode.BAD_REQUEST, "日期格式非法(应为 YYYY-MM-DD)");
        return d;
    }

    private static void fillAmounts(CpReading r, BigDecimal charge, BigDecimal fee, BigDecimal revenue, String note) {
        r.setChargeKwh(r2(charge));
        r.setFee(r2(fee));
        r.setRevenue(r2(revenue));
        r.setNote(blankToNull(note));
    }

    private static CpStationDTO toStationDTO(CpStation s) {
        return new CpStationDTO(s.getId(), s.getName(), s.getOperator(), s.getVehicleType(), s.getSortNo());
    }

    private static CpReadingDTO toReadingDTO(CpReading r, String stationName) {
        return new CpReadingDTO(r.getId(), r.getStationId(), stationName,
            r.getReadDate().toString(),
            r2(r.getChargeKwh()), r2(r.getFee()), r2(r.getRevenue()),
            r.getNote(), r.getSource());
    }
}

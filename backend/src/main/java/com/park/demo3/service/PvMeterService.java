package com.park.demo3.service;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import com.park.demo3.dto.ImportError;
import com.park.demo3.dto.ImportResultDTO;
import com.park.demo3.dto.PvMeterImportRequest;
import com.park.demo3.dto.PvReadingDTO;
import com.park.demo3.dto.PvReadingReq;
import com.park.demo3.dto.PvSimulateResultDTO;
import com.park.demo3.dto.PvStationDTO;
import com.park.demo3.dto.PvStationReq;
import com.park.demo3.entity.PvReading;
import com.park.demo3.entity.PvRecord;
import com.park.demo3.entity.PvStation;
import com.park.demo3.mapper.PvReadingMapper;
import com.park.demo3.mapper.PvRecordMapper;
import com.park.demo3.mapper.PvStationMapper;
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
import java.util.Random;
import java.util.function.Function;
import java.util.stream.Collectors;

// 光伏分栋抄表(PV-METER-SPEC)。与附表6(PvService)完全独立,零共享零改动。
// price_snap 快照口径:录入/导入落库时快照当时站单价;收益=self_use×price_snap。
// 之后调站单价只影响新记录——历史记录收益稳定不漂移(本刀核心口径,IT 锁死)。
@Service
public class PvMeterService {
    private final PvStationMapper stations;
    private final PvReadingMapper readings;
    private final PvRecordMapper pvRecords;   // 附表6 真实 phase 月度汇总,模拟填充只读

    public PvMeterService(PvStationMapper stations, PvReadingMapper readings, PvRecordMapper pvRecords) {
        this.stations = stations; this.readings = readings; this.pvRecords = pvRecords;
    }

    private static BigDecimal nz(BigDecimal v) { return v == null ? BigDecimal.ZERO : v; }
    private static BigDecimal r2(BigDecimal v) { return nz(v).setScale(2, RoundingMode.HALF_UP); }
    // 收益派生:self_use × price_snap(无快照按 0),绝不落库
    private static BigDecimal revenue(PvReading r) { return r2(nz(r.getSelfUse()).multiply(nz(r.getPriceSnap()))); }
    private static String blankToNull(String s) { return s == null || s.isBlank() ? null : s; }

    private static LocalDate parseDate(String s) {
        if (s == null || s.isBlank()) return null;
        try { return LocalDate.parse(s.trim()); } catch (DateTimeParseException e) { return null; }
    }

    // ── 电站 CRUD ──
    public List<PvStationDTO> stationList() {
        return stations.selectAllSorted().stream().map(PvMeterService::toStationDTO).toList();
    }

    public PvStationDTO createStation(PvStationReq req) {
        String name = req.name().trim();
        if (stations.selectCount(new QueryWrapper<PvStation>().eq("name", name)) > 0)
            throw new BizException(ResultCode.CONFLICT, "电站名称已存在");
        PvStation s = new PvStation();
        s.setName(name);
        s.setPhase(req.phase());
        s.setCapacityKwp(req.capacityKwp());
        s.setPriceYuan(req.priceYuan());
        s.setSortNo(stations.maxSortNo() + 1);   // 新站追加末尾
        stations.insert(s);
        return toStationDTO(stations.selectById(s.getId()));
    }

    public PvStationDTO updateStation(Integer id, PvStationReq req) {
        PvStation s = stations.selectById(id);
        if (s == null) throw new BizException(ResultCode.NOT_FOUND, "电站不存在");
        String name = req.name().trim();
        if (stations.selectCount(new QueryWrapper<PvStation>().eq("name", name).ne("id", id)) > 0)
            throw new BizException(ResultCode.CONFLICT, "电站名称已存在");
        s.setName(name);
        s.setPhase(req.phase());
        s.setCapacityKwp(req.capacityKwp());
        s.setPriceYuan(req.priceYuan());   // 调价只影响之后新录记录,已有记录 price_snap 不回溯
        stations.updateById(s);
        return toStationDTO(stations.selectById(id));
    }

    public void deleteStation(Integer id) {
        if (stations.selectById(id) == null) throw new BizException(ResultCode.NOT_FOUND, "电站不存在");
        if (readings.countByStation(id) > 0)
            throw new BizException(ResultCode.CONFLICT, "该电站已有抄表记录,不可删除");
        stations.deleteById(id);
    }

    // ── 抄表记录 ──
    // 年份数据驱动:有记录的年份升序,空表=[](前端年选择器数据源)
    public List<Integer> years() { return readings.selectDistinctYears(); }
    // 有记录的账期升序,空表=[](前端默认月直接取 max,不再 12→1 逐月试探)
    public List<String> months() { return readings.selectDistinctYms(); }

    public List<PvReadingDTO> readingList(int year, Integer month, Integer stationId) {   // month null=全年
        Map<Integer, String> names = stations.selectList(null).stream()
            .collect(Collectors.toMap(PvStation::getId, PvStation::getName));
        return readings.selectByMonth(year, month, stationId).stream()
            .map(r -> toReadingDTO(r, names.get(r.getStationId()))).toList();
    }

    public PvReadingDTO createReading(PvReadingReq req) {
        PvStation station = stations.selectById(req.stationId());
        if (station == null) throw new BizException(ResultCode.CONFLICT, "电站不存在");
        LocalDate date = requireDate(req.readDate());
        if (readings.selectByStationAndDate(station.getId(), date) != null)
            throw new BizException(ResultCode.CONFLICT, "该电站该日期已有抄表记录");
        PvReading r = new PvReading();
        r.setStationId(station.getId());
        r.setReadDate(date);
        fillQuantities(r, req.genTotal(), req.selfUse(), req.gridFeed(), req.note());
        r.setPriceSnap(station.getPriceYuan());   // 快照当时站单价
        r.setSource("manual");
        readings.insert(r);
        return toReadingDTO(readings.selectById(r.getId()), station.getName());
    }

    // PUT:改日期/三量/备注;station 与 price_snap 保持不变(快照语义)
    public PvReadingDTO updateReading(Integer id, PvReadingReq req) {
        PvReading r = readings.selectById(id);
        if (r == null) throw new BizException(ResultCode.NOT_FOUND, "记录不存在");
        LocalDate date = requireDate(req.readDate());
        PvReading clash = readings.selectByStationAndDate(r.getStationId(), date);
        if (clash != null && !clash.getId().equals(id))
            throw new BizException(ResultCode.CONFLICT, "该电站该日期已有抄表记录");
        r.setReadDate(date);
        fillQuantities(r, req.genTotal(), req.selfUse(), req.gridFeed(), req.note());
        r.setSource("manual");   // 手工改写统一 manual:覆盖 simulated 即「真实替换模拟」,再模拟不回写(同 CpMeterService 口径)
        readings.updateById(r);
        PvStation station = stations.selectById(r.getStationId());
        return toReadingDTO(readings.selectById(id), station == null ? null : station.getName());
    }

    public void deleteReading(Integer id) {
        if (readings.selectById(id) == null) throw new BizException(ResultCode.NOT_FOUND, "记录不存在");
        readings.deleteById(id);
    }

    // ── 模拟填充(同 CpMeterService.simulate 模式):按附表6 真实 phase 月度汇总(pv_record)推导分栋抄表明细。
    //    a) 先补站配置(只填空位,已有值的站不动):容量 = 该 phase 当年消纳合计(self+grid)÷950h 反推 × 站内假设比例
    //       (佛山高明区分布式实测年等效利用小时≈944h,总装机反推口径取 950h;一期 B座0.25/C、D座0.3/E·F·G各0.15,
    //        二期 6 栋均分,三期 工业大厦0.6/创业大厦0.4——比例均为假设),round1 kWp;
    //       单价 = 该 phase 当年自消纳均价 self_amt÷self_kwh,round4。
    //    b) 逐月:phase 月量按「站容量 × 种入故障月系数」拆 self/grid(round2,末站补差保 Σ=真实值);再整月逐日拆分——
    //       日权重 = **全园共享天气因子**(seed=年×100+月,不含站 id)× 站内小扰动(seed 含站 id)× 种入故障逐日系数;
    //       self_d=月量×(w_d/Σw) round2,末日补差保 Σ日=月真实值分毫不差(同末站补差原则);
    //       gen_d=(self_d+grid_d)×1.03 round2(3% 系统损耗假设),末日以 月gen(=月消纳×1.03)−Σ前日 补差;
    //       price_snap=写入时站单价(同 createReading 快照口径)。
    //       ⚠ 2026-08-31(PV-ANALYSIS-SPEC §08)改动:原来日权重种子含站 id、且月量严格按容量占比拆,
    //         两条合起来让 eff=gen/cap 在同 phase 同期内**恒等**、残差是纯独立噪声 —— 分栋分析屏
    //         永远显示「全部正常」,而你分不清是真没事还是算错了。共享天气因子给出 β(d),
    //         拆分权重上的故障系数给出一个确定抓得到的靶子。两者都不改口径:Σ日、Σ全站 恒等照旧。
    //    幂等:该站该月存在任何 manual/import 行→整月跳过(部分日拆会破坏月度恒等口径,skipped 计数);
    //    纯 simulated 月逐日 upsert(值变才更新,确定性权重保证二跑 filled=0);缺站(该期无可分容量)记 skipped。 ──
    private static final BigDecimal SIXTH = BigDecimal.ONE.divide(new BigDecimal(6), 6, RoundingMode.HALF_UP);
    private static final Map<String, BigDecimal> CAP_RATIO = Map.ofEntries(
        Map.entry("B座", new BigDecimal("0.25")), Map.entry("C、D座", new BigDecimal("0.3")),
        Map.entry("E座", new BigDecimal("0.15")), Map.entry("F座", new BigDecimal("0.15")),
        Map.entry("G座", new BigDecimal("0.15")),
        Map.entry("8栋", SIXTH), Map.entry("9栋", SIXTH), Map.entry("10栋", SIXTH),
        Map.entry("11栋", SIXTH), Map.entry("12栋", SIXTH), Map.entry("13栋", SIXTH),
        Map.entry("工业大厦", new BigDecimal("0.6")), Map.entry("创业大厦", new BigDecimal("0.4")));
    private static final BigDecimal HOURS = new BigDecimal("950");        // 年等效利用小时假设(佛山行情锚点)
    private static final BigDecimal GEN_FACTOR = new BigDecimal("1.03");  // 发电=消纳×1.03(3% 系统损耗假设)

    // phaseId p1/p2/p3 → 1/2/3;非法(用户脏数据)= null 跳过
    private static Integer phaseNo(String phaseId) {
        return phaseId != null && phaseId.matches("p[123]") ? phaseId.charAt(1) - '0' : null;
    }

    @Transactional
    public PvSimulateResultDTO simulate(int year) {
        // 附表6 该年聚合:annual[phase]=[消纳合计,selfKwh,selfAmt];monthly[phase][acctMonth]=[self,grid]
        Map<Integer, BigDecimal[]> annual = new HashMap<>();
        Map<Integer, Map<String, BigDecimal[]>> monthly = new LinkedHashMap<>();
        for (PvRecord rec : pvRecords.selectByYear(year)) {
            Integer p = phaseNo(rec.getPhaseId());
            if (p == null) continue;
            BigDecimal self = nz(rec.getSelfKwh()), grid = nz(rec.getGridKwh());
            BigDecimal[] a = annual.computeIfAbsent(p, k -> new BigDecimal[]{BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO});
            a[0] = a[0].add(self).add(grid); a[1] = a[1].add(self); a[2] = a[2].add(nz(rec.getSelfAmt()));
            BigDecimal[] m = monthly.computeIfAbsent(p, k -> new LinkedHashMap<>())
                .computeIfAbsent(rec.getAcctMonth(), k -> new BigDecimal[]{BigDecimal.ZERO, BigDecimal.ZERO});
            m[0] = m[0].add(self); m[1] = m[1].add(grid);
        }

        int[] c = new int[2];   // [0]=filled, [1]=skipped
        // a) 补站配置(只填空位):容量=年消纳÷950h×站内假设比例 round1;单价=年自消纳均价 round4
        List<PvStation> all = stations.selectAllSorted();
        for (PvStation s : all) {
            BigDecimal[] a = annual.get(s.getPhase());
            if (a == null) continue;   // 该 phase 当年无附表6 数据
            boolean changed = false;
            BigDecimal ratio = CAP_RATIO.get(s.getName().trim());
            if (s.getCapacityKwp() == null && ratio != null && a[0].signum() > 0) {
                s.setCapacityKwp(a[0].multiply(ratio).divide(HOURS, 1, RoundingMode.HALF_UP));
                changed = true;
            }
            if (s.getPriceYuan() == null && a[1].signum() > 0) {
                s.setPriceYuan(a[2].divide(a[1], 4, RoundingMode.HALF_UP));
                changed = true;
            }
            if (changed) { stations.updateById(s); c[0]++; }
        }

        // b) 逐月:phase 月量按「容量 × 种入故障月系数」拆到站(round2,末站补差保 Σ=真实值);再整月逐日拆分
        for (Map.Entry<Integer, Map<String, BigDecimal[]>> pe : monthly.entrySet()) {
            List<PvStation> phaseSts = all.stream()
                .filter(s -> pe.getKey().equals(s.getPhase()) && nz(s.getCapacityKwp()).signum() > 0).toList();
            for (Map.Entry<String, BigDecimal[]> me : pe.getValue().entrySet()) {
                LocalDate month1 = LocalDate.parse(me.getKey() + "-01");
                // 拆分权重 = 容量 × 种入故障的月系数。**故障必须打在这里,不能只打在日权重上**:
                // self_d = 月量 × w_d/Σw,整月同乘一个数分子分母对消 —— 只改日权重的话,故障出了当月
                // 就完全看不见,新屏 8 月起又是一片绿(PV-ANALYSIS-SPEC §08)。
                // 打在这里则 F座 少拿的那份由同期其余站分掉,Σ全站 仍等于 phase 月真实值,月度恒等不破。
                Map<Integer, BigDecimal> splitW = phaseSts.stream().collect(Collectors.toMap(
                    PvStation::getId, s -> s.getCapacityKwp().multiply(faultMonth(s, month1))));
                BigDecimal wSum = splitW.values().stream().reduce(BigDecimal.ZERO, BigDecimal::add);
                if (wSum.signum() == 0) { c[1]++; continue; }   // 缺站/容量全空 → 该月 skipped 不报错
                String note = "模拟:附表6 p" + pe.getKey() + " " + me.getKey() + " 日拆(日照波动权重);容量比例/损耗3%假设";
                // 该月既有记录一次取回:站→(日→行);含任何 manual/import 的站整月跳过(部分日拆会破坏月度恒等口径)
                Map<Integer, Map<LocalDate, PvReading>> existing =
                    readings.selectByMonth(month1.getYear(), month1.getMonthValue(), null).stream()
                        .collect(Collectors.groupingBy(PvReading::getStationId,
                            Collectors.toMap(PvReading::getReadDate, Function.identity())));
                BigDecimal restSelf = r2(me.getValue()[0]), restGrid = r2(me.getValue()[1]);
                for (int i = 0; i < phaseSts.size(); i++) {
                    PvStation st = phaseSts.get(i);
                    boolean last = i == phaseSts.size() - 1;
                    BigDecimal w = splitW.get(st.getId());
                    BigDecimal self = last ? restSelf
                        : me.getValue()[0].multiply(w).divide(wSum, 2, RoundingMode.HALF_UP);
                    BigDecimal grid = last ? restGrid
                        : me.getValue()[1].multiply(w).divide(wSum, 2, RoundingMode.HALF_UP);
                    restSelf = restSelf.subtract(self); restGrid = restGrid.subtract(grid);   // 跳过站也要扣份额,末站补差不吞它的量
                    Map<LocalDate, PvReading> stRows = existing.getOrDefault(st.getId(), Map.of());
                    if (stRows.values().stream().anyMatch(r -> !"simulated".equals(r.getSource()))) { c[1]++; continue; }
                    String stNote = faultMonth(st, month1).compareTo(BigDecimal.ONE) < 0
                        ? note + ";含种入故障(" + FAULT_STATION + " 7/18 起 −28%,仅供检测验收)" : note;
                    simulateDays(st, month1, r2(self), r2(grid), stNote, stRows, c);
                }
            }
        }
        return new PvSimulateResultDTO(c[0], c[1]);
    }

    // ── 种入的已知故障(PV-ANALYSIS-SPEC §08)────────────────────────────────
    // 给检测器一个「确定抓得到」的靶子:不种的话新屏永远显示「全部正常」,而你分不清是真没事还是算错了。
    // note 里标明是种入的。
    private static final String FAULT_STATION = "F座";
    private static final int FAULT_MONTH = 7, FAULT_DAY = 18;   // 该日**之后**开始
    private static final double FAULT_FACTOR = 0.72;            // 阶跃 −28%

    private static double faultDay(PvStation st, LocalDate date) {
        if (!FAULT_STATION.equals(st.getName())) return 1.0;
        return date.isAfter(LocalDate.of(date.getYear(), FAULT_MONTH, FAULT_DAY)) ? FAULT_FACTOR : 1.0;
    }

    /** 月系数 = 逐日系数的月内均值。**必须与 faultDay 严格自洽**:站间拆分吃月系数(让水平持续掉下来),
     *  日内拆分吃逐日系数(让 7/18 那一跳在当月内看得见)。两者相乘后,故障前的日回到正常水平、
     *  故障后的日正好是 FAULT_FACTOR 倍。月系数若图省事写成常数 0.72,7 月前半月会被垫高 13%,
     *  变点扫描量出来的落差就是错的。 */
    private static BigDecimal faultMonth(PvStation st, LocalDate month1) {
        int days = month1.lengthOfMonth();
        double s = 0;
        for (int d = 1; d <= days; d++) s += faultDay(st, month1.withDayOfMonth(d));
        return BigDecimal.valueOf(s / days);
    }

    // 整月逐日拆分:日权重 = **全园共享的天气因子 × 站内小扰动 × 种入故障逐日系数**。
    // park 的种子**不含站 id** —— 含了的话每站各晒各的太阳,中位数抛光算不出共同的 β(d),
    // 残差退化成纯独立噪声,任何检验都通不过,工作台的残差 ACF 也画不出东西(§08 验收 ④)。
    // self_d/grid_d=月量×(w_d/Σw) round2,末日补差保 Σ日=月真实值分毫不差;gen_d=(self_d+grid_d)×1.03 round2,
    // 末日以 月gen(=月消纳×1.03)−Σ前日 补差(月度恒等口径)。确定性 → 二跑 filled=0 幂等不变。
    private void simulateDays(PvStation st, LocalDate month1, BigDecimal monthSelf, BigDecimal monthGrid,
                              String note, Map<LocalDate, PvReading> stRows, int[] c) {
        int days = month1.lengthOfMonth();
        Random park = new Random(month1.getYear() * 100L + month1.getMonthValue());
        Random site = new Random(st.getId() * 100000L + month1.getYear() * 100L + month1.getMonthValue());
        BigDecimal[] w = new BigDecimal[days];
        BigDecimal wSum = BigDecimal.ZERO;
        for (int d = 0; d < days; d++) {
            double v = (0.55 + park.nextDouble() * 0.9)     // β(d) 天气共因:全园同涨同落
                     * (0.92 + site.nextDouble() * 0.16)    // 站内小扰动
                     * faultDay(st, month1.withDayOfMonth(d + 1));
            w[d] = BigDecimal.valueOf(v);
            wSum = wSum.add(w[d]);
        }
        BigDecimal restSelf = monthSelf, restGrid = monthGrid,
            restGen = r2(monthSelf.add(monthGrid).multiply(GEN_FACTOR));
        for (int d = 1; d <= days; d++) {
            boolean lastDay = d == days;
            BigDecimal self = lastDay ? restSelf : monthSelf.multiply(w[d - 1]).divide(wSum, 2, RoundingMode.HALF_UP);
            BigDecimal grid = lastDay ? restGrid : monthGrid.multiply(w[d - 1]).divide(wSum, 2, RoundingMode.HALF_UP);
            BigDecimal gen = lastDay ? restGen : r2(self.add(grid).multiply(GEN_FACTOR));
            restSelf = restSelf.subtract(self); restGrid = restGrid.subtract(grid); restGen = restGen.subtract(gen);
            LocalDate date = month1.withDayOfMonth(d);
            upsertSimReading(st, date, stRows.get(date), gen, self, grid, note, c);
        }
    }

    // 模拟 upsert(同 CpMeterService 口径):空位插 simulated;既有 simulated 值有变才改(确定性权重 → 幂等第二跑 filled=0);
    // manual/import 由上游整月跳过挡住,这里只见 simulated;price_snap=写入时站单价(重写模拟即重新快照)
    private void upsertSimReading(PvStation st, LocalDate date, PvReading existing, BigDecimal gen, BigDecimal self,
                                  BigDecimal grid, String note, int[] c) {
        if (existing != null && r2(existing.getGenTotal()).compareTo(gen) == 0
                && r2(existing.getSelfUse()).compareTo(self) == 0
                && r2(existing.getGridFeed()).compareTo(grid) == 0) { c[1]++; return; }
        PvReading r = existing == null ? new PvReading() : existing;
        r.setStationId(st.getId());
        r.setReadDate(date);
        r.setGenTotal(gen);
        r.setSelfUse(self);
        r.setGridFeed(grid);
        r.setPriceSnap(st.getPriceYuan());
        r.setNote(note);
        r.setSource("simulated");
        if (existing == null) readings.insert(r); else readings.updateById(r);
        c[0]++;
    }

    // ── 导入:行自带 station(名)+readDate。(站,日)幂等 upsert=先删同(站,日)再插,重导修正即覆盖
    //   (price_snap 重新快照当时站单价——重导即重新录入)。未知站名/非法日期/负电量=行级错误跳过。 ──
    @Transactional
    public ImportResultDTO importRows(PvMeterImportRequest req) {
        Map<String, PvStation> byName = stations.selectList(null).stream()
            .collect(Collectors.toMap(s -> s.getName().trim(), Function.identity()));
        List<ImportError> errors = new ArrayList<>();
        int imported = 0;
        List<PvMeterImportRequest.Row> rows = req.rows();
        for (int i = 0; i < rows.size(); i++) {
            PvMeterImportRequest.Row row = rows.get(i);
            String name = row.station() == null ? "" : row.station().trim();
            PvStation station = byName.get(name);
            if (station == null) {
                errors.add(new ImportError(i, name, "楼栋不匹配任何电站"));
                continue;
            }
            LocalDate date = parseDate(row.readDate());
            if (date == null) {
                errors.add(new ImportError(i, String.valueOf(row.readDate()), "日期格式非法(应为 YYYY-MM-DD)"));
                continue;
            }
            if (neg(row.genTotal()) || neg(row.selfUse()) || neg(row.gridFeed())) {
                errors.add(new ImportError(i, name + " " + date, "电量不能为负"));
                continue;
            }
            // upsert:同(站,日)先删后插(同批重复行=后行覆盖前行)
            readings.delete(new QueryWrapper<PvReading>()
                .eq("station_id", station.getId()).eq("read_date", date));
            PvReading r = new PvReading();
            r.setStationId(station.getId());
            r.setReadDate(date);
            fillQuantities(r, row.genTotal(), row.selfUse(), row.gridFeed(), row.note());
            r.setPriceSnap(station.getPriceYuan());
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

    private static void fillQuantities(PvReading r, BigDecimal gen, BigDecimal self, BigDecimal grid, String note) {
        r.setGenTotal(r2(gen));
        r.setSelfUse(r2(self));
        r.setGridFeed(r2(grid));
        r.setNote(blankToNull(note));
    }

    private static PvStationDTO toStationDTO(PvStation s) {
        return new PvStationDTO(s.getId(), s.getName(), s.getPhase(), s.getMetered(),
            s.getCapacityKwp(), s.getPriceYuan(), s.getSortNo());
    }

    private static PvReadingDTO toReadingDTO(PvReading r, String stationName) {
        return new PvReadingDTO(r.getId(), r.getStationId(), stationName,
            r.getReadDate().toString(),
            r2(r.getGenTotal()), r2(r.getSelfUse()), r2(r.getGridFeed()),
            r.getPriceSnap(), revenue(r), r.getNote(), r.getSource());
    }
}

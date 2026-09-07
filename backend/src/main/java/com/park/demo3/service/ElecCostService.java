package com.park.demo3.service;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import com.park.demo3.dto.*;
import com.park.demo3.entity.*;
import com.park.demo3.mapper.*;
import com.park.demo3.security.NoReviewGuard;
import com.park.demo3.security.ReviewGuard;
import com.park.demo3.security.ReviewKind;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.*;
import static java.util.stream.Collectors.groupingBy;

// 园区电费成本模型(ELEC-COST-SPEC)。与附表11(ElecService/ElecController)完全独立零改动,只读其数据做模拟推导。
// 拆分口径:某费项合计行(sub_key='')与拆分行并存时照存不拦、前端黄警;读侧聚合(metrics)以拆分 Σ 为准。
@Service
public class ElecCostService {

    // ── 费项值域(ELEC-COST-SPEC §3):中文名↔fee_key 映射为单一事实源(导入/模板共用) ──
    static final Set<String> MASTER_FEES = Set.of("tou_industrial", "basic_industrial", "commercial", "pv_grid_income", "pf_reward");
    static final Set<String> DORM_FEES = Set.of("usage");
    static final Set<String> OPS_FEES = Set.of("usage", "allocated");
    // 中文费项名 → fee_key(含别名:宿舍「用电费用」/ops「电表费用」同 key;「功率因素」为用户树状图原文错别字)
    static final Map<String, String> FEE_BY_LABEL = Map.of(
        "工业分时电价", "tou_industrial",
        "工业基本电费", "basic_industrial",
        "商业用电", "commercial",
        "光伏上网收益", "pv_grid_income",
        "功率因数奖励", "pf_reward",
        "功率因素奖励", "pf_reward",
        "用电费用", "usage",
        "电表费用", "usage",
        "分摊额度", "allocated");
    // sub_key 值域:工业(分时+基本)拆 bg/t3_industry,商业拆 a/t3_chuangye,其余费项不拆
    static final Map<String, String> SUB_BY_LABEL = Map.of(
        "B-G座", "bg", "三期工业大厦", "t3_industry",
        "A座", "a", "三期创业大厦", "t3_chuangye");
    static final Map<String, Set<String>> SUB_ALLOWED = Map.of(
        "tou_industrial", Set.of("bg", "t3_industry"),
        "basic_industrial", Set.of("bg", "t3_industry"),
        "commercial", Set.of("a", "t3_chuangye"));

    // 电价参数 4 键(ELEC-COST-SPEC §3)
    static final List<String> CFG_KEYS = List.of("pv_grid_price", "grid_posted_price", "third_party_price", "pf_reward_rate");

    // 模拟填充的目标电表名(种子);用户删/改名后对应规则静默跳过(byRule 计 0)
    private static final String M_MASTER1 = "一期总表", M_MASTER2 = "二期总表", M_DORM = "宿舍电表", M_OFFICE = "办公用电";
    // 其余 4 运营表 = 办公用电金额 × 假设比例(ELEC-COST-SPEC §5「按办公用电比例假设」,比例本身为假设值)
    private static final Map<String, BigDecimal> OPS_RATIO = Map.of(
        "水泵房", new BigDecimal("0.8"), "消防泵", new BigDecimal("0.3"),
        "路灯", new BigDecimal("0.6"), "绿化用电", new BigDecimal("0.2"));

    private final ElecMeterMapper meters;
    private final ElecCostEntryMapper entries;
    private final ElecPriceCfgMapper cfgs;
    private final ElecRecordMapper elecRecords;
    private final PvRecordMapper pvRecords;
    private final OfficeRecordMapper officeRecords;
    private final PvReadingMapper pvReadings;
    private final CpReadingMapper cpReadings;
    private final CpPowerUsageMapper cpPowers;
    private final S10RecordMapper s10Records;
    private final MonthlyLedgerMapper ledgers;
    private final AllocResultMapper allocResults;   // P-B 桥:单向读分摊结果Σ(elec-cost→P-B,spec §5)
    private final ReviewGuard reviewGuard;

    public ElecCostService(ElecMeterMapper meters, ElecCostEntryMapper entries, ElecPriceCfgMapper cfgs,
                           ElecRecordMapper elecRecords, PvRecordMapper pvRecords, OfficeRecordMapper officeRecords,
                           PvReadingMapper pvReadings, CpReadingMapper cpReadings, CpPowerUsageMapper cpPowers,
                           S10RecordMapper s10Records, MonthlyLedgerMapper ledgers, AllocResultMapper allocResults,
                           ReviewGuard reviewGuard) {
        this.meters = meters; this.entries = entries; this.cfgs = cfgs;
        this.elecRecords = elecRecords; this.pvRecords = pvRecords; this.officeRecords = officeRecords;
        this.pvReadings = pvReadings; this.cpReadings = cpReadings; this.cpPowers = cpPowers;
        this.s10Records = s10Records; this.ledgers = ledgers; this.allocResults = allocResults;
        this.reviewGuard = reviewGuard;
    }

    /**
     * 园区电费模型的审核闸(§7.4)。键是 elec-model,**不是 elec-cost** —— elec-cost 守的是
     * 附表11 报送台账(ElecService / 表 elec_record),spec §7.4 早期版本点名本类是点反了。
     * 本类写的是 elec_cost_entry / elec_price_cfg,ElecView 左栏第二本账,清单上没有它的行。
     */
    private void assertModelEditable(String acctMonth) {
        reviewGuard.assertEditable(ReviewKind.ELEC_MODEL, acctMonth, null);
    }

    /** 整年一把梭的写路径专用(simulate):该年 12 个月全送进批量闸(点名最早的锁月)。 */
    private void assertYearEditable(int year) {
        List<String> months = new ArrayList<>(12);
        for (int m = 1; m <= 12; m++) months.add(ym(year, m));
        reviewGuard.assertEditable(ReviewKind.ELEC_MODEL, months, null);
    }

    private static BigDecimal nz(BigDecimal v) { return v == null ? BigDecimal.ZERO : v; }
    private static BigDecimal r2(BigDecimal v) { return nz(v).setScale(2, RoundingMode.HALF_UP); }
    private static String blankToNull(String s) { return s == null || s.isBlank() ? null : s; }
    private static String normSub(String s) { return s == null ? "" : s.trim(); }
    private static String ym(int year, int month) { return String.format("%d-%02d", year, month); }

    private static Set<String> feesForKind(String kind) {
        return switch (kind) { case "master" -> MASTER_FEES; case "dorm" -> DORM_FEES; default -> OPS_FEES; };
    }

    // ── 电表 CRUD ──
    public List<ElecMeterDTO> meterList() {
        return meters.selectAllSorted().stream().map(ElecCostService::toMeterDTO).toList();
    }

    @NoReviewGuard(reason = "电表档案不带期间;新增电表不产生任何月的费项行")
    public ElecMeterDTO createMeter(ElecMeterReq req) {
        String name = req.name().trim();
        if (meters.selectCount(new QueryWrapper<ElecMeter>().eq("name", name)) > 0)
            throw new BizException(ResultCode.CONFLICT, "电表名称已存在");
        ElecMeter m = new ElecMeter();
        m.setName(name);
        m.setKind(req.kind());
        m.setSortNo(meters.maxSortNo() + 1);   // 新表追加末尾
        meters.insert(m);
        return toMeterDTO(meters.selectById(m.getId()));
    }

    @NoReviewGuard(reason = "电表档案不带期间;有费项数据的表禁改类型(既有 409),改名不改任何月的金额")
    public ElecMeterDTO updateMeter(Integer id, ElecMeterReq req) {
        ElecMeter m = meters.selectById(id);
        if (m == null) throw new BizException(ResultCode.NOT_FOUND, "电表不存在");
        String name = req.name().trim();
        if (meters.selectCount(new QueryWrapper<ElecMeter>().eq("name", name).ne("id", id)) > 0)
            throw new BizException(ResultCode.CONFLICT, "电表名称已存在");
        // 改类会让既有费项 key 脱离值域,有数据禁改类(改名不受限)
        if (!m.getKind().equals(req.kind()) && entries.countByMeter(id) > 0)
            throw new BizException(ResultCode.CONFLICT, "该电表已有费项数据,不可更改类型");
        m.setName(name);
        m.setKind(req.kind());
        meters.updateById(m);
        return toMeterDTO(meters.selectById(id));
    }

    @NoReviewGuard(reason = "电表档案不带期间;有费项数据的表本来就删不掉(既有 409),删得掉的表没有任何月的行")
    public void deleteMeter(Integer id) {
        if (meters.selectById(id) == null) throw new BizException(ResultCode.NOT_FOUND, "电表不存在");
        if (entries.countByMeter(id) > 0)
            throw new BizException(ResultCode.CONFLICT, "该电表已有费项数据,不可删除");
        meters.deleteById(id);
    }

    // ── 费项月度值 ──
    // 年份数据驱动:有数据的年份升序,空表=[](同 pv-meter 模式)
    public List<Integer> years() { return entries.selectDistinctYears(); }
    // 有数据的账期升序,空表=[](前端默认月直接取 max,不再 12→1 逐月试探)
    public List<String> months() { return entries.selectDistinctYms(); }

    public List<ElecCostEntryDTO> entryList(int year, int month) {
        Map<Integer, String> names = meterNames();
        return entries.selectByMonth(ym(year, month)).stream()
            .map(e -> toEntryDTO(e, names.get(e.getMeterId()))).toList();
    }

    // upsert:键=(表,月,费项,拆分空串归一化);命中改值、无则插;手工写入 source 统一 manual(覆盖 simulated 即「真实替换模拟」)
    @NoReviewGuard(reason = "转调 writeEntry,守卫在那里按 acctMonth 判")
    public ElecCostEntryDTO upsertEntry(ElecCostEntryReq req) {
        ElecMeter meter = meters.selectById(req.meterId());
        if (meter == null) throw new BizException(ResultCode.CONFLICT, "电表不存在");
        String feeKey = req.feeKey().trim();
        String subKey = normSub(req.subKey());
        validateFee(meter.getKind(), feeKey, subKey);
        ElecCostEntry e = writeEntry(meter.getId(), req.acctMonth(), feeKey, subKey,
            req.amount(), req.qty(), req.note(), "manual");
        return toEntryDTO(e, meter.getName());
    }

    // 原本只判存在性就删。审核闸要按**被删行自己的月**判(§7.4「按被写数据的月判,不按 URL」),
    // 所以改成先取实体再守 —— 只判存在性拿不到 acctMonth。
    public void deleteEntry(Integer id) {
        ElecCostEntry e = entries.selectById(id);
        if (e == null) throw new BizException(ResultCode.NOT_FOUND, "记录不存在");
        assertModelEditable(e.getAcctMonth());
        entries.deleteById(id);
    }

    // ── 电价参数:读=4 键各返回 {解析值(当月优先回退默认), 月度原值, 默认原值} ──
    public List<ElecPriceCfgDTO> priceCfg(String acctMonth) {
        List<ElecPriceCfgDTO> out = new ArrayList<>(CFG_KEYS.size());
        for (String key : CFG_KEYS) {
            ElecPriceCfg monthRow = acctMonth == null ? null : cfgs.selectByKey(acctMonth, key);
            ElecPriceCfg defRow = cfgs.selectByKey("", key);
            ElecPriceCfg hit = monthRow != null ? monthRow : defRow;
            out.add(new ElecPriceCfgDTO(key,
                hit == null ? null : hit.getCfgValue(),
                hit == null ? null : (monthRow != null ? "month" : "default"),
                monthRow == null ? null : monthRow.getCfgValue(),
                defRow == null ? null : defRow.getCfgValue(),
                hit == null ? null : hit.getNote()));
        }
        return out;
    }

    // upsert 单行;value=null 删除该行(月度行删除即回退默认)
    public void savePriceCfg(ElecPriceCfgReq req) {
        String key = req.cfgKey().trim();
        if (!CFG_KEYS.contains(key)) throw new BizException(ResultCode.BAD_REQUEST, "未知参数键: " + key);
        String month = req.acctMonth() == null ? "" : req.acctMonth().trim();
        // 空串 = 长期默认行,它是「所有没有月度行的月」的取值来源,压根没有「被写月」这个概念 ——
        // 按裁定 R-4 用整键闸:该 kind 有任一被锁月就整体拒(点名最早那个月)。
        if (month.isEmpty()) reviewGuard.assertNoLockedMonth(ReviewKind.ELEC_MODEL, null);
        else assertModelEditable(month);
        ElecPriceCfg row = cfgs.selectByKey(month, key);
        if (req.value() == null) {
            if (row != null) cfgs.deleteById(row.getId());
            return;
        }
        if (row == null) {
            row = new ElecPriceCfg();
            row.setAcctMonth(month);
            row.setCfgKey(key);
            row.setCfgValue(req.value());
            row.setNote(blankToNull(req.note()));
            cfgs.insert(row);
        } else {
            row.setCfgValue(req.value());
            row.setNote(blankToNull(req.note()));
            cfgs.updateById(row);
        }
    }

    // 取值规则:当月行优先,缺省回退默认行,两级都缺 → null
    private BigDecimal resolveCfg(String cfgKey, String acctMonth) {
        ElecPriceCfg row = cfgs.selectByKey(acctMonth, cfgKey);
        if (row == null) row = cfgs.selectByKey("", cfgKey);
        return row == null ? null : row.getCfgValue();
    }

    // ── 导入:(表,月,费项,拆分) upsert 幂等;未知表/费项/拆分、非法月份、负金额=行级错误跳过 ──
    @Transactional
    @NoReviewGuard(reason = "转调 writeEntry,守卫在那里按 acctMonth 判")
    public ImportResultDTO importRows(ElecCostImportRequest req) {
        Map<String, ElecMeter> byName = new HashMap<>();
        for (ElecMeter m : meters.selectList(null)) byName.put(m.getName().trim(), m);
        List<ImportError> errors = new ArrayList<>();
        int imported = 0;
        List<ElecCostImportRequest.Row> rows = req.rows();
        for (int i = 0; i < rows.size(); i++) {
            ElecCostImportRequest.Row row = rows.get(i);
            String meterName = row.meter() == null ? "" : row.meter().trim();
            ElecMeter meter = byName.get(meterName);
            if (meter == null) { errors.add(new ImportError(i, meterName, "电表不匹配")); continue; }
            String feeRaw = row.fee() == null ? "" : row.fee().trim();
            String feeKey = FEE_BY_LABEL.getOrDefault(feeRaw, feeRaw);
            String subRaw = normSub(row.split());
            String subKey = SUB_BY_LABEL.getOrDefault(subRaw, subRaw);
            try {
                validateFee(meter.getKind(), feeKey, subKey);
            } catch (BizException e) {
                errors.add(new ImportError(i, meterName + " " + feeRaw, e.getMessage()));
                continue;
            }
            String month = row.month() == null ? "" : row.month().trim();
            if (!month.matches("\\d{4}-(0[1-9]|1[0-2])")) {
                errors.add(new ImportError(i, month, "月份格式非法(应为 YYYY-MM)"));
                continue;
            }
            if (row.amount() == null || row.amount().signum() < 0
                    || (row.qty() != null && row.qty().signum() < 0)) {
                errors.add(new ImportError(i, meterName + " " + month, "金额/电量缺失或为负"));
                continue;
            }
            writeEntry(meter.getId(), month, feeKey, subKey, row.amount(), row.qty(), row.note(), "import");
            imported++;
        }
        return new ImportResultDTO(imported, errors.size(), errors);
    }

    // ── 模拟填充(ELEC-COST-SPEC §5):按附表11/6/13 真实数据推导;只写空位与既有 simulated 行,绝不覆盖 manual/import。
    //    p3 归属判定:真实库 elec_record 无 p3 行(三期电表物理接一期,费用已在 p1 单内);种子库 p3 独立成行 →
    //    统一按「p2→二期总表,其余(p1/p3)→一期总表」归并。
    //    类别判定(真实值域 商业/大工业用电/居民生活;种子另有 一般工商业):含「居民」→宿舍,否则含「商」→商业用电,其余→工业。
    @Transactional
    public ElecSimulateResultDTO simulate(int year) {
        // 只有年、没有月:整年模拟会往该年任何一个月写费项行/电价行,所以 12 个月一起送闸
        assertYearEditable(year);
        Map<String, ElecMeter> byName = new HashMap<>();
        for (ElecMeter m : meters.selectList(null)) byName.put(m.getName(), m);
        // byRule 全键预置 0:无源数据的规则也在摘要里,形状稳定
        Map<String, Integer> byRule = new LinkedHashMap<>();
        for (String rule : List.of("tou_industrial", "basic_industrial", "commercial", "dorm_usage",
                "pv_grid_income", "pf_reward", "ops", "sell_price")) byRule.put(rule, 0);
        int[] counters = new int[2];   // [0]=filled, [1]=skipped

        // ── 附表11 energy 聚合:月 → {表×费项 → 金额/电量}(不含税 qty×price,同 pnlDerive 口径) ──
        Map<String, BigDecimal> amt = new HashMap<>();   // 键 "meter|month|fee"
        Map<String, BigDecimal> kwh = new HashMap<>();
        Map<String, BigDecimal> qtyByMonth = new HashMap<>();   // 全期购电量(售电均价用)
        Map<String, BigDecimal> amtByMonth = new HashMap<>();
        for (ElecRecord r : elecRecords.selectByYearAndType(year, "energy")) {
            BigDecimal a = nz(r.getQty()).multiply(nz(r.getPrice()));
            String meter = "p2".equals(r.getPhaseId()) ? M_MASTER2 : M_MASTER1;
            String cat = r.getCat() == null ? "" : r.getCat();
            String fee = cat.contains("居民") ? "dorm" : cat.contains("商") ? "commercial" : "tou_industrial";
            String target = "dorm".equals(fee) ? M_DORM + "|" + r.getAcctMonth() + "|usage"
                                               : meter + "|" + r.getAcctMonth() + "|" + fee;
            amt.merge(target, a, BigDecimal::add);
            kwh.merge(target, nz(r.getQty()), BigDecimal::add);
            qtyByMonth.merge(r.getAcctMonth(), nz(r.getQty()), BigDecimal::add);
            amtByMonth.merge(r.getAcctMonth(), a, BigDecimal::add);
        }
        for (ElecRecord r : elecRecords.selectByYearAndType(year, "basic")) {
            String meter = "p2".equals(r.getPhaseId()) ? M_MASTER2 : M_MASTER1;
            // basic 无电量,金额=计费需量 kVA×单价;qty 列语义为 kWh,不落需量
            amt.merge(meter + "|" + r.getAcctMonth() + "|basic_industrial",
                nz(r.getDemand()).multiply(nz(r.getPrice())), BigDecimal::add);
        }

        // 规则 1-3+宿舍:分时/基本/商业/宿舍(注:金额为 0 的聚合槽不产生,天然只写有数据的月)
        for (Map.Entry<String, BigDecimal> e : amt.entrySet()) {
            String[] k = e.getKey().split("\\|");   // meter|month|fee
            String rule = switch (k[2]) {
                case "tou_industrial" -> "tou_industrial";
                case "basic_industrial" -> "basic_industrial";
                case "commercial" -> "commercial";
                default -> "dorm_usage";
            };
            String src = "模拟:附表11 " + (M_MASTER2.equals(k[0]) ? "p2" : "p1+p3") + " "
                + ("basic_industrial".equals(k[2]) ? "basic" : "energy") + " " + k[1];
            upsertSim(byName.get(k[0]), k[1], k[2], r2(e.getValue()), kwh.get(e.getKey()),
                src, rule, byRule, counters);
        }

        // 规则 4:光伏上网收益 ← 附表6 上网电量 × pv_grid_price(p3 并入一期,同总表归属)
        Map<String, BigDecimal> gridKwh = new HashMap<>();   // 键 "meter|month"
        for (PvRecord r : pvRecords.selectByYear(year)) {
            String meter = "p2".equals(r.getPhaseId()) ? M_MASTER2 : M_MASTER1;
            gridKwh.merge(meter + "|" + r.getAcctMonth(), nz(r.getGridKwh()), BigDecimal::add);
        }
        for (Map.Entry<String, BigDecimal> e : gridKwh.entrySet()) {
            String[] k = e.getKey().split("\\|");
            BigDecimal price = nz(resolveCfg("pv_grid_price", k[1]));
            upsertSim(byName.get(k[0]), k[1], "pv_grid_income", r2(e.getValue().multiply(price)), e.getValue(),
                "模拟:附表6 上网电量×" + price.stripTrailingZeros().toPlainString() + " " + k[1],
                "pv_grid_income", byRule, counters);
        }

        // 规则 5:功率因数奖励 = 当月该总表电费(分时+基本+商业,附表11 口径) × pf_reward_rate
        for (String meterName : List.of(M_MASTER1, M_MASTER2)) {
            for (int m = 1; m <= 12; m++) {
                String month = ym(year, m);
                BigDecimal base = r2(nz(amt.get(meterName + "|" + month + "|tou_industrial")))
                    .add(r2(nz(amt.get(meterName + "|" + month + "|basic_industrial"))))
                    .add(r2(nz(amt.get(meterName + "|" + month + "|commercial"))));
                if (base.signum() <= 0) continue;
                BigDecimal rate = nz(resolveCfg("pf_reward_rate", month));
                upsertSim(byName.get(meterName), month, "pf_reward", r2(base.multiply(rate)), null,
                    "模拟:总表电费" + base.toPlainString() + "×" + rate.stripTrailingZeros().toPlainString(),
                    "pf_reward", byRule, counters);
            }
        }

        // 规则 6:运营性电表 ← 附表13 办公水电真实数据(办公用电);其余 4 表按办公用电×假设比例。
        // 分摊额度:当月有 P-B 分摊结果 → 读 alloc_result Σ 真值(单向 mapper 读,PB-ALLOCATION-SPEC §5 桥),
        // 整月Σ落「办公用电」一行、其余 4 表不再写假设行;无分摊数据月回退「费用×50% 假设」不变。
        for (OfficeRecord r : officeRecords.selectByScheduleAndYear(13, year)) {
            String month = r.getAcctMonth();
            BigDecimal officeAmt = r2(nz(r.getElecQty()).multiply(nz(r.getElecPrice())));
            if (officeAmt.signum() <= 0) continue;
            BigDecimal allocReal = allocResults.sumAmountByYm(month);
            boolean hasAlloc = allocReal.signum() > 0;
            upsertSim(byName.get(M_OFFICE), month, "usage", officeAmt, r2(r.getElecQty()),
                "模拟:附表13 办公用电 " + month, "ops", byRule, counters);
            upsertSim(byName.get(M_OFFICE), month, "allocated",
                hasAlloc ? r2(allocReal) : r2(officeAmt.multiply(new BigDecimal("0.5"))), null,
                hasAlloc ? "公摊分摊结果Σ " + month + "(P-B 真值)" : "模拟:费用×50%(假设)", "ops", byRule, counters);
            for (Map.Entry<String, BigDecimal> op : OPS_RATIO.entrySet()) {
                BigDecimal usage = r2(officeAmt.multiply(op.getValue()));
                upsertSim(byName.get(op.getKey()), month, "usage", usage, null,
                    "模拟:办公用电×" + op.getValue().toPlainString() + "(假设)", "ops", byRule, counters);
                if (!hasAlloc)   // 有真值月:分摊额度已整月Σ落办公用电,不再摊假设行
                    upsertSim(byName.get(op.getKey()), month, "allocated", r2(usage.multiply(new BigDecimal("0.5"))), null,
                        "模拟:费用×50%(假设)", "ops", byRule, counters);
            }
        }

        // 规则 7:售电双价 → 电价参数月度行(执行价=附表11 实际均价,公告价=执行价+0.02 假设)。
        // 参数表无 source 列:只插空位、既有行(不论谁写)一律不动,幂等由此保证。
        for (Map.Entry<String, BigDecimal> e : amtByMonth.entrySet()) {
            String month = e.getKey();
            BigDecimal qty = qtyByMonth.get(month);
            if (qty == null || qty.signum() <= 0) continue;
            BigDecimal third = e.getValue().divide(qty, 6, RoundingMode.HALF_UP);
            insertCfgIfAbsent(month, "third_party_price", third, "模拟:附表11 实际均价 " + month, byRule, counters);
            insertCfgIfAbsent(month, "grid_posted_price", third.add(new BigDecimal("0.02")),
                "模拟:执行价+0.02(假设)", byRule, counters);
        }

        return new ElecSimulateResultDTO(counters[0], counters[1], byRule);
    }

    // 模拟 upsert:空位插 simulated;既有 simulated 值有变才改(幂等第二跑 filled=0);manual/import 绝不覆盖
    private void upsertSim(ElecMeter meter, String month, String feeKey, BigDecimal amount, BigDecimal qty,
                           String note, String rule, Map<String, Integer> byRule, int[] counters) {
        if (meter == null) return;   // 目标电表被删/改名 → 该规则静默跳过
        ElecCostEntry existing = entries.selectByKey(meter.getId(), month, feeKey, "");
        if (existing != null && !"simulated".equals(existing.getSource())) { counters[1]++; return; }
        if (existing != null && r2(existing.getAmount()).compareTo(amount) == 0
                && Objects.equals(existing.getQty() == null ? null : r2(existing.getQty()),
                                  qty == null ? null : r2(qty))) { counters[1]++; return; }
        ElecCostEntry e = existing == null ? new ElecCostEntry() : existing;
        e.setMeterId(meter.getId());
        e.setAcctMonth(month);
        e.setFeeKey(feeKey);
        e.setSubKey("");
        e.setAmount(amount);
        e.setQty(qty == null ? null : r2(qty));
        e.setNote(note);
        e.setSource("simulated");
        if (existing == null) entries.insert(e); else entries.updateById(e);
        counters[0]++;
        byRule.merge(rule, 1, Integer::sum);
    }

    private void insertCfgIfAbsent(String month, String key, BigDecimal value, String note,
                                   Map<String, Integer> byRule, int[] counters) {
        if (cfgs.selectByKey(month, key) != null) { counters[1]++; return; }
        ElecPriceCfg row = new ElecPriceCfg();
        row.setAcctMonth(month);
        row.setCfgKey(key);
        row.setCfgValue(value);
        row.setNote(note);
        cfgs.insert(row);
        counters[0]++;
        byRule.merge("sell_price", 1, Integer::sum);
    }

    // ── 派生指标(ELEC-COST-SPEC §1 说明 1-7):算不出 → value=null + missing 列缺失源 ──
    // 单月取数上下文:单月端点与年端点唯一共用 computeMetrics(口径全等由同一计算体保证)
    private record MetricsCtx(Map<String, BigDecimal> eff, List<S10Record> s10,
                              List<PvRecord> pvs, List<PvReading> readings, List<MonthlyLedger> ledgerRows,
                              List<CpReading> cps, List<CpPowerUsage> powers, List<ElecRecord> energyRows,
                              BigDecimal thirdPrice, BigDecimal postedPrice) {}

    public List<ElecMetricDTO> metrics(int year, int month) {
        String acctMonth = ym(year, month);
        // 当月费项按 (kind, fee) 聚合,拆分口径:有拆分行以拆分 Σ 为准、忽略并存的合计行
        return computeMetrics(new MetricsCtx(
            effectiveByKindFee(entries.selectByMonth(acctMonth), meterById()),
            s10Records.selectByMonth(acctMonth),
            pvRecords.selectList(new QueryWrapper<PvRecord>().eq("acct_month", acctMonth)),
            pvReadings.selectByMonth(year, month, null),
            ledgers.selectPeriod(year, month),
            cpReadings.selectByMonth(year, month, null),
            cpPowers.selectByPeriod(LocalDate.of(year, month, 1)),
            elecRecords.selectList(new QueryWrapper<ElecRecord>()
                .eq("acct_month", acctMonth).eq("type", "energy")),
            resolveCfg("third_party_price", acctMonth),
            resolveCfg("grid_posted_price", acctMonth)));
    }

    // ENERGY-ANALYSIS §4:12 月×7 指标年度序列。各源整年一次取数、内存按月分桶(不做 12×N 次逐月查询);
    // 计算体与单月端点同一 computeMetrics → 口径全等由结构保证(IT 抽样锁)。
    public List<ElecMetricsMonthDTO> metricsYear(int year) {
        Map<Integer, ElecMeter> meterById = meterById();
        Map<String, List<ElecCostEntry>> entryByM = entries.selectByYear(year).stream()
            .collect(groupingBy(ElecCostEntry::getAcctMonth));
        Map<String, List<S10Record>> s10ByM = s10Records.selectByYear(year).stream()
            .collect(groupingBy(S10Record::getAcctMonth));
        Map<String, List<PvRecord>> pvByM = pvRecords.selectByYear(year).stream()
            .collect(groupingBy(PvRecord::getAcctMonth));
        Map<String, List<ElecRecord>> energyByM = elecRecords.selectByYearAndType(year, "energy").stream()
            .collect(groupingBy(ElecRecord::getAcctMonth));
        Map<Integer, List<PvReading>> readingByM = pvReadings.selectByMonth(year, null, null).stream()
            .collect(groupingBy(r -> r.getReadDate().getMonthValue()));
        Map<Integer, List<MonthlyLedger>> ledgerByM = ledgers.selectPeriodYear(year).stream()
            .collect(groupingBy(MonthlyLedger::getPeriodMonth));
        Map<Integer, List<CpReading>> cpByM = cpReadings.selectByMonth(year, null, null).stream()
            .collect(groupingBy(r -> r.getReadDate().getMonthValue()));
        Map<Integer, List<CpPowerUsage>> powerByM = cpPowers.selectByYear(year).stream()
            .collect(groupingBy(u -> u.getPeriod().getMonthValue()));
        // 电价参数一次取(表极小):月行优先回退默认行(''),与 resolveCfg 同规则
        // 收敛下推:下面只按 ym(year,1..12) 与默认行 '' 这 13 个 acct_month 查,别的月份行取回来也永不命中;
        // 13 个字面量恒非空故不需空集守卫;IN 只筛行不筛值,cfgResolve 的 containsKey(值可为 null)语义不受影响
        List<String> cfgMonths = new ArrayList<>(List.of(""));
        for (int m = 1; m <= 12; m++) cfgMonths.add(ym(year, m));
        Map<String, BigDecimal> cfgAll = new HashMap<>();
        for (ElecPriceCfg c : cfgs.selectList(new QueryWrapper<ElecPriceCfg>().in("acct_month", cfgMonths)))
            cfgAll.put(c.getAcctMonth() + "|" + c.getCfgKey(), c.getCfgValue());
        List<ElecMetricsMonthDTO> out = new ArrayList<>(12);
        for (int m = 1; m <= 12; m++) {
            String acctMonth = ym(year, m);
            out.add(new ElecMetricsMonthDTO(m, computeMetrics(new MetricsCtx(
                effectiveByKindFee(entryByM.getOrDefault(acctMonth, List.of()), meterById),
                s10ByM.getOrDefault(acctMonth, List.of()),
                pvByM.getOrDefault(acctMonth, List.of()),
                readingByM.getOrDefault(m, List.of()),
                ledgerByM.getOrDefault(m, List.of()),
                cpByM.getOrDefault(m, List.of()),
                powerByM.getOrDefault(m, List.of()),
                energyByM.getOrDefault(acctMonth, List.of()),
                cfgResolve(cfgAll, acctMonth, "third_party_price"),
                cfgResolve(cfgAll, acctMonth, "grid_posted_price")))));
        }
        return out;
    }

    // 内存版 resolveCfg:月行在(键存在,含 null 值)用月行,否则回退默认行('')
    private static BigDecimal cfgResolve(Map<String, BigDecimal> all, String acctMonth, String key) {
        String mk = acctMonth + "|" + key;
        return all.containsKey(mk) ? all.get(mk) : all.get("|" + key);
    }

    private List<ElecMetricDTO> computeMetrics(MetricsCtx ctx) {
        Map<String, BigDecimal> eff = ctx.eff();
        List<ElecMetricDTO> out = new ArrayList<>(7);

        // 1 园区电费收益 = 电费收入(附10 基本+基准,pnlDerive 收入侧口径) − 总表电费支出(master+dorm,扣功率奖励) − 光伏两项(附6)
        {
            List<String> missing = new ArrayList<>();
            BigDecimal income = BigDecimal.ZERO;
            if (ctx.s10().isEmpty()) missing.add("附表10 当月无数据(电费收入)");
            for (S10Record r : ctx.s10()) income = income.add(nz(r.getElecBasic())).add(nz(r.getElecStd()));
            BigDecimal cost = nz(eff.get("master|tou_industrial")).add(nz(eff.get("master|basic_industrial")))
                .add(nz(eff.get("master|commercial"))).add(nz(eff.get("dorm|usage")))
                .subtract(nz(eff.get("master|pf_reward")));
            if (!eff.containsKey("master|tou_industrial") && !eff.containsKey("master|basic_industrial")
                    && !eff.containsKey("master|commercial") && !eff.containsKey("dorm|usage"))
                missing.add("总表电费支出未录(可模拟填充)");
            BigDecimal pvSelf = BigDecimal.ZERO, pvGrid = BigDecimal.ZERO;   // 附6 当月无行视为 0(无光伏月合理)
            for (PvRecord r : ctx.pvs()) {
                pvSelf = pvSelf.add(nz(r.getSelfAmt()));
                pvGrid = pvGrid.add(nz(r.getGridAmt()));
            }
            out.add(metric("parkElecProfit", "园区电费收益",
                "电费收入(附10 基本+基准) − 总表电费支出(本模型,扣功率奖励) − 光伏消纳(附6) − 光伏上网(附6)",
                missing, income.subtract(cost).subtract(pvSelf).subtract(pvGrid)));
        }

        // 2 光伏投资收益 = 分栋抄表消纳收益(自消纳×单价快照) + 本模型光伏上网收益
        List<PvReading> readings = ctx.readings();
        {
            List<String> missing = new ArrayList<>();
            BigDecimal selfRevenue = BigDecimal.ZERO;
            if (readings.isEmpty()) missing.add("光伏分栋抄表当月无记录");
            for (PvReading r : readings) selfRevenue = selfRevenue.add(nz(r.getSelfUse()).multiply(nz(r.getPriceSnap())));
            if (!eff.containsKey("master|pv_grid_income")) missing.add("光伏上网收益未录(可模拟填充)");
            out.add(metric("pvInvestIncome", "光伏投资收益",
                "分栋抄表消纳收益(自消纳×单价快照) + 光伏上网收益(本模型)",
                missing, selfRevenue.add(nz(eff.get("master|pv_grid_income")))));
        }

        // 3 光伏损耗(kWh) = 分栋抄表 Σ(发电总量−自消纳−上网)——电量口径(发电总额仅抄表侧有)
        {
            List<String> missing = readings.isEmpty() ? List.of("光伏分栋抄表当月无记录") : List.of();
            BigDecimal loss = BigDecimal.ZERO;
            for (PvReading r : readings)
                loss = loss.add(nz(r.getGenTotal())).subtract(nz(r.getSelfUse())).subtract(nz(r.getGridFeed()));
            out.add(metric("pvLoss", "光伏损耗(kWh)",
                "分栋抄表 Σ(发电总量 − 自消纳 − 上网)(电量口径)", missing, loss));
        }

        // 4 基本用电费收益 = 台账 basicElectricity Σ − 总表工业基本电费(本模型)
        {
            List<String> missing = new ArrayList<>();
            BigDecimal income = BigDecimal.ZERO;
            if (ctx.ledgerRows().isEmpty()) missing.add("台账当月无数据(基本用电费收入)");
            for (MonthlyLedger l : ctx.ledgerRows()) income = income.add(nz(l.getBasicElectricity()));
            if (!eff.containsKey("master|basic_industrial")) missing.add("总表基本电费未录(可模拟填充)");
            out.add(metric("basicElecProfit", "基本用电费收益",
                "台账基本用电费收入 Σ − 总表工业基本电费(本模型)",
                missing, income.subtract(nz(eff.get("master|basic_industrial")))));
        }

        // 5 经营性项目收入(充电桩) = 分桩明细收益 Σ − 充电桩电表用电 Σ × 第三方售电执行价
        {
            List<String> missing = new ArrayList<>();
            BigDecimal revenue = BigDecimal.ZERO;
            if (ctx.cps().isEmpty()) missing.add("充电桩分桩明细当月无记录");
            for (CpReading r : ctx.cps()) revenue = revenue.add(nz(r.getRevenue()));
            BigDecimal meterKwh = BigDecimal.ZERO;
            if (ctx.powers().isEmpty()) missing.add("充电桩电表用电当月未录");
            for (CpPowerUsage p : ctx.powers()) meterKwh = meterKwh.add(nz(p.getMeterKwh()));
            BigDecimal price = ctx.thirdPrice();
            if (price == null) missing.add("缺第三方售电执行电价,去参数配置");
            out.add(metric("chargingProfit", "经营性项目收入(充电桩)",
                "分桩明细收益 Σ − 充电桩电表用电 Σ × 第三方售电执行价",
                missing, price == null ? null : revenue.subtract(meterKwh.multiply(price))));
        }

        // 6 经营性用电费用 = 运营性电表费用 Σ − 分摊额度 Σ(本模型 ops 5 表)
        {
            List<String> missing = eff.containsKey("ops|usage")
                ? List.of() : List.of("运营性电表费用未录(可模拟填充)");
            out.add(metric("opsElecCost", "经营性用电费用",
                "运营性电表费用 Σ − 分摊额度 Σ",
                missing, nz(eff.get("ops|usage")).subtract(nz(eff.get("ops|allocated")))));
        }

        // 7 售电协议损益 = (电网公告价 − 第三方执行价) × 附表11 当月购电量
        {
            List<String> missing = new ArrayList<>();
            BigDecimal posted = ctx.postedPrice();
            BigDecimal third = ctx.thirdPrice();
            if (posted == null) missing.add("缺电网公告电价,去参数配置");
            if (third == null) missing.add("缺第三方售电执行电价,去参数配置");
            BigDecimal qty = BigDecimal.ZERO;
            if (ctx.energyRows().isEmpty()) missing.add("附表11 当月无购电量");
            for (ElecRecord r : ctx.energyRows()) qty = qty.add(nz(r.getQty()));
            out.add(metric("sellAgreementPnl", "售电协议损益",
                "(电网公告价 − 第三方执行价) × 附表11 当月购电量",
                missing, posted == null || third == null ? null : posted.subtract(third).multiply(qty)));
        }
        return out;
    }

    private static ElecMetricDTO metric(String key, String label, String formula, List<String> missing, BigDecimal value) {
        return new ElecMetricDTO(key, label, missing.isEmpty() && value != null ? r2(value) : null, formula, missing);
    }

    // (kind|fee) → 有效金额:同 (表,费项) 有拆分行(sub_key≠'')以拆分 Σ 为准,忽略并存合计行;无键=该费项无任何行
    private static Map<String, BigDecimal> effectiveByKindFee(List<ElecCostEntry> rows, Map<Integer, ElecMeter> meterById) {
        Map<String, BigDecimal> total = new HashMap<>(), split = new HashMap<>();   // 键 "meterId|fee"
        for (ElecCostEntry e : rows) {
            String k = e.getMeterId() + "|" + e.getFeeKey();
            (e.getSubKey() == null || e.getSubKey().isEmpty() ? total : split).merge(k, nz(e.getAmount()), BigDecimal::add);
        }
        Map<String, BigDecimal> out = new HashMap<>();
        Set<String> keys = new HashSet<>(total.keySet());
        keys.addAll(split.keySet());
        for (String k : keys) {
            ElecMeter m = meterById.get(Integer.parseInt(k.split("\\|")[0]));
            if (m == null) continue;
            out.merge(m.getKind() + "|" + k.split("\\|")[1], split.containsKey(k) ? split.get(k) : total.get(k), BigDecimal::add);
        }
        return out;
    }

    // ── helpers ──
    private void validateFee(String kind, String feeKey, String subKey) {
        if (!feesForKind(kind).contains(feeKey))
            throw new BizException(ResultCode.BAD_REQUEST, "费项不适用于该电表类型: " + feeKey);
        if (!subKey.isEmpty() && !SUB_ALLOWED.getOrDefault(feeKey, Set.of()).contains(subKey))
            throw new BizException(ResultCode.BAD_REQUEST, "该费项不支持此拆分: " + subKey);
    }

    // upsertEntry 与 importRows 的共同出口:守卫落这一处,两个 public 各挂 @NoReviewGuard 指过来。
    // 导入是逐行判(整个方法一个 @Transactional,命中已审月即整批回滚)。
    private ElecCostEntry writeEntry(Integer meterId, String acctMonth, String feeKey, String subKey,
                                     BigDecimal amount, BigDecimal qty, String note, String source) {
        assertModelEditable(acctMonth);
        ElecCostEntry existing = entries.selectByKey(meterId, acctMonth, feeKey, subKey);
        ElecCostEntry e = existing == null ? new ElecCostEntry() : existing;
        e.setMeterId(meterId);
        e.setAcctMonth(acctMonth);
        e.setFeeKey(feeKey);
        e.setSubKey(subKey);
        e.setAmount(r2(amount));
        e.setQty(qty == null ? null : r2(qty));
        e.setNote(blankToNull(note));
        e.setSource(source);
        if (existing == null) entries.insert(e); else entries.updateById(e);
        return entries.selectById(e.getId());
    }

    private Map<Integer, ElecMeter> meterById() {
        Map<Integer, ElecMeter> out = new HashMap<>();
        for (ElecMeter m : meters.selectList(null)) out.put(m.getId(), m);
        return out;
    }

    private Map<Integer, String> meterNames() {
        Map<Integer, String> names = new HashMap<>();
        for (ElecMeter m : meters.selectList(null)) names.put(m.getId(), m.getName());
        return names;
    }

    private static ElecMeterDTO toMeterDTO(ElecMeter m) {
        return new ElecMeterDTO(m.getId(), m.getName(), m.getKind(), m.getSortNo());
    }

    private static ElecCostEntryDTO toEntryDTO(ElecCostEntry e, String meterName) {
        return new ElecCostEntryDTO(e.getId(), e.getMeterId(), meterName, e.getAcctMonth(),
            e.getFeeKey(), e.getSubKey(), r2(e.getAmount()), e.getQty() == null ? null : r2(e.getQty()),
            e.getNote(), e.getSource());
    }
}

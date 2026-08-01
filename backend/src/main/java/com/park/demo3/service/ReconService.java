package com.park.demo3.service;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.park.demo3.dto.ReconEntityDTO;
import com.park.demo3.dto.ReconEntityDTO.FeeLine;
import com.park.demo3.dto.ReconEntityDTO.LedgerCard;
import com.park.demo3.dto.ReconEntityDTO.S10Card;
import com.park.demo3.dto.ReconMarkDTO;
import com.park.demo3.dto.ReconMarkReq;
import com.park.demo3.dto.ReconMonthDTO;
import com.park.demo3.dto.ReconOverviewDTO;
import com.park.demo3.dto.ReconOverviewDTO.MonthMeta;
import com.park.demo3.entity.ManagementCompany;
import com.park.demo3.entity.MonthlyLedger;
import com.park.demo3.entity.ReconMark;
import com.park.demo3.entity.S10Record;
import com.park.demo3.entity.Tenant;
import com.park.demo3.mapper.ManagementCompanyMapper;
import com.park.demo3.mapper.MonthlyLedgerMapper;
import com.park.demo3.mapper.ReconMarkMapper;
import com.park.demo3.mapper.S10RecordMapper;
import com.park.demo3.mapper.TenantMapper;
import org.springframework.stereotype.Service;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.function.Function;

/**
 * 收入核对(P2-E):月度台账 ⇄ 附表10 同月逐租户双源对照。纯派生读模型(E6,只读跨 mapper
 * 聚合,DataHomeService 先例),仅 recon_mark 处置小表落库(E5)。不读系统时钟(确定性)。
 */
@Service
public class ReconService {
    private final MonthlyLedgerMapper ledger;
    private final S10RecordMapper s10;
    private final TenantMapper tenants;
    private final ManagementCompanyMapper companies;
    private final ReconMarkMapper marks;

    public ReconService(MonthlyLedgerMapper ledger, S10RecordMapper s10, TenantMapper tenants,
                        ManagementCompanyMapper companies, ReconMarkMapper marks) {
        this.ledger = ledger; this.s10 = s10; this.tenants = tenants;
        this.companies = companies; this.marks = marks;
    }

    private static final BigDecimal TOL = new BigDecimal("0.005");   // E3 容差
    private static BigDecimal nz(BigDecimal v) { return v == null ? BigDecimal.ZERO : v; }
    private static BigDecimal r2(BigDecimal v) { return nz(v).setScale(2, RoundingMode.HALF_UP); }

    // ── 科目映射常量(E2):台账 21 列 ⇄ s10 25 列,同科目配对 20 项;单侧独有科目 lGet/sGet 缺席=onlySide。
    //    key=FeeLine 键(配对/台账独有=台账字段名,s10 独有=s10 colId);s10Key=S10Card fees 键;
    //    label=中文科目(配对/台账独有取 ledgerColumns.ts,s10 独有取 sales-income/layout.ts)。
    //    public:台账列↔附表10列 单一事实源,V35 bill_pay_company 种子与 BillsService paymap 校验复用,禁另抄映射。 ──
    public record Fee(String key, String s10Key, String label,
                      Function<MonthlyLedger, BigDecimal> lGet, Function<S10Record, BigDecimal> sGet) {}
    public static final List<Fee> RECON_FEES = List.of(
        // 配对 20 + 台账独有 1(台账列序 §3.1)
        new Fee("factoryRent",         "factoryRent",      "厂房租金",               MonthlyLedger::getFactoryRent,         S10Record::getFactoryRent),
        new Fee("factoryMgmtFee",      "factoryMgmtFee",   "厂房企业管理服务费",     MonthlyLedger::getFactoryMgmtFee,      S10Record::getFactoryMgmtFee),
        new Fee("shopRent",            "shopRent",         "商铺、宿舍租金",         MonthlyLedger::getShopRent,            S10Record::getShopRent),
        new Fee("dormRent",            "dormRent",         "宿舍租金",               MonthlyLedger::getDormRent,            S10Record::getDormRent),
        new Fee("dormFacilitiesFee",   "dormFacilityFee",  "宿舍配套费",             MonthlyLedger::getDormFacilitiesFee,   S10Record::getDormFacilityFee),
        new Fee("shopMgmtFee",         "shopMgmtFee",      "商铺企业管理服务费",     MonthlyLedger::getShopMgmtFee,         S10Record::getShopMgmtFee),
        new Fee("factoryInfraMaint",   "infraFactory",     "厂房基础设施维护费",     MonthlyLedger::getFactoryInfraMaint,   S10Record::getInfraFactory),
        new Fee("shopInfraMaint",      "infraShop",        "商铺、宿舍基础设施维护费", MonthlyLedger::getShopInfraMaint,     S10Record::getInfraShop),
        new Fee("dormInfraMaint",      "infraDorm",        "宿舍基础设施维护费",     MonthlyLedger::getDormInfraMaint,      S10Record::getInfraDorm),
        new Fee("elevatorMaint",       "elevatorMaint",    "电梯维护费",             MonthlyLedger::getElevatorMaint,       S10Record::getElevatorMaint),
        new Fee("transformerMaint",    "transformerMaint", "变压器维护费",           MonthlyLedger::getTransformerMaint,    S10Record::getTransformerMaint),
        new Fee("landUseTax",          "landUseTax",       "土地使用税",             MonthlyLedger::getLandUseTax,          S10Record::getLandUseTax),
        new Fee("networkFee",          "networkFee",       "网络通讯费",             MonthlyLedger::getNetworkFee,          S10Record::getNetworkFee),
        new Fee("accessCtrlMaint",     "accessMaint",      "门禁设施维护费",         MonthlyLedger::getAccessCtrlMaint,     S10Record::getAccessMaint),
        new Fee("officeOtherFee",      "otherFee",         "其他费用",               MonthlyLedger::getOfficeOtherFee,      S10Record::getOtherFee),
        new Fee("dormOtherFee",        null,               "宿舍其他费用",           MonthlyLedger::getDormOtherFee,        null),
        new Fee("basicElectricity",    "elecBasic",        "基本用电费",             MonthlyLedger::getBasicElectricity,    S10Record::getElecBasic),
        new Fee("standardElectricity", "elecStd",          "基准电费",               MonthlyLedger::getStandardElectricity, S10Record::getElecStd),
        new Fee("electricityMaint",    "elecMaint",        "电维护费",               MonthlyLedger::getElectricityMaint,    S10Record::getElecMaint),
        new Fee("standardWater",       "waterStd",         "基准水费",               MonthlyLedger::getStandardWater,       S10Record::getWaterStd),
        new Fee("waterMaint",          "waterMaint",       "水维护费",               MonthlyLedger::getWaterMaint,          S10Record::getWaterMaint),
        // s10 独有 5(s10 列序)
        new Fee("officeRent",          "officeRent",       "办公室租金",             null,                                  S10Record::getOfficeRent),
        new Fee("officeMgmtFee",       "officeMgmtFee",    "办公室企业管理服务费",   null,                                  S10Record::getOfficeMgmtFee),
        new Fee("landRent",            "landRent",         "空地租金",               null,                                  S10Record::getLandRent),
        new Fee("infraOffice",         "infraOffice",      "办公室基础设施维护费",   null,                                  S10Record::getInfraOffice),
        new Fee("guaranteeRent",       "guaranteeRent",    "一栋保障房租金",         null,                                  S10Record::getGuaranteeRent));

    // ── 名录上下文(租户/公司 map):月度循环的循环不变量,overview 12 个月共享一份(不然全表×12) ──
    private record Ctx(Map<Integer, String> nameById, Map<String, Integer> idByName,
                       Map<Integer, String> coById) {}

    private Ctx loadCtx() {
        Map<Integer, String> nameById = new HashMap<>();
        Map<String, Integer> idByName = new HashMap<>();
        for (Tenant t : tenants.selectList(null)) {
            nameById.put(t.getId(), t.getCompanyName());
            idByName.putIfAbsent(t.getCompanyName(), t.getId());
        }
        Map<Integer, String> coById = new HashMap<>();
        for (ManagementCompany c : companies.selectList(null)) coById.put(c.getId(), c.getName());
        return new Ctx(nameById, idByName, coById);
    }

    // ── 整月对照:实体并集(E1)→ 逐实体两侧 Σ 逐科目比(E2/E3)→ 分卡(E4)→ 合上 marks(E5) ──
    public ReconMonthDTO month(int year, int month) {
        return month(year, month, loadCtx());
    }

    private ReconMonthDTO month(int year, int month, Ctx ctx) {
        String acctMonth = String.format("%04d-%02d", year, month);
        List<MonthlyLedger> lRows = ledger.selectList(new QueryWrapper<MonthlyLedger>()
            .eq("period_year", year).eq("period_month", month));
        List<S10Record> sRows = s10.selectList(new QueryWrapper<S10Record>().eq("acct_month", acctMonth));

        // 台账按 tenant_id → 公司名归组(FK 保证可解析)
        Map<String, List<MonthlyLedger>> lByName = new HashMap<>();
        for (MonthlyLedger l : lRows) {
            String name = ctx.nameById().getOrDefault(l.getTenantId(), "#" + l.getTenantId());
            lByName.computeIfAbsent(name, k -> new ArrayList<>()).add(l);
        }
        // s10 软引用归并键(E1):tenant_id 优先 → tenant.company_name;null 用 tenant_name(同名自然归并,否则独立实体)
        Map<String, List<S10Record>> sByName = new HashMap<>();
        for (S10Record r : sRows) {
            String name = r.getTenantId() != null
                ? ctx.nameById().getOrDefault(r.getTenantId(), r.getTenantName())
                : r.getTenantName();
            sByName.computeIfAbsent(name, k -> new ArrayList<>()).add(r);
        }
        Map<String, ReconMark> markByName = new HashMap<>();
        for (ReconMark m : marks.month(year, month)) markByName.putIfAbsent(m.getTenantName(), m);

        Set<String> names = new TreeSet<>();     // 确定性:实体键码点序
        names.addAll(lByName.keySet());
        names.addAll(sByName.keySet());

        List<ReconEntityDTO> entities = new ArrayList<>(names.size());
        for (String name : names) {
            entities.add(entity(name, lByName.getOrDefault(name, List.of()),
                sByName.getOrDefault(name, List.of()), ctx.idByName().get(name),
                ctx.coById(), markByName.get(name)));
        }
        return new ReconMonthDTO(year, month, entities);
    }

    private static ReconEntityDTO entity(String name, List<MonthlyLedger> lRows, List<S10Record> sRows,
            Integer tenantId, Map<Integer, String> coById, ReconMark mark) {
        // fees 逐科目:两侧 Σ 后比;两侧全零科目不出行;onlySide 科目不计入 diff 判定(E2 不误报)
        List<FeeLine> fees = new ArrayList<>();
        boolean pairDiff = false;
        for (Fee f : RECON_FEES) {
            BigDecimal l = f.lGet() == null ? null : r2(sum(lRows, f.lGet()));
            BigDecimal s = f.sGet() == null ? null : r2(sum(sRows, f.sGet()));
            if (nz(l).signum() == 0 && nz(s).signum() == 0) continue;
            BigDecimal delta = r2(nz(l).subtract(nz(s)));
            String onlySide = f.lGet() == null ? "s10" : f.sGet() == null ? "ledger" : null;
            if (onlySide == null && delta.abs().compareTo(TOL) > 0) pairDiff = true;
            fees.add(new FeeLine(f.key(), f.label(), l, s, delta, onlySide));
        }

        // ledgerCards:该租户跨全部公司 Σ,按公司分卡(E4);卡内费用只留非零
        Map<Integer, List<MonthlyLedger>> byCo = new TreeMap<>();
        for (MonthlyLedger l : lRows) byCo.computeIfAbsent(l.getCompanyId(), k -> new ArrayList<>()).add(l);
        List<LedgerCard> ledgerCards = new ArrayList<>(byCo.size());
        BigDecimal ledgerTotal = BigDecimal.ZERO;
        for (Map.Entry<Integer, List<MonthlyLedger>> e : byCo.entrySet()) {
            Map<String, BigDecimal> m = new LinkedHashMap<>();
            BigDecimal total = BigDecimal.ZERO;
            for (Fee f : RECON_FEES) {
                if (f.lGet() == null) continue;
                BigDecimal v = sum(e.getValue(), f.lGet());
                total = total.add(v);
                if (v.signum() != 0) m.put(f.key(), r2(v));
            }
            ledgerTotal = ledgerTotal.add(total);
            ledgerCards.add(new LedgerCard(coById.getOrDefault(e.getKey(), "#" + e.getKey()), r2(total), m));
        }

        // s10Cards:跨期区 Σ,按期分卡(E4);fees 键=s10 colId
        Map<Integer, List<S10Record>> byPhase = new TreeMap<>();
        for (S10Record r : sRows) byPhase.computeIfAbsent(r.getPhase(), k -> new ArrayList<>()).add(r);
        List<S10Card> s10Cards = new ArrayList<>(byPhase.size());
        BigDecimal s10Total = BigDecimal.ZERO;
        for (Map.Entry<Integer, List<S10Record>> e : byPhase.entrySet()) {
            Map<String, BigDecimal> m = new LinkedHashMap<>();
            BigDecimal total = BigDecimal.ZERO;
            for (Fee f : RECON_FEES) {
                if (f.sGet() == null) continue;
                BigDecimal v = sum(e.getValue(), f.sGet());
                total = total.add(v);
                if (v.signum() != 0) m.put(f.s10Key(), r2(v));
            }
            s10Total = s10Total.add(total);
            s10Cards.add(new S10Card(e.getKey(), r2(total), m));
        }

        // 状态三档(E3):miss=仅一侧有行;diff=配对科目有不等;ok=配对科目全等(|delta|<=0.005 视等)
        String status = (lRows.isEmpty() || sRows.isEmpty()) ? "miss" : pairDiff ? "diff" : "ok";
        return new ReconEntityDTO(tenantId, name, status, r2(ledgerTotal), r2(s10Total),
            r2(ledgerTotal.subtract(s10Total)), mark != null, mark == null ? null : mark.getNote(),
            fees, ledgerCards, s10Cards);
    }

    private static <T> BigDecimal sum(List<T> rows, Function<T, BigDecimal> get) {
        BigDecimal t = BigDecimal.ZERO;
        for (T r : rows) t = t.add(nz(get.apply(r)));
        return t;
    }

    // ── overview:逐月复用整月算法只取 counts(实体量小);year 缺省=两本账有数据的最大年(确定性,不读时钟) ──
    public ReconOverviewDTO overview(Integer year) {
        int y = year != null ? year : defaultYear();
        Ctx ctx = loadCtx();
        List<MonthMeta> months = new ArrayList<>(12);
        for (int m = 1; m <= 12; m++) {
            List<ReconEntityDTO> es = month(y, m, ctx).entities();
            int ok = 0, diff = 0, miss = 0;
            for (ReconEntityDTO e : es) {
                switch (e.status()) { case "ok" -> ok++; case "diff" -> diff++; default -> miss++; }
            }
            months.add(new MonthMeta(m, !es.isEmpty(), es.size(), ok, diff, miss));
        }
        return new ReconOverviewDTO(y, months);
    }

    private int defaultYear() {
        int max = 0;
        for (Object o : ledger.selectObjs(new QueryWrapper<MonthlyLedger>().select("MAX(period_year)"))) {
            if (o instanceof Number n) max = Math.max(max, n.intValue());
        }
        // 年前缀数值 MAX。脏数据口径与原逐行 parseInt-忽略不严格等价(数字前缀截断计入/负号回绕),
        // 但 acct_month CHAR(7) 全部写入路径经应用层 \d{4}-\d{2} 校验,造不出脏行;3000-01 探针 IT 锁默认年。
        for (Object o : s10.selectObjs(new QueryWrapper<S10Record>()
                .select("MAX(CAST(LEFT(acct_month, 4) AS UNSIGNED))"))) {
            if (o instanceof Number n) max = Math.max(max, n.intValue());
        }
        return max == 0 ? 2024 : max;   // 无数据兜底(种子保证不会发生)
    }

    // ── mark upsert:按 uk(year,month,tenant_name) 有则更新 note/tenant_id,无则插入(E5) ──
    public ReconMarkDTO mark(int year, int month, ReconMarkReq req) {
        ReconMark m = marks.selectOne(new QueryWrapper<ReconMark>()
            .eq("year", year).eq("month", month).eq("tenant_name", req.tenantName()));
        if (m == null) {
            m = new ReconMark();
            m.setYear(year); m.setMonth(month); m.setTenantName(req.tenantName());
            m.setTenantId(req.tenantId()); m.setNote(req.note());
            marks.insert(m);
        } else {
            m.setTenantId(req.tenantId()); m.setNote(req.note());
            marks.updateById(m);
        }
        return new ReconMarkDTO(m.getId(), year, month, m.getTenantId(), m.getTenantName(), m.getNote());
    }

    // ── 取消核实=删除(幂等,不存在静默) ──
    public void unmark(int year, int month, String tenantName) {
        marks.delete(new QueryWrapper<ReconMark>()
            .eq("year", year).eq("month", month).eq("tenant_name", tenantName));
    }
}

package com.park.demo3.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.park.demo3.dto.AnalysisLedgerRowDTO;
import com.park.demo3.dto.AnalysisMonthsDTO;
import com.park.demo3.dto.AnalysisS10RowDTO;
import com.park.demo3.entity.*;
import com.park.demo3.mapper.*;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.*;
import java.util.stream.Collectors;

/**
 * P3 经营分析层只读聚合(spec 2026-07-07 §架构):零新表、零写路径。
 * 仅补前端确缺的「一次拉全」形状:①各源 distinct 月份并集(期间派生);
 * ②s10 租户×月 slim(替代 月×期 20 次取数);③台账 租户×公司×月 slim(替代 6公司×N月逐月取数)。
 * 其余屏数据一律走既有控制器端点。
 */
@Service
public class AnalysisService {

    private final PnlRowMapper pnl;
    private final S10RecordMapper s10;
    private final MonthlyLedgerMapper ledger;
    private final PvRecordMapper pv;
    private final ElecRecordMapper elec;
    private final ChargingRecordMapper charging;
    private final OfficeRecordMapper office;
    private final ReportAmountMapper reports;
    private final ManagementCompanyMapper companies;
    private final TenantMapper tenants;

    public AnalysisService(PnlRowMapper pnl, S10RecordMapper s10, MonthlyLedgerMapper ledger,
                           PvRecordMapper pv, ElecRecordMapper elec, ChargingRecordMapper charging,
                           OfficeRecordMapper office, ReportAmountMapper reports,
                           ManagementCompanyMapper companies, TenantMapper tenants) {
        this.pnl = pnl; this.s10 = s10; this.ledger = ledger; this.pv = pv; this.elec = elec;
        this.charging = charging; this.office = office; this.reports = reports;
        this.companies = companies; this.tenants = tenants;
    }

    private static BigDecimal nz(BigDecimal v) { return v == null ? BigDecimal.ZERO : v; }
    private static BigDecimal r2(BigDecimal v) { return nz(v).setScale(2, RoundingMode.HALF_UP); }
    private static String ym(Number year, Number month) {
        return String.format("%d-%02d", year.intValue(), month.intValue());
    }

    // acct_month 类表的 distinct 月份(selectObjs 只取一列,避免拉整实体)
    private static <T> List<String> distinctAcctMonths(com.baomidou.mybatisplus.core.mapper.BaseMapper<T> m) {
        return m.selectObjs(new QueryWrapper<T>().select("distinct acct_month").orderByAsc("acct_month"))
            .stream().map(String::valueOf).toList();
    }

    // s5 底带大合计行标签,与前端 anaData.ts 的 S5_GRAND_LABEL 同值;两处改一处必须改另一处。
    private static final String S5_GRAND_LABEL = "运营费用总计";

    /** 「某月有损益覆盖」的唯一判据(METRIC-SOURCE-SPEC §1.1/§4)。
     *  本方法是前端 extractPnlBand(analysis/anaData.ts)取数条件的**逐字镜像**——规范 §4 要求
     *  「判定某期有数据的判据必须与该屏实际消费的判据是同一个」,只要两边宽窄不一致,
     *  默认期就会落到「有行但取不到数」的月:驾驶舱主区全「—」,看着像系统没数据。
     *  旧判据「任一行该月非 null」正是这么炸的(s2 那 9 行光伏 detail/subtotal 让 2026-01 被判有数)。
     *  s5 单列一支:前端只认「运营费用总计」这一行,不看 groupLabel —— 库里 groupLabel='' 的 s5 total
     *  另有「修缮、改造费用」「管理费用总计」「财务费用合计」三行,按它们判覆盖同样会落空月。
     *  groupLabel 用 equals("") 而非判空:前端 `r.groupLabel !== ''` 同样把 null 排除在底带外。 */
    static boolean isPnlBandRow(PnlRow r) {
        String label = r.getLabel() == null ? "" : r.getLabel();
        if ("s5".equals(r.getSchedule()))
            return "total".equals(r.getKind()) && label.startsWith(S5_GRAND_LABEL);
        if (!"".equals(r.getGroupLabel())) return false;
        if ("pnl".equals(r.getKind())) return true;
        return "total".equals(r.getKind()) && (label.contains("收入") || label.contains("成本"));
    }

    // ── GET /api/analysis/months:各源 distinct 月份 + 并集 ──
    public AnalysisMonthsDTO months() {
        Map<String, List<String>> sources = new LinkedHashMap<>();

        // pnl:某月有覆盖 = 园区底带行该月列非 null(null=未录,区分 0)
        Set<String> pnlMonths = new TreeSet<>();
        for (PnlRow r : pnl.selectList(null)) {
            if (!isPnlBandRow(r)) continue;
            BigDecimal[] ms = { r.getM1(), r.getM2(), r.getM3(), r.getM4(), r.getM5(), r.getM6(),
                                r.getM7(), r.getM8(), r.getM9(), r.getM10(), r.getM11(), r.getM12() };
            for (int i = 0; i < 12; i++) if (ms[i] != null) pnlMonths.add(ym(r.getYear(), i + 1));
        }
        sources.put("pnl", List.copyOf(pnlMonths));

        sources.put("s10", distinctAcctMonths(s10));
        sources.put("ledger", ledger.selectMaps(new QueryWrapper<MonthlyLedger>()
                .select("distinct period_year", "period_month")).stream()
            .map(m -> ym((Number) m.get("period_year"), (Number) m.get("period_month")))
            .sorted().toList());
        sources.put("pv", distinctAcctMonths(pv));
        sources.put("elec", distinctAcctMonths(elec));
        sources.put("charging", distinctAcctMonths(charging));
        sources.put("office", distinctAcctMonths(office));
        sources.put("report", reports.selectMaps(new QueryWrapper<ReportAmount>()
                .select("distinct `year`", "`month`")).stream()
            .map(m -> ym((Number) m.get("year"), (Number) m.get("month")))
            .sorted().toList());

        List<String> union = sources.values().stream().flatMap(List::stream)
            .distinct().sorted().toList();
        return new AnalysisMonthsDTO(union, sources);
    }

    // ── GET /api/analysis/s10-tenant-months:全部 s10 行 slim 化 ──
    public List<AnalysisS10RowDTO> s10TenantMonths() {
        return s10.selectList(new QueryWrapper<S10Record>()
                .orderByAsc("acct_month").orderByAsc("phase").orderByAsc("tenant_name").orderByAsc("id"))
            .stream()
            .map(r -> new AnalysisS10RowDTO(
                r.getAcctMonth(), r.getPhase(), r.getTenantId(), r.getTenantName(),
                r2(nz(r.getElecBasic()).add(nz(r.getElecStd())).add(nz(r.getElecMaint()))),
                r2(nz(r.getWaterStd()).add(nz(r.getWaterMaint()))),
                S10Service.rowTotal(r)))
            .toList();
    }

    // ── GET /api/analysis/ledger-tenant-months:全部台账行 slim 化(receivable/balanceEnd 同 LedgerService.recalc) ──
    public List<AnalysisLedgerRowDTO> ledgerTenantMonths() {
        Map<Integer, String> companyNames = companies.selectList(null).stream()
            .collect(Collectors.toMap(ManagementCompany::getId, ManagementCompany::getName));
        Map<Integer, String> tenantNames = tenants.selectList(null).stream()
            .collect(Collectors.toMap(Tenant::getId, Tenant::getCompanyName));
        return ledger.selectList(new QueryWrapper<MonthlyLedger>()
                .orderByAsc("period_year").orderByAsc("period_month").orderByAsc("company_id").orderByAsc("tenant_id"))
            .stream()
            .map(l -> {
                BigDecimal[] derived = LedgerService.recalc(l);
                return new AnalysisLedgerRowDTO(
                    l.getCompanyId(), companyNames.getOrDefault(l.getCompanyId(), "（未知公司）"),
                    l.getPeriodYear(), l.getPeriodMonth(),
                    l.getTenantId(),
                    l.getTenantId() != null
                        ? tenantNames.getOrDefault(l.getTenantId(), "（已删除租户）")
                        : (l.getTenantName() != null ? l.getTenantName() : "（未命名）"),   // V105 未绑定行走账面名
                    r2(l.getBalancePrev()), derived[0], r2(l.getTotalCollected()), derived[1]);
            })
            .toList();
    }
}

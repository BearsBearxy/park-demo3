package com.park.demo3.service;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import com.park.demo3.dto.BillRowDTO;
import com.park.demo3.dto.BillS10RowDTO;
import com.park.demo3.dto.PayMapReq;
import com.park.demo3.entity.BillPayCompany;
import com.park.demo3.entity.ManagementCompany;
import com.park.demo3.entity.MonthlyLedger;
import com.park.demo3.entity.S10Record;
import com.park.demo3.entity.Tenant;
import com.park.demo3.mapper.BillPayCompanyMapper;
import com.park.demo3.mapper.ManagementCompanyMapper;
import com.park.demo3.mapper.MonthlyLedgerMapper;
import com.park.demo3.mapper.S10RecordMapper;
import com.park.demo3.mapper.TenantMapper;
import com.park.demo3.security.NoReviewGuard;
import org.springframework.stereotype.Service;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class BillsService {
    private final MonthlyLedgerMapper ledger;
    private final ManagementCompanyMapper companies;
    private final TenantMapper tenants;
    private final S10RecordMapper s10;
    private final BillPayCompanyMapper payMap;

    public BillsService(MonthlyLedgerMapper ledger, ManagementCompanyMapper companies,
                        TenantMapper tenants, S10RecordMapper s10, BillPayCompanyMapper payMap) {
        this.ledger = ledger; this.companies = companies; this.tenants = tenants; this.s10 = s10;
        this.payMap = payMap;
    }

    // 附表10 25 colId 合法集(单一事实源=ReconService.RECON_FEES,s10Key 非空即附表10列,禁另抄映射)
    private static final Set<String> S10_FEE_KEYS = ReconService.RECON_FEES.stream()
            .map(ReconService.Fee::s10Key).filter(Objects::nonNull)
            .collect(Collectors.toUnmodifiableSet());

    private static BigDecimal nz(BigDecimal v) { return v == null ? BigDecimal.ZERO : v; }
    private static BigDecimal r2(BigDecimal v) { return nz(v).setScale(2, RoundingMode.HALF_UP); }

    /** 该期全部公司的账单行(台账 × 租户/parent × 公司)。无数据期返回空数组,不 404。 */
    public List<BillRowDTO> bills(int year, int month) {
        List<MonthlyLedger> rows = new ArrayList<>(ledger.selectPeriod(year, month));
        rows.sort(Comparator.comparing(MonthlyLedger::getCompanyId)
                .thenComparing(MonthlyLedger::getTenantId,
                    Comparator.nullsLast(Comparator.naturalOrder())));   // V105:未绑定行垫底

        Map<Integer, String> cName = companies.selectList(null).stream()
            .collect(Collectors.toMap(ManagementCompany::getId, ManagementCompany::getName));
        // ponytail: 全量租户一次取回(300+ 量级),parentName 由 parent_id 同表二跳解析,免 join SQL
        Map<Integer, Tenant> tMap = tenants.selectList(null).stream()
            .collect(Collectors.toMap(Tenant::getId, t -> t));

        List<BillRowDTO> out = new ArrayList<>(rows.size());
        for (MonthlyLedger l : rows) {
            Tenant t = l.getTenantId() != null ? tMap.get(l.getTenantId()) : null;
            Integer parentId = t != null ? t.getParentId() : null;
            Tenant p = parentId != null ? tMap.get(parentId) : null;
            // 口径铁律:应收合计/期末结余复用 LedgerService.recalc,绝不另算一套
            BigDecimal[] d = LedgerService.recalc(l);
            out.add(new BillRowDTO(
                l.getCompanyId(), cName.getOrDefault(l.getCompanyId(), ""),
                l.getTenantId(),
                t != null ? t.getCompanyName()
                          : (l.getTenantName() != null ? l.getTenantName() : "（已删除租户）"),
                parentId, p != null ? p.getCompanyName() : null,
                r2(l.getBalancePrev()),
                r2(l.getFactoryRent()), r2(l.getFactoryMgmtFee()),
                r2(l.getShopRent()), r2(l.getDormRent()),
                r2(l.getDormFacilitiesFee()), r2(l.getShopMgmtFee()),
                r2(l.getFactoryInfraMaint()), r2(l.getShopInfraMaint()),
                r2(l.getDormInfraMaint()),
                r2(l.getElevatorMaint()), r2(l.getTransformerMaint()),
                r2(l.getLandUseTax()), r2(l.getNetworkFee()),
                r2(l.getAccessCtrlMaint()), r2(l.getOfficeOtherFee()),
                r2(l.getDormOtherFee()),
                r2(l.getBasicElectricity()), r2(l.getStandardElectricity()),
                r2(l.getElectricityMaint()),
                r2(l.getStandardWater()), r2(l.getWaterMaint()),
                r2(l.getTotalCollected()),
                d[0], d[1]));
        }
        return out;
    }

    /** 该期全部附表10行(应收口径,账单工资条明细)。空期空数组,不 404。 */
    public List<BillS10RowDTO> s10Bills(int year, int month) {
        List<BillS10RowDTO> out = new ArrayList<>();
        for (S10Record r : s10.selectByMonth(String.format("%d-%02d", year, month))) {
            out.add(new BillS10RowDTO(
                r.getTenantId(), r.getTenantName(), r.getPhase(),
                r2(r.getOfficeRent()), r2(r.getOfficeMgmtFee()),
                r2(r.getFactoryRent()), r2(r.getFactoryMgmtFee()),
                r2(r.getLandRent()),
                r2(r.getShopRent()), r2(r.getShopMgmtFee()),
                r2(r.getDormRent()), r2(r.getDormFacilityFee()),
                r2(r.getInfraOffice()), r2(r.getInfraFactory()),
                r2(r.getInfraShop()), r2(r.getInfraDorm()),
                r2(r.getElevatorMaint()), r2(r.getTransformerMaint()),
                r2(r.getLandUseTax()), r2(r.getNetworkFee()),
                r2(r.getAccessMaint()), r2(r.getOtherFee()),
                r2(r.getElecBasic()), r2(r.getElecStd()), r2(r.getElecMaint()),
                r2(r.getWaterStd()), r2(r.getWaterMaint()),
                r2(r.getGuaranteeRent())));
        }
        return out;
    }

    // ── 收款公司指引(BILLS-SPEC §5):tenant×fee_key→company,与台账记账完全不联动 ──

    /** 全量映射(量级=租户数×≤20 配对列,一次取回前端自组索引)。 */
    public List<BillPayCompany> paymap() {
        return payMap.selectList(null);
    }

    /** 指引 upsert:feeKey 须为附表10 25 colId 之一,租户/公司须存在。 */
    // ⚠ 这条 reason 2026-09-09 改写过一次。改前写的是「唯一读者是 GET /api/bills/paymap,
    //   一分钱不经过它」—— 那是**假的**:BillNoticeService.generate(ym) 读它(payByTenant)决定
    //   每个费项挂哪个收款主体,进而决定拆单键 uk_notice(ym,tenant_id,pay_company_id,notice_kind)。
    //   结论没变,理由必须是实话:下一个人照着「一分钱不经过它」去推别的路径就会推错。
    @NoReviewGuard(reason = "upsert bill_pay_company(tenant_id,fee_key,company_id),V34 建表三列就是全部业务字段、无任何 ym 列。它确实是 BillNoticeService.generate(ym) 的输入(payByTenant 决定每个费项挂哪个收款主体、进而决定拆单键),但落库只发生在 generate 那一刻,而 generate 开头就守着 BILL_NOTICES:已审月重跑不了,改指引只影响下一次能跑的月;已审月的 bill_notice.pay_company_id 是出账时的快照,改这张表动不了它")
    public void savePaymap(PayMapReq req) {
        if (!S10_FEE_KEYS.contains(req.feeKey()))
            throw new BizException(ResultCode.BAD_REQUEST, "无效费用项 " + req.feeKey() + "：须为附表10费用列");
        if (tenants.selectById(req.tenantId()) == null)
            throw new BizException(ResultCode.NOT_FOUND, "租户不存在");
        if (companies.selectById(req.companyId()) == null)
            throw new BizException(ResultCode.NOT_FOUND, "公司不存在");
        payMap.upsertPay(req.tenantId(), req.feeKey(), req.companyId());
    }
}

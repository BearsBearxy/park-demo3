package com.park.demo3.service;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import com.park.demo3.common.ExtraFees;
import com.park.demo3.dto.BookDtos.ArchivedColDTO;
import com.park.demo3.dto.LedgerMonthDTO;
import com.park.demo3.dto.LedgerMonthDTO.LedgerFooter;
import com.park.demo3.dto.LedgerMonthDTO.LedgerRowDTO;
import com.park.demo3.dto.LedgerOverviewDTO;
import com.park.demo3.dto.LedgerOverviewDTO.MonthMeta;
import com.park.demo3.dto.LedgerSaveRequest;
import com.park.demo3.dto.ImportResultDTO;
import com.park.demo3.dto.ImportError;
import com.park.demo3.dto.LedgerImportRequest;
import com.park.demo3.dto.TenantBindReq;
import com.park.demo3.dto.BindResultDTO;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.park.demo3.dto.YearMonthsDTO;
import com.park.demo3.entity.LedgerBook;
import com.park.demo3.entity.ManagementCompany;
import com.park.demo3.entity.MonthlyLedger;
import com.park.demo3.entity.Tenant;
import com.park.demo3.mapper.ManagementCompanyMapper;
import com.park.demo3.mapper.MonthlyLedgerMapper;
import com.park.demo3.mapper.TenantMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.*;
import java.util.function.BiConsumer;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
public class LedgerService {
    private final MonthlyLedgerMapper ledger;
    private final ManagementCompanyMapper companies;
    private final TenantMapper tenants;
    private final BookService bookService;
    private final BookPinService pinService;

    public LedgerService(MonthlyLedgerMapper ledger, ManagementCompanyMapper companies,
                         TenantMapper tenants, BookService bookService, BookPinService pinService) {
        this.ledger = ledger; this.companies = companies; this.tenants = tenants;
        this.bookService = bookService; this.pinService = pinService;
    }

    // P6:该月第一次落库数据时固化 pin。不固化的话,日后改更早月份的 pin 会顺着解析规则把本月一起改掉。
    private void materializePin(Integer companyId, int year, int month) {
        LedgerBook b = bookService.bookOfCompany(companyId);
        if (b == null) return;
        pinService.materialize("ledger", companyId, year, month,
            pinService.resolve("ledger", companyId, year, month, bookService.chainBookId(b)));
    }

    // 21 费用列读取器(顺序同 §3.1)
    private static final List<Function<MonthlyLedger, BigDecimal>> FEE_GET = List.of(
        MonthlyLedger::getFactoryRent, MonthlyLedger::getFactoryMgmtFee,
        MonthlyLedger::getShopRent, MonthlyLedger::getDormRent,
        MonthlyLedger::getDormFacilitiesFee, MonthlyLedger::getShopMgmtFee,
        MonthlyLedger::getFactoryInfraMaint, MonthlyLedger::getShopInfraMaint,
        MonthlyLedger::getDormInfraMaint,
        MonthlyLedger::getElevatorMaint, MonthlyLedger::getTransformerMaint,
        MonthlyLedger::getLandUseTax, MonthlyLedger::getNetworkFee,
        MonthlyLedger::getAccessCtrlMaint, MonthlyLedger::getOfficeOtherFee,
        MonthlyLedger::getDormOtherFee,
        MonthlyLedger::getBasicElectricity, MonthlyLedger::getStandardElectricity,
        MonthlyLedger::getElectricityMaint,
        MonthlyLedger::getStandardWater, MonthlyLedger::getWaterMaint);

    private static final List<BiConsumer<MonthlyLedger, BigDecimal>> FEE_SET = List.of(
        MonthlyLedger::setFactoryRent, MonthlyLedger::setFactoryMgmtFee,
        MonthlyLedger::setShopRent, MonthlyLedger::setDormRent,
        MonthlyLedger::setDormFacilitiesFee, MonthlyLedger::setShopMgmtFee,
        MonthlyLedger::setFactoryInfraMaint, MonthlyLedger::setShopInfraMaint,
        MonthlyLedger::setDormInfraMaint,
        MonthlyLedger::setElevatorMaint, MonthlyLedger::setTransformerMaint,
        MonthlyLedger::setLandUseTax, MonthlyLedger::setNetworkFee,
        MonthlyLedger::setAccessCtrlMaint, MonthlyLedger::setOfficeOtherFee,
        MonthlyLedger::setDormOtherFee,
        MonthlyLedger::setBasicElectricity, MonthlyLedger::setStandardElectricity,
        MonthlyLedger::setElectricityMaint,
        MonthlyLedger::setStandardWater, MonthlyLedger::setWaterMaint);

    // request 行的 21 费用读取器(同序)
    private static final List<Function<LedgerSaveRequest.Row, BigDecimal>> REQ_GET = List.of(
        LedgerSaveRequest.Row::factoryRent, LedgerSaveRequest.Row::factoryMgmtFee,
        LedgerSaveRequest.Row::shopRent, LedgerSaveRequest.Row::dormRent,
        LedgerSaveRequest.Row::dormFacilitiesFee, LedgerSaveRequest.Row::shopMgmtFee,
        LedgerSaveRequest.Row::factoryInfraMaint, LedgerSaveRequest.Row::shopInfraMaint,
        LedgerSaveRequest.Row::dormInfraMaint,
        LedgerSaveRequest.Row::elevatorMaint, LedgerSaveRequest.Row::transformerMaint,
        LedgerSaveRequest.Row::landUseTax, LedgerSaveRequest.Row::networkFee,
        LedgerSaveRequest.Row::accessCtrlMaint, LedgerSaveRequest.Row::officeOtherFee,
        LedgerSaveRequest.Row::dormOtherFee,
        LedgerSaveRequest.Row::basicElectricity, LedgerSaveRequest.Row::standardElectricity,
        LedgerSaveRequest.Row::electricityMaint,
        LedgerSaveRequest.Row::standardWater, LedgerSaveRequest.Row::waterMaint);

    // import 行的 21 费用读取器(同序),用于逐行定向 upsert(走 FEE_SET)
    private static final List<Function<LedgerImportRequest.Row, BigDecimal>> IMP_GET = List.of(
        LedgerImportRequest.Row::factoryRent, LedgerImportRequest.Row::factoryMgmtFee,
        LedgerImportRequest.Row::shopRent, LedgerImportRequest.Row::dormRent,
        LedgerImportRequest.Row::dormFacilitiesFee, LedgerImportRequest.Row::shopMgmtFee,
        LedgerImportRequest.Row::factoryInfraMaint, LedgerImportRequest.Row::shopInfraMaint,
        LedgerImportRequest.Row::dormInfraMaint,
        LedgerImportRequest.Row::elevatorMaint, LedgerImportRequest.Row::transformerMaint,
        LedgerImportRequest.Row::landUseTax, LedgerImportRequest.Row::networkFee,
        LedgerImportRequest.Row::accessCtrlMaint, LedgerImportRequest.Row::officeOtherFee,
        LedgerImportRequest.Row::dormOtherFee,
        LedgerImportRequest.Row::basicElectricity, LedgerImportRequest.Row::standardElectricity,
        LedgerImportRequest.Row::electricityMaint,
        LedgerImportRequest.Row::standardWater, LedgerImportRequest.Row::waterMaint);

    private static BigDecimal nz(BigDecimal v) { return v == null ? BigDecimal.ZERO : v; }
    private static BigDecimal r2(BigDecimal v) { return nz(v).setScale(2, RoundingMode.HALF_UP); }

    // 共享派生:返回 [totalReceivable, balanceEnd]。
    // 方案A(SPEC §2):应收Σ = 21 物理列 + extra_fees 口袋全部值;全站唯一口径,消费方禁止自算。
    static BigDecimal[] recalc(MonthlyLedger l) {
        BigDecimal recv = ExtraFees.sum(l.getExtraFees());
        for (var g : FEE_GET) recv = recv.add(nz(g.apply(l)));
        BigDecimal end = nz(l.getBalancePrev()).add(recv).subtract(nz(l.getTotalCollected()));
        return new BigDecimal[]{ recv.setScale(2, RoundingMode.HALF_UP), end.setScale(2, RoundingMode.HALF_UP) };
    }

    // ── 年份门:有数据的年份 + 各年已录入月份数 ──
    public List<YearMonthsDTO> years(Integer companyId) {
        if (companies.selectById(companyId) == null) throw new BizException(ResultCode.NOT_FOUND, "公司不存在");
        return ledger.yearsWithMonths(companyId).stream()
            .map(m -> new YearMonthsDTO(((Number) m.get("year")).intValue(), ((Number) m.get("months")).intValue()))
            .toList();
    }

    // ── 结余链写时归一(2026-08-24 拍板;2026-08-25 修订为**严格相邻**) ──
    // 「上月结余」只能是**上一个自然月**的期末:某户在 (y,m) 的 balance_prev,
    // 仅当该户在 (y,m-1) 有记录时才强制派生;上一自然月没记录 → 该月是链起点,
    // 保留存量 balance_prev(期初,人工/导入唯一可录的位置)。
    // ⚠ 早期版本按「上一个有据月」跨空洞前滚 —— 零散补录历史月会把后面月份的期初改坏
    //   (实例:B2 只补了 2024-01,2025-01 的期初被它的期末覆盖,跳过 2024 年 11 个月)。
    // 任何写入(保存/导入/复制上月/绑定/改名)后调用;读路径与 recalc 口径零改动。
    @Transactional
    public void rechain(Integer companyId) {
        List<MonthlyLedger> all = ledger.selectList(new QueryWrapper<MonthlyLedger>()
            .eq("company_id", companyId)
            .orderByAsc("period_year").orderByAsc("period_month"));
        // key → [上次出现的 ym 序号, 该月期末];ym 序号 = year*12 + (month-1),相邻即差 1
        Map<String, long[]> last = new HashMap<>();
        Map<String, BigDecimal> lastEnd = new HashMap<>();
        for (MonthlyLedger l : all) {
            String key = chainKey(l);
            long ym = ymIndex(l.getPeriodYear(), l.getPeriodMonth());
            long[] prev = last.get(key);
            if (prev != null && prev[0] == ym - 1) {          // 紧邻上月有记录 → 派生位
                BigDecimal expect = lastEnd.get(key);
                if (r2(nz(l.getBalancePrev())).compareTo(expect) != 0) {
                    l.setBalancePrev(expect);
                    ledger.updateById(l);
                } else {
                    l.setBalancePrev(expect);                 // 仅 scale 差:内存对齐不落库
                }
            }                                                  // 否则:链起点,期初原样保留
            last.put(key, new long[]{ ym });
            lastEnd.put(key, recalc(l)[1]);
        }
    }

    private static long ymIndex(int year, int month) { return (long) year * 12 + (month - 1); }

    private static String chainKey(MonthlyLedger l) {
        return l.getTenantId() != null ? "t:" + l.getTenantId() : "n:" + nzs(l.getTenantName()).trim();
    }

    /** **上一个自然月**的链上状态:键 → 该月期末与身份(严格相邻,不跨空洞)。
     *  month() 用它标派生位并生成结转虚行;save()/importRows 用键集判定结余是否为派生位。
     *  上一自然月没这户 = 本月是链起点 → 结余是期初,可人工录/可导入。 */
    private record Prior(Integer tenantId, String tenantName, BigDecimal end) {}
    private Map<String, Prior> prevMonthChain(Integer companyId, int year, int month) {
        int pm = prevMonth(month), py = month == 1 ? year - 1 : year;
        Map<String, Prior> out = new HashMap<>();
        for (MonthlyLedger l : ledger.selectMonth(companyId, py, pm))
            out.put(chainKey(l), new Prior(l.getTenantId(), l.getTenantName(), recalc(l)[1]));
        return out;
    }

    // ── overview ──
    public LedgerOverviewDTO overview(Integer companyId, int year) {
        ManagementCompany company = companies.selectById(companyId);
        if (company == null) throw new BizException(ResultCode.NOT_FOUND, "公司不存在");

        Map<Integer, List<MonthlyLedger>> byMonth = ledger.selectYear(companyId, year).stream()
            .collect(Collectors.groupingBy(MonthlyLedger::getPeriodMonth));

        int maxMonth = byMonth.keySet().stream().mapToInt(Integer::intValue).max().orElse(0);

        List<MonthMeta> months = new ArrayList<>(12);
        BigDecimal ytd = BigDecimal.ZERO;
        int monthsWithData = 0;
        for (int m = 1; m <= 12; m++) {
            List<MonthlyLedger> rows = byMonth.get(m);
            if (rows == null || rows.isEmpty()) {
                months.add(new MonthMeta(m, BigDecimal.ZERO.setScale(2), BigDecimal.ZERO.setScale(2), 0, "empty"));
                continue;
            }
            monthsWithData++;
            BigDecimal recv = BigDecimal.ZERO, coll = BigDecimal.ZERO;
            int tenantCount = 0;
            for (MonthlyLedger l : rows) {
                BigDecimal r = recalc(l)[0];
                recv = recv.add(r);
                coll = coll.add(nz(l.getTotalCollected()));
                if (r.signum() > 0) tenantCount++;
            }
            ytd = ytd.add(recv);
            String status = (m == maxMonth) ? "current" : "done";
            months.add(new MonthMeta(m, r2(recv), r2(coll), tenantCount, status));
        }

        BigDecimal avg = monthsWithData == 0 ? BigDecimal.ZERO
            : ytd.divide(BigDecimal.valueOf(monthsWithData), 2, RoundingMode.HALF_UP);
        return new LedgerOverviewDTO(company.getName(), year, monthsWithData,
            r2(ytd), r2(avg), activeTenants().size(), months);
    }

    // ── month read(稀疏补零成全部在租租户) ──
    // 只返回有存储行的租户(原「稀疏补零成全部在租租户」在真实数据 300+ 租户池下会让每家公司
    // 的台账铺满无关零行);新租户入账走编辑态「添加租户行」或导入。历史行的退租租户名照常显示。
    public LedgerMonthDTO month(Integer companyId, int year, int month) {
        ManagementCompany company = companies.selectById(companyId);
        if (company == null) throw new BizException(ResultCode.NOT_FOUND, "公司不存在");

        List<MonthlyLedger> stored = new ArrayList<>(ledger.selectMonth(companyId, year, month));
        // V105:tenant_id 可空(未绑定行)。绑定行按 tenantId 稳序在前,未绑定行按账面名垫底
        stored.sort(Comparator.comparing(MonthlyLedger::getTenantId,
                Comparator.nullsLast(Comparator.naturalOrder()))
            .thenComparing(l -> nzs(l.getTenantName())));
        Map<String, Prior> prior = prevMonthChain(companyId, year, month);
        Set<String> present = stored.stream().map(LedgerService::chainKey).collect(Collectors.toSet());
        // 结转虚行(2026-08-24 拍板):**上月**期末≠0 且本月无存储行的键 → 只带结余的虚行
        // (不落库,费用列留空);编辑态在虚行录数,保存即落成真行。期末=0 的老户自然消失。
        // 严格相邻:上月没账就不结转——中间断月时不拿更早的期末冒充「上月结余」。
        List<MonthlyLedger> carried = new ArrayList<>();
        for (Map.Entry<String, Prior> e : prior.entrySet()) {
            if (present.contains(e.getKey()) || e.getValue().end().signum() == 0) continue;
            MonthlyLedger v = zeroRow(companyId, e.getValue().tenantId(), year, month);
            v.setTenantName(e.getValue().tenantName());
            v.setBalancePrev(e.getValue().end());
            carried.add(v);
        }
        List<MonthlyLedger> all = new ArrayList<>(stored);
        all.addAll(carried);
        all.sort(Comparator.comparing(MonthlyLedger::getTenantId,
                Comparator.nullsLast(Comparator.naturalOrder()))
            .thenComparing(l -> nzs(l.getTenantName())));
        Set<MonthlyLedger> carriedSet = java.util.Collections.newSetFromMap(new IdentityHashMap<>());
        carriedSet.addAll(carried);

        List<Integer> boundIds = all.stream().map(MonthlyLedger::getTenantId).filter(Objects::nonNull).toList();
        Map<Integer, String> names = boundIds.isEmpty() ? Map.of()
            : tenants.selectBatchIds(boundIds).stream()
                .collect(Collectors.toMap(Tenant::getId, Tenant::getCompanyName));

        List<LedgerRowDTO> rows = new ArrayList<>(all.size());
        for (MonthlyLedger l : all)
            rows.add(toRowDTO(l, displayName(l, names), prior.containsKey(chainKey(l)), carriedSet.contains(l)));
        // 归档列(spec §2):本月有非零值、但生效模板不渲染的自定义列。
        // hidden 只该表示"不再接受新录入",不该表示"藏起已经发生的钱" —— 藏了合计就对不上明细
        Set<String> keysWithData = new LinkedHashSet<>();
        for (MonthlyLedger l : all)
            for (Map.Entry<String, BigDecimal> e : ExtraFees.parse(l.getExtraFees()).entrySet())
                if (e.getValue() != null && e.getValue().signum() != 0) keysWithData.add(e.getKey());
        List<ArchivedColDTO> archived = bookService.archivedColsAt(
            bookService.bookOfCompany(companyId), year, month, keysWithData);
        return new LedgerMonthDTO(company.getName(), year, month, prevMonth(month), rows, footer(rows), archived);
    }

    // 展示名:账面名快照优先(V105 起总有);快照缺失回退档案名(存量兜底),再退「已删除租户」
    private static String displayName(MonthlyLedger l, Map<Integer, String> archiveNames) {
        if (l.getTenantName() != null && !l.getTenantName().isBlank()) return l.getTenantName();
        if (l.getTenantId() != null) return archiveNames.getOrDefault(l.getTenantId(), "（已删除租户）");
        return "（未命名）";
    }
    private static String nzs(String s) { return s == null ? "" : s; }

    // ── save(逐行 upsert / 删空,事务) ──
    // 行身份:id(既有行,含未绑定行)优先,否则 tenantId(绑定行/编辑态新增行);两者都空报 400(评审Alt2:
    // 静默丢行会让保存 200 而数据无声消失)。原「非在租租户静默跳过」已废——退租租户的历史月台账
    // 必须可编辑(用户 2026-08-23 拍板);档案不存在的 tenantId 仍静默跳过(并发删档边界,旧口径)。
    // tenantName 提供即改快照;未绑定行**只在本次真的改了名**时才按新名自动配档(评审B5:
    // 不碰名字的行绝不静默绑定——否则日后新建同名档案,任何一次无关保存都会把历史行悄悄挂过去)。
    @Transactional
    public LedgerMonthDTO save(Integer companyId, int year, int month, LedgerSaveRequest req) {
        ManagementCompany company = companies.selectById(companyId);
        if (company == null) throw new BizException(ResultCode.NOT_FOUND, "公司不存在");

        List<MonthlyLedger> storedRows = ledger.selectMonth(companyId, year, month);
        Map<Integer, MonthlyLedger> byId = storedRows.stream()
            .collect(Collectors.toMap(MonthlyLedger::getId, l -> l));
        Map<Integer, MonthlyLedger> byTenant = storedRows.stream()
            .filter(l -> l.getTenantId() != null)
            .collect(Collectors.toMap(MonthlyLedger::getTenantId, l -> l, (a, b) -> a));

        // 未绑定行按账面名的身份索引(结转虚行/软引用行的第三径)
        Map<String, MonthlyLedger> byName = new HashMap<>();
        for (MonthlyLedger l : storedRows)
            if (l.getTenantId() == null && l.getTenantName() != null)
                byName.putIfAbsent(l.getTenantName().trim(), l);
        // 结余链键集(上一自然月):空行判定里「派生结余」不算内容(结转虚行原样送回不落库)
        Set<String> priorKeys = prevMonthChain(companyId, year, month).keySet();

        // 懒构建(评审E4):最高频的「纯改数保存」不碰租户表;出现新增行或改名的未绑定行才拉
        boolean needTenants = false;
        for (LedgerSaveRequest.Row row : req.rows()) {
            if (row.id() == null && row.tenantId() == null) {
                String nm = row.tenantName() == null ? "" : row.tenantName().trim();
                if (nm.isEmpty())
                    throw new BizException(ResultCode.BAD_REQUEST, "台账行缺少身份(tenantId / id / 账面名)");
                needTenants = true; break;   // 名径可能落新未绑定行,softIdx 配档要租户表
            }
            if (row.id() == null && byTenant.get(row.tenantId()) == null) { needTenants = true; break; }
            MonthlyLedger ex = row.id() != null ? byId.get(row.id()) : null;
            if (ex != null && ex.getTenantId() == null
                && row.tenantName() != null && !row.tenantName().isBlank()) { needTenants = true; break; }
        }
        // 保存路径口袋键校验(审查#10):归档(hidden)列在册可写;已删除列的 c_ 键拒收。
        // 词典跟着月份走(spec §6),与导入同一口径:走链尾的话,钉在旧版的月份能被写进该版没有的 c_ 列
        Set<String> allowedExtra = bookService.customIdsAt("ledger", companyId, year, month);
        Set<Integer> knownIds = Set.of();
        Map<Integer, String> archive = Map.of();
        Map<String, Integer> softIdx = Map.of();
        if (needTenants) {
            List<Tenant> allTenants = tenants.selectList(null);
            knownIds = allTenants.stream().map(Tenant::getId).collect(Collectors.toSet());
            archive = allTenants.stream()
                .collect(Collectors.toMap(Tenant::getId, Tenant::getCompanyName));
            softIdx = TenantService.softIndex(allTenants);
        }

        for (LedgerSaveRequest.Row row : req.rows()) {
            String rowKey = row.tenantId() != null ? "t:" + row.tenantId()
                : "n:" + (row.tenantName() == null ? "" : row.tenantName().trim());
            // 空判定:费用/收款/备注/口袋全空,且结余要么为 0 要么是链上派生位(不算人工内容)。
            // 结转虚行原样送回 → 空 → 不落库;真行清空 → 删除,下月自然回虚行。
            boolean blank = isBlankContent(row)
                && (priorKeys.contains(rowKey) || nz(row.balancePrev()).signum() == 0);
            MonthlyLedger existing = row.id() != null ? byId.get(row.id())
                : (row.tenantId() != null ? byTenant.get(row.tenantId())
                    : byName.get(row.tenantName().trim()));
            if (row.id() != null && existing == null) continue;             // 行已被并发删除:静默跳过
            if (existing == null && row.tenantId() == null) {                // 名径新行(结转虚行落地/软引用新行)
                if (blank) continue;
                String nm = row.tenantName().trim();
                MonthlyLedger l = zeroRow(companyId, null, year, month);
                l.setTenantName(nm);
                // 同 import 语义:能唯一配档且该租户本月无行 → 顺手绑上;否则保持未绑定
                Integer hit = softIdx.get(nm);
                if (hit != null && !byTenant.containsKey(hit)) { l.setTenantId(hit); byTenant.put(hit, l); }
                assertKnownExtraKeys(allowedExtra, row, nm);
                applyRow(l, row);
                ledger.insert(l);
                byName.put(nm, l);
                continue;
            }
            if (existing == null) {                                          // 新增行:必须带可用租户
                if (!knownIds.contains(row.tenantId())) continue;
                if (blank) continue;
                MonthlyLedger l = zeroRow(companyId, row.tenantId(), year, month);
                l.setTenantName(row.tenantName() != null && !row.tenantName().isBlank()
                    ? row.tenantName().trim() : archive.get(row.tenantId()));
                assertKnownExtraKeys(allowedExtra, row, l.getTenantName());
                applyRow(l, row);
                ledger.insert(l);
                byTenant.put(l.getTenantId(), l);
                continue;
            }
            if (blank) { ledger.deleteById(existing.getId()); continue; }
            // 改名(账面名快照;绑定行只改快照不动身份 —— 账面名与档案名允许不一致)
            String newName = row.tenantName() != null && !row.tenantName().isBlank()
                ? row.tenantName().trim() : null;
            boolean renamed = newName != null && !newName.equals(existing.getTenantName());
            if (newName != null) existing.setTenantName(newName);
            // 未绑定行 + 本次改了名 → 按新名自动配档;目标租户本月已有行则保持未绑定(uk 冲突)
            if (renamed && existing.getTenantId() == null) {
                Integer hit = softIdx.get(newName);
                if (hit != null && !byTenant.containsKey(hit)) {
                    existing.setTenantId(hit);
                    byTenant.put(hit, existing);
                }
            }
            assertKnownExtraKeys(allowedExtra, row, existing.getTenantName());
            applyRow(existing, row);
            ledger.updateById(existing);
        }
        rechain(companyId);   // 结余链:保存后前滚归一(派生位强制=上月期末;首次出现月保留人工期初)
        materializePin(companyId, year, month);
        return month(companyId, year, month);
    }

    // ── 按账面名批量绑定档案(问题面板「绑定」;跨月跨公司,同名未绑定行一次挂齐) ──
    // 目标租户在某月已有行时该行跳过(uk_ledger 冲突,不合并金额——合并是拿两行钱相加,必须人工)
    @Transactional
    public BindResultDTO bindTenant(TenantBindReq req) {
        Tenant t = tenants.selectById(req.tenantId());
        if (t == null) throw new BizException(ResultCode.NOT_FOUND, "租户不存在");
        String name = req.tenantName().trim();
        List<MonthlyLedger> unbound = ledger.selectList(
            new QueryWrapper<MonthlyLedger>()
                .isNull("tenant_id").eq("tenant_name", name));
        if (unbound.isEmpty()) return new BindResultDTO(0, 0);
        // 目标租户已占用的月份一次取回(评审E1:替代逐行 selectCount 的 N+1)
        Set<String> occupied = ledger.selectList(
                new QueryWrapper<MonthlyLedger>().eq("tenant_id", req.tenantId())).stream()
            .map(l -> l.getCompanyId() + "-" + l.getPeriodYear() + "-" + l.getPeriodMonth())
            .collect(Collectors.toSet());
        int bound = 0, conflicts = 0;
        for (MonthlyLedger l : unbound) {
            String slot = l.getCompanyId() + "-" + l.getPeriodYear() + "-" + l.getPeriodMonth();
            if (occupied.contains(slot)) { conflicts++; continue; }
            l.setTenantId(req.tenantId());
            ledger.updateById(l);
            occupied.add(slot);
            bound++;
        }
        // 绑定改写租户键(n:名 → t:id),结余链按新键重挂:重链所有涉及公司
        unbound.stream().map(MonthlyLedger::getCompanyId).distinct().forEach(this::rechain);
        return new BindResultDTO(bound, conflicts);
    }

    // ── 行级绑定/换绑/解绑(抄表屏「表档案·租户」同款交互的台账版;tenantId=null 即解绑) ──
    @Transactional
    public LedgerRowDTO bindRow(Integer rowId, Integer tenantId) {
        MonthlyLedger l = ledger.selectById(rowId);
        if (l == null) throw new BizException(ResultCode.NOT_FOUND, "台账行不存在");
        if (Objects.equals(l.getTenantId(), tenantId))
            return toRowDTO(l, displayName(l, archiveNameOf(l.getTenantId())));
        if (tenantId != null) {
            if (tenants.selectById(tenantId) == null)
                throw new BizException(ResultCode.NOT_FOUND, "租户不存在");
            // uk_ledger:该租户当月已有行 → 绑上去会撞车;合并是两行金额相加,必须人工
            Long clash = ledger.selectCount(new QueryWrapper<MonthlyLedger>()
                .eq("company_id", l.getCompanyId()).eq("period_year", l.getPeriodYear())
                .eq("period_month", l.getPeriodMonth()).eq("tenant_id", tenantId).ne("id", rowId));
            if (clash != null && clash > 0)
                throw new BizException(ResultCode.CONFLICT, "该租户当月已有台账行,不能再绑一行,请先人工合并");
        } else {
            // uk_ledger_soft:解绑后成为未绑定行,同月同名未绑定行只允许一条
            Long clash = ledger.selectCount(new QueryWrapper<MonthlyLedger>()
                .eq("company_id", l.getCompanyId()).eq("period_year", l.getPeriodYear())
                .eq("period_month", l.getPeriodMonth()).isNull("tenant_id")
                .eq("tenant_name", nzs(l.getTenantName()).trim()).ne("id", rowId));
            if (clash != null && clash > 0)
                throw new BizException(ResultCode.CONFLICT, "该月已有同名的未绑定行,解绑会重名,请先处理那一行");
        }
        // 解绑必须显式置 NULL:updateById 跳过 null 字段,tenant_id 会保持原值(强填坑,同 MP null 不更新前例)
        ledger.update(null, new com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper<MonthlyLedger>()
            .eq("id", rowId).set("tenant_id", tenantId));
        rechain(l.getCompanyId());   // 绑定/解绑改写租户键,结余链重挂
        MonthlyLedger fresh = ledger.selectById(rowId);
        return toRowDTO(fresh, displayName(fresh, archiveNameOf(fresh.getTenantId())));
    }

    // ── 行级改账面名(抽屉内即时提交,抄表「企业名称原文」同款):
    //    只动快照不动金额;未绑定行改对名字 → 按新名自动配档(与 save 改名同一规则) ──
    @Transactional
    public LedgerRowDTO renameRow(Integer rowId, String tenantName) {
        MonthlyLedger l = ledger.selectById(rowId);
        if (l == null) throw new BizException(ResultCode.NOT_FOUND, "台账行不存在");
        String newName = tenantName.trim();
        if (newName.isEmpty()) throw new BizException(ResultCode.BAD_REQUEST, "账面名不能为空");
        if (!newName.equals(l.getTenantName())) {
            if (l.getTenantId() == null) {
                // 未绑定行改名:同月同名未绑定行唯一(uk_ledger_soft),先给可读提示
                Long clash = ledger.selectCount(new QueryWrapper<MonthlyLedger>()
                    .eq("company_id", l.getCompanyId()).eq("period_year", l.getPeriodYear())
                    .eq("period_month", l.getPeriodMonth()).isNull("tenant_id")
                    .eq("tenant_name", newName).ne("id", rowId));
                if (clash != null && clash > 0)
                    throw new BizException(ResultCode.CONFLICT, "该月已有同名的未绑定行,请先处理那一行");
            }
            l.setTenantName(newName);
            // 改对名字自动配档:唯一可判定 + 该租户当月无行才挂(与 save 改名同规则)
            if (l.getTenantId() == null) {
                Integer hit = TenantService.softIndex(tenants.selectList(null)).get(newName);
                if (hit != null) {
                    Long occupied = ledger.selectCount(new QueryWrapper<MonthlyLedger>()
                        .eq("company_id", l.getCompanyId()).eq("period_year", l.getPeriodYear())
                        .eq("period_month", l.getPeriodMonth()).eq("tenant_id", hit));
                    if (occupied == null || occupied == 0) l.setTenantId(hit);
                }
            }
            ledger.updateById(l);
            rechain(l.getCompanyId());   // 未绑定行改名=改租户键(n:名),结余链重挂
        }
        return toRowDTO(l, displayName(l, archiveNameOf(l.getTenantId())));
    }

    private Map<Integer, String> archiveNameOf(Integer tenantId) {
        if (tenantId == null) return Map.of();
        Tenant t = tenants.selectById(tenantId);
        return t == null ? Map.of() : Map.of(t.getId(), t.getCompanyName());
    }

    // ── import(逐行按 tenantName 解析档案 → 列级定向 upsert 21 费用+结余/收款/备注;绝不删未导入租户) ──
    // V105 语义重做(用户 2026-08-23 拍板):
    //  · 匹配含全部状态(退租户也配——导入月当时可能还在租,原「只配在租」会把历史月整行跳掉);
    //  · 配不上不再跳过:落库为未绑定行(tenant_id=null,账面名原文保留),问题面板事后处理;
    //  · 同名多档不瞎猜(softIndex 唯一可判定才配),配不上同样落未绑定行。
    @Transactional
    public ImportResultDTO importRows(Integer companyId, int year, int month, LedgerImportRequest req) {
        ManagementCompany company = companies.selectById(companyId);
        if (company == null) throw new BizException(ResultCode.NOT_FOUND, "公司不存在");

        Map<String, Integer> byName = TenantService.softIndex(tenants.selectList(null));
        // 词典跟着月份走(spec §6):钉在旧版的月份不认得后来才加进链尾的列
        java.util.Set<String> allowedCustomIds = bookService.customIdsAt("ledger", companyId, year, month);
        // 结余链:上一自然月已有该户记录 → 该月 balance_prev 是派生位,文件值忽略(以链为准);
        // 上一自然月没有 = 本月是链起点 → 文件里的「上月结余」就是期初,照收(历史月未补时的唯一入口)
        Set<String> priorKeys = prevMonthChain(companyId, year, month).keySet();
        List<MonthlyLedger> storedRows = ledger.selectMonth(companyId, year, month);
        Map<Integer, MonthlyLedger> stored = storedRows.stream()
            .filter(l -> l.getTenantId() != null)
            .collect(Collectors.toMap(MonthlyLedger::getTenantId, l -> l, (a, b) -> a));
        // 未绑定行按账面名 upsert(V106 起 uk_ledger_soft 在 DB 层兜并发,这里管同请求内去重)
        Map<String, MonthlyLedger> storedSoft = new HashMap<>();
        // 绑定行的账面名二级索引(评审A1:解析结果与既有行绑定态可能相反,四象限都要接上,
        // 否则「加别名后重导」「手工绑定后重导」都会插出同名第二行、金额翻倍)
        Map<String, MonthlyLedger> boundByName = new HashMap<>();
        for (MonthlyLedger l : storedRows) {
            if (l.getTenantName() == null) continue;
            if (l.getTenantId() == null) storedSoft.putIfAbsent(l.getTenantName().trim(), l);
            else boundByName.putIfAbsent(l.getTenantName().trim(), l);
        }

        int imported = 0;
        Set<String> unboundNow = new LinkedHashSet<>();   // 本次导入落为未绑定的账面名(不含存量)
        List<ImportError> errors = new ArrayList<>();
        List<LedgerImportRequest.Row> rows = req.rows();
        for (int i = 0; i < rows.size(); i++) {
            LedgerImportRequest.Row row = rows.get(i);
            String name = row.tenantName() == null ? null : row.tenantName().trim();
            if (name == null || name.isEmpty()) {
                errors.add(new ImportError(i, row.tenantName(), "租户名称为空"));
                continue;
            }
            Integer tenantId = byName.get(name);
            // 身份桥:命中档案→优先该租户绑定行,退同名未绑定行(下方顺手升级绑定);
            //        未命中→优先同名未绑定行,退同名绑定行(保留其手工绑定,不降级)
            MonthlyLedger existing;
            if (tenantId != null) {
                existing = stored.get(tenantId);
                if (existing == null) existing = storedSoft.get(name);
            } else {
                existing = storedSoft.get(name);
                if (existing == null) existing = boundByName.get(name);
            }
            // 全零行防线:21 费用 + balancePrev/totalCollected 无任何非 null 非 0 值、note 为空,
            // 且该租户本月无既有行 → 记名跳过(文件里大量「-」占位行,落库会让台账出现整片零行;
            // 有既有行时仍允许落库=显式清零)
            boolean hasValue = row.note() != null && !row.note().isBlank();
            if (!hasValue) for (var g : IMP_GET) {
                BigDecimal v = g.apply(row);
                if (v != null && v.signum() != 0) { hasValue = true; break; }
            }
            if (!hasValue && row.totalCollected() != null && row.totalCollected().signum() != 0) hasValue = true;
            // 期初也是内容:首现户只有一笔挂账结余(如戎合 249 万)的行必须入库;
            // 派生位上的结余不算内容(源册带着它,但库里以链为准,不能靠它把空行救活)
            boolean seedable = !priorKeys.contains(tenantId != null ? "t:" + tenantId : "n:" + name);
            if (!hasValue && seedable && row.balancePrev() != null && row.balancePrev().signum() != 0) hasValue = true;
            // 口袋列也是内容:只带自定义列值的行不是全零行(否则静默跳过,§4 未知 id 检查也到不了)
            if (!hasValue && row.extraFees() != null)
                for (BigDecimal v : row.extraFees().values())
                    if (v != null && v.signum() != 0) { hasValue = true; break; }
            if (!hasValue && existing == null) {
                // 两种跳过要分开说(2026-08-27 用户反馈):整行只有上月结余、且落在派生位时,
                // 沿用「无费用/结余/收款/备注」等于告诉用户"系统没看见你填的结余"——
                // 实际是看见了、但本月结余以上月期末为准,文件里那个值本就不该采信。
                boolean onlyDerivedBalance = !seedable
                    && row.balancePrev() != null && row.balancePrev().signum() != 0;
                errors.add(new ImportError(i, name, onlyDerivedBalance
                    ? "本行只有上月结余,而本月结余由上月期末自动派生(以结余链为准),文件值不采信;无其他可导入内容,已跳过"
                    : "全零行(无费用/结余/收款/备注),已跳过"));
                continue;
            }
            // 未知自定义列 id 检查必须在任何实体写入之前(§4):existing 是 stored/storedSoft
            // 索引里的共享实体,先写后 continue 会留下脏实体,同名后续行会把错误行的钱落库(审查#1)
            if (row.extraFees() != null && !row.extraFees().isEmpty()) {
                var bad = row.extraFees().keySet().stream()
                    .filter(k -> !allowedCustomIds.contains(k)).toList();
                if (!bad.isEmpty()) {
                    errors.add(new ImportError(i, name, "未知自定义列 id:" + String.join(",", bad)));
                    continue;
                }
            }
            // 列级定向 upsert:字段为 null=文件没这列=不动既有值;为 0=显式清零(新行走 zeroRow 默认 0)
            MonthlyLedger l = existing != null ? existing : zeroRow(companyId, tenantId, year, month);
            if (existing == null) l.setTenantName(name);                    // 账面名快照=文件原文
            else if (l.getTenantName() == null || l.getTenantName().isBlank()) l.setTenantName(name);
            // 升级绑定:此前未绑定、本次解析命中且该租户本月无绑定行(上方分支已保证)
            if (tenantId != null && l.getTenantId() == null) l.setTenantId(tenantId);
            for (int f = 0; f < FEE_SET.size(); f++) {
                BigDecimal v = IMP_GET.get(f).apply(row);
                if (v != null) FEE_SET.get(f).accept(l, r2(v));
            }
            // 结余链:首现月吃文件里的「上月结余」当期初;非首现月是派生位,忽略文件值
            // (rechain 随后会把它前滚归一;补齐历史月后本月自动从派生位接上,无需返工)
            if (seedable && row.balancePrev() != null) l.setBalancePrev(r2(row.balancePrev()));
            if (row.totalCollected() != null) l.setTotalCollected(r2(row.totalCollected()));
            if (row.note() != null && !row.note().isBlank()) l.setNote(row.note().trim());
            // 自定义列:按键合并(§4;未知 id 已在实体写入前拦下)
            if (row.extraFees() != null && !row.extraFees().isEmpty())
                l.setExtraFees(ExtraFees.mergeKeys(l.getExtraFees(), row.extraFees()));
            if (existing != null) ledger.updateById(l); else ledger.insert(l);
            // 索引维护:同名第二行走 update,不再重复 insert 撞 uk
            if (l.getTenantId() != null) {
                stored.put(l.getTenantId(), l);
                boundByName.putIfAbsent(name, l);
                storedSoft.remove(name);
            } else {
                storedSoft.put(name, l);
                unboundNow.add(name);
            }
            imported++;
        }
        // 未绑定落库不是错误(照常入库),但必须知会(评审B2:导入中心 hub 此前对未绑定零信号)
        rechain(companyId);   // 结余链:导入落库后前滚归一(含跨月空洞)
        materializePin(companyId, year, month);
        List<ImportError> notices = new ArrayList<>();
        if (!unboundNow.isEmpty())
            notices.add(new ImportError(-1, "未绑定租户", unboundNow.size() + " 个账面名未匹配租户档案,已作为未绑定行导入 —— 到「月度台账」对应月份的问题面板绑定/改名/建档"));
        return new ImportResultDTO(imported, errors.size(), errors, notices);
    }

    // ── copy-from-prev(以上月各行为模板,结余结转,事务) ──
    @Transactional
    public LedgerMonthDTO copyFromPrev(Integer companyId, int year, int month) {
        ManagementCompany company = companies.selectById(companyId);
        if (company == null) throw new BizException(ResultCode.NOT_FOUND, "公司不存在");

        int pm = prevMonth(month);
        int py = month == 1 ? year - 1 : year;
        List<MonthlyLedger> prev = ledger.selectMonth(companyId, py, pm);
        if (prev.isEmpty()) throw new BizException(ResultCode.CONFLICT, "上月无台账数据");

        // V105:未绑定行(tenant_id=null)也照搬——键退回账面名(与导入 upsert 同款代码级唯一约束)
        Map<String, MonthlyLedger> cur = new HashMap<>();
        for (MonthlyLedger l : ledger.selectMonth(companyId, year, month))
            cur.putIfAbsent(rowKey(l), l);

        for (MonthlyLedger src : prev) {
            MonthlyLedger existing = cur.get(rowKey(src));
            MonthlyLedger l = existing != null ? existing
                : zeroRow(companyId, src.getTenantId(), year, month);
            if (existing == null) l.setTenantName(src.getTenantName());
            // 21 费用照搬
            for (int i = 0; i < FEE_GET.size(); i++) FEE_SET.get(i).accept(l, nz(FEE_GET.get(i).apply(src)));
            l.setBalancePrev(recalc(src)[1]);  // balancePrev := 上月该租户 balanceEnd
            l.setTotalCollected(BigDecimal.ZERO);
            l.setNote(null);
            l.setExtraFees(src.getExtraFees());   // 自定义列照搬(与 21 费用列同语义)
            if (existing != null) ledger.updateById(l); else ledger.insert(l);
        }
        rechain(companyId);   // 结余链:复制上月后前滚归一
        materializePin(companyId, year, month);
        return month(companyId, year, month);
    }

    // ── helpers ──
    private List<Tenant> activeTenants() {
        return tenants.selectList(null).stream()
            .filter(t -> t.getStatus() != null && t.getStatus() == 1)
            .sorted(Comparator.comparing(Tenant::getId))
            .toList();
    }

    private static int prevMonth(int month) { return month == 1 ? 12 : month - 1; }

    // 行归并键:绑定行走 tenantId,未绑定行走账面名(copyFromPrev 用)
    private static String rowKey(MonthlyLedger l) {
        return l.getTenantId() != null ? "t" + l.getTenantId() : "n" + nzs(l.getTenantName()).trim();
    }

    private static MonthlyLedger zeroRow(Integer companyId, Integer tenantId, int year, int month) {
        MonthlyLedger l = new MonthlyLedger();
        l.setCompanyId(companyId); l.setTenantId(tenantId);
        l.setPeriodYear(year); l.setPeriodMonth(month);
        for (var s : FEE_SET) s.accept(l, BigDecimal.ZERO);
        l.setBalancePrev(BigDecimal.ZERO);
        l.setTotalCollected(BigDecimal.ZERO);
        l.setNote(null);
        return l;
    }

    /** 行内容是否全空(费用/收款/备注/口袋)。结余不在此判:是否算内容取决于链上派生与否,由调用处定。 */
    private static boolean isBlankContent(LedgerSaveRequest.Row row) {
        for (var g : REQ_GET) if (nz(g.apply(row)).signum() != 0) return false;
        if (nz(row.totalCollected()).signum() != 0) return false;
        if (row.extraFees() != null)
            for (BigDecimal v : row.extraFees().values())
                if (v != null && v.signum() != 0) return false;
        return row.note() == null || row.note().isBlank();
    }

    /** 保存路径口袋键校验(审查#10):归档(hidden)列在册可写;已删除列的 c_ 键拒收,防幽灵钱直写。 */
    static void assertKnownExtraKeys(java.util.Set<String> allowed, LedgerSaveRequest.Row row, String name) {
        if (row.extraFees() == null || row.extraFees().isEmpty()) return;
        var bad = row.extraFees().keySet().stream().filter(k -> !allowed.contains(k)).toList();
        if (!bad.isEmpty())
            throw new BizException(ResultCode.BAD_REQUEST,
                "「" + name + "」含未知自定义列 id:" + String.join(",", bad) + "(列已删除或不属于本账册)");
    }

    private static void applyRow(MonthlyLedger l, LedgerSaveRequest.Row row) {
        for (int i = 0; i < FEE_SET.size(); i++) FEE_SET.get(i).accept(l, r2(REQ_GET.get(i).apply(row)));
        l.setBalancePrev(r2(row.balancePrev()));
        l.setTotalCollected(r2(row.totalCollected()));
        l.setNote(row.note() == null || row.note().isBlank() ? null : row.note());
        // 保存语义:extraFees 非空=整包替换(编辑态草稿持有整行事实);null=不动(兼容不带口袋的调用方)
        if (row.extraFees() != null) l.setExtraFees(ExtraFees.write(row.extraFees()));
    }

    private static LedgerRowDTO toRowDTO(MonthlyLedger l, String tenantName) {
        return toRowDTO(l, tenantName, false, false);   // 行级端点(绑定/改名)不带派生标记:前端只用它刷身份
    }

    private static LedgerRowDTO toRowDTO(MonthlyLedger l, String tenantName,
                                         boolean balancePrevDerived, boolean carried) {
        BigDecimal[] d = recalc(l);
        return new LedgerRowDTO(
            l.getId(), l.getTenantId(), tenantName, r2(l.getBalancePrev()), balancePrevDerived, carried,
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
            r2(l.getTotalCollected()), l.getNote(),
            d[0], d[1], ExtraFees.parse(l.getExtraFees()));
    }

    private static LedgerFooter footer(List<LedgerRowDTO> rows) {
        BigDecimal[] fee = new BigDecimal[FEE_GET.size()];
        Arrays.fill(fee, BigDecimal.ZERO);
        BigDecimal balPrev = BigDecimal.ZERO, recv = BigDecimal.ZERO,
                   coll = BigDecimal.ZERO, end = BigDecimal.ZERO;
        for (LedgerRowDTO r : rows) {
            BigDecimal[] vals = rowFees(r);
            for (int i = 0; i < fee.length; i++) fee[i] = fee[i].add(vals[i]);
            balPrev = balPrev.add(r.balancePrev());
            recv = recv.add(r.totalReceivable());
            coll = coll.add(r.totalCollected());
            end = end.add(r.balanceEnd());
        }
        return new LedgerFooter(
            r2(fee[0]), r2(fee[1]), r2(fee[2]), r2(fee[3]), r2(fee[4]), r2(fee[5]),
            r2(fee[6]), r2(fee[7]), r2(fee[8]), r2(fee[9]), r2(fee[10]), r2(fee[11]),
            r2(fee[12]), r2(fee[13]), r2(fee[14]), r2(fee[15]), r2(fee[16]), r2(fee[17]),
            r2(fee[18]), r2(fee[19]), r2(fee[20]),
            r2(balPrev), r2(recv), r2(coll), r2(end));
    }

    private static BigDecimal[] rowFees(LedgerRowDTO r) {
        return new BigDecimal[]{
            r.factoryRent(), r.factoryMgmtFee(), r.shopRent(), r.dormRent(),
            r.dormFacilitiesFee(), r.shopMgmtFee(), r.factoryInfraMaint(), r.shopInfraMaint(),
            r.dormInfraMaint(), r.elevatorMaint(), r.transformerMaint(), r.landUseTax(),
            r.networkFee(), r.accessCtrlMaint(), r.officeOtherFee(), r.dormOtherFee(),
            r.basicElectricity(), r.standardElectricity(), r.electricityMaint(),
            r.standardWater(), r.waterMaint() };
    }
}

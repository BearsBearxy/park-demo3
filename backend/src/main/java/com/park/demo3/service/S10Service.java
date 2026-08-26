package com.park.demo3.service;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import com.park.demo3.common.ExtraFees;
import com.park.demo3.dto.BookDtos.ArchivedColDTO;
import com.park.demo3.dto.DeleteResultDTO;
import com.park.demo3.dto.ImportError;
import com.park.demo3.dto.ImportResultDTO;
import com.park.demo3.dto.S10ImportRequest;
import com.park.demo3.dto.S10MonthDTO;
import com.park.demo3.dto.S10OverviewDTO;
import com.park.demo3.dto.S10RecordDTO;
import com.park.demo3.dto.S10RecordReq;
import com.park.demo3.dto.S10YearDTO;
import com.park.demo3.dto.S10YearSummaryDTO;
import com.park.demo3.entity.LedgerBook;
import com.park.demo3.entity.S10Record;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.park.demo3.mapper.S10RecordMapper;
import com.park.demo3.mapper.TenantMapper;
import com.park.demo3.dto.TenantBindReq;
import com.park.demo3.dto.BindResultDTO;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import org.springframework.stereotype.Service;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.HashMap;
import java.util.function.BiConsumer;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
public class S10Service {
    private static final int BASE_YEAR = 2024;   // 年份范围下界(确定性,不读系统时钟)
    private final S10RecordMapper records;
    private final TenantMapper tenants;
    private final BookService bookService;
    private final BookPinService pinService;

    public S10Service(S10RecordMapper records, TenantMapper tenants, BookService bookService,
                      BookPinService pinService) {
        this.bookService = bookService; this.pinService = pinService;
        this.records = records; this.tenants = tenants;
    }

    // P6:与台账同一条规则。owner=phase;acctMonth 是 'YYYY-MM',在这里拆成年月两个整数
    private void materializePin(int phase, String acctMonth) {
        LedgerBook b = bookService.bookOfPhase(phase);
        if (b == null) return;
        int y = yearOf(acctMonth), m = monthOf(acctMonth);
        pinService.materialize("s10", phase, y, m,
            pinService.resolve("s10", phase, y, m, bookService.chainBookId(b)));
    }

    private static BigDecimal nz(BigDecimal v) { return v == null ? BigDecimal.ZERO : v; }
    private static BigDecimal r2(BigDecimal v) { return nz(v).setScale(2, RoundingMode.HALF_UP); }
    private static int yearOf(String acctMonth) { return Integer.parseInt(acctMonth.substring(0, 4)); }
    private static int monthOf(String acctMonth) { return Integer.parseInt(acctMonth.substring(5, 7)); }

    // ── 25 费用列定义(顺序即列展示顺序;getter/setter 一处定义,派生/落库/DTO 复用) ──
    private record Col(String name, Function<S10Record, BigDecimal> get, BiConsumer<S10Record, BigDecimal> set,
                       Function<S10RecordReq, BigDecimal> req, Function<S10ImportRequest.Row, BigDecimal> imp) {}
    private static final List<Col> COLS = List.of(
        new Col("officeRent",       S10Record::getOfficeRent,       S10Record::setOfficeRent,       S10RecordReq::officeRent,       S10ImportRequest.Row::officeRent),
        new Col("officeMgmtFee",    S10Record::getOfficeMgmtFee,    S10Record::setOfficeMgmtFee,    S10RecordReq::officeMgmtFee,    S10ImportRequest.Row::officeMgmtFee),
        new Col("factoryRent",      S10Record::getFactoryRent,      S10Record::setFactoryRent,      S10RecordReq::factoryRent,      S10ImportRequest.Row::factoryRent),
        new Col("factoryMgmtFee",   S10Record::getFactoryMgmtFee,   S10Record::setFactoryMgmtFee,   S10RecordReq::factoryMgmtFee,   S10ImportRequest.Row::factoryMgmtFee),
        new Col("landRent",         S10Record::getLandRent,         S10Record::setLandRent,         S10RecordReq::landRent,         S10ImportRequest.Row::landRent),
        new Col("shopRent",         S10Record::getShopRent,         S10Record::setShopRent,         S10RecordReq::shopRent,         S10ImportRequest.Row::shopRent),
        new Col("shopMgmtFee",      S10Record::getShopMgmtFee,      S10Record::setShopMgmtFee,      S10RecordReq::shopMgmtFee,      S10ImportRequest.Row::shopMgmtFee),
        new Col("dormRent",         S10Record::getDormRent,         S10Record::setDormRent,         S10RecordReq::dormRent,         S10ImportRequest.Row::dormRent),
        new Col("dormFacilityFee",  S10Record::getDormFacilityFee,  S10Record::setDormFacilityFee,  S10RecordReq::dormFacilityFee,  S10ImportRequest.Row::dormFacilityFee),
        new Col("infraOffice",      S10Record::getInfraOffice,      S10Record::setInfraOffice,      S10RecordReq::infraOffice,      S10ImportRequest.Row::infraOffice),
        new Col("infraFactory",     S10Record::getInfraFactory,     S10Record::setInfraFactory,     S10RecordReq::infraFactory,     S10ImportRequest.Row::infraFactory),
        new Col("infraShop",        S10Record::getInfraShop,        S10Record::setInfraShop,        S10RecordReq::infraShop,        S10ImportRequest.Row::infraShop),
        new Col("infraDorm",        S10Record::getInfraDorm,        S10Record::setInfraDorm,        S10RecordReq::infraDorm,        S10ImportRequest.Row::infraDorm),
        new Col("elevatorMaint",    S10Record::getElevatorMaint,    S10Record::setElevatorMaint,    S10RecordReq::elevatorMaint,    S10ImportRequest.Row::elevatorMaint),
        new Col("transformerMaint", S10Record::getTransformerMaint, S10Record::setTransformerMaint, S10RecordReq::transformerMaint, S10ImportRequest.Row::transformerMaint),
        new Col("landUseTax",       S10Record::getLandUseTax,       S10Record::setLandUseTax,       S10RecordReq::landUseTax,       S10ImportRequest.Row::landUseTax),
        new Col("networkFee",       S10Record::getNetworkFee,       S10Record::setNetworkFee,       S10RecordReq::networkFee,       S10ImportRequest.Row::networkFee),
        new Col("accessMaint",      S10Record::getAccessMaint,      S10Record::setAccessMaint,      S10RecordReq::accessMaint,      S10ImportRequest.Row::accessMaint),
        new Col("otherFee",         S10Record::getOtherFee,         S10Record::setOtherFee,         S10RecordReq::otherFee,         S10ImportRequest.Row::otherFee),
        new Col("elecBasic",        S10Record::getElecBasic,        S10Record::setElecBasic,        S10RecordReq::elecBasic,        S10ImportRequest.Row::elecBasic),
        new Col("elecStd",          S10Record::getElecStd,          S10Record::setElecStd,          S10RecordReq::elecStd,          S10ImportRequest.Row::elecStd),
        new Col("elecMaint",        S10Record::getElecMaint,        S10Record::setElecMaint,        S10RecordReq::elecMaint,        S10ImportRequest.Row::elecMaint),
        new Col("waterStd",         S10Record::getWaterStd,         S10Record::setWaterStd,         S10RecordReq::waterStd,         S10ImportRequest.Row::waterStd),
        new Col("waterMaint",       S10Record::getWaterMaint,       S10Record::setWaterMaint,       S10RecordReq::waterMaint,       S10ImportRequest.Row::waterMaint),
        new Col("guaranteeRent",    S10Record::getGuaranteeRent,    S10Record::setGuaranteeRent,    S10RecordReq::guaranteeRent,    S10ImportRequest.Row::guaranteeRent));

    // 行合计 = 该行 25 列 + extra_fees 口袋之和(派生,不落库;包内可见供 AnalysisService 复用)。
    // 方案A(SPEC §2/§6):合计口径全站唯一,消费方禁止自算。
    static BigDecimal rowTotal(S10Record r) {
        BigDecimal t = ExtraFees.sum(r.getExtraFees());
        for (Col c : COLS) t = t.add(nz(c.get().apply(r)));
        return r2(t);
    }

    // ── overview:年份范围 [min(BASE_YEAR,minData) .. maxData+1];currentYear=maxData;currentMonth=该年最大数据月 ──
    public S10OverviewDTO overview() {
        List<S10Record> all = records.selectList(null);
        Map<Integer, List<S10Record>> byYear = all.stream()
            .collect(Collectors.groupingBy(r -> yearOf(r.getAcctMonth())));

        int maxDataYear = byYear.keySet().stream().mapToInt(Integer::intValue).max().orElse(0);
        int upper = maxDataYear == 0 ? BASE_YEAR + 1 : maxDataYear + 1;   // 无数据 → [2024..2025]
        int currentYear = maxDataYear == 0 ? upper - 1 : maxDataYear;     // 无数据 → 上界-1
        int lo = Math.min(BASE_YEAR, byYear.keySet().stream().mapToInt(Integer::intValue).min().orElse(BASE_YEAR));

        // currentMonth = currentYear 的最大数据月(无数据 → 0)
        int currentMonth = byYear.getOrDefault(currentYear, List.of()).stream()
            .mapToInt(r -> monthOf(r.getAcctMonth())).max().orElse(0);

        List<Integer> yearList = new ArrayList<>();
        List<S10YearDTO> summaries = new ArrayList<>();
        for (int y = lo; y <= upper; y++) {
            yearList.add(y);
            List<S10Record> rows = byYear.getOrDefault(y, List.of());
            int recordedMonths = (int) rows.stream().map(r -> monthOf(r.getAcctMonth())).distinct().count();
            int tenantCount = (int) rows.stream().map(S10Service::tenantKey).distinct().count();
            summaries.add(new S10YearDTO(y, recordedMonths, tenantCount));
        }
        int[] years = yearList.stream().mapToInt(Integer::intValue).toArray();
        return new S10OverviewDTO(years, currentYear, currentMonth, summaries);
    }

    // ── yearSummary(year):该年全部行按 (phase,colId,month) 聚合;月无行=null;全零列不输出 ──
    public S10YearSummaryDTO yearSummary(int year) {
        List<S10Record> all = records.selectList(
            new QueryWrapper<S10Record>().likeRight("acct_month", year + "-"));
        Map<Integer, Map<String, List<BigDecimal>>> phases = new LinkedHashMap<>();
        for (int phase = 1; phase <= 4; phase++) {
            final int p = phase;
            List<S10Record> rows = all.stream().filter(r -> r.getPhase() == p).toList();
            if (rows.isEmpty()) continue;
            boolean[] recorded = new boolean[12];
            Map<String, BigDecimal[]> sums = new LinkedHashMap<>();
            for (Col c : COLS) sums.put(c.name(), new BigDecimal[12]);
            for (S10Record r : rows) {
                int m = monthOf(r.getAcctMonth()) - 1;
                recorded[m] = true;
                for (Col c : COLS) {
                    BigDecimal[] arr = sums.get(c.name());
                    arr[m] = nz(arr[m]).add(nz(c.get().apply(r)));
                }
            }
            Map<String, List<BigDecimal>> cols = new LinkedHashMap<>();
            for (Col c : COLS) {
                BigDecimal[] arr = sums.get(c.name());
                boolean nonZero = false;
                List<BigDecimal> months = new ArrayList<>(12);
                for (int m = 0; m < 12; m++) {
                    BigDecimal v = recorded[m] ? r2(arr[m]) : null;
                    if (v != null && v.signum() != 0) nonZero = true;
                    months.add(v);
                }
                if (nonZero) cols.put(c.name(), months);
            }
            if (!cols.isEmpty()) phases.put(phase, cols);
        }
        return new S10YearSummaryDTO(year, phases);
    }

    // 去重租户键:优先 tenant_id,缺失软引用时退回 tenant_name
    private static String tenantKey(S10Record r) {
        return r.getTenantId() != null ? "id:" + r.getTenantId() : "name:" + r.getTenantName();
    }

    // ── month(phase,year,month):稀疏读 —— 无行回空(不补零);列合计/总计后端算;每行 total 派生 ──
    public S10MonthDTO month(int phase, int year, int month) {
        String acctMonth = String.format("%04d-%02d", year, month);
        List<S10Record> rows = records.selectBySlot(phase, acctMonth);
        List<S10RecordDTO> dtos = rows.stream().map(S10Service::toRecordDTO).toList();

        Map<String, BigDecimal> columnTotals = new LinkedHashMap<>();
        BigDecimal grandTotal = BigDecimal.ZERO;
        for (Col c : COLS) {
            BigDecimal sum = BigDecimal.ZERO;
            for (S10Record r : rows) sum = sum.add(nz(c.get().apply(r)));
            columnTotals.put(c.name(), r2(sum));
            grandTotal = grandTotal.add(sum);
        }
        for (S10Record r : rows) grandTotal = grandTotal.add(ExtraFees.sum(r.getExtraFees()));
        // 归档列(spec §2):本月有非零值、但生效模板不渲染的自定义列(台账同款,两屏同修)
        java.util.Set<String> keysWithData = new java.util.LinkedHashSet<>();
        for (S10Record r : rows)
            for (Map.Entry<String, BigDecimal> e : ExtraFees.parse(r.getExtraFees()).entrySet())
                if (e.getValue() != null && e.getValue().signum() != 0) keysWithData.add(e.getKey());
        List<ArchivedColDTO> archived = bookService.archivedColsAt(
            bookService.bookOfPhase(phase), year, month, keysWithData);
        return new S10MonthDTO(phase, year, month, !rows.isEmpty(), dtos, columnTotals, r2(grandTotal), archived);
    }

    // ── save:req.id 非空=按行更新(可改名——修「改名走按新名 upsert 会复制一行」的老坑);
    //         id 空=按 (phase,acctMonth,tenantName) upsert(source=manual,既有行保留其 source)。
    //         tenantId 空时按账面名自动配档(softIndex:唯一可判定才配,含退租户)。 ──
    public S10RecordDTO save(S10RecordReq req) {
        String name = req.tenantName().trim();
        S10Record r;
        boolean isNew = false;
        if (req.id() != null) {
            r = records.selectById(req.id());
            if (r == null) throw new BizException(ResultCode.NOT_FOUND, "记录不存在");
            // 改名撞 uk_s10(同期同月已有同名行)→ 409,提示合并须人工
            S10Record clash = records.selectBySlotTenant(r.getPhase(), r.getAcctMonth(), name);
            if (clash != null && !clash.getId().equals(r.getId()))
                throw new BizException(ResultCode.CONFLICT, "该期该月已有同名行「" + name + "」,请先处理重复行");
            r.setTenantName(name);
        } else {
            r = records.selectBySlotTenant(req.phase(), req.acctMonth(), name);
            isNew = r == null;
            if (isNew) {
                r = new S10Record();
                r.setPhase(req.phase());
                r.setAcctMonth(req.acctMonth());
                r.setTenantName(name);
                r.setSource("manual");
            }
        }
        // 绑定解析顺序(评审A5/E2):显式传入 > 行上既有绑定(手工绑过的绝不静默抹掉) > 按名自动配档
        // (只有前两者都空才扫租户表,避免逐行保存时反复全表构建索引)
        Integer tid = req.tenantId() != null ? req.tenantId() : r.getTenantId();
        if (tid == null) tid = TenantService.softIndex(tenants.selectList(null)).get(name);
        r.setTenantId(tid);
        r.setProfile(req.profile());
        r.setNote(req.note() == null || req.note().isBlank() ? null : req.note());
        for (Col c : COLS) c.set().accept(r, r2(c.req().apply(req)));
        // 保存语义:extraFees 非空=整包替换;null=不动(兼容不带口袋的调用方)。
        // 键校验(审查#10):归档(hidden)列在册可写;已删除列的 c_ 键拒收,防幽灵钱直写
        if (req.extraFees() != null && !req.extraFees().isEmpty()) {
            // 词典跟着月份走(spec §6),与导入同一口径;acctMonth 是 'YYYY-MM',在这里拆
            java.util.Set<String> allowed = bookService.customIdsAt("s10", r.getPhase(),
                yearOf(r.getAcctMonth()), monthOf(r.getAcctMonth()));
            var bad = req.extraFees().keySet().stream().filter(k -> !allowed.contains(k)).toList();
            if (!bad.isEmpty())
                throw new BizException(ResultCode.BAD_REQUEST,
                    "「" + name + "」含未知自定义列 id:" + String.join(",", bad) + "(列已删除或不属于本期账册)");
        }
        if (req.extraFees() != null) r.setExtraFees(ExtraFees.write(req.extraFees()));
        if (isNew) records.insert(r); else records.updateById(r);
        materializePin(r.getPhase(), r.getAcctMonth());
        return toRecordDTO(records.selectById(r.getId()));
    }

    // ── 按账面名批量绑定档案(问题面板;跨期跨月,同名未绑定行一次挂齐。uk 按名不受影响,无冲突分支) ──
    @org.springframework.transaction.annotation.Transactional
    public BindResultDTO bindTenant(TenantBindReq req) {
        if (tenants.selectById(req.tenantId()) == null)
            throw new BizException(ResultCode.NOT_FOUND, "租户不存在");
        int bound = records.update(null, new UpdateWrapper<S10Record>()
            .isNull("tenant_id").eq("tenant_name", req.tenantName().trim())
            .set("tenant_id", req.tenantId()));
        return new BindResultDTO(bound, 0);
    }

    // ── 行级绑定/换绑/解绑(tenantId=null 即解绑;uk_s10 按名不受影响,无冲突分支) ──
    public S10RecordDTO bindRow(Long id, Integer tenantId) {
        S10Record r = records.selectById(id);
        if (r == null) throw new BizException(ResultCode.NOT_FOUND, "记录不存在");
        if (tenantId != null && tenants.selectById(tenantId) == null)
            throw new BizException(ResultCode.NOT_FOUND, "租户不存在");
        // 解绑要显式置 NULL(updateById 跳过 null 字段)
        records.update(null, new com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper<S10Record>()
            .eq("id", id).set("tenant_id", tenantId));
        return toRecordDTO(records.selectById(id));
    }

    // ── import:重导=替换本槽导入行 —— 先删该 (phase,acctMonth) 的 source='import' 行,再把 rows 全部 insert ──
    //          (source='manual'/'seed' 手动行不动;新行 source='import'、tenant_id=null 软引用) ──
    @org.springframework.transaction.annotation.Transactional
    public ImportResultDTO importRows(S10ImportRequest req) {
        // 重导前记住本槽既有导入行的绑定(评审A3:问题面板手工绑好的行不能因重导蒸发)。
        // 既有绑定优先于本次自动解析——手工纠正过的口径比 softIndex 更可信;
        // ponytail: 档案别名后改指别家时旧绑定会粘住,重绑走问题面板,不为此加"绑定来源"字段。
        Map<String, Integer> prevBind = new HashMap<>();
        for (S10Record old0 : records.selectList(new QueryWrapper<S10Record>()
                .eq("phase", req.phase()).eq("acct_month", req.acctMonth())
                .eq("source", "import").isNotNull("tenant_id")))
            if (old0.getTenantName() != null)
                prevBind.putIfAbsent(old0.getTenantName().trim(), old0.getTenantId());
        records.deleteImported(req.phase(), req.acctMonth());
        // 撞名防线(审查#3):uk_s10 不含 source,幸存的 manual/seed 同名行会让裸 insert 撞唯一键
        // → DuplicateKeyException 整批回滚且无行级定位;预取幸存名单 + 批内已插名单,命中转行级错误
        java.util.Set<String> takenNames = new java.util.HashSet<>();
        for (S10Record keep : records.selectBySlot(req.phase(), req.acctMonth()))
            if (keep.getTenantName() != null) takenNames.add(keep.getTenantName().trim());
        // V105:导入即按账面名自动配档(全部状态+别名,唯一可判定才配);配不上留 null=未绑定,问题面板处理
        Map<String, Integer> byName = TenantService.softIndex(tenants.selectList(null));
        // 词典跟着月份走(spec §6):钉在旧版的月份不认得后来才加进链尾的列
        java.util.Set<String> allowedCustomIds =
            bookService.customIdsAt("s10", req.phase(), yearOf(req.acctMonth()), monthOf(req.acctMonth()));
        int imported = 0;
        java.util.LinkedHashSet<String> unboundNames = new java.util.LinkedHashSet<>();
        List<ImportError> errors = new ArrayList<>();
        List<S10ImportRequest.Row> rows = req.rows();
        for (int i = 0; i < rows.size(); i++) {
            S10ImportRequest.Row row = rows.get(i);
            String name = row.tenantName() == null ? null : row.tenantName().trim();
            if (name == null || name.isEmpty()) {
                errors.add(new ImportError(i, row.tenantName(), "租户名称为空"));
                continue;
            }
            if (!takenNames.add(name)) {   // 幸存手工/种子行同名,或文件内重名(add 返回 false=已占)
                errors.add(new ImportError(i, name, "与本槽已有手工/种子行或文件内前行同名,已跳过——请在页面处理该行"));
                continue;
            }
            S10Record r = new S10Record();
            r.setPhase(req.phase());
            r.setAcctMonth(req.acctMonth());
            r.setTenantName(name);
            Integer bind = prevBind.get(name);
            if (bind == null) bind = byName.get(name);   // 软引用:既有绑定 > 自动解析 > null 待人工
            r.setTenantId(bind);
            r.setSource("import");
            r.setProfile(row.profile());
            for (Col c : COLS) c.set().accept(r, r2(c.imp().apply(row)));
            // 自定义列(§4):未知列 id 该行报错不静默吞;重导=整槽替换,插入路径直接落口袋
            if (row.extraFees() != null && !row.extraFees().isEmpty()) {
                var bad = row.extraFees().keySet().stream()
                    .filter(k -> !allowedCustomIds.contains(k)).toList();
                if (!bad.isEmpty()) {
                    errors.add(new ImportError(i, name, "未知自定义列 id:" + String.join(",", bad)));
                    continue;
                }
                r.setExtraFees(ExtraFees.write(row.extraFees()));
            }
            records.insert(r);
            if (r.getTenantId() == null) unboundNames.add(name);
            imported++;
        }
        materializePin(req.phase(), req.acctMonth());
        List<ImportError> notices = new ArrayList<>();
        if (!unboundNames.isEmpty())
            notices.add(new ImportError(-1, "未绑定租户", unboundNames.size() + " 个账面名未匹配租户档案,已作为未绑定行导入 —— 到「附表10」该期该月的问题面板绑定/改名/建档"));
        return new ImportResultDTO(imported, errors.size(), errors, notices);
    }

    // ── 行级改账面名(抽屉内即时提交):只动名字与自动配档,不碰 25 费用列(save 会把缺省列落零,不能借用) ──
    public S10RecordDTO renameRow(Long id, String tenantName) {
        S10Record r = records.selectById(id);
        if (r == null) throw new BizException(ResultCode.NOT_FOUND, "记录不存在");
        String newName = tenantName.trim();
        if (newName.isEmpty()) throw new BizException(ResultCode.BAD_REQUEST, "账面名不能为空");
        if (!newName.equals(r.getTenantName())) {
            S10Record clash = records.selectBySlotTenant(r.getPhase(), r.getAcctMonth(), newName);
            if (clash != null && !clash.getId().equals(r.getId()))
                throw new BizException(ResultCode.CONFLICT, "该期该月已有同名行「" + newName + "」,请先处理重复行");
            r.setTenantName(newName);
            if (r.getTenantId() == null)
                r.setTenantId(TenantService.softIndex(tenants.selectList(null)).get(newName));
            records.updateById(r);
        }
        return toRecordDTO(records.selectById(id));
    }

    // ── clearImported(phase,acctMonth):删本槽 source='import' 行,返回删除计数 ──
    @org.springframework.transaction.annotation.Transactional
    public DeleteResultDTO clearImported(int phase, String acctMonth) {
        int deleted = records.deleteImported(phase, acctMonth);
        return new DeleteResultDTO(deleted, 0);
    }

    // ── batchDelete(ids):按 id 删,source='seed' 跳过(skipped=种子数);不存在的 id 静默忽略 ──
    @org.springframework.transaction.annotation.Transactional
    public DeleteResultDTO batchDelete(List<Long> ids) {
        int deleted = 0, skipped = 0;
        for (Long id : ids) {
            S10Record r = records.selectById(id);
            if (r == null) continue;
            if ("seed".equals(r.getSource())) { skipped++; continue; }
            records.deleteById(id);
            deleted++;
        }
        return new DeleteResultDTO(deleted, skipped);
    }

    // ── updateNote(id,note;不存在 → 404) ──
    public S10RecordDTO updateNote(Long id, String note) {
        S10Record r = records.selectById(id);
        if (r == null) throw new BizException(ResultCode.NOT_FOUND, "记录不存在");
        r.setNote(note == null || note.isBlank() ? null : note);
        records.updateById(r);
        return toRecordDTO(records.selectById(id));
    }

    // ── delete(id;不存在 → 404;source=='seed' → 409) ──
    public void delete(Long id) {
        S10Record r = records.selectById(id);
        if (r == null) throw new BizException(ResultCode.NOT_FOUND, "记录不存在");
        if ("seed".equals(r.getSource())) throw new BizException(ResultCode.CONFLICT, "官方台账,不可删除");
        records.deleteById(id);
    }

    // ── helper:entity → DTO(25 列 r2 + 派生 total) ──
    private static S10RecordDTO toRecordDTO(S10Record r) {
        return new S10RecordDTO(
            r.getId(), r.getTenantId(), r.getTenantName(), r.getPhase(), r.getProfile(), r.getNote(), r.getSource(),
            r2(r.getOfficeRent()), r2(r.getOfficeMgmtFee()), r2(r.getFactoryRent()), r2(r.getFactoryMgmtFee()),
            r2(r.getLandRent()), r2(r.getShopRent()), r2(r.getShopMgmtFee()), r2(r.getDormRent()),
            r2(r.getDormFacilityFee()), r2(r.getInfraOffice()), r2(r.getInfraFactory()), r2(r.getInfraShop()),
            r2(r.getInfraDorm()), r2(r.getElevatorMaint()), r2(r.getTransformerMaint()), r2(r.getLandUseTax()),
            r2(r.getNetworkFee()), r2(r.getAccessMaint()), r2(r.getOtherFee()), r2(r.getElecBasic()),
            r2(r.getElecStd()), r2(r.getElecMaint()), r2(r.getWaterStd()), r2(r.getWaterMaint()),
            r2(r.getGuaranteeRent()), rowTotal(r), ExtraFees.parse(r.getExtraFees()));
    }
}

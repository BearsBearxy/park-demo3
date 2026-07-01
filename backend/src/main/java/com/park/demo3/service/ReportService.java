package com.park.demo3.service;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import com.park.demo3.dto.ImportResultDTO;
import com.park.demo3.dto.ImportError;
import com.park.demo3.dto.ReportCustomRowDTO;
import com.park.demo3.dto.ReportImportRequest;
import com.park.demo3.dto.ReportMonthCellDTO;
import com.park.demo3.dto.ReportPeriodDTO;
import com.park.demo3.dto.ReportSaveReq;
import com.park.demo3.dto.ReportYearDTO;
import com.park.demo3.dto.ReportYearDTO.MonthMeta;
import com.park.demo3.entity.ManagementCompany;
import com.park.demo3.entity.ReportAmount;
import com.park.demo3.entity.ReportCustomRow;
import com.park.demo3.mapper.ManagementCompanyMapper;
import com.park.demo3.mapper.ReportAmountMapper;
import com.park.demo3.mapper.ReportCustomRowMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class ReportService {
    private static final Set<String> STATEMENTS = Set.of("is");   // 本刀仅利润表;B/C 增 bs/tb
    private static final String PREVIEW_ROW = "1";                 // 月历预览 = 营业收入(行次1) cur
    private static final String PREVIEW_FIELD = "cur";

    private final ReportAmountMapper amounts;
    private final ReportCustomRowMapper customRows;
    private final ManagementCompanyMapper companies;

    public ReportService(ReportAmountMapper amounts, ReportCustomRowMapper customRows,
                         ManagementCompanyMapper companies) {
        this.amounts = amounts; this.customRows = customRows; this.companies = companies;
    }

    private static BigDecimal nz(BigDecimal v) { return v == null ? BigDecimal.ZERO : v; }
    private static BigDecimal r2(BigDecimal v) { return nz(v).setScale(2, RoundingMode.HALF_UP); }

    private void checkStatement(String statement) {
        if (!STATEMENTS.contains(statement)) throw new BizException(ResultCode.BAD_REQUEST, "未知报表类型");
    }
    private ManagementCompany requireCompany(int companyId) {
        ManagementCompany c = companies.selectById(companyId);
        if (c == null) throw new BizException(ResultCode.NOT_FOUND, "公司不存在");
        return c;
    }

    // ── 单公司本期读 ──
    public ReportPeriodDTO period(String statement, int companyId, int year, int month) {
        checkStatement(statement);
        requireCompany(companyId);
        Map<String, ReportMonthCellDTO> map = toCellMap(amounts.period(companyId, statement, year, month));
        List<ReportCustomRowDTO> rows = customRows.forCompany(companyId, statement).stream()
            .map(ReportService::toCustomDTO).toList();
        return new ReportPeriodDTO(map, rows);
    }

    // ── 全部汇总:跨公司同 (rowKey,field) 求和;customRows 各公司并集按 rowKey 去重(只读) ──
    public ReportPeriodDTO allPeriod(String statement, int year, int month) {
        checkStatement(statement);
        // (rowKey -> (cur, ytd)) 累加
        Map<String, BigDecimal[]> acc = new LinkedHashMap<>();
        for (ReportAmount a : amounts.allPeriod(statement, year, month)) {
            BigDecimal[] cell = acc.computeIfAbsent(a.getRowKey(), k -> new BigDecimal[]{ BigDecimal.ZERO, BigDecimal.ZERO });
            int i = "ytd".equals(a.getField()) ? 1 : 0;
            cell[i] = cell[i].add(nz(a.getAmount()));
        }
        Map<String, ReportMonthCellDTO> map = new LinkedHashMap<>();
        acc.forEach((k, v) -> map.put(k, new ReportMonthCellDTO(r2(v[0]), r2(v[1]))));

        Map<String, ReportCustomRowDTO> byKey = new LinkedHashMap<>();
        for (ReportCustomRow r : customRows.selectList(new QueryWrapper<ReportCustomRow>()
                .eq("statement", statement).orderByAsc("id"))) {
            byKey.putIfAbsent(r.getRowKey(), toCustomDTO(r));
        }
        return new ReportPeriodDTO(map, new ArrayList<>(byKey.values()));
    }

    // ── L2 月历:12 月 hasData + netPreview(行次1 cur) ──
    public ReportYearDTO year(String statement, int companyId, int year) {
        checkStatement(statement);
        requireCompany(companyId);
        List<ReportAmount> all = amounts.selectList(new QueryWrapper<ReportAmount>()
            .eq("company_id", companyId).eq("statement", statement).eq("year", year));
        Map<Integer, List<ReportAmount>> byMonth = all.stream()
            .collect(Collectors.groupingBy(ReportAmount::getMonth));
        List<MonthMeta> months = new ArrayList<>(12);
        for (int m = 1; m <= 12; m++) {
            List<ReportAmount> rows = byMonth.getOrDefault(m, List.of());
            BigDecimal preview = rows.stream()
                .filter(a -> PREVIEW_ROW.equals(a.getRowKey()) && PREVIEW_FIELD.equals(a.getField()))
                .map(a -> nz(a.getAmount())).findFirst().orElse(BigDecimal.ZERO);
            months.add(new MonthMeta(m, !rows.isEmpty(), r2(preview)));
        }
        return new ReportYearDTO(year, months);
    }

    // ── 保存本期(clear+insert 该期该公司该 statement 全部金额) ──
    @Transactional
    public ReportPeriodDTO save(String statement, int companyId, int year, int month, ReportSaveReq req) {
        checkStatement(statement);
        requireCompany(companyId);
        clearPeriod(companyId, statement, year, month);
        if (req != null && req.cells() != null) {
            for (ReportSaveReq.Cell c : req.cells()) insertCell(companyId, statement, year, month, c.rowKey(), c.field(), c.amount());
        }
        return period(statement, companyId, year, month);
    }

    // ── 加自定义子类(生成稳定 rowKey 'isc-<seq>' 每公司自增) ──
    @Transactional
    public ReportCustomRowDTO addCustomRow(String statement, int companyId, String parentKey, String label, int level) {
        checkStatement(statement);
        requireCompany(companyId);
        if (parentKey == null || parentKey.isBlank()) throw new BizException(ResultCode.BAD_REQUEST, "父行不能为空");
        if (label == null || label.isBlank()) throw new BizException(ResultCode.BAD_REQUEST, "名称不能为空");
        ReportCustomRow row = new ReportCustomRow();
        row.setCompanyId(companyId);
        row.setStatement(statement);
        row.setRowKey(nextCustomKey(companyId, statement));
        row.setParentKey(parentKey);
        row.setLabel(label.trim());
        row.setLevel(level);
        customRows.insert(row);
        return toCustomDTO(customRows.selectById(row.getId()));
    }

    // ── 删自定义子类(级联删其后代 + 全部这些行的金额) ──
    @Transactional
    public void deleteCustomRow(String statement, long id) {
        checkStatement(statement);
        ReportCustomRow row = customRows.selectById(id);
        if (row == null) throw new BizException(ResultCode.NOT_FOUND, "自定义行不存在");
        // 收集该公司该 statement 下 id 为根的整棵子树 rowKey(含自身)
        List<ReportCustomRow> pool = customRows.forCompany(row.getCompanyId(), statement);
        Map<String, List<ReportCustomRow>> byParent = pool.stream()
            .collect(Collectors.groupingBy(ReportCustomRow::getParentKey));
        Set<String> toDelete = new LinkedHashSet<>();
        Deque<String> stack = new ArrayDeque<>();
        stack.push(row.getRowKey());
        while (!stack.isEmpty()) {
            String key = stack.pop();
            toDelete.add(key);
            for (ReportCustomRow child : byParent.getOrDefault(key, List.of())) stack.push(child.getRowKey());
        }
        // 删这些行的金额(所有期)
        amounts.delete(new QueryWrapper<ReportAmount>()
            .eq("company_id", row.getCompanyId()).eq("statement", statement)
            .in("row_key", toDelete));
        // 删自定义行本身
        customRows.delete(new QueryWrapper<ReportCustomRow>()
            .eq("company_id", row.getCompanyId()).eq("statement", statement)
            .in("row_key", toDelete));
    }

    // ── 导入本期:每公司一段,公司名匹配 management_company(未匹配自动新建);per 公司 clear+insert 本期 ──
    @Transactional
    public ImportResultDTO importRows(String statement, int year, int month, ReportImportRequest req) {
        checkStatement(statement);
        Map<String, Integer> byName = companies.selectList(null).stream()
            .collect(Collectors.toMap(ManagementCompany::getName, ManagementCompany::getId, (a, b) -> a));
        int imported = 0;
        List<ImportError> errors = new ArrayList<>();
        List<ReportImportRequest.CompanySection> sections = req == null || req.sections() == null ? List.of() : req.sections();
        for (int i = 0; i < sections.size(); i++) {
            ReportImportRequest.CompanySection sec = sections.get(i);
            String name = sec.companyName() == null ? null : sec.companyName().trim();
            if (name == null || name.isEmpty()) {
                errors.add(new ImportError(i, sec.companyName(), "公司名称为空"));
                continue;
            }
            Integer companyId = byName.get(name);
            if (companyId == null) companyId = createCompany(name, byName);
            clearPeriod(companyId, statement, year, month);
            List<ReportImportRequest.Cell> cells = sec.cells() == null ? List.of() : sec.cells();
            for (ReportImportRequest.Cell c : cells) {
                insertCell(companyId, statement, year, month, c.rowKey(), c.field(), c.amount());
                imported++;
            }
        }
        return new ImportResultDTO(imported, errors.size(), errors);
    }

    // ── helpers ──
    private void clearPeriod(int companyId, String statement, int year, int month) {
        amounts.delete(new QueryWrapper<ReportAmount>()
            .eq("company_id", companyId).eq("statement", statement)
            .eq("year", year).eq("month", month));
    }

    private void insertCell(int companyId, String statement, int year, int month, String rowKey, String field, BigDecimal amount) {
        ReportAmount a = new ReportAmount();
        a.setCompanyId(companyId); a.setStatement(statement);
        a.setYear(year); a.setMonth(month);
        a.setRowKey(rowKey); a.setField(field); a.setAmount(r2(amount));
        amounts.insert(a);
    }

    // 自动新建公司(short 派生复用 CompanyService.deriveShort 规则)
    private int createCompany(String name, Map<String, Integer> cache) {
        ManagementCompany c = new ManagementCompany();
        c.setName(name);
        c.setShortName(CompanyService.deriveShort(name));
        c.setSortNo(0);
        companies.insert(c);
        cache.put(name, c.getId());
        return c.getId();
    }

    private String nextCustomKey(int companyId, String statement) {
        int max = 0;
        for (ReportCustomRow r : customRows.forCompany(companyId, statement)) {
            String k = r.getRowKey();
            if (k != null && k.startsWith("isc-")) {
                try { max = Math.max(max, Integer.parseInt(k.substring(4))); } catch (NumberFormatException ignore) {}
            }
        }
        return "isc-" + (max + 1);
    }

    private static Map<String, ReportMonthCellDTO> toCellMap(List<ReportAmount> rows) {
        Map<String, BigDecimal[]> acc = new LinkedHashMap<>();
        for (ReportAmount a : rows) {
            BigDecimal[] cell = acc.computeIfAbsent(a.getRowKey(), k -> new BigDecimal[]{ BigDecimal.ZERO, BigDecimal.ZERO });
            int i = "ytd".equals(a.getField()) ? 1 : 0;
            cell[i] = cell[i].add(nz(a.getAmount()));
        }
        Map<String, ReportMonthCellDTO> map = new LinkedHashMap<>();
        acc.forEach((k, v) -> map.put(k, new ReportMonthCellDTO(r2(v[0]), r2(v[1]))));
        return map;
    }

    private static ReportCustomRowDTO toCustomDTO(ReportCustomRow r) {
        return new ReportCustomRowDTO(r.getId(), r.getRowKey(), r.getParentKey(), r.getLabel(),
            r.getLevel() == null ? 1 : r.getLevel());
    }
}

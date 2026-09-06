package com.park.demo3.service;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import com.park.demo3.dto.BudgetImportRequest;
import com.park.demo3.dto.BudgetRowDTO;
import com.park.demo3.dto.ImportResultDTO;
import com.park.demo3.entity.BudgetRow;
import com.park.demo3.mapper.BudgetRowMapper;
import com.park.demo3.security.NoReviewGuard;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

@Service
public class BudgetService {
    private final BudgetRowMapper rows;
    public BudgetService(BudgetRowMapper rows) { this.rows = rows; }

    // NULL 保留(该年无此值),非空四舍五入到分(同 pnl 惯例)
    private static BigDecimal r2n(BigDecimal v) { return v == null ? null : v.setScale(2, RoundingMode.HALF_UP); }

    // ── 导入:按 payload 内出现的 year 整年替换(delete+insert) ──
    @Transactional
    @NoReviewGuard(reason = "预算行按年落库(budget_row 只有 year 没有 acct_month),不属任何月;审核键全是月度的,无键可挂")
    public ImportResultDTO importRows(BudgetImportRequest req) {
        List<BudgetRowDTO> dtos = req == null || req.rows() == null ? List.of() : req.rows();
        Set<Integer> years = new LinkedHashSet<>();
        for (BudgetRowDTO dto : dtos) {
            if (dto.year() < 2000 || dto.year() > 2100) throw new BizException(ResultCode.BAD_REQUEST, "非法年份");
            if (dto.label() == null || dto.label().isBlank()) throw new BizException(ResultCode.BAD_REQUEST, "科目不能为空");
            years.add(dto.year());
        }
        for (int y : years) rows.delete(new QueryWrapper<BudgetRow>().eq("year", y));
        int n = 0;
        for (BudgetRowDTO dto : dtos) {
            BudgetRow r = new BudgetRow();
            r.setYear(dto.year());
            r.setLabel(dto.label().trim());
            r.setSub(dto.sub());
            r.setAmountBudget(r2n(dto.budget()));
            r.setAmountActual(r2n(dto.actual()));
            r.setNote(dto.note() == null || dto.note().isBlank() ? null : dto.note());
            r.setSortOrder(dto.sortOrder());
            rows.insert(r);
            n++;
        }
        return new ImportResultDTO(n, 0, List.of());
    }

    // ── 全部行(表小,一次拉全;按 year、sort_order) ──
    public List<BudgetRowDTO> all() {
        return rows.all().stream().map(r -> new BudgetRowDTO(
            r.getYear(), r.getLabel(), Boolean.TRUE.equals(r.getSub()),
            r.getAmountBudget(), r.getAmountActual(), r.getNote(),
            r.getSortOrder() == null ? 0 : r.getSortOrder())).toList();
    }
}

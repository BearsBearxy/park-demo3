package com.park.demo3.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.park.demo3.entity.BookMonthPin;
import com.park.demo3.entity.MonthlyLedger;
import com.park.demo3.entity.S10Record;
import com.park.demo3.mapper.BookMonthPinMapper;
import com.park.demo3.mapper.MonthlyLedgerMapper;
import com.park.demo3.mapper.S10RecordMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 模板 pin 的解析 / 固化 / 冻结判定(spec 2026-08-26 §3)。
 * 独立成类:BookService 已经在管版本链与模板保存,再把按月语义塞进去会变成什么都管的大类。
 */
@Service
public class BookPinService {
    private final BookMonthPinMapper pins;
    private final BookService books;
    private final MonthlyLedgerMapper ledgerRows;
    private final S10RecordMapper s10Rows;

    // @Lazy 打破循环:BookService 也注入本类(它要按月解析版本),两边构造器互等会启动失败
    public BookPinService(BookMonthPinMapper pins,
                          @org.springframework.context.annotation.Lazy BookService books,
                          MonthlyLedgerMapper ledgerRows, S10RecordMapper s10Rows) {
        this.pins = pins; this.books = books;
        this.ledgerRows = ledgerRows; this.s10Rows = s10Rows;
    }

    /** 该月是否已录入(看当前有无数据行,不看 pin 在不在 —— 删光数据即自动解冻)。 */
    public boolean hasData(String screen, Integer ownerId, int year, int month) {
        if ("ledger".equals(screen))
            return ledgerRows.selectCount(new QueryWrapper<MonthlyLedger>()
                .eq("company_id", ownerId).eq("period_year", year).eq("period_month", month)) > 0;
        String ym = String.format("%04d-%02d", year, month);
        return s10Rows.selectCount(new QueryWrapper<S10Record>()
            .eq("phase", ownerId).eq("acct_month", ym)) > 0;
    }

    /** P3 解析:本月 pin → 最近一个更早月份的 pin(跨空月) → 该册链尾。 */
    public Long resolve(String screen, Integer ownerId, int year, int month, Integer chainBookId) {
        BookMonthPin here = pins.at(screen, ownerId, year, month);
        if (here != null) return here.getVersionId();
        BookMonthPin earlier = pins.latestBefore(screen, ownerId, year, month);
        if (earlier != null) return earlier.getVersionId();
        return books.tipVersionId(chainBookId);
    }

    /** P6 固化:该月第一次落库数据时把当时解析出的版本钉死。已有 pin 则不动。 */
    @Transactional
    public void materialize(String screen, Integer ownerId, int year, int month, Long versionId) {
        if (pins.at(screen, ownerId, year, month) != null) return;
        BookMonthPin p = new BookMonthPin();
        p.setScreen(screen); p.setOwnerId(ownerId);
        p.setPeriodYear(year); p.setPeriodMonth(month); p.setVersionId(versionId);
        pins.insert(p);
    }

    /** 显式钉版(选择器)。与 materialize 不同:已有 pin 时覆盖。 */
    @Transactional
    public void pin(String screen, Integer ownerId, int year, int month, Long versionId) {
        BookMonthPin ex = pins.at(screen, ownerId, year, month);
        if (ex == null) { materialize(screen, ownerId, year, month, versionId); return; }
        ex.setVersionId(versionId);
        pins.updateById(ex);
    }

    /** 回填(幂等,BookSeeder 启动调用):已有数据的每个月钉上该册当时的现行版。
     *  没数据的月份不建行 —— 靠 resolve 兜,少一堆没人看的行。 */
    @Transactional
    public void migrateExisting() {
        if (pins.existsAny()) return;                       // 幂等键
        for (Object[] row : books.existingLedgerMonths())   // {companyId, year, month, versionId}
            materialize("ledger", (Integer) row[0], (Integer) row[1], (Integer) row[2], (Long) row[3]);
        for (Object[] row : books.existingS10Months())      // {phase, year, month, versionId}
            materialize("s10", (Integer) row[0], (Integer) row[1], (Integer) row[2], (Long) row[3]);
        books.clearLedgerCompanyPointers();                 // 见下:作废的字段要真的作废
    }
}

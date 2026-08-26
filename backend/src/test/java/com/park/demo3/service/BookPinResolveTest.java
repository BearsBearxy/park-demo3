package com.park.demo3.service;
import com.park.demo3.entity.BookMonthPin;
import com.park.demo3.mapper.BookMonthPinMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;
import static org.assertj.core.api.Assertions.assertThat;

// 解析顺序(spec P3):本月 pin → 最近一个更早月份的 pin(跨空月) → 链尾。
class BookPinResolveTest {
    BookMonthPinMapper pins = Mockito.mock(BookMonthPinMapper.class);
    BookService bookSvc = Mockito.mock(BookService.class);
    BookPinService svc = new BookPinService(pins, bookSvc);

    static BookMonthPin pin(long verId) { BookMonthPin p = new BookMonthPin(); p.setVersionId(verId); return p; }

    @Test
    void resolve_prefersExplicitPinOfThatMonth() {
        Mockito.when(pins.at("ledger", 1, 2026, 3)).thenReturn(pin(77L));
        assertThat(svc.resolve("ledger", 1, 2026, 3, 9)).isEqualTo(77L);
        Mockito.verify(pins, Mockito.never()).latestBefore(Mockito.any(), Mockito.any(), Mockito.anyInt(), Mockito.anyInt());
    }

    @Test
    void resolve_fallsBackToNearestEarlierPin_acrossEmptyMonths() {
        Mockito.when(pins.at("ledger", 1, 2026, 5)).thenReturn(null);
        Mockito.when(pins.latestBefore("ledger", 1, 2026, 5)).thenReturn(pin(42L));   // 可能是 2026-01
        assertThat(svc.resolve("ledger", 1, 2026, 5, 9)).isEqualTo(42L);
    }

    @Test
    void resolve_fallsBackToChainTip_whenBookHasNoPinAtAll() {
        Mockito.when(pins.at("ledger", 1, 2026, 5)).thenReturn(null);
        Mockito.when(pins.latestBefore("ledger", 1, 2026, 5)).thenReturn(null);
        Mockito.when(bookSvc.tipVersionId(9)).thenReturn(5L);
        assertThat(svc.resolve("ledger", 1, 2026, 5, 9)).isEqualTo(5L);
    }

    @Test
    void materialize_isNoOpWhenPinAlreadyExists() {
        Mockito.when(pins.at("ledger", 1, 2026, 3)).thenReturn(pin(77L));
        svc.materialize("ledger", 1, 2026, 3, 99L);
        // any(BookMonthPin.class) 而非 any():BaseMapper 有 insert(T)/insert(Collection<T>) 两个重载,裸 any() 不能定型
        Mockito.verify(pins, Mockito.never()).insert(Mockito.any(BookMonthPin.class));
    }

    @Test
    void materialize_insertsWhenAbsent() {
        Mockito.when(pins.at("ledger", 1, 2026, 3)).thenReturn(null);
        svc.materialize("ledger", 1, 2026, 3, 99L);
        // 只数一次 insert 证明不了写对了列:五个入参全是 (screen, owner, 年, 月, 版本),错位了照样插一行
        assertThat(captureInsert()).extracting(BookMonthPin::getScreen, BookMonthPin::getOwnerId,
                BookMonthPin::getPeriodYear, BookMonthPin::getPeriodMonth, BookMonthPin::getVersionId)
            .containsExactly("ledger", 1, 2026, 3, 99L);
    }

    // ── 附表10 半边:owner_id 是 phase,不是 company_id(spec §5)。 ──
    // 两屏同做是硬性约束,上面 5 条全是 "ledger" —— 没有下面这些,s10 侧一行断言都没有。

    @Test
    void resolve_s10_prefersExplicitPinOfThatMonth() {
        Mockito.when(pins.at("s10", 3, 2026, 6)).thenReturn(pin(64L));
        assertThat(svc.resolve("s10", 3, 2026, 6, 4)).isEqualTo(64L);
        Mockito.verify(pins, Mockito.never()).latestBefore(Mockito.any(), Mockito.any(), Mockito.anyInt(), Mockito.anyInt());
    }

    @Test
    void resolve_s10_fallsBackToNearestEarlierPin_acrossEmptyMonths() {
        Mockito.when(pins.at("s10", 3, 2026, 6)).thenReturn(null);
        Mockito.when(pins.latestBefore("s10", 3, 2026, 6)).thenReturn(pin(31L));   // 可能是 2024-01
        assertThat(svc.resolve("s10", 3, 2026, 6, 4)).isEqualTo(31L);
    }

    @Test
    void resolve_s10_fallsBackToItsOwnChainTip_whenPhaseHasNoPinAtAll() {
        // s10 一册一链:链尾问的是该期区自己的册,不是台账宿主
        Mockito.when(pins.at("s10", 4, 2026, 6)).thenReturn(null);
        Mockito.when(pins.latestBefore("s10", 4, 2026, 6)).thenReturn(null);
        Mockito.when(bookSvc.tipVersionId(7)).thenReturn(12L);
        assertThat(svc.resolve("s10", 4, 2026, 6, 7)).isEqualTo(12L);
    }

    @Test
    void materialize_s10_writesPhaseIntoOwnerId() {
        Mockito.when(pins.at("s10", 2, 2024, 1)).thenReturn(null);
        svc.materialize("s10", 2, 2024, 1, 12L);
        assertThat(captureInsert()).extracting(BookMonthPin::getScreen, BookMonthPin::getOwnerId,
                BookMonthPin::getPeriodYear, BookMonthPin::getPeriodMonth, BookMonthPin::getVersionId)
            .containsExactly("s10", 2, 2024, 1, 12L);
    }

    @Test
    void materialize_s10_isNoOpWhenPinAlreadyExists() {
        Mockito.when(pins.at("s10", 2, 2024, 1)).thenReturn(pin(12L));
        svc.materialize("s10", 2, 2024, 1, 99L);
        Mockito.verify(pins, Mockito.never()).insert(Mockito.any(BookMonthPin.class));
    }

    private BookMonthPin captureInsert() {
        ArgumentCaptor<BookMonthPin> cap = ArgumentCaptor.forClass(BookMonthPin.class);
        Mockito.verify(pins, Mockito.times(1)).insert(cap.capture());
        return cap.getValue();
    }
}

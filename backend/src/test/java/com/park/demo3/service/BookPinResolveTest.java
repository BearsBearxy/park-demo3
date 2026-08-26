package com.park.demo3.service;
import com.park.demo3.entity.BookMonthPin;
import com.park.demo3.mapper.BookMonthPinMapper;
import org.junit.jupiter.api.Test;
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
        Mockito.verify(pins, Mockito.times(1)).insert(Mockito.any(BookMonthPin.class));
    }
}

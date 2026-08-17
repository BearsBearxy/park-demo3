package com.park.demo3.service;

import com.park.demo3.service.VersionResolver.Hit;
import com.park.demo3.service.VersionResolver.Row;
import org.junit.jupiter.api.Test;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

// S21-PARAM-CENTER-SPEC §2.2 取值规则锁定:month 精确命中优先;from 取 acct_month<=ym 最大('' 最小前滚);级联首中即返。
class VersionResolverTest {

    private static Row row(String scope, String key, String month, String mode, String v, int id) {
        return new Row(scope, key, month, mode, new BigDecimal(v), id);
    }
    private static BigDecimal val(Hit h) { return h == null ? null : h.value(); }

    // ① '' from=1, 2024-02 from=2 → 2023-08→1、2024-02→2、2024-05→2(版本前滚)
    @Test
    void fromChain_rollsForward() {
        List<Row> rows = List.of(row("p1", "k", "", "from", "1", 1), row("p1", "k", "2024-02", "from", "2", 2));
        assertEquals(0, val(VersionResolver.resolveOne(rows, "2023-08")).compareTo(BigDecimal.ONE));
        assertEquals(0, val(VersionResolver.resolveOne(rows, "2024-02")).compareTo(new BigDecimal("2")));
        assertEquals(0, val(VersionResolver.resolveOne(rows, "2024-05")).compareTo(new BigDecimal("2")));
        assertEquals(2, VersionResolver.resolveOne(rows, "2024-05").id());
        assertEquals("2024-02", VersionResolver.resolveOne(rows, "2024-05").acctMonth());
    }

    // ② '' from=1, 2024-02 month=9 → 2024-02→9、2024-03→1(月行不前滚)
    @Test
    void monthRow_onlyThatMonth() {
        List<Row> rows = List.of(row("p1", "k", "", "from", "1", 1), row("p1", "k", "2024-02", "month", "9", 2));
        assertEquals(0, val(VersionResolver.resolveOne(rows, "2024-02")).compareTo(new BigDecimal("9")));
        assertEquals(0, val(VersionResolver.resolveOne(rows, "2024-03")).compareTo(BigDecimal.ONE));
        assertEquals(0, val(VersionResolver.resolveOne(rows, "2024-01")).compareTo(BigDecimal.ONE));
    }

    // ③ 同月 from 与 month 并存 → month 胜;次月落 from
    @Test
    void sameMonth_monthBeatsFrom() {
        List<Row> rows = List.of(row("p1", "k", "2024-02", "from", "2", 1), row("p1", "k", "2024-02", "month", "9", 2));
        Hit h = VersionResolver.resolveOne(rows, "2024-02");
        assertEquals(0, h.value().compareTo(new BigDecimal("9")));
        assertEquals("month", h.mode());
        assertEquals(0, val(VersionResolver.resolveOne(rows, "2024-03")).compareTo(new BigDecimal("2")));
        assertNull(VersionResolver.resolveOne(rows, "2024-01"));   // 两行都在 2024-02 之后才生效
        assertNull(VersionResolver.resolveOne(List.of(), "2024-01"));
        assertNull(VersionResolver.resolveOne(null, "2024-01"));
    }

    // ④ 级联:tenant:5 无行、p2 有 → 命中 p2 且 scope=='p2';tenant:5 有行则户级优先
    @Test
    void cascade_firstScopeWins() {
        Map<String, Map<String, List<Row>>> index = Map.of("mgmt_fee", Map.of(
            "p2", List.of(row("p2", "mgmt_fee", "", "from", "0.16", 1)),
            "", List.of(row("", "mgmt_fee", "", "from", "0.32", 2)),
            "tenant:7", List.of(row("tenant:7", "mgmt_fee", "", "from", "0.10", 3))));
        Hit h = VersionResolver.resolve(index, "mgmt_fee", "2024-02", List.of("tenant:5", "p2", ""));
        assertEquals("p2", h.scope());
        assertEquals(0, h.value().compareTo(new BigDecimal("0.16")));
        assertEquals("tenant:7", VersionResolver.resolve(index, "mgmt_fee", "2024-02", List.of("tenant:7", "p2", "")).scope());
        assertNull(VersionResolver.resolve(index, "nope", "2024-02", List.of("p2", "")));
        assertNull(VersionResolver.resolve(index, "mgmt_fee", "2024-02", List.of("tenant:5")));
    }

    // ⑤ effectiveMap:3 组键各给站在 ym 的正确值;无命中的键不出现
    @Test
    void effectiveMap_perScopeKey() {
        List<Row> all = List.of(
            row("p1", "a", "", "from", "1", 1), row("p1", "a", "2024-02", "from", "2", 2),
            row("p1", "b", "", "from", "5", 3), row("p1", "b", "2024-02", "month", "9", 4),
            row("rule:23", "extra_qty", "2024-02", "month", "-670", 5));
        Map<String, BigDecimal> m = VersionResolver.effectiveMap(all, "2024-02");
        assertEquals(0, m.get("p1|a").compareTo(new BigDecimal("2")));
        assertEquals(0, m.get("p1|b").compareTo(new BigDecimal("9")));
        assertEquals(0, m.get("rule:23|extra_qty").compareTo(new BigDecimal("-670")));
        Map<String, BigDecimal> m3 = VersionResolver.effectiveMap(all, "2024-03");
        assertEquals(0, m3.get("p1|a").compareTo(new BigDecimal("2")));
        assertEquals(0, m3.get("p1|b").compareTo(new BigDecimal("5")));
        assertFalse(m3.containsKey("rule:23|extra_qty"));
        Map<String, BigDecimal> m0 = VersionResolver.effectiveMap(all, "2023-08");
        assertEquals(0, m0.get("p1|a").compareTo(BigDecimal.ONE));
        assertEquals(0, m0.get("p1|b").compareTo(new BigDecimal("5")));
    }

    // ⑥ nextFrom:from 链里 acctMonth 之后的下一版本起点;month 行不算版本;无=null
    @Test
    void nextFrom_nextVersionStart() {
        List<Row> rows = List.of(row("p1", "k", "", "from", "1", 1), row("p1", "k", "2023-11", "from", "2", 2),
            row("p1", "k", "2024-02", "from", "3", 3), row("p1", "k", "2023-09", "month", "9", 4));
        assertEquals("2023-11", VersionResolver.nextFrom(rows, ""));
        assertEquals("2024-02", VersionResolver.nextFrom(rows, "2023-11"));
        assertNull(VersionResolver.nextFrom(rows, "2024-02"));
        assertEquals("2023-11", VersionResolver.nextFrom(rows, null));
    }
}

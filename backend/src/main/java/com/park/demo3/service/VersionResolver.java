package com.park.demo3.service;
import java.math.BigDecimal;
import java.util.*;

// 参数版本取值(S21-PARAM-CENTER-SPEC §2.2),tenant_price_cfg / alloc_cfg 两表共用的纯函数:
//   同 (scope,key) 的行里,mode='month' 且 acct_month==ym 的行先命中;否则 mode='from' 且 acct_month<=ym 的
//   acct_month 最大者(''=初始版最小,自动前滚)。scope 按级联序(具体→一般)首中即返。
//   YYYY-MM 字典序=时间序,字符串比较即可。
public final class VersionResolver {
    private VersionResolver() {}

    public record Row(String scope, String key, String acctMonth, String mode, BigDecimal value, Integer id) {}
    public record Hit(BigDecimal value, String scope, String acctMonth, String mode, Integer id) {}

    /** rows=同一 (scope,key) 的全部行;ym='YYYY-MM'。month 精确命中优先,否则 from 中 acctMonth<=ym 最大('' 最小)。 */
    public static Hit resolveOne(List<Row> rows, String ym) {
        if (rows == null) return null;
        Row from = null;
        for (Row r : rows) {
            String m = r.acctMonth() == null ? "" : r.acctMonth();
            if ("month".equals(r.mode())) {
                if (m.equals(ym)) return hit(r);
                continue;
            }
            if (m.compareTo(ym) > 0) continue;
            if (from == null || m.compareTo(from.acctMonth() == null ? "" : from.acctMonth()) > 0) from = r;
        }
        return from == null ? null : hit(from);
    }

    /** scopes 按级联序(具体→一般),首中即返。index: key -> scope -> rows */
    public static Hit resolve(Map<String, Map<String, List<Row>>> index, String key, String ym, List<String> scopes) {
        Map<String, List<Row>> byScope = index.get(key);
        if (byScope == null) return null;
        for (String scope : scopes) {
            Hit h = resolveOne(byScope.get(scope), ym);
            if (h != null) return h;
        }
        return null;
    }

    /** 全部行 → 站在 ym 的 (scope|key → value) 扁平表(供 AllocService.loadCtx 无痛替换 ''∪当月 的旧 map) */
    public static Map<String, BigDecimal> effectiveMap(List<Row> all, String ym) {
        Map<String, List<Row>> grouped = new HashMap<>();
        for (Row r : all) grouped.computeIfAbsent(r.scope() + "|" + r.key(), k -> new ArrayList<>()).add(r);
        Map<String, BigDecimal> out = new HashMap<>();
        for (Map.Entry<String, List<Row>> e : grouped.entrySet()) {
            Hit h = resolveOne(e.getValue(), ym);
            if (h != null) out.put(e.getKey(), h.value());
        }
        return out;
    }

    /** 生效区间文本用:同 (scope,key) from 链里,acctMonth 之后的下一版本起点(无=null) */
    public static String nextFrom(List<Row> rows, String acctMonth) {
        String cur = acctMonth == null ? "" : acctMonth, next = null;
        for (Row r : rows) {
            if (!"from".equals(r.mode())) continue;
            String m = r.acctMonth() == null ? "" : r.acctMonth();
            if (m.compareTo(cur) > 0 && (next == null || m.compareTo(next) < 0)) next = m;
        }
        return next;
    }

    private static Hit hit(Row r) {
        return new Hit(r.value(), r.scope(), r.acctMonth() == null ? "" : r.acctMonth(), r.mode(), r.id());
    }
}

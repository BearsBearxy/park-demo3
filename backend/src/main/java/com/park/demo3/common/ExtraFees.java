package com.park.demo3.common;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 方案A 弹性口袋(BOOK-WORKBENCH-SPEC §2):自定义列的行级 JSON,键=列固定 id(c_xxx),值=金额。
 * 口径铁律:应收Σ = 21 物理列 + 口袋全部值 —— 消费方一律经 LedgerService.recalc,不得自算。
 */
public final class ExtraFees {
    private static final ObjectMapper M = new ObjectMapper();
    private static final TypeReference<LinkedHashMap<String, BigDecimal>> T = new TypeReference<>() {};

    private ExtraFees() {}

    /** 解析 JSON 口袋;null/空串/坏 JSON → 空 map(坏数据不炸读路径,写路径有校验兜住)。 */
    public static Map<String, BigDecimal> parse(String json) {
        if (json == null || json.isBlank()) return new LinkedHashMap<>();
        try {
            Map<String, BigDecimal> m = M.readValue(json, T);
            return m == null ? new LinkedHashMap<>() : m;
        } catch (Exception e) {
            return new LinkedHashMap<>();
        }
    }

    /** 序列化;空 map → null(库里存 NULL 不存 '{}',与存量行为一致)。值统一 2 位小数(与 21 物理列 r2 同口径)。 */
    public static String write(Map<String, BigDecimal> m) {
        if (m == null || m.isEmpty()) return null;
        Map<String, BigDecimal> r2 = new LinkedHashMap<>();
        for (Map.Entry<String, BigDecimal> e : m.entrySet())
            if (e.getValue() != null)   // null 值=该列无值,不落键:全 null 包塌缩为 NULL 存储,不留 {"c_x":null} 噪音
                r2.put(e.getKey(), e.getValue().setScale(2, java.math.RoundingMode.HALF_UP));
        if (r2.isEmpty()) return null;
        try {
            return M.writeValueAsString(r2);
        } catch (Exception e) {
            throw new IllegalStateException("extra_fees 序列化失败", e);
        }
    }

    public static BigDecimal sum(String json) {
        BigDecimal s = BigDecimal.ZERO;
        for (BigDecimal v : parse(json).values()) if (v != null) s = s.add(v);
        return s;
    }

    /** 导入语义:按键合并(键出现=覆盖该键,含显式 0;键缺席=不动)。 */
    public static String mergeKeys(String existing, Map<String, BigDecimal> incoming) {
        if (incoming == null || incoming.isEmpty()) return existing;
        Map<String, BigDecimal> m = parse(existing);
        m.putAll(incoming);
        return write(m);
    }
}

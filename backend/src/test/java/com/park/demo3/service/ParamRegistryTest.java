package com.park.demo3.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.park.demo3.service.ParamRegistry.Def;
import com.park.demo3.service.ParamRegistry.ScopeKind;
import com.park.demo3.service.ParamRegistry.Table;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.*;

// S21-PARAM-CENTER-SPEC §2.3/§3 注册表锁定:全部键已注册 / 作用域形态门 / 默认生效方式 / 退役键不注册 /
// 人话文案(无字段名、无内部标识) / 价目簿白名单=注册表 PRICE 键集合。末尾把注册表导出 target/param-registry.json
// (前端 utils/paramRegistry.spec.ts 拷去做镜像比对,Task 10)。
class ParamRegistryTest {

    // spec §3.1~§3.4 全部键(退役键不在此列)
    static final List<String> SPEC_KEYS = List.of(
        // ①
        "elec_commercial", "elec_peak", "elec_sharp", "elec_flat", "elec_valley", "elec_resident",
        "sharp_as_peak_ratio", "elevator_area_base", "loss_adj_qty", "loss_rate_manual", "extra_qty", "manual_qty",
        "loss_base_park_amount", "elec_grid_avg",   // M1 拍板(2026-08-16):二期损耗折算用 供电局综合月均裸价,统一入口
        // ②
        "mgmt_fee", "mgmt_fee_commercial", "capacity_fee", "water", "water_pipe",
        "lamp_area_base", "green_area_base", "area_base", "park_share_div", "loss_adj_rate",
        "coefficient", "std_add", "price_override",
        // 光伏分栋分析:年锚点 + 五条判据线(PV-ANALYSIS-SPEC §04),只有全局一档
        "pv_yield_anchor_h", "pv_band_sigma", "pv_band_run",
        "pv_crit_cover_month", "pv_crit_ledger", "pv_crit_yield_ratio",
        // ③
        "loss_variant", "loss_head", "loss_c_meter", "loss_recon", "loss_exclude", "loss_denom_cable",
        "loss_supply_meter", "frozen_2023", "zone_calc_kind",
        // ④
        "elec_package", "share_elec_fixed", "share_water_fixed", "green_rate", "lamp_rate", "fire_amount_fixed",
        "loss_base_form", "loss_base_form_b{bid}", "loss_base_form_b32", "loss_base_park_meter");

    static final List<String> RETIRED = List.of("loss_g_adj", "price_flat", "price_loss", "price_norm", "price_sharp",
        "price_peak", "price_valley", "green_rate_live", "lamp_rate_live", "loss_rate", "no_such_key", "lamp_sqm");

    static final Pattern FORBIDDEN = Pattern.compile("(building:|rule:|meter:|tenant:|默认·所有月份|_)");

    // ① 每个 spec §3 键都已注册(含前缀键 loss_base_form_b{bid} 的具体实例)
    @Test
    void allSpecKeysRegistered() {
        for (String k : SPEC_KEYS) assertNotNull(ParamRegistry.get(k), "未注册: " + k);
        assertEquals("loss_base_form_b{bid}", ParamRegistry.get("loss_base_form_b13").key());
        assertNull(ParamRegistry.get("loss_base_form_bx"));
        // 注册表里没有 spec 之外的键
        Set<String> spec = new HashSet<>(SPEC_KEYS);
        for (Def d : ParamRegistry.all()) assertTrue(spec.contains(d.key()), "spec 外的键: " + d.key());
    }

    // ② 作用域形态门
    @Test
    void allowed_scopeKind() {
        assertTrue(ParamRegistry.allowed("loss_variant", "building:13"));
        assertFalse(ParamRegistry.allowed("loss_variant", "p1"));
        assertFalse(ParamRegistry.allowed("loss_variant", ""));
        assertTrue(ParamRegistry.allowed("elec_peak", ""));
        assertTrue(ParamRegistry.allowed("elec_peak", "p2"));
        assertFalse(ParamRegistry.allowed("elec_peak", "tenant:5"));
        assertTrue(ParamRegistry.allowed("mgmt_fee", "tenant:5"));
        assertTrue(ParamRegistry.allowed("coefficient", "rule:23"));
        assertFalse(ParamRegistry.allowed("coefficient", "building:13"));
        assertTrue(ParamRegistry.allowed("loss_exclude", "meter:307"));
        assertTrue(ParamRegistry.allowed("loss_denom_cable", "p2"));
        assertTrue(ParamRegistry.allowed("loss_denom_cable", "building:30"));
        assertTrue(ParamRegistry.allowed("loss_base_form_b32", "tenant:9"));
        assertFalse(ParamRegistry.allowed("elec_peak", "px"));          // 非法 scope(p\d+ 会收下 p9,只能用非数字后缀)
        assertTrue(ParamRegistry.allowed("elec_peak", "p3"));           // 三期:放宽后必须通过
        assertFalse(ParamRegistry.allowed("elec_peak", "building:x"));  // 非数字 id
        assertFalse(ParamRegistry.allowed("no_such_key", ""));
        // 只有全局一档(S_GLOBAL_ONLY):判据线是全园一条,按期分设等于给一期二期画两条不同的线
        assertTrue(ParamRegistry.allowed("pv_band_sigma", ""));
        assertFalse(ParamRegistry.allowed("pv_band_sigma", "p1"));
        assertFalse(ParamRegistry.allowed("pv_yield_anchor_h", "building:13"));
        assertNull(ParamRegistry.scopeKind("px"));
        assertEquals(ScopeKind.ZONE, ParamRegistry.scopeKind("p3"));
        assertEquals(ScopeKind.GLOBAL, ParamRegistry.scopeKind(null));
    }

    // ③ 默认生效方式:电价 month / 常数与结构键 from / 月参 month
    @Test
    void defaultMode() {
        assertEquals("month", ParamRegistry.defaultMode("elec_peak"));
        assertEquals("from", ParamRegistry.defaultMode("coefficient"));
        assertEquals("month", ParamRegistry.defaultMode("extra_qty"));
        assertEquals("month", ParamRegistry.defaultMode("loss_adj_qty"));
        assertEquals("month", ParamRegistry.defaultMode("loss_base_park_amount"));
        assertEquals("from", ParamRegistry.defaultMode("elevator_area_base"));
        assertEquals("from", ParamRegistry.defaultMode("loss_variant"));
        assertNull(ParamRegistry.defaultMode("loss_g_adj"));
        assertEquals(Table.PRICE, ParamRegistry.tableOf("water"));
        assertEquals(Table.ALLOC, ParamRegistry.tableOf("loss_head"));
    }

    // ④ 退役键不注册(写入 400 由 PriceCfgService/AllocService 用 allowed 挡)
    @Test
    void retiredKeys_notRegistered() {
        for (String k : RETIRED) {
            assertNull(ParamRegistry.get(k), "退役键不该注册: " + k);
            assertFalse(ParamRegistry.allowed(k, ""));
            assertFalse(ParamRegistry.allowed(k, "p1"));
        }
    }

    // ⑤ 人话:label/formula/hint/枚举字典 不含下划线与内部标识
    @Test
    void humanText_noInternalIds() {
        for (Def d : ParamRegistry.all()) {
            assertFalse(FORBIDDEN.matcher(d.label()).find(), d.key() + " label: " + d.label());
            assertFalse(d.label().isBlank(), d.key() + " label 空");
            if (d.formula() != null) assertFalse(FORBIDDEN.matcher(d.formula()).find(), d.key() + " formula: " + d.formula());
            if (d.hint() != null) assertFalse(FORBIDDEN.matcher(d.hint()).find(), d.key() + " hint: " + d.hint());
            if (d.enumOptions() != null)
                for (String t : d.enumOptions().values()) assertFalse(FORBIDDEN.matcher(t).find(), d.key() + " enum: " + t);
            assertTrue(d.defaultMode().equals("from") || d.defaultMode().equals("month"), d.key());
            assertFalse(d.scopes().isEmpty(), d.key() + " 无作用域");
            if (d.valueKind() == ParamRegistry.ValueKind.ENUM) assertNotNull(d.enumOptions(), d.key() + " 枚举缺字典");
            if (d.pairedWith() != null) assertNotNull(ParamRegistry.get(d.pairedWith()), d.key() + " 配套键未注册");
        }
    }

    // ⑥ 价目簿白名单 = 注册表 PRICE 键集合(新键放行,退役键出局);月变键 = PRICE 且默认 month
    @Test
    void priceWhitelist_isRegistry() {
        Set<String> price = ParamRegistry.keysOf(Table.PRICE);
        assertEquals(price, PriceCfgService.CFG_KEYS);
        assertTrue(price.containsAll(List.of("fire_amount_fixed", "loss_base_form", "loss_base_park_meter",
            "loss_base_park_amount", "lamp_rate", "green_rate")));
        assertFalse(price.contains("loss_rate"));
        assertFalse(price.contains("green_rate_live"));
        assertEquals(Set.of("elec_peak", "elec_sharp", "elec_flat", "elec_valley", "elec_resident", "elec_commercial",
            "loss_base_park_amount", "elec_grid_avg"), PriceCfgService.MONTHLY_KEYS);
        // alloc 键不进价目簿白名单
        for (String k : List.of("coefficient", "extra_qty", "loss_variant", "loss_adj_qty")) assertFalse(price.contains(k));
    }

    // 导出 target/param-registry.json(前端镜像比对用;字段名与 utils/paramRegistry.ts ParamDef 对齐)
    @Test
    void exportJson() throws Exception {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Def d : ParamRegistry.all()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("key", d.key());
            m.put("table", d.table().name().toLowerCase());
            m.put("label", d.label());
            m.put("unit", d.unit());
            m.put("group", d.group().name().toLowerCase());
            m.put("scopes", d.scopes().stream().map(s -> s.name().toLowerCase()).sorted().toList());
            m.put("defaultMode", d.defaultMode());
            m.put("monthlyCheck", d.monthlyCheck());
            m.put("valueKind", d.valueKind().name().toLowerCase());
            m.put("enumOptions", d.enumOptions() == null ? null : new TreeMap<>(d.enumOptions()));
            m.put("formula", d.formula());
            m.put("hint", d.hint());
            m.put("tenantEditable", d.scopes().contains(ScopeKind.TENANT));
            m.put("pairedWith", d.pairedWith());
            out.add(m);
        }
        Path p = Path.of("target", "param-registry.json");
        Files.createDirectories(p.getParent());
        new ObjectMapper().enable(SerializationFeature.INDENT_OUTPUT).writeValue(p.toFile(), out);
        assertTrue(Files.size(p) > 1000);
    }
}

package com.park.demo3.service;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import com.park.demo3.dto.*;
import com.park.demo3.entity.*;
import com.park.demo3.mapper.*;
import com.park.demo3.service.ParamRegistry.Def;
import com.park.demo3.service.ParamRegistry.ScopeKind;
import com.park.demo3.service.ParamRegistry.Table;
import com.park.demo3.service.VersionResolver.Hit;
import com.park.demo3.service.VersionResolver.Row;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import org.springframework.stereotype.Service;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.time.YearMonth;
import java.util.*;
import java.util.regex.Pattern;

// 计费参数中心(S21-PARAM-CENTER-SPEC §5/§6):tenant_price_cfg + alloc_cfg 两表参数的**同一读侧**。
// 读 = 对注册表每键 × 该键在库中出现过的作用域(+「应有一行」的栋级口径键 / 池级键),站在 ym 用 VersionResolver 级联取值,
// 再做人话解析(作用域名 / 值文案 / 生效区间 / 命中链)。名字表(楼栋/池/表/租户)每次请求整表载入(皆 <1200 行)。
// 写侧(PUT/历史/重算)见 Task 8。
// 状态条 stale 判据 spec §6.3:影响本月的最近参数改动 晚于 池快照(alloc_pool_result.generated_at) 或 催缴单批次。
// ⚠ 参数日志 ts 与快照 generated_at 必须同一口钟:快照是 JVM LocalDateTime.now(),日志 ts 也在 Java 侧写入(不用 DB 默认
//   CURRENT_TIMESTAMP —— 容器 MySQL 是 UTC,本机不是),否则 stale 比较会差一个时区。
// ⚠ action='migrate' 的日志(V96/V97 迁移落的基线)不算「改动」:红线保证迁移不改已生成月取值,把它算进 stale/待重算数
//   会让三个已生成月一上线就全部亮「旧快照」;它只出现在单键历史里。
@Service
public class ParamService {
    private static final Pattern YM = Pattern.compile("\\d{4}-(0[1-9]|1[0-2])");
    // ③ 区栋级口径键:对每个损耗栋出一行(无行=默认语义) / 池级键:对每个池出一行(无行显空)
    static final Set<String> LOSS_BUILDING_KEYS = Set.of("loss_variant", "loss_head", "loss_c_meter", "loss_recon", "loss_denom_cable");
    static final Set<String> POOL_KEYS = Set.of("coefficient", "extra_qty", "manual_qty", "price_override", "std_add");
    private static final Pattern LOSS_BASE_FORM_B = Pattern.compile("loss_base_form_b(\\d+)");

    private final AllocCfgMapper allocCfgs;
    private final TenantPriceCfgMapper priceCfgs;
    private final ParamChangeLogMapper logs;
    private final AllocPoolResultMapper poolResults;
    private final BillNoticeMapper notices;
    private final BuildingMapper buildings;
    private final AllocRuleMapper rules;
    private final MeterMapper meters;
    private final TenantMapper tenants;

    public ParamService(AllocCfgMapper allocCfgs, TenantPriceCfgMapper priceCfgs, ParamChangeLogMapper logs,
                        AllocPoolResultMapper poolResults, BillNoticeMapper notices,
                        BuildingMapper buildings, AllocRuleMapper rules, MeterMapper meters, TenantMapper tenants) {
        this.allocCfgs = allocCfgs; this.priceCfgs = priceCfgs; this.logs = logs;
        this.poolResults = poolResults; this.notices = notices;
        this.buildings = buildings; this.rules = rules; this.meters = meters; this.tenants = tenants;
    }

    // ══════════ 读:站在 ym 看的全部生效参数行 ══════════

    public List<ParamRowDTO> list(String ym, String zone) {
        requireYm(ym);
        String z = zone == null || zone.isBlank() || "all".equals(zone) ? null : zone;
        Names n = names();
        Idx idx = index();
        Set<String> keys = new LinkedHashSet<>();
        for (Def d : ParamRegistry.all()) keys.add(d.key());
        keys.addAll(idx.rows.keySet());
        List<Built> out = new ArrayList<>();
        int di = 0;
        Map<String, Integer> defIndex = new HashMap<>();
        for (Def d : ParamRegistry.all()) defIndex.put(d.key(), di++);
        for (String key : keys) {
            Def d = ParamRegistry.get(key);
            if (d == null || key.equals(ParamRegistry.LOSS_BASE_FORM_B_TEMPLATE)) continue;   // 退役/未注册键不上屏
            Set<String> scopes = new LinkedHashSet<>(idx.rows.getOrDefault(key, Map.of()).keySet());
            if (LOSS_BUILDING_KEYS.contains(key)) for (Integer b : n.lossBuildings) scopes.add("building:" + b);
            if (POOL_KEYS.contains(key)) for (Integer r : n.rule.keySet()) scopes.add("rule:" + r);
            for (String s : scopes) {
                if (ParamRegistry.scopeKind(s) == null) continue;   // 畸形作用域(不该有)
                if (z != null && !inZone(s, z, n)) continue;
                out.add(new Built(buildRow(d, key, s, ym, n, idx), defIndex.get(d.key()), scopeRank(s), scopeId(s)));
            }
        }
        out.sort(Comparator.comparingInt((Built b) -> b.dto.group().equals("monthly") ? 0
                : b.dto.group().equals("constant") ? 1 : b.dto.group().equals("rule") ? 2 : 3)
            .thenComparingInt(b -> b.defIndex).thenComparingInt(b -> b.scopeRank).thenComparingLong(b -> b.scopeId));
        return out.stream().map(b -> b.dto).toList();
    }

    private record Built(ParamRowDTO dto, int defIndex, int scopeRank, long scopeId) {}

    /** 单行(写后回传 / 列表共用):站在 ym 的 (键,作用域) 生效行 */
    ParamRowDTO row(String key, String scope, String ym) {
        Def d = ParamRegistry.get(key);
        return buildRow(d, key, scope, ym, names(), index());
    }

    private ParamRowDTO buildRow(Def d, String key, String scope, String ym, Names n, Idx idx) {
        Map<String, List<Row>> byScope = idx.rows.getOrDefault(key, Map.of());
        // spec §2.4:有基数键的池不出可编辑「分母」行,改出只读「分母 = {基数键 label} {值}（价目参数）」指向那条参数
        if ("coefficient".equals(key) && scope.startsWith("rule:")) {
            String baseKey = n.baseKeyOfRule.get(idOf(scope));
            if (baseKey != null && !baseKey.isBlank()) return baseRow(d, scope, baseKey, ym, n, idx);
        }
        Hit hit = null;
        List<String> chain = new ArrayList<>();
        for (String s : cascade(scope, n)) {
            Hit h = VersionResolver.resolveOne(byScope.get(s), ym);
            if (h == null) continue;
            if (hit == null) hit = h;
            chain.add(scopeLabel(s, n) + ":" + valueText(d, key, scope, h.value(), n));
        }
        boolean hasMonth = byScope.getOrDefault(scope, List.of()).stream()
            .anyMatch(r -> "month".equals(r.mode()) && ym.equals(r.acctMonth()));
        boolean own = hit != null && hit.scope().equals(scope);
        return new ParamRowDTO(key, label(d, key, n), d.unit(), group(d), scope, scopeLabel(scope, n),
            hit == null ? null : hit.value(), valueText(d, key, scope, hit == null ? null : hit.value(), n),
            hit == null ? null : hit.mode(), hit == null ? "" : hit.acctMonth(),
            hit == null ? "" : rangeText(hit, byScope.get(hit.scope())), chain, d.formula(), d.hint(),
            !"frozen_2023".equals(key), d.monthlyCheck(), hasMonth,
            own ? hit.id() : null, hit == null ? null : idx.note(key, hit.id()));
    }

    // 基数键池的分母行:值/区间/命中链全部来自那条价目参数(rule.zone → 全园 级联),只读
    private ParamRowDTO baseRow(Def coef, String scope, String baseKey, String ym, Names n, Idx idx) {
        Def bd = ParamRegistry.get(baseKey);
        String bLabel = bd == null ? baseKey : bd.label();
        Map<String, List<Row>> byScope = idx.rows.getOrDefault(baseKey, Map.of());
        String zone = n.zoneOfRule.get(idOf(scope));
        Hit hit = null;
        List<String> chain = new ArrayList<>();
        for (String s : zone == null ? List.of("") : List.of(zone, "")) {
            Hit h = VersionResolver.resolveOne(byScope.get(s), ym);
            if (h == null) continue;
            if (hit == null) hit = h;
            chain.add(scopeLabel(s, n) + ":" + plain(h.value()));
        }
        String text = hit == null ? "分母 = " + bLabel + "（价目参数，未设置）"
            : "分母 = " + bLabel + " " + plain(hit.value()) + "（价目参数）";
        return new ParamRowDTO("coefficient", coef.label(), coef.unit(), group(coef), scope, scopeLabel(scope, n),
            hit == null ? null : hit.value(), text, hit == null ? null : hit.mode(), hit == null ? "" : hit.acctMonth(),
            hit == null ? "" : rangeText(hit, byScope.get(hit.scope())), chain, coef.formula(),
            "该池分母走价目参数「" + bLabel + "」，去那条参数改", false, false, false, null, null);
    }

    // ── 人话解析 ──

    private static String group(Def d) { return d.group().name().toLowerCase(); }

    private static String label(Def d, String key, Names n) {
        var m = LOSS_BASE_FORM_B.matcher(key);
        if (!m.matches()) return d.label();
        String b = n.building.get(Integer.valueOf(m.group(1)));
        return "损耗费基数形态（" + (b == null ? "楼栋#" + m.group(1) : b) + " 链）";
    }

    static String scopeLabel(String scope, Names n) {
        if (scope == null || scope.isEmpty()) return "全园";
        switch (scope) {
            case "p1": return "一期";
            case "p2": return "二期";
            case "dorm": return "宿舍";
            default: break;
        }
        int id = idOf(scope);
        if (scope.startsWith("building:")) return n.building.getOrDefault(id, "楼栋#" + id);
        if (scope.startsWith("rule:")) return n.rule.getOrDefault(id, "池#" + id) + "（池）";
        if (scope.startsWith("meter:")) return n.meter.getOrDefault(id, "表#" + id) + "（表）";
        if (scope.startsWith("tenant:")) return n.tenant.getOrDefault(id, "已删租户#" + id) + "（户）";
        return scope;
    }

    // 值文案:枚举字典 / 布尔状态句 / 引用型显名字 / 数值带单位;无命中给默认语义(栋级口径键)或空(其余)
    private static String valueText(Def d, String key, String scope, BigDecimal v, Names n) {
        if (v == null) {
            return switch (key) {
                case "loss_variant" -> d.enumOptions().get(0);
                case "loss_head" -> "独立核算";
                case "loss_c_meter" -> "全部总表";
                case "loss_recon" -> "参与对账";
                case "loss_denom_cable" -> "分母 = 总表";
                default -> "";
            };
        }
        switch (d.valueKind()) {
            case ENUM: {
                String t = d.enumOptions() == null ? null : d.enumOptions().get(v.intValue());
                return t == null ? plain(v) : t;
            }
            case BOOL: {
                boolean on = v.signum() != 0;
                return switch (key) {
                    case "loss_recon" -> on ? "参与对账" : "不参与对账";
                    case "loss_exclude" -> on ? "剔出合计" : "计入合计";
                    case "loss_denom_cable" -> on ? "分母 = 总表 + 铝缆" : "分母 = 总表";
                    default -> on ? "是" : "否";
                };
            }
            case REF_METER: return n.meter.getOrDefault(v.intValue(), "表#" + v.intValue());
            case REF_BUILDING: {
                int bid = v.intValue();
                if ("loss_head".equals(key) && scope.startsWith("building:") && idOf(scope) == bid) return "独立核算";
                String b = n.building.getOrDefault(bid, "楼栋#" + bid);
                return "loss_head".equals(key) ? "并入 " + b : b;
            }
            case REF_RULE: return n.rule.getOrDefault(v.intValue(), "池#" + v.intValue());
            default: return d.unit() == null || d.unit().isEmpty() ? plain(v) : plain(v) + " " + d.unit();
        }
    }

    static String plain(BigDecimal v) { return v.stripTrailingZeros().toPlainString(); }

    // 生效区间(spec §5.2):month=仅 X;from=X 起长期 / X ~ 下一版本前一月 / 长期（初始版本）/ 初始版本 ~ Y
    static String rangeText(Hit hit, List<Row> rowsOfScope) {
        if ("month".equals(hit.mode())) return "仅 " + hit.acctMonth();
        String next = VersionResolver.nextFrom(rowsOfScope == null ? List.of() : rowsOfScope, hit.acctMonth());
        String am = hit.acctMonth();
        if (am.isEmpty()) return next == null ? "长期（初始版本）" : "初始版本 ~ " + prevMonth(next);
        return next == null ? am + " 起长期" : am + " ~ " + prevMonth(next);
    }

    private static String prevMonth(String ym) { return YearMonth.parse(ym).minusMonths(1).toString(); }

    // 级联序(spec §2.2 找到即停):对象 → 其期别 → 全园;租户仅在能唯一定期时带期别
    private static List<String> cascade(String scope, Names n) {
        if (scope.isEmpty()) return List.of("");
        ScopeKind k = ParamRegistry.scopeKind(scope);
        String zone = switch (k) {
            case ZONE -> scope;
            case BUILDING -> n.zoneOfBuilding.get(idOf(scope));
            case RULE -> n.zoneOfRule.get(idOf(scope));
            case METER -> n.zoneOfMeter.get(idOf(scope));
            case TENANT -> { Set<String> zs = n.zonesOfTenant.get(idOf(scope)); yield zs != null && zs.size() == 1 ? zs.iterator().next() : null; }
            default -> null;
        };
        List<String> out = new ArrayList<>();
        out.add(scope);
        if (zone != null && !zone.equals(scope)) out.add(zone);
        out.add("");
        return out;
    }

    private static boolean inZone(String scope, String zone, Names n) {
        if (scope.isEmpty()) return true;
        ScopeKind k = ParamRegistry.scopeKind(scope);
        return switch (k) {
            case ZONE -> scope.equals(zone);
            case BUILDING -> zone.equals(n.zoneOfBuilding.get(idOf(scope)));
            case RULE -> zone.equals(n.zoneOfRule.get(idOf(scope)));
            case METER -> zone.equals(n.zoneOfMeter.get(idOf(scope)));
            case TENANT -> { Set<String> zs = n.zonesOfTenant.get(idOf(scope)); yield zs == null || zs.isEmpty() || zs.contains(zone); }
            default -> true;
        };
    }

    private static int scopeRank(String scope) {
        if (scope.isEmpty()) return 0;
        return switch (ParamRegistry.scopeKind(scope)) {
            case ZONE -> 1; case BUILDING -> 2; case RULE -> 3; case METER -> 4; case TENANT -> 5; default -> 9;
        };
    }

    private static long scopeId(String scope) {
        return switch (scope) {
            case "", "p1" -> 1; case "p2" -> 2; case "dorm" -> 3;
            default -> idOf(scope);
        };
    }

    static int idOf(String scope) { return Integer.parseInt(scope.substring(scope.indexOf(':') + 1)); }

    // ── 名字表 / 行索引(每次请求现载,表都小) ──

    static final class Names {
        final Map<Integer, String> building = new HashMap<>(), rule = new HashMap<>(), meter = new HashMap<>(), tenant = new HashMap<>();
        final Map<Integer, String> zoneOfBuilding = new HashMap<>(), zoneOfRule = new HashMap<>(), zoneOfMeter = new HashMap<>();
        final Map<Integer, Set<String>> zonesOfTenant = new HashMap<>();
        final Map<Integer, String> baseKeyOfRule = new HashMap<>();
        final Set<Integer> lossBuildings = new LinkedHashSet<>();   // 有电表挂栋的一期/二期楼栋(损耗组候选;宿舍不进损耗组)
    }

    Names names() {
        Names n = new Names();
        List<Building> bs = buildings.selectList(null);
        for (Building b : bs) n.building.put(b.getId(), b.getName());
        for (AllocRule r : rules.selectByZone(null)) {
            n.rule.put(r.getId(), r.getName()); n.zoneOfRule.put(r.getId(), r.getZone());
            n.baseKeyOfRule.put(r.getId(), r.getBaseKey());
        }
        for (Tenant t : tenants.selectList(null)) n.tenant.put(t.getId(), t.getCompanyName());
        for (Meter m : meters.selectList(null)) {
            n.meter.put(m.getId(), m.getName()); n.zoneOfMeter.put(m.getId(), m.getZone());
            if (m.getBuildingId() != null && m.getZone() != null) n.zoneOfBuilding.putIfAbsent(m.getBuildingId(), m.getZone());
            if (m.getTenantId() != null && m.getZone() != null)
                n.zonesOfTenant.computeIfAbsent(m.getTenantId(), k -> new HashSet<>()).add(m.getZone());
            if (m.getBuildingId() != null && "elec".equals(m.getKind()) && ("p1".equals(m.getZone()) || "p2".equals(m.getZone())))
                n.lossBuildings.add(m.getBuildingId());
        }
        // 楼栋期别以挂表的 zone 为准(宿舍楼 phase=1 但 zone=dorm);还没挂表的楼栋退回 building.phase
        for (Building b : bs)
            if (b.getPhase() != null && (b.getPhase() == 1 || b.getPhase() == 2)) n.zoneOfBuilding.putIfAbsent(b.getId(), "p" + b.getPhase());
        return n;
    }

    static final class Idx {
        final Map<String, Map<String, List<Row>>> rows = new HashMap<>();   // key → scope → rows
        final Map<Integer, String> allocNote = new HashMap<>(), priceNote = new HashMap<>();   // 行 id → note(按表分开,id 会撞)
        String note(String key, Integer id) {
            return id == null ? null : (ParamRegistry.tableOf(key) == Table.PRICE ? priceNote : allocNote).get(id);
        }
        void add(String scope, String key, String acctMonth, String mode, BigDecimal value, Integer id) {
            rows.computeIfAbsent(key, k -> new HashMap<>()).computeIfAbsent(scope, s -> new ArrayList<>())
                .add(new Row(scope, key, acctMonth == null ? "" : acctMonth, mode, value, id));
        }
    }

    Idx index() {
        Idx idx = new Idx();
        for (AllocCfg c : allocCfgs.selectList(null)) {
            idx.add(c.getScope(), c.getCfgKey(), c.getAcctMonth(), c.getMode(), c.getCfgValue(), c.getId());
            if (c.getNote() != null) idx.allocNote.put(c.getId(), c.getNote());
        }
        for (TenantPriceCfg c : priceCfgs.selectList(null)) {
            idx.add(c.getScope(), c.getCfgKey(), c.getAcctMonth(), c.getMode(), c.getCfgValue(), c.getId());
            if (c.getNote() != null) idx.priceNote.put(c.getId(), c.getNote());
        }
        return idx;
    }

    // ══════════ 状态条(spec §5.1/§6.3) ══════════

    public ParamStatusDTO status(String ym) {
        requireYm(ym);
        Set<String> ok = new HashSet<>();
        for (TenantPriceCfg c : priceCfgs.selectList(new QueryWrapper<TenantPriceCfg>()
                .in("cfg_key", PriceCfgService.ELEC_KEYS).eq("acct_month", ym).eq("mode", "month").notLikeRight("scope", "tenant:")))
            ok.add(c.getCfgKey());
        Snap s = snap(ym);
        LocalDateTime baseline = s.pool == null ? s.bill : s.bill == null ? s.pool : s.pool.isBefore(s.bill) ? s.pool : s.bill;
        QueryWrapper<ParamChangeLog> pending = monthCond(new QueryWrapper<ParamChangeLog>().in("action", "set", "delete"), ym);
        if (baseline != null) pending.gt("ts", baseline);
        int pendingChanges = Math.toIntExact(logs.selectCount(pending));
        List<String> others = new ArrayList<>();
        for (Object o : poolResults.selectObjs(new QueryWrapper<AllocPoolResult>().select("DISTINCT ym").orderByAsc("ym"))) {
            String m = String.valueOf(o);
            if (!m.equals(ym) && snap(m).stale) others.add(m);
        }
        return new ParamStatusDTO(ok.size(), PriceCfgService.ELEC_KEYS.size(), pendingChanges, s.lastChange, s.pool, s.bill, s.stale, others);
    }

    private record Snap(LocalDateTime pool, LocalDateTime bill, LocalDateTime lastChange, boolean stale) {}

    private Snap snap(String ym) {
        List<AllocPoolResult> p = poolResults.selectList(new QueryWrapper<AllocPoolResult>().eq("ym", ym)
            .orderByDesc("generated_at").last("LIMIT 1"));
        List<BillNotice> b = notices.selectList(new QueryWrapper<BillNotice>().eq("ym", ym)
            .orderByDesc("generated_at").last("LIMIT 1"));
        List<ParamChangeLog> c = logs.selectList(monthCond(new QueryWrapper<ParamChangeLog>().in("action", "set", "delete"), ym)
            .orderByDesc("ts").orderByDesc("id").last("LIMIT 1"));
        // 催缴单批次时间以「最近一次重算」兜底:整月都是已确认/已导出户时 generate 一张不重建,批次时间不动,
        // 但参数已被重算吃进去了 —— 否则这种月的 stale 永远清不掉
        List<ParamChangeLog> rc = logs.selectList(new QueryWrapper<ParamChangeLog>().eq("action", "recalc").eq("ym", ym)
            .orderByDesc("ts").orderByDesc("id").last("LIMIT 1"));
        LocalDateTime pool = p.isEmpty() ? null : p.get(0).getGeneratedAt();
        LocalDateTime bill = b.isEmpty() ? null : b.get(0).getGeneratedAt();
        if (!rc.isEmpty() && bill != null && rc.get(0).getTs().isAfter(bill)) bill = rc.get(0).getTs();
        LocalDateTime last = c.isEmpty() ? null : c.get(0).getTs();
        boolean stale = last != null && ((pool != null && last.isAfter(pool)) || (bill != null && last.isAfter(bill)));
        return new Snap(pool, bill, last, stale);
    }

    // 影响 ym 的日志行:from 且 acct_month<=ym,或 month 且 acct_month=ym
    static QueryWrapper<ParamChangeLog> monthCond(QueryWrapper<ParamChangeLog> qw, String ym) {
        return qw.and(w -> w.eq("mode", "from").le("acct_month", ym).or().eq("mode", "month").eq("acct_month", ym));
    }

    static void requireYm(String ym) {
        if (ym == null || !YM.matcher(ym).matches())
            throw new BizException(ResultCode.BAD_REQUEST, "月份格式须为 YYYY-MM");
    }
}

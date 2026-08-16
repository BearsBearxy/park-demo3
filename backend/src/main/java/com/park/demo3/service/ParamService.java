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
import org.springframework.context.annotation.Lazy;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.time.YearMonth;
import java.util.*;
import java.util.regex.Pattern;

// 计费参数中心(S21-PARAM-CENTER-SPEC §5/§6):tenant_price_cfg + alloc_cfg 两表参数的**同一读写口**。
// 读 = 对注册表每键 × 该键在库中出现过的作用域(+「应有一行」的栋级口径键 / 池级键),站在 ym 用 VersionResolver 级联取值,
// 再做人话解析(作用域名 / 值文案 / 生效区间 / 命中链)。名字表(楼栋/池/表/租户)每次请求整表载入(皆 <1200 行)。
// 写 = 注册表门 → 落对应表(同一 (scope,key,acct_month,mode) 行 upsert / 改错原地 / 删版本行) → param_change_log → 价目缓存失效;
// 旧 PUT /api/price-cfg、PUT /api/alloc/cfg、POST /api/price-cfg/copy(copyElec)内部都走 write(),AllocService.createRule 的初始分母也是。
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
    private final AllocLossResultMapper lossResults;
    private final BillNoticeMapper notices;
    private final BuildingMapper buildings;
    private final AllocRuleMapper rules;
    private final MeterMapper meters;
    private final TenantMapper tenants;
    private final PriceCfgService priceCfg;      // 价目缓存失效
    private final AllocService alloc;            // @Lazy:AllocService 写参数走本类,本类重算又调它 —— 懒代理断环
    private final BillNoticeService billNotice;

    public ParamService(AllocCfgMapper allocCfgs, TenantPriceCfgMapper priceCfgs, ParamChangeLogMapper logs,
                        AllocPoolResultMapper poolResults, AllocLossResultMapper lossResults, BillNoticeMapper notices,
                        BuildingMapper buildings, AllocRuleMapper rules, MeterMapper meters, TenantMapper tenants,
                        PriceCfgService priceCfg, @Lazy AllocService alloc, @Lazy BillNoticeService billNotice) {
        this.allocCfgs = allocCfgs; this.priceCfgs = priceCfgs; this.logs = logs;
        this.poolResults = poolResults; this.lossResults = lossResults; this.notices = notices;
        this.buildings = buildings; this.rules = rules; this.meters = meters; this.tenants = tenants;
        this.priceCfg = priceCfg; this.alloc = alloc; this.billNotice = billNotice;
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

    // ══════════ 写(spec §5.3/§6):注册表门 → 落对应表 → 日志 → 价目缓存失效 ══════════
    // mode 缺省=注册表默认;month 模式须带月份;价目月变键(电价 6 键/照抄金额)**只能 mode=month**(spec §3.1「缺当月=门禁」:
    //   from 行会前滚,priceGate 就永远拦不住,而 status.priceOk / 复制上月电价 又只认月行 —— 三处口径必须同一)。
    // correction=true 改错:站在 acctMonth(=页面账期)解析该 (键,作用域) 的命中行,原地改值不新建版本;命中行不在本作用域
    //   (值继承自上级)→ 400 请新建版本。
    // value=null 删该版本行:该行覆盖月份(month=该月;from=该月起到下一版本前)里存在**建行之后**生成的池快照/催缴单批次 → 400
    //   (spec §5.3「取用过」;建行前就有的快照没吃过这行,不算 —— 否则误录的初始版本行永远删不掉)。
    // 返回站在 ym(缺省 acctMonth)的该 (键,作用域) 生效行(WRITE-KEEP-CONTEXT 铁律二:前端只 patch 该行)。
    @Transactional
    public ParamRowDTO write(ParamPutReq req, String ym) {
        String key = req.key().trim();
        String scope = req.scope() == null ? "" : req.scope().trim();
        if (!ParamRegistry.allowed(key, scope))
            throw new BizException(ResultCode.BAD_REQUEST, "参数键不在注册表：" + key + (scope.isEmpty() ? "" : "@" + scope));
        Def d = ParamRegistry.get(key);
        boolean price = d.table() == Table.PRICE;
        String month = req.acctMonth() == null ? "" : req.acctMonth().trim();
        String mode = req.mode() == null || req.mode().isBlank() ? d.defaultMode() : req.mode().trim();
        if (price && PriceCfgService.MONTHLY_KEYS.contains(key) && !"month".equals(mode))
            throw new BizException(ResultCode.BAD_REQUEST, "「" + d.label() + "」只能按月生效");
        if (month.isEmpty() && "month".equals(mode))
            throw new BizException(ResultCode.BAD_REQUEST, "月变键须指定生效月：" + key);
        if (req.value() != null && !valueOk(d, req.value()))
            throw new BizException(ResultCode.BAD_REQUEST, "值不在「" + d.label() + "」的允许范围");
        String note = req.note() == null || req.note().isBlank() ? null : req.note().trim();
        String stand = ym == null ? month : ym;
        if (Boolean.TRUE.equals(req.correction())) {
            if (req.value() == null) throw new BizException(ResultCode.BAD_REQUEST, "改错须给出新值");
            Map<String, List<Row>> byScope = index().rows.getOrDefault(key, Map.of());
            Hit hit = null;
            for (String s : cascade(scope, names())) if ((hit = VersionResolver.resolveOne(byScope.get(s), stand)) != null) break;
            if (hit == null) throw new BizException(ResultCode.BAD_REQUEST, "该月无可更正的版本，请新建版本");
            if (!hit.scope().equals(scope)) throw new BizException(ResultCode.BAD_REQUEST, "该值来自上级作用域，请新建版本");
            save(price, hit.id(), scope, key, hit.acctMonth(), hit.mode(), req.value(), note);
            log("set", price, scope, key, hit.acctMonth(), hit.mode(), hit.value(), req.value(),
                note == null ? "改错" : "改错：" + note, null);
        } else {
            Cur cur = cur(price, scope, key, month, mode);
            if (req.value() == null) {
                if (cur != null) {
                    String used = usedBy(key, scope, month, mode, cur.createdAt());
                    if (used != null) throw new BizException(ResultCode.BAD_REQUEST, "已被 " + used + " 使用，请改用新版本");
                    del(price, cur.id());
                    log("delete", price, scope, key, month, mode, cur.value(), null, note, null);
                }
            } else {
                save(price, cur == null ? null : cur.id(), scope, key, month, mode, req.value(), note);
                log("set", price, scope, key, month, mode, cur == null ? null : cur.value(), req.value(), note, null);
            }
        }
        if (price) priceCfg.evict();
        return row(key, scope, stand);
    }

    // 值域(spec §6):枚举须在字典里;布尔 0/1;整数与引用型(表/栋/池 id)须为整数;数值/比率/金额不设限
    private static boolean valueOk(Def d, BigDecimal v) {
        boolean integral = v.stripTrailingZeros().scale() <= 0;
        return switch (d.valueKind()) {
            case ENUM -> integral && d.enumOptions() != null && d.enumOptions().containsKey(v.intValue());
            case BOOL -> v.signum() == 0 || v.compareTo(BigDecimal.ONE) == 0;
            case INT, REF_METER, REF_BUILDING, REF_RULE -> integral;
            default -> true;
        };
    }

    private record Cur(Integer id, BigDecimal value, LocalDateTime createdAt) {}

    private Cur cur(boolean price, String scope, String key, String month, String mode) {
        if (price) { TenantPriceCfg r = priceCfgs.selectByKey(scope, key, month, mode); return r == null ? null : new Cur(r.getId(), r.getCfgValue(), r.getCreatedAt()); }
        AllocCfg r = allocCfgs.selectByKey(scope, key, month, mode);
        return r == null ? null : new Cur(r.getId(), r.getCfgValue(), r.getCreatedAt());
    }

    // id 空=insert,否则 updateById(MP 只更新非空列:note 传空不清旧备注,与旧 upsert 同)
    private void save(boolean price, Integer id, String scope, String key, String month, String mode, BigDecimal value, String note) {
        if (price) {
            TenantPriceCfg r = new TenantPriceCfg();
            r.setId(id); r.setScope(scope); r.setCfgKey(key); r.setAcctMonth(month); r.setMode(mode); r.setCfgValue(value); r.setNote(note);
            if (id == null) priceCfgs.insert(r); else priceCfgs.updateById(r);
        } else {
            AllocCfg r = new AllocCfg();
            r.setId(id); r.setScope(scope); r.setCfgKey(key); r.setAcctMonth(month); r.setMode(mode); r.setCfgValue(value); r.setNote(note);
            if (id == null) allocCfgs.insert(r); else allocCfgs.updateById(r);
        }
    }

    private void del(boolean price, Integer id) { if (price) priceCfgs.deleteById(id); else allocCfgs.deleteById(id); }

    // 该版本行覆盖的月份里,第一个「建行之后(含同一秒)生成过」池快照/催缴单批次的月;无=null。
    // 建行前就存在的快照没取用过这行(它当时不存在),不算 —— 判据只看快照时间与 created_at 先后。
    // 快照/催缴单 generated_at 与 Java 写入的 created_at 同用 JVM 钟;迁移(SQL)插入的行 created_at 是 DB 默认钟(容器 UTC,偏早),
    // 只会更保守地判成「已使用」,方向安全。DATETIME(0) 同一秒分不出先后 → 按已使用算。
    private String usedBy(String key, String scope, String month, String mode, LocalDateTime createdAt) {
        TreeSet<String> gen = new TreeSet<>();
        for (Object o : poolResults.selectObjs(new QueryWrapper<AllocPoolResult>().select("DISTINCT ym"))) gen.add(String.valueOf(o));
        for (Object o : notices.selectObjs(new QueryWrapper<BillNotice>().select("DISTINCT ym"))) gen.add(String.valueOf(o));
        String next = "month".equals(mode) ? null
            : VersionResolver.nextFrom(index().rows.getOrDefault(key, Map.of()).getOrDefault(scope, List.of()), month);
        for (String g : gen) {
            boolean covers = "month".equals(mode) ? g.equals(month) : g.compareTo(month) >= 0 && (next == null || g.compareTo(next) < 0);
            if (!covers) continue;
            Snap s = snap(g);
            LocalDateTime at = s.pool == null ? s.bill : s.bill == null ? s.pool : s.pool.isAfter(s.bill) ? s.pool : s.bill;
            if (createdAt == null || at == null || !at.isBefore(createdAt)) return g;
        }
        return null;
    }

    // 复制上月电价(spec §5.1 / §6「POST /api/price-cfg/copy 保留」):仅电价 6 键 fromYm 的月行 → toYm 月行,目标已有跳过(幂等二跑 copied=0)。
    // 逐行走 write():同一注册表门 + param_change_log(变更记录页可见 / status.pendingChanges 计入 / stale 判据可用)+ 价目缓存失效,
    // 不再绕过日志直插(每月第一步写入若无日志,补价后 stale 不亮)。
    @Transactional
    public CopyResult copyElec(String fromYm, String toYm) {
        requireYm(fromYm); requireYm(toYm);
        int copied = 0, skipped = 0;
        for (TenantPriceCfg src : priceCfgs.selectList(new QueryWrapper<TenantPriceCfg>()
                .eq("acct_month", fromYm).eq("mode", "month").in("cfg_key", PriceCfgService.ELEC_KEYS).orderByAsc("scope", "cfg_key"))) {
            if (cur(true, src.getScope(), src.getCfgKey(), toYm, "month") != null) { skipped++; continue; }
            write(new ParamPutReq(src.getCfgKey(), src.getScope(), toYm, "month", src.getCfgValue(), src.getNote(), null), null);
            copied++;
        }
        return new CopyResult(copied, skipped);
    }

    public record CopyResult(int copied, int skipped) {}

    private void log(String action, boolean price, String scope, String key, String month, String mode,
                     BigDecimal oldV, BigDecimal newV, String note, String ym) {
        ParamChangeLog l = new ParamChangeLog();
        l.setTs(LocalDateTime.now()); l.setActor(actor()); l.setTbl(price ? "price" : "alloc");
        l.setScope(scope); l.setCfgKey(key); l.setAcctMonth(month); l.setMode(mode);
        l.setOldValue(oldV); l.setNewValue(newV); l.setNote(note); l.setAction(action); l.setYm(ym);
        logs.insert(l);
    }

    private static String actor() {
        var a = SecurityContextHolder.getContext().getAuthentication();
        return a == null || a.getName() == null ? "" : a.getName();
    }

    // ══════════ 历史 / 变更记录(spec §5.4) ══════════

    public ParamHistoryDTO history(String key, String scope) {
        if (ParamRegistry.get(key) == null) throw new BizException(ResultCode.BAD_REQUEST, "参数键不在注册表：" + key);
        String s = scope == null ? "" : scope.trim();
        Idx idx = index();
        List<Row> rows = new ArrayList<>(idx.rows.getOrDefault(key, Map.of()).getOrDefault(s, List.of()));
        rows.sort(Comparator.comparing(Row::mode).thenComparing(Row::acctMonth));   // from 链在前(按起点),month 单点在后
        List<ParamHistoryDTO.Version> versions = rows.stream().map(r -> new ParamHistoryDTO.Version(r.acctMonth(), r.mode(), r.value(),
            idx.note(key, r.id()), rangeText(new Hit(r.value(), s, r.acctMonth(), r.mode(), r.id()), rows), r.id())).toList();
        Names n = names();
        List<ParamHistoryDTO.Change> changes = logs.selectList(new QueryWrapper<ParamChangeLog>()
                .eq("scope", s).eq("cfg_key", key).orderByDesc("ts").orderByDesc("id"))
            .stream().map(l -> change(l, n)).toList();
        return new ParamHistoryDTO(versions, changes);
    }

    // 影响 ym 的改动(from 且起点<=ym / month 且=ym)+ 该月的 recalc;迁移基线行不列(见类头)
    public List<ParamHistoryDTO.Change> changes(String ym, int limit) {
        requireYm(ym);
        Names n = names();
        return logs.selectList(new QueryWrapper<ParamChangeLog>()
                .and(w -> w.eq("action", "recalc").eq("ym", ym).or(x -> monthCond(x.in("action", "set", "delete"), ym)))
                .orderByDesc("ts").orderByDesc("id").last("LIMIT " + Math.max(1, Math.min(limit, 1000))))
            .stream().map(l -> change(l, n)).toList();
    }

    private static ParamHistoryDTO.Change change(ParamChangeLog l, Names n) {
        Def d = ParamRegistry.get(l.getCfgKey());
        boolean recalc = "recalc".equals(l.getAction());
        return new ParamHistoryDTO.Change(l.getId(), l.getTs(), l.getActor(), l.getAction(),
            recalc ? null : l.getCfgKey(), recalc ? null : l.getScope(), recalc ? null : scopeLabel(l.getScope(), n),
            recalc ? "重算本月" : d == null ? l.getCfgKey() : label(d, l.getCfgKey(), n),
            l.getAcctMonth(), l.getMode(), l.getOldValue(), l.getNewValue(), l.getNote(), l.getYm());
    }

    // ══════════ 重算(spec §5.5):池+损耗 → 催缴单(已确认/已导出户跳过) → 日志 recalc ══════════
    @Transactional
    public RecalcResultDTO recalc(String ym) {
        requireYm(ym);
        AllocGenerateResultDTO a = alloc.generate(ym);
        BillNoticeGenResultDTO b = billNotice.generate(ym);
        int pools = Math.toIntExact(poolResults.selectCount(new QueryWrapper<AllocPoolResult>().eq("ym", ym)));
        int units = Math.toIntExact(lossResults.selectCount(new QueryWrapper<AllocLossResult>().eq("ym", ym)));
        log("recalc", false, "", "", "", "from", null, null, "池 " + pools + " / 损耗 " + units + " / 催缴单 " + b.generated(), ym);
        return new RecalcResultDTO(pools, units, b.generated(), b.skippedConfirmed(), a.warnings());
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

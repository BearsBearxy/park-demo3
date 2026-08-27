package com.park.demo3.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;

/**
 * 账册模板内部模型(BOOK-WORKBENCH-SPEC §1/§3)。HTTP 层传原始 JSON 字符串,这里负责:
 * 解析校验 / 结构改动判定 / 自定义列 id 收集。语义槽集合是代码常量,用户不可增删(§1)。
 */
public final class TemplateDef {
    public static final Set<String> SLOTS =
        Set.of("rent", "mgmt", "infra", "common", "misc", "elec", "water", "other");
    private static final ObjectMapper M = new ObjectMapper();

    public record Col(String id, boolean std, String label, List<String> aliases,
                      String slot, boolean hidden, Integer w) {}
    public record Group(String id, String label, List<Col> cols) {}
    public record Def(List<Group> groups) {}

    private TemplateDef() {}

    public static Def parse(String json) {
        try {
            Def d = M.readValue(json, Def.class);
            if (d == null || d.groups() == null || d.groups().isEmpty())
                throw new BizException(ResultCode.BAD_REQUEST, "模板不能为空");
            validate(d);
            return d;
        } catch (BizException e) {
            throw e;
        } catch (Exception e) {
            throw new BizException(ResultCode.BAD_REQUEST, "模板定义不是合法 JSON");
        }
    }

    public static String write(Def d) {
        try { return M.writeValueAsString(d); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }

    private static void validate(Def d) {
        Set<String> ids = new LinkedHashSet<>();
        for (Group g : d.groups()) {
            if (g.cols() == null) throw new BizException(ResultCode.BAD_REQUEST, "分组缺少列");
            for (Col c : g.cols()) {
                if (c.id() == null || c.id().isBlank())
                    throw new BizException(ResultCode.BAD_REQUEST, "列缺少 id");
                if (!ids.add(c.id()))
                    throw new BizException(ResultCode.BAD_REQUEST, "列 id 重复:" + c.id());
                if (c.label() == null || c.label().isBlank())
                    throw new BizException(ResultCode.BAD_REQUEST, "列缺少显示名:" + c.id());
                if (!SLOTS.contains(c.slot()))
                    throw new BizException(ResultCode.BAD_REQUEST, "未知语义槽:" + c.slot());
                // 白名单字符集:id 会拼进归档守卫的 JSON path(BookService.customColHasData),
                // 引号等字符可构造指向别处的合法 path 绕过守卫(审查#2);前端生成 c_+base36 天然合规
                if (!c.std() && !c.id().matches("c_[a-z0-9_]+"))
                    throw new BizException(ResultCode.BAD_REQUEST, "自定义列 id 须为 c_ + 小写字母/数字/下划线:" + c.id());
            }
        }
    }

    public static List<Col> flatten(Def d) {
        List<Col> out = new ArrayList<>();
        for (Group g : d.groups()) out.addAll(g.cols());
        return out;
    }

    public static Set<String> customIds(Def d) {
        Set<String> out = new LinkedHashSet<>();
        for (Col c : flatten(d)) if (!c.std()) out.add(c.id());
        return out;
    }

    // ── 迁移归并用(2026-08-25):改动集合与包含性判断 ──
    // 列宽 w 是纯装饰,不参与——否则无谓的宽度差异会挡住线性链归并。

    /** x 相对 base 的改动集合。集合可比较包含关系,用来把多个变体排成一条链。 */
    public static Set<String> changeSet(Def base, Def x) {
        Set<String> out = new LinkedHashSet<>();
        var bm = new java.util.LinkedHashMap<String, Col>();
        for (Col c : flatten(base)) bm.put(c.id(), c);
        var xm = new java.util.LinkedHashMap<String, Col>();
        for (Col c : flatten(x)) xm.put(c.id(), c);
        for (String id : xm.keySet()) if (!bm.containsKey(id)) out.add(id + "|NEW");
        for (String id : bm.keySet()) if (!xm.containsKey(id)) out.add(id + "|DROP");
        for (String id : xm.keySet()) {
            Col a = bm.get(id), b = xm.get(id);
            if (a == null) continue;
            if (!Objects.equals(a.label(), b.label()))     out.add(id + "|label|" + b.label());
            if (!Objects.equals(a.aliases(), b.aliases())) out.add(id + "|aliases|" + b.aliases());
            if (a.hidden() != b.hidden())                  out.add(id + "|hidden|" + b.hidden());
            if (!Objects.equals(a.slot(), b.slot()))       out.add(id + "|slot|" + b.slot());
        }
        return out;
    }

    /** variants 按改动集合大小升序后,是否两两严格包含(能排成一条线性链)。 */
    public static boolean chainOrdered(List<Def> variants, Def base) {
        List<Set<String>> sets = new ArrayList<>();
        for (Def d : variants) sets.add(changeSet(base, d));
        sets.sort(java.util.Comparator.comparingInt(Set::size));
        for (int i = 1; i < sets.size(); i++)
            if (!sets.get(i).containsAll(sets.get(i - 1))) return false;
        return true;
    }

    public static Set<String> stdIds(Def d) {
        Set<String> out = new LinkedHashSet<>();
        for (Col c : flatten(d)) if (c.std()) out.add(c.id());
        return out;
    }

    /**
     * 结构改动判定(§3):增删列 / 换语义槽 / 隐藏切换 / 改列序 / 增删分组或列换组 → true;
     * 仅 显示名/别名/列宽/分组名 变化 → false(轻改动,不升版)。
     * 判据 = 「按序展平的 (groupIndex, colId, slot, hidden)」序列是否逐项相等。
     */
    public static boolean structuralChange(Def a, Def b) {
        List<String> sa = signature(a), sb = signature(b);
        return !sa.equals(sb);
    }

    private static List<String> signature(Def d) {
        List<String> s = new ArrayList<>();
        for (int gi = 0; gi < d.groups().size(); gi++)
            for (Col c : d.groups().get(gi).cols())
                s.add(gi + "|" + c.id() + "|" + c.slot() + "|" + c.hidden());
        return s;
    }

    /** 标准列保护(§3):不可删除。新定义必须包含旧定义的全部标准列 id(隐藏可以,删不行)。 */
    public static void assertStdKept(Def oldDef, Def newDef) {
        Set<String> kept = stdIds(newDef);
        for (String id : stdIds(oldDef))
            if (!kept.contains(id))
                throw new BizException(ResultCode.CONFLICT, "标准列不可删除(可隐藏):" + id);
    }

    /** 变更摘要(操作日志用):增删列/改名/别名/换槽/隐藏的逐条中文描述。 */
    public static String diffSummary(Def a, Def b) {
        StringBuilder sb = new StringBuilder();
        var am = new java.util.LinkedHashMap<String, Col>();
        for (Col c : flatten(a)) am.put(c.id(), c);
        var bm = new java.util.LinkedHashMap<String, Col>();
        for (Col c : flatten(b)) bm.put(c.id(), c);
        for (String id : bm.keySet()) if (!am.containsKey(id))
            sb.append("新增列「").append(bm.get(id).label()).append("」;");
        for (String id : am.keySet()) if (!bm.containsKey(id))
            sb.append("删除列「").append(am.get(id).label()).append("」;");
        for (String id : bm.keySet()) {
            Col x = am.get(id), y = bm.get(id);
            if (x == null) continue;
            if (!Objects.equals(x.label(), y.label()))
                sb.append("改名「").append(x.label()).append("」→「").append(y.label()).append("」;");
            if (!Objects.equals(x.aliases(), y.aliases()))
                sb.append("「").append(y.label()).append("」别名 ").append(x.aliases()).append("→").append(y.aliases()).append(";");
            if (!Objects.equals(x.slot(), y.slot()))
                sb.append("「").append(y.label()).append("」换槽 ").append(x.slot()).append("→").append(y.slot()).append(";");
            if (x.hidden() != y.hidden())
                sb.append(y.hidden() ? "隐藏「" : "取消隐藏「").append(y.label()).append("」;");
        }
        return sb.length() == 0 ? "无字段级变化(分组/列序调整)" : sb.toString();
    }
}

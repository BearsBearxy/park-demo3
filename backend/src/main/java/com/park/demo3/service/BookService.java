package com.park.demo3.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import com.park.demo3.dto.BookDtos.*;
import com.park.demo3.entity.BookTemplateVersion;
import com.park.demo3.entity.LedgerBook;
import com.park.demo3.entity.ManagementCompany;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.park.demo3.entity.MonthlyLedger;
import com.park.demo3.entity.S10Record;
import com.park.demo3.mapper.BookTemplateVersionMapper;
import com.park.demo3.mapper.LedgerBookMapper;
import com.park.demo3.mapper.ManagementCompanyMapper;
import com.park.demo3.mapper.MonthlyLedgerMapper;
import com.park.demo3.mapper.S10RecordMapper;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 账册与模板版本(BOOK-WORKBENCH-SPEC §1-§3)。
 * 建册 = INSERT(红线:不触发 DDL);现行版全局生效;轻改动原版就地更新,结构改动升版;
 * 全部改动经 AuditLogService 落操作日志。
 */
@Service
public class BookService {
    private static final ObjectMapper M = new ObjectMapper();
    static final Map<Integer, String> S10_BOOK_NAMES =
        Map.of(1, "一期厂房", 2, "二期厂房", 3, "三期厂房", 4, "宿舍区");

    private final LedgerBookMapper books;
    private final BookTemplateVersionMapper versions;
    private final ManagementCompanyMapper companies;
    private final MonthlyLedgerMapper ledgerRows;
    private final S10RecordMapper s10Rows;
    private final AuditLogService audit;

    public BookService(LedgerBookMapper books, BookTemplateVersionMapper versions,
                       ManagementCompanyMapper companies, MonthlyLedgerMapper ledgerRows,
                       S10RecordMapper s10Rows, AuditLogService audit) {
        this.books = books; this.versions = versions; this.companies = companies;
        this.ledgerRows = ledgerRows; this.s10Rows = s10Rows; this.audit = audit;
    }

    // ── 种子(BookSeeder 启动调用,幂等):每公司一台账册,附表10 四期区册(§8) ──
    @Transactional
    public void seedMissing() {
        for (ManagementCompany c : companies.selectList(null))
            if (books.byCompany(c.getId()) == null)
                createLedgerBook(c, "seed");
        for (int phase = 1; phase <= 4; phase++)
            if (books.byPhase(phase) == null) {
                LedgerBook b = new LedgerBook();
                b.setScreen("s10"); b.setPhase(phase); b.setName(S10_BOOK_NAMES.get(phase));
                books.insert(b);
                String def = (phase == 1 || phase == 4) ? BookTemplates.s10Office() : BookTemplates.s10Factory();
                initVersion(b, def, "建册(部署初始模板)", "系统");
            }
    }

    // ── 全局链归并(2026-08-25;幂等,BookSeeder 启动调用) ──
    // 台账屏的所有模板版本收进一条链,每司只留 current_version_id 作指针。
    // 遇到互不包含的变体 fail-fast 报名 —— 强行排成线性链会丢掉某些公司的定制。
    @Transactional
    public void migrateToGlobalLineage() {
        if (books.lineageHost() != null) return;                 // 已迁移
        List<LedgerBook> comps = books.ledgerCompanyBooks();

        LedgerBook host = new LedgerBook();
        host.setScreen("ledger"); host.setCompanyId(null); host.setName("台账通用模板");
        books.insert(host);

        if (comps.isEmpty()) {                                    // 空库:直接建出厂 v1
            initVersion(host, BookTemplates.ledgerStandard(), "建链(标准 21 列模板)", "系统");
            return;
        }

        TemplateDef.Def base = TemplateDef.parse(BookTemplates.ledgerStandard());
        // 去重:同一份定义只落一个版本(键=定义原文)
        Map<String, List<LedgerBook>> byDef = new LinkedHashMap<>();
        for (LedgerBook b : comps)
            byDef.computeIfAbsent(currentVersion(b).getDefinition(), k -> new ArrayList<>()).add(b);

        List<String> defs = new ArrayList<>(byDef.keySet());
        if (!TemplateDef.chainOrdered(defs.stream().map(TemplateDef::parse).toList(), base)) {
            String who = byDef.values().stream()
                .map(l -> l.stream().map(LedgerBook::getName).collect(Collectors.joining("/")))
                .collect(Collectors.joining(" | "));
            throw new IllegalStateException(
                "账册模板存在互不包含的变体,无法归并成一条链,请先人工归并后再启动。分组:" + who);
        }
        defs.sort(java.util.Comparator.comparingInt(d -> TemplateDef.changeSet(base, TemplateDef.parse(d)).size()));

        BookTemplateVersion tip = null;
        for (int i = 0; i < defs.size(); i++) {
            String def = defs.get(i);
            BookTemplateVersion v = new BookTemplateVersion();
            v.setBookId(host.getId()); v.setVer(i + 1); v.setDefinition(def);
            v.setNote("迁移自「" + byDef.get(def).stream().map(LedgerBook::getName)
                .collect(Collectors.joining("、")) + "」的现行版");
            v.setCreatedBy("系统");
            versions.insert(v);
            for (LedgerBook b : byDef.get(def)) {                 // 各司指针指向自己那一版
                Integer oldChain = b.getId();
                b.setCurrentVersionId(v.getId());
                books.updateById(b);
                versions.delete(new QueryWrapper<BookTemplateVersion>().eq("book_id", oldChain));
            }
            tip = v;
        }
        host.setCurrentVersionId(tip.getId());                    // 宿主停在链尾
        books.updateById(host);
    }

    /** 版本链宿主:台账屏一律走全局宿主行;s10 屏一册一链,宿主就是自己。 */
    Integer chainBookId(LedgerBook b) {
        if (!"ledger".equals(b.getScreen())) return b.getId();
        LedgerBook host = books.lineageHost();
        if (host == null) throw new IllegalStateException("台账全局模板链未初始化");
        return host.getId();
    }

    /** 建司挂钩(§9:新增账册=建司流程的附带动作)。 */
    @Transactional
    public void createLedgerBook(ManagementCompany c, String by) {
        LedgerBook b = new LedgerBook();
        b.setScreen("ledger"); b.setCompanyId(c.getId()); b.setName(c.getName());
        books.insert(b);
        initVersion(b, BookTemplates.ledgerStandard(), "建册(标准 21 列模板)", by);
    }

    /** 改司名挂钩(审查#22):账册即公司(§9),名字跟着走,不分叉。 */
    @Transactional
    public void renameLedgerBook(Integer companyId, String name) {
        LedgerBook b = books.byCompany(companyId);
        if (b != null && !name.equals(b.getName())) { b.setName(name); books.updateById(b); }
    }

    /** 删司挂钩:册与版本随司退场(版本表 ON DELETE CASCADE,这里删册行即可)。 */
    @Transactional
    public void dropLedgerBook(Integer companyId) {
        LedgerBook b = books.byCompany(companyId);
        if (b != null) books.deleteById(b.getId());
    }

    private void initVersion(LedgerBook b, String def, String note, String by) {
        BookTemplateVersion v = new BookTemplateVersion();
        v.setBookId(b.getId()); v.setVer(1); v.setDefinition(def);
        v.setNote(note); v.setCreatedBy(by);
        versions.insert(v);
        b.setCurrentVersionId(v.getId());
        books.updateById(b);
    }

    // ── 读 ──
    public List<BookDTO> list(String screen) {
        List<BookDTO> out = new ArrayList<>();
        for (LedgerBook b : books.byScreen(screen)) {
            if ("ledger".equals(screen) && b.getCompanyId() == null) continue;   // 宿主行不是账册,不进清单
            out.add(toDTO(b));
        }
        return out;
    }

    private BookDTO toDTO(LedgerBook b) {
        BookTemplateVersion v = currentVersion(b);
        return new BookDTO(b.getId(), b.getScreen(), b.getCompanyId(), b.getPhase(),
            b.getName(), v.getVer(), versions.maxVer(chainBookId(b)), readTree(v.getDefinition()));
    }

    private BookTemplateVersion currentVersion(LedgerBook b) {
        BookTemplateVersion v = b.getCurrentVersionId() == null ? null
            : versions.selectById(b.getCurrentVersionId());
        if (v == null) throw new BizException(ResultCode.NOT_FOUND, "账册缺少模板版本");
        return v;
    }

    private static JsonNode readTree(String json) {
        try { return M.readTree(json); }
        catch (Exception e) { throw new IllegalStateException("模板定义损坏", e); }
    }

    // ── 模板保存(§3:轻改动原版就地更新;结构改动升版并移指针;标准列不可删) ──
    @Transactional
    public TemplateSaveResultDTO saveTemplate(Integer bookId, TemplateSaveReq req) {
        LedgerBook b = books.selectById(bookId);
        if (b == null) throw new BizException(ResultCode.NOT_FOUND, "账册不存在");
        BookTemplateVersion cur = currentVersion(b);

        String newJson = req.definition().toString();
        TemplateDef.Def oldDef = TemplateDef.parse(cur.getDefinition());
        TemplateDef.Def newDef = TemplateDef.parse(newJson);
        TemplateDef.assertStdKept(oldDef, newDef);
        assertNoDataLossOnCustomRemoval(b, oldDef, newDef);

        boolean structural = TemplateDef.structuralChange(oldDef, newDef);
        String summary = TemplateDef.diffSummary(oldDef, newDef);
        if (structural) {
            BookTemplateVersion nv = new BookTemplateVersion();
            nv.setBookId(bookId); nv.setVer(cur.getVer() + 1);
            nv.setDefinition(newJson);
            nv.setNote(req.note() == null || req.note().isBlank() ? summary : req.note());
            nv.setCreatedBy(actor());
            versions.insert(nv);
            b.setCurrentVersionId(nv.getId());
            books.updateById(b);
            audit.log("模板修改", bookLabel(b),
                "v" + cur.getVer() + "→v" + nv.getVer() + "(结构): " + summary);
        } else {
            cur.setDefinition(newJson);
            versions.updateById(cur);
            audit.log("模板修改", bookLabel(b), "v" + cur.getVer() + "(轻改动): " + summary);
        }
        return new TemplateSaveResultDTO(toDTO(books.selectById(bookId)), structural, summary);
    }

    /** 历史版本定义(只读预览:非编辑态点版本看当时的列名与布局;GET 读全开,无权限门)。 */
    public com.fasterxml.jackson.databind.JsonNode versionDefinition(Integer bookId, int ver) {
        if (books.selectById(bookId) == null) throw new BizException(ResultCode.NOT_FOUND, "账册不存在");
        BookTemplateVersion v = versions.byBook(bookId).stream()
            .filter(x -> x.getVer() == ver).findFirst()
            .orElseThrow(() -> new BizException(ResultCode.NOT_FOUND, "版本不存在"));
        return readTree(v.getDefinition());
    }

    public VersionListDTO versionList(Integer bookId) {
        LedgerBook b = books.selectById(bookId);
        if (b == null) throw new BizException(ResultCode.NOT_FOUND, "账册不存在");
        List<TemplateVersionDTO> out = new ArrayList<>();
        for (BookTemplateVersion v : versions.byBook(bookId))
            out.add(new TemplateVersionDTO(v.getId(), v.getVer(), v.getNote(), v.getCreatedBy(),
                v.getCreatedAt(), v.getId().equals(b.getCurrentVersionId())));
        return new VersionListDTO(out);
    }

    /** 回滚 = 复制历史版为新版本(§3:版本号只前进)。 */
    @Transactional
    public BookDTO rollback(Integer bookId, int ver) {
        LedgerBook b = books.selectById(bookId);
        if (b == null) throw new BizException(ResultCode.NOT_FOUND, "账册不存在");
        BookTemplateVersion src = versions.byBook(bookId).stream()
            .filter(v -> v.getVer() == ver).findFirst()
            .orElseThrow(() -> new BizException(ResultCode.NOT_FOUND, "版本不存在"));
        BookTemplateVersion cur = currentVersion(b);
        // 回滚到缺列的历史版同样受归档守卫:名下有数据的自定义列不许因回滚蒸发(口袋值会变成合计里的幽灵钱)
        assertNoDataLossOnCustomRemoval(b, TemplateDef.parse(cur.getDefinition()), TemplateDef.parse(src.getDefinition()));
        BookTemplateVersion nv = new BookTemplateVersion();
        nv.setBookId(bookId); nv.setVer(versions.maxVer(bookId) + 1);
        nv.setDefinition(src.getDefinition());
        nv.setNote("回滚自 v" + ver);
        nv.setCreatedBy(actor());
        versions.insert(nv);
        b.setCurrentVersionId(nv.getId());
        books.updateById(b);
        audit.log("模板修改", bookLabel(b), "v" + cur.getVer() + "→v" + nv.getVer() + ": 回滚自 v" + ver);
        return toDTO(books.selectById(bookId));
    }

    // ── 导入校验用:该账册现行版的自定义列 id 集(§4:未知 id 该行报错不静默吞) ──
    public Set<String> customIdsByCompany(Integer companyId) {
        LedgerBook b = books.byCompany(companyId);
        return b == null ? Set.of() : TemplateDef.customIds(TemplateDef.parse(currentVersion(b).getDefinition()));
    }

    public Set<String> customIdsByPhase(Integer phase) {
        LedgerBook b = books.byPhase(phase);
        return b == null ? Set.of() : TemplateDef.customIds(TemplateDef.parse(currentVersion(b).getDefinition()));
    }

    // ── 归档守卫(SPEC §3):自定义列名下有历史数据 → 只许隐藏(归档),不许从模板移除 ──
    // 否则:行保存的 extraFees 整包替换会抹值(前端按现行版收包),或口袋残值变成合计里看不见的钱。
    private void assertNoDataLossOnCustomRemoval(LedgerBook b, TemplateDef.Def oldDef, TemplateDef.Def newDef) {
        Set<String> keep = TemplateDef.customIds(newDef);
        for (String id : TemplateDef.customIds(oldDef)) {
            if (keep.contains(id)) continue;
            if (customColHasData(b, id))
                throw new BizException(ResultCode.CONFLICT,
                    "自定义列「" + id + "」名下已有数据,不能删除——请改用隐藏(归档);确需清列先清数据");
        }
    }

    private boolean customColHasData(LedgerBook b, String colId) {
        String jsonPath = "$.\"" + colId + "\"";
        // JSON_TYPE 而非 IS NOT NULL:{"c_x":null} 的 JSON null 不是 SQL NULL,
        // IS NOT NULL 会把空值键误判成"有数据"拦住删除;键缺席时 JSON_TYPE(SQL NULL)=NULL 不计
        String cond = "JSON_TYPE(JSON_EXTRACT(extra_fees, {0})) NOT IN ('NULL')";
        if ("ledger".equals(b.getScreen()))
            return ledgerRows.selectCount(new QueryWrapper<MonthlyLedger>()
                .eq("company_id", b.getCompanyId()).apply(cond, jsonPath)) > 0;
        return s10Rows.selectCount(new QueryWrapper<S10Record>()
            .eq("phase", b.getPhase()).apply(cond, jsonPath)) > 0;
    }

    private static String bookLabel(LedgerBook b) {
        return ("ledger".equals(b.getScreen()) ? "台账·" : "附表10·") + b.getName();
    }

    private static String actor() {
        Authentication a = SecurityContextHolder.getContext().getAuthentication();
        return a == null ? "系统" : String.valueOf(a.getName());
    }
}

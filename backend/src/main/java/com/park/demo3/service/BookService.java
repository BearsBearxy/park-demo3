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
    private final BookPinService pinSvc;

    public BookService(LedgerBookMapper books, BookTemplateVersionMapper versions,
                       ManagementCompanyMapper companies, MonthlyLedgerMapper ledgerRows,
                       S10RecordMapper s10Rows, AuditLogService audit, BookPinService pinSvc) {
        this.books = books; this.versions = versions; this.companies = companies;
        this.ledgerRows = ledgerRows; this.s10Rows = s10Rows; this.audit = audit;
        this.pinSvc = pinSvc;
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

    // ── 按月 pin 回填的取数(2026-08-26;BookPinService.migrateExisting 调用) ──

    /** 已有台账数据的 (公司, 年, 月) 及该公司册当时的现行版 id。 */
    public List<Object[]> existingLedgerMonths() {
        List<Object[]> out = new ArrayList<>();
        for (LedgerBook b : books.ledgerCompanyBooks()) {
            Long ver = b.getCurrentVersionId() != null ? b.getCurrentVersionId()
                     : tipVersionId(chainBookId(b));
            for (Map<String, Object> m : ledgerRows.selectMaps(new QueryWrapper<MonthlyLedger>()
                    .select("DISTINCT period_year, period_month").eq("company_id", b.getCompanyId())))
                out.add(new Object[]{ b.getCompanyId(),
                    ((Number) m.get("period_year")).intValue(),
                    ((Number) m.get("period_month")).intValue(), ver });
        }
        return out;
    }

    /** 已有附表10 数据的 (期区, 年, 月) 及该期区册当时的现行版 id。acct_month 是 'YYYY-MM',这里拆。 */
    public List<Object[]> existingS10Months() {
        List<Object[]> out = new ArrayList<>();
        for (int phase = 1; phase <= 4; phase++) {
            LedgerBook b = books.byPhase(phase);
            if (b == null) continue;
            Long ver = b.getCurrentVersionId() != null ? b.getCurrentVersionId() : tipVersionId(b.getId());
            for (Map<String, Object> m : s10Rows.selectMaps(new QueryWrapper<S10Record>()
                    .select("DISTINCT acct_month").eq("phase", phase))) {
                String ym = String.valueOf(m.get("acct_month"));          // 'YYYY-MM'
                out.add(new Object[]{ phase, Integer.parseInt(ym.substring(0, 4)),
                                      Integer.parseInt(ym.substring(5, 7)), ver });
            }
        }
        return out;
    }

    /** 迁移收尾(spec §5):台账公司册的 current_version_id 就此作废 —— 版本改由 book_month_pin 持有。
     *  留一个半死不活的字段,迟早有人拿它当"当前版"用。宿主行与 s10 期区册的那一列仍是链尾标记,不动。 */
    @Transactional
    public void clearLedgerCompanyPointers() {
        // ⚠ 必须 UpdateWrapper.set(...) 显式置 NULL:MP 的 updateById 跳过 null 字段
        //   (同款坑见 LedgerService.bindRow 的解绑注释)
        for (LedgerBook b : books.ledgerCompanyBooks())
            books.update(null, new com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper<LedgerBook>()
                .eq("id", b.getId()).set("current_version_id", null));
    }

    /** 版本链宿主:台账屏一律走全局宿主行;s10 屏一册一链,宿主就是自己。 */
    Integer chainBookId(LedgerBook b) {
        return "ledger".equals(b.getScreen()) ? lineageHostId() : b.getId();
    }

    /** 某条链的链尾版本 id。 */
    public Long tipVersionId(Integer chainBookId) {
        BookTemplateVersion top = versions.selectOne(new QueryWrapper<BookTemplateVersion>()
            .eq("book_id", chainBookId).orderByDesc("ver").last("LIMIT 1"));
        if (top == null) throw new IllegalStateException("账册链没有任何版本:" + chainBookId);
        return top.getId();
    }

    private Integer lineageHostId() {
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
        // 台账模板是全局一条链:新司的指针直接指到链尾,不另起私链 ——
        // 私链上的册再也接不到链尾编辑,"全局唯一模板"当场作废且无法自愈。
        // 宿主行不存在只有一种情形:全新库首次种子(紧随其后的 migrateToGlobalLineage 会把它归并进去)
        LedgerBook host = books.lineageHost();
        BookTemplateVersion tip = host == null ? null : versions.tip(host.getId());
        if (tip == null) { initVersion(b, BookTemplates.ledgerStandard(), "建册(标准 21 列模板)", by); return; }
        b.setCurrentVersionId(tip.getId());
        books.updateById(b);
    }

    /** 改司名挂钩(审查#22):账册即公司(§9),名字跟着走,不分叉。 */
    @Transactional
    public void renameLedgerBook(Integer companyId, String name) {
        LedgerBook b = books.byCompany(companyId);
        if (b != null && !name.equals(b.getName())) { b.setName(name); books.updateById(b); }
    }

    /** 删司挂钩:删册行即可。全局化后台账册自己不持有版本行(只持指针),
     *  链上的版本挂在宿主行下,不随某一家公司退场。 */
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
        // 台账屏全体共用一条链:宿主行解析一次就够,逐册解析等于同一句 SQL 跑 N 遍
        Integer ledgerChain = "ledger".equals(screen) ? lineageHostId() : null;
        for (LedgerBook b : books.byScreen(screen)) {
            if (ledgerChain != null && b.getCompanyId() == null) continue;   // 宿主行不是账册,不进清单
            out.add(toDTO(b, ledgerChain == null ? b.getId() : ledgerChain));
        }
        return out;
    }

    private BookDTO toDTO(LedgerBook b) { return toDTO(b, chainBookId(b)); }

    private BookDTO toDTO(LedgerBook b, Integer chainId) {
        BookTemplateVersion v = currentVersion(b);
        return new BookDTO(b.getId(), b.getScreen(), b.getCompanyId(), b.getPhase(),
            b.getName(), v.getVer(), versions.maxVer(chainId), readTree(v.getDefinition()));
    }

    /** 册 → owner_id:台账取 company_id,附表10 取 phase。 */
    Integer ownerIdOf(LedgerBook b) {
        return "ledger".equals(b.getScreen()) ? b.getCompanyId() : b.getPhase();
    }

    /** 某月生效的 BookDTO。 */
    public BookDTO toDTOAt(LedgerBook b, int year, int month) {
        Integer chainId = chainBookId(b);
        Long verId = pinSvc.resolve(b.getScreen(), ownerIdOf(b), year, month, chainId);
        BookTemplateVersion v = versions.selectById(verId);
        return new BookDTO(b.getId(), b.getScreen(), b.getCompanyId(), b.getPhase(),
            b.getName(), v.getVer(), versions.maxVer(chainId), readTree(v.getDefinition()));
    }

    public BookDTO templateAt(Integer bookId, int year, int month) {
        LedgerBook b = books.selectById(bookId);
        if (b == null) throw new BizException(ResultCode.NOT_FOUND, "账册不存在");
        return toDTOAt(b, year, month);
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
        Integer chainId = chainBookId(b);
        BookTemplateVersion cur = currentVersion(b);
        int tipVer = versions.maxVer(chainId);
        // R3 只能在链尾编辑:允许从非链尾分叉,链就不再是一条线,"全局唯一模板"当场失效。
        // ⚠ 只管台账屏。s10 是一册一链(design §4 恒等变换),没有"别家公司"可分叉,这道门对它没有意义;
        //   而 rollback 改成 adopt 之后 s10 也能停在非链尾了,门若不限屏,用户切回旧版就再也改不了模板
        //   (前端 TemplateEditorPanel 的 globalChain 也只认 ledger,不限屏会前后端打架:能进编辑态、保存吃 409)
        if ("ledger".equals(b.getScreen()) && cur.getVer() != tipVer)
            throw new BizException(ResultCode.CONFLICT,
                "本册在 v" + cur.getVer() + ",最新是 v" + tipVer + " —— 请先升到 v" + tipVer + " 再改");

        String newJson = req.definition().toString();
        TemplateDef.Def oldDef = TemplateDef.parse(cur.getDefinition());
        TemplateDef.Def newDef = TemplateDef.parse(newJson);
        TemplateDef.assertStdKept(oldDef, newDef);
        // 台账模板全司共用,删列要查所有公司(§7):传宿主行(companyId=null)即放开公司范围
        assertNoDataLossOnCustomRemoval(
            "ledger".equals(b.getScreen()) ? books.lineageHost() : b, oldDef, newDef);

        boolean structural = TemplateDef.structuralChange(oldDef, newDef);
        String summary = TemplateDef.diffSummary(oldDef, newDef);
        if (structural) {
            BookTemplateVersion nv = new BookTemplateVersion();
            // 版本落在链上,号取链尾+1:写回 bookId 会给公司册另起私链,写 cur.getVer()+1 会撞 uk_tpl
            nv.setBookId(chainId); nv.setVer(tipVer + 1);
            nv.setDefinition(newJson);
            nv.setNote(req.note() == null || req.note().isBlank() ? summary : req.note());
            nv.setCreatedBy(actor());
            versions.insert(nv);
            movePinsAtTip(b, cur.getId(), nv.getId());
            audit.log("模板修改", bookLabel(b),
                "v" + cur.getVer() + "→v" + nv.getVer() + "(结构): " + summary);
        } else {
            cur.setDefinition(newJson);          // 轻改动就地更新:只影响指向该版的册
            versions.updateById(cur);
            audit.log("模板修改", bookLabel(b), "v" + cur.getVer() + "(轻改动): " + summary);
        }
        return new TemplateSaveResultDTO(toDTO(books.selectById(bookId)), structural, summary);
    }

    // R4 编辑只带走链尾上的册:原本就指着旧链尾的(含宿主)跟进新版,落后的原地不动 —— 这是"不强制升级"的落点
    private void movePinsAtTip(LedgerBook edited, Long oldTipId, Long newTipId) {
        if (!"ledger".equals(edited.getScreen())) {          // s10:一册一链,只动自己
            edited.setCurrentVersionId(newTipId);
            books.updateById(edited);
            return;
        }
        List<LedgerBook> all = new ArrayList<>(books.ledgerCompanyBooks());
        LedgerBook host = books.lineageHost();
        if (host != null) all.add(host);
        for (LedgerBook x : all)
            if (oldTipId.equals(x.getCurrentVersionId())) {
                x.setCurrentVersionId(newTipId);
                books.updateById(x);
            }
    }

    /** 历史版本定义(只读预览:非编辑态点版本看当时的列名与布局;GET 读全开,无权限门)。 */
    public com.fasterxml.jackson.databind.JsonNode versionDefinition(Integer bookId, int ver) {
        LedgerBook b = books.selectById(bookId);
        if (b == null) throw new BizException(ResultCode.NOT_FOUND, "账册不存在");
        BookTemplateVersion v = versions.byBook(chainBookId(b)).stream()
            .filter(x -> x.getVer() == ver).findFirst()
            .orElseThrow(() -> new BizException(ResultCode.NOT_FOUND, "版本不存在"));
        return readTree(v.getDefinition());
    }

    public VersionListDTO versionList(Integer bookId) {
        LedgerBook b = books.selectById(bookId);
        if (b == null) throw new BizException(ResultCode.NOT_FOUND, "账册不存在");
        List<TemplateVersionDTO> out = new ArrayList<>();
        for (BookTemplateVersion v : versions.byBook(chainBookId(b)))
            out.add(new TemplateVersionDTO(v.getId(), v.getVer(), v.getNote(), v.getCreatedBy(),
                v.getCreatedAt(), v.getId().equals(b.getCurrentVersionId())));
        return new VersionListDTO(out);
    }

    /** 切本公司的版本指针(R7:取代旧「回滚=复制历史版为新版本」)。链只追加,切指针不造版本。 */
    @Transactional
    public BookDTO adopt(Integer bookId, int ver) {
        LedgerBook b = books.selectById(bookId);
        if (b == null) throw new BizException(ResultCode.NOT_FOUND, "账册不存在");
        BookTemplateVersion target = versions.byBook(chainBookId(b)).stream()
            .filter(v -> v.getVer() == ver).findFirst()
            .orElseThrow(() -> new BizException(ResultCode.NOT_FOUND, "版本不存在"));
        BookTemplateVersion cur = currentVersion(b);
        if (target.getId().equals(cur.getId())) return toDTO(b);          // 已在该版:幂等
        // R6 切到缺列的版本同样受归档守卫:名下有数据的自定义列不许因切版蒸发
        // (口袋残值仍进 recalc 应收合计,列却不显示 → 合计永远对不上明细)
        assertNoDataLossOnCustomRemoval(b, TemplateDef.parse(cur.getDefinition()),
                                           TemplateDef.parse(target.getDefinition()));
        b.setCurrentVersionId(target.getId());
        books.updateById(b);
        audit.log("模板切版", bookLabel(b), "v" + cur.getVer() + "→v" + ver);
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

    // ── 归档守卫(SPEC §3 + 全局化 §7):自定义列名下有历史数据 → 只许隐藏(归档),不许从模板移除 ──
    // 否则:行保存的 extraFees 整包替换会抹值(前端按现行版收包),或口袋残值变成合计里看不见的钱。
    // 全局化后台账模板是所有公司共用的 —— 删列要查所有公司,任一家有数据就拒绝。
    private void assertNoDataLossOnCustomRemoval(LedgerBook b, TemplateDef.Def oldDef, TemplateDef.Def newDef) {
        Set<String> keep = TemplateDef.customIds(newDef);
        for (String id : TemplateDef.customIds(oldDef)) {
            if (keep.contains(id)) continue;
            long n = customColRowCount(b, id);
            if (n > 0)
                throw new BizException(ResultCode.CONFLICT,
                    "自定义列「" + id + "」名下已有 " + n + " 行数据,不能删除——请改用隐藏(归档);确需清列先清数据");
        }
    }

    /** 该列名下的数据行数。台账屏:companyId 为 null(宿主行=全局编辑)时查所有公司。 */
    private long customColRowCount(LedgerBook b, String colId) {
        String jsonPath = "$.\"" + colId + "\"";
        // JSON_TYPE 而非 IS NOT NULL:{"c_x":null} 的 JSON null 不是 SQL NULL,
        // IS NOT NULL 会把空值键误判成"有数据"拦住删除;键缺席时 JSON_TYPE(SQL NULL)=NULL 不计
        String cond = "JSON_TYPE(JSON_EXTRACT(extra_fees, {0})) NOT IN ('NULL')";
        if ("ledger".equals(b.getScreen())) {
            QueryWrapper<MonthlyLedger> q = new QueryWrapper<MonthlyLedger>().apply(cond, jsonPath);
            if (b.getCompanyId() != null) q.eq("company_id", b.getCompanyId());
            return ledgerRows.selectCount(q);
        }
        return s10Rows.selectCount(new QueryWrapper<S10Record>()
            .eq("phase", b.getPhase()).apply(cond, jsonPath));
    }

    private static String bookLabel(LedgerBook b) {
        return ("ledger".equals(b.getScreen()) ? "台账·" : "附表10·") + b.getName();
    }

    private static String actor() {
        Authentication a = SecurityContextHolder.getContext().getAuthentication();
        return a == null ? "系统" : String.valueOf(a.getName());
    }
}

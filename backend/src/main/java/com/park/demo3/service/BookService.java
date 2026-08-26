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
 * 建册 = INSERT(红线:不触发 DDL);模板版本按 (册, 月) 生效(spec 2026-08-26);版本不可变,任何保存都升版;
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

    /** 写路径固化 pin 用:公司 → 台账册 / 期区 → 附表10 册。 */
    public LedgerBook bookOfCompany(Integer companyId) { return books.byCompany(companyId); }

    public LedgerBook bookOfPhase(int phase) { return books.byPhase(phase); }

    /** 版本链宿主:台账屏一律走全局宿主行;s10 屏一册一链,宿主就是自己。 */
    public Integer chainBookId(LedgerBook b) {
        return "ledger".equals(b.getScreen()) ? lineageHostId() : b.getId();
    }

    /** 某条链的链尾版本 id。 */
    public Long tipVersionId(Integer chainBookId) {
        BookTemplateVersion top = versions.tip(chainBookId);
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
        // ⚠ current_version_id 不再写:spec §5 宣告台账公司册的这一列作废(迁移已把老册置 NULL),
        //   版本改由 book_month_pin 按月持有。写了它,新司的"不带月份读"会永远停在建司当刻那一版
        //   ——版本清单里的"当前版"标记跟着停在建司当刻那一版。
        LedgerBook host = books.lineageHost();
        BookTemplateVersion tip = host == null ? null : versions.tip(host.getId());
        if (tip == null) initVersion(b, BookTemplates.ledgerStandard(), "建册(标准 21 列模板)", by);
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

    // 不带月份的清单:definition 给链尾版(编辑器与导入中心的兜底用)。
    // 不能再走 currentVersion(b) —— 台账公司册的那一列已在迁移中置 NULL(spec §5),
    // 而"本册现在用哪版"已经不是一个册级问题:它按月份各不相同(spec §6)。
    private BookDTO toDTO(LedgerBook b, Integer chainId) {
        BookTemplateVersion v = versions.selectById(tipVersionId(chainId));
        return new BookDTO(b.getId(), b.getScreen(), b.getCompanyId(), b.getPhase(),
            b.getName(), v.getVer(), v.getVer(), readTree(v.getDefinition()));
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

    /** 不带月份时的"现行版"。⚠ 台账公司册的 current_version_id 已被 V111 回填置 NULL(spec §5)——
     *  那不是"缺版本",是"该列作废了,版本改由 book_month_pin 按月持有"。这里一律退回链尾版
     *  (spec §6:不带月份的读语义 = 链尾版)。剩下的调用点是 migrateToGlobalLineage /
     *  customIdsBy* / versionList —— saveTemplate 与 toDTO 已改走按月解析。 */
    private BookTemplateVersion currentVersion(LedgerBook b) {
        BookTemplateVersion v = b.getCurrentVersionId() == null
            ? versions.tip(chainBookId(b))
            : versions.selectById(b.getCurrentVersionId());
        if (v == null) throw new BizException(ResultCode.NOT_FOUND, "账册缺少模板版本");
        return v;
    }

    private static JsonNode readTree(String json) {
        try { return M.readTree(json); }
        catch (Exception e) { throw new IllegalStateException("模板定义损坏", e); }
    }

    // ── 模板保存(spec P4/P5:版本不可变,任何保存都升版;编辑从本月那版长出新版,只带走本月) ──
    // 按月独立之后,原地改写会把所有钉在该版的月份一起改掉 ——「只带走当前月」当场沦为谎话,
    // 所以旧的「轻改动就地更新」整条路废除,structural 恒 true。
    @Transactional
    public TemplateSaveResultDTO saveTemplate(Integer bookId, TemplateSaveReq req) {
        LedgerBook b = books.selectById(bookId);
        if (b == null) throw new BizException(ResultCode.NOT_FOUND, "账册不存在");
        int year = req.year(), month = req.month();
        Integer chainId = chainBookId(b);
        Integer owner = ownerIdOf(b);
        assertMonthEditable(b, owner, year, month);          // P6 冻结,Task 3 填实现

        Long curVerId = pinSvc.resolve(b.getScreen(), owner, year, month, chainId);
        BookTemplateVersion cur = versions.selectById(curVerId);
        String newJson = req.definition().toString();
        TemplateDef.Def oldDef = TemplateDef.parse(cur.getDefinition());
        TemplateDef.Def newDef = TemplateDef.parse(newJson);
        TemplateDef.assertStdKept(oldDef, newDef);
        // 删列守卫已删除(spec §4):P6 之后编辑只可能发生在空月,守卫恒为真 ——
        // 一个永远为真的守卫比没有守卫更糟,它让人以为有保护。
        // 真正在防"导入进来一个模板里没有的列"的是 assertKnownExtraKeys,那是另一段代码,不动。

        String summary = TemplateDef.diffSummary(oldDef, newDef);
        BookTemplateVersion nv = new BookTemplateVersion();
        nv.setBookId(chainId);
        nv.setVer(versions.maxVer(chainId) + 1);
        nv.setDefinition(newJson);
        nv.setNote(req.note() == null || req.note().isBlank() ? summary : req.note());
        nv.setCreatedBy(actor());
        versions.insert(nv);
        pinSvc.pin(b.getScreen(), owner, year, month, nv.getId());        // 只带走当前月
        if ("s10".equals(b.getScreen()) || b.getCompanyId() == null) {    // 链尾指针跟进(latestVer 来源)
            b.setCurrentVersionId(nv.getId()); books.updateById(b);
        }
        audit.log("模板修改", bookLabel(b),
            year + "-" + month + " v" + cur.getVer() + "→v" + nv.getVer() + ": " + summary);
        return new TemplateSaveResultDTO(toDTOAt(b, year, month), true, summary);
    }

    /** P6 录入即冻结:已录入的月份既不许切版本,也不许从它编辑模板 —— 两条路都会改变该月的列。 */
    void assertMonthEditable(LedgerBook b, Integer owner, int year, int month) {
        if (pinSvc.hasData(b.getScreen(), owner, year, month))
            throw new BizException(ResultCode.CONFLICT,
                year + "-" + month + " 已录入数据,模板已定稿;清空本月数据后可改");
    }

    /** 显式钉版(选择器)。已录入的月份拒绝(P6)。 */
    @Transactional
    public BookDTO pinVersion(Integer bookId, PinReq req) {
        LedgerBook b = books.selectById(bookId);
        if (b == null) throw new BizException(ResultCode.NOT_FOUND, "账册不存在");
        Integer owner = ownerIdOf(b);
        assertMonthEditable(b, owner, req.year(), req.month());
        BookTemplateVersion target = versions.byBook(chainBookId(b)).stream()
            // ⚠ 两个 Integer 必须 equals:== 是引用比较,只在 -128..127 的 Integer 缓存里碰巧成立。
            //   ver 是全系统累加的(每改一次模板 +1),链一过百就会对存在的版本报「版本不存在」
            .filter(v -> req.ver().equals(v.getVer())).findFirst()
            .orElseThrow(() -> new BizException(ResultCode.NOT_FOUND, "版本不存在"));
        pinSvc.pin(b.getScreen(), owner, req.year(), req.month(), target.getId());
        audit.log("模板切版", bookLabel(b), req.year() + "-" + req.month() + " → v" + req.ver());
        return toDTOAt(b, req.year(), req.month());
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
        Long curId = currentVersion(b).getId();      // 裸字段可能是 NULL(spec §5),不带月份则标链尾(spec §6)
        for (BookTemplateVersion v : versions.byBook(chainBookId(b)))
            out.add(new TemplateVersionDTO(v.getId(), v.getVer(), v.getNote(), v.getCreatedBy(),
                v.getCreatedAt(), v.getId().equals(curId)));
        return new VersionListDTO(out);
    }

    // ── 写入校验用(§4:未知 id 该行报错不静默吞)。按册取的两个旧版本(customIdsByCompany /
    //    customIdsByPhase)已删:它们走链尾,会让钉在旧版的月份写进该版没有的 c_ 列 ──
    /** 词典按 (册, 月) 取(spec §6):跟着月份走,不是跟着公司走 ——
     *  钉在旧版的月份不该认得后来才加进链尾的列。 */
    public Set<String> customIdsAt(String screen, Integer ownerId, int year, int month) {
        LedgerBook b = "ledger".equals(screen) ? books.byCompany(ownerId) : books.byPhase(ownerId);
        if (b == null) return Set.of();
        Long verId = pinSvc.resolve(screen, ownerId, year, month, chainBookId(b));
        return TemplateDef.customIds(TemplateDef.parse(versions.selectById(verId).getDefinition()));
    }

    private static String bookLabel(LedgerBook b) {
        return ("ledger".equals(b.getScreen()) ? "台账·" : "附表10·") + b.getName();
    }

    private static String actor() {
        Authentication a = SecurityContextHolder.getContext().getAuthentication();
        return a == null ? "系统" : String.valueOf(a.getName());
    }
}

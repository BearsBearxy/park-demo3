package com.park.demo3.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.park.demo3.entity.BookTemplateVersion;
import com.park.demo3.entity.LedgerBook;
import com.park.demo3.mapper.BookTemplateVersionMapper;
import com.park.demo3.mapper.LedgerBookMapper;
import com.park.demo3.mapper.ManagementCompanyMapper;
import com.park.demo3.mapper.MonthlyLedgerMapper;
import com.park.demo3.mapper.S10RecordMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

// 全局链归并(2026-08-25):把每司一链的模板收成一条线性链,各司只留版本指针。
// 这里用 mock mapper 直接打归并算法本身 —— IT 的种子册模板完全相同,byDef 只有一个键,
// 排序分支与 fail-fast 分支在 IT 里一次都执行不到,那是一次性破坏性迁移里风险最高的代码。
class BookLineageMergeTest {

    private final LedgerBookMapper books = Mockito.mock(LedgerBookMapper.class);
    private final BookTemplateVersionMapper versions = Mockito.mock(BookTemplateVersionMapper.class);
    private final BookService svc = new BookService(books, versions,
            Mockito.mock(ManagementCompanyMapper.class), Mockito.mock(MonthlyLedgerMapper.class),
            Mockito.mock(S10RecordMapper.class), Mockito.mock(AuditLogService.class));

    private final Map<Long, BookTemplateVersion> stored = new HashMap<>();
    private final List<BookTemplateVersion> inserted = new ArrayList<>();
    private LedgerBook host;

    BookLineageMergeTest() {
        Mockito.when(versions.selectById(Mockito.any())).thenAnswer(i -> stored.get((Long) i.getArgument(0)));
        Mockito.doAnswer(i -> {                       // 建宿主行:模拟自增主键
            host = i.getArgument(0);
            host.setId(100);
            return 1;
        }).when(books).insert(Mockito.any(LedgerBook.class));
        Mockito.doAnswer(i -> {
            BookTemplateVersion v = i.getArgument(0);
            v.setId(9000L + inserted.size());
            inserted.add(v);
            return 1;
        }).when(versions).insert(Mockito.any(BookTemplateVersion.class));
    }

    /** 建一个「迁移前」的公司册:自己一条私链,现行版就是 def。 */
    private LedgerBook company(int bookId, String name, String def) {
        BookTemplateVersion v = new BookTemplateVersion();
        v.setId(bookId * 10L); v.setBookId(bookId); v.setVer(1); v.setDefinition(def);
        stored.put(v.getId(), v);
        LedgerBook b = new LedgerBook();
        b.setId(bookId); b.setScreen("ledger"); b.setCompanyId(bookId); b.setName(name);
        b.setCurrentVersionId(v.getId());
        return b;
    }

    private static String renamed(String json, String colId, String label) {
        return rebuild(json, colId, label, null);
    }

    private static String withCustomCol(String json, String colId, String label) {
        return rebuild(json, null, null, new TemplateDef.Col(colId, false, label, List.of(), "other", false, null));
    }

    private static String rebuild(String json, String renameId, String newLabel, TemplateDef.Col add) {
        List<TemplateDef.Group> gs = new ArrayList<>();
        for (TemplateDef.Group g : TemplateDef.parse(json).groups()) {
            List<TemplateDef.Col> cols = new ArrayList<>();
            for (TemplateDef.Col c : g.cols())
                cols.add(c.id().equals(renameId)
                        ? new TemplateDef.Col(c.id(), c.std(), newLabel, c.aliases(), c.slot(), c.hidden(), c.w())
                        : c);
            if (add != null && gs.isEmpty()) cols.add(add);
            gs.add(new TemplateDef.Group(g.id(), g.label(), cols));
        }
        return TemplateDef.write(new TemplateDef.Def(gs));
    }

    @Test
    void merge_variantsBecomeOneLinearChain_orderedByChangeSetSize_pointersPreserveEachDefinition() {
        String v1 = BookTemplates.ledgerStandard();
        String v2 = renamed(v1, "shopRent", "商铺租金");
        String v3 = withCustomCol(v2, "c_tax", "税费");
        // 故意乱序 + 重复:改动最多的排头,两家共用出厂版 —— 排序与去重不真跑就会露馅
        LedgerBook cx = company(11, "创显", v3);
        LedgerBook c1 = company(12, "帮管好", v1);
        LedgerBook b2 = company(13, "B2", v2);
        LedgerBook c2 = company(14, "一泽", v1);
        Mockito.when(books.ledgerCompanyBooks()).thenReturn(List.of(cx, c1, b2, c2));

        svc.migrateToGlobalLineage();

        // 一条链:三份去重后的定义按包含关系升序落成 v1/v2/v3,全部挂在宿主行下
        assertThat(inserted).hasSize(3);
        assertThat(inserted).extracting(BookTemplateVersion::getVer).containsExactly(1, 2, 3);
        assertThat(inserted).extracting(BookTemplateVersion::getBookId).containsOnly(100);
        assertThat(inserted).extracting(BookTemplateVersion::getDefinition).containsExactly(v1, v2, v3);
        // note 指名这一版是从谁的现行版迁过来的(人工核对迁移结果的唯一线索)
        assertThat(inserted.get(0).getNote()).contains("帮管好").contains("一泽");
        assertThat(inserted.get(2).getNote()).contains("创显");

        // 各司指针落在自己原来那份定义上,一字不改
        assertThat(c1.getCurrentVersionId()).isEqualTo(inserted.get(0).getId());
        assertThat(c2.getCurrentVersionId()).isEqualTo(inserted.get(0).getId());
        assertThat(b2.getCurrentVersionId()).isEqualTo(inserted.get(1).getId());
        assertThat(cx.getCurrentVersionId()).isEqualTo(inserted.get(2).getId());
        assertThat(host.getCurrentVersionId()).isEqualTo(inserted.get(2).getId());

        // 旧的每司版本行按册删除 —— 删错 book_id 就把刚建好的新链一起端了
        @SuppressWarnings("unchecked")
        ArgumentCaptor<QueryWrapper<BookTemplateVersion>> cap = ArgumentCaptor.forClass(QueryWrapper.class);
        Mockito.verify(versions, Mockito.times(4)).delete(cap.capture());
        List<Object> deleted = new ArrayList<>();
        for (QueryWrapper<BookTemplateVersion> w : cap.getAllValues()) {
            w.getTargetSql();                 // MP 的条件参数是惰性生成的:不取一次 SQL,参数表就是空的
            deleted.addAll(w.getParamNameValuePairs().values());
        }
        assertThat(deleted).containsExactlyInAnyOrder(11, 12, 13, 14);
    }

    @Test
    void merge_mutuallyExclusiveVariants_failsFastNamingTheCompanies() {
        String base = BookTemplates.ledgerStandard();
        // 一个改商铺租金、一个改厂房租金:谁也不含谁,排不成一条线
        LedgerBook a = company(21, "甲司", renamed(base, "shopRent", "商铺租金"));
        LedgerBook b = company(22, "乙司", renamed(base, "factoryRent", "厂租"));
        Mockito.when(books.ledgerCompanyBooks()).thenReturn(List.of(a, b));

        assertThatThrownBy(svc::migrateToGlobalLineage)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("互不包含")
                .hasMessageContaining("甲司")
                .hasMessageContaining("乙司");
        Mockito.verify(versions, Mockito.never()).insert(Mockito.any(BookTemplateVersion.class));
        Mockito.verify(versions, Mockito.never()).delete(Mockito.any());
    }

    @Test
    void merge_alreadyMigrated_isNoOp() {
        LedgerBook existing = new LedgerBook();
        existing.setId(100); existing.setScreen("ledger"); existing.setName("台账通用模板");
        Mockito.when(books.lineageHost()).thenReturn(existing);

        svc.migrateToGlobalLineage();

        Mockito.verify(books, Mockito.never()).insert(Mockito.any(LedgerBook.class));
        Mockito.verify(books, Mockito.never()).updateById(Mockito.any(LedgerBook.class));
        Mockito.verify(versions, Mockito.never()).insert(Mockito.any(BookTemplateVersion.class));
        Mockito.verify(versions, Mockito.never()).delete(Mockito.any());
    }

    @Test
    void merge_noCompaniesYet_startsChainAtFactoryTemplate() {
        Mockito.when(books.ledgerCompanyBooks()).thenReturn(List.of());

        svc.migrateToGlobalLineage();

        assertThat(inserted).hasSize(1);
        assertThat(inserted.get(0).getVer()).isEqualTo(1);
        assertThat(inserted.get(0).getDefinition()).isEqualTo(BookTemplates.ledgerStandard());
        assertThat(host.getCurrentVersionId()).isEqualTo(inserted.get(0).getId());
    }
}

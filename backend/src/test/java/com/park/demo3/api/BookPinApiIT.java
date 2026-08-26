package com.park.demo3.api;
import com.park.demo3.AbstractMysqlIT;
import com.park.demo3.mapper.BookMonthPinMapper;
import com.park.demo3.mapper.BookTemplateVersionMapper;
import com.park.demo3.mapper.LedgerBookMapper;
import com.park.demo3.service.BookPinService;
import com.park.demo3.service.BookService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import static org.assertj.core.api.Assertions.assertThat;

@AutoConfigureMockMvc
@org.springframework.transaction.annotation.Transactional
class BookPinApiIT extends AbstractMysqlIT {
    @Autowired BookMonthPinMapper pins;
    @Autowired BookPinService pinSvc;
    @Autowired LedgerBookMapper booksMapper;
    @Autowired BookTemplateVersionMapper versionsMapper;
    @Autowired BookService bookSvc;

    @Test
    void migrate_preservesEveryExistingMonthBytewise() throws Exception {
        // 迁移后每个已有月份看到的 definition,必须与该册迁移前的现行版逐字节相同(spec §7)
        for (var e : pins.selectList(new com.baomidou.mybatisplus.core.conditions.query.QueryWrapper<>())) {
            String screen = e.getScreen();
            var book = "ledger".equals(screen) ? booksMapper.byCompany(e.getOwnerId())
                                               : booksMapper.byPhase(e.getOwnerId());
            assertThat(book).as("pin 指向的册必须存在").isNotNull();
            String viaPin = versionsMapper.selectById(e.getVersionId()).getDefinition();
            String viaApi = bookSvc.templateAt(book.getId(), e.getPeriodYear(), e.getPeriodMonth())
                    .definition().toString();
            assertThat(viaApi).isEqualTo(new com.fasterxml.jackson.databind.ObjectMapper()
                    .readTree(viaPin).toString());
        }
    }

    @Test
    void migrate_isIdempotent_secondRunAddsNothing() {
        long before = pins.selectCount(new com.baomidou.mybatisplus.core.conditions.query.QueryWrapper<>());
        // 种子库(V5 台账 / V18 附表10)本来就有数据,回填必须真的产出 pin ——
        // 否则上面那条逐字节断言遍历零行,两条用例一起变成空转
        assertThat(before).as("回填必须产出 pin").isGreaterThan(0);
        pinSvc.migrateExisting();
        long after = pins.selectCount(new com.baomidou.mybatisplus.core.conditions.query.QueryWrapper<>());
        assertThat(after).as("重跑不产生第二批 pin").isEqualTo(before);
    }
}

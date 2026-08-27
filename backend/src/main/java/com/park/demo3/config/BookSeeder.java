package com.park.demo3.config;
import com.park.demo3.service.BookPinService;
import com.park.demo3.service.BookService;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

/** 启动种子(幂等):缺册补册(每公司台账册 + 附表10 四期区册),BOOK-WORKBENCH-SPEC §8。 */
@Component
@Order(20)   // 晚于 AdminInitializer(账号)——无依赖,仅保持确定顺序
public class BookSeeder implements ApplicationRunner {
    private final BookService books;
    private final BookPinService pins;
    public BookSeeder(BookService books, BookPinService pins) { this.books = books; this.pins = pins; }
    @Override public void run(ApplicationArguments args) {
        books.seedMissing();
        books.migrateToGlobalLineage();
        pins.migrateExisting();
    }
}

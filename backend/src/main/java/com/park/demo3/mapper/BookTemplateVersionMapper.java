package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.park.demo3.entity.BookTemplateVersion;
import java.util.List;
public interface BookTemplateVersionMapper extends BaseMapper<BookTemplateVersion> {
    default List<BookTemplateVersion> byBook(Integer bookId) {
        return selectList(new QueryWrapper<BookTemplateVersion>()
            .eq("book_id", bookId).orderByDesc("ver"));
    }
    /** 链尾版本行;空链返回 null。 */
    default BookTemplateVersion tip(Integer bookId) {
        return selectOne(new QueryWrapper<BookTemplateVersion>()
            .eq("book_id", bookId).orderByDesc("ver").last("LIMIT 1"));
    }
    default Integer maxVer(Integer bookId) {
        BookTemplateVersion top = tip(bookId);
        return top == null ? 0 : top.getVer();
    }
}

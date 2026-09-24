package com.park.demo3.arch;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

// 告警类别门禁(BILL-NOTICE-WARN-SPEC §5.3)。不起 Spring,只静态扫源码。
//
// 病根 B 是「告警文案这条链上没有验收」:数字算错了有人对账发现,字写歪了没有任何机器或人会发现。
// 出过三起:「场地未定:544.00」(拼的是 meter.name,水表那批带 .00,用户读成金额)、
// 「缺价 elec_sharp」、「rent_office」上屏。这道门是其中一半 —— 另一半在前端
// billNoticeWarnCopy.spec.ts(文案表 + 闭集断言 G6)。
//
// 全等断言不是 ≤ 的理由照抄 QueryHygieneTest 的类注释:清理了也红一次,逼着人回来改这张表,
// 否则数字只会烂成一张没人信的假账,门禁跟着失效。
class BillNoticeWarnTest {

    static final Path WARN_CODE = Path.of("src/main/java/com/park/demo3/service/WarnCode.java");
    static final Path PRODUCER = Path.of("src/main/java/com/park/demo3/service/BillNoticeService.java");

    // 2026-09-23 定稿的九类(W_METER_BIND_STALE 当天补:绑定按月落段之后,落不到段的残留要有人报);
    // 2026-09-24 第十类 W_METER_BILLED_ELSEWHERE(表档案按月记录之后,已锁单收过的表不再进别户草稿,要有人报)。
    // 再加一类必须回来改这里,顺带被逼着回答「文案写了吗、落点给了吗」。
    static final List<String> EXPECTED = List.of(
        "W_METER_NO_CONTRACT",
        "W_METER_BIND_STALE",
        "W_METER_BILLED_ELSEWHERE",
        "W_ROOM_MISMATCH",
        "W_CONTRACT_NO_DATES",
        "W_TERM_NO_PARAMS",
        "W_RENT_FREE_BAD",
        "W_PACKAGE_NO_POOL",
        "W_PRICE_MISSING",
        "W_TOTAL_NEGATIVE");

    /** 枚举常量行:行首若干空格 + 全大写常量名 + 逗号或分号。javadoc 与注释天然不匹配。 */
    static final Pattern CONST = Pattern.compile("^ {4}(W_[A-Z_]+)\\s*[,;]\\s*$");

    static List<String> declaredCodes() throws IOException {
        assertTrue(Files.exists(WARN_CODE), "读不到 " + WARN_CODE + " —— 路径改了?本门禁已失效");
        List<String> out = new ArrayList<>();
        for (String line : Files.readAllLines(WARN_CODE)) {
            Matcher m = CONST.matcher(line);
            if (m.matches()) out.add(m.group(1));
        }
        // 扫描面下限:解析不出东西要在这里炸,而不是让后面的断言拿空清单全绿
        assertTrue(out.size() >= 8, "只解析出 " + out.size() + " 个常量,WarnCode.java 的写法变了?本门禁已失效");
        return out;
    }

    @Test
    void 常量清单与基线全等() throws IOException {
        assertEquals(EXPECTED, declaredCodes(),
            "WarnCode 的常量清单变了。加/删一类告警要同时改:本文件的 EXPECTED、"
            + "前端 billNoticeWarnCopy.ts 的 WARN_COPY 与 WARN_CODES、"
            + "以及 BILL-NOTICE-WARN-SPEC §1 的目录。清单见该 spec §7。");
    }

    @Test
    void 每个类别在产地恰好出现一次() throws IOException {
        List<String> codes = declaredCodes();
        String src = Files.readString(PRODUCER);
        // 去掉注释:javadoc 与行注释里提到常量名不算产地
        String code = src.replaceAll("(?s)/\\*.*?\\*/", "").replaceAll("//[^\\r\\n]*", "");

        Map<String, Integer> hits = new LinkedHashMap<>();
        for (String c : codes) {
            int n = 0;
            Matcher m = Pattern.compile("WarnCode\\." + c + "\\b").matcher(code);
            while (m.find()) n++;
            hits.put(c, n);
        }
        // 扫描面下限:产地文件读错了的话所有计数都是 0,下面的断言会一条条红,但先在这里说清原因
        assertTrue(src.length() > 30_000, "产地文件只有 " + src.length() + " 字符,路径对吗?");

        List<String> bad = hits.entrySet().stream()
            .filter(e -> e.getValue() != 1)
            .map(e -> e.getKey() + " 出现 " + e.getValue() + " 次")
            .toList();
        assertTrue(bad.isEmpty(),
            "每类告警在 BillNoticeService 里只能有一个产地:\n  " + String.join("\n  ", bad)
            + "\n出现 0 次 = 枚举里加了常量但没人产它(死类别);"
            + "\n出现 2 次以上 = 两种病共用一句话,屏上分不开,用户也不知道该去改哪个。");
    }

    @Test
    void 常量名只含大写与下划线() throws IOException {
        for (String c : declaredCodes())
            assertTrue(c.matches("W_[A-Z_]+"),
                c + " 不是合法常量名。前端门禁 G2 直接读本文件解析常量名,命名一乱两边就对不上。");
    }
}

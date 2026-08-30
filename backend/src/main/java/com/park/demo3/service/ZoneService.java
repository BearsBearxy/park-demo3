package com.park.demo3.service;

import com.park.demo3.dto.ZoneDTO;
import com.park.demo3.mapper.BuildingMapper;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 期区候选清单。唯一事实来源是 building.zone;基础清单只保证「还没有任何楼标注时也选得出来」。
 * 加四期 = 建栋楼选 p4,不改这里的代码。
 */
@Service
public class ZoneService {

    /** 期区码形态。与后端各处 @Pattern 同一口径,改这里必须同步改那 7 处。 */
    public static final String ZONE_REGEX = "p\\d+|dorm";
    private static final Pattern P_ZONE = Pattern.compile("p(\\d+)");
    /** 基础清单:破鸡生蛋用。dorm 不在这里排序,统一由 sortNo 兜到最后。 */
    private static final List<String> BASE = List.of("p1", "p2", "p3", "dorm");
    private static final String[] DIGITS = {"", "一", "二", "三", "四", "五", "六", "七", "八", "九"};

    private final BuildingMapper buildings;

    public ZoneService(BuildingMapper buildings) { this.buildings = buildings; }

    /** p3→「三期」;dorm→「宿舍」;认不出的原样返回(不返回 null,下游字典下标读没有护栏)。 */
    public static String label(String code) {
        if ("dorm".equals(code)) return "宿舍";
        if (code == null) return "";
        Matcher m = P_ZONE.matcher(code);
        if (!m.matches()) return code;
        return numeral(Integer.parseInt(m.group(1))) + "期";
    }

    /** 1→一 10→十 11→十一 20→二十 21→二十一。期区不会上百,只做到两位。 */
    private static String numeral(int n) {
        if (n <= 0 || n >= 100) return String.valueOf(n);
        if (n < 10) return DIGITS[n];
        if (n == 10) return "十";
        if (n < 20) return "十" + DIGITS[n % 10];
        return DIGITS[n / 10] + "十" + DIGITS[n % 10];
    }

    /** 排序键:p{n}→n;dorm→Integer.MAX_VALUE(恒最后)。 */
    private static int order(String code) {
        if ("dorm".equals(code)) return Integer.MAX_VALUE;
        Matcher m = P_ZONE.matcher(code);
        return m.matches() ? Integer.parseInt(m.group(1)) : Integer.MAX_VALUE - 1;
    }

    /** 已存期区 ∪ 基础清单,去重去空白,按 order 升序。 */
    public static List<ZoneDTO> candidates(List<String> stored) {
        Set<String> codes = new TreeSet<>(Comparator.comparingInt(ZoneService::order).thenComparing(c -> c));
        codes.addAll(BASE);
        for (String s : stored)
            if (s != null && !s.isBlank() && s.trim().matches(ZONE_REGEX)) codes.add(s.trim());
        List<ZoneDTO> out = new ArrayList<>();
        int i = 0;
        for (String c : codes) out.add(new ZoneDTO(c, label(c), i++));
        return out;
    }

    public List<ZoneDTO> list() {
        return candidates(buildings.selectList(null).stream()
                .map(com.park.demo3.entity.Building::getZone).toList());
    }
}

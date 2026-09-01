package com.park.demo3.service;
import com.park.demo3.dto.ImportError;
import com.park.demo3.dto.ImportResultDTO;
import com.park.demo3.dto.WeatherDayDTO;
import com.park.demo3.dto.WeatherImportRequest;
import com.park.demo3.entity.WeatherHour;
import com.park.demo3.mapper.WeatherHourMapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.math.BigDecimal;
import java.sql.Date;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

// 外部天气与太阳辐射(PV-ANALYSIS-SPEC §03)。导入落库 + 按年出日聚合,**零业务规则,纯搬运**——
// 分析口径全在前端 pvMeterAna.logic.ts,这里多算一步就多一处会和前端对不上的地方。
// 日聚合的 SQL 在 WeatherHourMapper,不落第二张表(理由见那里)。
@Service
public class WeatherService {
    private final WeatherHourMapper mapper;
    public WeatherService(WeatherHourMapper mapper) { this.mapper = mapper; }

    // 导出 CSV 常见两种整点写法:带秒与不带秒。都收,别的一律行级错误
    private static final DateTimeFormatter[] HOUR_FMTS = {
        DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm"),
        DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"),
    };

    public List<WeatherDayDTO> daily(int year) {
        return mapper.selectDaily(year + "-01-01 00:00:00", (year + 1) + "-01-01 00:00:00")
            .stream().map(WeatherService::toDayDTO).toList();
    }

    // 幂等 upsert:同 obs_time 先删后插(同批重复行 = 后行覆盖前行),与 PvMeterService.importRows 同口径。
    // 行级错误跳过不整批拦:一份跨年的导出里混进几行坏数据,不该让另外 8000 行也进不来。
    @Transactional
    public ImportResultDTO importRows(WeatherImportRequest req) {
        List<ImportError> errors = new ArrayList<>();
        int imported = 0;
        List<WeatherImportRequest.Row> rows = req.rows() == null ? List.of() : req.rows();
        for (int i = 0; i < rows.size(); i++) {
            WeatherImportRequest.Row row = rows.get(i);
            LocalDateTime t = parseHour(row.obsTime());
            if (t == null) {
                errors.add(new ImportError(i, String.valueOf(row.obsTime()), "时间格式非法(应为 YYYY-MM-DD HH:mm)"));
                continue;
            }
            if (neg(row.ghi()) || neg(row.dni()) || neg(row.dhi())) {
                errors.add(new ImportError(i, t.toString(), "辐射不能为负"));
                continue;
            }
            mapper.delete(new QueryWrapper<WeatherHour>().eq("obs_time", t));
            WeatherHour w = new WeatherHour();
            w.setObsTime(t);
            w.setGhi(row.ghi()); w.setDni(row.dni()); w.setDhi(row.dhi());
            w.setTempC(row.tempC()); w.setPrecipMm(row.precipMm());
            w.setHumidity(row.humidity()); w.setWeatherTxt(blankToNull(row.weatherTxt()));
            w.setSource("import");
            mapper.insert(w);
            imported++;
        }
        return new ImportResultDTO(imported, errors.size(), errors);
    }

    // ── helpers ──
    private static boolean neg(BigDecimal v) { return v != null && v.signum() < 0; }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    private static LocalDateTime parseHour(String s) {
        if (s == null || s.isBlank()) return null;
        String v = s.trim().replace('T', ' ');
        for (DateTimeFormatter f : HOUR_FMTS) {
            try { return LocalDateTime.parse(v, f); } catch (DateTimeParseException ignored) { /* 试下一种 */ }
        }
        return null;
    }

    private static WeatherDayDTO toDayDTO(Map<String, Object> r) {
        return new WeatherDayDTO(
            String.valueOf(((Date) r.get("d")).toLocalDate()),
            dec(r.get("ghi_kwh")), dec(r.get("rain_mm")), dec(r.get("t_max")), dec(r.get("t_min")),
            num(r.get("is_rain")) == 1,
            (int) num(r.get("hours")),
            (int) num(r.get("hour_mask")));
    }

    private static BigDecimal dec(Object v) {
        return v == null ? null : v instanceof BigDecimal b ? b : new BigDecimal(v.toString());
    }

    private static long num(Object v) { return v == null ? 0L : ((Number) v).longValue(); }
}

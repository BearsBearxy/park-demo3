# 光伏分栋分析规范（PV-ANALYSIS-SPEC）

2026-08-31 定稿。设计稿：Artifact `592f1d86-c6a1-4bc3-97bd-1c6363704464`「光伏分栋分析实施规格」。
**本文件是仓内权威版**——migration 与源码注释一律引 `PV-ANALYSIS-SPEC §NN`，不引 artifact URL。
设计稿与仓库现状的四处出入见 §10，以本文件为准。

上游：`PV-METER-SPEC.md`（抄表数据模型）、`ENERGY-ANALYSIS-SPEC.md`、`RBAC-SPEC.md` §4、
`S21-PARAM-CENTER-SPEC.md`、`IMPORT-GUIDE.md`、`METRIC-SOURCE-SPEC.md`。

---

## §00 范围与前置

把「分栋抄表分析」从 `PvRoiView.vue` 拆出独立成屏，重做分析逻辑与可视化，并接入外部天气/辐照数据。
**`PvRoiView` 保留附表6 口径的投资回收，卸掉抄表区**（468 行 → ~230 行）。

### 已有资产（不要重建）

| 东西 | 在哪 | 状态 |
|---|---|---|
| 电站主数据 13 站 | `pv_station`（V36） | 已有。`capacity_kwp` / `price_yuan` **全为 NULL**，只有模拟器按 950h 反推的假值 |
| 分栋逐日抄表 | `pv_reading`（V37/V44） | 已有。uk(station_id, read_date)，source ∈ manual/import/simulated |
| 抄表 CRUD + 导入 + 模拟 | `PvMeterService.java` / `PvMeterController.java` | 已有，本刀**不改**（除 simulateDays，见 §08） |
| 四个分析纯函数 | `frontend/src/views/analysis/pvRoi.logic.ts:86,104,130,152` | `stationEfficiency` / `monthlyEfficiency` / `consumptionRows` / `revenueByStation`，**整体迁走** |
| 全年取数接口 | `GET /api/pv-meter/readings?year=` | 已有，month 可空 = 全年。**零改动** |
| 同比/环比开关 | `frontend/src/analysis/useCompare.ts` | 已有单例，本屏声明 `['yoy']` 即可接上 |

---

## §01 决策清单

下面每一条都是拍过板的。不要重新讨论，不要「优化」成别的。

### 做

| 决策 | 理由 |
|---|---|
| **新屏 `pv-meter-analysis`「光伏分栋分析」**，落 fpNav 分析层「**专题分析**」组（`pv-roi` 同组，排它后面） | 两套数据源、两套时间维、两套期间语义挤一屏；最直白的信号是一屏两个期间选择器 |
| **三层渐进披露 + 一个分析工作台** | 业务受众之间是深度差异（用渐进披露）；系统所有者与他们之间是身份差异（用独立页面） |
| **第一层主体是可排序表，不是图** | 行业调研：所有平台第一屏都是表。非专业者多对象比较正确率：彩色圆点 84.3% ≫ 条形图 54.2% |
| **主指标 = 本期收益（元），第二指标 = 比应得少（元）** | 这是财务系统，用户母语是钱。不能拿依赖反事实的「缺口」当唯一门面数 |
| **用「缺口 / 差额」，不用「损失」** | 财务语境里「损失」要求可确认可追责可入账，答不上「找谁要」这个词就废了 |
| **四色状态灯，灰独立成档** | 日粒度电表最高频的「异常」是抄表失败，不是设备坏。灰混进红 = 三周内没人看 |
| **金额门槛过滤统计噪音** | `q<0.05 且 持续≥14天 且 年化≥¥5,000` 才亮红灯 |
| **天气/辐照走导入中心，不接付费 API** | datashareclub 是实测非预报，且可导出。零持续费用、零扣费风险 |
| **三个断闸参数进已有参数中心** | 万一将来真接了计费接口。默认值是「关」 |
| **`pv_station.metered` 字段** | 「没装表」与「装了表但漏抄」必须分开：前者永久不用管，后者要催人 |
| **模拟器改造与本刀同一刀做** | 不改的话新屏永远显示「全部正常」，而你分不清是真没事还是算错了 |

### 不做

| 不做 | 为什么 |
|---|---|
| 组串 / 单板级归因 | 楼栋级表计到不了这个粒度。`pv_station` 补板数/单板W/单组串板数那一刀**不排期** |
| Carpet plot 地毯图 | 无小时级发电量；**且它是仿真软件的图不是运维标配**，非专业用户读不懂。两票否决 |
| IEC 61724 产额堆叠柱 Yf/Lc/Ls | 无直流侧电量，Lc 与 Ls 拆不开。**降级两段版更糟**——把 5–10% 的倾角假设误差涂色叫「损失」是造骗人的图 |
| 物理版损失瀑布 | 需要 ELA 引擎 + 告警 + 工单 + 气象联合，一样都没有。**财务版四段瀑布照做** |
| 裸 PR 时序图 | 无组件温度，裸 PR 冬高夏低摆幅 ±10%，运维会把季节性当衰减。PR 只作为卡片上一个绝对数字，**不做趋势** |
| p / q / 置信区间上第一层 | BH-FDR 必须做但只在后台当告警闸门。界面出三档判词 + 金额区间 |
| 桑基图 / 能流图 / I-V 曲线 / 组串离散率 / 365 列热力图（第一层） | 数据不支持，或行业已收敛到更好形式 |
| 「简易 / 专业」双模式 | 做成模式必然两条计算路径、迟早数字对不上。工作台是**同一批结果的另一种渲染** |

### 开工前的三个阻塞项（不是代码）

1. 各栋**真实装机容量 kWp**——13 站现在全空，只有假值。没有真值效率口径整个是假的。
2. 从电费系统要**自用/上网分表电量 + 分时电价 + 总投资额**——没有这三样主指标只能退回「电量」，说服力砍半。
3. 二期/三期**哪些栋有光伏表**——决定第一版覆盖 5 栋还是 13 栋。

**前两项没到位可以先做代码骨架，但不要上线，也不要用假容量出结论。**

---

## §02 数据模型

三个 migration。仓库当前最大版本 **V116**（`ls backend/src/main/resources/db/migration/`），所以从 **V117** 起。

> **迁移目录的两条硬规矩**：`baseline-on-migrate=false`，**历史迁移不可改，只能往后加**。
> 版本号在 SQL 和 Java 两处共用（`backend/src/main/java/db/migration/V35__Bill_pay_company_seed.java` 占了 V35），
> 起号前先 `ls` 确认最大值没变。

> **⚠ 完整性判的是「连续性」，不是「小时数」（2026-08-31 用户提出后改）。**
> 原文写的是 `hours < 24 → 剔除`，但**真实天气源给不出全天 24 行**：很多导出只给白天那几个小时，
> 日照长度还按季节变。照原文做，等于把所有真实数据全剔光。
>
> 「有几个小时」分不清「当天日照短」和「漏了几行」，而这两件事对日累计 GHI 的影响完全不同：
> · 清晨黄昏的整点，太阳贴地平线，GHI 近乎 0，缺了几乎不动日累计；
> · **中间时段缺一小时**，丢的是当天最强的那部分，日累计明显偏低。
>
> 物理上分得清的是**位置**。所以：
> · 后端日聚合多返回 `hour_mask`（`BIT_OR(1 << HOUR(obs_time))`，24 位，第 h 位 = 该整点有记录）；
> · 前端 `okDaySet` 判位图**连不连续**：有内部空洞 = 真丢数据 → 整日剔除；两头短 = 那天就是短 → 照用；
> · 另有 `minHours`（默认 6）只兜「稀疏得离谱」的日子；
> · 位图缺省（老数据）时**退回原来的满 24 行口径，不擅自放宽**。

### V117 · weather_hour

```sql
-- V117__weather_hour.sql — 外部逐小时天气与太阳辐射(PV-ANALYSIS-SPEC §02)。
-- 只存小时原始值，日累计走 SQL GROUP BY 现算：口径写在代码里，改了立刻生效不用重导。
-- 园区单点(佛山高明)，13 栋楼在同一 1km 网格内 —— 不设地点字段。
-- 数据源 datashareclub 导出 CSV，逐小时实测(非预报)。dni/dhi 当前用不上但导出本就带，顺手落库，
-- 将来做遮挡分析(散射占比高的日子遮挡影响小)会用到，不落的话得重导。
CREATE TABLE weather_hour (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  obs_time    DATETIME     NOT NULL,                  -- 观测整点(本地时,与电表日界对齐)
  ghi         DECIMAL(7,2) NULL,                      -- 短波太阳辐射 W/m2
  dni         DECIMAL(7,2) NULL,                      -- 直射辐射 W/m2
  dhi         DECIMAL(7,2) NULL,                      -- 散射太阳辐射 W/m2
  temp_c      DECIMAL(5,2) NULL,                      -- 气温 摄氏度
  precip_mm   DECIMAL(6,2) NULL,                      -- 降水量 mm
  humidity    TINYINT UNSIGNED NULL,                  -- 相对湿度 %
  weather_txt VARCHAR(16)  NULL,                      -- 晴/多云/阴/中雨
  source      VARCHAR(16)  NOT NULL DEFAULT 'import', -- import / api
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_weather_hour (obs_time),
  KEY idx_weather_hour_date (obs_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='外部逐小时天气与辐射';
```

### V118 · pv_station.metered

```sql
-- V118__pv_station_metered.sql — 该栋有没有装光伏计量表(PV-ANALYSIS-SPEC §02)。
-- 与「装了表但这个月漏抄」是两回事：前者永久、无需催；后者是数据缺口、要催录入。
-- 只靠「有没有抄表记录」判定会把两者显示成同一种灰，该催的和不用催的混在一起。
ALTER TABLE pv_station ADD COLUMN metered TINYINT UNSIGNED NOT NULL DEFAULT 1
  COMMENT '1=已装光伏计量表 0=未安装(不入任何分析，护栏分母排除)' AFTER phase;

-- 一期确认：B座 / C、D座 / E座 / F座 / G座 五站有表(电网后台设备树实证)。
-- 二期 8~13栋、三期 创业/工业大厦：现场核实前保持默认 1，核实后单独 UPDATE。
```

### V119 · 三个断闸参数

> **参数中心只有一列 DECIMAL —— 枚举必须整数编码。**
> `alloc_cfg.cfg_value` 是 `DECIMAL(14,8)`，**全仓没有字符串值的先例**。
> 所以 `weather_source` 不能存 `'import'`，必须整数编码 + `ValueKind.ENUM` + `Map<Integer,String>` 字典。

```sql
-- V119__weather_switch_params.sql — 外部天气数据源断闸开关三键(PV-ANALYSIS-SPEC §02)。
-- 默认「关」：新装实例/开发环境/演示库都不该往外发付费请求。
-- 开启付费源是一个**显式动作**，不是一个需要记得去关掉的默认行为。
INSERT INTO alloc_cfg (scope, cfg_key, cfg_value, acct_month, mode, note) VALUES
  ('', 'weather_api_enabled',     0,    '', 'from', '外部天气API总开关 0=关(默认) 1=开'),
  ('', 'weather_api_monthly_cap', 400,  '', 'from', '本月调用上限，达到自动置 enabled=0'),
  ('', 'weather_source',          0,    '', 'from', '0=导入(默认) 1=和风 2=datashareclub');
```

同时在 `backend/src/main/java/com/park/demo3/service/ParamRegistry.java` 登记：

```java
// 枚举字典与 S_GLOBAL_ONLY 声明在 static{} 之前，与 ZONE_CALC_KIND_OPTS(:43) / S_* 常量(:30-37) 同处。
// S_GLOBAL_ONLY 全仓尚无，本刀新建。
private static final Set<ScopeKind> S_GLOBAL_ONLY = EnumSet.of(ScopeKind.GLOBAL);
private static final Map<Integer,String> WEATHER_SOURCE_OPTS =
    Map.of(0, "导入（不发外部请求）", 1, "和风天气 API", 2, "datashareclub API");

// static{} 块内，三行相邻登记（顺序 = 页面渲染顺序，前端 PARAM_DEFS 必须同位置插入）
alloc("weather_api_enabled", "外部天气API 总开关", "", Group.CONSTANT, S_GLOBAL_ONLY, "from", false,
    ValueKind.BOOL, null, null, "关闭后立即停止一切外部请求，分析屏自动回落相对口径", null);
alloc("weather_api_monthly_cap", "外部天气API 月调用上限", "次", Group.CONSTANT, S_GLOBAL_ONLY, "from", false,
    ValueKind.INT, null, "本月调用数达到上限自动关闭总开关并记日志", "防的是「忘了关」，不是「想关」", null);
alloc("weather_source", "天气数据源", "", Group.CONSTANT, S_GLOBAL_ONLY, "from", false,
    ValueKind.ENUM, WEATHER_SOURCE_OPTS, null, "默认走导入中心，不产生任何费用", null);
```

> **四个会让 CI 变红的坑**（① ② 出自设计稿，③ ④ 是落地时实测补上的）
> ① `ParamPermissionSplitTest` 钉死 `group==MONTHLY ⟺ monthlyCheck==true`。
> 这三个键是长期开关 → `Group.CONSTANT` + `monthlyCheck=false`，写 `true` 会红。
> ② `DEFS` 是 `LinkedHashMap`，登记顺序 = 前端 `frontend/src/utils/paramRegistry.ts` 的 `PARAM_DEFS` 数组顺序，
> **前端 spec 逐位比对**。两边必须在同一位置插入这三行。
> ③ **`ParamRegistryTest.SPEC_KEYS` 是白名单，且有反向断言**
> （`for (Def d : ParamRegistry.all()) assertTrue(spec.contains(d.key()), "spec 外的键: " + d.key())`，:54）。
> 只加注册表不加 SPEC_KEYS → `allSpecKeysRegistered` 红。
> ④ **前端 spec 比的是后端导出的 fixture**：`ParamRegistryTest.exportJson` 写 `backend/target/param-registry.json`，
> 要手工拷成 `frontend/src/utils/__fixtures__/param-registry.json`；`paramRegistry.spec.ts` 还写死了
> `PARAM_DEFS.length`（45 → 48）。
>
> 另有一条**文案铁律**：`ParamRegistryTest.FORBIDDEN = /(building:|rule:|meter:|tenant:|默认·所有月份|_)/`
> 作用于 label / formula / hint / 枚举文案。所以 `weather_api_monthly_cap` 的 formula 写「自动关闭总开关」，
> 不写「自动置 `enabled=0`」—— 后者虽不撞正则，但 `enabled` 是字段名，撞规则⑤「人话文案无内部标识」的本意。

---

## §03 后端

一个 weather 域，照 pv-meter 那条链路抄。四个文件 + 一行权限登记。

> **数据源已定：付费逐时（¥18/月）。**
>
> 免费档只放出 24 小时里的 21 行，锁掉的 3 行里正好有 14:00 —— 那一个整点约占当日 GHI 的 **13%**，
> 三行全落在夜里（缺了也不影响日累计）的概率只有 **8.2%**，即约 **92% 的日子日累计会被少算**。
> 少算的量还随锁哪几行随机变，等于往 β 里灌噪声。所以**不做**「日总量 MJ/m² 兜底」那条支路：
> 逐时是唯一入口，`hourMask` 的连续性判据（§03.3）就是为它设计的。

### 3.1 Entity

```java
// backend/src/main/java/com/park/demo3/entity/WeatherHour.java
package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.math.BigDecimal; import java.time.LocalDateTime;
@Data @TableName("weather_hour")
public class WeatherHour {
    @TableId(type = IdType.AUTO) private Integer id;
    private LocalDateTime obsTime;     // 观测整点
    private BigDecimal ghi;            // 短波太阳辐射 W/m2
    private BigDecimal dni;
    private BigDecimal dhi;
    private BigDecimal tempC;
    private BigDecimal precipMm;
    private Integer humidity;
    private String weatherTxt;
    private String source;             // import / api
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE) private LocalDateTime updatedAt;
}
```

字段一律裸写（靠 `map-underscore-to-camel-case`），只有两个时间戳带 `@TableField(fill)`。
注解与 class 之间无空行，同行多 import —— 房内风格，照抄 `PvReading.java`。

### 3.2 Mapper —— 日聚合就在这里

```java
// backend/src/main/java/com/park/demo3/mapper/WeatherHourMapper.java
@Mapper
public interface WeatherHourMapper extends BaseMapper<WeatherHour> {
    // 日聚合：GHI 逐小时 W/m2 × 1h ÷ 1000 = kWh/m2。hours 是护栏——不足 24 说明当日数据有缺。
    @Select("""
        SELECT DATE(obs_time)      AS d,
               SUM(ghi) / 1000     AS ghi_kwh,
               SUM(precip_mm)      AS rain_mm,
               MAX(temp_c)         AS t_max,
               MIN(temp_c)         AS t_min,
               COUNT(*)            AS hours,
               MAX(CASE WHEN weather_txt LIKE '%雨%' THEN 1 ELSE 0 END) AS is_rain
        FROM weather_hour
        WHERE obs_time >= #{from} AND obs_time < #{to}
        GROUP BY DATE(obs_time)
        ORDER BY d
        """)
    List<Map<String, Object>> selectDaily(String from, String to);
}
```

**为什么日聚合不落库**：一个坐标点 × 24 × 365 = **8760 行/年**，扫描聚合是毫秒级，没有性能理由建第二张表。
更重要的是：**口径写在 SQL 里，改了立刻生效不用重导**。落库就多一处会不同步的地方。

### 3.3 DTO

```java
// backend/src/main/java/com/park/demo3/dto/WeatherDayDTO.java
// 房内 DTO 一律 record（照 PvReadingDTO）
public record WeatherDayDTO(
    String date,          // YYYY-MM-DD
    BigDecimal ghiKwh,    // 日累计 kWh/m2
    BigDecimal rainMm,
    BigDecimal tMax,
    BigDecimal tMin,
    boolean isRain,
    int hours             // 当日有几个小时的数据(<24 = 有缺，前端护栏用)
) {}

// backend/src/main/java/com/park/demo3/dto/WeatherImportRequest.java
public record WeatherImportRequest(java.util.List<Row> rows) {
    public record Row(String obsTime, BigDecimal ghi, BigDecimal dni, BigDecimal dhi,
                      BigDecimal tempC, BigDecimal precipMm, Integer humidity, String weatherTxt) {}
}
```

`ImportResultDTO` 复用既有 record（`dto/ImportResultDTO.java`，四参 `imported/skipped/errors/notices`，
本刀用三参构造，notices 走默认 `List.of()`）。

### 3.4 Service

```java
// backend/src/main/java/com/park/demo3/service/WeatherService.java
// 外部天气/辐射(PV-ANALYSIS-SPEC §03)。导入落库 + 按年出日聚合。零业务规则，纯搬运。
@Service
public class WeatherService {
    private final WeatherHourMapper mapper;
    public WeatherService(WeatherHourMapper mapper) { this.mapper = mapper; }

    public List<WeatherDayDTO> daily(int year) {
        return mapper.selectDaily(year + "-01-01 00:00:00", (year + 1) + "-01-01 00:00:00")
            .stream().map(WeatherService::toDayDTO).toList();
    }

    // 幂等 upsert：同 obs_time 先删后插(同批重复行 = 后行覆盖前行)，与 PvMeterService.importRows 同口径
    @Transactional
    public ImportResultDTO importRows(WeatherImportRequest req) {
        // 逐行：时间格式非法 → 行级错误「时间格式非法(应为 YYYY-MM-DD HH:mm)」；
        //       ghi/dni/dhi 任一为负 → 行级错误「辐射不能为负」；
        //       合法行 delete(obs_time) 后 insert，source='import'
        // return new ImportResultDTO(imported, errors.size(), errors);
    }
}
```

### 3.5 Controller

```java
// backend/src/main/java/com/park/demo3/controller/WeatherController.java
@Tag(name = "外部天气与辐射")
@RestController @Validated @RequestMapping("/api/weather")
public class WeatherController {
    private final WeatherService svc;
    public WeatherController(WeatherService svc) { this.svc = svc; }   // 构造注入，无 @Autowired

    @Operation(summary = "按年取日聚合") @GetMapping("/daily")
    public List<WeatherDayDTO> daily(@RequestParam @Min(2000) @Max(2100) int year) { return svc.daily(year); }

    @Operation(summary = "导入逐小时天气") @PostMapping("/import")
    public ImportResultDTO importRows(@Valid @RequestBody WeatherImportRequest req) { return svc.importRows(req); }
}
```

> **写端点不登记权限 = 403，且 CI 会红。**
> controller 上**没有任何 RBAC 注解**（全仓无 `@PreAuthorize`）。规则集中在
> `backend/src/main/java/com/park/demo3/security/PermissionRegistry.java` 的构造器里，有序表首个命中生效。
> `WriteAccessManager.resolve` 返回 null 即拒绝，`PermissionCoverageTest` 会在 CI 里红。
>
> ```java
> // PermissionRegistry 构造器里加一行（挨着 :118-122 的 /api/pv-meter 段）
> add(null, "/api/weather/**", Perm.METER_READING_EDIT);   // method=null 表示所有非 GET
> ```
>
> 读端点**零配置**——`SecurityConfig` 里 `.requestMatchers(HttpMethod.GET, "/api/**").authenticated()`
> 已经放行任何已登录账号（RBAC-SPEC v2「读全开，写分权」）。

**返回值不要手写 Result**：controller 返回**裸 DTO / List / void**，`common/ResponseWrapAdvice.java` 统一包成
`Result.ok(body)`。异常走 `BizException(ResultCode.X, "文案")` + `GlobalExceptionHandler`，
**不在 controller 里 try/catch**。返回类型也别写裸 `String`。

---

## §04 导入

加一个 `key='weather'` 的导入类型，与 `pvMeter`（`importRegistry.ts:559-583`）同构。

### 4.1 解析纯函数

```ts
// frontend/src/utils/weatherExcel.ts
// datashareclub 导出的逐小时天气 CSV → 导入行。表头按名识别(matchByHeader，含别名与单位后缀前缀匹配)。
import { matchByHeader, type ColumnMapEntry } from '@/utils/importHeaderMatch'

export const WEATHER_TEMPLATE_COLS = ['日期时间', '天气', '温度', '降水量', '湿度',
                                      '短波太阳辐射', '直射辐射', '散射太阳辐射']

const WEATHER_COLUMN_MAP: ColumnMapEntry[] = [
  { label: '日期时间', key: 'obsTime',  text: true, aliases: ['时间', '观测时间', 'datetime'] },
  { label: '天气',     key: 'weatherTxt', text: true, aliases: ['天气现象', '天气状况'] },
  { label: '温度',     key: 'tempC',     aliases: ['气温', '温度(℃)'] },
  { label: '降水量',   key: 'precipMm',  aliases: ['降水', '雨量'] },
  { label: '湿度',     key: 'humidity',  aliases: ['相对湿度'] },
  { label: '短波太阳辐射', key: 'ghi', aliases: ['太阳辐射', '总辐射', 'GHI'] },
  { label: '直射辐射',     key: 'dni', aliases: ['法向直射辐射', 'DNI'] },
  { label: '散射太阳辐射', key: 'dhi', aliases: ['散射辐射', 'DHI'] },
]
```

> **`matchByHeader` 已经帮你做掉的事**（`frontend/src/utils/importHeaderMatch.ts`）：
> ① `normalizeHeader` 去掉空白与常见标点；② 标签按长度降序排，长标签优先，防短标签吞长列头；
> ③ 命中条件是 `nh === l.nl || nh.startsWith(l.nl)` —— **前缀匹配自动吃掉「(W/m²)」这类单位后缀**；
> ④ `cleanNum` 自动剥千分位/空格/￥，空 → 0。
>
> **一个必须知道的坑**：关键列的值一律落在 `rec.tenantName` 这个键上（`importHeaderMatch.ts:169`），
> 不管 `nameLabels` 叫什么。天气导入的「关键列」是时间，所以要从 `tenantName` 里取时间串。

### 4.2 注册表条目

```ts
// frontend/src/utils/importRegistry.ts —— 照抄 key='pvMeter'(:559-583) 的形状
{
  key: 'weather', label: '天气与辐射', tag: '天气', icon: 'sun', context: 'none',
  module: 'meter-reading:edit',
  modalProps: (ctx) => ({
    title: '导入 逐小时天气与太阳辐射',
    sub: '上传 datashareclub 导出的逐小时 CSV；同一时刻重复导入自动覆盖，非法时间/负辐射逐行报告不整批拦',
    templateCols: WEATHER_TEMPLATE_COLS,
    customParse: (matrix: string[][]) => {
      const { records, errors } = parseWeatherRows(matrix)
      ctx._parseErrors = errors.filter(e => e.rowIndex >= 0)   // 行级错误暂存 ctx
      const headerErr = errors.find(e => e.rowIndex < 0)       // rowIndex=-1 = 表头识别失败
      if (headerErr) return { error: headerErr.reason }        // 只有它整批拦
      return { records }
    },
  }),
  run: async (payload, ctx) => {
    const rows = payload as ImportRec[]
    const pe = ctx._parseErrors ?? []
    if (!rows.length) return { imported: 0, skipped: pe.length, errors: pe }   // 全坏行不打 API
    const res = await http.post<ImportResultDTO>('/weather/import', { rows })
    return { imported: res.imported, skipped: res.skipped + pe.length, errors: [...res.errors, ...pe] }
  },
  target: () => null,
}
```

> **三个照抄时会踩的坑**
> ① `ctx` 是 hub 每次导入新建的**同一引用**，同时传给 `modalProps` 与 `run`，
> 所以 `customParse` 是闭包捕获 `ctx`，不能改成无参工厂。
> ② `_parseErrors` 每次解析必须**整体赋值**（不能 push 追加），否则换文件重解析时旧错误残留。
> ③ `icon` 名不在 `frontend/src/components/ds/icon.ts` 的 MAP 里会**静默变问号**。`'sun'` 已在（:43）。

同步 `frontend/src/utils/importRegistry.spec.ts:28`：断言文案 `has the 24 expected keys` → `25`，
key 清单加 `'weather'` 后重排序。

---

## §05 公式层

全部统计在前端纯函数里算。13 站 × 365 日 ≈ 4700 个点，中位数抛光 + 检验在浏览器里是毫秒级，
**没有理由为它加后端接口**。

- `frontend/src/views/analysis/pvMeterAna.logic.ts` —— 全部纯函数。无 Vue 依赖、无 IO、可单测
- `frontend/src/views/analysis/pvMeterAna.logic.spec.ts` —— 每个函数配已知答案的夹具

房内惯例（照 `pvRoi.logic.ts`）：文件头一行注释写「屏名 + 口径 + 单测文件名」，
每个导出函数上方一段中文注释写清**口径与边界**（缺数怎么办、除零怎么办），类型与函数交替排列。

### 5.1 归一化与过滤

```ts
export interface DayRow { stationId: number; date: string; gen: number }
export interface StationCfg { id: number; name: string; capKwp: number | null; metered: boolean }
export interface WeatherDay { date: string; ghiKwh: number; rainMm: number; isRain: boolean; hours: number }

/** 等效小时 eff = 发电量 ÷ 装机容量(kWh/kWp)。装机容量不同的楼栋只有除掉容量才可比。 */
export function specificYield(gen: number, capKwp: number): number { return gen / capKwp }
```

> **过滤器只准打在 GHI 上 —— 这是最容易自欺的一条**
>
> ```ts
> // 对
> const okDay = (w: WeatherDay) => w.hours === 24 && w.ghiKwh >= GHI_MIN
> // 错 —— 永远不要这样写
> const okDay = (r: DayRow) => r.gen > x
> ```
>
> 把阈值打在 `gen` 或 `eff` 上，等于**优先删除故障楼的故障日**——过滤器吃掉了证据，剩下的数据当然显示一切正常。
>
> `gen = 0` 有两种相反含义，必须物理分开：**表离线 → NaN**（**绝不能用拟合值补齐**，补了残差恒为 0，
> 离线 10 天的楼会算出「正常」）；**有太阳却发 0 → 停机事件**，走独立的「零值日率」通道用二项检验对比同园其他楼，
> **不进 log 域连续模型**。

> **天气只覆盖一部分日子时：没有气象记录 ≠ 那天不好**
>
> ```ts
> const okDays = screened ? new Set([...screened, ...unscreened]) : null   // 对
> const okDays = screened                                                  // 错
> ```
>
> 用户是**按月分批**导天气的。若把「没有天气行的日子」一并排除，先导完 1–6 月，7–12 月的抄表就整整半年不进模型，
> 而屏上还写着「模型用全年数据」—— 为了「不知道」而扔掉真数据。
>
> 进模型的是「筛过且合格」∪「压根没筛过」，被排除的只有**明确判定为坏**的那些。
> 代价是未筛日会混入低辐照日，噪声大一点；但**不引入偏倚**——筛选条件打在 GHI 上而不是 gen 上（上一条），
> 漏筛不会优先保留或删除故障楼的日子。
>
> 未筛天数与覆盖率必须**报到屏上**（`quality.unscreenedDays` / `quality.weatherCoverage`），
> 且一天天气都没有时要说清**筛选器整个是关的**，不能只说「全园一起变差看不出来」。§07 的文化是不确定一律显式暴露。
> 头一行也不许再声称「全年数据」——有效日是多少就写多少。

### 5.2 中位数抛光

模型 `eff(s,d) = α(s)·β(d)·ε`，取对数变可加。**用中位数不用最小二乘**：某站表坏报 0 时，
均值基准会被整体拉塌，于是所有站看起来都「高于基准」，真正的故障站反而不报警。

```ts
export interface PolishResult {
  mu: number
  alpha: Map<number, number>              // log 域，站固有水平
  beta: Map<string, number>               // log 域，当日天气
  resid: Map<number, Map<string, number>> // 残差
  iterations: number
  converged: boolean
}

/** 中位数抛光(Tukey median polish)。迭代到收敛，**显式重锚** —— 不要依赖迭代的隐式性质。
 *  可辨识性：(mu, α+c, β−c) 同解，靠 median(α)=0 / median(β)=0 锚定。
 *  只迭代 2~3 轮的话这两个约束只是近似成立，而 §5.5 的 H(d) 直接吃 β，锚定漂移会变成假趋势。 */
export function medianPolish(rows: DayRow[], stations: StationCfg[], okDays: Set<string>): PolishResult
// 1. 建 log(eff) 矩阵，跳过 !metered / capKwp==null / !okDays.has(date) / gen<=0
// 2. while (iter < 20 && maxDelta > 1e-8) { 扫行中位数 → 扫列中位数 }
// 3. **显式重锚**：mu += median(alpha); alpha -= median(alpha); 同理 beta
// 4. converged = (iter < 20)
```

> **这套方法结构性看不见的两件事 —— 必须写进方法页**
> ① **全园同时变差。** 共模故障（全园积灰、同批组件衰减）会被完全吸收进 β(d)，**残差纹丝不动**。
> 中位数的崩溃点是 50%——9 栋楼里坏 4 栋就已经在边缘。这是外部辐照存在的**唯一强理由**（见 §5.5）。
> ② **一直就差的楼。** 抛光只看**变化**，看不见**水平**。某栋一年前就衰减 12% 并稳定至今
> → 全部被 α(s) 吸收 → 残差居中 → **永远检不出来**。见 §5.6。

### 5.3 显著性 —— 用块自助，不用 √N

> **√N 是这套方法最大的数学错误。** 光伏日残差自相关 ρ≈0.3–0.6，方差膨胀 (1+ρ)/(1−ρ)。
> ρ=0.5 时你以为 p=0.05，**实际 p=0.25**；ρ=0.7 时实际 0.42。
> `z = r̄·√N/σ` + `p = 2(1−Φ)` 会让 p 值乐观 **1–3 个数量级**。

```ts
/** 稳健尺度：用**一阶差分**估噪声，对阶跃和慢漂移几乎免疫。
 *  直接对 r 取 MAD 的话，基线若含故障期 → 分子 r̄ 被拉小、分母 σ 被撑大 → 双杀，
 *  结果是**越坏的楼越不报警**，检测器对最严重的资产最沉默。 */
export function robustSigma(r: number[]): number {
  const d = r.slice(1).map((v, i) => v - r[i])
  return 1.4826 * median(d.map(Math.abs)) / Math.SQRT2
}

/** 跨栋收缩 + 下限。13 栋是免费信息；下限防电表读数取整导致 MAD=0 → z=∞。 */
export function shrinkSigma(sigmaS: number, sigmaPool: number, floor: number): number {
  return Math.max(Math.sqrt(0.5 * sigmaS ** 2 + 0.5 * sigmaPool ** 2), floor)
}

/** 循环分块自助：块长 = 去相关时间的 2~3 倍(光伏取 14~21 天)。
 *  一套机械同时吸收自相关、异方差、非正态。**单侧** —— 发电偏高几乎从不是故障，
 *  正侧偏离归类为「数据质量告警」(表重复计量/容量台账错/镜像伪影)，不是性能告警。 */
export function blockBootstrapP(
  baseline: number[], obsMean: number, winLen: number,
  opts: { block?: number; B?: number; seed?: number } = {},
): { p: number; nullDist: number[] }
// p = (1 + #{null <= obsMean}) / (B + 1)   ← 两处 +1 不是洁癖：
//     省掉会得到 p=0，而 p=0 会让后面的 BH 排序失去意义

/** Benjamini–Hochberg。注意族的大小：不是 13 个检验，是 13栋 × 窗口数 × 统计量数。
 *  **预注册**每栋一个主窗口 + 一个主统计量，其余标为描述性、不参与判定。 */
export function bhFdr(pvals: number[], q = 0.05): boolean[]
```

> **⚠ 主统计量 = 变点检验，不是「最后 N 天窗口 vs 整条基线」（2026-08-31 落地时改）。**
> 设计稿只说「对 baseline 做 B 次循环分块重采样」，没说 baseline 取哪一段。取整条序列有一个致命形态：
> **故障一旦占掉大半观测期**（7/19 起坏、看到年底 = 45% 的日子），中位数抛光把那个水平吸进 α，
> 而基线里也全是故障期 —— 观测窗口一点都不「极端」，p 反而不小，屏上不点灯。
>
> 这正是本节就 σ 已经警告过的同一个形态：「基线若含故障期 → 双杀 →
> **越坏的楼越不报警，检测器对最严重的资产最沉默**」。σ 那里避开了，baseline 这里又会踩一遍。
>
> 变点检验对它免疫：一次扫遍所有切分点，不需要事先知道哪段是「正常」，
> 且 max\|t\| 的零分布本来就用循环分块置换算过，选择效应已经校准。
> 每栋只此一个统计量（预注册），窗口自助降为**描述性**，工作台并排展示，不参与判定。
>
> 实测（`pvMeterAnaScreen.spec.ts` 的整年夹具，S4 从 7/19 掉 35%）：
> 变点 `index=199`（= 7/19）、`p=0.005`、`dropPct=35.0` → risk；
> 换回窗口口径 → 同一份数据判不出来，只能靠先天缺陷通道兜成「一直偏低」，
> 情况栏会写成「一直偏低,不是新问题」—— **把突发故障说成先天缺陷，派错人**。

### 5.4 变点与形状

```ts
/** 单变点扫描。max|t| **不服从 t 分布**(是布朗桥型极值分布)，直接查 t 表虚警率从 5% 飙到 40%+。
 *  零分布用**循环分块置换**——逐日置换会摧毁自相关，零分布被压得过窄，比不置换还激进。
 *  两端修剪 15%，用**合并方差**不用 Welch(短段方差估计不稳，边界直接爆)。 */
export function changePoint(r: number[], opts: { block?: number; B?: number; trim?: number }): {
  index: number
  ciLo: number; ciHi: number    // ← **必须给区间**。argmax 有赢家诅咒，中等效应下 95% CI 常有 ±3~4 周
  p: number
  dropPct: number               // 去偏：奇数日找变点、偶数日估落差(样本分割)
}

/** 形状判定。**别指望变点算法回答形状** —— 拟一个小形状库，同一条残差上比 BIC。 */
export type Shape = 'flat' | 'step' | 'ramp' | 'sawtooth' | 'spike'
export function classifyShape(r: number[], rainDays: boolean[]): { shape: Shape; bic: number }
```

| 形状 | 统计特征 | 建议动作（写进「建议」列） |
|---|---|---|
| `step` | 变点 p<0.01，变点后斜率≈0 | 现场检查 —— 设备级故障（逆变器/开关/某一路断） |
| `ramp` | 显著负趋势，无变点，**雨后不回弹** | 测直流侧压降；看现场遮挡 |
| `sawtooth` | 负趋势 + **降雨日之后显著跳升** | 可安排清洗 —— 灰尘积累 |
| `flat` | 无趋势无变点，但 α 长期偏低 | **先核对装机容量台账**（见 §5.6） |
| `spike` | 单点 \|z\| 极大，前后正常 | 对运维台账，多半不是设备问题 |

### 5.5 外部锚（有辐照时）

```ts
/** 全园健康度。**必须在 log 域做差，不是比值** ——
 *  比值分母趋零时 Cauchy 化，没有有限矩，均值方差正态近似全部失效。 */
export function parkHealth(polish: PolishResult, weather: WeatherDay[]): { date: string; logH: number }[] {
  return weather.filter(w => polish.beta.has(w.date) && w.ghiKwh > 0)
    .map(w => ({ date: w.date, logH: polish.beta.get(w.date)! - Math.log(w.ghiKwh / 1000) }))
}
```

β(d) 是从 13 栋自己算出来的，全园同步劣化时基准跟着一起掉。**`logH` 的趋势是唯一能看见「大家一起在变差」的通道。**

配套必做**辐照源自检**：晴空指数 `kt = GHI / GHI_clearsky` 的 95 分位在健康时应稳定贴近 1.0；
逐月下滑 = **数据源脏了不是电站坏了**。约 15 行，能挡掉全链路最丢人的一类误报。

### 5.6 先天缺陷通道（独立于日常告警）

```ts
/** α 排序 = 一张验收检查表。持续偏低的 α 是「疑似先天缺陷」，**不是**突发故障。
 *  两者派给不同的人：先天缺陷派工程师核图纸，突发异常派运维上屋顶。 */
export function congenitalCheck(polish: PolishResult, stations: StationCfg[]): {
  name: string; alphaPct: number; ciLo: number; ciHi: number; suspect: boolean
}[]
```

> **运维一号陷阱**：**α 长期垫底最常见的原因不是设备坏，是装机容量台账写错。**
> cap 少写 10%，α 就永远偏 10%，派人上去查三次查不出东西，第四次就没人理这系统了。
> 所以 `flat + α 偏低` 的建议文案**必须是「先核对装机容量台账」**，不是「现场检查」。
>
> CI 必须用**块自助**算。naive SE 在 σ≈8%、365 天下约 0.4%，13 个点的 CI 互不重叠，
> 图上会显示「每栋楼都显著不同」，用户第一反应是「你这系统天天报警」。
> 实测比值：纯 AR(1)（ρ=0.5）上块自助/naive ≈ 1.5（接近理论 √3=1.73），
> 但**抛光后**的残差只剩 ≈1.26 —— 逐日中位数 β 已经吸走一部分共同结构，教科书那个 1.7 在这里达不到。

> **两条落地时补的（2026-08-31）**
>
> **① 重采样前必须把残差中心化。** 抛光锚的是残差**中位数**为 0，不是均值。
> 带阶跃的站残差是「一段 0、一段负」，均值明显偏离 0 —— 不减掉的话整个区间会漂到 `α + mean(resid)`，
> 出现「点估计 0%，区间 −23%~−12%」这种**区间不包含自己点估计**的东西，工作台 α 排序图上一眼假。
>
> **② 先天缺陷的钱要按园区中位水平算，且同样过黄灯金额门槛。**
> 缺口 = 应发 − 实发，而「应发」用的就是该站自己一贯的水平 ——
> **一直偏低的站算出来缺口恒等于 0**，这正是这条通道存在的理由。
> 这里问的是另一个问题：「这栋楼要是达到园区一般水平，一年能多发多少钱」：
> `年缺口 = 年发电量 × (exp(median(α) − α) − 1) × 自用电价`。
> 算出来的钱要过 `WATCH_ANNUAL_GAP` —— 否则「统计上比中位低一点」的那一大批全会点黄灯，
> 就是 §5.7 那条规则本来要防的误报洪水。

### 5.7 换算成钱

```ts
/** 缺口金额 = 应发 − 实发，按**自用电价**折算 —— 少发的那度要从电网买回来，
 *  损失的是自用电价(0.7~1.2元分时)，不是上网标杆价(0.39元)。搞错了整屏的数就是错的。 */
export function gapMoney(expectedKwh: number, actualKwh: number, selfUsePrice: number): number {
  return Math.max(0, expectedKwh - actualKwh) * selfUsePrice
}

/** 亮灯的三重门槛。**显著性只是入场券，金额才是排序键，金额门槛才是过滤器。** */
export const RISK_ANNUAL_GAP = 5000
export const WATCH_ANNUAL_GAP = 2000   // ← 落地时补，见下

export function alertLevel(x: { q: number; days: number; annualGap: number }): 'risk' | 'watch' | 'ok' {
  if (x.q < 0.05 && x.days >= 14 && x.annualGap >= RISK_ANNUAL_GAP) return 'risk'
  if (x.q < 0.20 && x.days >= 7 && x.annualGap >= WATCH_ANNUAL_GAP) return 'watch'
  return 'ok'
}
```

> **本项目最重要的一条产品规则**：一个统计上 q=0.001 但年化只差 ¥800 的变点，**绝不该出现在屏上**。
> 13 栋楼之间 2% 的 α 差异在一年数据下就「统计显著」，但那可能只是朝向差异。
> **「运维平台是被误报杀死的，从来不是被漏报杀死的。」**

> **⚠ 黄灯也必须有金额门槛（2026-08-31 落地时补）。**
> 设计稿的判定里只有红灯带金额条件，黄灯是 `q < 0.20 && days >= 7`。
> 于是上面那句自己举的例子（q=0.001、年化 ¥800）会落到 `watch` → 点亮「需关注」灯 →
> **照样出现在屏上**，与「绝不该出现在屏上」直接打架。
> 黄灯没有下限，等于把「统计上看得见但没人会去管」的那一大批全放进屏里，
> 正是这条规则要防的误报洪水。
>
> `WATCH_ANNUAL_GAP` 暂定 **¥2,000/年 ≈ ¥170/月**（低于此数没人会为它派工）。
> 这个数**可调，但不能没有**；调它等于调「屏上有多少盏灯」，属业务口径，改前先确认。

---

## §06 页面

`<AnaShell period-mode="year" :compare="CMP">`，`CMP = ['yoy']`（**模块级常量**，与传给 AnaShell 的必须同一份）。

> **AnaShell 的四条硬约束（实测，不是猜的）**
> ① `periodMode='year'` 不写穿粒度单例。屏只能读 `period.sel.value.year`，
> 读 `gran`/`month` 会拿到与界面无关的值，`AnaShell.spec.ts:35` 有断言守着。
> ② `#kpis` 槽的 `v-if` 必须写在 `<template #kpis>` 的**内层**——挂在 template 标签上条件为假会让
> `$slots.kpis` 不存在，容器整条消失、下方内容整体上移。
> ③ `AnaEChart` 的 `height` **只许取 170 / 200 / 250 / 300 / 440** 五个值（`AnaEChart.vue:77`，2026-08-20 立）。
> ④ ECharts option 是纯 JSON，**不能引用 CSS 变量**，颜色只能写字面值。

### 6.1 第一层 · 卡片 + 表 + 一张图（一屏不滚动）

工具条：期间（年）· 对比（同比）· `☐ 显示技术指标` · `导出月报`。

**四张 KPI 卡**

1. **本月光伏收益** ¥ · 环比/同比 · 「自用 X 度×单价 + 上网 Y 度×0.391」· `查看电价口径 ›`
2. **本月比应得少** ¥（warn 色）· 「相当于少发 N 度 · 占应得 M%」· 「主要来自 C座 ¥…、G座 ¥…」· `这个数怎么来的 ›`
3. **楼栋状态** 四灯计数（正常/需关注/异常/数据不全），点击筛下方列表
4. **投资回收** % + 进度条 · 累计/总投资 · 预计回本月

**楼栋明细表**（主体，按缺口金额降序，点行下钻）：
`楼栋 | 状态 | 本月收益 | 本月缺口 | 相对园区 | 情况 | 建议`
表头右侧 hint 报出：`N 站已装表 · N 站未录容量 · N 站未装表`。

**一张图**：近 13 个月，柱=发电量、实线=实际收益、虚线=应得收益，末月标注缺口。`height=200`。

#### 三段必须写死的文案

**①「这个数怎么来的」—— 整个设计的地基。一字不要改：**

> 同一天，园区 13 栋楼晒的是同一片太阳。我们用其余 12 栋当天的表现，推算出「今天这个天气应该发多少」，
> 再乘上这栋楼一贯的水平，得到它今天应发多少度。实际比应发少的部分，就是缺口。
>
> **这个办法的好处**：不需要装气象仪，也不受阴天晴天影响——天不好，13 栋一起少发，不会被算成缺口。
>
> **它看不出来的**：如果 13 栋楼**同时**变差（比如全都该洗了），会被当成「天气不好」。
> 这一项我们用外部气象数据每季度校一次。

用户一定会问「你凭什么说 C 栋应该发更多」。答不上来这屏就废了。「对数双因子模型中位数抛光」不是答案，上面这段才是。

**②「查看电价口径」**（数值按当月结算单填）：

> 本月自用电按园区实际分时电价加权 **0.86 元/度**（峰 1.21 / 平 0.72 / 谷 0.38，按光伏各时段出力占比加权）。
> 上网电按脱硫煤标杆价 **0.391 元/度**。电价取自 YYYY-MM 电费结算单，**与财务账套口径一致**。

**③ 四盏灯的定义 —— 写在灯旁边，不能只写在帮助里**

- ● 正常 —— 发电量与这栋楼一贯水平一致
- ● 需关注 —— 连续偏低，但幅度不大或时间不长，还不能确定
- ● 异常 —— 连续偏低且幅度大，基本可以确定不是天气原因
- ● 数据不全 —— 本月抄表缺失较多，不做判断

再加一行：**「这套判断平均一个月误报不到 1 次。」** 这句比 `q<0.05` 有用一百倍。

#### 不确定性怎么说

非专业者会把 95% CI 读成「最大值和最小值」（固定误读）。但**完全不给不确定性反而更糟**——
含糊的非量化表述显著降低可信度，而**语言标签 + 数值区间**不损害可信度甚至提升。

- ✅「基本可以确定不是天气造成的（约 9/10 把握）」、「年化缺口约 ¥6–8 万」
- ❌ 第一层永不出现：`p`、`q`、`±2σ`、「95% 置信区间」、「显著」、`PR`、`α`、`β`、`kWh/kWp`、「等效利用小时」、「残差」、「归一化」

### 6.2 第二层 · 单栋详情

从表行点进来，**同一个 URL 加锚点，不是另一套页面**。未选中站时整区不渲染（不是渲染空态）。

| # | 内容 | span | 说明 |
|---|---|---|---|
| 1 | **累计缺口曲线**（纵轴=元） | `s12 · h300` | **折点**=开始变差（比竖线更自然，不用解释）｜**斜率**=元/天（可口算「再拖一个月多少钱」）｜**终点**=至今一共亏多少（决策唯一需要的数） |
| 2 | 发电量 vs 园区基准散点，变点前后分色双拟合 | `s6 · h250` | 标题写人话：「7 月中旬之后，同样天气下 C 栋比以前少发 21%」 |
| 3 | 该栋 13 个月月度网格 + 逐日明细表（可导出） | `s6` | 财务要能把数字抄进报告 |
| 4 | 残差时序 + ±2σ 带 + 趋势线 | 折叠 | 收在「显示技术细节」开关下。y 轴写「每天比应发少多少度」，±2σ 改名「正常波动范围」 |

变点标注必须同时写区间：`折点 · 7 月中旬` + `区间 7/11–7/26 — 不是精确到天`。

### 6.3 第三层 · 方法与口径页

财务不看，但**它存在这件事本身就让人更信任这屏**。审计和承包商要看。必须包含：
模型公式、抛光迭代与收敛、BH-FDR、变点算法与三重门槛，以及**数据质量记录**：

> 本月共 31 天，有效 29 天。剔除 2 天：8月14–15日 C 栋电表通信中断（该栋当日不计入基准，其余 12 栋正常）。
> 参与基准计算的楼栋数：29 天中 27 天为 13 栋，2 天为 12 栋。

不暴露这一层，所有数字不可审计，**财务不会认**。

### 6.4 分析工作台

受众是系统所有者、审计、承包商 —— **不为可读性做任何妥协**。入口在第三层之后，或直接 `/pv-meter-analysis#lab`。
**刻意不在第一层露面**：财务主管一进去看见 z 值和 ACF 图，会认定「这屏不是给我用的」，连第一层也不再打开。

| 组 | 图 | 防住什么 |
|---|---|---|
| **A · 模型输出** | α 排序点图 + **块自助** CI | naive SE 会窄到 13 个点互不重叠，图上显示「每栋都显著不同」 |
| | 残差 z 热力图（13 × 日 / 周可切） | 横条=某栋某段坏了；竖条=那天全园低（天气或抄表批次） |
| | 发电量 vs 基准散点 + 双拟合 | 行业正式名 Yf–Yr 散点，斜率即捕获水平 |
| | 残差时序 + 趋势 + 变点 + ±2σ | 形状诊断原始视图 |
| | 完整检验表 | α / z / p / q / **N_eff** / σ 估计方式 / 变点 CI / 形状 BIC / 有效日数 |
| **B · 模型诊断（必做）** | **残差 ACF**（每栋 lag 0–30） | 直接体检 √N 错多少，读出 N_eff |
| | **残差 vs 年积日** | **上线前必做**。有稳定年周期 = 模型缺项（季节性遮挡），**不是故障**。不做这个春秋各刷一批假变点 |
| | **块自助零分布 + 观测值** | 让 p 值可视化，比一个 p=0.003 可信 |
| | **抛光收敛诊断** | 行优先/列优先各跑一次，**排名翻转 = 该结论不稳，不上报** |
| | **数据质量矩阵**（13 × 日） | 色=正常/缺失/剔除/**补齐**。防「补齐格残差恒为 0 → 离线 10 天算出正常」 |
| **C · 外部锚** | **logH 全园健康度** | 补唯一的结构性盲区 |
| | **晴空指数 kt 上包络** | 数据源自检 —— kt 逐月下滑 = 源脏了不是电站坏了 |
| | **注入式破坏检出率曲线** | **阈值从曲线上读，不是拍脑袋 q=0.10** |

> **工作台唯一的铁律：一份数据、一次计算、一个 snapshot id。**
> 一次计算产出一个结果对象，第一层渲染它的 `summary` 视图，工作台渲染它的 `full` 视图，
> 两边共用同一个 snapshot id 并都显示在页脚。**工作台永远不是另一次计算。**
> 对不上的时候要能在 30 秒内定位到是哪一层渲染错了，而不是怀疑模型。

---

## §07 护栏

每一条都必须显式暴露，不许静默处理。这是本产品既有的文化，也是财务肯认数的前提。

| 情形 | 处理 | 为什么不能静默 |
|---|---|---|
| 该栋没装光伏表 `metered=0` | 抄表屏显灰「未装表」+ 容量单价禁用 + 不开抽屉；分析屏整站不出现 | 与「漏抄」是两回事：前者永久不用管，后者要催人 |
| 站未录装机容量 | 不入任何分析，卡片脚注列名 | 无容量算不出 eff，混进去会污染 β̂ |
| 当日参与站 < 8 | **当天整屏降级**为「仅同比，不做同类比较」并明确告知 | 4 栋掉线就能污染中位数 β，导致全园当天集体误报 |
| 天气**整点有内部空洞** | 该日剔除，KPI 报出剔除天数 | 日累计 GHI 偏低会把当天所有站判成异常 |
| 低出力日 | 阈值**只打在 GHI 上**，剔除天数必须报出 | 打在 gen 上 = 优先删除故障楼的故障日 |
| 某站有效日 < 20 | 状态显「**样本不足**」，不出结论 | 显「正常」就是假绿，**这里最容易出** |
| 只有月抄的站 | 降级月频卡，标注「月频口径」，**不与日频站混排** | N=12 与 N=247 的置信区间差一个量级 |
| 上一年无抄表 | 同比位显 `—`，不显 `0%` | 0% 意味着「持平」，—— 意味着「没得比」 |
| 同比跨年月份不齐 | 按**两年都有抄表的月**对齐后再比，报出参与月数 | 2025 全年 vs 2024 的 5 个月，整年求和虚高 100%+ |
| 整年无抄表 | 整屏 `AnaEmpty` 深链 `/pv-income` | 既有护栏范式，不画假图 |

---

## §08 验收

### 前置：模拟器必须改，否则无法验收

`PvMeterService.simulateDays`（:246-264）与它的调用方（:211-239）有两处结构性质，正好把要检测的信号全部抹平：

```java
// ① 日权重种子含站 id → 每站的"天气"互相独立，根本没有共享的 β(d)   (:249)
Random rnd = new Random(st.getId() * 100000L + month1.getYear() * 100L + month1.getMonthValue());

// ② phase 月量按容量占比拆到站 → self(s) ∝ cap(s)，于是                (:230-235)
eff(s) = gen(s)/cap(s) → 同 phase 同期内所有站恒等
```

后果：**α̂ 期内恒为 1，残差是纯独立噪声，任何检验都通不过。**
不改的话新屏永远显示「全部正常」——一块**无法区分「真没事」和「算错了」**的绿。

可立刻自查的现象：现在 `PvRoiView` 的「各站发电效率」柱图在模拟数据下应呈现
**三段各自持平的台阶**（一期五根等高、二期六根等高、三期两根等高）。

> **⚠ 设计稿的写法只做对了一半（落地时实测，2026-08-31）。**
> 设计稿把种入故障写成 `w[d] *= 0.72`，只打在日权重上。**这样故障出了当月就完全看不见**：
> `self_d = 月量 × w_d/Σw`，整月同乘一个数分子分母对消。
> 8 月起 F 座又是一片绿，§08 验收 ① 的「必须被判为 risk」永远过不了。
> （已由 `PvMeterSimulateApiIT.simulate_种入的F座阶跃在故障后的整月里持续可见` 逐条破坏验证：
> 去掉拆分权重上的故障系数 → 该条转红，而「当月内阶跃」那条仍绿。）
>
> 正确做法是**两处都打**，且两个系数必须自洽：

```java
// ① 站间拆分权重 = 容量 × 种入故障「月系数」——让水平持续掉下来。
//    F 座少拿的那份由同期其余站分掉，Σ全站 仍等于 phase 月真实值，月度恒等不破。
Map<Integer, BigDecimal> splitW = phaseSts.stream().collect(Collectors.toMap(
    PvStation::getId, s -> s.getCapacityKwp().multiply(faultMonth(s, month1))));

// ② 日权重 = 全园共享天气因子 × 站内小扰动 × 种入故障「逐日系数」——让 7/18 那一跳在当月内看得见。
Random park = new Random(year * 100L + month);        // ← 不含站 id：全园共享天气
Random site = new Random(st.getId() * 100000L + year * 100L + month);
w[d] = (0.55 + park.nextDouble() * 0.9)     // β(d) 天气共因
     * (0.92 + site.nextDouble() * 0.16)    // 站内小扰动
     * faultDay(st, month1.withDayOfMonth(d + 1));

// 逐日系数：F 座 7/18 之后 0.72，其余 1.0
// 月系数 = 逐日系数的**月内均值**（7 月 = (18 + 13×0.72)/31 ≈ 0.8826）
```

> **月系数必须是逐日系数的月内均值，不能图省事写成常数 0.72。**
> 两者相乘后，故障前的日恰好回到正常水平、故障后的日恰好是 0.72 倍；
> 写成常数的话 7 月前半月会被垫高 13%，变点扫描量出来的落差就是错的。
>
> `simulateDays` 现有的「末日补差保 Σ日=月真实值分毫不差」必须保留 —— 月度恒等口径是既有断言。
> 改的只是权重的来源，不是分配机制。`note` 在故障月追加「含种入故障(F座 7/18 起 −28%,仅供检测验收)」；
> 既有断言用的是 `startsWith` + `contains`，追加后缀安全。

### 验收标准

1. **种入故障能被检出** —— F 座的 −28% 阶跃必须被判为 risk；**变点日期落在种入日 ±3 周内即算通过**（不是 ±3 天，argmax 的 CI 本来就有那么宽）。
2. **健康站不误报** —— 其余站在 q=0.05 下不得出现 risk。跑 12 个月，全年误报总数 ≤ 1。
3. **逐条破坏验证** —— 每个断言逐条注掉/改反，确认它真的会红。**前置不足 = 假绿**——尤其是「有效日 < 20 不出结论」和「参与站 < 8 降级」这两条。
4. **ACF 诊断有输出** —— 工作台的残差 ACF 必须画得出来（每栋 lag 0–30，ρ₀=1）。

   > **⚠ 原文的「且 ρ₁ 非零，否则说明模拟器的共享天气因子没生效」对着模拟数据不成立，方向还反了。**
   > 共享天气因子**生效**时，β 恰好把它整个吸走，剩下的残差就是站内那份逐日独立的小扰动，
   > ρ₁ 本来就该 ≈0。ρ≈0.3–0.6 是**真实**残差的性质（§5.3），来自积灰、气象模型误差这些
   > 现实世界的慢过程 —— 模拟器里没有它们。拿它当验收项，会逼人把模拟器改成「造得出自相关」，
   > 那是为了过验收而造假数据。
   >
   > 真正要验的是**共享天气因子到底生效没有**，直接量：**β 的方差应当远大于残差方差**
   > （实测约 13 倍）。种子若含站 id（改造前），各站各晒各的太阳，β 是一堆独立序列的中位数、
   > 趋近常数，天气就留在残差里，两者方差会拉平。
   > 落在 `pvMeterAnaAccept.logic.spec.ts` 的「④ 共享天气因子确实生效」。
5. **两层数字一致** —— 随机抽 3 个月，第一层的「本月缺口」与工作台逐站缺口求和必须**分毫不差**，且 snapshot id 相同。
6. **护栏可见** —— 人为删掉某站某月 11 天抄表 → 该站状态必须是「数据不全」灰灯，不是「正常」绿灯。
7. **权限** —— `PermissionCoverageTest` 绿；viewer 账号 GET 通、POST `/api/weather/import` 得 403。
8. **导航与路由计数** —— `fpNav.spec.ts` 的屏数断言 50 → 51（三处）；`routeMap.spec.ts` 绿。

---

## §09 文件清单

### 新建 · 后端

| 文件 | 内容 |
|---|---|
| `resources/db/migration/V117__weather_hour.sql` | §02 |
| `resources/db/migration/V118__pv_station_metered.sql` | §02 |
| `resources/db/migration/V119__weather_switch_params.sql` | §02 |
| `java/com/park/demo3/entity/WeatherHour.java` | §03.1 |
| `java/com/park/demo3/mapper/WeatherHourMapper.java` | 日聚合 SQL 在这里 |
| `java/com/park/demo3/dto/WeatherDayDTO.java` | record |
| `java/com/park/demo3/dto/WeatherImportRequest.java` | record + 内嵌 Row |
| `java/com/park/demo3/service/WeatherService.java` | 导入 + 日聚合 |
| `java/com/park/demo3/controller/WeatherController.java` | 两个端点 |
| `test/java/.../api/WeatherApiIT.java` | 导入幂等 + 日聚合口径 + 权限 |

### 新建 · 前端

| 文件 | 内容 |
|---|---|
| `src/api/weather.ts` | `weatherApi.daily(year)` |
| `src/utils/weatherExcel.ts` | 解析 + 模板列 |
| `src/utils/weatherExcel.spec.ts` | 别名/单位后缀/非法行 |
| `src/views/analysis/PvMeterAnaView.vue` | 三层 + 工作台 |
| `src/views/analysis/pvMeterAna.logic.ts` | 全部公式，见 §05 |
| `src/views/analysis/pvMeterAna.logic.spec.ts` | 每个函数配已知答案夹具 |

### 修改

| 文件 | 改什么 |
|---|---|
| `java/.../service/ParamRegistry.java` | `static{}` 里三行 + `WEATHER_SOURCE_OPTS` + 新建 `S_GLOBAL_ONLY` |
| `java/.../security/PermissionRegistry.java` | 一行 `add(null, "/api/weather/**", Perm.METER_READING_EDIT)` |
| `java/.../service/PvMeterService.java` | `simulateDays` 拆共享天气因子 + 种入故障 |
| `frontend/src/utils/paramRegistry.ts` | `PARAM_DEFS` 同位插三项 |
| `src/views/pv/PvMeterView.vue` | 未装表行：灰徽标 + 禁用 + 不开抽屉 |
| `src/views/analysis/PvRoiView.vue` | 删抄表区（468 → ~230 行）+ 删 import |
| `src/views/analysis/pvRoi.logic.ts` | 删迁走的 4 个函数与类型（:76-163） |
| `src/views/analysis/pvRoi.logic.spec.ts` | 对应断言迁到新 spec |
| `src/utils/importRegistry.ts` | 加 `key='weather'` 条目 |
| `src/utils/importRegistry.spec.ts` | :28 的 key 清单加 `'weather'`，24 → 25 |
| `src/nav/fpNav.ts` | 「专题分析」组加 `pv-meter-analysis`；:1 头注释 49 → 51 |
| `src/nav/__tests__/fpNav.spec.ts` | 屏数 50 → 51（:5 文案 + :7 + :11） |
| **`src/router/index.ts`** | **`VIEWS` 表加一行** `'pv-meter-analysis': () => import('@/views/analysis/PvMeterAnaView.vue')` |

**零改动**：`GET /api/pv-meter/readings?year=`（month 可空 = 全年）已在能源分析那一刀放开，本刀不动后端抄表接口。

---

## §10 设计稿与仓库现状的四处出入

设计稿写于对话中，落库前逐条实测过。以下四条**以本文件为准**：

1. **路由不是自动派生的。** 设计稿说「路由由 `fpBuildRoutes()` 派生，加 nav 项即自动有路由」——**错**。
   `frontend/src/router/index.ts` 有一张显式的 `VIEWS` 表，`fpBuildRoutes()`（`fpNav.ts:86-90`）只产 meta 不产组件。
   漏配这一行，该屏**静默降级成 `PlaceholderView`**，并且 `router/routeMap.spec.ts:11` 会红
   （「导航每一屏都有路由且挂到了组件」）。DEV 下 `index.ts:79-83` 还会 `console.warn` 两侧差集。
2. **fpNav 没有「能源专题」组。** 分析层第 3 组叫**「专题分析」**（`fpNav.ts:60`），`pv-roi` 就在里面（:66）。
   新屏排在 `pv-roi` 之后。
3. **`fpNav.ts:1` 的头注释写的是「49屏×4层」，已经过时**（实际 50）。加屏时一并改成 51。
4. **行号漂了两行**：`importRegistry.ts` 的 `pvMeter` 条目在 :559-583（设计稿写 :558-582）；
   `importRegistry.spec.ts` 的 key 清单断言在 :28，文案是 `has the 24 expected keys`（设计稿写 :32）。

此外 `S_GLOBAL_ONLY` 在 `ParamRegistry` 中**尚不存在**（现有 `S_GLOBAL_ZONE` / `S_ZONE` 等 8 个，:30-37），本刀新建。

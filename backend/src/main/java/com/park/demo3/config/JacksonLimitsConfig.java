package com.park.demo3.config;
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.Module;
import com.fasterxml.jackson.databind.deser.std.NumberDeserializers;
import com.fasterxml.jackson.databind.module.SimpleModule;
import org.springframework.context.annotation.*;
import java.io.IOException;
import java.math.BigDecimal;

/**
 * 请求体里所有 BigDecimal 的指数上限(安全审计 G3a)。
 *
 * {@code 1e600000000} 反序列化很便宜(非标度值 1、scale -6 亿),但入库时 Connector/J 对 DECIMAL 调
 * toPlainString(),一个值就生成 6 亿个字符、吃掉约 1GB 堆 —— 有任一写权限的账号几个请求就能把单实例打到 OOM。
 * 位数不用另管:Jackson 默认 maxNumberLength=1000,超长的数字串在这之前就被拒了。
 *
 * |scale| ≤ 100 远宽于任何业务值:前端浮点残差如 5.55e-17 的 scale 约 32,不能拒;要拒的是上百万级的指数。
 * 拒掉的请求由 GlobalExceptionHandler 的 HttpMessageNotReadableException 那支回 400。
 */
@Configuration
public class JacksonLimitsConfig {
    static final int MAX_ABS_SCALE = 100;

    @Bean Module boundedBigDecimal() {
        return new SimpleModule("bounded-big-decimal").addDeserializer(BigDecimal.class, new Bounded());
    }

    static final class Bounded extends NumberDeserializers.BigDecimalDeserializer {
        @Override public BigDecimal deserialize(JsonParser p, DeserializationContext ctx) throws IOException {
            BigDecimal v = super.deserialize(p, ctx);
            if (v != null && Math.abs((long) v.scale()) > MAX_ABS_SCALE)
                return (BigDecimal) ctx.handleWeirdNumberValue(BigDecimal.class, v, "数值的指数超出范围");
            return v;
        }
    }
}

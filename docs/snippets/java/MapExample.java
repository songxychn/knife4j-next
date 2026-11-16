import java.util.Map;
import io.swagger.v3.oas.annotations.media.Schema;

public class MapExample {
    // #region field
    @Schema(description = "扩展属性", additionalPropertiesSchema = String.class)
    private Map<String, String> extensions;
    // #endregion field
}

/*
 * Copyright © 2017-2023 Knife4j(xiaoymin@foxmail.com)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */


package com.github.xiaoymin.knife4j.smoke.boot4;

import com.github.xiaoymin.knife4j.annotations.ApiSupport;
import com.github.xiaoymin.knife4j.spring.annotations.EnableKnife4j;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.ArraySchema;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;
import org.junit.After;
import org.junit.Assert;
import org.junit.Test;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.SpringBootConfiguration;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;

public class Boot4JakartaDocHttpSmokeTest {

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    private ConfigurableApplicationContext context;

    @After
    public void closeContext() {
        if (context != null) {
            context.close();
        }
    }

    @Test
    public void shouldServeDocHtmlOpenApiJsonAndSwaggerConfig() throws IOException {
        context = new SpringApplicationBuilder(TestApplication.class)
                .web(WebApplicationType.SERVLET)
                .properties(
                        "server.port=0",
                        "knife4j.enable=true",
                        "logging.level.root=ERROR")
                .run();

        int port = context.getEnvironment().getRequiredProperty("local.server.port", Integer.class);

        HttpResponse docHtml = get(port, "/doc.html");
        Assert.assertEquals(200, docHtml.statusCode);
        Assert.assertTrue(docHtml.body.contains("webjars/knife4j-ui-react/"));

        HttpResponse apiDocs = get(port, "/v3/api-docs");
        Assert.assertEquals(200, apiDocs.statusCode);
        Assert.assertEquals("3.1.0", OBJECT_MAPPER.readTree(apiDocs.body).path("openapi").asText());
        Assert.assertTrue(apiDocs.body.contains("/hello"));
        Assert.assertTrue(apiDocs.body.contains("/api/user/list"));
        Assert.assertTrue(apiDocs.body.contains("/api/user/page"));
        Assert.assertTrue(apiDocs.body.contains("/api/user/{id}"));
        Assert.assertTrue(apiDocs.body.contains("用户接口"));
        Assert.assertFalse(apiDocs.body.contains("/knife4j/config"));

        HttpResponse swaggerConfig = get(port, "/v3/api-docs/swagger-config");
        Assert.assertEquals(200, swaggerConfig.statusCode);
        Assert.assertTrue(swaggerConfig.body.contains("/v3/api-docs"));

        HttpResponse knife4jConfig = get(port, "/knife4j/config");
        Assert.assertEquals(200, knife4jConfig.statusCode);
        Assert.assertTrue(knife4jConfig.body.contains("\"schemaVersion\""));
        Assert.assertTrue(knife4jConfig.body.contains("\"openapi\""));
        Assert.assertTrue(knife4jConfig.body.contains("\"apiDocsUrl\""));
        Assert.assertTrue(knife4jConfig.body.contains("v3/api-docs"));
        Assert.assertTrue(knife4jConfig.body.contains("\"swaggerConfigUrl\""));
        Assert.assertTrue(knife4jConfig.body.contains("v3/api-docs/swagger-config"));

        HttpResponse legacyConfig = get(port, "/knife4j/swagger-config");
        Assert.assertEquals(404, legacyConfig.statusCode);
    }

    @Test
    public void shouldExposeExplicitOas31CompatibilityMatrix() throws IOException {
        context = new SpringApplicationBuilder(Oas31MatrixApplication.class)
                .web(WebApplicationType.SERVLET)
                .properties(
                        "server.port=0",
                        "knife4j.enable=true",
                        "springdoc.api-docs.version=OPENAPI_3_1",
                        "logging.level.root=ERROR")
                .run();

        int port = context.getEnvironment().getRequiredProperty("local.server.port", Integer.class);

        HttpResponse docHtml = get(port, "/doc.html");
        Assert.assertEquals(200, docHtml.statusCode);
        Assert.assertTrue(docHtml.body.contains("webjars/knife4j-ui-react/"));
        Assert.assertEquals(200, get(port, "/webjars/knife4j-ui-react/assets/index.js").statusCode);

        HttpResponse runtimeConfig = get(port, "/knife4j/config");
        Assert.assertEquals(200, runtimeConfig.statusCode);
        Assert.assertTrue(runtimeConfig.body.contains("\"apiDocsUrl\""));

        HttpResponse apiDocs = get(port, "/v3/api-docs");
        Assert.assertEquals(200, apiDocs.statusCode);
        JsonNode document = OBJECT_MAPPER.readTree(apiDocs.body);
        Assert.assertEquals("3.1.0", document.path("openapi").asText());
        Assert.assertFalse(document.path("paths").path("/oas31/search").path("get").isMissingNode());
        Assert.assertFalse(document.path("paths").path("/oas31/json").path("post").isMissingNode());
        Assert.assertFalse(document.path("paths").path("/oas31/raw-binary").path("post").isMissingNode());
        Assert.assertFalse(document.path("paths").path("/oas31/multipart").path("post").isMissingNode());
        assertOas31MatrixContract(document);
        assertMatchesOas31Fixture(document, "boot4-mvc-springdoc-3.0.3.json", port);
    }

    @Test
    public void shouldExposeIsPrefixedFieldNameConsistentlyWithJacksonJson() throws IOException {
        context = new SpringApplicationBuilder(TestApplication.class)
                .web(WebApplicationType.SERVLET)
                .properties(
                        "server.port=0",
                        "knife4j.enable=true",
                        "logging.level.root=ERROR")
                .run();

        int port = context.getEnvironment().getRequiredProperty("local.server.port", Integer.class);

        JsonNode runtimeJson = OBJECT_MAPPER.valueToTree(new IsPrefixFieldPayload(Boolean.TRUE));
        Assert.assertTrue("Jackson runtime JSON should keep the DTO field name 'isEnabled':\n" + runtimeJson,
                runtimeJson.has("isEnabled"));
        Assert.assertFalse("Jackson runtime JSON should not expose JavaBeans-stripped 'enabled':\n" + runtimeJson,
                runtimeJson.has("enabled"));

        HttpResponse apiDocs = get(port, "/v3/api-docs");
        Assert.assertEquals(200, apiDocs.statusCode);

        JsonNode apiDocsJson = OBJECT_MAPPER.readTree(apiDocs.body);
        JsonNode operation = apiDocsJson.path("paths").path("/api/is-prefix-field/echo").path("post");
        Assert.assertFalse("api-docs should contain POST /api/is-prefix-field/echo operation:\n" + apiDocs.body,
                operation.isMissingNode());

        JsonNode requestProperties = schemaProperties(apiDocsJson,
                operation.path("requestBody").path("content").path("application/json").path("schema"));
        Assert.assertTrue("OpenAPI request schema should keep 'isEnabled'. Actual request properties:\n"
                + requestProperties, requestProperties.has("isEnabled"));
        Assert.assertFalse("OpenAPI request schema should not expose JavaBeans-stripped 'enabled'. "
                + "Actual request properties:\n" + requestProperties, requestProperties.has("enabled"));

        JsonNode responseProperties = schemaProperties(apiDocsJson,
                operation.path("responses").path("200").path("content").path("application/json").path("schema"));
        Assert.assertTrue("OpenAPI response schema should keep 'isEnabled'. Actual response properties:\n"
                + responseProperties, responseProperties.has("isEnabled"));
        Assert.assertFalse("OpenAPI response schema should not expose JavaBeans-stripped 'enabled'. "
                + "Actual response properties:\n" + responseProperties, responseProperties.has("enabled"));
    }

    @Test
    public void shouldExposeKotlinIsPrefixedFieldNameInOpenApiSchema() throws IOException {
        context = new SpringApplicationBuilder(TestApplication.class)
                .web(WebApplicationType.SERVLET)
                .properties(
                        "server.port=0",
                        "knife4j.enable=true",
                        "logging.level.root=ERROR")
                .run();

        int port = context.getEnvironment().getRequiredProperty("local.server.port", Integer.class);

        HttpResponse apiDocs = get(port, "/v3/api-docs");
        Assert.assertEquals(200, apiDocs.statusCode);

        JsonNode apiDocsJson = OBJECT_MAPPER.readTree(apiDocs.body);
        JsonNode operation = apiDocsJson.path("paths").path("/api/kotlin-is-prefix-field/echo").path("post");
        Assert.assertFalse("api-docs should contain POST /api/kotlin-is-prefix-field/echo operation:\n"
                + apiDocs.body, operation.isMissingNode());

        JsonNode requestProperties = schemaProperties(apiDocsJson,
                operation.path("requestBody").path("content").path("application/json").path("schema"));
        Assert.assertTrue("OpenAPI request schema should keep Kotlin 'isEnabled'. Actual request properties:\n"
                + requestProperties, requestProperties.has("isEnabled"));
        Assert.assertFalse("OpenAPI request schema should not expose JavaBeans-stripped 'enabled'. "
                + "Actual request properties:\n" + requestProperties, requestProperties.has("enabled"));

        JsonNode responseProperties = schemaProperties(apiDocsJson,
                operation.path("responses").path("200").path("content").path("application/json").path("schema"));
        Assert.assertTrue("OpenAPI response schema should keep Kotlin 'isEnabled'. Actual response properties:\n"
                + responseProperties, responseProperties.has("isEnabled"));
        Assert.assertFalse("OpenAPI response schema should not expose JavaBeans-stripped 'enabled'. "
                + "Actual response properties:\n" + responseProperties, responseProperties.has("enabled"));

    }

    @Test
    public void shouldHonorExplicitJsonPropertyNameForKotlinIsPrefixedField() throws IOException {
        context = new SpringApplicationBuilder(TestApplication.class)
                .web(WebApplicationType.SERVLET)
                .properties(
                        "server.port=0",
                        "knife4j.enable=true",
                        "logging.level.root=ERROR")
                .run();

        int port = context.getEnvironment().getRequiredProperty("local.server.port", Integer.class);

        HttpResponse apiDocs = get(port, "/v3/api-docs");
        Assert.assertEquals(200, apiDocs.statusCode);

        JsonNode apiDocsJson = OBJECT_MAPPER.readTree(apiDocs.body);
        JsonNode operation = apiDocsJson
                .path("paths")
                .path("/api/kotlin-is-prefix-field/explicit-json-name/echo")
                .path("post");
        Assert.assertFalse("api-docs should contain explicit JSON name operation:\n" + apiDocs.body,
                operation.isMissingNode());

        JsonNode requestProperties = schemaProperties(apiDocsJson,
                operation.path("requestBody").path("content").path("application/json").path("schema"));
        Assert.assertTrue("OpenAPI request schema should honor explicit Kotlin JSON name 'enabled'. "
                + "Actual request properties:\n" + requestProperties, requestProperties.has("enabled"));
        Assert.assertFalse("OpenAPI request schema should not rename explicit JSON name back to 'isEnabled'. "
                + "Actual request properties:\n" + requestProperties, requestProperties.has("isEnabled"));

        JsonNode responseProperties = schemaProperties(apiDocsJson,
                operation.path("responses").path("200").path("content").path("application/json").path("schema"));
        Assert.assertTrue("OpenAPI response schema should honor explicit Kotlin JSON name 'enabled'. "
                + "Actual response properties:\n" + responseProperties, responseProperties.has("enabled"));
        Assert.assertFalse("OpenAPI response schema should not rename explicit JSON name back to 'isEnabled'. "
                + "Actual response properties:\n" + responseProperties, responseProperties.has("isEnabled"));
    }

    @Test
    public void shouldServeCustomApiDocsPathThroughKnife4jRuntimeConfig() throws IOException {
        context = new SpringApplicationBuilder(TestApplication.class)
                .web(WebApplicationType.SERVLET)
                .properties(
                        "server.port=0",
                        "knife4j.enable=true",
                        "springdoc.api-docs.path=/api/openapi",
                        "logging.level.root=ERROR")
                .run();

        int port = context.getEnvironment().getRequiredProperty("local.server.port", Integer.class);

        HttpResponse apiDocs = get(port, "/api/openapi");
        Assert.assertEquals(200, apiDocs.statusCode);
        Assert.assertTrue(apiDocs.body.contains("\"openapi\""));
        Assert.assertFalse(apiDocs.body.contains("/knife4j/config"));

        HttpResponse defaultConfig = get(port, "/v3/api-docs/swagger-config");
        Assert.assertEquals(404, defaultConfig.statusCode);

        HttpResponse knife4jConfig = get(port, "/knife4j/config");
        Assert.assertEquals(200, knife4jConfig.statusCode);
        Assert.assertTrue(knife4jConfig.body.contains("\"schemaVersion\""));
        Assert.assertTrue(knife4jConfig.body.contains("\"openapi\""));
        Assert.assertTrue(knife4jConfig.body.contains("\"apiDocsUrl\""));
        Assert.assertTrue(knife4jConfig.body.contains("api/openapi"));
        Assert.assertTrue(knife4jConfig.body.contains("\"swaggerConfigUrl\""));
        Assert.assertTrue(knife4jConfig.body.contains("api/openapi/swagger-config"));

        HttpResponse customConfig = get(port, "/api/openapi/swagger-config");
        Assert.assertEquals(200, customConfig.statusCode);
        Assert.assertTrue(customConfig.body.contains("/api/openapi"));
    }

    @Test
    public void shouldExposeApiSupportOrderAndAuthorExtensions() throws IOException {
        context = new SpringApplicationBuilder(TestApplication.class)
                .web(WebApplicationType.SERVLET)
                .properties(
                        "server.port=0",
                        "knife4j.enable=true",
                        "springdoc.packages-to-scan=com.github.xiaoymin.knife4j.smoke.boot4",
                        "logging.level.root=ERROR")
                .run();

        int port = context.getEnvironment().getRequiredProperty("local.server.port", Integer.class);

        HttpResponse apiDocs = get(port, "/v3/api-docs");
        Assert.assertEquals(200, apiDocs.statusCode);

        JsonNode apiDocsJson = OBJECT_MAPPER.readTree(apiDocs.body);
        JsonNode apiSupportTag = null;
        for (JsonNode tag : apiDocsJson.path("tags")) {
            if ("ApiSupport 示例接口".equals(tag.path("name").asText())) {
                apiSupportTag = tag;
                break;
            }
        }
        Assert.assertNotNull("api-docs should contain ApiSupport tag:\n" + apiDocs.body, apiSupportTag);
        Assert.assertEquals("@ApiSupport.order should write tag x-order from springdoc.packages-to-scan (#472)",
                1, apiSupportTag.path("x-order").asInt());

        JsonNode operation = apiDocsJson.path("paths").path("/api/api-support/list").path("get");
        Assert.assertFalse("api-docs should contain GET /api/api-support/list operation:\n" + apiDocs.body,
                operation.isMissingNode());
        Assert.assertEquals("@ApiSupport.author should write operation x-author (#472)",
                "yilers", operation.path("x-author").asText());
        Assert.assertEquals("@ApiSupport.order should also write operation x-order (#472)",
                1, operation.path("x-order").asInt());
    }

    private JsonNode schemaProperties(JsonNode apiDocsJson, JsonNode schema) {
        JsonNode ref = schema.path("$ref");
        if (ref.isTextual() && ref.asText().startsWith("#/components/schemas/")) {
            String schemaName = ref.asText().substring("#/components/schemas/".length());
            return apiDocsJson.path("components").path("schemas").path(schemaName).path("properties");
        }
        return schema.path("properties");
    }

    private void assertOas31MatrixContract(JsonNode document) {
        JsonNode requestProperties = document.path("components")
                .path("schemas")
                .path("Oas31MatrixRequest")
                .path("properties");
        JsonNode responseProperties = document.path("components")
                .path("schemas")
                .path("Oas31MatrixResponse")
                .path("properties");

        Assert.assertEquals("string", requestProperties.path("nullableName").path("type").path(0).asText());
        Assert.assertEquals("null", requestProperties.path("nullableName").path("type").path(1).asText());
        Assert.assertEquals("matrix", requestProperties.path("nullableName").path("examples").path(0).asText());
        Assert.assertFalse("springdoc 3.0.3 keeps Object metadata typeless in OAS 3.1",
                requestProperties.path("metadata").has("type"));
        Assert.assertEquals("stable", requestProperties.path("mode").path("const").asText());
        Assert.assertEquals("stable", requestProperties.path("mode").path("examples").path(0).asText());
        Assert.assertEquals(2, requestProperties.path("tuple").path("prefixItems").size());
        Assert.assertEquals(2, requestProperties.path("tuple").path("minItems").asInt());
        Assert.assertEquals(2, requestProperties.path("tuple").path("maxItems").asInt());

        Assert.assertEquals("integer", responseProperties.path("id").path("type").asText());
        Assert.assertTrue(responseProperties.path("serverValue").path("readOnly").asBoolean());
        Assert.assertTrue(responseProperties.path("clientSecret").path("writeOnly").asBoolean());

        JsonNode queryParameters = document.path("paths").path("/oas31/search").path("get").path("parameters");
        Assert.assertEquals(1, queryParameters.size());
        Assert.assertEquals("limit", queryParameters.path(0).path("name").asText());
        Assert.assertEquals("query", queryParameters.path(0).path("in").asText());
        Assert.assertFalse(queryParameters.path(0).path("required").asBoolean());
        Assert.assertEquals("integer", queryParameters.path(0).path("schema").path("type").asText());
        Assert.assertEquals("int32", queryParameters.path(0).path("schema").path("format").asText());

        Assert.assertEquals("#/components/schemas/Oas31MatrixRequest", document.path("paths")
                .path("/oas31/search")
                .path("get")
                .path("requestBody")
                .path("content")
                .path("application/json")
                .path("schema")
                .path("$ref")
                .asText());
        Assert.assertEquals("#/components/schemas/Oas31MatrixResponse", document.path("paths")
                .path("/oas31/json")
                .path("post")
                .path("responses")
                .path("200")
                .path("content")
                .path("application/json")
                .path("schema")
                .path("$ref")
                .asText());
        Assert.assertEquals("binary", document.path("paths")
                .path("/oas31/raw-binary")
                .path("post")
                .path("requestBody")
                .path("content")
                .path("application/octet-stream")
                .path("schema")
                .path("format")
                .asText());

        JsonNode multipart = document.path("paths")
                .path("/oas31/multipart")
                .path("post")
                .path("requestBody")
                .path("content")
                .path("multipart/form-data")
                .path("schema")
                .path("properties");
        Assert.assertEquals("binary", multipart.path("file").path("format").asText());
        Assert.assertEquals("array", multipart.path("files").path("type").asText());
        Assert.assertEquals("binary", multipart.path("files").path("items").path("format").asText());
    }

    private void assertMatchesOas31Fixture(JsonNode document, String fixtureName, int port) throws IOException {
        JsonNode normalized = document.deepCopy();
        JsonNode firstServer = normalized.path("servers").path(0);
        Assert.assertTrue("springdoc matrix should expose its generated server URL", firstServer.isObject());
        Assert.assertTrue("springdoc matrix server URL should be textual", firstServer.path("url").isTextual());
        Assert.assertEquals("springdoc matrix should describe the exact current-origin request",
                "http://localhost:" + port, firstServer.path("url").asText());
        ((ObjectNode) firstServer).put("url", "/");

        Path fixture = findRepositoryRoot()
                .resolve("front/ui-react/src/test-fixtures/springdoc-oas31")
                .resolve(fixtureName);
        try (InputStream input = Files.newInputStream(fixture)) {
            Assert.assertEquals("springdoc OAS 3.1 snapshot changed; inspect the dependency/output diff explicitly",
                    OBJECT_MAPPER.readTree(input), normalized);
        }
    }

    private Path findRepositoryRoot() {
        Path current = Paths.get("").toAbsolutePath();
        while (current != null) {
            if (Files.isDirectory(current.resolve("front/ui-react")) && Files.isDirectory(current.resolve("knife4j"))) {
                return current;
            }
            current = current.getParent();
        }
        throw new AssertionError("Cannot locate knife4j-next repository root from "
                + Paths.get("").toAbsolutePath());
    }

    private HttpResponse get(int port, String path) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL("http://localhost:" + port + path).openConnection();
        connection.setRequestMethod("GET");
        connection.setConnectTimeout(5000);
        connection.setReadTimeout(5000);
        int statusCode = connection.getResponseCode();
        InputStream input = statusCode >= 400 ? connection.getErrorStream() : connection.getInputStream();
        return new HttpResponse(statusCode, read(input));
    }

    private String read(InputStream input) throws IOException {
        if (input == null) {
            return "";
        }
        try (InputStream body = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[1024];
            int length;
            while ((length = body.read(buffer)) != -1) {
                output.write(buffer, 0, length);
            }
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }

    private static class HttpResponse {

        private final int statusCode;
        private final String body;

        private HttpResponse(int statusCode, String body) {
            this.statusCode = statusCode;
            this.body = body;
        }
    }

    @EnableKnife4j
    @SpringBootApplication
    public static class TestApplication {
    }

    @EnableKnife4j
    @SpringBootConfiguration
    @EnableAutoConfiguration
    @Import(Oas31MatrixController.class)
    public static class Oas31MatrixApplication {

        public static void main(String[] args) {
            SpringApplication.run(Oas31MatrixApplication.class, args);
        }
    }

    @RestController
    public static class Oas31MatrixController {

        @Operation(summary = "GET requestBody compatibility")
        @ApiResponse(responseCode = "200", description = "Matrix response", content = @Content(mediaType = MediaType.APPLICATION_JSON_VALUE, schema = @Schema(implementation = Oas31MatrixResponse.class)))
        @GetMapping(path = "/oas31/search", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
        public Oas31MatrixResponse search(
                                          @Parameter(description = "Optional result limit") @RequestParam(name = "limit", required = false) Integer limit,
                                          @RequestBody Oas31MatrixRequest request) {
            return new Oas31MatrixResponse();
        }

        @Operation(summary = "JSON requestBody compatibility")
        @PostMapping(path = "/oas31/json", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
        public Oas31MatrixResponse json(@RequestBody Oas31MatrixRequest request) {
            return new Oas31MatrixResponse();
        }

        @Operation(summary = "Raw binary requestBody compatibility", requestBody = @io.swagger.v3.oas.annotations.parameters.RequestBody(required = true, content = @Content(mediaType = MediaType.APPLICATION_OCTET_STREAM_VALUE, schema = @Schema(type = "string", format = "binary"))))
        @PostMapping(path = "/oas31/raw-binary", consumes = MediaType.APPLICATION_OCTET_STREAM_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
        public Oas31MatrixResponse rawBinary(@RequestBody byte[] request) {
            return new Oas31MatrixResponse();
        }

        @Operation(summary = "Multipart single and multiple file compatibility")
        @PostMapping(path = "/oas31/multipart", consumes = MediaType.MULTIPART_FORM_DATA_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
        public Oas31MatrixResponse multipart(
                                             @RequestPart("file") MultipartFile file,
                                             @RequestPart("files") MultipartFile[] files) {
            return new Oas31MatrixResponse();
        }
    }

    @Schema(description = "OAS 3.1 request matrix")
    public static class Oas31MatrixRequest {

        @Schema(description = "Nullable string", types = {"string", "null"}, examples = {"matrix"})
        public String nullableName;

        @Schema(description = "Intentionally generic object")
        public Object metadata;

        @Schema(description = "Constant mode", type = "string", _const = "stable", examples = {"stable"})
        public String mode;

        @ArraySchema(arraySchema = @Schema(description = "Tuple value"), minItems = 2, maxItems = 2, prefixItems = {@Schema(implementation = String.class), @Schema(implementation = Integer.class)})
        public List<Object> tuple;
    }

    @Schema(description = "OAS 3.1 response matrix")
    public static class Oas31MatrixResponse {

        @Schema(description = "Response identifier", format = "int64", requiredMode = Schema.RequiredMode.REQUIRED, example = "1")
        public Long id = 1L;

        @Schema(description = "Visible only in responses", readOnly = true, example = "server")
        public String serverValue = "server";

        @Schema(description = "Visible only in requests", writeOnly = true, example = "client")
        public String clientSecret;
    }

    @RestController
    public static class TestController {

        @GetMapping("/hello")
        public String hello() {
            return "hello";
        }
    }

    @Tag(name = "is 前缀字段接口", description = "Boot4 is 前缀字段示例接口")
    @RestController
    @RequestMapping("/api/is-prefix-field")
    public static class IsPrefixFieldController {

        @Operation(summary = "回显 isEnabled 字段")
        @PostMapping(path = "/echo", consumes = "application/json", produces = "application/json")
        public IsPrefixFieldPayload echo(@RequestBody IsPrefixFieldPayload request) {
            return request;
        }
    }

    @Schema(description = "is 前缀字段复现 DTO")
    public static class IsPrefixFieldPayload {

        @Schema(description = "是否启用", example = "true")
        public Boolean isEnabled;

        public IsPrefixFieldPayload() {
        }

        public IsPrefixFieldPayload(Boolean isEnabled) {
            this.isEnabled = isEnabled;
        }
    }

    @Tag(name = "用户接口", description = "Boot4 用户相关示例接口")
    @RestController
    @RequestMapping("/api/user")
    public static class DemoUserController {

        @Operation(summary = "获取用户列表")
        @GetMapping("/list")
        public List<UserVO> list() {
            return demoUsers();
        }

        @Operation(summary = "分页查询用户")
        @GetMapping("/page")
        public PageResult page(
                               @Parameter(description = "页码（从 1 开始）") @RequestParam(defaultValue = "1") int pageNum,
                               @Parameter(description = "每页条数") @RequestParam(defaultValue = "10") int pageSize,
                               @Parameter(description = "关键词（模糊搜索用户名或邮箱）") @RequestParam(required = false) String keyword) {
            List<UserVO> users = demoUsers();
            return new PageResult(pageNum, pageSize, users.size(), users);
        }

        @Operation(summary = "根据 ID 获取用户")
        @GetMapping("/{id}")
        public UserVO getById(
                              @Parameter(description = "用户 ID") @PathVariable Long id) {
            return new UserVO(id, "张三", "zhangsan@example.com");
        }

        @Operation(summary = "创建用户")
        @PostMapping
        public UserVO create(@RequestBody UserCreateRequest request) {
            return new UserVO(3L, request.name, request.email);
        }

        @Operation(summary = "更新用户")
        @PutMapping("/{id}")
        public UserVO update(
                             @Parameter(description = "用户 ID") @PathVariable Long id,
                             @RequestBody UserUpdateRequest request) {
            return new UserVO(id, request.name, request.email);
        }

        @Operation(summary = "删除用户")
        @DeleteMapping("/{id}")
        public UserVO delete(
                             @Parameter(description = "用户 ID") @PathVariable Long id) {
            return new UserVO(id, "张三", "zhangsan@example.com");
        }

        private List<UserVO> demoUsers() {
            return List.of(
                    new UserVO(1L, "张三", "zhangsan@example.com"),
                    new UserVO(2L, "李四", "lisi@example.com"));
        }
    }

    @Tag(name = "ApiSupport 示例接口", description = "Boot4 ApiSupport 示例接口")
    @ApiSupport(order = 1, author = "yilers")
    @RestController
    @RequestMapping("/api/api-support")
    public static class ApiSupportController {

        @Operation(summary = "获取 ApiSupport 示例列表")
        @GetMapping("/list")
        public List<String> list() {
            return List.of("api-support");
        }
    }

    @Schema(description = "用户视图对象")
    public static class UserVO {

        @Schema(description = "用户 ID", example = "1")
        public Long id;

        @Schema(description = "用户名", example = "张三")
        public String name;

        @Schema(description = "邮箱地址", example = "zhangsan@example.com")
        public String email;

        public UserVO() {
        }

        public UserVO(Long id, String name, String email) {
            this.id = id;
            this.name = name;
            this.email = email;
        }
    }

    @Schema(description = "创建用户请求")
    public static class UserCreateRequest {

        @Schema(description = "用户名", example = "张三", requiredMode = Schema.RequiredMode.REQUIRED)
        public String name;

        @Schema(description = "邮箱地址", example = "zhangsan@example.com", requiredMode = Schema.RequiredMode.REQUIRED)
        public String email;
    }

    @Schema(description = "更新用户请求")
    public static class UserUpdateRequest {

        @Schema(description = "用户名", example = "李四")
        public String name;

        @Schema(description = "邮箱地址", example = "lisi@example.com")
        public String email;
    }

    @Schema(description = "分页结果")
    public static class PageResult {

        @Schema(description = "当前页码", example = "1")
        public int pageNum;

        @Schema(description = "每页条数", example = "10")
        public int pageSize;

        @Schema(description = "总记录数", example = "2")
        public long total;

        @Schema(description = "数据列表")
        public List<UserVO> list;

        public PageResult() {
        }

        public PageResult(int pageNum, int pageSize, long total, List<UserVO> list) {
            this.pageNum = pageNum;
            this.pageSize = pageSize;
            this.total = total;
            this.list = list;
        }
    }
}

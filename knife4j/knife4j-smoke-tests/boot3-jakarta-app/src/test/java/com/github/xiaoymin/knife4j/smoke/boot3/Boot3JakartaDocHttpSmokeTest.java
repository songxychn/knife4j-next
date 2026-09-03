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


package com.github.xiaoymin.knife4j.smoke.boot3;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.github.xiaoymin.knife4j.annotations.ApiOperationSupport;
import com.github.xiaoymin.knife4j.spring.annotations.EnableKnife4j;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.ArraySchema;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
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
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
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
import java.util.regex.Pattern;

public class Boot3JakartaDocHttpSmokeTest {

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    private ConfigurableApplicationContext context;

    @After
    public void closeContext() {
        if (context != null) {
            context.close();
        }
    }

    @Test
    public void shouldServeDocHtmlAndOpenApiJson() throws IOException {
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
        Assert.assertTrue(apiDocs.body.contains("\"openapi\""));
        Assert.assertTrue(apiDocs.body.contains("/hello"));
    }

    @Test
    public void shouldExposeOas31CompatibilityMatrix() throws IOException {
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
        assertOas31MatrixContract(document, true);
        assertMatchesOas31Fixture(document, "boot3-mvc-springdoc-2.8.9.json");
    }

    @Test
    public void shouldExposeOperationAuthorsFromApiOperationSupport() throws IOException {
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

        JsonNode helloOperation = OBJECT_MAPPER.readTree(apiDocs.body)
                .path("paths")
                .path("/hello")
                .path("get");
        Assert.assertFalse("api-docs should contain GET /hello operation", helloOperation.isMissingNode());

        String author = helloOperation.path("x-author").asText();
        Assert.assertTrue("x-author should contain wxp for @ApiOperationSupport.authors (#438):\n"
                + apiDocs.body, author.contains("wxp"));
        Assert.assertTrue("x-author should contain wfg for @ApiOperationSupport.authors (#438):\n"
                + apiDocs.body, author.contains("wfg"));
        Assert.assertEquals("x-order should keep @ApiOperationSupport.order for the same operation (#438)",
                1, helloOperation.path("x-order").asInt());
    }

    @Test
    public void shouldBlockApiDocsWhenProductionTrue() throws IOException {
        context = new SpringApplicationBuilder(TestApplication.class)
                .web(WebApplicationType.SERVLET)
                .properties(
                        "server.port=0",
                        "knife4j.enable=true",
                        "knife4j.production=true",
                        "logging.level.root=ERROR")
                .run();

        int port = context.getEnvironment().getRequiredProperty("local.server.port", Integer.class);

        // production=true should block /v3/api-docs and return JSON (not HTML) (#666, #859)
        HttpResponse apiDocs = get(port, "/v3/api-docs");
        Assert.assertFalse("Response should not be HTML when production=true (#666, #859)",
                apiDocs.body.contains("<!DOCTYPE"));
        Assert.assertTrue("Response should be JSON when production=true (#666, #859)",
                apiDocs.body.contains("\"code\"") || apiDocs.body.contains("\"message\""));

        HttpResponse knife4jConfig = get(port, "/knife4j/config");
        Assert.assertFalse("Knife4j runtime config should not return HTML when production=true",
                knife4jConfig.body.contains("<!DOCTYPE"));
        Assert.assertTrue("Knife4j runtime config should be blocked when production=true",
                knife4jConfig.body.contains("\"code\"") || knife4jConfig.body.contains("\"message\""));

        // doc.html should also be blocked
        HttpResponse docHtml = get(port, "/doc.html");
        Assert.assertFalse("doc.html should not return HTML content when production=true",
                docHtml.body.contains("webjars/knife4j-ui-react/"));
    }

    /**
     * Lock the springdoc schema contract that
     * {@code @ArraySchema(schema = @Schema(type = "string", format = "binary"))} on a
     * {@link MultipartFile}[] field (the canonical way to declare a multi-file upload, equivalent
     * to what springdoc emits for WebFlux {@code Flux<FilePart>}) produces the
     * {@code {"type":"array","items":{"type":"string","format":"binary"}}} OAS3 schema consumed by
     * {@code knife4j-core}'s {@code extractFileFields()} (upstream xiaoymin/knife4j#733).
     *
     * <p>This closes the loop for issue #227: the front-end unit tests in
     * {@code knife4j-front/knife4j-core/src/__tests__/debug/operationDebugModel.test.ts} assert the
     * parser side of this schema; this smoke assertion guarantees springdoc on the server side
     * actually emits that shape.
     */
    @Test
    public void shouldExposeArrayOfBinarySchemaForMultipartArrayUpload() throws IOException {
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

        String body = apiDocs.body;
        // The upload endpoint must be present.
        Assert.assertTrue("api-docs should contain /upload-array path (#227)", body.contains("/upload-array"));
        // The 'files' property must be an array whose items carry format:"binary".
        //
        // Important: springdoc 2.x (3.1 OAS) collapses @ArraySchema(schema=@Schema(type="string",
        // format="binary")) to {items:{format:"binary", description:...}}, i.e. it drops an explicit
        // type:"string" inside items. knife4j-core's extractFileFields() treats any items with
        // format:"binary" as a file field, so this shape is still the upload schema contract the
        // front-end consumes (upstream xiaoymin/knife4j#733).
        //
        // The regex matches the property declaration on one line, tolerating any field order inside
        // items but requiring the array+binary+files-property triple to be co-located. DOTALL lets
        // '.' span whatever whitespace springdoc emits.
        Pattern filesArrayOfBinary = Pattern.compile(
                "\"files\"\\s*:\\s*\\{[^{}]*\"type\"\\s*:\\s*\"array\"[^{}]*\"items\"\\s*:\\s*\\{[^{}]*\"format\"\\s*:\\s*\"binary\"",
                Pattern.DOTALL);
        Assert.assertTrue(
                "springdoc should emit array-of-binary schema for the 'files' property annotated with "
                        + "@ArraySchema(schema=@Schema(type=\"string\",format=\"binary\")). Full api-docs excerpt:\n"
                        + body,
                filesArrayOfBinary.matcher(body).find());
    }

    /**
     * End-to-end reproduction lock for upstream xiaoymin/knife4j#680 (mirrored as issue #289):
     * a Java {@code Byte} field is mapped by springdoc to OAS3 {@code {"type":"string","format":"byte"}}.
     *
     * <p>This is the missing server-side reproduction for PR #328: the front-end fix in
     * {@code knife4j-front/knife4j-core/src/debug/schemaExample.ts} and
     * {@code knife4j-front/knife4j-ui-react/src/components/schema/schemaUtils.ts} relies on
     * springdoc emitting exactly this contract. If a future springdoc upgrade changes the shape
     * (e.g. starts emitting {@code {"type":"integer","format":"int8"}} for {@code Byte}), the
     * front-end {@code byte} display path would silently stop being exercised on real payloads;
     * locking the contract here turns that into a CI failure.
     */
    @Test
    public void shouldExposeStringByteSchemaForJavaByteField() throws IOException {
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

        String body = apiDocs.body;
        Assert.assertTrue("api-docs should contain /byte-echo path", body.contains("/byte-echo"));

        // Match the `level` property declaration regardless of which sibling key (description,
        // example, ...) springdoc emits next to type/format. Using a tolerant regex avoids
        // coupling to springdoc's key ordering or whitespace.
        Pattern levelStringByte = Pattern.compile(
                "\"level\"\\s*:\\s*\\{[^{}]*\"type\"\\s*:\\s*\"string\"[^{}]*\"format\"\\s*:\\s*\"byte\"",
                Pattern.DOTALL);
        Pattern levelStringByteAlt = Pattern.compile(
                "\"level\"\\s*:\\s*\\{[^{}]*\"format\"\\s*:\\s*\"byte\"[^{}]*\"type\"\\s*:\\s*\"string\"",
                Pattern.DOTALL);
        Assert.assertTrue(
                "springdoc should emit {type:string,format:byte} for the 'level' Byte field on "
                        + "ByteRequest. This is the OAS3 contract the knife4j-core byte branch relies on. "
                        + "Full api-docs excerpt:\n" + body,
                levelStringByte.matcher(body).find() || levelStringByteAlt.matcher(body).find());
    }

    @Test
    public void shouldServeCustomApiDocsPath() throws IOException {
        context = new SpringApplicationBuilder(TestApplication.class)
                .web(WebApplicationType.SERVLET)
                .properties(
                        "server.port=0",
                        "knife4j.enable=true",
                        "springdoc.api-docs.path=/api/openapi",
                        "logging.level.root=ERROR")
                .run();

        int port = context.getEnvironment().getRequiredProperty("local.server.port", Integer.class);

        // Custom springdoc.api-docs.path should be accessible (#573, #849)
        HttpResponse apiDocs = get(port, "/api/openapi");
        Assert.assertEquals(200, apiDocs.statusCode);
        Assert.assertTrue("Custom api-docs path should return OpenAPI JSON (#573, #849)",
                apiDocs.body.contains("\"openapi\""));
        Assert.assertFalse("Knife4j runtime config is an internal endpoint and should be hidden from api-docs",
                apiDocs.body.contains("/knife4j/config"));

        HttpResponse defaultConfig = get(port, "/v3/api-docs/swagger-config");
        Assert.assertEquals("Default swagger-config should not exist when api-docs path is customized (#344)",
                404, defaultConfig.statusCode);

        HttpResponse knife4jConfig = get(port, "/knife4j/config");
        Assert.assertEquals(200, knife4jConfig.statusCode);
        Assert.assertTrue("Knife4j runtime config should expose the custom OpenAPI URLs (#344):\n"
                + knife4jConfig.body,
                knife4jConfig.body.contains("\"schemaVersion\"")
                        && knife4jConfig.body.contains("\"openapi\"")
                        && knife4jConfig.body.contains("\"apiDocsUrl\"")
                        && knife4jConfig.body.contains("api/openapi")
                        && knife4jConfig.body.contains("\"swaggerConfigUrl\"")
                        && knife4jConfig.body.contains("api/openapi/swagger-config"));

        HttpResponse legacyConfig = get(port, "/knife4j/swagger-config");
        Assert.assertEquals("Legacy Knife4j swagger-config endpoint should not be exposed",
                404, legacyConfig.statusCode);

        HttpResponse customConfig = get(port, "/api/openapi/swagger-config");
        Assert.assertEquals(200, customConfig.statusCode);
        Assert.assertTrue("Custom swagger-config should point the UI at the custom api-docs path (#344):\n"
                + customConfig.body,
                customConfig.body.contains("/api/openapi"));
    }

    @Test
    public void shouldApplyForwardedPrefixToSwaggerConfigUrls() throws IOException {
        context = new SpringApplicationBuilder(TestApplication.class)
                .web(WebApplicationType.SERVLET)
                .properties(
                        "server.port=0",
                        "knife4j.enable=true",
                        "server.forward-headers-strategy=framework",
                        "logging.level.root=ERROR")
                .run();

        int port = context.getEnvironment().getRequiredProperty("local.server.port", Integer.class);

        HttpResponse prefixedConfig = get(port, "/v3/api-docs/swagger-config",
                "X-Forwarded-Prefix", "/prod-api/dispatch");
        Assert.assertEquals(200, prefixedConfig.statusCode);
        Assert.assertTrue("swagger-config urls should include X-Forwarded-Prefix (#345):\n" + prefixedConfig.body,
                prefixedConfig.body.contains("/prod-api/dispatch/v3/api-docs"));

        HttpResponse defaultConfig = get(port, "/v3/api-docs/swagger-config");
        Assert.assertEquals(200, defaultConfig.statusCode);
        Assert.assertFalse("swagger-config without X-Forwarded-Prefix should not include proxy prefix (#345):\n"
                + defaultConfig.body,
                defaultConfig.body.contains("/prod-api/dispatch/v3/api-docs"));
    }

    private HttpResponse get(int port, String path) throws IOException {
        return get(port, path, null, null);
    }

    private void assertOas31MatrixContract(JsonNode document, boolean genericObjectHasType) {
        JsonNode requestSchema = document.path("components").path("schemas").path("Oas31MatrixRequest");
        JsonNode responseSchema = document.path("components").path("schemas").path("Oas31MatrixResponse");
        JsonNode requestProperties = requestSchema.path("properties");

        Assert.assertEquals("string", requestProperties.path("nullableName").path("type").path(0).asText());
        Assert.assertEquals("null", requestProperties.path("nullableName").path("type").path(1).asText());
        Assert.assertEquals("matrix", requestProperties.path("nullableName").path("examples").path(0).asText());
        Assert.assertEquals(genericObjectHasType, requestProperties.path("metadata").has("type"));
        Assert.assertEquals("stable", requestProperties.path("mode").path("const").asText());
        Assert.assertEquals("stable", requestProperties.path("mode").path("examples").path(0).asText());
        Assert.assertEquals(2, requestProperties.path("tuple").path("prefixItems").size());
        Assert.assertEquals(2, requestProperties.path("tuple").path("minItems").asInt());
        Assert.assertEquals(2, requestProperties.path("tuple").path("maxItems").asInt());

        Assert.assertEquals("integer", responseSchema.path("properties").path("id").path("type").asText());
        Assert.assertTrue(responseSchema.path("properties").path("serverValue").path("readOnly").asBoolean());
        Assert.assertTrue(responseSchema.path("properties").path("clientSecret").path("writeOnly").asBoolean());

        JsonNode getBody = document.path("paths").path("/oas31/search").path("get").path("requestBody");
        Assert.assertEquals("#/components/schemas/Oas31MatrixRequest",
                getBody.path("content").path("application/json").path("schema").path("$ref").asText());
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

    private void assertMatchesOas31Fixture(JsonNode document, String fixtureName) throws IOException {
        JsonNode normalized = document.deepCopy();
        JsonNode firstServer = normalized.path("servers").path(0);
        Assert.assertTrue("springdoc matrix should expose its generated server URL", firstServer.isObject());
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

    private HttpResponse get(int port, String path, String headerName, String headerValue) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL("http://localhost:" + port + path).openConnection();
        connection.setRequestMethod("GET");
        if (headerName != null) {
            connection.setRequestProperty(headerName, headerValue);
        }
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

    @RestController
    public static class TestController {

        @ApiOperationSupport(authors = {"wxp", "wfg"}, order = 1)
        @GetMapping("/hello")
        public String hello() {
            return "hello";
        }

        /**
         * Multi-file upload endpoint used to assert the springdoc schema contract in
         * {@link #shouldExposeArrayOfBinarySchemaForMultipartArrayUpload()}. The
         * {@code @ArraySchema(schema = @Schema(type = "string", format = "binary"))} annotation is
         * the canonical pattern for declaring a multi-file upload and produces the OAS3 schema that
         * {@code knife4j-core}'s {@code extractFileFields()} detects as a file field.
         *
         * <p>The actual request handling is irrelevant for a schema-only smoke; the method only
         * needs to be reachable to springdoc's class scan.
         */
        @PostMapping(path = "/upload-array", consumes = "multipart/form-data")
        public String uploadArray(@RequestBody UploadArrayRequest request) {
            return "ok";
        }

        /**
         * Used by {@link Boot3JakartaDocHttpSmokeTest#shouldExposeStringByteSchemaForJavaByteField()}
         * to lock the springdoc schema contract for Java {@code Byte} fields
         * (upstream xiaoymin/knife4j#680, mirrored as issue #289).
         */
        @PostMapping(path = "/byte-echo", consumes = "application/json")
        public ByteRequest byteEcho(@RequestBody ByteRequest request) {
            return request;
        }

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
        public Oas31MatrixResponse search(@RequestBody Oas31MatrixRequest request) {
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

    @Schema(description = "Multipart request body with an array of files")
    public static class UploadArrayRequest {

        @ArraySchema(schema = @Schema(type = "string", format = "binary", description = "Files to upload"))
        public MultipartFile[] files;
    }

    /**
     * Reproduction DTO for upstream #680 / issue #289: a Java {@code Byte} field is
     * mapped by springdoc to OAS3 {@code {"type":"string","format":"byte"}}.
     */
    @Schema(description = "Request body containing a Java Byte field (upstream #680 reproduction)")
    public static class ByteRequest {

        @Schema(description = "Severity level encoded as a single Java Byte")
        public Byte level;
    }

}

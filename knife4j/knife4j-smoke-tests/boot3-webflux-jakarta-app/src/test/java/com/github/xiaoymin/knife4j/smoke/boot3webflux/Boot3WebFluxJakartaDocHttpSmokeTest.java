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


package com.github.xiaoymin.knife4j.smoke.boot3webflux;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
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
import org.springframework.http.codec.multipart.FilePart;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

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

public class Boot3WebFluxJakartaDocHttpSmokeTest {

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
                .web(WebApplicationType.REACTIVE)
                .properties(
                        "server.port=0",
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
                .web(WebApplicationType.REACTIVE)
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

        HttpResponse runtimeConfig = get(port, "/v3/api-docs/swagger-config");
        Assert.assertEquals(200, runtimeConfig.statusCode);
        Assert.assertTrue(runtimeConfig.body.contains("\"url\""));

        HttpResponse apiDocs = get(port, "/v3/api-docs");
        Assert.assertEquals(200, apiDocs.statusCode);
        JsonNode document = OBJECT_MAPPER.readTree(apiDocs.body);
        Assert.assertEquals("3.1.0", document.path("openapi").asText());
        Assert.assertFalse(document.path("paths").path("/oas31/search").path("get").isMissingNode());
        Assert.assertFalse(document.path("paths").path("/oas31/json").path("post").isMissingNode());
        Assert.assertFalse(document.path("paths").path("/oas31/raw-binary").path("post").isMissingNode());
        Assert.assertFalse(document.path("paths").path("/oas31/multipart").path("post").isMissingNode());
        assertOas31MatrixContract(document);
        assertMatchesOas31Fixture(document, "boot3-webflux-springdoc-2.8.9.json");
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
        Assert.assertEquals("object", requestProperties.path("metadata").path("type").asText());
        Assert.assertEquals("stable", requestProperties.path("mode").path("const").asText());
        Assert.assertEquals("stable", requestProperties.path("mode").path("examples").path(0).asText());
        Assert.assertEquals(2, requestProperties.path("tuple").path("prefixItems").size());
        Assert.assertEquals(2, requestProperties.path("tuple").path("minItems").asInt());
        Assert.assertEquals(2, requestProperties.path("tuple").path("maxItems").asInt());

        Assert.assertEquals("integer", responseProperties.path("id").path("type").asText());
        Assert.assertTrue(responseProperties.path("serverValue").path("readOnly").asBoolean());
        Assert.assertTrue(responseProperties.path("clientSecret").path("writeOnly").asBoolean());

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

    @SpringBootApplication
    public static class TestApplication {
    }

    @RestController
    public static class TestController {

        @GetMapping("/hello")
        public String hello() {
            return "hello";
        }
    }

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
        public Mono<Oas31MatrixResponse> search(@RequestBody Oas31MatrixRequest request) {
            return Mono.just(new Oas31MatrixResponse());
        }

        @Operation(summary = "JSON requestBody compatibility")
        @PostMapping(path = "/oas31/json", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
        public Mono<Oas31MatrixResponse> json(@RequestBody Oas31MatrixRequest request) {
            return Mono.just(new Oas31MatrixResponse());
        }

        @Operation(summary = "Raw binary requestBody compatibility", requestBody = @io.swagger.v3.oas.annotations.parameters.RequestBody(required = true, content = @Content(mediaType = MediaType.APPLICATION_OCTET_STREAM_VALUE, schema = @Schema(type = "string", format = "binary"))))
        @PostMapping(path = "/oas31/raw-binary", consumes = MediaType.APPLICATION_OCTET_STREAM_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
        public Mono<Oas31MatrixResponse> rawBinary(@RequestBody Mono<byte[]> request) {
            return Mono.just(new Oas31MatrixResponse());
        }

        @Operation(summary = "Multipart single and multiple file compatibility")
        @PostMapping(path = "/oas31/multipart", consumes = MediaType.MULTIPART_FORM_DATA_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
        public Mono<Oas31MatrixResponse> multipart(
                                                   @RequestPart("file") FilePart file,
                                                   @RequestPart("files") Flux<FilePart> files) {
            return Mono.just(new Oas31MatrixResponse());
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
}

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

import com.github.xiaoymin.knife4j.spring.annotations.EnableKnife4j;
import io.swagger.v3.oas.annotations.media.ArraySchema;
import io.swagger.v3.oas.annotations.media.Schema;
import org.junit.After;
import org.junit.Assert;
import org.junit.Test;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;

public class Boot3JakartaDocHttpSmokeTest {

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

    @RestController
    public static class TestController {

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
    }

    @Schema(description = "Multipart request body with an array of files")
    public static class UploadArrayRequest {

        @ArraySchema(schema = @Schema(type = "string", format = "binary", description = "Files to upload"))
        public MultipartFile[] files;
    }
}

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


package com.github.xiaoymin.knife4j.smoke.boot2;

import com.github.xiaoymin.knife4j.spring.annotations.EnableKnife4j;
import org.junit.After;
import org.junit.Assert;
import org.junit.Test;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.boot.web.context.WebServerApplicationContext;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.core.Ordered;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import springfox.documentation.builders.PathSelectors;
import springfox.documentation.builders.RequestHandlerSelectors;
import springfox.documentation.spi.DocumentationType;
import springfox.documentation.spring.web.plugins.Docket;

import javax.servlet.Filter;
import javax.servlet.http.HttpServletResponse;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class Boot2DocHttpSmokeTest {

    private ConfigurableApplicationContext context;

    @After
    public void closeContext() {
        if (context != null) {
            context.close();
        }
    }

    @Test
    public void shouldServeDocHtmlAndSwaggerJson() throws IOException {
        context = new SpringApplicationBuilder(TestApplication.class)
                .web(WebApplicationType.SERVLET)
                .properties(
                        "server.port=0",
                        "knife4j.enable=true",
                        "spring.mvc.pathmatch.matching-strategy=ant_path_matcher",
                        "spring.autoconfigure.exclude=org.springframework.boot.autoconfigure.security.servlet.SecurityAutoConfiguration",
                        "logging.level.root=ERROR")
                .run();

        int port = ((WebServerApplicationContext) context).getWebServer().getPort();

        HttpResponse docHtml = get(port, "/doc.html");
        Assert.assertEquals(200, docHtml.statusCode);
        // Vue 3 production bundle entry is hashed under webjars/js/ (see knife4j-vue3/vite.config.js
        // rollupOptions output.entryFileNames).
        Assert.assertTrue(
                "doc.html should reference a hashed webjars/js/ entry produced by the Vue 3 vite build",
                docHtml.body.contains("webjars/js/"));

        HttpResponse apiDocs = get(port, "/v2/api-docs");
        Assert.assertEquals(200, apiDocs.statusCode);
        Assert.assertTrue(apiDocs.body.contains("\"swagger\":\"2.0\""));
        Assert.assertTrue(apiDocs.body.contains("/hello"));
    }

    /**
     * Lock the fact that {@code knife4j-openapi2-ui} serves the Vue 3 bundle built from
     * {@code knife4j-vue3/}, not the legacy Vue 2 upstream bundle. If someone accidentally
     * reverts PR-5 or wires a different UI into the webjar, these markers disappear and the
     * test fails.
     *
     * <p>This also exercises one more layer than the basic doc.html smoke: it fetches the
     * first hashed JS and CSS entries referenced by doc.html to catch webjar packaging or
     * static-resource MIME regressions that would leave doc.html served but browser assets broken
     * (upstream xiaoymin/knife4j#666).
     */
    @Test
    public void shouldServeVue3UiAssetsAndSwaggerResources() throws IOException {
        context = new SpringApplicationBuilder(TestApplication.class)
                .web(WebApplicationType.SERVLET)
                .properties(
                        "server.port=0",
                        "knife4j.enable=true",
                        "spring.mvc.pathmatch.matching-strategy=ant_path_matcher",
                        "spring.autoconfigure.exclude=org.springframework.boot.autoconfigure.security.servlet.SecurityAutoConfiguration",
                        "logging.level.root=ERROR")
                .run();

        int port = ((WebServerApplicationContext) context).getWebServer().getPort();

        HttpResponse docHtml = get(port, "/doc.html");
        Assert.assertEquals(200, docHtml.statusCode);

        // Vue 3 product markers: title text and the knife4j-next favicon reference both come from
        // knife4j-vue3/doc.html. Neither exists in the upstream Vue 2 template.
        Assert.assertTrue(
                "doc.html should carry the Vue 3 Knife4j Next title (see knife4j-vue3/doc.html)",
                docHtml.body.contains("<title>Knife4j Next</title>"));
        Assert.assertTrue(
                "doc.html should reference knife4j-next-mark.svg favicon (Vue 3 template only)",
                docHtml.body.contains("knife4j-next-mark.svg"));

        assertWebjarAssetMimeTypes(port, docHtml.body);

        // /swagger-resources is the group listing endpoint that knife4j-aggregation-spring-boot-starter
        // and the Vue 3 UI both rely on. Lock it down to a 200 + JSON array shape.
        HttpResponse swaggerResources = get(port, "/swagger-resources");
        Assert.assertEquals(200, swaggerResources.statusCode);
        Assert.assertTrue(
                "swagger-resources should return a JSON array",
                swaggerResources.body.trim().startsWith("["));
    }

    /**
     * A custom Jackson-only converter chain was one candidate for upstream #666. Static webjar
     * resources should still bypass MVC message converters and keep JS/CSS MIME types.
     */
    @Test
    public void shouldServeWebjarAssetsWithStaticMimeTypesWhenMessageConvertersAreCustomized() throws IOException {
        context = new SpringApplicationBuilder(TestApplication.class)
                .web(WebApplicationType.SERVLET)
                .initializers(applicationContext -> applicationContext.getBeanFactory().registerSingleton(
                        "jacksonOnlyMessageConverters",
                        (WebMvcConfigurer) new WebMvcConfigurer() {

                            @Override
                            public void configureMessageConverters(List<HttpMessageConverter<?>> converters) {
                                converters.clear();
                                converters.add(new MappingJackson2HttpMessageConverter());
                            }
                        }))
                .properties(
                        "server.port=0",
                        "knife4j.enable=true",
                        "spring.mvc.pathmatch.matching-strategy=ant_path_matcher",
                        "spring.autoconfigure.exclude=org.springframework.boot.autoconfigure.security.servlet.SecurityAutoConfiguration",
                        "logging.level.root=ERROR")
                .run();

        int port = ((WebServerApplicationContext) context).getWebServer().getPort();

        HttpResponse docHtml = get(port, "/doc.html");
        Assert.assertEquals(200, docHtml.statusCode);
        assertWebjarAssetMimeTypes(port, docHtml.body);
    }

    /**
     * Mirrors the upstream #666 symptom when an application/security filter captures
     * {@code /webjars/*} before Spring static resource handling. This points the remaining
     * investigation at user filter/security configuration rather than Knife4j's default webjar
     * publishing path.
     */
    @Test
    public void shouldReproduceJsonMimeWhenApplicationFilterInterceptsWebjars() throws IOException {
        context = new SpringApplicationBuilder(TestApplication.class)
                .web(WebApplicationType.SERVLET)
                .initializers(applicationContext -> applicationContext.getBeanFactory().registerSingleton(
                        "jsonWebjarFilterRegistration", jsonWebjarFilterRegistration()))
                .properties(
                        "server.port=0",
                        "knife4j.enable=true",
                        "spring.mvc.pathmatch.matching-strategy=ant_path_matcher",
                        "spring.autoconfigure.exclude=org.springframework.boot.autoconfigure.security.servlet.SecurityAutoConfiguration",
                        "logging.level.root=ERROR")
                .run();

        int port = ((WebServerApplicationContext) context).getWebServer().getPort();

        HttpResponse docHtml = get(port, "/doc.html");
        Assert.assertEquals(200, docHtml.statusCode);
        String firstStylesheet = firstAssetPath(docHtml.body, "css");
        String firstScript = firstAssetPath(docHtml.body, "js");

        HttpResponse stylesheetResponse = get(port, "/" + firstStylesheet);
        HttpResponse scriptResponse = get(port, "/" + firstScript);

        Assert.assertEquals(401, stylesheetResponse.statusCode);
        Assert.assertEquals("application/json", mediaType(stylesheetResponse.contentType));
        Assert.assertEquals(401, scriptResponse.statusCode);
        Assert.assertEquals("application/json", mediaType(scriptResponse.contentType));
    }

    private static void assertWebjarAssetMimeTypes(int port, String docHtml) throws IOException {
        String firstAsset = firstAssetPath(docHtml, "js");
        HttpResponse assetResponse = get(port, "/" + firstAsset);
        Assert.assertEquals(
                "First JS asset referenced by doc.html (" + firstAsset + ") must be reachable",
                200, assetResponse.statusCode);
        Assert.assertTrue(
                "First JS asset referenced by doc.html (" + firstAsset + ") should be served as JavaScript, got: "
                        + assetResponse.contentType,
                isJavaScript(assetResponse.contentType));

        String firstStylesheet = firstAssetPath(docHtml, "css");
        HttpResponse stylesheetResponse = get(port, "/" + firstStylesheet);
        Assert.assertEquals(
                "First CSS asset referenced by doc.html (" + firstStylesheet + ") must be reachable",
                200, stylesheetResponse.statusCode);
        Assert.assertTrue(
                "First CSS asset referenced by doc.html (" + firstStylesheet + ") should be served as CSS, got: "
                        + stylesheetResponse.contentType,
                isCss(stylesheetResponse.contentType));
    }

    private static String firstAssetPath(String html, String extension) {
        List<String> assets = extractAssetPaths(html, extension);
        Assert.assertFalse(
                "doc.html should reference at least one webjars/" + extension + "/ asset",
                assets.isEmpty());
        return assets.get(0);
    }

    private static List<String> extractAssetPaths(String html, String extension) {
        List<String> result = new ArrayList<>();
        Pattern pattern = Pattern.compile("(?:src|href)=\"((?:\\./)?webjars/" + extension + "/[^\"]+\\."
                + extension + ")\"");
        Matcher matcher = pattern.matcher(html);
        while (matcher.find()) {
            String path = matcher.group(1);
            if (path.startsWith("./")) {
                path = path.substring(2);
            }
            result.add(path);
        }
        return result;
    }

    private static boolean isCss(String contentType) {
        return contentType != null && contentType.toLowerCase().startsWith("text/css");
    }

    private static boolean isJavaScript(String contentType) {
        if (contentType == null) {
            return false;
        }
        String normalized = contentType.toLowerCase();
        return normalized.startsWith("application/javascript") || normalized.startsWith("text/javascript");
    }

    private static String mediaType(String contentType) {
        if (contentType == null) {
            return "";
        }
        int semicolon = contentType.indexOf(';');
        if (semicolon == -1) {
            return contentType;
        }
        return contentType.substring(0, semicolon);
    }

    private static FilterRegistrationBean<Filter> jsonWebjarFilterRegistration() {
        FilterRegistrationBean<Filter> registration = new FilterRegistrationBean<>();
        registration.setFilter((request, response, chain) -> {
            HttpServletResponse httpResponse = (HttpServletResponse) response;
            httpResponse.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            httpResponse.setContentType("application/json");
            httpResponse.setCharacterEncoding(StandardCharsets.UTF_8.name());
            httpResponse.getWriter().write("{\"code\":401,\"message\":\"blocked\"}");
        });
        registration.addUrlPatterns("/webjars/*");
        registration.setOrder(Ordered.HIGHEST_PRECEDENCE);
        return registration;
    }

    @Test
    public void shouldBlockApiDocsWhenProductionTrue() throws IOException {
        context = new SpringApplicationBuilder(TestApplication.class)
                .web(WebApplicationType.SERVLET)
                .properties(
                        "server.port=0",
                        "knife4j.enable=true",
                        "knife4j.production=true",
                        "spring.mvc.pathmatch.matching-strategy=ant_path_matcher",
                        "spring.autoconfigure.exclude=org.springframework.boot.autoconfigure.security.servlet.SecurityAutoConfiguration",
                        "logging.level.root=ERROR")
                .run();

        int port = ((WebServerApplicationContext) context).getWebServer().getPort();

        // production=true should block /v2/api-docs and return JSON (not HTML) (#666, #859)
        HttpResponse apiDocs = get(port, "/v2/api-docs");
        Assert.assertFalse("Response should not be HTML when production=true (#666, #859)",
                apiDocs.body.contains("<!DOCTYPE"));
        Assert.assertTrue("Response should be JSON when production=true (#666, #859)",
                apiDocs.body.contains("\"code\"") || apiDocs.body.contains("\"message\""));
    }

    private static HttpResponse get(int port, String path) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL("http://localhost:" + port + path).openConnection();
        connection.setRequestMethod("GET");
        connection.setConnectTimeout(5000);
        connection.setReadTimeout(5000);
        int statusCode = connection.getResponseCode();
        String contentType = connection.getContentType();
        InputStream input = statusCode >= 400 ? connection.getErrorStream() : connection.getInputStream();
        return new HttpResponse(statusCode, contentType, read(input));
    }

    private static String read(InputStream input) throws IOException {
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
        private final String contentType;
        private final String body;

        private HttpResponse(int statusCode, String contentType, String body) {
            this.statusCode = statusCode;
            this.contentType = contentType;
            this.body = body;
        }
    }

    @EnableKnife4j
    @SpringBootApplication
    public static class TestApplication {

        @Bean
        public Docket testDocket() {
            return new Docket(DocumentationType.SWAGGER_2)
                    .select()
                    .apis(RequestHandlerSelectors.basePackage(Boot2DocHttpSmokeTest.class.getPackage().getName()))
                    .paths(PathSelectors.any())
                    .build();
        }
    }

    @RestController
    public static class TestController {

        @GetMapping("/hello")
        public String hello() {
            return "hello";
        }
    }
}

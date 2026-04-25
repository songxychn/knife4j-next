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
import org.springframework.boot.web.context.WebServerApplicationContext;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import springfox.documentation.builders.PathSelectors;
import springfox.documentation.builders.RequestHandlerSelectors;
import springfox.documentation.spi.DocumentationType;
import springfox.documentation.spring.web.plugins.Docket;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

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
        Assert.assertTrue(docHtml.body.contains("webjars/knife4j-ui-react/"));
        
        HttpResponse apiDocs = get(port, "/v2/api-docs");
        Assert.assertEquals(200, apiDocs.statusCode);
        Assert.assertTrue(apiDocs.body.contains("\"swagger\":\"2.0\""));
        Assert.assertTrue(apiDocs.body.contains("/hello"));
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

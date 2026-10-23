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


package com.baizhukui.knife4j.demo.openapi2;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.exc.InvalidTypeIdException;
import com.fasterxml.jackson.databind.jsontype.BasicPolymorphicTypeValidator;
import org.junit.AfterClass;
import org.junit.Assert;
import org.junit.BeforeClass;
import org.junit.Test;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.web.context.WebServerApplicationContext;
import org.springframework.context.ConfigurableApplicationContext;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.Collections;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Keeps the public Boot 2 demo functional while exercising its patched runtime dependencies. */
public class DemoSecuritySmokeTest {

    private static ConfigurableApplicationContext context;
    private static int port;

    @BeforeClass
    public static void start() {
        context = new SpringApplicationBuilder(DemoApplication.class).run(
                "--server.address=127.0.0.1", "--server.port=0", "--logging.level.root=ERROR");
        port = ((WebServerApplicationContext) context).getWebServer().getPort();
    }

    @AfterClass
    public static void stop() {
        if (context != null) {
            context.close();
        }
    }

    @Test
    public void rejectsTransferEncodingOnHttp10() throws Exception {
        // CVE-2026-77756: malformed input must be rejected by Tomcat before application routing.
        try (Socket socket = new Socket("127.0.0.1", port)) {
            socket.setSoTimeout(10000);
            socket.getOutputStream().write(("GET /api/user/list HTTP/1.0\r\n"
                    + "Host: localhost\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n")
                    .getBytes(StandardCharsets.US_ASCII));
            BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.US_ASCII));
            Assert.assertEquals("HTTP/1.1 400 ", reader.readLine());
        }
    }

    @Test
    public void validatesGenericTypeArguments() throws Exception {
        // Harmless constructor: demonstrates CVE-2026-110879 without external side effects.
        ObjectMapper mapper = new ObjectMapper();
        mapper.activateDefaultTyping(BasicPolymorphicTypeValidator.builder().allowIfBaseType(Map.class).build(),
                ObjectMapper.DefaultTyping.NON_FINAL);
        String safe = "[\"java.util.HashMap<java.lang.String,java.lang.String>\",{\"key\":\"value\"}]";
        String denied = "[\"java.util.HashMap<" + UnapprovedKey.class.getName() + ",java.lang.String>\",{\"key\":\"value\"}]";
        Assert.assertEquals(Collections.singletonMap("key", "value"), mapper.readValue(safe, Map.class));
        Assert.assertThrows(InvalidTypeIdException.class, () -> mapper.readValue(denied, Map.class));
    }

    @Test
    public void servesDocumentationAndJsonRequests() throws Exception {
        String html = request("GET", "/doc.html", null, null);
        Matcher asset = Pattern.compile("(?:src|href)=\"((?:\\./)?webjars/js/[^\"]+\\.js)\"").matcher(html);
        Assert.assertTrue("Vue3 entry asset must be present", asset.find());
        Assert.assertFalse(request("GET", "/" + asset.group(1).replaceFirst("^\\./", ""), null, null).isEmpty());
        ObjectMapper mapper = context.getBean(ObjectMapper.class);
        String spec = request("GET", "/v2/api-docs", null, null);
        Assert.assertEquals("2.0", mapper.readTree(spec).path("swagger").asText());
        Assert.assertTrue(mapper.readTree(spec).path("paths").has("/api/user/list"));
        Assert.assertTrue(mapper.readTree(request("GET", "/swagger-resources", null, null)).isArray());
        Assert.assertEquals(2, mapper.readTree(request("GET", "/api/user/list", null, null)).size());
        String created = request("POST", "/api/user", "application/json", "{\"name\":\"测试\",\"email\":\"demo@example.test\"}");
        Assert.assertEquals("测试", mapper.readTree(created).path("name").asText());
        Assert.assertEquals(LocalDate.of(2026, 10, 23), mapper.readValue("\"2026-10-23\"", LocalDate.class));
    }

    @Test
    public void acceptsMultipartWithJsonMetadata() throws Exception {
        String body = "--demo-boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"hello.txt\"\r\n"
                + "Content-Type: text/plain\r\n\r\nhello\r\n--demo-boundary\r\n"
                + "Content-Disposition: form-data; name=\"meta\"\r\nContent-Type: application/json\r\n\r\n"
                + "{\"description\":\"demo\",\"category\":\"test\",\"isPublic\":true}\r\n--demo-boundary--\r\n";
        String result = request("POST", "/upload/file-with-meta", "multipart/form-data; boundary=demo-boundary", body);
        ObjectMapper mapper = context.getBean(ObjectMapper.class);
        Assert.assertEquals("hello.txt", mapper.readTree(result).path("filename").asText());
        Assert.assertEquals(5, mapper.readTree(result).path("size").asInt());
        Assert.assertTrue(mapper.readTree(result).path("isPublic").asBoolean());
    }

    private static String request(String method, String path, String contentType, String body) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL("http://127.0.0.1:" + port + path).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(10000);
        connection.setReadTimeout(10000);
        try {
            if (body != null) {
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", contentType);
                try (java.io.OutputStream output = connection.getOutputStream()) {
                    output.write(body.getBytes(StandardCharsets.UTF_8));
                }
            }
            Assert.assertEquals(path, 200, connection.getResponseCode());
            try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    output.write(buffer, 0, count);
                }
                return new String(output.toByteArray(), StandardCharsets.UTF_8);
            }
        } finally {
            connection.disconnect();
        }
    }

    public static class UnapprovedKey {

        public UnapprovedKey(String value) {
        }
    }
}

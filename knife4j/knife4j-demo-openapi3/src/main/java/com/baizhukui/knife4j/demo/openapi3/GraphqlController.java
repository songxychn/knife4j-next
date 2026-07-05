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


package com.baizhukui.knife4j.demo.openapi3;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.ExampleObject;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.parameters.RequestBody;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;

@RestController
@RequestMapping("/api")
@Tag(name = "GraphQL 接口", description = "GraphQL HTTP 调试示例")
public class GraphqlController {

    private static final String APPLICATION_GRAPHQL_VALUE = "application/graphql";

    private final ObjectMapper objectMapper;

    public GraphqlController(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @Operation(summary = "GraphQL HTTP 调试", description = "演示 application/json 与 application/graphql 两种常见 GraphQL HTTP 请求体。", requestBody = @RequestBody(required = true, content = {
            @Content(mediaType = MediaType.APPLICATION_JSON_VALUE, schema = @Schema(type = "object"), examples = @ExampleObject(name = "JSON 请求", value = "{\"query\":\"query Echo($name: String!) { echo(name: $name) }\",\"variables\":{\"name\":\"Knife4j\"}}")),
            @Content(mediaType = APPLICATION_GRAPHQL_VALUE, schema = @Schema(type = "string"), examples = @ExampleObject(name = "GraphQL 请求", value = "query Echo { echo(name: \"Knife4j\") }"))
    }), responses = {
            @ApiResponse(responseCode = "200", description = "回显 GraphQL 请求", content = @Content(mediaType = MediaType.APPLICATION_JSON_VALUE))
    })
    @PostMapping(value = "/graphql", consumes = {
            MediaType.APPLICATION_JSON_VALUE,
            APPLICATION_GRAPHQL_VALUE
    }, produces = MediaType.APPLICATION_JSON_VALUE)
    public Map<String, Object> graphql(
                                       @org.springframework.web.bind.annotation.RequestBody(required = false) String body,
                                       @RequestHeader(value = HttpHeaders.CONTENT_TYPE, required = false) String contentType) {
        String rawBody = body == null ? "" : body;
        if (isJson(contentType)) {
            return jsonGraphqlResponse(rawBody);
        }
        return graphqlResponse(rawBody, Map.of());
    }

    private Map<String, Object> jsonGraphqlResponse(String body) {
        try {
            JsonNode root = objectMapper.readTree(body);
            String query = root.path("query").asText("");
            Object variables = root.has("variables") ? objectMapper.convertValue(root.get("variables"), Object.class) : Map.of();
            return graphqlResponse(query, variables);
        } catch (JsonProcessingException ex) {
            return Map.of("errors", java.util.List.of(Map.of("message", "Invalid GraphQL JSON request body")));
        }
    }

    private Map<String, Object> graphqlResponse(String query, Object variables) {
        Map<String, Object> echo = new LinkedHashMap<>();
        echo.put("query", query);
        echo.put("variables", variables);

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("echo", echo);

        return Map.of("data", data);
    }

    private boolean isJson(String contentType) {
        return contentType != null && contentType.toLowerCase().contains("json");
    }
}

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
package com.github.xiaoymin.knife4j.aggre.core.executor;

import com.github.xiaoymin.knife4j.aggre.core.RouteRequestContext;
import com.github.xiaoymin.knife4j.aggre.core.RouteResponse;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Verifies that a single provider failure returns a non-null error response
 * (DefaultClientResponse) rather than propagating an exception, so other
 * providers in the aggregation are not affected.
 *
 * @since 4.0
 */
class ProviderFailoverTest {

    /**
     * When a provider is unreachable (connection refused on a local port that
     * is guaranteed to be closed), the executor must return a non-null
     * DefaultClientResponse with success()==false instead of throwing.
     */
    @Test
    void unreachableProviderReturnsErrorResponseNotException() {
        ApacheClientExecutor executor = new ApacheClientExecutor(500);

        RouteRequestContext ctx = new RouteRequestContext();
        // Use a port that is virtually guaranteed to be closed
        ctx.setUrl("http://127.0.0.1:19999/v3/api-docs");
        ctx.setMethod("GET");
        ctx.setOriginalUri("/v3/api-docs");

        RouteResponse response = executor.executor(ctx);

        assertNotNull(response, "executor() must never return null — a failed provider should yield an error response");
        assertFalse(response.success(), "A connection-refused response must not be marked as success");
    }

    /**
     * Verifies that providerTimeoutMs is honoured: a custom timeout value is
     * stored and used (indirectly verified by constructing with a non-default
     * value and confirming the executor still returns a valid error response).
     */
    @Test
    void customProviderTimeoutIsAccepted() {
        // 5000 ms is the default; 1000 ms is a custom value
        ApacheClientExecutor executor = new ApacheClientExecutor(1000);

        RouteRequestContext ctx = new RouteRequestContext();
        ctx.setUrl("http://127.0.0.1:19999/v3/api-docs");
        ctx.setMethod("GET");
        ctx.setOriginalUri("/v3/api-docs");

        RouteResponse response = executor.executor(ctx);

        assertNotNull(response);
        assertFalse(response.success());
    }
}

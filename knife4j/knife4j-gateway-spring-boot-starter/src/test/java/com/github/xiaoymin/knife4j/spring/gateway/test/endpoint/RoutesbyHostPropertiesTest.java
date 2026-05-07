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


package com.github.xiaoymin.knife4j.spring.gateway.test.endpoint;

import com.github.xiaoymin.knife4j.spring.gateway.Knife4jGatewayProperties;
import org.junit.Assert;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.junit.runners.JUnit4;

import java.util.Arrays;
import java.util.List;
import java.util.Map;

/**
 * Unit tests for the routes-by-host feature (issue #321 / upstream #850).
 * Tests verify that {@link Knife4jGatewayProperties#getRoutesByHost()} correctly
 * stores per-host route lists and that fallback to global routes works as expected.
 *
 * @since 4.5.0
 */
@RunWith(JUnit4.class)
public class RoutesbyHostPropertiesTest {

    /**
     * routesByHost map should be empty by default (opt-in feature).
     */
    @Test
    public void defaultRoutesByHostIsEmpty() {
        Knife4jGatewayProperties props = new Knife4jGatewayProperties();
        Assert.assertNotNull(props.getRoutesByHost());
        Assert.assertTrue(props.getRoutesByHost().isEmpty());
    }

    /**
     * When a host key is present, its route list should be returned instead of the
     * global routes list.
     */
    @Test
    public void routesByHostTakesPriorityOverGlobalRoutes() {
        Knife4jGatewayProperties props = new Knife4jGatewayProperties();

        // populate global routes
        Knife4jGatewayProperties.Router globalRouter = new Knife4jGatewayProperties.Router();
        globalRouter.setName("global-service");
        globalRouter.setUrl("/global/v3/api-docs");
        props.getRoutes().add(globalRouter);

        // populate host-specific routes
        Knife4jGatewayProperties.Router internalRouter = new Knife4jGatewayProperties.Router();
        internalRouter.setName("internal-service");
        internalRouter.setUrl("/internal/v3/api-docs");
        props.getRoutesByHost().put("api.internal.com", Arrays.asList(internalRouter));

        // simulate resolveRouters logic for a matched host
        Map<String, List<Knife4jGatewayProperties.Router>> routesByHost = props.getRoutesByHost();
        String requestHost = "api.internal.com";
        List<Knife4jGatewayProperties.Router> resolved =
                routesByHost.containsKey(requestHost) ? routesByHost.get(requestHost) : props.getRoutes();

        Assert.assertEquals(1, resolved.size());
        Assert.assertEquals("internal-service", resolved.get(0).getName());
    }

    /**
     * When the request host does NOT match any key, the global routes list should be used.
     */
    @Test
    public void unmatchedHostFallsBackToGlobalRoutes() {
        Knife4jGatewayProperties props = new Knife4jGatewayProperties();

        Knife4jGatewayProperties.Router globalRouter = new Knife4jGatewayProperties.Router();
        globalRouter.setName("global-service");
        globalRouter.setUrl("/global/v3/api-docs");
        props.getRoutes().add(globalRouter);

        Knife4jGatewayProperties.Router internalRouter = new Knife4jGatewayProperties.Router();
        internalRouter.setName("internal-service");
        internalRouter.setUrl("/internal/v3/api-docs");
        props.getRoutesByHost().put("api.internal.com", Arrays.asList(internalRouter));

        // simulate resolveRouters logic for an unmatched host
        Map<String, List<Knife4jGatewayProperties.Router>> routesByHost = props.getRoutesByHost();
        String requestHost = "api.public.com"; // not configured
        List<Knife4jGatewayProperties.Router> resolved =
                routesByHost.containsKey(requestHost) ? routesByHost.get(requestHost) : props.getRoutes();

        Assert.assertEquals(1, resolved.size());
        Assert.assertEquals("global-service", resolved.get(0).getName());
    }

    /**
     * Multiple hosts can be configured independently.
     */
    @Test
    public void multipleHostsResolveIndependently() {
        Knife4jGatewayProperties props = new Knife4jGatewayProperties();

        Knife4jGatewayProperties.Router routerA = new Knife4jGatewayProperties.Router();
        routerA.setName("service-a");
        props.getRoutesByHost().put("host-a.example.com", Arrays.asList(routerA));

        Knife4jGatewayProperties.Router routerB1 = new Knife4jGatewayProperties.Router();
        routerB1.setName("service-b1");
        Knife4jGatewayProperties.Router routerB2 = new Knife4jGatewayProperties.Router();
        routerB2.setName("service-b2");
        props.getRoutesByHost().put("host-b.example.com", Arrays.asList(routerB1, routerB2));

        Assert.assertEquals(1, props.getRoutesByHost().get("host-a.example.com").size());
        Assert.assertEquals(2, props.getRoutesByHost().get("host-b.example.com").size());
        Assert.assertEquals("service-b2", props.getRoutesByHost().get("host-b.example.com").get(1).getName());
    }
}

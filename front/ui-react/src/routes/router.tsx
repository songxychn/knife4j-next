import { createHashRouter } from 'react-router';
import App from '../App.tsx';
import {
  Schema,
  Authorize,
  CookieSession,
  GlobalParam,
  OfficeDoc,
  Settings,
  MarkdownDocument,
  ApiDoc,
  ApiDebug,
  OpenApiView,
  ScriptView,
} from './LazyPages';

import Home from '../pages/Home.tsx';

import ApiHome from '../pages/api/ApiHome.tsx';

const router = createHashRouter([
  {
    path: '/',
    element: <App />,
    children: [
      {
        index: true,
        element: <Home />,
      },
      {
        path: ':group/home',
        element: <Home />,
      },
      {
        path: ':group/schema',
        element: <Schema />,
      },
      {
        path: ':group/schema/:schemaName',
        element: <Schema />,
      },
      {
        path: ':group/authorize',
        element: <Authorize />,
      },
      {
        path: ':group/globalParam',
        element: <GlobalParam />,
      },
      {
        path: ':group/cookieSession',
        element: <CookieSession />,
      },
      {
        path: ':group/Officdoc',
        element: <OfficeDoc />,
      },
      {
        path: ':group/Settings',
        element: <Settings />,
      },
      {
        path: ':group/:tag/:operaterId',
        element: <ApiHome />,
      },
      {
        path: ':group/:tag/:operaterId/doc',
        element: <ApiDoc />,
      },
      {
        path: ':group/:tag/:operaterId/debug',
        element: <ApiDebug />,
      },
      {
        path: ':group/:tag/:operaterId/openapi',
        element: <OpenApiView />,
      },
      {
        path: ':group/:tag/:operaterId/script',
        element: <ScriptView />,
      },
      // API mode routes and this route have equal specificity: declaration order
      // keeps a Markdown tag's /doc|debug|openapi|script URL on the API page.
      // Existing Markdown document URLs end in two numeric indexes and still match here.
      {
        path: ':group/markdown/:groupIndex/:itemIndex',
        element: <MarkdownDocument />,
      },
    ],
  },
  {
    path: 'test',
    element: <Home />,
  },
]);

export default router;

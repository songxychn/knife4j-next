import { createHashRouter } from 'react-router-dom';
import App from '../App.tsx';

import Home from '../pages/Home.tsx';
import Schema from '../pages/Schema.tsx';
import Authorize from '../pages/Authorize.tsx';
import GlobalParam from '../pages/document/GlobalParam.tsx';
import OfficeDoc from '../pages/document/OfficeDoc.tsx';
import Settings from '../pages/document/Settings.tsx';

import ApiHome from '../pages/api/ApiHome.tsx';
import ApiDoc from '../pages/api/ApiDoc.tsx';
import ApiDebug from '../pages/api/ApiDebug.tsx';
import OpenApiView from '../pages/api/OpenApiView.tsx';
import ScriptView from '../pages/api/ScriptView.tsx';

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
    ],
  },
  {
    path: 'test',
    element: <Home />,
  },
]);

export default router;

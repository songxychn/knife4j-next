import { lazy } from 'react';

export const Schema = lazy(() => import('../pages/Schema.tsx'));
export const Authorize = lazy(() => import('../pages/Authorize.tsx'));
export const CookieSession = lazy(() => import('../pages/document/CookieSession.tsx'));
export const GlobalParam = lazy(() => import('../pages/document/GlobalParam.tsx'));
export const OfficeDoc = lazy(() => import('../pages/document/OfficeDoc.tsx'));
export const Settings = lazy(() => import('../pages/document/Settings.tsx'));
export const MarkdownDocument = lazy(() => import('../pages/document/MarkdownDocument.tsx'));
export const ApiDoc = lazy(() => import('../pages/api/ApiDoc.tsx'));
export const ApiDebug = lazy(() => import('../pages/api/ApiDebug.tsx'));
export const OpenApiView = lazy(() => import('../pages/api/OpenApiView.tsx'));
export const ScriptView = lazy(() => import('../pages/api/ScriptView.tsx'));

import {
  getOpenApiSpecificationFeatures,
  resolvePhysicalJsonPointer,
  type AuthValues,
  type Oas32SecuritySchemeObject,
  type OpenApiObjectLocation,
  type OpenApiOperation,
  type SchemeValue,
} from 'knife4j-core';
import type {
  ResourceDiagnostic,
  ResourceGraphEdge,
  ResourceGraphObject,
  ResourceGraphSnapshot,
} from '../schema/externalResourceGraph';
import { sha256Hex } from '../utils/stableJson';

type RecordValue = Record<string, unknown>;
type Location = OpenApiObjectLocation;

export interface Oas32SecurityProjectionLimits {
  readonly maxReferenceDepth: number;
  /** Maximum scheme/Reference visits shared by requirements and the entry catalog. */
  readonly maxWork: number;
}

export const OAS32_SECURITY_PROJECTION_LIMITS: Readonly<Oas32SecurityProjectionLimits> = Object.freeze({
  maxReferenceDepth: 20,
  maxWork: 50_000,
});
const componentName = /^[A-Za-z0-9._-]+$/;
// ':'/'@' cannot occur in a valid component key. JSON tuples keep owner/pointer unambiguous.
const uriCredentialNamespace = '@oas32-security:';

export type Oas32SecurityUnavailableReason =
  | 'unsupported-version'
  | 'operation-mismatch'
  | 'invalid-security'
  | 'invalid-requirement'
  | 'invalid-component-name'
  | 'invalid-scheme'
  | 'missing-edge'
  | 'ambiguous-edge'
  | 'not-loaded'
  | 'reference-failed'
  | 'target-missing'
  | 'wrong-kind'
  | 'cycle'
  | 'depth-limit'
  | 'work-limit';

export interface Oas32SecurityDiagnostic {
  readonly code: Oas32SecurityUnavailableReason;
  readonly source: Location;
  /** Original C failure details remain available; no new fetch/URI interpretation. */
  readonly graphDiagnostics: readonly ResourceDiagnostic[];
}

interface SchemeResolutionBase {
  readonly source: Location;
  readonly chain: readonly Location[];
  readonly credentialKey?: string;
  readonly bindingKind?: 'named' | 'uri';
}

export type Oas32SecuritySchemeResolution = SchemeResolutionBase &
  (
    | {
        readonly status: 'resolved';
        readonly target: Location & ResourceGraphObject;
        readonly scheme: Readonly<Oas32SecuritySchemeObject>;
        readonly credentialKey: string;
        readonly bindingKind: 'named' | 'uri';
        readonly descriptionSource?: Location;
      }
    | { readonly status: 'unavailable'; readonly diagnostic: Oas32SecurityDiagnostic }
  );

export interface Oas32SecurityMember {
  readonly key: string;
  readonly source: Location;
  /** Original order and duplicate scopes/roles are retained without inspecting tokens. */
  readonly values?: readonly string[];
  readonly valueKind: 'scopes' | 'roles' | 'unknown';
  readonly resolution: Oas32SecuritySchemeResolution;
  readonly diagnostic?: Oas32SecurityDiagnostic;
}

export interface Oas32SecurityBranch {
  readonly index: number;
  readonly source: Location;
  readonly valid: boolean;
  readonly anonymous: boolean;
  readonly members: readonly Oas32SecurityMember[];
  readonly diagnostic?: Oas32SecurityDiagnostic;
}

export interface Oas32SecurityProjection {
  readonly status: 'ready' | 'unavailable';
  readonly generation: number;
  readonly entryRetrievalUri: string;
  readonly operationIdentity?: string;
  readonly declaration: 'absent' | 'empty' | 'requirements' | 'invalid';
  readonly inherited: boolean;
  readonly source?: Location;
  readonly branches: readonly Oas32SecurityBranch[];
  /** Entry component bindings, including unresolved ones, for the Authorize view. */
  readonly schemes: readonly { readonly name: string; readonly resolution: Oas32SecuritySchemeResolution }[];
  readonly diagnostic?: Oas32SecurityDiagnostic;
  readonly work: number;
}

const record = (value: unknown): value is RecordValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const owns = (value: object, name: string) => Object.prototype.hasOwnProperty.call(value, name);
const escapePointer = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1');
const locationKey = (location: Pick<Location, 'ownerRetrievalUri' | 'pointer'>) =>
  JSON.stringify([location.ownerRetrievalUri, location.pointer]);
const child = (source: Location, key: string, value: unknown): Location =>
  Object.freeze({
    ownerRetrievalUri: source.ownerRetrievalUri,
    pointer: `${source.pointer}/${escapePointer(key)}`,
    value,
  });

function schemeShape(value: RecordValue): value is RecordValue & Oas32SecuritySchemeObject {
  if (value.description !== undefined && typeof value.description !== 'string') return false;
  if (value.deprecated !== undefined && typeof value.deprecated !== 'boolean') return false;
  if (value.oauth2MetadataUrl !== undefined && typeof value.oauth2MetadataUrl !== 'string') return false;
  switch (value.type) {
    case 'apiKey':
      return typeof value.name === 'string' && ['header', 'query', 'cookie'].includes(String(value.in));
    case 'http':
      return typeof value.scheme === 'string';
    case 'oauth2':
      return record(value.flows);
    case 'openIdConnect':
      return typeof value.openIdConnectUrl === 'string';
    case 'mutualTLS':
      return true;
    default:
      return false;
  }
}

/** Registry-only OAS 3.2 projection. The caller supplies E's actual operation from this snapshot. */
export function projectOas32Security(
  snapshot: ResourceGraphSnapshot,
  operation?: OpenApiOperation,
  limits: Partial<Oas32SecurityProjectionLimits> = {},
): Oas32SecurityProjection {
  const cap = (value: number | undefined, maximum: number) =>
    value === undefined || !Number.isFinite(value) ? maximum : Math.max(0, Math.min(Math.floor(value), maximum));
  const maxWork = cap(limits.maxWork, OAS32_SECURITY_PROJECTION_LIMITS.maxWork);
  const maxDepth = cap(limits.maxReferenceDepth, OAS32_SECURITY_PROJECTION_LIMITS.maxReferenceDepth);
  let work = 0;
  const objects = new Map<string, ResourceGraphObject[]>();
  for (const object of snapshot.objectLocations) {
    const key = locationKey(object);
    const entries = objects.get(key) ?? [];
    entries.push(object);
    objects.set(key, entries);
  }
  const edges = new Map<string, ResourceGraphEdge[]>();
  for (const edge of snapshot.edges) {
    const key = JSON.stringify([edge.sourceRetrievalUri, edge.sourcePointer, edge.kind]);
    const entries = edges.get(key) ?? [];
    entries.push(edge);
    edges.set(key, entries);
  }
  const diagnostics = new Map<string, ResourceDiagnostic[]>();
  for (const item of snapshot.diagnostics) {
    const key = JSON.stringify([item.sourceRetrievalUriHash, item.sourcePointer]);
    const entries = diagnostics.get(key) ?? [];
    entries.push(item);
    diagnostics.set(key, entries);
  }
  const ownerHashes = new Map<string, string>();
  const diagnostic = (
    code: Oas32SecurityUnavailableReason,
    source: Location,
    kind?: ResourceGraphEdge['kind'],
  ): Oas32SecurityDiagnostic => {
    const ownerHash = ownerHashes.get(source.ownerRetrievalUri) ?? sha256Hex(source.ownerRetrievalUri);
    ownerHashes.set(source.ownerRetrievalUri, ownerHash);
    const entries = diagnostics.get(JSON.stringify([ownerHash, source.pointer])) ?? [];
    return Object.freeze({
      code,
      source,
      graphDiagnostics: Object.freeze(entries.filter((item) => !kind || item.referenceKind === kind)),
    });
  };
  const unavailable = (
    source: Location,
    code: Oas32SecurityUnavailableReason,
    chain: readonly Location[] = [],
    named?: string,
    kind?: ResourceGraphEdge['kind'],
  ): Oas32SecuritySchemeResolution =>
    Object.freeze({
      status: 'unavailable',
      source,
      chain: Object.freeze([...chain]),
      diagnostic: diagnostic(code, source, kind),
      ...(named !== undefined ? { credentialKey: named, bindingKind: 'named' as const } : {}),
    });
  const readTarget = (target: Pick<Location, 'ownerRetrievalUri' | 'pointer'>, kind: ResourceGraphObject['kind']) => {
    const object = objects.get(locationKey(target))?.find((candidate) => candidate.kind === kind);
    if (!object) return { error: 'wrong-kind' as const };
    const node = snapshot.nodes.get(target.ownerRetrievalUri);
    if (!node) return { error: 'target-missing' as const };
    const resolved = resolvePhysicalJsonPointer(node.document, target.pointer);
    if (!resolved.found) return { error: 'target-missing' as const };
    return { target: Object.freeze({ ...object, value: resolved.value }) };
  };
  const followEdge = (site: Location, kind: 'reference-object' | 'security-requirement') => {
    const candidates = edges.get(JSON.stringify([site.ownerRetrievalUri, site.pointer, kind])) ?? [];
    if (!candidates.length) return { error: 'missing-edge' as const };
    if (candidates.length !== 1) return { error: 'ambiguous-edge' as const };
    const edge = candidates[0];
    if (edge.state === 'pending') return { error: 'not-loaded' as const };
    if (edge.state === 'failed') {
      const codes = diagnostic('reference-failed', site, kind).graphDiagnostics.map((item) => item.code);
      return {
        error: codes.includes('DOCUMENT_KIND_MISMATCH')
          ? ('wrong-kind' as const)
          : codes.includes('REFERENCE_CYCLE')
            ? ('cycle' as const)
            : ('reference-failed' as const),
      };
    }
    if (!edge.target) return { error: 'target-missing' as const };
    return readTarget(edge.target, 'security-scheme');
  };
  const resolveScheme = (initial: Location, named?: string): Oas32SecuritySchemeResolution => {
    let location = initial;
    let description: string | undefined;
    let descriptionSource: Location | undefined;
    const chain: Location[] = [];
    const seen = new Set<string>();
    const failure = (
      source: Location,
      code: Oas32SecurityUnavailableReason,
      kind?: ResourceGraphEdge['kind'],
    ): Oas32SecuritySchemeResolution =>
      Object.freeze({ ...unavailable(source, code, chain, named, kind), source: initial });
    for (let depth = 0; ; depth++) {
      if (work >= maxWork) return failure(location, 'work-limit');
      work++;
      if (seen.has(locationKey(location))) return failure(location, 'cycle');
      seen.add(locationKey(location));
      chain.push(location);
      const indexed = readTarget(location, 'security-scheme');
      if (indexed.error) return failure(location, indexed.error);
      const target = indexed.target!;
      const value = target.value;
      if (!record(value)) return failure(location, 'invalid-scheme');
      if (owns(value, '$ref')) {
        if (typeof value.$ref !== 'string') return failure(location, 'invalid-scheme');
        if (description === undefined && typeof value.description === 'string') {
          description = value.description;
          descriptionSource = child(location, 'description', value.description);
        }
        const site = child(location, '$ref', value.$ref);
        if (depth >= maxDepth) return failure(site, 'depth-limit', 'reference-object');
        const next = followEdge(site, 'reference-object');
        if (next.error) return failure(site, next.error, 'reference-object');
        location = next.target!;
        continue;
      }
      if (!schemeShape(value)) return failure(location, 'invalid-scheme');
      return Object.freeze({
        status: 'resolved',
        source: initial,
        target,
        chain: Object.freeze(chain),
        scheme: Object.freeze({ ...value, ...(description !== undefined ? { description } : {}) }),
        credentialKey: named ?? `${uriCredentialNamespace}${locationKey(target)}`,
        bindingKind: named === undefined ? 'uri' : 'named',
        ...(descriptionSource ? { descriptionSource } : {}),
      });
    }
  };

  const entry: Location = Object.freeze({
    ownerRetrievalUri: snapshot.entryRetrievalUri,
    pointer: '#',
    value: snapshot.nodes.get(snapshot.entryRetrievalUri)?.document,
  });
  const base = {
    generation: snapshot.generation,
    entryRetrievalUri: snapshot.entryRetrievalUri,
    ...(operation ? { operationIdentity: operation.identity } : {}),
  };
  const failed = (code: Oas32SecurityUnavailableReason, source: Location): Oas32SecurityProjection =>
    Object.freeze({
      ...base,
      status: 'unavailable',
      declaration: 'invalid',
      inherited: false,
      source,
      branches: [],
      schemes: [],
      diagnostic: diagnostic(code, source),
      work,
    });
  if (!record(entry.value) || getOpenApiSpecificationFeatures(entry.value.openapi)?.family !== '3.2')
    return failed('unsupported-version', entry);
  const components =
    record(entry.value.components) && record(entry.value.components.securitySchemes)
      ? entry.value.components.securitySchemes
      : {};
  let owner = entry;
  if (operation) {
    const actual = readTarget(operation.rawOperation, 'operation');
    if (
      operation.documentUri !== snapshot.entryRetrievalUri ||
      !actual.target ||
      actual.target.value !== operation.rawOperation.value
    )
      return failed('operation-mismatch', operation.rawOperation);
    if (record(actual.target.value) && owns(actual.target.value, 'security')) owner = actual.target;
  }
  const inherited = !!operation && owner === entry && owns(entry.value, 'security');
  const value = (owner.value as RecordValue).security;
  const hasDeclaration = owns(owner.value as RecordValue, 'security');
  const source = hasDeclaration ? child(owner, 'security', value) : undefined;
  if (hasDeclaration && !Array.isArray(value)) return failed('invalid-security', source!);
  const branches: Oas32SecurityBranch[] = (Array.isArray(value) ? value : []).map((raw: unknown, index: number) => {
    const branchSource = child(source!, String(index), raw);
    if (!record(raw))
      return Object.freeze({
        index,
        source: branchSource,
        valid: false,
        anonymous: false,
        members: [],
        diagnostic: diagnostic('invalid-requirement', branchSource),
      });
    const members: Oas32SecurityMember[] = Object.entries(raw).map(([key, required]) => {
      const memberSource = child(branchSource, key, required);
      const named = owns(components, key) ? key : undefined;
      const linked = followEdge(memberSource, 'security-requirement');
      const resolution =
        named !== undefined && !componentName.test(named)
          ? unavailable(memberSource, 'invalid-component-name')
          : linked.error
            ? unavailable(memberSource, linked.error, [], named, 'security-requirement')
            : resolveScheme(linked.target!, named);
      const values =
        Array.isArray(required) && required.every((item) => typeof item === 'string')
          ? (Object.freeze([...required]) as readonly string[])
          : undefined;
      const valueKind =
        resolution.status === 'resolved'
          ? ['oauth2', 'openIdConnect'].includes(resolution.scheme.type)
            ? 'scopes'
            : 'roles'
          : 'unknown';
      return Object.freeze({
        key,
        source: memberSource,
        values,
        valueKind,
        resolution,
        ...(!values ? { diagnostic: diagnostic('invalid-requirement', memberSource) } : {}),
      });
    });
    return Object.freeze({
      index,
      source: branchSource,
      valid: members.every((member) => !member.diagnostic),
      anonymous: members.length === 0,
      members: Object.freeze(members),
    });
  });
  const schemes = Object.entries(components).map(([name, value]) => {
    const location: Location = Object.freeze({
      ownerRetrievalUri: entry.ownerRetrievalUri,
      pointer: `#/components/securitySchemes/${escapePointer(name)}`,
      value,
    });
    return Object.freeze({
      name,
      resolution: componentName.test(name)
        ? resolveScheme(location, name)
        : unavailable(location, 'invalid-component-name'),
    });
  });
  return Object.freeze({
    ...base,
    status: 'ready',
    declaration: !hasDeclaration ? 'absent' : branches.length ? 'requirements' : 'empty',
    inherited,
    ...(source ? { source } : {}),
    branches: Object.freeze(branches),
    schemes: Object.freeze(schemes),
    work,
  });
}

export type Oas32SecurityCapabilityIssue =
  | 'unavailable-scheme'
  | 'invalid-requirement'
  | 'credential-mismatch'
  | 'invalid-credential'
  | 'unsupported-http-scheme'
  | 'unsupported-token-type'
  | 'openid-connect-not-implemented'
  | 'browser-client-certificate-unmanaged'
  | 'browser-cookie-unwritable'
  | 'browser-forbidden-header'
  | 'invalid-transport-name'
  | 'transport-implementation-limit'
  | 'transport-conflict';

interface TransportField {
  readonly in: 'header' | 'query' | 'cookie';
  readonly name: string;
}

export interface Oas32SecurityMemberPlan {
  readonly member: Oas32SecurityMember;
  readonly credentialStatus: 'missing' | 'filled' | 'mismatch' | 'invalid';
  readonly canDisplay: boolean;
  readonly canPreview: boolean;
  readonly canExecute: boolean;
  readonly transport?: TransportField;
  readonly issues: readonly Oas32SecurityCapabilityIssue[];
}

export interface Oas32SecurityBranchPlan {
  readonly index: number;
  readonly anonymous: boolean;
  /** Only filled, serializable browser credentials. Never a server authorization/scopes claim. */
  readonly complete: boolean;
  readonly members: readonly Oas32SecurityMemberPlan[];
}

export interface Oas32SecurityPlan {
  readonly status: 'ready' | 'unavailable' | 'invalid-selection';
  readonly selectedIndex: number | null;
  readonly complete: boolean;
  readonly branches: readonly Oas32SecurityBranchPlan[];
  /** Only selected executable automatic auth; handwritten headers/globals are separate inputs. */
  readonly auth: AuthValues;
  readonly securityKeys: string[];
  /** Only selected previewable automatic auth (e.g. cookie); do not send this with Fetch. */
  readonly previewAuth: AuthValues;
  readonly previewSecurityKeys: string[];
}

const headerName = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const bearerToken = /^[A-Za-z0-9._~+/-]+=*$/;
const filled = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const safeHeaderValue = (value: string) =>
  ![...value].some((character) => {
    const code = character.charCodeAt(0);
    return (code < 32 && code !== 9) || code === 127 || code > 255;
  });
const sameName = (field: TransportField, candidate: string) =>
  field.in === 'header' ? field.name.toLowerCase() === candidate.toLowerCase() : field.name === candidate;
const forbiddenHeaders = new Set([
  'accept-charset',
  'accept-encoding',
  'access-control-request-headers',
  'access-control-request-method',
  'connection',
  'content-length',
  'cookie',
  'cookie2',
  'date',
  'dnt',
  'expect',
  'host',
  'keep-alive',
  'origin',
  'referer',
  'set-cookie',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'via',
]);

function forbiddenHeader(name: string, value?: string): boolean {
  const lower = name.toLowerCase();
  if (forbiddenHeaders.has(lower) || lower.startsWith('proxy-') || lower.startsWith('sec-')) return true;
  if (!['x-http-method', 'x-http-method-override', 'x-method-override'].includes(lower) || value === undefined)
    return false;
  // Fetch's get/decode/split preserves quoted strings and strips only SP/HTAB.
  let start = 0;
  let quoted = false;
  for (let index = 0; index <= value.length; index++) {
    if (quoted && value[index] === '\\') {
      index++;
      continue;
    }
    if (value[index] === '"') quoted = !quoted;
    if (index === value.length || (!quoted && value[index] === ',')) {
      const method = value
        .slice(start, index)
        .replace(/^[\t ]+|[\t ]+$/g, '')
        .toUpperCase();
      if (['CONNECT', 'TRACE', 'TRACK'].includes(method)) return true;
      start = index + 1;
    }
  }
  return false;
}

interface PreparedMember {
  view: Oas32SecurityMemberPlan;
  credential?: SchemeValue;
}

function prepareMember(member: Oas32SecurityMember, credentials?: AuthValues): PreparedMember {
  const issues: Oas32SecurityCapabilityIssue[] = [];
  let credentialStatus: Oas32SecurityMemberPlan['credentialStatus'] = 'missing';
  let transport: TransportField | undefined;
  let credential: SchemeValue | undefined;
  const result = (): PreparedMember => ({
    view: Object.freeze({
      member,
      credentialStatus,
      canDisplay: member.resolution.status === 'resolved',
      canPreview: !!credential && !issues.some((issue) => !issue.startsWith('browser-')),
      canExecute: !!credential && issues.length === 0,
      ...(transport ? { transport: Object.freeze(transport) } : {}),
      issues: Object.freeze(issues),
    }),
    credential,
  });
  if (member.diagnostic) {
    issues.push('invalid-requirement');
    return result();
  }
  if (member.resolution.status !== 'resolved') {
    issues.push('unavailable-scheme');
    return result();
  }
  const { scheme, credentialKey } = member.resolution;
  const map = credentials?.bySecurityKey;
  const candidate: unknown = map && owns(map, credentialKey) ? map[credentialKey] : undefined;
  if (scheme.type === 'apiKey') transport = { in: scheme.in!, name: scheme.name! };
  else if (scheme.type === 'http' || scheme.type === 'oauth2' || scheme.type === 'openIdConnect')
    transport = { in: 'header', name: 'Authorization' };
  if (scheme.type === 'mutualTLS') {
    issues.push('browser-client-certificate-unmanaged');
    return result();
  }
  if (scheme.type === 'openIdConnect') {
    issues.push('openid-connect-not-implemented');
    return result();
  }
  if (scheme.type === 'http' && !['basic', 'bearer'].includes(scheme.scheme!.toLowerCase())) {
    issues.push('unsupported-http-scheme');
    return result();
  }
  if (transport) {
    if (!transport.name || (transport.in !== 'query' && !headerName.test(transport.name)))
      issues.push('invalid-transport-name');
    // Current core's ordinary-object assignment loses this legal field. This is
    // an implementation gap, not an OAS/Fetch restriction; Phase 2 must close it.
    if (transport.in !== 'cookie' && transport.name === '__proto__') issues.push('transport-implementation-limit');
    if (transport.in === 'cookie') issues.push('browser-cookie-unwritable');
    if (transport.in === 'header' && forbiddenHeader(transport.name)) issues.push('browser-forbidden-header');
  }
  if (candidate === undefined) return result();
  if (!record(candidate) || candidate.type !== scheme.type) {
    credentialStatus = 'mismatch';
    issues.push('credential-mismatch');
    return result();
  }
  if (scheme.type === 'apiKey') {
    if (candidate.in !== scheme.in || typeof candidate.name !== 'string' || !sameName(transport!, candidate.name)) {
      credentialStatus = 'mismatch';
      issues.push('credential-mismatch');
      return result();
    }
    if (!filled(candidate.value)) return result();
    if (transport!.in === 'header' && !safeHeaderValue(candidate.value)) issues.push('invalid-credential');
    if (transport!.in === 'cookie' && !/^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]+$/.test(candidate.value))
      issues.push('invalid-credential');
    if (
      transport!.in === 'header' &&
      forbiddenHeader(transport!.name, candidate.value) &&
      !issues.includes('browser-forbidden-header')
    )
      issues.push('browser-forbidden-header');
    credential = { type: 'apiKey', in: scheme.in!, name: scheme.name!, value: candidate.value };
  } else if (scheme.type === 'http') {
    const normalized = scheme.scheme!.toLowerCase();
    if (typeof candidate.scheme !== 'string' || candidate.scheme.toLowerCase() !== normalized) {
      credentialStatus = 'mismatch';
      issues.push('credential-mismatch');
      return result();
    }
    if (normalized === 'bearer') {
      if (!filled(candidate.token)) return result();
      if (!bearerToken.test(candidate.token)) issues.push('invalid-credential');
      credential = { type: 'http', scheme: 'bearer', token: candidate.token };
    } else {
      if (typeof candidate.username !== 'string' || typeof candidate.password !== 'string') {
        credentialStatus = 'invalid';
        issues.push('invalid-credential');
        return result();
      }
      if (!candidate.username && !candidate.password) return result();
      if (candidate.username.includes(':')) issues.push('invalid-credential');
      credential = { type: 'http', scheme: 'basic', username: candidate.username, password: candidate.password };
    }
  } else if (scheme.type === 'oauth2') {
    if (!filled(candidate.accessToken)) return result();
    if (typeof candidate.tokenType !== 'string' || candidate.tokenType.toLowerCase() !== 'bearer')
      issues.push('unsupported-token-type');
    if (!bearerToken.test(candidate.accessToken)) issues.push('invalid-credential');
    if (!issues.length)
      credential = { type: 'oauth2', accessToken: candidate.accessToken, tokenType: candidate.tokenType as string };
  }
  credentialStatus = issues.includes('invalid-credential') ? 'invalid' : 'filled';
  return result();
}

/** Builds fresh selected auth only. Does not inspect tokens for scopes or merge legacy fallback fields. */
export function planOas32Security(
  projection: Oas32SecurityProjection,
  credentials?: AuthValues,
  explicitIndex?: number,
): Oas32SecurityPlan {
  const prepared = projection.branches.map((branch) => {
    const members = branch.members.map((member) => prepareMember(member, credentials));
    const conflicting = new Set<number>();
    const fields = new Map<string, { indices: number[]; bindings: Set<string | undefined> }>();
    const cookies: number[] = [];
    for (const [index, { view }] of members.entries()) {
      if (!view.transport) continue;
      const { in: place, name } = view.transport;
      const fieldKey = JSON.stringify([place, place === 'header' ? name.toLowerCase() : name]);
      const field = fields.get(fieldKey) ?? { indices: [], bindings: new Set<string | undefined>() };
      field.indices.push(index);
      field.bindings.add(view.member.resolution.credentialKey);
      fields.set(fieldKey, field);
      if (place === 'cookie') cookies.push(index);
    }
    for (const field of fields.values()) {
      if (field.bindings.size > 1) for (const index of field.indices) conflicting.add(index);
    }
    const cookieHeaders = fields.get(JSON.stringify(['header', 'cookie']));
    if (cookies.length && cookieHeaders) {
      for (const index of [...cookies, ...cookieHeaders.indices]) conflicting.add(index);
    }
    for (const index of conflicting) {
      const member = members[index];
      member.view = Object.freeze({
        ...member.view,
        canPreview: false,
        canExecute: false,
        issues: Object.freeze([...member.view.issues, 'transport-conflict' as const]),
      });
    }
    const view: Oas32SecurityBranchPlan = Object.freeze({
      index: branch.index,
      anonymous: branch.anonymous,
      complete: branch.valid && members.every((member) => member.view.canExecute),
      members: Object.freeze(members.map((member) => member.view)),
    });
    return { view, members };
  });
  const invalidSelection =
    explicitIndex !== undefined &&
    (!Number.isInteger(explicitIndex) || explicitIndex < 0 || explicitIndex >= prepared.length);
  const selectedIndex =
    projection.status !== 'ready' || invalidSelection
      ? null
      : (explicitIndex ?? prepared.find((branch) => branch.view.complete)?.view.index ?? (prepared.length ? 0 : null));
  const selectAuth = (preview: boolean) => {
    const selected = selectedIndex === null ? [] : prepared[selectedIndex].members;
    const values = new Map<string, SchemeValue>();
    for (const member of selected) {
      if ((preview ? member.view.canPreview : member.view.canExecute) && member.credential)
        values.set(member.view.member.resolution.credentialKey!, { ...member.credential });
    }
    return { auth: { bySecurityKey: Object.fromEntries(values) }, securityKeys: [...values.keys()] };
  };
  const execution = selectAuth(false);
  const preview = selectAuth(true);
  return Object.freeze({
    status: projection.status === 'unavailable' ? 'unavailable' : invalidSelection ? 'invalid-selection' : 'ready',
    selectedIndex,
    complete:
      projection.status === 'ready' &&
      !invalidSelection &&
      (selectedIndex === null || prepared[selectedIndex].view.complete),
    branches: Object.freeze(prepared.map((branch) => branch.view)),
    auth: execution.auth,
    securityKeys: execution.securityKeys,
    previewAuth: preview.auth,
    previewSecurityKeys: preview.securityKeys,
  });
}

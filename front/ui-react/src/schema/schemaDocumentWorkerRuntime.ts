import { generateSchemaExample } from './schemaExampleGeneration';
import {
  createSchemaDocumentSession,
  evaluateSchemaDocumentDirectionallyIgnoringProperties,
  type SchemaDocumentSession,
} from './schemaDocumentSession';
import type { SchemaWorkerRequest, SchemaWorkerResponse } from './schemaDocumentWorkerProtocol';
import { observeSelectedAuthoredExample } from './schemaExampleAuthored';

/** One registry owner and one loaded graph per Worker. The protocol carries no URL loader or credentials. */
export class SchemaDocumentWorkerHandler {
  private current: { id: number; session: SchemaDocumentSession } | null = null;

  public constructor(private readonly progress?: (value: SchemaWorkerResponse) => void) {}

  public async handle(request: SchemaWorkerRequest): Promise<SchemaWorkerResponse> {
    try {
      if (this.current?.id !== request.sourceId) {
        const source = request.source;
        if (!source || source.id !== request.sourceId) throw new Error('Schema Worker source is no longer registered.');
        this.dispose();
        const session = await createSchemaDocumentSession(source.document, source.retrievalUri, {
          resourceDocuments: source.resourceDocuments,
          registrationContext: source.registrationContext,
        });
        this.current = { id: source.id, session };
      }
      const session = this.current.session;
      const command = request.command;
      let result: SchemaWorkerResponse & { result: unknown };
      switch (command.method) {
        case 'open':
          return { id: request.id, sourceId: request.sourceId, result: null };
        case 'resolve':
          result = { id: request.id, sourceId: request.sourceId, result: await session.resolve(command.reference) };
          break;
        case 'evaluate':
          result = {
            id: request.id,
            sourceId: request.sourceId,
            result: await session.evaluate(command.reference, command.instance),
          };
          break;
        case 'directional':
          result = {
            id: request.id,
            sourceId: request.sourceId,
            result: await evaluateSchemaDocumentDirectionallyIgnoringProperties(
              session,
              command.reference,
              command.instance,
              command.direction,
              command.ignoredProperties ?? [],
            ),
          };
          break;
        case 'generate': {
          const unbind = observeSelectedAuthoredExample(session, (authored) =>
            this.progress?.({ id: request.id, sourceId: request.sourceId, authored }),
          );
          try {
            result = {
              id: request.id,
              sourceId: request.sourceId,
              result: await generateSchemaExample(session, command.reference, command.options),
            };
          } finally {
            unbind();
          }
          break;
        }
      }
      return result;
    } catch (error) {
      const value = error as Error & { code?: string; details?: unknown };
      return {
        id: request.id,
        sourceId: request.sourceId,
        error: {
          name: value.name ?? 'Error',
          message: value.message ?? String(error),
          ...(value.code === undefined ? {} : { code: value.code }),
          ...(value.details === undefined ? {} : { details: value.details }),
        },
      };
    }
  }

  public dispose(): void {
    this.current?.session.dispose();
    this.current = null;
  }
}

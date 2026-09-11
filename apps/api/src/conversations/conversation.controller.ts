import { PassThrough, type Writable } from 'node:stream';
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { ConversationMode } from '../generated/prisma/client.js';
import type { FastifyReply } from 'fastify';

import type { AuthenticatedRequest } from '../identity/auth.types.js';
import { ConversationService } from './conversation.service.js';
import {
  StreamEventHub,
  type ConversationStreamEvent,
} from './stream-event-hub.js';

interface CreateConversationBody {
  mode?: ConversationMode;
  title?: string;
}

interface MessageBody {
  content: string;
  idempotencyKey?: string;
  modelKey?: string;
}

interface RenameBody {
  title: string;
}

interface RoutingDecisionBody {
  candidates: Array<{ registryEntryId: string }>;
  inputSnapshot: Record<string, unknown>;
  reason: string;
  selectedRegistryEntryId: string;
}

interface TryAnotherBody {
  modelKey?: string;
}

interface SelectResponseBody {
  responseId: string;
}

function authentication(request: AuthenticatedRequest) {
  if (!request.authentication)
    throw new Error('Authentication guard did not run');
  return request.authentication;
}

function idempotencyKey(
  request: AuthenticatedRequest,
  body: { idempotencyKey?: string },
): string {
  const value = request.headers['idempotency-key'] ?? body.idempotencyKey;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Idempotency-Key header is required');
  }
  return value.trim();
}

function writeEvent(stream: Writable, event: ConversationStreamEvent): void {
  stream.write(
    `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`,
  );
}

function isTerminal(event: ConversationStreamEvent): boolean {
  if (event.type === 'run.error') return true;
  return (
    event.type === 'run.status' &&
    ['cancelled', 'completed'].includes(String(event.data.status))
  );
}

@Controller('conversations')
export class ConversationController {
  public constructor(
    private readonly conversations: ConversationService,
    private readonly events: StreamEventHub,
  ) {}

  @Post()
  public async create(
    @Req() request: AuthenticatedRequest,
    @Body() body: CreateConversationBody,
  ) {
    const auth = authentication(request);
    return this.conversations.createConversation(auth.workspace.id, body);
  }

  @Get()
  @Header('cache-control', 'no-store')
  public async list(@Req() request: AuthenticatedRequest) {
    return this.conversations.listConversations(
      authentication(request).workspace.id,
    );
  }

  @Get(':conversationId')
  @Header('cache-control', 'no-store')
  public async get(
    @Req() request: AuthenticatedRequest,
    @Param('conversationId') conversationId: string,
  ) {
    return this.conversations.getConversation(
      authentication(request).workspace.id,
      conversationId,
    );
  }

  @Patch(':conversationId')
  public async rename(
    @Req() request: AuthenticatedRequest,
    @Param('conversationId') conversationId: string,
    @Body() body: RenameBody,
  ) {
    return this.conversations.renameConversation(
      authentication(request).workspace.id,
      conversationId,
      body.title,
    );
  }

  @Delete(':conversationId')
  @HttpCode(204)
  public async archive(
    @Req() request: AuthenticatedRequest,
    @Param('conversationId') conversationId: string,
  ): Promise<void> {
    await this.conversations.archiveConversation(
      authentication(request).workspace.id,
      conversationId,
    );
  }

  @Post(':conversationId/turns')
  public async createMessage(
    @Req() request: AuthenticatedRequest,
    @Param('conversationId') conversationId: string,
    @Body() body: MessageBody,
  ) {
    const auth = authentication(request);
    return this.conversations.createMessage(
      auth.user.id,
      auth.workspace.id,
      conversationId,
      {
        content: body.content,
        idempotencyKey: idempotencyKey(request, body),
        ...(body.modelKey === undefined ? {} : { modelKey: body.modelKey }),
      },
    );
  }

  @Post(':conversationId/turns/:turnId/regenerate')
  public async regenerate(
    @Req() request: AuthenticatedRequest,
    @Param('conversationId') conversationId: string,
    @Param('turnId') turnId: string,
    @Body() body: Omit<MessageBody, 'content'>,
  ) {
    const auth = authentication(request);
    return this.conversations.regenerate(
      auth.user.id,
      auth.workspace.id,
      conversationId,
      turnId,
      {
        idempotencyKey: idempotencyKey(request, body),
        ...(body.modelKey === undefined ? {} : { modelKey: body.modelKey }),
      },
    );
  }
}

@Controller()
export class ConversationStreamController {
  public constructor(
    private readonly conversations: ConversationService,
    private readonly events: StreamEventHub,
  ) {}

  @Get('models')
  @Header('cache-control', 'no-store')
  public async models() {
    return this.conversations.models();
  }

  @Post('model-runs/:runId/cancel')
  @HttpCode(204)
  public async cancel(
    @Req() request: AuthenticatedRequest,
    @Param('runId') runId: string,
  ): Promise<void> {
    await this.conversations.cancelRun(
      authentication(request).workspace.id,
      runId,
    );
  }

  @Post('request-groups/:groupId/routing-decision')
  @HttpCode(204)
  public async persistRoutingDecision(
    @Req() request: AuthenticatedRequest,
    @Param('groupId') groupId: string,
    @Body() body: RoutingDecisionBody,
  ): Promise<void> {
    await this.conversations.recordRoutingDecision(
      authentication(request).workspace.id,
      groupId,
      body,
    );
  }

  @Post('model-responses/:responseId/try-another')
  public async tryAnother(
    @Req() request: AuthenticatedRequest,
    @Param('responseId') responseId: string,
    @Body() body: TryAnotherBody,
  ) {
    return this.conversations.tryAnother(
      authentication(request).workspace.id,
      responseId,
      body.modelKey,
    );
  }

  @Post('turns/:turnId/select')
  public async selectResponse(
    @Req() request: AuthenticatedRequest,
    @Param('turnId') turnId: string,
    @Body() body: SelectResponseBody,
  ) {
    const auth = authentication(request);
    return this.conversations.selectResponse(
      auth.user.id,
      auth.workspace.id,
      turnId,
      body.responseId,
    );
  }

  @Get('request-groups/:groupId/events')
  public async stream(
    @Req() request: AuthenticatedRequest,
    @Param('groupId') groupId: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const group = await this.conversations.requestGroupForWorkspace(
      authentication(request).workspace.id,
      groupId,
    );
    const stream = new PassThrough();
    reply.headers({
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'content-type': 'text/event-stream; charset=utf-8',
      'x-accel-buffering': 'no',
    });
    // Fastify must run onSend hooks (including cookie serialization) before
    // piping SSE. Hijacking the raw response bypasses that lifecycle.
    void reply.send(stream);
    stream.write(': connected\n\n');

    let closed = false;
    let unsubscribe: () => void = () => undefined;
    const close = () => {
      if (closed) return;
      closed = true;
      unsubscribe();
      stream.end();
    };
    const pending = new Set(
      group.modelRuns
        .filter(
          (run) => !['COMPLETED', 'FAILED', 'CANCELLED'].includes(run.status),
        )
        .map((run) => run.id),
    );
    const latestId = this.events.history(groupId).at(-1)?.id ?? 0;
    unsubscribe = this.events.subscribe(groupId, (event) => {
      if (event.id <= latestId || closed) return;
      writeEvent(stream, event);
      if (isTerminal(event)) pending.delete(String(event.data.runId));
      if (pending.size === 0) close();
    });
    for (const event of this.events.history(groupId)) {
      writeEvent(stream, event);
      if (isTerminal(event)) pending.delete(String(event.data.runId));
    }
    if (
      pending.size === 0 ||
      group.status === 'COMPLETED' ||
      group.status === 'CANCELLED' ||
      group.status === 'FAILED'
    ) {
      close();
      return;
    }
    reply.raw.once('close', close);
  }
}

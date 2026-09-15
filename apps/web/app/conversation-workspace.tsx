'use client';
import { AuthUnavailable } from './auth-unavailable';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  conversationCommand,
  canAttemptModel,
  createConversationCommand,
} from './conversation-command';
import { API_V1_URL } from './api-url';
import { useAuth } from './auth-provider';
import { PRODUCT_NAME } from './brand';
import { fileStatusMessage, productErrorMessage } from './product-error';
import {
  acceptsStreamEvent,
  decodeSseFrames,
  MAX_STREAM_RECONNECTS,
  reconnectDelayMs,
  streamEndpoint,
} from './conversation-stream';

type Model = {
  health: string;
  displayName: string;
  modelKey: string;
  provider: { displayName: string; key: string };
};

type ConversationSummary = {
  id: string;
  mode: 'SINGLE' | 'COMPARE';
  title: string;
  turnCount: number;
  updatedAt: string;
};

type Response = {
  content: string;
  id: string;
  runId: string;
  model: { displayName: string; modelKey: string };
  provider: { displayName: string; key: string };
  selectedAt: string | null;
};

type Conversation = {
  activeHeadId: string | null;
  id: string;
  mode: 'SINGLE' | 'COMPARE';
  title: string;
  turns: Array<{
    id: string;
    requestGroup: {
      id: string;
      routingDecision: {
        reason?: string | null;
        strategy: string;
        mode?: string | null;
        candidates: Array<{
          model: { displayName: string };
          provider: { displayName: string };
          selected?: boolean;
        }>;
      } | null;
      runs: Array<{
        failureCode?: string;
        id: string;
        model: { displayName: string; modelKey: string };
        partialContent?: string;
        provider: { displayName: string; key: string };
        status: string;
      }>;
      status: string;
    };
    responses: Response[];
    userContent: string;
  }>;
};

type Usage = {
  wallet: { availableCredits: string; reservedCredits: string };
};
type WorkspaceFile = {
  id: string;
  mime: string;
  originalName: string;
  processingErrorCode: string | null;
  processingStatus: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED' | 'DELETED';
  size: string;
};

interface PendingRun {
  content: string;
  groupId: string;
  runId: string;
  turnId: string;
  model?: string;
  provider?: string;
  routingMode?: string;
  status?: 'failed' | 'running' | 'cancelled' | 'reconnecting';
}

type RoutePreference = 'smart' | 'economy' | 'max';

const ROUTE_OPTIONS: Array<{
  description: string;
  label: string;
  value: RoutePreference;
}> = [
  {
    description: 'Balanced for most questions',
    label: 'Smart',
    value: 'smart',
  },
  {
    description: 'Lowest estimated cost among compatible models',
    label: 'Economy',
    value: 'economy',
  },
  {
    description: 'Prioritize reviewed model quality',
    label: 'Max',
    value: 'max',
  },
];

async function api<T>(
  path: string,
  init: RequestInit = {},
  csrfToken?: string,
): Promise<T> {
  const response = await fetch(`${API_V1_URL}${path}`, {
    ...init,
    cache: 'no-store',
    credentials: 'include',
    headers: {
      ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = await response.text();
    let message = body;
    try {
      const parsed = JSON.parse(body) as { message?: string };
      message = parsed.message || message;
    } catch {}
    throw new Error(message || 'Request failed');
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function newKey(): string {
  return crypto.randomUUID();
}

function creditLabel(value?: string): string {
  if (!value) return '—';
  return new Intl.NumberFormat().format(Number(value));
}

function relativeDate(value: string): string {
  const elapsed = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.round(elapsed / 60_000));
  if (minutes < 1) return 'Now';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1_440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1_440)}d`;
}

export function ConversationWorkspace({
  initialConversationId,
}: {
  initialConversationId?: string;
}) {
  const auth = useAuth();
  const router = useRouter();
  const aborters = useRef(new Map<string, AbortController>());
  const activeStreams = useRef(new Set<string>());
  const cursors = useRef(new Map<string, number>());
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [modelKey, setModelKey] = useState('');
  const [content, setContent] = useState('');
  const [pendingRuns, setPendingRuns] = useState<Record<string, PendingRun>>(
    {},
  );
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [routePreference, setRoutePreference] =
    useState<RoutePreference>('smart');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<WorkspaceFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [darkTheme, setDarkTheme] = useState(true);
  const [newConversationMode, setNewConversationMode] = useState<
    'SINGLE' | 'COMPARE'
  >('SINGLE');
  const hasPending = Object.keys(pendingRuns).length > 0;
  const setProductError = useCallback((value: unknown) => {
    setError(
      productErrorMessage(value instanceof Error ? value.message : value),
    );
  }, []);

  const loadSidebar = useCallback(async () => {
    setConversations(await api<ConversationSummary[]>('/conversations'));
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    if (!id) return;
    setConversation(await api<Conversation>(`/conversations/${id}`));
  }, []);

  const refreshWorkspace = useCallback(async () => {
    const [history, available, currentUsage] = await Promise.all([
      api<ConversationSummary[]>('/conversations'),
      api<Model[]>('/models'),
      api<Usage>('/usage'),
    ]);
    setConversations(history);
    setModels(available);
    setUsage(currentUsage);
    setModelKey((current) =>
      available.some((model) => model.modelKey === current) ? current : '',
    );
  }, []);
  const loadFiles = useCallback(async () => {
    setUploadedFiles(await api<WorkspaceFile[]>('/files'));
  }, []);

  useEffect(() => {
    if (auth.status !== 'authenticated') return;
    const timer = window.setTimeout(() => {
      void refreshWorkspace().catch(() =>
        setError('Unable to load your workspace.'),
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [auth.status, refreshWorkspace]);
  useEffect(() => {
    if (auth.status !== 'authenticated') return;
    const timer = window.setTimeout(() => {
      void loadFiles().catch(() => setError('Unable to load workspace files.'));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [auth.status, loadFiles]);

  useEffect(() => {
    if (auth.status === 'authenticated' && initialConversationId) {
      const timer = window.setTimeout(() => {
        void loadConversation(initialConversationId).catch(() =>
          setError('Conversation not found.'),
        );
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [auth.status, initialConversationId, loadConversation]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = window.localStorage.getItem('omniroute-theme');
      const dark = saved !== 'light';
      setDarkTheme(dark);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const setTheme = useCallback((dark: boolean) => {
    setDarkTheme(dark);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    window.localStorage.setItem('omniroute-theme', dark ? 'dark' : 'light');
  }, []);

  const stream = useCallback(
    async (groupId: string, conversationId: string) => {
      if (activeStreams.current.has(groupId)) return;
      activeStreams.current.add(groupId);
      const controller = new AbortController();
      aborters.current.set(groupId, controller);
      let completedStream = false;
      try {
        for (let attempt = 0; attempt <= MAX_STREAM_RECONNECTS; attempt += 1) {
          if (controller.signal.aborted) break;
          if (attempt > 0) {
            setPendingRuns((current) =>
              Object.fromEntries(
                Object.entries(current).map(([id, run]) => [
                  id,
                  run.groupId === groupId && run.status === 'running'
                    ? { ...run, status: 'reconnecting' as const }
                    : run,
                ]),
              ),
            );
            await new Promise<void>((resolve) =>
              window.setTimeout(resolve, reconnectDelayMs(attempt - 1)),
            );
          }
          let buffer = '';
          try {
            const cursor = cursors.current.get(groupId) ?? 0;
            const response = await fetch(
              `${API_V1_URL}${streamEndpoint(groupId, cursor)}`,
              {
                cache: 'no-store',
                credentials: 'include',
                headers: cursor ? { 'last-event-id': String(cursor) } : {},
                signal: controller.signal,
              },
            );
            if (!response.ok || !response.body)
              throw new Error('Unable to start response stream');
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            while (true) {
              const next = await reader.read();
              if (next.done) {
                completedStream = true;
                break;
              }
              const decoded = decodeSseFrames(
                buffer + decoder.decode(next.value, { stream: true }),
              );
              buffer = decoded.remainder;
              for (const frame of decoded.frames) {
                const priorCursor = cursors.current.get(groupId) ?? 0;
                if (!acceptsStreamEvent(priorCursor, frame.id)) continue;
                if (frame.id) cursors.current.set(groupId, Number(frame.id));
                if (frame.event === 'stream.reset') {
                  const position = frame.data.eventPosition;
                  if (typeof position === 'number')
                    cursors.current.set(groupId, position);
                  await loadConversation(conversationId);
                  continue;
                }
                const runId =
                  typeof frame.data.runId === 'string'
                    ? frame.data.runId
                    : null;
                if (
                  runId &&
                  (frame.event === 'fallback.started' ||
                    frame.event === 'run.status' ||
                    frame.event === 'run.error')
                ) {
                  setPendingRuns((current) => {
                    const previousRunId =
                      frame.event === 'fallback.started' &&
                      typeof frame.data.previousRunId === 'string'
                        ? frame.data.previousRunId
                        : runId;
                    const prior = current[runId] ?? current[previousRunId];
                    if (!prior || prior.groupId !== groupId) return current;
                    const nextRuns = { ...current };
                    if (runId !== previousRunId) delete nextRuns[previousRunId];
                    return {
                      ...nextRuns,
                      [runId]: {
                        ...prior,
                        ...(typeof frame.data.modelKey === 'string'
                          ? { model: frame.data.modelKey }
                          : typeof frame.data.model === 'string'
                            ? { model: frame.data.model }
                            : {}),
                        ...(typeof frame.data.provider === 'string'
                          ? { provider: frame.data.provider }
                          : {}),
                        ...(typeof frame.data.routingMode === 'string'
                          ? { routingMode: frame.data.routingMode }
                          : {}),
                        ...(frame.event === 'run.error'
                          ? { status: 'failed' as const }
                          : frame.data.status === 'cancelled'
                            ? { status: 'cancelled' as const }
                            : { status: 'running' as const }),
                      },
                    };
                  });
                }
                if (frame.event === 'run.error')
                  setError(
                    'One response could not complete. Other responses remain available.',
                  );
                if (frame.event !== 'content.delta' || !runId) continue;
                const delta =
                  typeof frame.data.delta === 'string' ? frame.data.delta : '';
                setPendingRuns((current) => {
                  const prior = current[runId];
                  return prior?.groupId === groupId
                    ? {
                        ...current,
                        [runId]: { ...prior, content: prior.content + delta },
                      }
                    : current;
                });
              }
            }
            if (completedStream) break;
          } catch (streamError) {
            if (controller.signal.aborted) break;
            if (attempt === MAX_STREAM_RECONNECTS) {
              setError(
                streamError instanceof Error
                  ? `${streamError.message}. Reopen the conversation to recover its durable state.`
                  : 'Stream connection was lost. Reopen the conversation to recover its durable state.',
              );
            }
          }
        }
      } finally {
        aborters.current.delete(groupId);
        activeStreams.current.delete(groupId);
        setPendingRuns((current) =>
          Object.fromEntries(
            Object.entries(current).filter(
              ([, run]) => run.groupId !== groupId,
            ),
          ),
        );
        await Promise.all([
          loadConversation(conversationId),
          loadSidebar(),
          refreshWorkspace(),
        ]);
      }
    },
    [loadConversation, loadSidebar, refreshWorkspace],
  );

  // A refresh never re-dispatches a provider request. It rebuilds cards from
  // durable run state and attaches to the existing group stream when work is
  // still nonterminal.
  useEffect(() => {
    if (!conversation) return;
    for (const turn of conversation.turns) {
      const runs = turn.requestGroup.runs.filter((run) =>
        ['PENDING', 'QUEUED', 'RESERVED', 'RUNNING'].includes(run.status),
      );
      if (!runs.length || activeStreams.current.has(turn.requestGroup.id))
        continue;
      setPendingRuns((current) => ({
        ...current,
        ...Object.fromEntries(
          runs.map((run) => [
            run.id,
            {
              content: run.partialContent ?? '',
              groupId: turn.requestGroup.id,
              model: run.model.modelKey,
              provider: run.provider.key,
              runId: run.id,
              turnId: turn.id,
            },
          ]),
        ),
      }));
      void stream(turn.requestGroup.id, conversation.id);
    }
  }, [conversation, stream]);

  const createConversation = useCallback(async () => {
    if (auth.status !== 'authenticated') return null;
    setError(null);
    try {
      const created = await api<{ id: string }>(
        '/conversations',
        {
          method: 'POST',
          body: JSON.stringify(createConversationCommand(newConversationMode)),
        },
        auth.session.csrfToken,
      );
      await loadSidebar();
      router.push(`/chat/${created.id}`);
      setMobileSidebarOpen(false);
      return created.id;
    } catch (requestError) {
      setProductError(requestError);
      return null;
    }
  }, [auth, loadSidebar, newConversationMode, router, setProductError]);

  const send = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!content.trim() || hasPending || auth.status !== 'authenticated')
        return;
      let activeId: string | null | undefined =
        conversation?.id ?? initialConversationId;
      if (!activeId) activeId = await createConversation();
      if (!activeId) return;
      setError(null);
      const message = content.trim();
      setContent('');
      try {
        const result = await api<{
          requestGroupId: string;
          runIds: string[];
          turnId: string;
        }>(
          `/conversations/${activeId}/turns`,
          {
            body: JSON.stringify(
              conversationCommand(message, routePreference, modelKey),
            ),
            headers: { 'idempotency-key': newKey() },
            method: 'POST',
          },
          auth.session.csrfToken,
        );
        if (!result.runIds.length) throw new Error('No model run was created');
        setPendingRuns(
          Object.fromEntries(
            result.runIds.map((runId) => [
              runId,
              {
                content: '',
                groupId: result.requestGroupId,
                runId,
                turnId: result.turnId,
              },
            ]),
          ),
        );
        void stream(result.requestGroupId, activeId);
        await loadConversation(activeId);
      } catch (sendError) {
        setContent(message);
        setProductError(sendError);
      }
    },
    [
      auth,
      content,
      conversation?.id,
      createConversation,
      initialConversationId,
      loadConversation,
      modelKey,
      routePreference,
      hasPending,
      setProductError,
      stream,
    ],
  );

  const stop = useCallback(
    async (runId: string) => {
      if (auth.status !== 'authenticated') return;
      try {
        await api<void>(
          `/model-runs/${runId}/cancel`,
          { method: 'POST', body: '{}' },
          auth.session.csrfToken,
        );
      } catch (requestError) {
        setProductError(requestError);
      }
    },
    [auth, setProductError],
  );

  const stopGroup = useCallback(
    async (groupId: string) => {
      if (auth.status !== 'authenticated') return;
      try {
        await api<void>(
          `/request-groups/${groupId}/cancel`,
          { method: 'POST', body: '{}' },
          auth.session.csrfToken,
        );
      } catch (requestError) {
        setProductError(requestError);
      }
    },
    [auth, setProductError],
  );

  const startResult = useCallback(
    (
      result: { requestGroupId: string; runIds: string[]; turnId: string },
      conversationId: string,
    ) => {
      if (!result.runIds.length) throw new Error('No model run was created');
      setPendingRuns(
        Object.fromEntries(
          result.runIds.map((runId) => [
            runId,
            {
              content: '',
              groupId: result.requestGroupId,
              runId,
              turnId: result.turnId,
            },
          ]),
        ),
      );
      void stream(result.requestGroupId, conversationId);
    },
    [stream],
  );

  const regenerate = useCallback(
    async (turnId: string) => {
      if (!conversation || hasPending || auth.status !== 'authenticated')
        return;
      try {
        const result = await api<{
          requestGroupId: string;
          runIds: string[];
          turnId: string;
        }>(
          `/conversations/${conversation.id}/turns/${turnId}/regenerate`,
          {
            body: JSON.stringify({
              routingMode: routePreference,
              ...(modelKey ? { modelKey } : {}),
            }),
            headers: { 'idempotency-key': newKey() },
            method: 'POST',
          },
          auth.session.csrfToken,
        );
        startResult(result, conversation.id);
      } catch (requestError) {
        setProductError(requestError);
      }
    },
    [
      auth,
      conversation,
      modelKey,
      routePreference,
      hasPending,
      setProductError,
      startResult,
    ],
  );

  const tryAnother = useCallback(
    async (responseId: string) => {
      if (!conversation || auth.status !== 'authenticated') return;
      setError(null);
      try {
        const result = await api<{
          requestGroupId: string;
          runIds: string[];
          turnId: string;
        }>(
          `/model-responses/${responseId}/try-another`,
          {
            // The server excludes attempts from this frozen snapshot and applies
            // the same reviewed-model eligibility rules as every other run.
            body: JSON.stringify({}),
            method: 'POST',
          },
          auth.session.csrfToken,
        );
        startResult(result, conversation.id);
      } catch (requestError) {
        setProductError(requestError);
      }
    },
    [auth, conversation, startResult, setProductError],
  );

  const selectResponse = useCallback(
    async (turnId: string, responseId: string) => {
      if (!conversation || auth.status !== 'authenticated') return;
      try {
        await api(
          `/turns/${turnId}/select`,
          { body: JSON.stringify({ responseId }), method: 'POST' },
          auth.session.csrfToken,
        );
        await loadConversation(conversation.id);
      } catch (requestError) {
        setProductError(requestError);
      }
    },
    [auth, conversation, loadConversation, setProductError],
  );

  const uploadFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file || auth.status !== 'authenticated') return;
      const extension = file.name.split('.').at(-1)?.toLowerCase();
      const mime =
        file.type ||
        (extension === 'pdf'
          ? 'application/pdf'
          : extension === 'md' || extension === 'markdown'
            ? 'text/markdown'
            : 'text/plain');
      if (
        !['txt', 'md', 'markdown', 'pdf'].includes(extension ?? '') ||
        file.size > 5_000_000
      ) {
        setError('Upload a TXT, Markdown, or text PDF smaller than 5 MB.');
        return;
      }
      setUploading(true);
      setError(null);
      try {
        const dataBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(new Error('Unable to read that file.'));
          reader.onload = () => {
            const result = reader.result;
            if (typeof result !== 'string')
              reject(new Error('Unable to read that file.'));
            else resolve(result.split(',')[1] ?? '');
          };
          reader.readAsDataURL(file);
        });
        await api<WorkspaceFile>(
          '/files',
          {
            body: JSON.stringify({
              dataBase64,
              mime,
              originalName: file.name,
            }),
            method: 'POST',
          },
          auth.session.csrfToken,
        );
        await loadFiles();
      } catch (uploadError) {
        setProductError(uploadError);
      } finally {
        setUploading(false);
      }
    },
    [auth, loadFiles, setProductError],
  );
  const retryFile = useCallback(
    async (fileId: string) => {
      if (auth.status !== 'authenticated') return;
      try {
        await api(
          '/files/' + fileId + '/retry',
          { method: 'POST' },
          auth.session.csrfToken,
        );
        await loadFiles();
      } catch (requestError) {
        setProductError(requestError);
      }
    },
    [auth, loadFiles, setProductError],
  );
  const deleteFile = useCallback(
    async (fileId: string) => {
      if (auth.status !== 'authenticated') return;
      try {
        await api(
          '/files/' + fileId,
          { method: 'DELETE' },
          auth.session.csrfToken,
        );
        await loadFiles();
      } catch (requestError) {
        setProductError(requestError);
      }
    },
    [auth, loadFiles, setProductError],
  );

  const rename = useCallback(async () => {
    if (!conversation || auth.status !== 'authenticated') return;
    const title = window
      .prompt('Conversation title', conversation.title)
      ?.trim();
    if (!title || title === conversation.title) return;
    try {
      await api(
        `/conversations/${conversation.id}`,
        { body: JSON.stringify({ title }), method: 'PATCH' },
        auth.session.csrfToken,
      );
      await Promise.all([loadConversation(conversation.id), loadSidebar()]);
    } catch {
      setError('Unable to rename conversation.');
    }
  }, [auth, conversation, loadConversation, loadSidebar]);

  const visibleTurns = useMemo(() => conversation?.turns ?? [], [conversation]);
  const preference =
    ROUTE_OPTIONS.find((item) => item.value === routePreference) ??
    ROUTE_OPTIONS[0]!;

  if (auth.status === 'loading')
    return <main className="auth-status">Restoring your workspace…</main>;
  if (auth.status === 'unavailable')
    return (
      <main className="auth-status">
        <AuthUnavailable />
      </main>
    );
  if (auth.status !== 'authenticated') {
    return (
      <main className="auth-status">
        Your session has ended.{' '}
        <Link className="inline-link" href="/login">
          Sign in again
        </Link>
        .
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside
        className={
          mobileSidebarOpen
            ? 'conversation-sidebar is-open'
            : 'conversation-sidebar'
        }
        aria-label="Conversations"
      >
        <div className="sidebar-top">
          <Link
            className="brand"
            href="/"
            onClick={() => setMobileSidebarOpen(false)}
          >
            <span className="brand-mark">O</span> {PRODUCT_NAME}
          </Link>
          <button
            className="mobile-close"
            onClick={() => setMobileSidebarOpen(false)}
            type="button"
            aria-label="Close conversations"
          >
            ×
          </button>
        </div>
        <button
          className="new-chat-button"
          onClick={() => void createConversation()}
          type="button"
        >
          <span>＋</span> New chat
        </button>
        <div className="sidebar-label">Recent conversations</div>
        <nav>
          {conversations.length ? (
            conversations.map((item) => (
              <Link
                className={
                  item.id === conversation?.id ||
                  item.id === initialConversationId
                    ? 'conversation-link active'
                    : 'conversation-link'
                }
                href={`/chat/${item.id}`}
                key={item.id}
                onClick={() => setMobileSidebarOpen(false)}
              >
                <span>{item.title}</span>
                <small>
                  {relativeDate(item.updatedAt)} · {item.turnCount}{' '}
                  {item.turnCount === 1 ? 'turn' : 'turns'}
                </small>
              </Link>
            ))
          ) : (
            <p className="sidebar-empty">
              Your conversations will appear here.
            </p>
          )}
        </nav>
        <div className="sidebar-bottom">
          <button
            className="workspace-switcher"
            type="button"
            aria-label="Current workspace"
          >
            <span className="workspace-avatar">
              {auth.session.workspace.name.slice(0, 1).toUpperCase()}
            </span>
            <span>
              <strong>{auth.session.workspace.name}</strong>
              <small>Personal workspace</small>
            </span>
            <span aria-hidden="true">⌄</span>
          </button>
          <div className="credit-balance" aria-label="Available credit balance">
            <span>Credits</span>
            <strong>{creditLabel(usage?.wallet.availableCredits)}</strong>
            {usage && usage.wallet.reservedCredits !== '0' ? (
              <small>
                {creditLabel(usage.wallet.reservedCredits)} reserved
              </small>
            ) : null}
          </div>
          <div className="sidebar-user">
            <span className="user-avatar">
              {(auth.session.user.name ?? auth.session.user.email)
                .slice(0, 1)
                .toUpperCase()}
            </span>
            <span>{auth.session.user.name ?? auth.session.user.email}</span>
            <button
              onClick={() => setSettingsOpen(true)}
              type="button"
              aria-label="Settings"
            >
              ⚙
            </button>
          </div>
        </div>
      </aside>
      {mobileSidebarOpen ? (
        <button
          className="sidebar-scrim"
          onClick={() => setMobileSidebarOpen(false)}
          type="button"
          aria-label="Close navigation"
        />
      ) : null}

      <section className="chat-page">
        <header className="chat-header">
          <div className="header-title">
            <button
              className="mobile-menu"
              onClick={() => setMobileSidebarOpen(true)}
              type="button"
              aria-label="Open conversations"
            >
              ☰
            </button>
            <div>
              <p className="header-crumb">
                {conversation ? 'Conversation' : 'New conversation'}
              </p>
              <h1>{conversation?.title ?? 'How can I help?'}</h1>
            </div>
          </div>
          <div className="chat-actions">
            {conversation ? (
              <button
                className="header-button"
                onClick={() => void rename()}
                type="button"
              >
                Rename
              </button>
            ) : null}
            <button
              className="header-button settings-trigger"
              onClick={() => setSettingsOpen(true)}
              type="button"
            >
              Settings
            </button>
          </div>
        </header>

        <div className="message-list" aria-live="polite">
          {!conversation ? (
            <section className="empty-chat">
              <p className="empty-eyebrow">Your conversation stays with you</p>
              <h2>Ask anything. Change AI later.</h2>
              <p>
                Start with one clear question. You can see the model used, ask
                for another perspective, and choose the answer you want to
                continue from.
              </p>
              <div className="empty-suggestions">
                {[
                  'Explain a difficult concept simply',
                  'Help me plan a project',
                  'Compare a few approaches',
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => setContent(suggestion)}
                    type="button"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {visibleTurns.map((turn) => (
            <section className="turn" key={turn.id}>
              <article className="message user-message">
                <div className="message-label">
                  <span className="message-avatar user">You</span>
                  <span>You</span>
                </div>
                <p>{turn.userContent}</p>
                {turn.requestGroup.routingDecision ? (
                  <details className="routing-details">
                    <summary>
                      {turn.requestGroup.routingDecision.mode ?? 'Manual'} · Why
                      this route?
                    </summary>
                    <p>
                      {turn.requestGroup.routingDecision.reason ||
                        `${turn.requestGroup.routingDecision.strategy.replaceAll('_', ' ').toLowerCase()} selected ${turn.requestGroup.routingDecision.candidates.map((candidate) => `${candidate.provider.displayName} ${candidate.model.displayName}`).join(', ')} for this turn.`}
                    </p>
                  </details>
                ) : null}
              </article>
              <div
                className={
                  turn.responses.length +
                    Object.values(pendingRuns).filter(
                      (run) => run.turnId === turn.id,
                    ).length +
                    turn.requestGroup.runs.filter(
                      (run) =>
                        ['FAILED', 'CANCELLED'].includes(run.status) &&
                        !turn.responses.some(
                          (response) => response.runId === run.id,
                        ),
                    ).length >
                  1
                    ? 'response-comparison'
                    : 'response-stack'
                }
              >
                {turn.requestGroup.runs.some((run) =>
                  ['PENDING', 'QUEUED', 'RESERVED', 'RUNNING'].includes(
                    run.status,
                  ),
                ) ? (
                  <div className="comparison-group-actions">
                    <button
                      className="response-action"
                      onClick={() => void stopGroup(turn.requestGroup.id)}
                      type="button"
                    >
                      Cancel remaining responses
                    </button>
                  </div>
                ) : null}
                {turn.responses.map((response) => (
                  <article
                    className={
                      response.selectedAt
                        ? 'message assistant-message selected-response'
                        : 'message assistant-message'
                    }
                    key={response.id}
                  >
                    <div className="message-label">
                      <span className="model-badge">
                        {response.provider.displayName} ·{' '}
                        {response.model.displayName}
                      </span>
                      {response.selectedAt ? (
                        <span className="selected-badge">Selected</span>
                      ) : null}
                    </div>
                    <p>{response.content}</p>
                    <div className="response-actions">
                      <button
                        className="response-action"
                        onClick={() => void tryAnother(response.id)}
                        type="button"
                      >
                        Try another AI
                      </button>
                      <button
                        className="response-action primary-response-action"
                        disabled={Boolean(response.selectedAt)}
                        onClick={() =>
                          void selectResponse(turn.id, response.id)
                        }
                        type="button"
                      >
                        {response.selectedAt
                          ? 'Continuing from this answer'
                          : 'Continue with this answer'}
                      </button>
                    </div>
                  </article>
                ))}
                {Object.values(pendingRuns)
                  .filter(
                    (run) =>
                      run.turnId === turn.id &&
                      !turn.responses.some(
                        (response) => response.runId === run.runId,
                      ),
                  )
                  .map((run) => (
                    <article
                      className="message assistant-message streaming"
                      key={run.runId}
                    >
                      <div className="message-label">
                        <span className="model-badge">
                          {run.model
                            ? `${run.provider} · ${run.model}`
                            : 'Routing response'}
                          {run.routingMode ? ` · ${run.routingMode}` : ''}
                        </span>
                        {run.status === 'running' || !run.status ? (
                          <span
                            className="streaming-dot"
                            aria-label="Streaming"
                          />
                        ) : null}
                      </div>
                      <p>
                        {run.status === 'failed'
                          ? 'This provider could not complete.'
                          : run.status === 'cancelled'
                            ? 'This response was cancelled.'
                            : run.status === 'reconnecting'
                              ? run.content || 'Reconnecting to this response…'
                              : run.content || 'Thinking…'}
                      </p>
                      {run.status === 'running' || !run.status ? (
                        <button
                          className="response-action"
                          onClick={() => void stop(run.runId)}
                          type="button"
                        >
                          Stop this response
                        </button>
                      ) : null}
                    </article>
                  ))}
                {turn.requestGroup.runs
                  .filter(
                    (run) =>
                      ['FAILED', 'CANCELLED'].includes(run.status) &&
                      !turn.responses.some(
                        (response) => response.runId === run.id,
                      ) &&
                      !pendingRuns[run.id],
                  )
                  .map((run) => (
                    <article
                      className="message assistant-message streaming"
                      key={run.id}
                    >
                      <div className="message-label">
                        <span className="model-badge">
                          {run.provider.displayName} · {run.model.displayName}
                        </span>
                      </div>
                      <p>
                        {run.partialContent ||
                          (run.status === 'CANCELLED'
                            ? 'This response was cancelled.'
                            : productErrorMessage(run.failureCode))}
                      </p>
                    </article>
                  ))}
              </div>
              <button
                className="regenerate-button"
                disabled={hasPending}
                onClick={() => void regenerate(turn.id)}
                type="button"
              >
                ↻ Regenerate
              </button>
            </section>
          ))}
        </div>

        <div className="composer-area">
          {error ? (
            <p className="chat-error" role="alert">
              {error}
            </p>
          ) : null}
          {uploadedFiles.length ? (
            <div className="file-chips" aria-label="Workspace files">
              {uploadedFiles.map((file) => (
                <span key={file.id}>
                  <span>
                    ⌁ {file.originalName} ·{' '}
                    {fileStatusMessage(
                      file.processingStatus,
                      file.processingErrorCode,
                    )}
                  </span>
                  {file.processingStatus === 'FAILED' ? (
                    <button
                      onClick={() => void retryFile(file.id)}
                      type="button"
                      aria-label={`Retry ${file.originalName}`}
                    >
                      Retry
                    </button>
                  ) : null}
                  <button
                    onClick={() => void deleteFile(file.id)}
                    type="button"
                    aria-label={`Remove ${file.originalName}`}
                  >
                    Remove
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <form className="composer" onSubmit={send}>
            <div className="composer-topline">
              <div className="route-selector" aria-label="Routing preference">
                {ROUTE_OPTIONS.map((option) => (
                  <button
                    className={
                      option.value === routePreference
                        ? 'route-option active'
                        : 'route-option'
                    }
                    key={option.value}
                    onClick={() => {
                      setRoutePreference(option.value);
                      setModelKey('');
                    }}
                    title={option.description}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <span className="route-hint">
                {conversation?.mode === 'COMPARE'
                  ? 'Compare three reviewed models'
                  : preference.description}
              </span>
            </div>
            {!conversation ? (
              <div className="route-selector" aria-label="Conversation mode">
                <button
                  className={
                    newConversationMode === 'SINGLE'
                      ? 'route-option active'
                      : 'route-option'
                  }
                  onClick={() => setNewConversationMode('SINGLE')}
                  type="button"
                >
                  Single AI
                </button>
                <button
                  className={
                    newConversationMode === 'COMPARE'
                      ? 'route-option active'
                      : 'route-option'
                  }
                  onClick={() => {
                    setNewConversationMode('COMPARE');
                    setModelKey('');
                  }}
                  type="button"
                >
                  Compare 3
                </button>
              </div>
            ) : null}
            <textarea
              aria-label="Message"
              maxLength={20000}
              onChange={(event) => setContent(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder={`Message ${PRODUCT_NAME}…`}
              value={content}
            />
            <div className="composer-footer">
              <div className="composer-tools">
                <input
                  accept="text/plain,text/markdown,application/pdf,.txt,.md,.markdown,.pdf"
                  className="file-input"
                  onChange={(event) => void uploadFile(event)}
                  ref={fileInput}
                  type="file"
                />
                <button
                  className="icon-button"
                  disabled={uploading}
                  onClick={() => fileInput.current?.click()}
                  aria-label="Attach a TXT, Markdown, or text PDF"
                  title="Attach a TXT, Markdown, or text PDF"
                  type="button"
                >
                  {uploading ? '…' : '＋'}
                </button>
                <label className="model-picker">
                  <span>Model</span>
                  <select
                    aria-label="Model"
                    onChange={(event) => setModelKey(event.target.value)}
                    value={modelKey}
                  >
                    <option value="">Auto · {preference.label}</option>
                    {models.map((model) => (
                      <option
                        key={model.modelKey}
                        value={model.modelKey}
                        disabled={!canAttemptModel(model.health)}
                      >
                        {model.provider.displayName} · {model.displayName} ·{' '}
                        {model.health.replaceAll('_', ' ')}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <button
                className="send-button"
                disabled={
                  hasPending ||
                  !content.trim() ||
                  !models.some((model) => canAttemptModel(model.health))
                }
                type="submit"
              >
                Send <span aria-hidden="true">↑</span>
              </button>
            </div>
          </form>
          <p className="composer-note">
            {PRODUCT_NAME} may use your selected conversation context to answer.
            Press Enter to send.
          </p>
        </div>
      </section>

      {settingsOpen ? (
        <div className="modal-layer" role="presentation">
          <button
            className="modal-scrim"
            onClick={() => setSettingsOpen(false)}
            type="button"
            aria-label="Close settings"
          />
          <section
            className="settings-modal"
            aria-labelledby="settings-title"
            role="dialog"
            aria-modal="true"
          >
            <div className="modal-heading">
              <div>
                <p>Workspace preferences</p>
                <h2 id="settings-title">Settings</h2>
              </div>
              <button
                className="modal-close"
                onClick={() => setSettingsOpen(false)}
                type="button"
                aria-label="Close settings"
              >
                ×
              </button>
            </div>
            <div className="settings-row">
              <div>
                <strong>Appearance</strong>
                <span>Choose the view that is easiest on your eyes.</span>
              </div>
              <div className="theme-toggle">
                <button
                  className={darkTheme ? 'active' : ''}
                  onClick={() => setTheme(true)}
                  type="button"
                >
                  Dark
                </button>
                <button
                  className={!darkTheme ? 'active' : ''}
                  onClick={() => setTheme(false)}
                  type="button"
                >
                  Light
                </button>
              </div>
            </div>
            <div className="settings-row">
              <div>
                <strong>Account</strong>
                <span>{auth.session.user.email}</span>
              </div>
              <button
                className="sign-out-button"
                onClick={() => void auth.signOut()}
                type="button"
              >
                Sign out
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

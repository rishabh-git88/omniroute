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

import { conversationCommand, canAttemptModel } from './conversation-command';
import { API_V1_URL } from './api-url';
import { useAuth } from './auth-provider';
import { decodeSseFrames } from './conversation-stream';

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
      runs: Array<{ id: string; status: string }>;
      status: string;
    };
    responses: Response[];
    userContent: string;
  }>;
};

type Usage = {
  wallet: { availableCredits: string; reservedCredits: string };
};

interface PendingRun {
  content: string;
  groupId: string;
  runId: string;
  turnId: string;
  model?: string;
  provider?: string;
  routingMode?: string;
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
  if (!response.ok)
    throw new Error((await response.text()) || 'Request failed');
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
  const aborter = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [modelKey, setModelKey] = useState('');
  const [content, setContent] = useState('');
  const [pending, setPending] = useState<PendingRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [routePreference, setRoutePreference] =
    useState<RoutePreference>('smart');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [darkTheme, setDarkTheme] = useState(true);

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
      const controller = new AbortController();
      aborter.current = controller;
      let buffer = '';
      try {
        const response = await fetch(
          `${API_V1_URL}/request-groups/${groupId}/events`,
          {
            cache: 'no-store',
            credentials: 'include',
            signal: controller.signal,
          },
        );
        if (!response.ok || !response.body)
          throw new Error('Unable to start response stream');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          const decoded = decodeSseFrames(
            buffer + decoder.decode(next.value, { stream: true }),
          );
          buffer = decoded.remainder;
          for (const frame of decoded.frames) {
            if (
              frame.event === 'fallback.started' ||
              frame.event === 'run.status'
            ) {
              setPending((current) =>
                current?.groupId === groupId
                  ? {
                      ...current,
                      runId:
                        typeof frame.data.runId === 'string'
                          ? frame.data.runId
                          : current.runId,
                      ...(typeof frame.data.model === 'string'
                        ? { model: frame.data.model }
                        : {}),
                      ...(typeof frame.data.provider === 'string'
                        ? { provider: frame.data.provider }
                        : {}),
                      ...(typeof frame.data.routingMode === 'string'
                        ? { routingMode: frame.data.routingMode }
                        : {}),
                    }
                  : current,
              );
            }
            if (frame.event === 'run.error')
              setError('Generation could not complete. Please try again.');
            if (frame.event !== 'content.delta') continue;
            const delta =
              typeof frame.data.delta === 'string' ? frame.data.delta : '';
            setPending((current) =>
              current?.groupId === groupId
                ? { ...current, content: current.content + delta }
                : current,
            );
          }
        }
      } catch (streamError) {
        if (!controller.signal.aborted) {
          setError(
            streamError instanceof Error
              ? streamError.message
              : 'Stream failed',
          );
        }
      } finally {
        aborter.current = null;
        setPending((current) =>
          current?.groupId === groupId ? null : current,
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

  const createConversation = useCallback(async () => {
    if (auth.status !== 'authenticated') return null;
    setError(null);
    const created = await api<{ id: string }>(
      '/conversations',
      { method: 'POST', body: JSON.stringify({ mode: 'SINGLE' }) },
      auth.session.csrfToken,
    );
    await loadSidebar();
    router.push(`/chat/${created.id}`);
    setMobileSidebarOpen(false);
    return created.id;
  }, [auth, loadSidebar, router]);

  const send = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!content.trim() || pending || auth.status !== 'authenticated') return;
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
        const runId = result.runIds[0];
        if (!runId) throw new Error('No model run was created');
        setPending({
          content: '',
          groupId: result.requestGroupId,
          runId,
          turnId: result.turnId,
        });
        void stream(result.requestGroupId, activeId);
        await loadConversation(activeId);
      } catch (sendError) {
        setContent(message);
        setError(
          sendError instanceof Error
            ? sendError.message
            : 'Unable to send message',
        );
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
      pending,
      stream,
    ],
  );

  const stop = useCallback(async () => {
    if (!pending || auth.status !== 'authenticated') return;
    await api<void>(
      `/model-runs/${pending.runId}/cancel`,
      { method: 'POST', body: '{}' },
      auth.session.csrfToken,
    );
    aborter.current?.abort();
  }, [auth, pending]);

  const startResult = useCallback(
    (
      result: { requestGroupId: string; runIds: string[]; turnId: string },
      conversationId: string,
    ) => {
      const runId = result.runIds[0];
      if (!runId) throw new Error('No model run was created');
      setPending({
        content: '',
        groupId: result.requestGroupId,
        runId,
        turnId: result.turnId,
      });
      void stream(result.requestGroupId, conversationId);
    },
    [stream],
  );

  const regenerate = useCallback(
    async (turnId: string) => {
      if (!conversation || pending || auth.status !== 'authenticated') return;
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
        setError(
          requestError instanceof Error
            ? requestError.message
            : 'Unable to regenerate.',
        );
      }
    },
    [auth, conversation, modelKey, routePreference, pending, startResult],
  );

  const tryAnother = useCallback(
    async (responseId: string) => {
      if (!conversation || pending || auth.status !== 'authenticated') return;
      setError(null);
      try {
        const alternative = models.find((model) => model.modelKey !== modelKey);
        const result = await api<{
          requestGroupId: string;
          runIds: string[];
          turnId: string;
        }>(
          `/model-responses/${responseId}/try-another`,
          {
            body: JSON.stringify(
              alternative ? { modelKey: alternative.modelKey } : {},
            ),
            method: 'POST',
          },
          auth.session.csrfToken,
        );
        startResult(result, conversation.id);
      } catch (requestError) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : 'Unable to try another AI.',
        );
      }
    },
    [auth, conversation, modelKey, models, pending, startResult],
  );

  const selectResponse = useCallback(
    async (turnId: string, responseId: string) => {
      if (!conversation || pending || auth.status !== 'authenticated') return;
      try {
        await api(
          `/turns/${turnId}/select`,
          { body: JSON.stringify({ responseId }), method: 'POST' },
          auth.session.csrfToken,
        );
        await loadConversation(conversation.id);
      } catch (requestError) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : 'Unable to select this answer.',
        );
      }
    },
    [auth, conversation, loadConversation, pending],
  );

  const uploadFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file || auth.status !== 'authenticated') return;
      if (!file.type.startsWith('text/') || file.size > 2_000_000) {
        setError('Upload a text file smaller than 2 MB.');
        return;
      }
      setUploading(true);
      setError(null);
      try {
        await api(
          '/files',
          {
            body: JSON.stringify({
              content: await file.text(),
              mime: file.type,
              originalName: file.name,
            }),
            method: 'POST',
          },
          auth.session.csrfToken,
        );
        setUploadedFiles((current) => [...current, file.name]);
      } catch (uploadError) {
        setError(
          uploadError instanceof Error
            ? uploadError.message
            : 'Unable to upload that file.',
        );
      } finally {
        setUploading(false);
      }
    },
    [auth],
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
            <span className="brand-mark">O</span> OmniRoute
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
                  turn.responses.length > 1
                    ? 'response-comparison'
                    : 'response-stack'
                }
              >
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
                        disabled={Boolean(pending)}
                        onClick={() => void tryAnother(response.id)}
                        type="button"
                      >
                        Try another AI
                      </button>
                      <button
                        className="response-action primary-response-action"
                        disabled={
                          Boolean(pending) || Boolean(response.selectedAt)
                        }
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
              </div>
              {pending?.turnId === turn.id ? (
                <article className="message assistant-message streaming">
                  <div className="message-label">
                    <span className="model-badge">
                      {pending.model
                        ? `${pending.provider} · ${pending.model}`
                        : 'Routing response'}
                      {pending.routingMode ? ` · ${pending.routingMode}` : ''}
                    </span>
                    <span className="streaming-dot" aria-label="Streaming" />
                  </div>
                  <p>{pending.content || 'Thinking…'}</p>
                </article>
              ) : null}
              <button
                className="regenerate-button"
                disabled={Boolean(pending)}
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
            <div className="file-chips">
              {uploadedFiles.map((name) => (
                <span key={name}>⌁ {name}</span>
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
              <span className="route-hint">{preference.description}</span>
            </div>
            <textarea
              aria-label="Message"
              maxLength={20000}
              onChange={(event) => setContent(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="Message OmniRoute…"
              value={content}
            />
            <div className="composer-footer">
              <div className="composer-tools">
                <input
                  accept="text/*,.txt,.md,.csv,.json"
                  className="file-input"
                  onChange={(event) => void uploadFile(event)}
                  ref={fileInput}
                  type="file"
                />
                <button
                  className="icon-button"
                  disabled={uploading}
                  onClick={() => fileInput.current?.click()}
                  title="Attach a text file"
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
              {pending ? (
                <button
                  className="stop-button"
                  onClick={() => void stop()}
                  type="button"
                >
                  Stop
                </button>
              ) : (
                <button
                  className="send-button"
                  disabled={
                    !content.trim() ||
                    !models.some((model) => canAttemptModel(model.health))
                  }
                  type="submit"
                >
                  Send <span aria-hidden="true">↑</span>
                </button>
              )}
            </div>
          </form>
          <p className="composer-note">
            OmniRoute may use your selected conversation context to answer.
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

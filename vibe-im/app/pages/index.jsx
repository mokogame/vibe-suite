import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Head from "next/head";
import {
  Bot,
  FileUp,
  Image as ImageIcon,
  LogOut,
  MessageCircle,
  Plus,
  RefreshCw,
  Search,
  Send,
  Shield,
  Settings,
  Trash2,
  UserPlus,
  UserRound,
  Users
} from "lucide-react";
import { useSystemNotice } from "../components/SystemNotice";
import { decryptText, encryptText } from "../lib/client-crypto";

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
    body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "请求失败");
  return body;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("文件读取失败"));
    reader.readAsDataURL(file);
  });
}

function formatTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function normalizeUsernameInput(value) {
  return String(value || "").trim().replace(/^@+/, "").trim();
}

function isNearBottom(element, threshold = 120) {
  if (!element) return true;
  return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold;
}

function isLongAgentText(text) {
  const value = String(text || "");
  return value.length > 900 || value.split(/\r?\n/).length > 10;
}

function safeLinkHref(value) {
  const href = String(value || "").trim();
  if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) return href;
  return "#";
}

function renderInlineMarkdown(text) {
  const source = String(text || "");
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(source)) !== null) {
    if (match.index > lastIndex) parts.push(source.slice(lastIndex, match.index));
    const token = match[0];
    const key = `${match.index}-${token}`;

    if (token.startsWith("**") && token.endsWith("**")) {
      parts.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`") && token.endsWith("`")) {
      parts.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      parts.push(
        <a key={key} href={safeLinkHref(link?.[2])} target="_blank" rel="noreferrer">
          {link?.[1] || token}
        </a>
      );
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < source.length) parts.push(source.slice(lastIndex));
  return parts.length ? parts : source;
}

function headingId(index) {
  return `reader-heading-${index}`;
}

function extractMarkdownHeadings(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line, lineIndex) => ({ line: line.trim(), lineIndex }))
    .filter(item => /^(#{1,3})\s+(.+)$/.test(item.line))
    .map((item, index) => {
      const match = item.line.match(/^(#{1,3})\s+(.+)$/);
      return { id: headingId(index), level: match[1].length, text: match[2] };
    });
}

function renderRichText(text, options = {}) {
  const lines = String(text || "").split(/\r?\n/);
  const blocks = [];
  let paragraph = [];
  let list = [];
  let listKind = "unordered";
  let code = [];
  let inCode = false;
  let headingIndex = 0;

  function flushParagraph() {
    if (!paragraph.length) return;
    blocks.push({ type: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  }

  function flushList() {
    if (!list.length) return;
    blocks.push({ type: "list", kind: listKind, items: list });
    list = [];
    listKind = "unordered";
  }

  function flushCode() {
    blocks.push({ type: "code", text: code.join("\n") });
    code = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        flushParagraph();
        flushList();
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      code.push(line);
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      flushParagraph();
      flushList();
      blocks.push({ type: "rule" });
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] });
      continue;
    }

    const unordered = trimmed.match(/^[-*]\s+(.+)$/);
    const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      const nextKind = ordered ? "ordered" : "unordered";
      if (list.length && listKind !== nextKind) flushList();
      listKind = nextKind;
      list.push((unordered || ordered)[1]);
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  if (inCode) flushCode();
  flushParagraph();
  flushList();

  if (!blocks.length) return <p>{text}</p>;

  return blocks.map((block, index) => {
    if (block.type === "heading") {
      const Tag = block.level === 1 ? "h3" : block.level === 2 ? "h4" : "h5";
      const id = options.withHeadingIds ? headingId(headingIndex++) : undefined;
      return <Tag id={id} key={index}>{renderInlineMarkdown(block.text)}</Tag>;
    }
    if (block.type === "list") {
      const Tag = block.kind === "ordered" ? "ol" : "ul";
      return (
        <Tag key={index}>
          {block.items.map((item, itemIndex) => <li key={itemIndex}>{renderInlineMarkdown(item)}</li>)}
        </Tag>
      );
    }
    if (block.type === "code") {
      return (
        <div className="codeBlock" key={index}>
          {options.onCopyCode && (
            <button type="button" onClick={() => options.onCopyCode(block.text)}>复制代码</button>
          )}
          <pre><code>{block.text}</code></pre>
        </div>
      );
    }
    if (block.type === "rule") {
      return <hr key={index} />;
    }
    return <p key={index}>{renderInlineMarkdown(block.text)}</p>;
  });
}

function MessageText({ text, onCopyCode }) {
  return <div className="messageText">{renderRichText(text, { onCopyCode })}</div>;
}

function Modal({ title, children, onClose, className = "" }) {
  return (
    <div className="modalBackdrop" onMouseDown={onClose}>
      <div className={`modal ${className}`.trim()} onMouseDown={event => event.stopPropagation()}>
        <div className="modalHeader">
          <h3>{title}</h3>
          <button className="modalClose" type="button" onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ConfirmModal({ title, message, confirmText = "确认", danger = false, onConfirm, onCancel }) {
  return (
    <div className="modalBackdrop" onMouseDown={onCancel}>
      <div className="confirmDialog" onMouseDown={event => event.stopPropagation()}>
        <div>
          <h3>{title}</h3>
          <p>{message}</p>
        </div>
        <div className="confirmActions">
          <button className="secondaryButton" type="button" onClick={onCancel}>取消</button>
          <button className={danger ? "dangerButton" : "primaryButton"} type="button" onClick={onConfirm}>{confirmText}</button>
        </div>
      </div>
    </div>
  );
}

function UserSuggestInput({ value, onChange, onPick, placeholder, excludeUserIds = [], autoFocus = false }) {
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [floatingStyle, setFloatingStyle] = useState(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const pickedQueryRef = useRef("");
  const excludeKey = excludeUserIds.join("|");

  function estimateSuggestWidth(users, minWidth, maxWidth) {
    if (!users?.length || typeof document === "undefined") return minWidth;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return minWidth;
    const fontFamily = window.getComputedStyle(document.body).fontFamily || "sans-serif";
    let textWidth = 0;
    for (const user of users) {
      const fullLabel = `${user.displayName || ""} @${user.username || ""}`.trim();
      context.font = `700 16px ${fontFamily}`;
      textWidth = Math.max(textWidth, context.measureText(fullLabel).width);
      context.font = `12px ${fontFamily}`;
      textWidth = Math.max(textWidth, context.measureText(`@${user.username || ""}`).width);
    }
    const rowChromeWidth = 34 + 10 + 20 + 16;
    return Math.min(maxWidth, Math.max(minWidth, Math.ceil(textWidth + rowChromeWidth)));
  }

  function updateFloatingPosition(nextResults = results) {
    const rect = inputRef.current?.getBoundingClientRect();
    if (!rect) return;
    const viewportGap = 12;
    const minWidth = Math.ceil(rect.width);
    const maxWidth = Math.max(minWidth, Math.floor(window.innerWidth - rect.left - viewportGap));
    const width = estimateSuggestWidth(nextResults, minWidth, maxWidth);
    const visibleRows = Math.min(Math.max(nextResults.length || 1, 1), 10);
    const rowHeight = 58;
    setFloatingStyle({
      left: `${rect.left}px`,
      top: `${rect.bottom + 6}px`,
      width: `${width}px`,
      minWidth: `${minWidth}px`,
      maxWidth: `${maxWidth}px`,
      maxHeight: `${visibleRows * rowHeight}px`
    });
  }

  useEffect(() => {
    const query = normalizeUsernameInput(value);
    if (!query) {
      setResults([]);
      setOpen(false);
      return;
    }
    if (pickedQueryRef.current === query) {
      setResults([]);
      setOpen(false);
      return;
    }
    pickedQueryRef.current = "";
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const data = await api(`/api/users/search?q=${encodeURIComponent(query)}`);
        if (cancelled) return;
        const excluded = new Set(excludeUserIds);
        const nextResults = (data.users || []).filter(user => !excluded.has(user.id));
        setResults(nextResults);
        updateFloatingPosition(nextResults);
        setOpen(true);
      } catch {
        if (!cancelled) setResults([]);
      }
    }, 160);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value, excludeKey]);

  useEffect(() => {
    if (!open || !results.length) return;
    updateFloatingPosition();
    window.addEventListener("resize", updateFloatingPosition);
    function repositionOnWindowScroll(event) {
      if (listRef.current?.contains(event.target)) return;
      updateFloatingPosition();
    }
    window.addEventListener("scroll", repositionOnWindowScroll, true);
    return () => {
      window.removeEventListener("resize", updateFloatingPosition);
      window.removeEventListener("scroll", repositionOnWindowScroll, true);
    };
  }, [open, results.length]);

  useEffect(() => {
    if (!open) return;
    function closeOnOutsidePointer(event) {
      const target = event.target;
      if (inputRef.current?.contains(target) || listRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
  }, [open]);

  function pick(user) {
    pickedQueryRef.current = user.username;
    onPick(user);
    setOpen(false);
    setResults([]);
  }

  function userKind(user) {
    return user.role === "agent" ? "agent" : "user";
  }

  function userKindLabel(user) {
    return userKind(user) === "agent" ? "Agent" : "真人";
  }

  function reopenSuggestions() {
    if (!normalizeUsernameInput(value)) return;
    updateFloatingPosition();
    setOpen(true);
  }

  return (
    <div className="suggestWrap">
      <input
        ref={inputRef}
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={value}
        onChange={event => {
          onChange(event.target.value);
          updateFloatingPosition();
          setOpen(true);
        }}
        onFocus={reopenSuggestions}
        onPointerDown={reopenSuggestions}
        onKeyDown={event => {
          if (event.key === "Escape") {
            setOpen(false);
            return;
          }
          if (event.key === "Enter" && results[0]) {
            event.preventDefault();
            pick(results[0]);
          }
        }}
      />
      {open && results.length > 0 && (
        <div
          ref={listRef}
          className="suggestList"
          style={floatingStyle || undefined}
          onWheel={event => event.stopPropagation()}
        >
          {results.map(user => (
            <button type="button" key={user.id} onMouseDown={event => event.preventDefault()} onClick={() => pick(user)}>
              <span className={`suggestAvatar ${userKind(user)}`}>
                {userKind(user) === "agent" ? <Bot size={15} /> : <UserRound size={15} />}
              </span>
              <span>
                <strong>{user.displayName}<em className={`suggestKind ${userKind(user)}`}>{userKindLabel(user)}</em></strong>
                <small>@{user.username}</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const [auth, setAuth] = useState(null);
  const [loginForm, setLoginForm] = useState({ username: "admin", password: "admin123" });
  const [conversations, setConversations] = useState([]);
  const [active, setActive] = useState(null);
  const [messages, setMessages] = useState([]);
  const [plainTextById, setPlainTextById] = useState({});
  const [agentThinkingByConversation, setAgentThinkingByConversation] = useState({});
  const [members, setMembers] = useState([]);
  const [friends, setFriends] = useState([]);
  const [clawAgents, setClawAgents] = useState([]);
  const [clawLoading, setClawLoading] = useState(false);
  const [clawHealth, setClawHealth] = useState(null);
  const [agentSearch, setAgentSearch] = useState("");
  const [agentFilter, setAgentFilter] = useState("all");
  const [activeTab, setActiveTab] = useState("chats");
  const [searchText, setSearchText] = useState("");
  const [searchUsers, setSearchUsers] = useState([]);
  const [groupName, setGroupName] = useState("");
  const [createInviteName, setCreateInviteName] = useState("");
  const [createMembers, setCreateMembers] = useState([]);
  const [inviteName, setInviteName] = useState("");
  const [draft, setDraft] = useState("");
  const [modal, setModal] = useState("");
  const [confirmAction, setConfirmAction] = useState(null);
  const [expandedMessages, setExpandedMessages] = useState({});
  const [readerMessage, setReaderMessage] = useState(null);
  const [sendingByConversation, setSendingByConversation] = useState({});
  const [failedMessages, setFailedMessages] = useState([]);
  const [agentTimeoutByConversation, setAgentTimeoutByConversation] = useState({});
  const wsRef = useRef(null);
  const messageListRef = useRef(null);
  const bottomRef = useRef(null);
  const composerInputRef = useRef(null);
  const shouldStickToBottomRef = useRef(true);
  const forceScrollNextRef = useRef(false);
  const sendLockRef = useRef(new Set());
  const { showError, showNotice } = useSystemNotice();

  const transportKey = auth?.transportKey || "";
  const latestMessageId = messages[messages.length - 1]?.id || "";
  const activeAgentThinking = Boolean(active && agentThinkingByConversation[active.id]);
  const activeSending = Boolean(active && sendingByConversation[active.id]);

  useEffect(() => {
    api("/api/auth/me").then(setAuth).catch(() => setAuth(null));
  }, []);

  useEffect(() => {
    if (!auth?.token) return;
    loadConversations();
    loadFriends();
    const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${wsProtocol}//${location.host}/ws?token=${encodeURIComponent(auth.token)}`);
    wsRef.current = ws;
    ws.onmessage = event => {
      const data = JSON.parse(event.data);
      if (data.type === "message") {
        if (data.message.type === "system" || data.message.sender?.id !== auth.user.id) {
          setAgentThinkingByConversation(current => ({ ...current, [data.message.conversationId]: false }));
          setAgentTimeoutByConversation(current => ({ ...current, [data.message.conversationId]: false }));
        }
        setMessages(current => {
          if (data.message.conversationId !== active?.id) return current;
          if (current.some(item => item.id === data.message.id)) return current;
          return [...current, data.message];
        });
        loadConversations();
      }
      if (data.type === "conversation_deleted") {
        setConversations(current => current.filter(item => item.id !== data.conversationId));
        setActive(current => current?.id === data.conversationId ? null : current);
      }
    };
    return () => ws.close();
  }, [auth?.token, auth?.user?.id, active?.id]);

  useEffect(() => {
    if (!active || !transportKey) return;
    forceScrollNextRef.current = true;
    api(`/api/conversations/${encodeURIComponent(active.id)}/messages?limit=100`)
      .then(data => setMessages(data.messages || []))
      .catch(showError);
    api(`/api/conversations/${encodeURIComponent(active.id)}`)
      .then(data => setMembers(data.members || []))
      .catch(showError);
  }, [active?.id, transportKey]);

  useEffect(() => {
    if (activeTab === "agents") loadClawAgents();
  }, [activeTab]);

  useEffect(() => {
    if (!active || !activeAgentThinking) return;
    const timer = setTimeout(() => {
      setAgentTimeoutByConversation(current => ({ ...current, [active.id]: true }));
    }, 45000);
    return () => clearTimeout(timer);
  }, [active?.id, activeAgentThinking]);

  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => {
      composerInputRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [active?.id]);

  useEffect(() => {
    let cancelled = false;
    async function decryptMessages() {
      const next = {};
      for (const message of messages) {
        if (message.type === "text" && message.encryptedText) {
          next[message.id] = await decryptText(message.encryptedText, transportKey).catch(() => "[消息解密失败]");
        }
      }
      if (!cancelled) setPlainTextById(next);
    }
    if (transportKey) decryptMessages();
    return () => { cancelled = true; };
  }, [messages, transportKey]);

  useEffect(() => {
    if (active && messages.length) {
      const latest = messages[messages.length - 1];
      api(`/api/conversations/${encodeURIComponent(active.id)}`, {
        method: "PATCH",
        body: { action: "read", seq: latest.seq }
      }).then(loadConversations).catch(() => {});
    }
  }, [latestMessageId, active?.id]);

  useLayoutEffect(() => {
    if (!active) return;
    const element = messageListRef.current;
    if (!element) return;
    const latest = messages[messages.length - 1];
    const shouldScroll =
      forceScrollNextRef.current ||
      shouldStickToBottomRef.current ||
      latest?.sender?.id === auth?.user?.id ||
      activeAgentThinking;

    if (!shouldScroll) return;
    requestAnimationFrame(() => {
      element.scrollTop = element.scrollHeight;
      shouldStickToBottomRef.current = true;
      forceScrollNextRef.current = false;
    });
  }, [latestMessageId, active?.id, auth?.user?.id, activeAgentThinking]);

  function handleMessageListScroll(event) {
    shouldStickToBottomRef.current = isNearBottom(event.currentTarget);
  }

  async function copyMessageText(text) {
    try {
      await navigator.clipboard.writeText(text || "");
      showNotice("已复制消息内容");
    } catch (err) {
      showError(new Error("复制失败，请检查浏览器剪贴板权限"));
    }
  }

  function exportMarkdown(text, fileName = "agent-reply.md") {
    const blob = new Blob([String(text || "")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  function agentStatusFor(agent) {
    if (clawHealth && clawHealth.status !== "online") return clawHealth.status;
    if (!agent.defaultModel) return "model_unavailable";
    if (agent.lastError) return "config_error";
    return agent.status === "active" ? "online" : "config_error";
  }

  function agentStatusText(status) {
    return {
      online: "在线",
      config_error: "配置异常",
      model_unavailable: "模型不可用",
      agent_unavailable: "Agent 不可用",
      timeout: "连接超时"
    }[status] || "未知";
  }

  async function login(event) {
    event.preventDefault();
    try {
      const data = await api("/api/auth/login", { method: "POST", body: loginForm });
      setAuth(data);
    } catch (err) {
      showError(err);
    }
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    location.reload();
  }

  async function loadConversations() {
    const data = await api("/api/conversations");
    setConversations(data.conversations || []);
  }

  async function loadFriends() {
    const data = await api("/api/friends");
    setFriends(data.friends || []);
  }

  async function loadClawAgents() {
    setClawLoading(true);
    try {
      const data = await api("/api/vibe-claw/agents");
      setClawAgents(data.agents || []);
      setClawHealth(data.health || null);
    } catch (err) {
      showError(err);
    } finally {
      setClawLoading(false);
    }
  }

  async function openAgentConversation(agent) {
    try {
      const data = await api(`/api/vibe-claw/agents/${encodeURIComponent(agent.agentId)}/start`, { method: "POST" });
      setActive(data.conversation);
      setActiveTab("chats");
      await loadConversations();
    } catch (err) {
      showError(err);
    }
  }

  async function search() {
    if (!searchText.trim()) return setSearchUsers([]);
    const data = await api(`/api/users/search?q=${encodeURIComponent(searchText.trim())}`);
    setSearchUsers(data.users || []);
  }

  async function addFriend(username) {
    await api("/api/friends", { method: "POST", body: { username } });
    showNotice("已添加好友");
    setSearchText("");
    setSearchUsers([]);
    loadFriends();
  }

  async function openDirect(username) {
    try {
      const data = await api("/api/conversations", { method: "POST", body: { type: "direct", username } });
      setActive(data.conversation);
      setActiveTab("chats");
      loadConversations();
    } catch (err) {
      showError(err);
    }
  }

  async function createGroup(event) {
    event.preventDefault();
    if (!groupName.trim()) return;
    try {
      const data = await api("/api/conversations", {
        method: "POST",
        body: {
          type: "group",
          name: groupName.trim(),
          members: createMembers.map(user => user.username)
        }
      });
      setGroupName("");
      setCreateInviteName("");
      setCreateMembers([]);
      setModal("");
      setActive(data.conversation);
      setActiveTab("groups");
      loadConversations();
    } catch (err) {
      showError(err);
    }
  }

  async function inviteMemberByUsername(username) {
    if (!active || !normalizeUsernameInput(username)) return;
    try {
      const inviteResult = await api(`/api/conversations/${encodeURIComponent(active.id)}`, {
        method: "PATCH",
        body: { action: "invite", username: normalizeUsernameInput(username) }
      });
      setInviteName("");
      const refreshed = await api(`/api/conversations/${encodeURIComponent(active.id)}`);
      setMembers(refreshed.members || []);
      showNotice(inviteResult.member?.alreadyMember ? "该用户已在群聊中" : "成员已加入群聊");
    } catch (err) {
      showError(err);
    }
  }

  async function inviteMember(event) {
    event.preventDefault();
    await inviteMemberByUsername(inviteName);
  }

  function addCreateMember(user) {
    setCreateMembers(current => current.some(item => item.id === user.id) ? current : [...current, user]);
    setCreateInviteName("");
  }

  function removeCreateMember(userId) {
    setCreateMembers(current => current.filter(user => user.id !== userId));
  }

  function closeCreateGroupModal() {
    setGroupName("");
    setCreateInviteName("");
    setCreateMembers([]);
    setModal("");
  }

  async function removeMember(memberId) {
    if (!active) return;
    try {
      await api(`/api/conversations/${encodeURIComponent(active.id)}`, {
        method: "PATCH",
        body: { action: "removeMember", memberId }
      });
      const data = await api(`/api/conversations/${encodeURIComponent(active.id)}`);
      setMembers(data.members || []);
      showNotice("已移除成员");
    } catch (err) {
      showError(err);
    }
  }

  async function performDeleteDirectConversation() {
    if (!active) return;
    try {
      await api(`/api/conversations/${encodeURIComponent(active.id)}`, { method: "DELETE" });
      setConfirmAction(null);
      setModal("");
      setActive(null);
      setMessages([]);
      setMembers([]);
      await loadConversations();
      showNotice("聊天已删除");
    } catch (err) {
      showError(err);
    }
  }

  async function wsRequest(payload, timeoutMs = 8000) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== 1) throw new Error("WebSocket 未连接");
    const requestId = `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("WebSocket request timeout"));
      }, timeoutMs);
      function onMessage(event) {
        const data = JSON.parse(event.data);
        if (data.type !== "response" || data.requestId !== requestId) return;
        cleanup();
        if (data.error) reject(new Error(data.error));
        else resolve(data);
      }
      function cleanup() {
        clearTimeout(timer);
        ws.removeEventListener("message", onMessage);
      }
      ws.addEventListener("message", onMessage);
    });
    ws.send(JSON.stringify({ ...payload, requestId }));
    return promise;
  }

  async function performDissolveActiveGroup() {
    if (!active) return;
    try {
      await wsRequest({ type: "dissolve_group", conversationId: active.id });
      setConfirmAction(null);
      setModal("");
      setActive(null);
      setMessages([]);
      setMembers([]);
      await loadConversations();
      showNotice("群聊已解散");
    } catch (err) {
      showError(err);
    }
  }

  async function confirmCurrentAction() {
    const action = confirmAction;
    if (!action) return;
    if (action.type === "removeMember") {
      setConfirmAction(null);
      await removeMember(action.memberId);
    }
    if (action.type === "deleteDirect") {
      await performDeleteDirectConversation();
    }
    if (action.type === "dissolveGroup") {
      await performDissolveActiveGroup();
    }
  }

  async function sendTextMessage(text, retryLocalId = null) {
    if (!active || !text.trim()) return;
    if (sendLockRef.current.has(active.id) || sendingByConversation[active.id]) return;
    const isAgentConversation = activeSummary?.isAgent || active.isAgent;
    sendLockRef.current.add(active.id);
    setSendingByConversation(current => ({ ...current, [active.id]: true }));
    try {
      const encryptedText = await encryptText(text.trim(), transportKey);
      if (isAgentConversation) {
        setAgentThinkingByConversation(current => ({ ...current, [active.id]: true }));
        setAgentTimeoutByConversation(current => ({ ...current, [active.id]: false }));
      }
      if (retryLocalId) setFailedMessages(current => current.filter(item => item.localId !== retryLocalId));
      forceScrollNextRef.current = true;
      await api(`/api/conversations/${encodeURIComponent(active.id)}/messages`, {
        method: "POST",
        body: { type: "text", encryptedText }
      });
      setDraft("");
      requestAnimationFrame(() => {
        composerInputRef.current?.focus({ preventScroll: true });
      });
    } catch (err) {
      if (isAgentConversation) {
        setAgentThinkingByConversation(current => ({ ...current, [active.id]: false }));
      }
      const failed = {
        localId: retryLocalId || `failed_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        conversationId: active.id,
        text: text.trim(),
        error: err.message || "发送失败",
        createdAt: new Date().toISOString()
      };
      setFailedMessages(current => retryLocalId
        ? [...current.filter(item => item.localId !== retryLocalId), failed]
        : [...current, failed]);
      showError(err);
    } finally {
      sendLockRef.current.delete(active.id);
      setSendingByConversation(current => ({ ...current, [active.id]: false }));
    }
  }

  async function sendMessage(event) {
    event.preventDefault();
    await sendTextMessage(draft);
  }

  async function uploadAndSend(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !active) return;
    try {
      const data = await fileToDataUrl(file);
      const kind = file.type.startsWith("image/") ? "image" : "file";
      await api(`/api/conversations/${encodeURIComponent(active.id)}/messages`, {
        method: "POST",
        body: {
          type: kind,
          attachment: {
            kind,
            fileName: file.name,
            mimeType: file.type || "application/octet-stream",
            data
          }
        }
      });
    } catch (err) {
      showError(err);
    }
  }

  const activeSummary = useMemo(() => conversations.find(item => item.id === active?.id), [conversations, active?.id]);
  const groupConversations = useMemo(() => conversations.filter(item => item.type === "group"), [conversations]);
  const moduleMeta = {
    chats: { label: "消息", title: "消息", hint: "继续最近对话，或搜索用户发起新聊天。" },
    friends: { label: "联系人", title: "联系人", hint: "管理好友，搜索用户并发起单聊。" },
    agents: { label: "智能体", title: "智能体", hint: "连接 Vibe Claw Agent，进入对话或继续协作。" },
    groups: { label: "群组", title: "群组", hint: "查看群聊，创建多人会话。" }
  };
  const currentModule = moduleMeta[activeTab] || moduleMeta.chats;
  const recentAgentUserIds = useMemo(() => new Set(conversations.filter(item => item.isAgent && item.otherUser?.id).map(item => item.otherUser.id)), [conversations]);
  const currentAgent = useMemo(() => {
    const userId = activeSummary?.otherUser?.id || active?.otherUser?.id;
    return clawAgents.find(agent => agent.userId === userId) || active?.agent || activeSummary?.agent || null;
  }, [activeSummary, active, clawAgents]);
  const filteredAgents = useMemo(() => {
    const query = agentSearch.trim().toLowerCase();
    return clawAgents.filter(agent => {
      const status = agentStatusFor(agent);
      const matchesQuery = !query || `${agent.name} ${agent.description} ${agent.defaultModel}`.toLowerCase().includes(query);
      const matchesFilter =
        agentFilter === "all" ||
        (agentFilter === "recent" && recentAgentUserIds.has(agent.userId)) ||
        (agentFilter === "online" && status === "online") ||
        (agentFilter === "issue" && status !== "online");
      return matchesQuery && matchesFilter;
    });
  }, [clawAgents, agentSearch, agentFilter, recentAgentUserIds, clawHealth]);
  const activeConversationFailedMessages = useMemo(() => failedMessages.filter(item => item.conversationId === active?.id), [failedMessages, active?.id]);
  const createMemberUserIds = useMemo(() => [auth?.user?.id, ...createMembers.map(user => user.id)].filter(Boolean), [auth?.user?.id, createMembers]);
  const activeMemberUserIds = useMemo(() => members.map(member => member.id), [members]);
  const activeMember = useMemo(() => members.find(member => member.id === auth?.user?.id), [members, auth?.user?.id]);
  const canManageActiveGroup = active?.type === "group" && ["owner", "admin"].includes(activeMember?.memberRole);
  const canDissolveActiveGroup = active?.type === "group" && activeMember?.memberRole === "owner";

  if (!auth) {
    return (
      <>
        <Head>
          <title>vibe-im</title>
        </Head>
        <main className="loginShell">
          <form className="loginCard" onSubmit={login}>
            <div className="brandMark"><MessageCircle size={24} /></div>
            <h1>Vibe IM</h1>
            <p>使用账号密码登录即时通讯系统</p>
            <label>账号<input value={loginForm.username} onChange={event => setLoginForm({ ...loginForm, username: event.target.value })} /></label>
            <label>密码<input type="password" value={loginForm.password} onChange={event => setLoginForm({ ...loginForm, password: event.target.value })} /></label>
            <button className="primaryButton" type="submit">登录</button>
          </form>
        </main>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>vibe-im</title>
      </Head>
      <main className="appShell">
        <nav className="navRail" aria-label="主导航">
          <div className="railProfile" title={`${auth.user.displayName} @${auth.user.username}`}>
            {String(auth.user.displayName || auth.user.username || "?").slice(0, 1).toUpperCase()}
          </div>
          <div className="railNavGroup">
            <button className={activeTab === "chats" ? "active" : ""} type="button" onClick={() => setActiveTab("chats")} title="消息">
              <MessageCircle size={20} />
              <span>消息</span>
            </button>
            <button className={activeTab === "friends" ? "active" : ""} type="button" onClick={() => setActiveTab("friends")} title="联系人">
              <UserRound size={20} />
              <span>联系人</span>
            </button>
            <button className={activeTab === "agents" ? "active" : ""} type="button" onClick={() => setActiveTab("agents")} title="智能体">
              <Bot size={20} />
              <span>智能体</span>
            </button>
            <button className={activeTab === "groups" ? "active" : ""} type="button" onClick={() => setActiveTab("groups")} title="群组">
              <Users size={20} />
              <span>群组</span>
            </button>
          </div>
          <div className="railBottom">
            {auth.user.role === "admin" && <a href="/admin" title="管理后台"><Shield size={20} /><span>后台</span></a>}
            <button type="button" title="退出登录" onClick={logout}><LogOut size={20} /><span>退出</span></button>
          </div>
        </nav>

        <aside className="sidebar">
          <header className="sidebarHeader">
            <div>
              <span className="sidebarEyebrow">{auth.user.displayName} · @{auth.user.username}</span>
              <h2>{currentModule.title}</h2>
              <p>{currentModule.hint}</p>
            </div>
            {activeTab === "agents" ? (
              <button className="listAddButton" type="button" title="同步智能体" onClick={loadClawAgents}>
                <RefreshCw className={clawLoading ? "spinIcon" : ""} size={16} />
              </button>
            ) : activeTab === "groups" ? (
              <button className="listAddButton" type="button" title="创建群聊" onClick={() => setModal("createGroup")}>
                <Plus size={16} />
              </button>
            ) : null}
          </header>

          {(activeTab === "chats" || activeTab === "friends") && (
            <section className="sidebarSection">
              <form className="searchBox" onSubmit={event => { event.preventDefault(); search(); }}>
                <Search size={17} />
                <UserSuggestInput
                  value={searchText}
                  onChange={value => setSearchText(value)}
                  onPick={user => {
                    setSearchText(`@${user.username}`);
                    setSearchUsers([user]);
                  }}
                  placeholder={activeTab === "friends" ? "搜索联系人 username" : "搜索用户或开始聊天"}
                />
                <button type="submit">查找</button>
              </form>
              {!!searchUsers.length && (
                <div className="searchResults">
                  {searchUsers.map(user => (
                    <div className="searchResultRow" key={user.id}>
                      <UserRound size={16} />
                      <span><strong>{user.displayName}</strong><small>@{user.username}</small></span>
                      <div className="searchResultActions">
                        {!user.isFriend && (
                          <button type="button" title="添加好友" onClick={() => addFriend(user.username)}>
                            <UserPlus size={15} />
                          </button>
                        )}
                        <button type="button" title="发起单聊" onClick={() => openDirect(user.username)}>
                          <MessageCircle size={15} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {activeTab === "agents" && (
            <section className="sidebarSection agentConnector">
              <div className={`agentHealthBadge ${clawHealth?.status || "unknown"}`}>
                {clawHealth ? `${agentStatusText(clawHealth.status)} · ${clawHealth.message || "等待诊断"}` : "尚未诊断连接"}
              </div>
              <input value={agentSearch} onChange={event => setAgentSearch(event.target.value)} placeholder="搜索智能体 / 模型" />
              <select value={agentFilter} onChange={event => setAgentFilter(event.target.value)}>
                <option value="all">全部 Agent</option>
                <option value="recent">最近使用</option>
                <option value="online">在线可用</option>
                <option value="issue">异常/不可用</option>
              </select>
              <button className="secondaryButton" type="button" onClick={loadClawAgents} disabled={clawLoading}>
                {clawLoading ? "同步中..." : "同步智能体"}
              </button>
            </section>
          )}

          <section className="conversationList">
            <div className="listHeader">
              <span>{activeTab === "chats" ? "最近会话" : activeTab === "friends" ? "好友列表" : activeTab === "agents" ? "可用智能体" : "群聊列表"}</span>
            </div>
            {activeTab === "friends" ? (
              <>
                {friends.map(friend => (
                  <button className="conversationItem" key={friend.id} onClick={() => openDirect(friend.username)}>
                    <span className="conversationIcon"><UserRound size={18} /></span>
                    <span className="conversationMeta">
                      <strong>{friend.displayName}</strong>
                      <small>@{friend.username}</small>
                    </span>
                  </button>
                ))}
                {!friends.length && <div className="sideEmpty">暂无好友，可通过上方 username 搜索添加。</div>}
              </>
            ) : activeTab === "agents" ? (
              <>
                {filteredAgents.map(agent => {
                  const status = agentStatusFor(agent);
                  const continued = recentAgentUserIds.has(agent.userId);
                  return (
                    <button className="conversationItem agentItem" key={agent.agentId} onClick={() => openAgentConversation(agent)}>
                      <span className="conversationIcon agentIcon"><Bot size={18} /></span>
                      <span className="conversationMeta">
                        <strong>{agent.name}<em className={`agentStatusDot ${status}`}>{agentStatusText(status)}</em></strong>
                        <small>{agent.defaultModel || "未配置模型"} · {continued ? "继续对话" : "开始对话"}</small>
                      </span>
                    </button>
                  );
                })}
                {!filteredAgents.length && <div className="sideEmpty">暂无匹配智能体。请确认 Vibe Claw 已启动并创建 Agent。</div>}
              </>
            ) : activeTab === "groups" ? (
              <>
                {groupConversations.map(item => (
                  <button className={`conversationItem ${active?.id === item.id ? "active" : ""}`} key={item.id} onClick={() => setActive(item)}>
                    <span className="conversationIcon"><Users size={18} /></span>
                    <span className="conversationMeta">
                      <strong>{item.title}</strong>
                      <small>{item.latestText || "暂无消息"}</small>
                    </span>
                    {item.unread > 0 && <b>{item.unread}</b>}
                  </button>
                ))}
                {!groupConversations.length && <div className="sideEmpty">暂无群聊，可通过上方加号创建。</div>}
              </>
            ) : (
              <>
                {conversations.map(item => (
                  <button className={`conversationItem ${active?.id === item.id ? "active" : ""}`} key={item.id} onClick={() => setActive(item)}>
                    <span className={`conversationIcon ${item.isAgent ? "agentIcon" : ""}`}>{item.isAgent ? <Bot size={18} /> : item.type === "group" ? <Users size={18} /> : <MessageCircle size={18} />}</span>
                    <span className="conversationMeta">
                      <strong>{item.title}</strong>
                      <small>{item.latestText || "暂无消息"}</small>
                    </span>
                    {item.unread > 0 && <b>{item.unread}</b>}
                  </button>
                ))}
                {!conversations.length && <div className="sideEmpty">暂无聊天，可搜索用户发起单聊或创建群聊。</div>}
              </>
            )}
          </section>
        </aside>

        <section className="chatPane">
        {active ? (
          <>
            <header className="chatHeader">
              <div className="chatHeaderPrimary">
                <div>
                  <h2>{activeSummary?.title || active.title || "会话"}</h2>
                  <span>
                    {activeSummary?.isAgent || active.isAgent
                      ? `Vibe Claw 智能体 · ${agentStatusText(currentAgent ? agentStatusFor(currentAgent) : clawHealth?.status || "online")}`
                      : active.type === "group" ? `${members.length} 位成员` : "2 位成员"}
                  </span>
                </div>
                <button className="secondaryButton compactButton" type="button" onClick={() => setModal("chatInfo")}><UserPlus size={15} />成员</button>
              </div>
            </header>

            <div className="messageList" ref={messageListRef} onScroll={handleMessageListScroll}>
              {(activeSummary?.isAgent || active.isAgent) && !messages.length && (
                <article className="agentWelcome">
                  <strong>{currentAgent?.name || activeSummary?.title || active.title}</strong>
                  <p>{currentAgent?.description || "这是一个来自 Vibe Claw 的智能体。你可以直接发送问题开始对话。"}</p>
                  <div>
                    {["请介绍你的能力", "帮我拆解下一步任务", "给我一个简短行动清单"].map(text => (
                      <button type="button" key={text} onClick={() => setDraft(text)}>{text}</button>
                    ))}
                  </div>
                </article>
              )}
              {messages.map(message => {
                if (message.type === "system") {
                  return (
                    <article className="chatSystemMessage" key={message.id}>
                      <span>{message.systemText}</span>
                    </article>
                  );
                }

                return (
                  <article className={`message ${message.sender.id === auth.user.id ? "own" : ""}`} key={message.id}>
                    <div className="bubbleHead">
                      <span className="messageAvatar">{String(message.sender.displayName || message.sender.username || "?").slice(0, 1).toUpperCase()}</span>
                      <strong>{message.sender.displayName}</strong>
                      <time>{formatTime(message.createdAt)}</time>
                    </div>
                    {message.type === "text" && (() => {
                      const text = plainTextById[message.id] || "";
                      const isAgentMessage = message.sender.role === "agent";
                      const long = isAgentMessage && isLongAgentText(text);
                      const expanded = Boolean(expandedMessages[message.id]);
                      if (!long) return <MessageText text={text} onCopyCode={copyMessageText} />;
                      return (
                        <div className={`longMessageBubble ${expanded ? "expanded" : ""}`}>
                          <div className="longMessageContent">
                            {renderRichText(text, { onCopyCode: copyMessageText })}
                          </div>
                          {!expanded && <span className="longMessageFade" />}
                          <div className="messageActions">
                            <button type="button" onClick={() => setExpandedMessages(current => ({ ...current, [message.id]: !expanded }))}>
                              {expanded ? "收起" : "展开全文"}
                            </button>
                            <button type="button" onClick={() => setReaderMessage({ message, text })}>阅读模式</button>
                            <button type="button" onClick={() => copyMessageText(text)}>复制</button>
                            <button type="button" onClick={() => exportMarkdown(text, `${message.sender.displayName || "agent"}-${message.id}.md`)}>导出 Markdown</button>
                          </div>
                        </div>
                      );
                    })()}
                    {message.attachment && (
                      message.attachment.kind === "image"
                        ? <a href={message.attachment.url} target="_blank" rel="noreferrer"><img src={message.attachment.url} alt={message.attachment.fileName} /></a>
                        : <a className="fileLink" href={message.attachment.url} target="_blank" rel="noreferrer">{message.attachment.fileName}</a>
                    )}
                  </article>
                );
              })}
              {activeAgentThinking && (
                <article className="message agentThinking">
                  <div className="bubbleHead">
                    <span className="messageAvatar"><Bot size={16} /></span>
                    <strong>{activeSummary?.title || active.title || "Agent"}</strong>
                    <time>正在思考</time>
                  </div>
                  <p><span className="typingDots"><i></i><i></i><i></i></span></p>
                </article>
              )}
              {active && agentTimeoutByConversation[active.id] && (
                <article className="chatSystemMessage warning">
                  <span>Agent 回复时间较长，仍在等待 Vibe Claw 返回。你可以稍后查看，或检查后台连接诊断。</span>
                </article>
              )}
              {activeConversationFailedMessages.map(item => (
                <article className="message own failedLocal" key={item.localId}>
                  <div className="bubbleHead">
                    <span className="messageAvatar">{String(auth.user.displayName || auth.user.username || "?").slice(0, 1).toUpperCase()}</span>
                    <strong>{auth.user.displayName}</strong>
                    <time>{formatTime(item.createdAt)} · 发送失败</time>
                  </div>
                  <MessageText text={item.text} onCopyCode={copyMessageText} />
                  <div className="failedActions">
                    <span>{item.error}</span>
                    <button type="button" onClick={() => sendTextMessage(item.text, item.localId)}>重试</button>
                    <button type="button" onClick={() => setFailedMessages(current => current.filter(message => message.localId !== item.localId))}>移除</button>
                  </div>
                </article>
              ))}
              <div ref={bottomRef} />
            </div>

            <form className="composer" onSubmit={sendMessage}>
              <label className="uploadButton">
                <ImageIcon size={18} />
                <input type="file" accept="image/*" onChange={uploadAndSend} />
              </label>
              <label className="uploadButton">
                <FileUp size={18} />
                <input type="file" onChange={uploadAndSend} />
              </label>
              <input ref={composerInputRef} value={draft} onChange={event => setDraft(event.target.value)} placeholder="输入消息，使用 @username 提及成员" />
              <button className="primaryButton" type="submit" disabled={activeSending || !draft.trim()}>
                <Send size={18} />{activeSending ? "发送中..." : "发送"}
              </button>
            </form>
          </>
        ) : (
          <div className="emptyState">选择一个会话，或搜索用户后开始聊天。</div>
        )}
        </section>

      {modal === "createGroup" && (
        <Modal title="创建群聊" onClose={closeCreateGroupModal}>
          <form className="createGroupForm" onSubmit={createGroup}>
            <label>
              群名称
              <input placeholder="输入群名称" value={groupName} onChange={event => setGroupName(event.target.value)} autoFocus />
            </label>
            <label>
              邀请成员
              <UserSuggestInput
                value={createInviteName}
                onChange={setCreateInviteName}
                onPick={addCreateMember}
                excludeUserIds={createMemberUserIds}
                placeholder="输入 @username 搜索并添加"
              />
            </label>
            {!!createMembers.length && (
              <div className="selectedMembers">
                {createMembers.map(user => (
                  <button type="button" key={user.id} onClick={() => removeCreateMember(user.id)}>
                    @{user.username}<span>×</span>
                  </button>
                ))}
              </div>
            )}
            <div className="modalActions">
              <button className="secondaryButton" type="button" onClick={closeCreateGroupModal}>取消</button>
              <button className="primaryButton" type="submit"><Plus size={16} />创建</button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "chatInfo" && active && (
        <Modal title={active.type === "group" ? "群聊信息" : "聊天信息"} onClose={() => setModal("")}>
          <div className="chatInfoPanel">
            <section className="chatInfoSummary">
              <span className="conversationIcon large">{active.type === "group" ? <Users size={22} /> : <MessageCircle size={22} />}</span>
              <div>
                <strong>{activeSummary?.title || active.title || "会话"}</strong>
                <small>{active.type === "group" ? `${members.length} 位成员` : "单聊"}</small>
              </div>
            </section>

            {active.type === "group" && (
              <>
                <form className="modalInviteRow" onSubmit={inviteMember}>
                  <UserSuggestInput
                    value={inviteName}
                    onChange={setInviteName}
                    onPick={user => inviteMemberByUsername(user.username)}
                    excludeUserIds={activeMemberUserIds}
                    placeholder="输入 @username 搜索并加入"
                  />
                  <button className="secondaryButton" type="submit">邀请</button>
                </form>
                <section className="memberList">
                  {members.map(member => (
                    <div className="memberRow" key={member.id}>
                      <span className="miniAvatar">{String(member.displayName || member.username || "?").slice(0, 1).toUpperCase()}</span>
                      <div>
                        <strong>{member.displayName}</strong>
                        <small>@{member.username}{member.memberRole ? ` · ${member.memberRole}` : ""}</small>
                      </div>
                      {canManageActiveGroup && member.id !== auth.user.id && member.memberRole !== "owner" && (
                        <button className="dangerButton" type="button" onClick={() => setConfirmAction({
                          type: "removeMember",
                          memberId: member.id,
                          title: "移除成员",
                          message: `确定将 ${member.displayName || member.username} 移出群聊吗？`,
                          confirmText: "移除"
                        })}>移除</button>
                      )}
                    </div>
                  ))}
                </section>
                {canDissolveActiveGroup && (
                  <button className="fullDangerButton" type="button" onClick={() => setConfirmAction({
                    type: "dissolveGroup",
                    title: "解散群聊",
                    message: "确定解散这个群聊吗？解散后成员将无法继续访问该群。",
                    confirmText: "解散"
                  })}><Trash2 size={16} />解散群聊</button>
                )}
              </>
            )}

            {active.type === "direct" && (
              <button className="fullDangerButton" type="button" onClick={() => setConfirmAction({
                type: "deleteDirect",
                title: "删除聊天",
                message: "确定删除这个单聊吗？聊天记录会从双方会话列表中移除。",
                confirmText: "删除"
              })}><Trash2 size={16} />删除聊天</button>
            )}
          </div>
        </Modal>
      )}
      {readerMessage && (
        <Modal title={`${readerMessage.message.sender.displayName} · 阅读模式`} onClose={() => setReaderMessage(null)} className="readerModal">
          <div className="readerPanel">
            <div className="readerMeta">
              <span>{formatTime(readerMessage.message.createdAt)}</span>
              <div className="readerActions">
                <button className="secondaryButton" type="button" onClick={() => copyMessageText(readerMessage.text)}>复制全文</button>
                <button className="secondaryButton" type="button" onClick={() => exportMarkdown(readerMessage.text, `${readerMessage.message.sender.displayName || "agent"}-${readerMessage.message.id}.md`)}>导出 Markdown</button>
              </div>
            </div>
            <div className="readerLayout">
              <nav className="readerToc">
                <strong>目录</strong>
                {extractMarkdownHeadings(readerMessage.text).length ? (
                  extractMarkdownHeadings(readerMessage.text).map(item => (
                    <a key={item.id} className={`level-${item.level}`} href={`#${item.id}`}>{item.text}</a>
                  ))
                ) : (
                  <span>暂无标题</span>
                )}
              </nav>
              <article className="readerContent">{renderRichText(readerMessage.text, { withHeadingIds: true, onCopyCode: copyMessageText })}</article>
            </div>
          </div>
        </Modal>
      )}
      {confirmAction && (
        <ConfirmModal
          title={confirmAction.title}
          message={confirmAction.message}
          confirmText={confirmAction.confirmText}
          danger
          onConfirm={confirmCurrentAction}
          onCancel={() => setConfirmAction(null)}
        />
      )}
      </main>
    </>
  );
}

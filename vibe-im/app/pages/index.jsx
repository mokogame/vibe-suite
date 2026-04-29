import { useEffect, useMemo, useRef, useState } from "react";
import Head from "next/head";
import {
  FileUp,
  Image as ImageIcon,
  LogOut,
  MessageCircle,
  Plus,
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

function Modal({ title, children, onClose }) {
  return (
    <div className="modalBackdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={event => event.stopPropagation()}>
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
      height: `${visibleRows * rowHeight}px`,
      overflowY: nextResults.length > 10 ? "auto" : "hidden"
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
    window.addEventListener("scroll", updateFloatingPosition, true);
    return () => {
      window.removeEventListener("resize", updateFloatingPosition);
      window.removeEventListener("scroll", updateFloatingPosition, true);
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
        <div ref={listRef} className="suggestList" style={floatingStyle || undefined}>
          {results.map(user => (
            <button type="button" key={user.id} onMouseDown={event => event.preventDefault()} onClick={() => pick(user)}>
              <UserRound size={16} />
              <span>
                <strong>{user.displayName}</strong>
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
  const [members, setMembers] = useState([]);
  const [friends, setFriends] = useState([]);
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
  const wsRef = useRef(null);
  const bottomRef = useRef(null);
  const composerInputRef = useRef(null);
  const { showError, showNotice } = useSystemNotice();

  const transportKey = auth?.transportKey || "";

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
  }, [auth?.token, active?.id]);

  useEffect(() => {
    if (!active || !transportKey) return;
    api(`/api/conversations/${encodeURIComponent(active.id)}/messages?limit=100`)
      .then(data => setMessages(data.messages || []))
      .catch(showError);
    api(`/api/conversations/${encodeURIComponent(active.id)}`)
      .then(data => setMembers(data.members || []))
      .catch(showError);
  }, [active?.id, transportKey]);

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
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    if (active && messages.length) {
      const latest = messages[messages.length - 1];
      api(`/api/conversations/${encodeURIComponent(active.id)}`, {
        method: "PATCH",
        body: { action: "read", seq: latest.seq }
      }).then(loadConversations).catch(() => {});
    }
  }, [messages.length, active?.id]);

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

  async function sendMessage(event) {
    event.preventDefault();
    if (!active || !draft.trim()) return;
    const encryptedText = await encryptText(draft.trim(), transportKey);
    await api(`/api/conversations/${encodeURIComponent(active.id)}/messages`, {
      method: "POST",
      body: { type: "text", encryptedText }
    });
    setDraft("");
    requestAnimationFrame(() => {
      composerInputRef.current?.focus({ preventScroll: true });
    });
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
  const visibleConversations = activeTab === "groups" ? groupConversations : conversations;
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
        <aside className="sidebar">
        <div className="profileBar">
          <div className="avatar">{String(auth.user.displayName || auth.user.username || "?").slice(0, 1).toUpperCase()}</div>
          <div><strong>{auth.user.displayName}</strong><span>@{auth.user.username}</span></div>
          <div className="iconRow">
            {auth.user.role === "admin" && <a href="/admin" title="后台"><Settings size={18} /></a>}
            <button type="button" title="退出" onClick={logout}><LogOut size={18} /></button>
          </div>
        </div>

        <div className="tabs">
          <button className={activeTab === "chats" ? "active" : ""} type="button" onClick={() => setActiveTab("chats")}><MessageCircle size={16} />聊天</button>
          <button className={activeTab === "friends" ? "active" : ""} type="button" onClick={() => setActiveTab("friends")}><UserRound size={16} />好友</button>
          <button className={activeTab === "groups" ? "active" : ""} type="button" onClick={() => setActiveTab("groups")}><Users size={16} />群聊</button>
        </div>

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
              placeholder="搜索用户 username"
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

        <section className="conversationList">
          <div className="listHeader">
            <span>{activeTab === "groups" ? "群聊" : activeTab === "friends" ? "好友" : "最近聊天"}</span>
            <button
              className="listAddButton"
              type="button"
              title="创建群聊"
              onClick={() => setModal("createGroup")}
            >
              <Plus size={16} />
            </button>
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
          ) : (
            <>
              {visibleConversations.map(item => (
                <button className={`conversationItem ${active?.id === item.id ? "active" : ""}`} key={item.id} onClick={() => setActive(item)}>
                  <span className="conversationIcon">{item.type === "group" ? <Users size={18} /> : <MessageCircle size={18} />}</span>
                  <span className="conversationMeta">
                    <strong>{item.title}</strong>
                    <small>{item.latestText || "暂无消息"}</small>
                  </span>
                  {item.unread > 0 && <b>{item.unread}</b>}
                </button>
              ))}
              {!visibleConversations.length && (
                <div className="sideEmpty">{activeTab === "groups" ? "暂无群聊，可通过右上角加号创建。" : "暂无聊天，可搜索用户发起单聊或创建群聊。"}</div>
              )}
            </>
          )}
        </section>

        <footer className="sidebarFooter">
          {auth.user.role === "admin" && <a className="adminLink" href="/admin"><Shield size={16} />管理后台</a>}
        </footer>
        </aside>

        <section className="chatPane">
        {active ? (
          <>
            <header className="chatHeader">
              <div className="chatHeaderPrimary">
                <div>
                  <h2>{activeSummary?.title || active.title || "会话"}</h2>
                  <span>{active.type === "group" ? `${members.length} 位成员` : "2 位成员"}</span>
                </div>
                <button className="secondaryButton compactButton" type="button" onClick={() => setModal("chatInfo")}><UserPlus size={15} />成员</button>
              </div>
            </header>

            <div className="messageList">
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
                    {message.type === "text" && <p>{plainTextById[message.id] || ""}</p>}
                    {message.attachment && (
                      message.attachment.kind === "image"
                        ? <a href={message.attachment.url} target="_blank" rel="noreferrer"><img src={message.attachment.url} alt={message.attachment.fileName} /></a>
                        : <a className="fileLink" href={message.attachment.url} target="_blank" rel="noreferrer">{message.attachment.fileName}</a>
                    )}
                  </article>
                );
              })}
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
              <button className="primaryButton" type="submit"><Send size={18} />发送</button>
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

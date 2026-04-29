import { useEffect, useState } from "react";
import Head from "next/head";
import { ArrowLeft, Bot, Plus, RefreshCw, Shield, UserRound } from "lucide-react";
import { useSystemNotice } from "../components/SystemNotice";

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

export default function AdminPage() {
  const [auth, setAuth] = useState(null);
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ username: "", displayName: "", password: "password123", role: "user" });
  const [clawConfig, setClawConfig] = useState({ baseUrl: "http://localhost:3100", token: "", tokenMasked: "", timeoutMs: 90000 });
  const [clawHealth, setClawHealth] = useState(null);
  const [clawSaving, setClawSaving] = useState(false);
  const [clawChecking, setClawChecking] = useState(false);
  const { showError, showNotice } = useSystemNotice();

  useEffect(() => {
    api("/api/auth/me").then(data => {
      setAuth(data);
      if (data.user.role === "admin") {
        loadUsers();
        loadClawConfig();
      }
    }).catch(showError);
  }, []);

  async function loadUsers() {
    const data = await api("/api/admin/users");
    setUsers(data.users || []);
  }

  async function createUser(event) {
    event.preventDefault();
    try {
      await api("/api/admin/users", { method: "POST", body: form });
      setForm({ username: "", displayName: "", password: "password123", role: "user" });
      showNotice("用户已创建");
      loadUsers();
    } catch (err) {
      showError(err);
    }
  }

  async function updateUser(userId, patch) {
    try {
      await api("/api/admin/users", { method: "PATCH", body: { userId, ...patch } });
      loadUsers();
    } catch (err) {
      showError(err);
    }
  }

  async function loadClawConfig() {
    const data = await api("/api/admin/vibe-claw-config");
    setClawConfig({
      baseUrl: data.config?.baseUrl || "http://localhost:3100",
      token: "",
      tokenMasked: data.config?.tokenMasked || "",
      timeoutMs: data.config?.timeoutMs || 90000
    });
    setClawHealth(data.health || null);
  }

  async function saveClawConfig(event) {
    event.preventDefault();
    setClawSaving(true);
    try {
      const payload = {
        baseUrl: clawConfig.baseUrl,
        timeoutMs: Number(clawConfig.timeoutMs) || 90000
      };
      if (clawConfig.token.trim()) payload.token = clawConfig.token.trim();
      const data = await api("/api/admin/vibe-claw-config", { method: "PATCH", body: payload });
      setClawConfig({
        baseUrl: data.config?.baseUrl || payload.baseUrl,
        token: "",
        tokenMasked: data.config?.tokenMasked || "",
        timeoutMs: data.config?.timeoutMs || payload.timeoutMs
      });
      setClawHealth(data.health || null);
      showNotice("Vibe Claw 配置已保存");
    } catch (err) {
      showError(err);
    } finally {
      setClawSaving(false);
    }
  }

  async function diagnoseClaw() {
    setClawChecking(true);
    try {
      await loadClawConfig();
      showNotice("连接诊断已完成");
    } catch (err) {
      showError(err);
    } finally {
      setClawChecking(false);
    }
  }

  async function refreshAll() {
    await Promise.all([loadUsers(), loadClawConfig()]);
  }

  function healthLabel(status) {
    return {
      online: "在线",
      config_error: "配置异常",
      model_unavailable: "模型不可用",
      agent_unavailable: "Agent 不可用",
      timeout: "连接超时"
    }[status] || "未知";
  }

  const activeUserCount = users.filter(user => user.status === "active").length;
  const adminUserCount = users.filter(user => user.role === "admin").length;

  if (!auth) {
    return (
      <>
        <Head>
          <title>vibe-admin</title>
        </Head>
        <main className="adminShell"><div className="emptyState">正在加载</div></main>
      </>
    );
  }

  if (auth.user.role !== "admin") {
    return (
      <>
        <Head>
          <title>vibe-admin</title>
        </Head>
        <main className="adminShell"><div className="emptyState">仅管理员可访问</div></main>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>vibe-admin</title>
      </Head>
      <main className="adminDashboard">
        <aside className="adminMenu">
          <div className="adminBrand">
            <span className="adminBrandMark"><Shield size={20} /></span>
            <div>
              <strong>Vibe Admin</strong>
              <small>即时通讯后台</small>
            </div>
          </div>

          <nav className="adminNav">
            <button className="active" type="button"><UserRound size={17} />用户管理</button>
            <a href="/"><ArrowLeft size={17} />返回聊天</a>
          </nav>

          <div className="adminMenuFooter">
            <small>当前账号</small>
            <strong>{auth.user.displayName}</strong>
            <span>@{auth.user.username}</span>
          </div>
        </aside>

        <section className="adminContent">
          <header className="adminTopbar">
            <div>
              <span className="adminEyebrow">后台管理</span>
              <h1>用户管理</h1>
              <p>创建账号、调整角色，并管理用户启用状态。</p>
            </div>
            <button className="secondaryButton" type="button" onClick={refreshAll}><RefreshCw size={16} />刷新</button>
          </header>

          <section className="adminMetricGrid">
            <div className="adminMetricCard">
              <span>总用户</span>
              <strong>{users.length}</strong>
            </div>
            <div className="adminMetricCard">
              <span>启用用户</span>
              <strong>{activeUserCount}</strong>
            </div>
            <div className="adminMetricCard">
              <span>管理员</span>
              <strong>{adminUserCount}</strong>
            </div>
          </section>

          <section className="adminLayout">
            <form className="adminCard createUserCard" onSubmit={createUser}>
              <h2><Plus size={18} />创建用户</h2>
              <label>用户名<input value={form.username} onChange={event => setForm({ ...form, username: event.target.value })} /></label>
              <label>显示名称<input value={form.displayName} onChange={event => setForm({ ...form, displayName: event.target.value })} /></label>
              <label>初始密码<input value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} /></label>
              <label>角色
                <select value={form.role} onChange={event => setForm({ ...form, role: event.target.value })}>
                  <option value="user">普通用户</option>
                  <option value="admin">管理员</option>
                </select>
              </label>
              <button className="primaryButton" type="submit">创建</button>
            </form>

            <form className="adminCard clawConfigCard" onSubmit={saveClawConfig}>
              <h2><Bot size={18} />Vibe Claw 接入</h2>
              <p className="adminCardHint">配置 vibe-im 调用 vibe-claw 的服务地址、访问令牌和超时时间。令牌保存后仅掩码显示。</p>
              <label>Base URL
                <input
                  value={clawConfig.baseUrl}
                  onChange={event => setClawConfig(current => ({ ...current, baseUrl: event.target.value }))}
                  placeholder="http://localhost:3100"
                />
              </label>
              <label>API Token
                <input
                  type="password"
                  value={clawConfig.token}
                  onChange={event => setClawConfig(current => ({ ...current, token: event.target.value }))}
                  placeholder={clawConfig.tokenMasked ? `当前：${clawConfig.tokenMasked}` : "dev-token"}
                />
              </label>
              <label>超时毫秒
                <input
                  type="number"
                  min="5000"
                  step="1000"
                  value={clawConfig.timeoutMs}
                  onChange={event => setClawConfig(current => ({ ...current, timeoutMs: event.target.value }))}
                />
              </label>
              <div className={`clawHealthCard ${clawHealth?.status || "unknown"}`}>
                <strong>{healthLabel(clawHealth?.status)}</strong>
                <span>{clawHealth?.message || "尚未诊断"}</span>
                <small>{clawHealth?.latencyMs ? `${clawHealth.latencyMs}ms` : "等待连接检查"}</small>
              </div>
              <div className="adminActionRow">
                <button className="secondaryButton" type="button" onClick={diagnoseClaw} disabled={clawChecking}>
                  {clawChecking ? "诊断中..." : "连接诊断"}
                </button>
                <button className="primaryButton" type="submit" disabled={clawSaving}>
                  {clawSaving ? "保存中..." : "保存配置"}
                </button>
              </div>
            </form>

            <section className="adminCard tableCard">
              <h2><UserRound size={18} />用户列表</h2>
              <table>
                <thead>
                  <tr>
                    <th>用户</th>
                    <th>角色</th>
                    <th>状态</th>
                    <th>创建时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(user => (
                    <tr key={user.id}>
                      <td><strong>{user.displayName}</strong><small>@{user.username}</small></td>
                      <td>{user.role === "admin" ? <span className="badge"><Shield size={13} />管理员</span> : "普通用户"}</td>
                      <td>{user.status === "active" ? "启用" : "禁用"}</td>
                      <td>{user.createdAt || "-"}</td>
                      <td>
                        <button className={user.status === "active" ? "dangerButton" : "secondaryButton"} type="button" onClick={() => updateUser(user.id, { status: user.status === "active" ? "disabled" : "active" })}>
                          {user.status === "active" ? "禁用" : "启用"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </section>
        </section>
      </main>
    </>
  );
}

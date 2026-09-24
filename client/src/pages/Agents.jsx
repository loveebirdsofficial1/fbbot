import { useCallback, useEffect, useRef, useState } from 'react';
import { api, uploadFile } from '../api';
import { useAuth } from '../context/AuthContext.jsx';
import Avatar from '../components/Avatar.jsx';

function AgentRowPhoto({ agent, onPhoto }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  async function pick(e) {
    const f = e.target.files?.[0];
    if (!f || busy) return;
    setBusy(true);
    try {
      const up = await uploadFile(f);
      await onPhoto(agent.id, up.url);
    } catch (err) {
      console.error('photo upload failed', err.message);
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = '';
    }
  }
  return (
    <>
      <input ref={ref} type="file" accept="image/*" hidden onChange={pick} />
      <button
        type="button"
        onClick={() => ref.current?.click()}
        disabled={busy}
        title="Profile pic set karein"
        className="rounded-lg border border-slate-200 px-2 py-1 text-sm text-slate-500 hover:bg-slate-50"
      >
        {busy ? '…' : '📷'}
      </button>
    </>
  );
}

export default function Agents() {
  const { user } = useAuth();
  const [agents, setAgents] = useState([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const { agents: list } = await api.agents();
    setAgents(list);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function create(e) {
    e.preventDefault();
    setErr('');
    try {
      await api.createAgent(name.trim(), email.trim(), password);
      setMsg(`Agent ban gaya: ${email.trim()}`);
      setName('');
      setEmail('');
      setPassword('');
      load();
    } catch (e) {
      setErr(e.message || 'Kuch ghalat hua');
    }
  }

  async function remove(id) {
    if (!window.confirm('Is agent ko delete karna hai?')) return;
    try {
      await api.deleteAgent(id);
      setAgents((prev) => prev.filter((a) => a.id !== id));
    } catch (e) {
      setErr(e.message);
    }
  }

  async function updatePhoto(id, photo) {
    const { agent } = await api.updateAgentPhoto(id, photo);
    setAgents((prev) => prev.map((a) => (a.id === agent.id ? agent : a)));
  }

  return (
    <div className="h-full overflow-y-auto bg-sky-50 p-6">
      <h1 className="bg-gradient-to-br from-brand to-lemon bg-clip-text text-2xl font-bold text-transparent">
        Agents
      </h1>

      <form onSubmit={create} className="mt-4 rounded-xl border border-lemon-soft bg-white p-4 shadow">
        <div className="grid gap-3 sm:grid-cols-4">
          <input
            placeholder="Naam"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-lemon"
          />
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-lemon"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-lemon"
          />
          <button className="rounded-lg bg-gradient-to-br from-brand to-lemon px-4 py-2 text-sm font-semibold text-white hover:brightness-110">
            Create
          </button>
        </div>
        {msg && <p className="mt-2 text-sm text-green-600">{msg}</p>}
        {err && <p className="mt-2 text-sm text-brand">{err}</p>}
      </form>

      <div className="mt-4 overflow-hidden rounded-xl border border-lemon-soft bg-white shadow">
        {agents.map((a) => (
          <div
            key={a.id}
            className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 last:border-0"
          >
            <div className="flex items-center gap-3">
              <Avatar name={a.name} photo={a.photo} className="h-10 w-10 text-base" />
              <div>
                <p className="text-sm font-semibold text-slate-800">{a.name}</p>
                <p className="text-xs text-slate-500">
                  {a.email}
                  {a.role === 'admin' && (
                    <span className="ml-2 rounded bg-brand-soft px-1.5 py-0.5 text-[10px] font-semibold text-brand">
                      {a.role}
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <AgentRowPhoto agent={a} onPhoto={updatePhoto} />
              {a.id !== user?.id && a.role !== 'admin' && (
                <button
                  onClick={() => remove(a.id)}
                  className="rounded-lg px-3 py-1.5 text-sm text-brand hover:bg-brand-soft"
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
        {!agents.length && <p className="p-4 text-sm text-slate-400">Abhi koi agent nahi hai.</p>}
      </div>
    </div>
  );
}
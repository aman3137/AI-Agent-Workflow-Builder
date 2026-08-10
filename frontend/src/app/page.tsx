'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { ApolloProvider, useQuery, useMutation } from '@apollo/client/react';
import { gql } from '@apollo/client/core';
import { createApolloClient } from '../lib/apolloClient';

// GraphQL operations
const GET_DASHBOARD = gql`
  query GetDashboard($orgId: uuid!) {
    workflows(order_by: {created_at: desc}) {
      id
      name
      description
      created_at
      runs(order_by: {created_at: desc}, limit: 1) {
        status
        started_at
      }
    }
    organizations_by_pk(id: $orgId) {
      id
      name
      quota_limit
      quota_usage
    }
    org_usage_stats {
      total_workflows
      total_runs
      completed_runs
      failed_runs
      average_run_duration_seconds
    }
  }
`;

const CREATE_WORKFLOW = gql`
  mutation CreateWorkflow($name: String!, $description: String, $orgId: uuid!) {
    insert_workflows_one(object: {name: $name, description: $description, org_id: $orgId}) {
      id
      name
    }
  }
`;

function DashboardContent({ onLogout, user, org, role }: any) {
  const [wfName, setWfName] = useState('');
  const [wfDesc, setWfDesc] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const { data, loading, error, refetch } = useQuery(GET_DASHBOARD, {
    variables: { orgId: org.id },
  });

  const [createWorkflow] = useMutation(CREATE_WORKFLOW);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wfName) return;
    setErrorMsg('');
    setSuccessMsg('');

    try {
      await createWorkflow({
        variables: {
          name: wfName,
          description: wfDesc,
          orgId: org.id,
        },
      });
      setWfName('');
      setWfDesc('');
      setSuccessMsg('Workflow created successfully!');
      refetch();
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || 'Failed to create workflow');
    }
  };

  if (loading) return <div style={{ padding: '2rem', textAlign: 'center' }}>Loading dashboard data...</div>;
  if (error) return <div style={{ padding: '2rem', textAlign: 'center', color: 'red' }}>Error loading dashboard: {error.message}</div>;

  const workflows = (data as any)?.workflows || [];
  const orgDetails = (data as any)?.organizations_by_pk || org;
  const stats = (data as any)?.org_usage_stats?.[0] || {
    total_workflows: 0,
    total_runs: 0,
    completed_runs: 0,
    failed_runs: 0,
    average_run_duration_seconds: 0,
  };

  const quotaPercent = Math.min(100, (orgDetails.quota_usage / orgDetails.quota_limit) * 100);
  const isQuotaWarn = quotaPercent >= 75 && quotaPercent < 90;
  const isQuotaDanger = quotaPercent >= 90;

  return (
    <div>
      <header className="header">
        <div className="logo-group">
          <div className="logo-icon">W</div>
          <div className="logo-text">FlowAgent</div>
        </div>
        <div className="nav-right">
          <div className="quota-indicator">
            <div className="quota-label">
              <span>Quota Used</span>
              <span>{orgDetails.quota_usage} / {orgDetails.quota_limit}</span>
            </div>
            <div className="quota-bar-container">
              <div 
                className={`quota-bar ${isQuotaDanger ? 'danger' : isQuotaWarn ? 'warning' : ''}`}
                style={{ width: `${quotaPercent}%` }}
              ></div>
            </div>
          </div>
          <div className="user-badge">
            <span>{user.email}</span>
            <span className="user-role-tag">{role}</span>
          </div>
          <button className="btn btn-secondary" onClick={onLogout} style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}>Log Out</button>
        </div>
      </header>

      <div className="dashboard-grid">
        <aside className="dashboard-sidebar">
          <div className="panel">
            <h3 className="panel-title">Organization</h3>
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Acting Organization</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#fff', marginTop: '0.2rem' }}>{org.name}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'monospace', wordBreak: 'break-all', marginTop: '0.4rem' }}>ID: {org.id}</div>
            </div>
            <hr style={{ border: '0', borderTop: '1px solid var(--panel-border)', margin: '1rem 0' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Your Access Level:</span>
                <div style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--primary)' }}>{role.toUpperCase()}</div>
              </div>
            </div>
          </div>

          <div className="panel">
            <h3 className="panel-title">Usage Statistics</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: '0.85rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Workflows</span>
                <span style={{ fontWeight: 'bold' }}>{stats.total_workflows}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Total Executions</span>
                <span style={{ fontWeight: 'bold' }}>{stats.total_runs}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--success)' }}>Success Runs</span>
                <span style={{ fontWeight: 'bold' }}>{stats.completed_runs}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--danger)' }}>Failed Runs</span>
                <span style={{ fontWeight: 'bold' }}>{stats.failed_runs}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Avg Duration</span>
                <span style={{ fontWeight: 'bold' }}>{stats.average_run_duration_seconds.toFixed(1)}s</span>
              </div>
            </div>
          </div>
        </aside>

        <main className="dashboard-content">
          {role !== 'viewer' && (
            <div className="panel">
              <h3 className="panel-title">Create New Workflow</h3>
              <form onSubmit={handleCreate} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: '1rem', alignItems: 'end' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="label">Workflow Name</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="E.g., Process Feedback"
                    value={wfName}
                    onChange={(e) => setWfName(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="label">Description</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="Short description of the sequence"
                    value={wfDesc}
                    onChange={(e) => setWfDesc(e.target.value)}
                  />
                </div>
                <button type="submit" className="btn btn-primary" style={{ height: '38px' }}>Create</button>
              </form>
              {errorMsg && <div style={{ color: 'var(--danger)', marginTop: '0.75rem', fontSize: '0.85rem' }}>{errorMsg}</div>}
              {successMsg && <div style={{ color: 'var(--success)', marginTop: '0.75rem', fontSize: '0.85rem' }}>{successMsg}</div>}
            </div>
          )}

          <div className="panel">
            <h3 className="panel-title">Workflows</h3>
            {workflows.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                No workflows found. Create one to get started!
              </div>
            ) : (
              <div className="card-grid">
                {workflows.map((wf: any) => (
                  <a href={`/builder?id=${wf.id}`} key={wf.id} className="workflow-card">
                    <div className="workflow-card-title">{wf.name}</div>
                    <div className="workflow-card-desc">{wf.description || 'No description provided.'}</div>
                    <div className="workflow-card-footer">
                      <span>Created {new Date(wf.created_at).toLocaleDateString()}</span>
                      {wf.runs?.[0] ? (
                        <span className={`status-badge ${wf.runs[0].status}`} style={{ padding: '0.1rem 0.4rem', fontSize: '0.65rem' }}>
                          Last: {wf.runs[0].status}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>Never Run</span>
                      )}
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

export default function Home() {
  const [isSignup, setIsSignup] = useState(false);
  const [isJoin, setIsJoin] = useState(false);

  // Auth form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('owner');
  const [orgName, setOrgName] = useState('');
  const [orgId, setOrgId] = useState('');
  const [authError, setAuthError] = useState('');

  // Session state
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);
  const [org, setOrg] = useState<any>(null);
  const [activeRole, setActiveRole] = useState<string>('viewer');

  // Restore session from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storedToken = localStorage.getItem('token');
      const storedUser = localStorage.getItem('user');
      const storedOrg = localStorage.getItem('org');
      const storedRole = localStorage.getItem('role');
      if (storedToken && storedUser && storedOrg && storedRole) {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));
        setOrg(JSON.parse(storedOrg));
        setActiveRole(storedRole);
      }
    }
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('org');
    localStorage.removeItem('role');
    setToken(null);
    setUser(null);
    setOrg(null);
    setActiveRole('viewer');
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');

    const endpoint = isJoin
      ? 'http://localhost:5001/api/auth/join'
      : isSignup
      ? 'http://localhost:5001/api/auth/signup'
      : 'http://localhost:5001/api/auth/login';

    const payload = isJoin
      ? { email, password, orgId, role }
      : isSignup
      ? { email, password, role, orgName }
      : { email, password };

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || 'Authentication failed');

      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      localStorage.setItem('org', JSON.stringify(data.organization));
      localStorage.setItem('role', data.role);

      setToken(data.token);
      setUser(data.user);
      setOrg(data.organization);
      setActiveRole(data.role);

      setEmail('');
      setPassword('');
      setOrgName('');
      setOrgId('');
    } catch (err: any) {
      console.error(err);
      setAuthError(err.message);
    }
  };

  // Build apollo client only when token exists and changes
  const apolloClient = useMemo(() => {
    if (!token) return null;
    return createApolloClient();
  }, [token]);

  if (token && apolloClient && user && org) {
    return (
      <ApolloProvider client={apolloClient}>
        <DashboardContent
          onLogout={handleLogout}
          user={user}
          org={org}
          role={activeRole}
        />
      </ApolloProvider>
    );
  }

  // Auth wall
  return (
    <div className="auth-container">
      <div className="auth-card" style={{ maxWidth: '480px' }}>
        <div className="auth-header">
          <div className="logo-icon" style={{ margin: '0 auto 1rem', width: '3rem', height: '3rem', fontSize: '1.25rem' }}>W</div>
          <h2 className="auth-title">AI Workflow Builder</h2>
          <p className="auth-subtitle">
            {isJoin ? 'Join an existing workspace' : isSignup ? 'Create a new workspace' : 'Log in to your workspace'}
          </p>
        </div>

        {/* ── Quick Login Presets (for evaluation) ── */}
        {!isSignup && !isJoin && (
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.6rem', textAlign: 'center' }}>
              ⚡ Quick Login — Evaluation Presets
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              {[
                { label: 'Org A — Owner',  email: 'owner-a@example.com',  orgId: 'a0000000-0000-0000-0000-00000000000a', role: 'owner',  accent: 'var(--primary)' },
                { label: 'Org A — Editor', email: 'editor-a@example.com', orgId: 'a0000000-0000-0000-0000-00000000000a', role: 'editor', accent: '#22c55e' },
                { label: 'Org A — Viewer', email: 'viewer-a@example.com', orgId: 'a0000000-0000-0000-0000-00000000000a', role: 'viewer', accent: '#f59e0b' },
                { label: 'Org B — Owner',  email: 'owner-b@example.com',  orgId: 'b0000000-0000-0000-0000-00000000000b', role: 'owner',  accent: '#ef4444' },
              ].map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={async () => {
                    setAuthError('');
                    try {
                      const res = await fetch('http://localhost:5001/api/auth/join', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email: preset.email, password: 'password123', orgId: preset.orgId, role: preset.role }),
                      });
                      const data = await res.json();
                      if (!res.ok) throw new Error(data.error || 'Login failed');
                      localStorage.setItem('token', data.token);
                      localStorage.setItem('user', JSON.stringify(data.user));
                      localStorage.setItem('org', JSON.stringify(data.organization));
                      localStorage.setItem('role', data.role);
                      setToken(data.token); setUser(data.user); setOrg(data.organization); setActiveRole(data.role);
                    } catch (err: any) { setAuthError(err.message); }
                  }}
                  style={{
                    padding: '0.55rem 0.75rem',
                    borderRadius: '8px',
                    border: `1px solid ${preset.accent}44`,
                    background: `${preset.accent}11`,
                    color: preset.accent,
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'background 0.2s',
                    textAlign: 'left',
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.background = `${preset.accent}22`)}
                  onMouseOut={(e) => (e.currentTarget.style.background = `${preset.accent}11`)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '1.25rem 0 0.5rem' }}>
              <div style={{ flex: 1, height: '1px', background: 'var(--panel-border)' }} />
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>or log in manually</span>
              <div style={{ flex: 1, height: '1px', background: 'var(--panel-border)' }} />
            </div>
          </div>
        )}

        <form onSubmit={handleAuthSubmit}>
          <div className="form-group">
            <label className="label">Email Address</label>
            <input type="email" className="input" placeholder="user@example.com"
              value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>

          <div className="form-group">
            <label className="label">Password</label>
            <input type="password" className="input" placeholder="••••••••"
              value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>

          {isSignup && !isJoin && (
            <>
              <div className="form-group">
                <label className="label">Organization Name</label>
                <input type="text" className="input" placeholder="Acme Corp"
                  value={orgName} onChange={(e) => setOrgName(e.target.value)} required />
              </div>
              <div className="form-group">
                <label className="label">Your Org Role</label>
                <select className="input select" value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="owner">Owner (Full Control)</option>
                  <option value="editor">Editor (Can edit and run)</option>
                  <option value="viewer">Viewer (Read-only)</option>
                </select>
              </div>
            </>
          )}

          {isJoin && (
            <>
              <div className="form-group">
                <label className="label">Organization UUID</label>
                <input type="text" className="input" placeholder="a0000000-0000-0000-0000-00000000000a"
                  value={orgId} onChange={(e) => setOrgId(e.target.value)} required />
                <small style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginTop: '0.2rem' }}>
                  Org A: a0000000-0000-0000-0000-00000000000a &nbsp;|&nbsp; Org B: b0000000-0000-0000-0000-00000000000b
                </small>
              </div>
              <div className="form-group">
                <label className="label">Join as Role</label>
                <select className="input select" value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="owner">Owner</option>
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
              </div>
            </>
          )}

          <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '1rem' }}>
            {isJoin ? 'Join Organization' : isSignup ? 'Sign Up' : 'Log In'}
          </button>
        </form>

        {authError && (
          <div style={{ color: 'var(--danger)', marginTop: '1rem', fontSize: '0.85rem', textAlign: 'center' }}>
            {authError}
          </div>
        )}

        <div className="auth-toggle">
          {!isJoin && !isSignup && (
            <>
              Don&apos;t have a workspace? <span onClick={() => { setIsSignup(true); setIsJoin(false); }}>Sign Up</span>
              <br />
              Need a custom join?{' '}
              <span onClick={() => { setIsJoin(true); setIsSignup(false); }} style={{ display: 'inline-block', marginTop: '0.5rem' }}>Join Existing Org</span>
            </>
          )}
          {isSignup && !isJoin && (
            <p>Already have a workspace? <span onClick={() => { setIsSignup(false); setIsJoin(false); }}>Log In</span></p>
          )}
          {isJoin && (
            <p>Go back to <span onClick={() => { setIsSignup(false); setIsJoin(false); }}>Log In</span></p>
          )}
        </div>
      </div>
    </div>
  );
}

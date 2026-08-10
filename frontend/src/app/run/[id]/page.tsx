'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { ApolloProvider, useSubscription, useMutation } from '@apollo/client/react';
import { gql } from '@apollo/client/core';
import { createApolloClient } from '../../../lib/apolloClient';

// GraphQL subscription for live workflow execution progress
const RUN_SUBSCRIPTION = gql`
  subscription GetStepRuns($runId: uuid!) {
    workflow_runs_by_pk(id: $runId) {
      id
      status
      trigger_type
      started_at
      completed_at
      workflow {
        id
        name
        org_id
      }
      step_runs(order_by: {step: {position: asc}}) {
        id
        step_id
        status
        input
        output
        error
        attempt_count
        approved_by
        approved_at
        step {
          id
          name
          type
          position
        }
      }
    }
  }
`;

const APPROVE_STEP = gql`
  mutation ApproveStep($stepRunId: uuid!) {
    approveStep(step_run_id: $stepRunId) {
      success
    }
  }
`;

function RunContent({ runId, user, role }: any) {
  const { data, loading, error } = useSubscription(RUN_SUBSCRIPTION, {
    variables: { runId },
  });

  const [approveStep] = useMutation(APPROVE_STEP);

  const [isApproving, setIsApproving] = useState(false);
  const [toast, setToast] = useState({ type: '', text: '' });

  const showToast = (type: string, text: string) => {
    setToast({ type, text });
    setTimeout(() => setToast({ type: '', text: '' }), 5000);
  };

  const handleApprove = async (stepRunId: string) => {
    setIsApproving(true);
    try {
      const res = await approveStep({ variables: { stepRunId } });
      if ((res.data as any)?.approveStep?.success) {
        showToast('success', 'Approval submitted successfully. Workflow resuming...');
      } else {
        showToast('error', 'Failed to approve step.');
      }
    } catch (err: any) {
      console.error(err);
      showToast('error', err.message || 'Permission denied: approval rejected by server.');
    } finally {
      setIsApproving(false);
    }
  };

  if (loading) return <div style={{ padding: '2rem', textAlign: 'center' }}>Connecting to live execution stream...</div>;
  if (error) return <div style={{ padding: '2rem', textAlign: 'center', color: 'red' }}>Subscription error: {error.message}</div>;

  const run = (data as any)?.workflow_runs_by_pk;
  const stepRuns = (data as any)?.workflow_runs_by_pk?.step_runs || [];

  if (!run) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center' }}>
        <h3>Execution run not found or access denied.</h3>
        <p style={{ color: 'var(--text-muted)', marginTop: '0.5rem' }}>Verify that you belong to the organization owning this workflow run.</p>
        <a href="/" className="btn btn-secondary" style={{ marginTop: '1.5rem' }}>← Go to Dashboard</a>
      </div>
    );
  }

  const pausedStep = stepRuns.find((sr: any) => sr.status === 'paused');

  return (
    <div>
      <header className="header">
        <div className="logo-group">
          <a href="/" className="logo-icon">W</a>
          <a href="/" className="logo-text">FlowAgent / Monitor</a>
        </div>
        <div className="nav-right">
          <a href={`/builder?id=${run.workflow.id}`} className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}>
            ← Back to Builder
          </a>
          <div className="user-badge">
            <span>{user.email}</span>
            <span className="user-role-tag">{role}</span>
          </div>
        </div>
      </header>

      <div className="run-progress-layout">
        <div className="panel" style={{ marginBottom: '1.5rem' }}>
          <div className="run-status-header" style={{ border: 'none', margin: 0, padding: 0 }}>
            <div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Workflow Executing</div>
              <h2 style={{ fontSize: '1.4rem', fontWeight: '700', color: '#fff', marginTop: '0.2rem' }}>{run.workflow.name}</h2>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.4rem', fontFamily: 'monospace' }}>
                Run ID: {run.id} | Trigger: {run.trigger_type.toUpperCase()}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <span className={`status-badge ${run.status}`} style={{ fontSize: '1rem', padding: '0.4rem 1rem' }}>
                {run.status}
              </span>
            </div>
          </div>
        </div>

        {/* Approval Modal Banner */}
        {pausedStep && (
          <div className="panel" style={{ borderColor: 'var(--warning)', background: 'rgba(245,158,11,0.05)', marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ color: 'var(--warning)', fontSize: '1.1rem', fontWeight: 'bold' }}>🛑 Pause Gate Encountered</h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-color)', marginTop: '0.2rem' }}>
                Workflow is paused at <strong>{pausedStep.step.name}</strong>. Resumption requires an Owner or Editor role approval.
              </p>
            </div>
            <div>
              {role === 'viewer' ? (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', border: '1px solid var(--panel-border)', padding: '0.4rem', borderRadius: '4px' }}>
                  🔒 View-only access
                </span>
              ) : (
                <button 
                  className="btn btn-primary" 
                  onClick={() => handleApprove(pausedStep.id)} 
                  disabled={isApproving}
                  style={{ background: 'var(--warning)', boxShadow: '0 4px 12px var(--warning-glow)' }}
                >
                  {isApproving ? 'Approving...' : '✓ Approve & Resume'}
                </button>
              )}
            </div>
          </div>
        )}

        <div className="panel">
          <h3 className="panel-title" style={{ marginBottom: '1.5rem' }}>Step-by-Step Monitor</h3>
          
          {stepRuns.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Initializing execution pipeline...
            </div>
          ) : (
            <div className="step-run-list">
              {stepRuns.map((sr: any) => {
                const stepType = sr.step.type;
                return (
                  <div key={sr.id} className={`step-run-row ${sr.status}`}>
                    <div className="step-run-status-ring">
                      {sr.status === 'completed' && '✓'}
                      {sr.status === 'failed' && '✕'}
                      {sr.status === 'paused' && '⏸'}
                      {sr.status === 'running' && ''}
                      {sr.status === 'pending' && '○'}
                    </div>
                    
                    <div className="step-run-details">
                      <span className="step-run-name">{sr.step.name}</span>
                      <span className="step-run-type">
                        TYPE: {stepType.toUpperCase()} | Attempt: {sr.attempt_count}
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <span className={`status-badge ${sr.status}`} style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}>
                        {sr.status}
                      </span>
                    </div>

                    {/* Console logs */}
                    {sr.status !== 'pending' && (
                      <div className={`step-run-console ${sr.status === 'failed' ? 'error' : ''}`}>
                        {sr.status === 'running' && '> Executing API handler...'}
                        {sr.status === 'paused' && '> Awaiting user approval...'}
                        {sr.status === 'completed' && (
                          <>
                            {`> Step Execution Succeeded.\n`}
                            {sr.input && `[Input]: ${JSON.stringify(sr.input, null, 2)}\n`}
                            {sr.output && `[Output]: ${JSON.stringify(sr.output, null, 2)}\n`}
                            {sr.approved_by && `[Approved By]: ${sr.approved_by} at ${sr.approved_at}\n`}
                          </>
                        )}
                        {sr.status === 'failed' && (
                          <>
                            {`> Step Execution Failed.\n`}
                            {sr.input && `[Input]: ${JSON.stringify(sr.input, null, 2)}\n`}
                            {sr.error && `[Error]: ${sr.error}\n`}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {toast.text && (
        <div className={`toast ${toast.type}`}>
          <span>{toast.type === 'success' ? '✓' : '⚠️'}</span>
          <span>{toast.text}</span>
        </div>
      )}
    </div>
  );
}

export default function Run() {
  const [runId, setRunId] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);
  const [org, setOrg] = useState<any>(null);
  const [role, setRole] = useState<string>('viewer');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const pathParts = window.location.pathname.split('/');
      const id = pathParts[pathParts.length - 1];
      setRunId(id);

      const storedToken = localStorage.getItem('token');
      const storedUser = localStorage.getItem('user');
      const storedOrg = localStorage.getItem('org');
      const storedRole = localStorage.getItem('role');

      if (storedToken && storedUser && storedOrg && storedRole) {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));
        setOrg(JSON.parse(storedOrg));
        setRole(storedRole);
      } else {
        window.location.href = '/?redirect=' + encodeURIComponent(window.location.pathname + window.location.search);
      }
    }
  }, []);

  const apolloClient = useMemo(() => {
    if (!token) return null;
    return createApolloClient();
  }, [token]);

  if (!runId || !token || !apolloClient || !user || !org) {
    return <div style={{ padding: '2rem', textAlign: 'center' }}>Connecting to execution node...</div>;
  }

  return (
    <ApolloProvider client={apolloClient}>
      <RunContent runId={runId} user={user} role={role} />
    </ApolloProvider>
  );
}

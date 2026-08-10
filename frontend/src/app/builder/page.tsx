'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { ApolloProvider, useQuery, useMutation } from '@apollo/client/react';
import { gql } from '@apollo/client/core';
import { createApolloClient } from '../../lib/apolloClient';

const GET_WORKFLOW = gql`
  query GetWorkflow($id: uuid!) {
    workflows_by_pk(id: $id) {
      id
      name
      description
      org_id
      steps(order_by: {position: asc}) {
        id
        name
        type
        config
        position
      }
      triggers {
        id
        type
        config
      }
      runs(order_by: {created_at: desc}, limit: 8) {
        id
        status
        trigger_type
        created_at
        completed_at
      }
    }
  }
`;

const UPDATE_WORKFLOW_INFO = gql`
  mutation UpdateWorkflowInfo($id: uuid!, $name: String!, $description: String) {
    update_workflows_by_pk(pk_columns: {id: $id}, _set: {name: $name, description: $description}) {
      id
      name
    }
  }
`;

const SAVE_STEPS = gql`
  mutation SaveSteps($workflowId: uuid!, $steps: [workflow_steps_insert_input!]!) {
    delete_workflow_steps(where: {workflow_id: {_eq: $workflowId}}) {
      affected_rows
    }
    insert_workflow_steps(objects: $steps) {
      affected_rows
    }
  }
`;

const SAVE_TRIGGERS = gql`
  mutation SaveTriggers($workflowId: uuid!, $triggers: [workflow_triggers_insert_input!]!) {
    delete_workflow_triggers(where: {workflow_id: {_eq: $workflowId}}) {
      affected_rows
    }
    insert_workflow_triggers(objects: $triggers) {
      affected_rows
    }
  }
`;

const TRIGGER_RUN = gql`
  mutation TriggerRun($workflowId: uuid!) {
    triggerWorkflowRun(workflow_id: $workflowId) {
      id
    }
  }
`;

function BuilderContent({ workflowId, org, user, role }: any) {
  const { data, loading, error, refetch } = useQuery(GET_WORKFLOW, {
    variables: { id: workflowId },
  });

  const [updateWorkflowInfo] = useMutation(UPDATE_WORKFLOW_INFO);
  const [saveSteps] = useMutation(SAVE_STEPS);
  const [saveTriggers] = useMutation(SAVE_TRIGGERS);
  const [triggerRun] = useMutation(TRIGGER_RUN);

  // Form states
  const [wfName, setWfName] = useState('');
  const [wfDesc, setWfDesc] = useState('');
  const [steps, setSteps] = useState<any[]>([]);
  const [triggers, setTriggers] = useState<any[]>([]);
  
  // Active selected node for editing
  const [selectedNodeIndex, setSelectedNodeIndex] = useState<number | null>(null);
  
  // Status feedback
  const [statusMsg, setStatusMsg] = useState({ type: '', text: '' });
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    if ((data as any)?.workflows_by_pk) {
      const wf = (data as any).workflows_by_pk;
      setWfName(wf.name);
      setWfDesc(wf.description || '');
      setSteps(wf.steps || []);
      setTriggers(wf.triggers || []);
    }
  }, [data]);

  const showToast = (type: string, text: string) => {
    setStatusMsg({ type, text });
    setTimeout(() => setStatusMsg({ type: '', text: '' }), 5000);
  };

  const handleSaveInfo = async () => {
    try {
      await updateWorkflowInfo({ variables: { id: workflowId, name: wfName, description: wfDesc } });
      showToast('success', 'Workflow basic info saved.');
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  const handleAddStep = (type: string) => {
    let config: any = {};
    if (type === 'llm_call') config = { prompt: 'Translate this to French:\n{{steps.input_node.output.text}}' };
    if (type === 'http_request') config = { url: 'https://httpbin.org/post', method: 'POST', headers: { 'Content-Type': 'application/json' }, data: { text: '{{steps.llm_call_node.output.text}}' } };
    if (type === 'db_write') config = { key: 'sentiment_result', value: { text: '{{steps.llm_call_node.output.text}}', sentiment: '{{steps.llm_call_node.output.sentiment}}' } };
    if (type === 'notify') config = { message: 'Alert: LLM generated negative status: {{steps.llm_call_node.output.text}}' };
    if (type === 'conditional_branch') config = { condition: 'output.sentiment === "positive"', true_step_id: '', false_step_id: '' };
    if (type === 'approval_gate') config = {};

    const newStep = {
      workflow_id: workflowId,
      name: `${type}_${steps.length + 1}`,
      type,
      config,
      position: steps.length,
    };

    setSteps([...steps, newStep]);
    setSelectedNodeIndex(steps.length);
  };

  const handleRemoveStep = (index: number) => {
    const updated = steps.filter((_, i) => i !== index).map((s, i) => ({ ...s, position: i }));
    setSteps(updated);
    setSelectedNodeIndex(null);
  };

  const handleMoveStep = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === steps.length - 1) return;

    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    const updated = [...steps];
    
    // Swap
    const temp = updated[index];
    updated[index] = updated[targetIndex];
    updated[targetIndex] = temp;

    // Recalculate position indexes
    const final = updated.map((s, i) => ({ ...s, position: i }));
    setSteps(final);
    setSelectedNodeIndex(targetIndex);
  };

  const handleStepConfigChange = (field: string, val: any) => {
    if (selectedNodeIndex === null) return;
    const updated = [...steps];
    updated[selectedNodeIndex] = {
      ...updated[selectedNodeIndex],
      config: { ...updated[selectedNodeIndex].config, [field]: val }
    };
    setSteps(updated);
  };

  const handleStepNameChange = (name: string) => {
    if (selectedNodeIndex === null) return;
    const updated = [...steps];
    updated[selectedNodeIndex] = { ...updated[selectedNodeIndex], name };
    setSteps(updated);
  };

  const handleSaveSteps = async () => {
    try {
      const cleanSteps = steps.map(({ name, type, config, position }) => ({
        workflow_id: workflowId,
        name,
        type,
        config,
        position,
      }));
      await saveSteps({ variables: { workflowId, steps: cleanSteps } });
      showToast('success', 'Workflow steps saved successfully.');
      refetch();
    } catch (err: any) {
      console.error(err);
      showToast('error', err.message || 'Failed to save steps (Layer 2 trigger might have blocked you).');
    }
  };

  const handleToggleTrigger = (type: string) => {
    const existing = triggers.find(t => t.type === type);
    if (existing) {
      setTriggers(triggers.filter(t => t.type !== type));
    } else {
      setTriggers([...triggers, { workflow_id: workflowId, type, config: type === 'scheduled' ? { cron: '*/5 * * * *' } : {} }]);
    }
  };

  const handleTriggerConfigChange = (type: string, field: string, val: any) => {
    const updated = triggers.map(t => {
      if (t.type === type) {
        return { ...t, config: { ...t.config, [field]: val } };
      }
      return t;
    });
    setTriggers(updated);
  };

  const handleSaveTriggers = async () => {
    try {
      const cleanTriggers = triggers.map(({ type, config }) => ({
        workflow_id: workflowId,
        type,
        config,
      }));
      await saveTriggers({ variables: { workflowId, triggers: cleanTriggers } });
      showToast('success', 'Workflow triggers saved successfully.');
      refetch();
    } catch (err: any) {
      console.error(err);
      showToast('error', err.message || 'Failed to save triggers.');
    }
  };

  const handleRunWorkflow = async () => {
    setIsRunning(true);
    try {
      const res = await triggerRun({ variables: { workflowId } });
      showToast('success', 'Workflow run started.');
      // Redirect to live run page
      const runId = (res.data as any)?.triggerWorkflowRun?.id;
      if (runId) {
        window.location.href = `/run/${runId}`;
      }
    } catch (err: any) {
      console.error(err);
      showToast('error', err.message || 'Failed to trigger run.');
      setIsRunning(false);
    }
  };

  if (loading) return <div style={{ padding: '2rem', textAlign: 'center' }}>Loading workflow details...</div>;
  if (error) return <div style={{ padding: '2rem', textAlign: 'center', color: 'red' }}>Error loading workflow: {error.message}</div>;

  const wf = (data as any)?.workflows_by_pk;
  if (!wf) return <div style={{ padding: '2rem', textAlign: 'center' }}>Workflow not found or access denied.</div>;

  const recentRuns = wf.runs || [];

  return (
    <div>
      <header className="header">
        <div className="logo-group">
          <a href="/" className="logo-icon">W</a>
          <a href="/" className="logo-text">FlowAgent / Builder</a>
        </div>
        <div className="nav-right">
          <a href="/" className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}>← Back to Dashboard</a>
          <div className="user-badge">
            <span>{user.email}</span>
            <span className="user-role-tag">{role}</span>
          </div>
        </div>
      </header>

      <div className="builder-layout">
        <div className="canvas-area">
          <div className="panel" style={{ width: '100%', maxWidth: '800px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '1rem', flex: 1 }}>
              <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
                <input
                  type="text"
                  className="input"
                  value={wfName}
                  onChange={(e) => setWfName(e.target.value)}
                  style={{ fontSize: '1.25rem', fontWeight: 'bold' }}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0, flex: 2 }}>
                <input
                  type="text"
                  className="input"
                  value={wfDesc}
                  onChange={(e) => setWfDesc(e.target.value)}
                  placeholder="No description"
                />
              </div>
              {role !== 'viewer' && (
                <button className="btn btn-secondary" onClick={handleSaveInfo}>Save Details</button>
              )}
            </div>
            
            {role !== 'viewer' && (
              <button 
                className="btn btn-primary" 
                onClick={handleRunWorkflow} 
                disabled={isRunning}
                style={{ marginLeft: '1rem' }}
              >
                {isRunning ? 'Launching...' : '⚡ Run Workflow'}
              </button>
            )}
          </div>

          <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1px' }}>
            Workflow Chain Sequence
          </div>

          {steps.length === 0 ? (
            <div className="panel" style={{ width: '420px', textAlign: 'center', padding: '2rem', borderStyle: 'dashed' }}>
              No steps in this workflow. Click a node in the right sidebar to append your first step!
            </div>
          ) : (
            steps.map((step, idx) => (
              <React.Fragment key={step.id || idx}>
                <div 
                  className={`step-node ${selectedNodeIndex === idx ? 'active-config' : ''}`}
                  onClick={() => setSelectedNodeIndex(idx)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="step-node-header">
                    <div className="step-node-title-group">
                      <div className={`step-node-icon ${step.type}`}>
                        {step.type[0].toUpperCase()}
                      </div>
                      <div>
                        <div className="step-node-name">{step.name}</div>
                        <div className="step-node-type-label">{step.type.replace('_', ' ')}</div>
                      </div>
                    </div>
                    {role !== 'viewer' && (
                      <div className="step-node-actions" onClick={(e) => e.stopPropagation()}>
                        <button className="action-icon-btn" onClick={() => handleMoveStep(idx, 'up')} title="Move Up">▲</button>
                        <button className="action-icon-btn" onClick={() => handleMoveStep(idx, 'down')} title="Move Down">▼</button>
                        <button className="action-icon-btn" onClick={() => handleRemoveStep(idx)} style={{ color: 'var(--danger)' }} title="Delete">✕</button>
                      </div>
                    )}
                  </div>
                  <div className="step-node-desc">
                    {step.type === 'llm_call' && `Prompt: ${step.config.prompt?.substring(0, 45)}...`}
                    {step.type === 'http_request' && `${step.config.method || 'GET'}: ${step.config.url?.substring(0, 45)}`}
                    {step.type === 'db_write' && `Save key: "${step.config.key}"`}
                    {step.type === 'notify' && `Alert: "${step.config.message?.substring(0, 45)}..."`}
                    {step.type === 'conditional_branch' && `If: ${step.config.condition}`}
                    {step.type === 'approval_gate' && `Pauses until Owner/Editor approvals`}
                  </div>

                  {/* Render special warning badge if user is not Owner for restricted nodes */}
                  {role !== 'owner' && ['db_write', 'notify'].includes(step.type) && (
                    <div style={{ color: 'var(--warning)', fontSize: '0.7rem', fontWeight: 'bold', marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                      🔒 Restricted: Only organization Owners can add/modify this node type. Save will fail.
                    </div>
                  )}
                </div>
                {idx < steps.length - 1 && <div className="node-connector-line"></div>}
              </React.Fragment>
            ))
          )}
        </div>

        <aside className="config-sidebar">
          {selectedNodeIndex !== null && steps[selectedNodeIndex] ? (
            <div className="panel" style={{ background: 'transparent', border: 'none', padding: 0 }}>
              <h3 className="panel-title" style={{ justifyContent: 'space-between' }}>
                <span>Configure Node</span>
                <span style={{ fontSize: '0.7rem', color: 'var(--primary)' }}>Index {selectedNodeIndex}</span>
              </h3>
              
              <div className="form-group">
                <label className="label">Node ID Name</label>
                <input
                  type="text"
                  className="input"
                  value={steps[selectedNodeIndex].name}
                  onChange={(e) => handleStepNameChange(e.target.value)}
                  disabled={role === 'viewer'}
                />
              </div>

              {steps[selectedNodeIndex].type === 'llm_call' && (
                <div className="form-group">
                  <label className="label">LLM Prompt Template</label>
                  <textarea
                    className="input"
                    rows={6}
                    value={steps[selectedNodeIndex].config.prompt || ''}
                    onChange={(e) => handleStepConfigChange('prompt', e.target.value)}
                    disabled={role === 'viewer'}
                    placeholder="Enter LLM instructions..."
                    style={{ resize: 'vertical' }}
                  />
                  <small style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                    Supports variable interpolation: {"`{{steps.other_node_name.output.key}}`"}
                  </small>
                </div>
              )}

              {steps[selectedNodeIndex].type === 'http_request' && (
                <>
                  <div className="form-group">
                    <label className="label">HTTP URL</label>
                    <input
                      type="text"
                      className="input"
                      value={steps[selectedNodeIndex].config.url || ''}
                      onChange={(e) => handleStepConfigChange('url', e.target.value)}
                      disabled={role === 'viewer'}
                      placeholder="https://api.service.com/endpoint"
                    />
                  </div>
                  <div className="form-group">
                    <label className="label">Method</label>
                    <select
                      className="input select"
                      value={steps[selectedNodeIndex].config.method || 'GET'}
                      onChange={(e) => handleStepConfigChange('method', e.target.value)}
                      disabled={role === 'viewer'}
                    >
                      <option value="GET">GET</option>
                      <option value="POST">POST</option>
                      <option value="PUT">PUT</option>
                      <option value="DELETE">DELETE</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="label">Headers (JSON)</label>
                    <textarea
                      className="input"
                      rows={3}
                      value={typeof steps[selectedNodeIndex].config.headers === 'object' ? JSON.stringify(steps[selectedNodeIndex].config.headers, null, 2) : '{}'}
                      onChange={(e) => {
                        try {
                          handleStepConfigChange('headers', JSON.parse(e.target.value));
                        } catch (err) {}
                      }}
                      disabled={role === 'viewer'}
                      style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
                    />
                  </div>
                  <div className="form-group">
                    <label className="label">Body Data (JSON/JSON Template)</label>
                    <textarea
                      className="input"
                      rows={4}
                      value={typeof steps[selectedNodeIndex].config.data === 'object' ? JSON.stringify(steps[selectedNodeIndex].config.data, null, 2) : '{}'}
                      onChange={(e) => {
                        try {
                          handleStepConfigChange('data', JSON.parse(e.target.value));
                        } catch (err) {}
                      }}
                      disabled={role === 'viewer'}
                      style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
                    />
                  </div>
                </>
              )}

              {steps[selectedNodeIndex].type === 'db_write' && (
                <>
                  <div className="form-group">
                    <label className="label">Store Key</label>
                    <input
                      type="text"
                      className="input"
                      value={steps[selectedNodeIndex].config.key || ''}
                      onChange={(e) => handleStepConfigChange('key', e.target.value)}
                      disabled={role === 'viewer'}
                      placeholder="database_key_identifier"
                    />
                  </div>
                  <div className="form-group">
                    <label className="label">Value Object (JSON)</label>
                    <textarea
                      className="input"
                      rows={5}
                      value={typeof steps[selectedNodeIndex].config.value === 'object' ? JSON.stringify(steps[selectedNodeIndex].config.value, null, 2) : '{}'}
                      onChange={(e) => {
                        try {
                          handleStepConfigChange('value', JSON.parse(e.target.value));
                        } catch (err) {}
                      }}
                      disabled={role === 'viewer'}
                      style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
                    />
                  </div>
                </>
              )}

              {steps[selectedNodeIndex].type === 'notify' && (
                <div className="form-group">
                  <label className="label">Slack/Email Message Template</label>
                  <textarea
                    className="input"
                    rows={4}
                    value={steps[selectedNodeIndex].config.message || ''}
                    onChange={(e) => handleStepConfigChange('message', e.target.value)}
                    disabled={role === 'viewer'}
                    placeholder="Enter alert text..."
                  />
                </div>
              )}

              {steps[selectedNodeIndex].type === 'conditional_branch' && (
                <>
                  <div className="form-group">
                    <label className="label">Condition JS Expression</label>
                    <input
                      type="text"
                      className="input"
                      value={steps[selectedNodeIndex].config.condition || ''}
                      onChange={(e) => handleStepConfigChange('condition', e.target.value)}
                      disabled={role === 'viewer'}
                      placeholder="output.sentiment === 'positive'"
                    />
                    <small style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                      Context is the `output` object of the previous step.
                    </small>
                  </div>
                  <div className="form-group">
                    <label className="label">If Condition True, Jump To Step:</label>
                    <select
                      className="input select"
                      value={steps[selectedNodeIndex].config.true_step_id || ''}
                      onChange={(e) => handleStepConfigChange('true_step_id', e.target.value)}
                      disabled={role === 'viewer'}
                    >
                      <option value="">Next Sequential Step</option>
                      {steps.map((s, i) => i !== selectedNodeIndex && <option key={s.id || i} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="label">If Condition False, Jump To Step:</label>
                    <select
                      className="input select"
                      value={steps[selectedNodeIndex].config.false_step_id || ''}
                      onChange={(e) => handleStepConfigChange('false_step_id', e.target.value)}
                      disabled={role === 'viewer'}
                    >
                      <option value="">Next Sequential Step</option>
                      {steps.map((s, i) => i !== selectedNodeIndex && <option key={s.id || i} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                </>
              )}

              {steps[selectedNodeIndex].type === 'approval_gate' && (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: '1.4' }}>
                  No configuration required. When execution reaches this gate, it pauses. Owners or Editors must manually approve it to resume.
                </div>
              )}

              <button className="btn btn-secondary" onClick={() => setSelectedNodeIndex(null)} style={{ width: '100%', marginTop: '1rem' }}>Done Configuring</button>
            </div>
          ) : (
            <>
              {role !== 'viewer' && (
                <div className="panel">
                  <h3 className="panel-title">Add Step Nodes</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                    <button className="btn btn-secondary" onClick={() => handleAddStep('llm_call')} style={{ fontSize: '0.75rem' }}>🤖 LLM Call</button>
                    <button className="btn btn-secondary" onClick={() => handleAddStep('http_request')} style={{ fontSize: '0.75rem' }}>🌐 HTTP Request</button>
                    
                    {/* Add visual owner-only lock badge for restricted step types */}
                    <button 
                      className="btn btn-secondary" 
                      onClick={() => handleAddStep('db_write')} 
                      style={{ fontSize: '0.75rem', position: 'relative' }}
                    >
                      💾 DB Write {role !== 'owner' && '🔒'}
                    </button>
                    <button 
                      className="btn btn-secondary" 
                      onClick={() => handleAddStep('notify')} 
                      style={{ fontSize: '0.75rem', position: 'relative' }}
                    >
                      🔔 Notify {role !== 'owner' && '🔒'}
                    </button>
                    
                    <button className="btn btn-secondary" onClick={() => handleAddStep('conditional_branch')} style={{ fontSize: '0.75rem' }}>🌿 Branch</button>
                    <button className="btn btn-secondary" onClick={() => handleAddStep('approval_gate')} style={{ fontSize: '0.75rem' }}>🛑 Approval Gate</button>
                  </div>
                  <button className="btn btn-primary" onClick={handleSaveSteps} style={{ width: '100%', marginTop: '1.25rem' }}>
                    💾 Save Sequence Change
                  </button>
                </div>
              )}

              <div className="panel">
                <h3 className="panel-title">Triggers</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.85rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <input type="checkbox" checked={true} disabled />
                    <span>⚡ Manual Run</span>
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <input 
                      type="checkbox" 
                      checked={!!triggers.find(t => t.type === 'webhook')} 
                      onChange={() => handleToggleTrigger('webhook')}
                      disabled={role === 'viewer'}
                    />
                    <span>🌐 Webhook Inbound {role !== 'owner' && '🔒'}</span>
                  </label>
                  {triggers.find(t => t.type === 'webhook') && (
                    <div style={{ background: 'var(--input-bg)', padding: '0.5rem', borderRadius: '4px', fontSize: '0.7rem', wordBreak: 'break-all', fontFamily: 'monospace' }}>
                      Endpoint: http://localhost:5001/api/webhooks/trigger/{workflowId}
                    </div>
                  )}

                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <input 
                      type="checkbox" 
                      checked={!!triggers.find(t => t.type === 'scheduled')} 
                      onChange={() => handleToggleTrigger('scheduled')}
                      disabled={role === 'viewer'}
                    />
                    <span>⏰ Scheduled Cron</span>
                  </label>
                  {triggers.find(t => t.type === 'scheduled') && (
                    <div className="form-group" style={{ marginBottom: 0, marginTop: '0.25rem' }}>
                      <input 
                        type="text" 
                        className="input" 
                        value={triggers.find(t => t.type === 'scheduled').config.cron || '*/5 * * * *'}
                        onChange={(e) => handleTriggerConfigChange('scheduled', 'cron', e.target.value)}
                        disabled={role === 'viewer'}
                        placeholder="*/5 * * * *"
                        style={{ padding: '0.35rem 0.5rem', fontSize: '0.75rem' }}
                      />
                    </div>
                  )}

                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <input 
                      type="checkbox" 
                      checked={!!triggers.find(t => t.type === 'db_event')} 
                      onChange={() => handleToggleTrigger('db_event')}
                      disabled={role === 'viewer'}
                    />
                    <span>🗄️ Database Row Event</span>
                  </label>
                  {triggers.find(t => t.type === 'db_event') && (
                    <div style={{ background: 'var(--input-bg)', padding: '0.5rem', borderRadius: '4px', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      Fires when rows are inserted to `event_source_table`.
                    </div>
                  )}

                  {role !== 'viewer' && (
                    <button className="btn btn-primary" onClick={handleSaveTriggers} style={{ width: '100%', marginTop: '0.5rem' }}>
                      💾 Save Triggers
                    </button>
                  )}
                </div>
              </div>

              <div className="panel" style={{ flex: 1, minHeight: '220px' }}>
                <h3 className="panel-title">Recent Run History</h3>
                {recentRuns.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    No runs recorded yet.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '300px', overflowY: 'auto' }}>
                    {recentRuns.map((run: any) => (
                      <a 
                        href={`/run/${run.id}`} 
                        key={run.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '0.5rem 0.75rem',
                          background: 'rgba(255,255,255,0.02)',
                          border: '1px solid var(--panel-border)',
                          borderRadius: '6px',
                          fontSize: '0.8rem',
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 'bold' }}>{run.trigger_type.toUpperCase()}</div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                            {new Date(run.created_at).toLocaleTimeString()}
                          </div>
                        </div>
                        <span className={`status-badge ${run.status}`} style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}>
                          {run.status}
                        </span>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </aside>
      </div>

      {statusMsg.text && (
        <div className={`toast ${statusMsg.type}`}>
          <span>{statusMsg.type === 'success' ? '✓' : '⚠️'}</span>
          <span>{statusMsg.text}</span>
        </div>
      )}
    </div>
  );
}

export default function Builder() {
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);
  const [org, setOrg] = useState<any>(null);
  const [role, setRole] = useState<string>('viewer');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      setWorkflowId(urlParams.get('id'));

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
        // Redirect to login (silent auth) and come back
        window.location.href = '/?redirect=' + encodeURIComponent(window.location.pathname + window.location.search);
      }
    }
  }, []);

  const apolloClient = useMemo(() => {
    if (!token) return null;
    return createApolloClient();
  }, [token]);

  if (!workflowId || !token || !apolloClient || !user || !org) {
    return <div style={{ padding: '2rem', textAlign: 'center' }}>Initializing workspace...</div>;
  }

  return (
    <ApolloProvider client={apolloClient}>
      <BuilderContent workflowId={workflowId} org={org} user={user} role={role} />
    </ApolloProvider>
  );
}

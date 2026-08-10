-- Create Auth Schema and Users Table (simulating Nhost Auth)
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- 1. Organizations
CREATE TABLE IF NOT EXISTS organizations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  quota_limit integer NOT NULL DEFAULT 100,
  quota_usage integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- 2. Org Members
CREATE TABLE IF NOT EXISTS org_members (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id uuid REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  UNIQUE(org_id, user_id)
);

-- 3. Workflows
CREATE TABLE IF NOT EXISTS workflows (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id uuid REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  description text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- 4. Workflow Steps
CREATE TABLE IF NOT EXISTS workflow_steps (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workflow_id uuid REFERENCES workflows(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('llm_call', 'http_request', 'db_write', 'notify', 'conditional_branch', 'approval_gate')),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  position integer NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- 5. Workflow Triggers
CREATE TABLE IF NOT EXISTS workflow_triggers (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workflow_id uuid REFERENCES workflows(id) ON DELETE CASCADE NOT NULL,
  type text NOT NULL CHECK (type IN ('manual', 'webhook', 'scheduled', 'db_event')),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- 6. Workflow Runs
CREATE TABLE IF NOT EXISTS workflow_runs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workflow_id uuid REFERENCES workflows(id) ON DELETE CASCADE NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'paused', 'completed', 'failed')),
  trigger_type text NOT NULL,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  completed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- 7. Step Runs
CREATE TABLE IF NOT EXISTS step_runs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workflow_run_id uuid REFERENCES workflow_runs(id) ON DELETE CASCADE NOT NULL,
  step_id uuid REFERENCES workflow_steps(id) ON DELETE CASCADE NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'paused', 'completed', 'failed')),
  input jsonb DEFAULT '{}'::jsonb,
  output jsonb DEFAULT '{}'::jsonb,
  error text,
  attempt_count integer NOT NULL DEFAULT 1,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- 8. Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id uuid REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent')),
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- 9. Workflow Data Writes
CREATE TABLE IF NOT EXISTS workflow_data_writes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id uuid REFERENCES workflow_runs(id) ON DELETE CASCADE NOT NULL,
  step_id uuid REFERENCES workflow_steps(id) ON DELETE CASCADE NOT NULL,
  key text NOT NULL,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- 10. Event Source Table
CREATE TABLE IF NOT EXISTS event_source_table (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id uuid REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
  data text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Aggregation View: Org Usage Stats
CREATE OR REPLACE VIEW org_usage_stats AS
SELECT 
  o.id AS org_id,
  o.name AS org_name,
  COUNT(DISTINCT w.id) AS total_workflows,
  COUNT(DISTINCT wr.id) AS total_runs,
  COUNT(DISTINCT CASE WHEN wr.status = 'completed' THEN wr.id END) AS completed_runs,
  COUNT(DISTINCT CASE WHEN wr.status = 'failed' THEN wr.id END) AS failed_runs,
  COALESCE(AVG(EXTRACT(EPOCH FROM (wr.completed_at - wr.started_at))), 0) AS average_run_duration_seconds
FROM organizations o
LEFT JOIN workflows w ON w.org_id = o.id
LEFT JOIN workflow_runs wr ON wr.workflow_id = w.id
GROUP BY o.id, o.name;

-- Layer 2 Gating Trigger Functions
CREATE OR REPLACE FUNCTION check_step_permissions()
RETURNS TRIGGER AS $$
DECLARE
  hasura_user text;
  session_role text;
  caller_user_id text;
  workflow_org_id uuid;
  caller_org_role text;
BEGIN
  -- Get hasura session info
  hasura_user := current_setting('hasura.user', true);
  
  -- If running migrations, or by admin/system, allow
  IF hasura_user IS NULL OR hasura_user = '' THEN
    RETURN NEW;
  END IF;
  
  session_role := hasura_user::json->>'x-hasura-role';
  IF session_role = 'admin' OR session_role = 'system' THEN
    RETURN NEW;
  END IF;

  caller_user_id := hasura_user::json->>'x-hasura-user-id';
  IF caller_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Find the workflow's organization
  SELECT org_id INTO workflow_org_id FROM workflows WHERE id = NEW.workflow_id;
  IF workflow_org_id IS NULL THEN
    RAISE EXCEPTION 'Workflow not found';
  END IF;

  -- Find the caller's role in this organization
  SELECT role INTO caller_org_role FROM org_members 
  WHERE org_id = workflow_org_id AND user_id = caller_user_id::uuid;

  -- Layer 2 Gating: Only owner can create/update db_write or notify steps
  IF NEW.type IN ('db_write', 'notify') THEN
    IF caller_org_role IS NULL OR caller_org_role != 'owner' THEN
      RAISE EXCEPTION 'Layer 2 security violation: only organization owners can add or modify db_write or notify steps (your role: %)', COALESCE(caller_org_role, 'none');
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION check_trigger_permissions()
RETURNS TRIGGER AS $$
DECLARE
  hasura_user text;
  session_role text;
  caller_user_id text;
  workflow_org_id uuid;
  caller_org_role text;
BEGIN
  -- Get hasura session info
  hasura_user := current_setting('hasura.user', true);
  
  -- If running migrations, or by admin/system, allow
  IF hasura_user IS NULL OR hasura_user = '' THEN
    RETURN NEW;
  END IF;
  
  session_role := hasura_user::json->>'x-hasura-role';
  IF session_role = 'admin' OR session_role = 'system' THEN
    RETURN NEW;
  END IF;

  caller_user_id := hasura_user::json->>'x-hasura-user-id';
  IF caller_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Find the workflow's organization
  SELECT org_id INTO workflow_org_id FROM workflows WHERE id = NEW.workflow_id;
  IF workflow_org_id IS NULL THEN
    RAISE EXCEPTION 'Workflow not found';
  END IF;

  -- Find the caller's role in this organization
  SELECT role INTO caller_org_role FROM org_members 
  WHERE org_id = workflow_org_id AND user_id = caller_user_id::uuid;

  -- Layer 2 Gating: Only owner can create/update webhook triggers
  IF NEW.type = 'webhook' THEN
    IF caller_org_role IS NULL OR caller_org_role != 'owner' THEN
      RAISE EXCEPTION 'Layer 2 security violation: only organization owners can add or modify webhook triggers (your role: %)', COALESCE(caller_org_role, 'none');
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Bind triggers
CREATE TRIGGER tr_check_step_permissions
  BEFORE INSERT OR UPDATE ON workflow_steps
  FOR EACH ROW
  EXECUTE FUNCTION check_step_permissions();

CREATE TRIGGER tr_check_trigger_permissions
  BEFORE INSERT OR UPDATE ON workflow_triggers
  FOR EACH ROW
  EXECUTE FUNCTION check_trigger_permissions();

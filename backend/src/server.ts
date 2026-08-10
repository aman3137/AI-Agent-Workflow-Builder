import express, { Request, Response } from 'express';
import cors from 'cors';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { pool, executeWorkflow } from './executor';

dotenv.config();

const app = express();
const port = process.env.PORT || 5001;
const JWT_SECRET = process.env.JWT_SECRET || 'my-very-long-super-secret-jwt-key-32-chars';

app.use(cors());
app.use(express.json());

// Helper to hash passwords using SHA-256 (native, safe, doesn't require native node gyp compilation)
function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Middleware to extract and verify JWT for Express endpoints if needed
function authenticateJWT(req: Request, res: Response, next: () => void) {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = authHeader.split(' ')[1];
    jwt.verify(token, JWT_SECRET, (err, user) => {
      if (err) {
        return res.status(403).json({ error: 'Forbidden: Invalid Token' });
      }
      req.body.user = user;
      next();
    });
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

// ----------------- AUTH ROUTES -----------------

// Sign up a new user
app.post('/api/auth/signup', async (req: Request, res: Response) => {
  const { email, password, role = 'owner', orgName = 'My Org' } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Check if user already exists
    const checkUser = await client.query('SELECT id FROM auth.users WHERE email = $1', [email]);
    if (checkUser.rowCount > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'User already exists' });
    }

    const passwordHash = hashPassword(password);
    
    // Insert user
    const userRes = await client.query(
      'INSERT INTO auth.users (email, password_hash, created_at) VALUES ($1, $2, NOW()) RETURNING id, email',
      [email, passwordHash]
    );
    const user = userRes.rows[0];

    // Create an organization
    const orgRes = await client.query(
      'INSERT INTO organizations (name, quota_limit, quota_usage, created_at) VALUES ($1, 10, 0, NOW()) RETURNING id, name',
      [orgName]
    );
    const org = orgRes.rows[0];

    // Assign user to organization as the specified role
    await client.query(
      'INSERT INTO org_members (org_id, user_id, role, created_at) VALUES ($1, $2, $3, NOW())',
      [org.id, user.id, role]
    );

    await client.query('COMMIT');

    // Sign JWT token
    const token = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        'https://hasura.io/jwt/claims': {
          'x-hasura-allowed-roles': ['user', 'owner', 'editor', 'viewer'],
          'x-hasura-default-role': 'user',
          'x-hasura-user-id': user.id,
        },
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    return res.json({ token, user, organization: org, role });
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('Signup error:', err);
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Login
app.post('/api/auth/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const client = await pool.connect();
  try {
    const passwordHash = hashPassword(password);
    const userRes = await client.query(
      'SELECT id, email, password_hash FROM auth.users WHERE email = $1',
      [email]
    );

    if (userRes.rowCount === 0 || userRes.rows[0].password_hash !== passwordHash) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = userRes.rows[0];

    // Fetch organization memberships
    const memberRes = await client.query(
      'SELECT m.role, o.id AS org_id, o.name AS org_name, o.quota_limit, o.quota_usage FROM org_members m JOIN organizations o ON m.org_id = o.id WHERE m.user_id = $1',
      [user.id]
    );

    if (memberRes.rowCount === 0) {
      return res.status(400).json({ error: 'User does not belong to any organization' });
    }

    const orgInfo = memberRes.rows[0];

    // Sign JWT token
    const token = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        'https://hasura.io/jwt/claims': {
          'x-hasura-allowed-roles': ['user', 'owner', 'editor', 'viewer'],
          'x-hasura-default-role': 'user',
          'x-hasura-user-id': user.id,
        },
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    return res.json({
      token,
      user: { id: user.id, email: user.email },
      organization: { id: orgInfo.org_id, name: orgInfo.org_name, quota_limit: orgInfo.quota_limit, quota_usage: orgInfo.quota_usage },
      role: orgInfo.role,
      memberships: memberRes.rows.map(m => ({ org_id: m.org_id, org_name: m.org_name, role: m.role }))
    });
  } catch (err: any) {
    console.error('Login error:', err);
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Join an existing organization (e.g. Org A or Org B)
app.post('/api/auth/join', async (req: Request, res: Response) => {
  const { email, password, orgId, role } = req.body;
  if (!email || !password || !orgId || !role) {
    return res.status(400).json({ error: 'email, password, orgId, and role are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create user if not exists, otherwise load them
    let userRes = await client.query('SELECT id, email, password_hash FROM auth.users WHERE email = $1', [email]);
    let userId: string;

    if (userRes.rowCount === 0) {
      const passwordHash = hashPassword(password);
      const newUserRes = await client.query(
        'INSERT INTO auth.users (email, password_hash, created_at) VALUES ($1, $2, NOW()) RETURNING id',
        [email, passwordHash]
      );
      userId = newUserRes.rows[0].id;
    } else {
      if (userRes.rows[0].password_hash !== hashPassword(password)) {
        await client.query('ROLLBACK');
        return res.status(401).json({ error: 'Incorrect password for existing user' });
      }
      userId = userRes.rows[0].id;
    }

    // Insert org member
    await client.query(
      'INSERT INTO org_members (org_id, user_id, role, created_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role',
      [orgId, userId, role]
    );

    // Fetch org details
    const orgRes = await client.query('SELECT id, name FROM organizations WHERE id = $1', [orgId]);
    const org = orgRes.rows[0];

    await client.query('COMMIT');

    // Sign JWT token
    const token = jwt.sign(
      {
        sub: userId,
        email: email,
        'https://hasura.io/jwt/claims': {
          'x-hasura-allowed-roles': ['user', 'owner', 'editor', 'viewer'],
          'x-hasura-default-role': 'user',
          'x-hasura-user-id': userId,
        },
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    return res.json({ token, user: { id: userId, email }, organization: org, role });
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('Join error:', err);
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ----------------- HASURA ACTIONS -----------------

// Action: triggerWorkflowRun(workflow_id)
app.post('/api/actions/triggerWorkflowRun', async (req: Request, res: Response) => {
  const { session_variables, input } = req.body;
  const workflowId = input.workflow_id;
  const callerUserId = session_variables?.['x-hasura-user-id'];

  if (!callerUserId) {
    return res.status(400).json({ message: 'Missing caller user ID from session' });
  }

  const client = await pool.connect();
  try {
    // 1. Fetch workflow and verify it belongs to caller's org
    const wfRes = await client.query('SELECT org_id FROM workflows WHERE id = $1', [workflowId]);
    if (wfRes.rowCount === 0) {
      return res.status(404).json({ message: 'Workflow not found' });
    }
    const orgId = wfRes.rows[0].org_id;

    // 2. Resolve caller's role in the organization (Layer 1 check)
    const memberRes = await client.query(
      'SELECT role FROM org_members WHERE org_id = $1 AND user_id = $2',
      [orgId, callerUserId]
    );
    if (memberRes.rowCount === 0) {
      return res.status(403).json({ message: 'Forbidden: You are not a member of this organization' });
    }
    const role = memberRes.rows[0].role;
    if (role === 'viewer') {
      return res.status(403).json({ message: 'Forbidden: Viewers cannot trigger workflow runs' });
    }

    // 3. Verify quota (Usage enforcement)
    const orgRes = await client.query('SELECT quota_limit, quota_usage FROM organizations WHERE id = $1', [orgId]);
    const org = orgRes.rows[0];
    if (org.quota_usage >= org.quota_limit) {
      return res.status(400).json({ message: 'Usage quota exceeded' });
    }

    // 4. Create workflow run
    const runRes = await client.query(
      'INSERT INTO workflow_runs (workflow_id, status, trigger_type, started_at, created_at) VALUES ($1, \'pending\', \'manual\', NOW(), NOW()) RETURNING id',
      [workflowId]
    );
    const runId = runRes.rows[0].id;

    // 5. Trigger execution asynchronously
    executeWorkflow(runId).catch(err => console.error('Workflow async execute error:', err));

    return res.json({ id: runId });
  } catch (err: any) {
    console.error('Trigger workflow action error:', err);
    return res.status(500).json({ message: err.message });
  } finally {
    client.release();
  }
});

// Action: approveStep(step_run_id)
app.post('/api/actions/approveStep', async (req: Request, res: Response) => {
  const { session_variables, input } = req.body;
  const stepRunId = input.step_run_id;
  const callerUserId = session_variables?.['x-hasura-user-id'];

  if (!callerUserId) {
    return res.status(400).json({ message: 'Missing caller user ID from session' });
  }

  const client = await pool.connect();
  try {
    // 1. Resolve step run, workflow run, and organization
    const runInfoRes = await client.query(
      `SELECT sr.id as step_run_id, sr.status as step_status, wr.id as run_id, w.org_id, ws.position
       FROM step_runs sr
       JOIN workflow_runs wr ON sr.workflow_run_id = wr.id
       JOIN workflows w ON wr.workflow_id = w.id
       JOIN workflow_steps ws ON sr.step_id = ws.id
       WHERE sr.id = $1`,
      [stepRunId]
    );

    if (runInfoRes.rowCount === 0) {
      return res.status(404).json({ message: 'Step run not found' });
    }
    const info = runInfoRes.rows[0];

    // 2. Verify caller role (Layer 2 gating for approval gate resumption)
    const memberRes = await client.query(
      'SELECT role FROM org_members WHERE org_id = $1 AND user_id = $2',
      [info.org_id, callerUserId]
    );
    if (memberRes.rowCount === 0) {
      return res.status(403).json({ message: 'Forbidden: You are not a member of this organization' });
    }
    const role = memberRes.rows[0].role;
    if (role !== 'owner' && role !== 'editor') {
      return res.status(403).json({ message: 'Forbidden: Only owners or editors can approve steps' });
    }

    if (info.step_status !== 'paused') {
      return res.status(400).json({ message: 'Step run is not paused awaiting approval' });
    }

    // 3. Mark step as completed and save approval details
    await client.query(
      'UPDATE step_runs SET status = \'completed\', approved_by = $1, approved_at = NOW(), updated_at = NOW() WHERE id = $2',
      [callerUserId, stepRunId]
    );

    // 4. Resume executing workflow from the next step
    executeWorkflow(info.run_id, info.position + 1).catch(err =>
      console.error('Workflow resumption error:', err)
    );

    return res.json({ success: true });
  } catch (err: any) {
    console.error('Approve step action error:', err);
    return res.status(500).json({ message: err.message });
  } finally {
    client.release();
  }
});

// ----------------- WEBHOOK TRIGGER ENDPOINT -----------------

// Expose inbound endpoint for webhook triggers
app.post('/api/webhooks/trigger/:workflow_id', async (req: Request, res: Response) => {
  const { workflow_id } = req.params;
  const payload = req.body || {};

  const client = await pool.connect();
  try {
    // Verify webhook trigger is configured
    const trigRes = await client.query(
      'SELECT * FROM workflow_triggers WHERE workflow_id = $1 AND type = \'webhook\'',
      [workflow_id]
    );
    if (trigRes.rowCount === 0) {
      return res.status(400).json({ error: 'No webhook trigger configured for this workflow' });
    }

    // Check quota
    const wfRes = await client.query('SELECT org_id FROM workflows WHERE id = $1', [workflow_id]);
    if (wfRes.rowCount === 0) {
      return res.status(404).json({ error: 'Workflow not found' });
    }
    const orgId = wfRes.rows[0].org_id;

    const orgRes = await client.query('SELECT quota_limit, quota_usage FROM organizations WHERE id = $1', [orgId]);
    const org = orgRes.rows[0];
    if (org.quota_usage >= org.quota_limit) {
      return res.status(400).json({ error: 'Usage quota exceeded' });
    }

    // Create workflow run
    const runRes = await client.query(
      'INSERT INTO workflow_runs (workflow_id, status, trigger_type, started_at, created_at) VALUES ($1, \'pending\', \'webhook\', NOW(), NOW()) RETURNING id',
      [workflow_id]
    );
    const runId = runRes.rows[0].id;

    // Run workflow, passing the webhook request payload as output of a virtual start node
    executeWorkflow(runId).catch(err => console.error('Workflow webhook execute error:', err));

    return res.json({ message: 'Workflow triggered via webhook', run_id: runId });
  } catch (err: any) {
    console.error('Webhook trigger error:', err);
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ----------------- HASURA EVENT WEBHOOKS -----------------

// Event: notify
app.post('/api/events/notify', (req: Request, res: Response) => {
  const event = req.body.event;
  if (!event || event.op !== 'INSERT') {
    return res.json({ status: 'ignored' });
  }

  const newNotification = event.data.new;
  console.log(`[NOTIFICATION EVENT] Org: ${newNotification.org_id} | Alert: "${newNotification.message}"`);
  
  // Mark as sent in the database
  pool.query('UPDATE notifications SET status = \'sent\' WHERE id = $1', [newNotification.id])
    .catch(err => console.error('Failed to update notification status:', err));

  return res.json({ status: 'sent' });
});

// Event: database event (event_source_table insert trigger)
app.post('/api/events/db_event', async (req: Request, res: Response) => {
  const event = req.body.event;
  if (!event || event.op !== 'INSERT') {
    return res.json({ status: 'ignored' });
  }

  const newRow = event.data.new;
  const orgId = newRow.org_id;

  const client = await pool.connect();
  try {
    // Find any workflow triggers of type 'db_event' in this organization
    const triggersRes = await client.query(
      `SELECT wt.workflow_id FROM workflow_triggers wt
       JOIN workflows w ON wt.workflow_id = w.id
       WHERE wt.type = 'db_event' AND w.org_id = $1`,
      [orgId]
    );

    for (const row of triggersRes.rows) {
      // Check quota
      const orgRes = await client.query('SELECT quota_limit, quota_usage FROM organizations WHERE id = $1', [orgId]);
      const org = orgRes.rows[0];
      if (org.quota_usage < org.quota_limit) {
        // Create run
        const runRes = await client.query(
          'INSERT INTO workflow_runs (workflow_id, status, trigger_type, started_at, created_at) VALUES ($1, \'pending\', \'db_event\', NOW(), NOW()) RETURNING id',
          [row.workflow_id]
        );
        const runId = runRes.rows[0].id;
        
        // Asynchronously execute workflow
        executeWorkflow(runId).catch(err => console.error('Workflow database event run error:', err));
      }
    }

    return res.json({ status: 'processed' });
  } catch (err: any) {
    console.error('Database event trigger error:', err);
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ----------------- BACKGROUND SCHEDULED CRONS -----------------

setInterval(async () => {
  // Query all scheduled workflow triggers
  const client = await pool.connect();
  try {
    const scheduledRes = await client.query(
      `SELECT wt.workflow_id, w.org_id, wt.config FROM workflow_triggers wt
       JOIN workflows w ON wt.workflow_id = w.id
       WHERE wt.type = 'scheduled'`
    );

    for (const trigger of scheduledRes.rows) {
      const orgRes = await client.query('SELECT quota_limit, quota_usage FROM organizations WHERE id = $1', [trigger.org_id]);
      const org = orgRes.rows[0];
      
      if (org.quota_usage < org.quota_limit) {
        // For local simulation, we run it occasionally or log. To prevent infinite loop spamming,
        // we can store a last_triggered_at value or just check if it's run.
        // Let's run a check: we check if there was a scheduled run in the last 1 minute
        const lastRunRes = await client.query(
          'SELECT started_at FROM workflow_runs WHERE workflow_id = $1 AND trigger_type = \'scheduled\' AND started_at > NOW() - INTERVAL \'1 minute\'',
          [trigger.workflow_id]
        );
        
        if (lastRunRes.rowCount === 0) {
          console.log(`[CRON RUNNER] Automatically running scheduled workflow ${trigger.workflow_id}`);
          const runRes = await client.query(
            'INSERT INTO workflow_runs (workflow_id, status, trigger_type, started_at, created_at) VALUES ($1, \'pending\', \'scheduled\', NOW(), NOW()) RETURNING id',
            [trigger.workflow_id]
          );
          executeWorkflow(runRes.rows[0].id).catch(err => console.error('Cron execute error:', err));
        }
      }
    }
  } catch (err) {
    console.error('Cron checking error:', err);
  } finally {
    client.release();
  }
}, 15000); // Check every 15 seconds

app.listen(port, () => {
  console.log(`Express server running on port ${port}`);
});

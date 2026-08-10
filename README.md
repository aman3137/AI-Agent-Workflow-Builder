# AI Agent Workflow Builder (Mini n8n for AI Steps)

A full-stack workflow automation builder tailored for chaining AI agent steps. Built using **PostgreSQL, Hasura GraphQL Engine, Express (backend Actions/Events handler), and Next.js (frontend)**.

---

## Technical Stack & Architecture

- **Database**: PostgreSQL (port `5432`)
- **API Engine**: Hasura GraphQL Engine (port `8080`, with admin secret `myadminsecret`)
- **Backend Service**: Express Server (port `5001`, handling JWT Auth, Hasura Actions, Event Webhooks, and Scheduled Crons)
- **Frontend Dashboard**: Next.js App Router (port `3000`, using Vanilla CSS modules and Apollo GraphQL Subscriptions)

```
                            ┌─────────────────────────┐
                            │    Next.js Frontend     │
                            │      (Port 3000)        │
                            └────┬───────────────▲────┘
                                 │               │
                              Queries &     GraphQL Live
                              Mutations     Subscriptions
                                 │               │
                            ┌────▼───────────────┴────┐
                            │  Hasura GraphQL Engine  │
                            │      (Port 8080)        │
                            └────┬───────────────▲────┘
                                 │               │
                              Database        Hasura
                              Queries        Actions /
                                 │            Events
                            ┌────▼──────┐   ┌────▼────┐
                            │PostgreSQL │   │ Express │
                            │(Port 5432)├───► Backend │
                            └───────────┘   │(Pt 5001)│
                                            └─────────┘
```

---

## Two-Layer Permission System

### Layer 1: Tenant & Role Isolation (Hasura Permissions)
Enforced at the GraphQL layer via Hasura Row-Level Security:
- **Select Scoping**: Users can only query tables (`workflows`, `workflow_steps`, `workflow_runs`, `step_runs`, etc.) if their `user_id` matches a record in the `org_members` table for that workflow's `org_id`.
- **Insert/Update Scoping**: Restricted to users with the `'owner'` or `'editor'` roles in the organization.
- **Delete Scoping**: Restricted exclusively to organization `'owner'`s.

### Layer 2: Action & Step Gating (DB Triggers + Backend Verification)
Enforced at the database and execution layers:
1. **Restricted Step/Trigger Creation**: Only `'owner'`s can insert a `db_write` step, a `notify` step, or a `webhook` trigger. This is enforced via a PostgreSQL trigger (`BEFORE INSERT OR UPDATE`) on the `workflow_steps` and `workflow_triggers` tables. The trigger parses `x-hasura-user-id` from the session variables inside `hasura.user` settings, checks their role in `org_members`, and aborts the transaction on unauthorized operations.
2. **Approval Gate Resumption Gating**: Resuming an `approval_gate` is handled by the `approveStep` Hasura Action. The Express backend looks up the run's organization, resolves the caller's role, and rejects the request if they are not an `owner` or `editor`.

---

## Local Setup & Quick Start

### Prerequisites
- Node.js (v18+)
- Docker Desktop (must be running)

### Step 1: Run Database and Hasura
From the root directory, spin up PostgreSQL and Hasura:
```bash
docker compose up -d
```

### Step 2: Install Backend Dependencies & Configure Env
1. Navigate to the `backend` folder and install packages:
   ```bash
   cd backend
   npm install
   ```
2. Set up environment variables in `backend/.env`:
   ```env
   PORT=5001
   POSTGRES_HOST=localhost
   POSTGRES_PORT=5432
   POSTGRES_USER=postgres
   POSTGRES_PASSWORD=postgrespassword
   POSTGRES_DB=postgres
   JWT_SECRET=my-very-long-super-secret-jwt-key-32-chars
   GEMINI_API_KEY=your_optional_gemini_key
   ```
   *Note: If `GEMINI_API_KEY` is omitted, the engine automatically falls back to a high-fidelity local simulation.*

### Step 3: Run Database Migrations & Hasura Setup
To track tables, setup relationships, configure permissions, and create Actions/Event triggers:
1. Apply the migration SQL:
   ```bash
   # On Windows (PowerShell):
   Get-Content "..\nhost\migrations\default\1691500000000_init\up.sql" -Raw | docker exec -i workflow-postgres psql -U postgres -d postgres
   Get-Content "..\nhost\seeds\default\seed.sql" -Raw | docker exec -i workflow-postgres psql -U postgres -d postgres
   ```
2. Run the metadata configuration script:
   ```bash
   npm run build
   npx ts-node src/setupHasura.ts
   ```

### Step 4: Start Backend Express Server
```bash
npm run dev
```

### Step 5: Start Frontend Next.js Server
1. Open a new terminal, navigate to the `frontend` folder, and install packages:
   ```bash
   cd frontend
   npm install
   ```
2. Run the dev server:
   ```bash
   npm run dev
   ```
3. Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Verification Test Scenarios
1. **Zero-Friction Access**: Open [http://localhost:3000](http://localhost:3000). The signup/login wall is bypassed, automatically signing you in as the Owner of Org A.
2. **Build Workflow**: Create a workflow named `E2E AI Workflow`. Append nodes: **LLM Call -> Branch -> Approval Gate -> DB Write**.
   - Config **LLM**: Set prompt template.
   - Config **Branch**: Set condition `output.sentiment === 'positive'`, and True Target to `approval_gate_3`.
   - Config **DB Write**: Set key `final_review` and any value object.
   - Click **Save Sequence Change** and **Save Triggers**.
3. **Run E2E Sequence**: Click **Run Workflow**. Watch the steps execute live. The run will pause at the **Approval Gate**.
4. **Audit Approvals**: Click **Approve & Resume**. The execution continues and successfully writes data to the database, completing the run.
5. **Testing Role Scoping (Header Selector)**:
   - Click the role selector dropdown in the header and switch to **VIEWER**.
   - Notice that the "Create New Workflow" panel disappears and canvas editing and manual execution buttons are hidden.
   - Switch back to **OWNER** or **EDITOR** to restore full capabilities.

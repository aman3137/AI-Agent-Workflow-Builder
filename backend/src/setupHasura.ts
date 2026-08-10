import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const HASURA_ENDPOINT = 'http://localhost:8080/v1/metadata';
const ADMIN_SECRET = 'myadminsecret';

// Helper to send metadata calls
async function runMetadata(queries: any[]) {
  try {
    const response = await axios.post(
      HASURA_ENDPOINT,
      {
        type: 'bulk',
        source: 'default',
        args: queries,
      },
      {
        headers: {
          'X-Hasura-Admin-Secret': ADMIN_SECRET,
          'Content-Type': 'application/json',
        },
      }
    );
    console.log('Metadata setup successful:', JSON.stringify(response.data));
  } catch (error: any) {
    console.error('Metadata setup error:', error.response?.data || error.message);
  }
}

async function setup() {
  const tables = [
    'organizations',
    'org_members',
    'workflows',
    'workflow_steps',
    'workflow_triggers',
    'workflow_runs',
    'step_runs',
    'notifications',
    'workflow_data_writes',
    'event_source_table',
  ];

  const queries: any[] = [];

  // 1. Track Tables
  for (const table of tables) {
    queries.push({
      type: 'pg_track_table',
      args: {
        source: 'default',
        table: { schema: 'public', name: table },
      },
    });
  }

  // Track the view
  queries.push({
    type: 'pg_track_table',
    args: {
      source: 'default',
      table: { schema: 'public', name: 'org_usage_stats' },
    },
  });

  // 2. Track Manual Relationships
  
  // org_members -> organization
  queries.push({
    type: 'pg_create_object_relationship',
    args: {
      source: 'default',
      table: 'org_members',
      name: 'organization',
      using: {
        foreign_key_constraint_on: 'org_id'
      }
    }
  });

  // organizations -> members
  queries.push({
    type: 'pg_create_array_relationship',
    args: {
      source: 'default',
      table: 'organizations',
      name: 'members',
      using: {
        foreign_key_constraint_on: {
          table: 'org_members',
          column: 'org_id'
        }
      }
    }
  });

  // workflows -> organization
  queries.push({
    type: 'pg_create_object_relationship',
    args: {
      source: 'default',
      table: 'workflows',
      name: 'organization',
      using: {
        foreign_key_constraint_on: 'org_id'
      }
    }
  });

  // workflows -> steps
  queries.push({
    type: 'pg_create_array_relationship',
    args: {
      source: 'default',
      table: 'workflows',
      name: 'steps',
      using: {
        foreign_key_constraint_on: {
          table: 'workflow_steps',
          column: 'workflow_id'
        }
      }
    }
  });

  // workflows -> triggers
  queries.push({
    type: 'pg_create_array_relationship',
    args: {
      source: 'default',
      table: 'workflows',
      name: 'triggers',
      using: {
        foreign_key_constraint_on: {
          table: 'workflow_triggers',
          column: 'workflow_id'
        }
      }
    }
  });

  // workflows -> runs
  queries.push({
    type: 'pg_create_array_relationship',
    args: {
      source: 'default',
      table: 'workflows',
      name: 'runs',
      using: {
        foreign_key_constraint_on: {
          table: 'workflow_runs',
          column: 'workflow_id'
        }
      }
    }
  });

  // workflow_steps -> workflow
  queries.push({
    type: 'pg_create_object_relationship',
    args: {
      source: 'default',
      table: 'workflow_steps',
      name: 'workflow',
      using: {
        foreign_key_constraint_on: 'workflow_id'
      }
    }
  });

  // workflow_triggers -> workflow
  queries.push({
    type: 'pg_create_object_relationship',
    args: {
      source: 'default',
      table: 'workflow_triggers',
      name: 'workflow',
      using: {
        foreign_key_constraint_on: 'workflow_id'
      }
    }
  });

  // workflow_runs -> workflow
  queries.push({
    type: 'pg_create_object_relationship',
    args: {
      source: 'default',
      table: 'workflow_runs',
      name: 'workflow',
      using: {
        foreign_key_constraint_on: 'workflow_id'
      }
    }
  });

  // workflow_runs -> step_runs
  queries.push({
    type: 'pg_create_array_relationship',
    args: {
      source: 'default',
      table: 'workflow_runs',
      name: 'step_runs',
      using: {
        foreign_key_constraint_on: {
          table: 'step_runs',
          column: 'workflow_run_id'
        }
      }
    }
  });

  // step_runs -> workflow_run
  queries.push({
    type: 'pg_create_object_relationship',
    args: {
      source: 'default',
      table: 'step_runs',
      name: 'workflow_run',
      using: {
        foreign_key_constraint_on: 'workflow_run_id'
      }
    }
  });

  // step_runs -> step
  queries.push({
    type: 'pg_create_object_relationship',
    args: {
      source: 'default',
      table: 'step_runs',
      name: 'step',
      using: {
        foreign_key_constraint_on: 'step_id'
      }
    }
  });

  // org_usage_stats -> organization
  queries.push({
    type: 'pg_create_object_relationship',
    args: {
      source: 'default',
      table: 'org_usage_stats',
      name: 'organization',
      using: {
        manual_configuration: {
          remote_table: 'organizations',
          column_mapping: {
            org_id: 'id'
          }
        }
      }
    }
  });

  // 3. Set up permissions (Layer 1 scoping for role 'user')
  const selectPermissions = [
    {
      table: 'organizations',
      filter: {
        members: { user_id: { _eq: 'X-Hasura-User-Id' } }
      }
    },
    {
      table: 'org_members',
      filter: {
        organization: { members: { user_id: { _eq: 'X-Hasura-User-Id' } } }
      }
    },
    {
      table: 'workflows',
      filter: {
        organization: { members: { user_id: { _eq: 'X-Hasura-User-Id' } } }
      }
    },
    {
      table: 'workflow_steps',
      filter: {
        workflow: { organization: { members: { user_id: { _eq: 'X-Hasura-User-Id' } } } }
      }
    },
    {
      table: 'workflow_triggers',
      filter: {
        workflow: { organization: { members: { user_id: { _eq: 'X-Hasura-User-Id' } } } }
      }
    },
    {
      table: 'workflow_runs',
      filter: {
        workflow: { organization: { members: { user_id: { _eq: 'X-Hasura-User-Id' } } } }
      }
    },
    {
      table: 'step_runs',
      filter: {
        workflow_run: { workflow: { organization: { members: { user_id: { _eq: 'X-Hasura-User-Id' } } } } }
      }
    },
    {
      table: 'org_usage_stats',
      filter: {
        organization: { members: { user_id: { _eq: 'X-Hasura-User-Id' } } }
      }
    }
  ];

  for (const perm of selectPermissions) {
    queries.push({
      type: 'pg_create_select_permission',
      args: {
        source: 'default',
        table: perm.table,
        role: 'user',
        permission: {
          columns: '*',
          filter: perm.filter,
        }
      }
    });
  }

  // Insert permissions (owner & editor)
  const insertPermissions = [
    {
      table: 'workflows',
      filter: {
        organization: {
          members: {
            _and: [
              { user_id: { _eq: 'X-Hasura-User-Id' } },
              { role: { _in: ['owner', 'editor'] } }
            ]
          }
        }
      }
    },
    {
      table: 'workflow_steps',
      filter: {
        workflow: {
          organization: {
            members: {
              _and: [
                { user_id: { _eq: 'X-Hasura-User-Id' } },
                { role: { _in: ['owner', 'editor'] } }
              ]
            }
          }
        }
      }
    },
    {
      table: 'workflow_triggers',
      filter: {
        workflow: {
          organization: {
            members: {
              _and: [
                { user_id: { _eq: 'X-Hasura-User-Id' } },
                { role: { _in: ['owner', 'editor'] } }
              ]
            }
          }
        }
      }
    }
  ];

  for (const perm of insertPermissions) {
    queries.push({
      type: 'pg_create_insert_permission',
      args: {
        source: 'default',
        table: perm.table,
        role: 'user',
        permission: {
          check: perm.filter,
          columns: '*'
        }
      }
    });
  }

  // Update permissions (owner & editor)
  for (const perm of insertPermissions) {
    queries.push({
      type: 'pg_create_update_permission',
      args: {
        source: 'default',
        table: perm.table,
        role: 'user',
        permission: {
          filter: perm.filter,
          columns: '*'
        }
      }
    });
  }

  // Delete permissions (owner only)
  const deleteOwnerPermissions = [
    {
      table: 'workflows',
      filter: {
        organization: {
          members: {
            _and: [
              { user_id: { _eq: 'X-Hasura-User-Id' } },
              { role: { _eq: 'owner' } }
            ]
          }
        }
      }
    },
    {
      table: 'workflow_steps',
      filter: {
        workflow: {
          organization: {
            members: {
              _and: [
                { user_id: { _eq: 'X-Hasura-User-Id' } },
                { role: { _eq: 'owner' } }
              ]
            }
          }
        }
      }
    },
    {
      table: 'workflow_triggers',
      filter: {
        workflow: {
          organization: {
            members: {
              _and: [
                { user_id: { _eq: 'X-Hasura-User-Id' } },
                { role: { _eq: 'owner' } }
              ]
            }
          }
        }
      }
    }
  ];

  for (const perm of deleteOwnerPermissions) {
    queries.push({
      type: 'pg_create_delete_permission',
      args: {
        source: 'default',
        table: perm.table,
        role: 'user',
        permission: {
          filter: perm.filter
        }
      }
    });
  }

  // Org members management (owner only can manage members)
  queries.push({
    type: 'pg_create_insert_permission',
    args: {
      source: 'default',
      table: 'org_members',
      role: 'user',
      permission: {
        check: {
          organization: {
            members: {
              _and: [
                { user_id: { _eq: 'X-Hasura-User-Id' } },
                { role: { _eq: 'owner' } }
              ]
            }
          }
        },
        columns: '*'
      }
    }
  });

  queries.push({
    type: 'pg_create_update_permission',
    args: {
      source: 'default',
      table: 'org_members',
      role: 'user',
      permission: {
        filter: {
          organization: {
            members: {
              _and: [
                { user_id: { _eq: 'X-Hasura-User-Id' } },
                { role: { _eq: 'owner' } }
              ]
            }
          }
        },
        columns: '*'
      }
    }
  });

  queries.push({
    type: 'pg_create_delete_permission',
    args: {
      source: 'default',
      table: 'org_members',
      role: 'user',
      permission: {
        filter: {
          organization: {
            members: {
              _and: [
                { user_id: { _eq: 'X-Hasura-User-Id' } },
                { role: { _eq: 'owner' } }
              ]
            }
          }
        }
      }
    }
  });

  // 4. Create Custom Types
  queries.push({
    type: 'set_custom_types',
    args: {
      input_objects: [],
      objects: [
        {
          name: 'TriggerRunOutput',
          fields: [
            { name: 'id', type: 'String!' }
          ]
        },
        {
          name: 'ApproveStepOutput',
          fields: [
            { name: 'success', type: 'Boolean!' }
          ]
        }
      ],
      scalars: [],
      enums: []
    }
  });

  // Create Actions
  queries.push({
    type: 'create_action',
    args: {
      name: 'triggerWorkflowRun',
      definition: {
        kind: 'synchronous',
        handler: 'http://host.docker.internal:5001/api/actions/triggerWorkflowRun',
        arguments: [
          { name: 'workflow_id', type: 'uuid!' }
        ],
        output_type: 'TriggerRunOutput',
        forward_client_headers: true
      }
    }
  });

  queries.push({
    type: 'create_action',
    args: {
      name: 'approveStep',
      definition: {
        kind: 'synchronous',
        handler: 'http://host.docker.internal:5001/api/actions/approveStep',
        arguments: [
          { name: 'step_run_id', type: 'uuid!' }
        ],
        output_type: 'ApproveStepOutput',
        forward_client_headers: true
      }
    }
  });

  // Set Action permissions
  queries.push({
    type: 'create_action_permission',
    args: {
      action: 'triggerWorkflowRun',
      role: 'user'
    }
  });

  queries.push({
    type: 'create_action_permission',
    args: {
      action: 'approveStep',
      role: 'user'
    }
  });

  // 5. Create Event Triggers

  // Trigger: notify event on notifications table
  queries.push({
    type: 'pg_create_event_trigger',
    args: {
      name: 'notify_trigger',
      source: 'default',
      table: 'notifications',
      webhook: 'http://host.docker.internal:5001/api/events/notify',
      insert: {
        columns: '*'
      }
    }
  });

  // Trigger: database event on event_source_table
  queries.push({
    type: 'pg_create_event_trigger',
    args: {
      name: 'db_event_trigger',
      source: 'default',
      table: 'event_source_table',
      webhook: 'http://host.docker.internal:5001/api/events/db_event',
      insert: {
        columns: '*'
      }
    }
  });

  console.log('Sending metadata query to Hasura...');
  await runMetadata(queries);
}

setup();

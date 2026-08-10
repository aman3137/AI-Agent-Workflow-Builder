INSERT INTO organizations (id, name, quota_limit, quota_usage) VALUES
('a0000000-0000-0000-0000-00000000000a', 'Org A', 10, 0),
('b0000000-0000-0000-0000-00000000000b', 'Org B', 10, 0)
ON CONFLICT (id) DO NOTHING;

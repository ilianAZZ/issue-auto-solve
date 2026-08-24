ALTER TABLE runs ADD COLUMN cost_usd REAL;
ALTER TABLE runs ADD COLUMN duration_ms INTEGER;
ALTER TABLE runs ADD COLUMN num_turns INTEGER;
ALTER TABLE runs ADD COLUMN input_tokens INTEGER;
ALTER TABLE runs ADD COLUMN output_tokens INTEGER;
ALTER TABLE runs ADD COLUMN cache_creation_input_tokens INTEGER;
ALTER TABLE runs ADD COLUMN cache_read_input_tokens INTEGER;

ALTER TABLE bootstrap_runs ADD COLUMN cost_usd REAL;
ALTER TABLE bootstrap_runs ADD COLUMN duration_ms INTEGER;
ALTER TABLE bootstrap_runs ADD COLUMN input_tokens INTEGER;
ALTER TABLE bootstrap_runs ADD COLUMN output_tokens INTEGER;
ALTER TABLE bootstrap_runs ADD COLUMN cache_creation_input_tokens INTEGER;
ALTER TABLE bootstrap_runs ADD COLUMN cache_read_input_tokens INTEGER;

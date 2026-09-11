-- Legacy metadata-only rows remain explicit: they cannot reconstruct old input.
ALTER TABLE context_snapshots ADD COLUMN payload jsonb;
CREATE FUNCTION prevent_context_snapshot_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Context snapshots are immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER context_snapshot_immutable BEFORE UPDATE ON context_snapshots
FOR EACH ROW EXECUTE FUNCTION prevent_context_snapshot_update();

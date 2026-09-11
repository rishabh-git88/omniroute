\set ON_ERROR_STOP on
-- Only for a fresh, disposable integration PostgreSQL instance.
CREATE ROLE omniroute_integration LOGIN PASSWORD 'integration-only'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
ALTER DATABASE omniroute_integration OWNER TO omniroute_integration;
COMMENT ON DATABASE omniroute_integration IS 'omniroute:disposable-integration:v1';
CREATE EXTENSION IF NOT EXISTS vector;

CREATE DATABASE omniroute_integration_upgrade OWNER omniroute_integration;
COMMENT ON DATABASE omniroute_integration_upgrade IS 'omniroute:disposable-integration:v1';
\connect omniroute_integration_upgrade
CREATE EXTENSION IF NOT EXISTS vector;

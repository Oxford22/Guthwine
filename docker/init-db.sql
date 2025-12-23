-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create schemas for multi-tenancy
CREATE SCHEMA IF NOT EXISTS guthwine;
CREATE SCHEMA IF NOT EXISTS audit;

-- Grant permissions
GRANT ALL ON SCHEMA guthwine TO guthwine;
GRANT ALL ON SCHEMA audit TO guthwine;

-- Set default search path
ALTER DATABASE guthwine SET search_path TO guthwine, public;

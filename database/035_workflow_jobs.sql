CREATE TABLE IF NOT EXISTS sw_link_history(id uuid PRIMARY KEY,type text NOT NULL,status text NOT NULL,message text NOT NULL,duration_ms integer,details jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS sw_job_documents(id text PRIMARY KEY,request_id text,revision integer NOT NULL DEFAULT 0,data jsonb NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS sw_job_mappings(id text PRIMARY KEY,user_id text NOT NULL,team text NOT NULL);
CREATE TABLE IF NOT EXISTS sw_job_events(id text PRIMARY KEY,hash text NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS sw_job_outbox(id text PRIMARY KEY,channel text NOT NULL,endpoint text NOT NULL,payload jsonb NOT NULL,state text NOT NULL DEFAULT 'PENDING',attempts integer NOT NULL DEFAULT 0,next_at timestamptz NOT NULL DEFAULT now(),lease_until timestamptz,error text,result jsonb NOT NULL DEFAULT '{}');
CREATE INDEX IF NOT EXISTS sw_job_outbox_pending ON sw_job_outbox(channel,state,next_at);

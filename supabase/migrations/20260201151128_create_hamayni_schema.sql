/*
  # HAMAYNI Engine Database Schema v3.1
  
  ## Overview
  Complete database schema for HAMAYNI platform - Infrastructure contract forge and execution system.
  
  ## New Tables
  
  ### 1. profiles
    - `id` (uuid, primary key, references auth.users)
    - `email` (text)
    - `full_name` (text)
    - `created_at` (timestamptz)
    - `updated_at` (timestamptz)
  
  ### 2. servers
    - `id` (uuid, primary key)
    - `user_id` (uuid, references profiles)
    - `name` (text) - Human-readable server name
    - `hostname` (text) - Server hostname
    - `ip` (text) - Server IP address
    - `status` (enum) - online | offline
    - `token` (uuid, unique) - Authentication token for runner
    - `last_heartbeat` (timestamptz) - Last heartbeat received
    - `created_at` (timestamptz)
    - `updated_at` (timestamptz)
  
  ### 3. template_canons
    - `id` (uuid, primary key)
    - `slug` (text, unique) - Template identifier (e.g., hamayni.nginx.standalone)
    - `version` (text) - Template version
    - `content` (jsonb) - Full template structure (HFC template)
    - `description` (text) - Human description
    - `level` (integer) - Complexity level 1-3
    - `os` (text[]) - Supported OS (ubuntu, debian, etc.)
    - `is_published` (boolean) - Published status
    - `status` (enum) - draft | candidate | community | certified | canon
    - `pricing_type` (enum) - free | paid
    - `price` (numeric) - Price if paid
    - `created_at` (timestamptz)
    - `updated_at` (timestamptz)
  
  ### 4. intentions
    - `id` (uuid, primary key)
    - `user_id` (uuid, references profiles)
    - `template_id` (uuid, references template_canons)
    - `inputs` (jsonb) - User inputs for template variables
    - `status` (enum) - DRAFT | FORGED
    - `created_at` (timestamptz)
    - `updated_at` (timestamptz)
  
  ### 5. contracts
    - `id` (uuid, primary key)
    - `user_id` (uuid, references profiles) - Contract owner
    - `intention_id` (uuid, references intentions)
    - `hfc_json` (jsonb) - Complete HFC contract
    - `compiled_script` (text) - Compiled Bash script
    - `integrity_hash` (text) - SHA-256 hash
    - `status` (enum) - PENDING | CLAIMED | SUCCESS | FAILED
    - `server_id` (uuid, references servers) - Assigned server
    - `claimed_at` (timestamptz) - When runner claimed the contract
    - `execution_logs` (jsonb) - Execution logs and metadata
    - `created_at` (timestamptz)
    - `updated_at` (timestamptz)
  
  ### 6. contract_executions
    - `id` (uuid, primary key)
    - `contract_id` (uuid, references contracts)
    - `server_id` (uuid, references servers)
    - `server_name` (text) - Server name at execution time
    - `status` (text) - CLAIMED | SUCCESS | FAILED
    - `started_at` (timestamptz) - Execution start time
    - `completed_at` (timestamptz) - Execution completion time
    - `duration_ms` (integer) - Execution duration in milliseconds
    - `execution_logs` (jsonb) - Detailed logs
    - `created_at` (timestamptz)
  
  ## Enums
  - server_status: online, offline
  - contract_status: PENDING, CLAIMED, SUCCESS, FAILED
  - intention_status: DRAFT, FORGED
  - template_status: draft, candidate, community, certified, canon
  - pricing_type: free, paid
  
  ## Security
  - RLS enabled on all tables
  - Users can only access their own data
  - Servers authenticate via token
  - Service role used for runner API
  
  ## Functions
  - check_server_health() - Marks servers offline if no heartbeat for 2 minutes
*/

-- ============================================
-- ENUMS
-- ============================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'server_status') THEN
    CREATE TYPE server_status AS ENUM ('online', 'offline');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'contract_status') THEN
    CREATE TYPE contract_status AS ENUM ('PENDING', 'CLAIMED', 'SUCCESS', 'FAILED');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'intention_status') THEN
    CREATE TYPE intention_status AS ENUM ('DRAFT', 'FORGED');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'template_status') THEN
    CREATE TYPE template_status AS ENUM ('draft', 'candidate', 'community', 'certified', 'canon');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pricing_type') THEN
    CREATE TYPE pricing_type AS ENUM ('free', 'paid');
  END IF;
END $$;

-- ============================================
-- TABLES
-- ============================================

-- Profiles (extends auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  full_name text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Servers (Runners)
CREATE TABLE IF NOT EXISTS servers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  hostname text NOT NULL DEFAULT '',
  ip text NOT NULL DEFAULT '0.0.0.0',
  status server_status DEFAULT 'offline',
  token uuid UNIQUE DEFAULT gen_random_uuid(),
  last_heartbeat timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE servers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own servers"
  ON servers FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own servers"
  ON servers FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own servers"
  ON servers FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own servers"
  ON servers FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Template Canons
CREATE TABLE IF NOT EXISTS template_canons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  version text NOT NULL DEFAULT '1.0.0',
  content jsonb NOT NULL,
  description text,
  level integer DEFAULT 1 CHECK (level >= 1 AND level <= 3),
  os text[] DEFAULT ARRAY['ubuntu', 'debian'],
  is_published boolean DEFAULT false,
  status template_status DEFAULT 'draft',
  pricing_type pricing_type DEFAULT 'free',
  price numeric DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE template_canons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view published templates"
  ON template_canons FOR SELECT
  TO authenticated
  USING (is_published = true);

-- Intentions (User requests)
CREATE TABLE IF NOT EXISTS intentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  template_id uuid REFERENCES template_canons(id) ON DELETE CASCADE,
  inputs jsonb DEFAULT '{}',
  status intention_status DEFAULT 'DRAFT',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE intentions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own intentions"
  ON intentions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own intentions"
  ON intentions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own intentions"
  ON intentions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own intentions"
  ON intentions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Contracts (Forged)
CREATE TABLE IF NOT EXISTS contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  intention_id uuid REFERENCES intentions(id) ON DELETE SET NULL,
  hfc_json jsonb NOT NULL,
  compiled_script text NOT NULL,
  integrity_hash text NOT NULL,
  status contract_status DEFAULT 'PENDING',
  server_id uuid REFERENCES servers(id) ON DELETE SET NULL,
  claimed_at timestamptz,
  execution_logs jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own contracts"
  ON contracts FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own contracts"
  ON contracts FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own contracts"
  ON contracts FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own contracts"
  ON contracts FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Contract Executions (History)
CREATE TABLE IF NOT EXISTS contract_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid REFERENCES contracts(id) ON DELETE CASCADE,
  server_id uuid REFERENCES servers(id) ON DELETE SET NULL,
  server_name text,
  status text DEFAULT 'CLAIMED',
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  duration_ms integer,
  execution_logs jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE contract_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view executions of own contracts"
  ON contract_executions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM contracts
      WHERE contracts.id = contract_executions.contract_id
      AND contracts.user_id = auth.uid()
    )
  );

-- ============================================
-- FUNCTIONS
-- ============================================

CREATE OR REPLACE FUNCTION check_server_health()
RETURNS void AS $$
BEGIN
  UPDATE servers
  SET status = 'offline', updated_at = now()
  WHERE status = 'online'
    AND (last_heartbeat IS NULL OR last_heartbeat < now() - interval '2 minutes');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- TRIGGERS
-- ============================================

-- Auto-create profile on user signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO profiles (id, email, created_at, updated_at)
  VALUES (NEW.id, NEW.email, now(), now())
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created'
  ) THEN
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION handle_new_user();
  END IF;
END $$;

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_servers_user_id ON servers(user_id);
CREATE INDEX IF NOT EXISTS idx_servers_token ON servers(token);
CREATE INDEX IF NOT EXISTS idx_servers_status ON servers(status);
CREATE INDEX IF NOT EXISTS idx_template_canons_slug ON template_canons(slug);
CREATE INDEX IF NOT EXISTS idx_template_canons_published ON template_canons(is_published);
CREATE INDEX IF NOT EXISTS idx_intentions_user_id ON intentions(user_id);
CREATE INDEX IF NOT EXISTS idx_intentions_template_id ON intentions(template_id);
CREATE INDEX IF NOT EXISTS idx_contracts_user_id ON contracts(user_id);
CREATE INDEX IF NOT EXISTS idx_contracts_server_id ON contracts(server_id);
CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status);
CREATE INDEX IF NOT EXISTS idx_contract_executions_contract_id ON contract_executions(contract_id);
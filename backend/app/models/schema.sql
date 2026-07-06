-- Renova MVP — схема PostgreSQL (reference для Alembic)

CREATE TYPE user_role AS ENUM ('customer', 'contractor');
CREATE TYPE stage_status AS ENUM ('planned', 'active', 'review', 'done');
CREATE TYPE line_type AS ENUM ('material', 'work');

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone VARCHAR(20) UNIQUE NOT NULL,
  role user_role NOT NULL,
  full_name VARCHAR(255),
  inn VARCHAR(12),
  npd_verified BOOLEAN DEFAULT FALSE,
  npd_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES users(id),
  contractor_id UUID REFERENCES users(id),
  name VARCHAR(255) NOT NULL,
  address TEXT,
  renovation_type VARCHAR(32) NOT NULL,
  budget_planned DECIMAL(14,2) DEFAULT 0,
  budget_spent DECIMAL(14,2) DEFAULT 0,
  progress_percent DECIMAL(5,2) DEFAULT 0,
  planned_end_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  length_m DECIMAL(8,2),
  width_m DECIMAL(8,2),
  height_m DECIMAL(8,2),
  openings_sq_m DECIMAL(8,2) DEFAULT 0
);

CREATE TABLE estimate_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  room_id UUID REFERENCES rooms(id),
  line_type line_type NOT NULL,
  name VARCHAR(255) NOT NULL,
  unit VARCHAR(16),
  quantity_planned DECIMAL(12,3),
  quantity_actual DECIMAL(12,3),
  unit_price DECIMAL(12,2),
  version INT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  sort_order INT,
  status stage_status DEFAULT 'planned',
  percent_complete DECIMAL(5,2) DEFAULT 0,
  planned_start DATE,
  planned_end DATE,
  payment_amount DECIMAL(14,2)
);

CREATE TABLE expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  stage_id UUID REFERENCES stages(id),
  amount DECIMAL(14,2),
  receipt_qr TEXT,
  fns_verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_projects_customer ON projects(customer_id);
CREATE INDEX idx_projects_contractor ON projects(contractor_id);

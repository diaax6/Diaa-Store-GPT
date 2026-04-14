-- Run this in Supabase SQL Editor (https://smrzynvsfhoyojombmiq.supabase.co → SQL Editor)

CREATE TABLE IF NOT EXISTS activations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT NOT NULL,
  product TEXT,
  email TEXT,
  plan TEXT,
  term TEXT,
  code_type TEXT,
  activation_type TEXT,
  status TEXT DEFAULT 'success',
  ip TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE activations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public read' AND tablename = 'activations') THEN
    CREATE POLICY "Public read" ON activations FOR SELECT USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service insert' AND tablename = 'activations') THEN
    CREATE POLICY "Service insert" ON activations FOR INSERT WITH CHECK (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_activations_code ON activations(code);
CREATE INDEX IF NOT EXISTS idx_activations_created ON activations(created_at DESC);

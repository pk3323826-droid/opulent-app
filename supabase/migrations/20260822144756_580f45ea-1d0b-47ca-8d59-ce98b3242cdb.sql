CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT ON public.profiles TO anon;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_public_read" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "profiles_self_insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_self_update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE TABLE public.tours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Untitled Tour',
  description TEXT,
  cover_url TEXT,
  status TEXT NOT NULL DEFAULT 'processing',
  is_public BOOLEAN NOT NULL DEFAULT true,
  share_slug TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(8), 'hex'),
  video_duration NUMERIC,
  video_size BIGINT,
  quality_report JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tours TO authenticated;
GRANT SELECT ON public.tours TO anon;
GRANT ALL ON public.tours TO service_role;
ALTER TABLE public.tours ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tours_public_read" ON public.tours FOR SELECT USING (is_public OR auth.uid() = user_id);
CREATE POLICY "tours_owner_insert" ON public.tours FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "tours_owner_update" ON public.tours FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "tours_owner_delete" ON public.tours FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.tour_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tour_id UUID NOT NULL REFERENCES public.tours(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Room',
  panorama_url TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  coverage_degrees NUMERIC,
  frame_count INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX tour_rooms_tour_id_idx ON public.tour_rooms(tour_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tour_rooms TO authenticated;
GRANT SELECT ON public.tour_rooms TO anon;
GRANT ALL ON public.tour_rooms TO service_role;
ALTER TABLE public.tour_rooms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rooms_read" ON public.tour_rooms FOR SELECT USING (EXISTS (SELECT 1 FROM public.tours t WHERE t.id = tour_id AND (t.is_public OR t.user_id = auth.uid())));
CREATE POLICY "rooms_owner_write" ON public.tour_rooms FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.tours t WHERE t.id = tour_id AND t.user_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM public.tours t WHERE t.id = tour_id AND t.user_id = auth.uid()));

CREATE TABLE public.hotspots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.tour_rooms(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Hotspot',
  description TEXT,
  kind TEXT NOT NULL DEFAULT 'info',
  yaw NUMERIC NOT NULL DEFAULT 0,
  pitch NUMERIC NOT NULL DEFAULT 0,
  link_url TEXT,
  target_room_id UUID REFERENCES public.tour_rooms(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX hotspots_room_id_idx ON public.hotspots(room_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hotspots TO authenticated;
GRANT SELECT ON public.hotspots TO anon;
GRANT ALL ON public.hotspots TO service_role;
ALTER TABLE public.hotspots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hotspots_read" ON public.hotspots FOR SELECT USING (EXISTS (SELECT 1 FROM public.tour_rooms r JOIN public.tours t ON t.id = r.tour_id WHERE r.id = room_id AND (t.is_public OR t.user_id = auth.uid())));
CREATE POLICY "hotspots_owner_write" ON public.hotspots FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.tour_rooms r JOIN public.tours t ON t.id = r.tour_id WHERE r.id = room_id AND t.user_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM public.tour_rooms r JOIN public.tours t ON t.id = r.tour_id WHERE r.id = room_id AND t.user_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER tours_updated_at BEFORE UPDATE ON public.tours FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
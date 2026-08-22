import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const searchSchema = z.object({ mode: z.enum(["login", "signup"]).optional() });

export const Route = createFileRoute("/auth")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Sign in — RoomVerse AI" },
      {
        name: "description",
        content: "Sign in to RoomVerse AI to create, manage and share your 360° virtual room tours.",
      },
      { property: "og:title", content: "Sign in — RoomVerse AI" },
      {
        property: "og:description",
        content: "Access your RoomVerse studio and immersive 360° tours.",
      },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { mode } = Route.useSearch();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [isSignup, setIsSignup] = useState(mode === "signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) navigate({ to: "/dashboard" });
  }, [user, navigate]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      if (isSignup) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { display_name: name },
          },
        });
        if (error) throw error;
        toast.success("Account created. You're signed in.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Welcome back.");
      }
      navigate({ to: "/dashboard" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      toast.error("Google sign-in failed. Try email instead.");
      return;
    }
    if (result.redirected) return;
    navigate({ to: "/dashboard" });
  };

  return (
    <main className="mx-auto flex w-full max-w-md flex-col justify-center px-5 py-16">
      <p className="eyebrow text-center">RoomVerse Studio</p>
      <h1 className="mt-3 text-center text-4xl">{isSignup ? "Create your account" : "Welcome back"}</h1>
      <p className="mt-2 text-center text-sm text-muted-foreground">
        {isSignup ? "Start turning room videos into VR tours." : "Sign in to your tours and studio."}
      </p>

      <div className="mt-8 glass-panel rounded-2xl p-6">
        <Button variant="glass" className="w-full" onClick={google}>
          Continue with Google
        </Button>
        <div className="my-5 flex items-center gap-3">
          <span className="hairline flex-1" />
          <span className="text-[10px] tracking-[0.2em] text-muted-foreground">OR</span>
          <span className="hairline flex-1" />
        </div>

        <form onSubmit={submit} className="space-y-4">
          {isSignup && (
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ava Sterling" />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@studio.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          <Button type="submit" variant="gold" size="lg" className="w-full" disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isSignup ? "Create account" : "Sign in"}
          </Button>
        </form>

        <button
          type="button"
          className="mt-5 w-full text-center text-xs text-muted-foreground transition-colors hover:text-primary"
          onClick={() => setIsSignup((s) => !s)}
        >
          {isSignup ? "Already have an account? Sign in" : "New here? Create an account"}
        </button>
      </div>

      <Link to="/" className="mt-6 text-center text-xs text-muted-foreground hover:text-foreground">
        Back to home
      </Link>
    </main>
  );
}

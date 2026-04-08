import { useEffect, useRef } from "react";
import { Switch, Route, Redirect, Router as WouterRouter, useLocation } from "wouter";
import { ClerkProvider, SignIn, SignUp, Show, useClerk, useAuth } from "@clerk/react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import axios from "axios";

// Pages
import { Landing } from "./pages/Landing";
import { Dashboard } from "./pages/Dashboard";
import { Performance } from "./pages/Performance";
import { History } from "./pages/History";
import { Privacy } from "./pages/Privacy";
import { Terms } from "./pages/Terms";
import { ParlayGenerator } from "./pages/ParlayGenerator";
import { Tracker } from "./pages/Tracker";
import { Subscribe } from "./pages/Subscribe";
import { Account } from "./pages/Account";
import NotFound from "@/pages/not-found";

axios.defaults.baseURL = `${import.meta.env.BASE_URL.replace(/\/+$/, '')}/api`;
axios.defaults.withCredentials = true;

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

if (!clerkPubKey) throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || "/" : path;
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

function ClerkAxiosInterceptor() {
  const { getToken } = useAuth();
  useEffect(() => {
    const id = axios.interceptors.request.use(async (config) => {
      const token = await getToken();
      if (token) {
        config.headers = config.headers ?? {};
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });
    return () => axios.interceptors.request.eject(id);
  }, [getToken]);
  return null;
}

function ClerkQueryCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const unsub = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) qc.clear();
      prevUserIdRef.current = userId;
    });
    return unsub;
  }, [addListener, qc]);
  return null;
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in"><Redirect to="/picks" /></Show>
      <Show when="signed-out"><Landing /></Show>
    </>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Show when="signed-in">{children}</Show>
      <Show when="signed-out"><Redirect to="/sign-in" /></Show>
    </>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={HomeRedirect} />
      <Route path="/sign-in/*?" component={() => (
        <div className="min-h-screen bg-[#060D1F] flex items-center justify-center">
          <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} afterSignInUrl={`${basePath}/picks`} />
        </div>
      )} />
      <Route path="/sign-up/*?" component={() => (
        <div className="min-h-screen bg-[#060D1F] flex items-center justify-center">
          <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} afterSignUpUrl={`${basePath}/picks`} />
        </div>
      )} />
      <Route path="/picks" component={() => <ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/performance" component={Performance} />
      <Route path="/history" component={History} />
      <Route path="/parlay" component={() => <ProtectedRoute><ParlayGenerator /></ProtectedRoute>} />
      <Route path="/tracker" component={() => <ProtectedRoute><Tracker /></ProtectedRoute>} />
      <Route path="/subscribe" component={Subscribe} />
      <Route path="/account" component={() => <ProtectedRoute><Account /></ProtectedRoute>} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/terms" component={Terms} />
      <Route component={NotFound} />
    </Switch>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl || undefined}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkAxiosInterceptor />
        <ClerkQueryCacheInvalidator />
        <TooltipProvider>
          <Router />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;

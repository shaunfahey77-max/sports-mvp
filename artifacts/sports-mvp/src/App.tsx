import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import axios from "axios";

// Pages
import { Landing } from "./pages/Landing";
import { Dashboard } from "./pages/Dashboard";
import { Performance } from "./pages/Performance";
import { History } from "./pages/History";
import { Privacy } from "./pages/Privacy";
import { Terms } from "./pages/Terms";
import { ParlayGenerator } from "./pages/ParlayGenerator";

// Configure axios base URL for generated orval hooks
axios.defaults.baseURL = `${import.meta.env.BASE_URL.replace(/\/+$/, '')}/api`;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    }
  }
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/picks" component={Dashboard} />
      <Route path="/performance" component={Performance} />
      <Route path="/history" component={History} />
      <Route path="/parlay" component={ParlayGenerator} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/terms" component={Terms} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

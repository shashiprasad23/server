import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/600.css";
import "./styles.css";
import Shell from "./components/Shell";
import { ToastProvider } from "./components/ui";
import { SessionProvider } from "./lib/session";
import Login from "./pages/Login";
import MyWork from "./pages/MyWork";
import Projects from "./pages/Projects";
import ProjectPage from "./pages/ProjectPage";
import WorkItemPage from "./pages/WorkItem";
import Timesheet from "./pages/Timesheet";
import Approvals from "./pages/Approvals";
import Resources from "./pages/Resources";
import ServiceDesk from "./pages/ServiceDesk";
import Meetings from "./pages/Meetings";
import MeetingReview from "./pages/MeetingReview";
import Reports from "./pages/Reports";
import Admin from "./pages/Admin";
import SearchPage from "./pages/Search";
import Settings from "./pages/Settings";

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: true, retry: 1 } } });

function App() {
  return (
    <SessionProvider fallback={<Routes><Route path="*" element={<Login />} /></Routes>}>
      <Shell>
        <Routes>
          <Route path="/" element={<MyWork />} />
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:projectId" element={<ProjectPage />} />
          <Route path="/projects/:projectId/:tab" element={<ProjectPage />} />
          <Route path="/work-items/:key" element={<WorkItemPage />} />
          <Route path="/timesheets" element={<Timesheet />} />
          <Route path="/timesheets/approvals" element={<Approvals />} />
          <Route path="/resources" element={<Resources />} />
          <Route path="/service" element={<ServiceDesk />} />
          <Route path="/meetings" element={<Meetings />} />
          <Route path="/meetings/:meetingId" element={<MeetingReview />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<div className="empty">Page not found.</div>} />
        </Routes>
      </Shell>
    </SessionProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);

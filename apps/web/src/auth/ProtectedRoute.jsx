import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useSubscriber } from "./SubscriberContext";

export default function ProtectedRoute({ children }) {
  const location = useLocation();
  const { ready, isAuthenticated, isActiveSubscriber } = useSubscriber();

  if (!ready) {
    return (
      <div style={{ padding: 32, color: "#e2e8f0" }}>
        Loading subscriber session...
      </div>
    );
  }

  if (!isAuthenticated || !isActiveSubscriber) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return children;
}

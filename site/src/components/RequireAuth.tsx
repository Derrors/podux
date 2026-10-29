import { useSyncExternalStore } from "react";
import { Navigate, useLocation } from "react-router-dom";
import pb from "../lib/pocketbase";

interface RequireAuthProps {
  children: React.ReactNode;
}

const subscribe = (onChange: () => void) => pb.authStore.onChange(onChange);
const getIsValid = () => pb.authStore.isValid;

/**
 * Route guard component.
 * Re-renders whenever the PocketBase auth store changes (logout, 401 from the API,
 * login in another tab) and redirects to /login with a `redirect` back param.
 */
export function RequireAuth({ children }: RequireAuthProps) {
  const location = useLocation();
  const isAuthenticated = useSyncExternalStore(subscribe, getIsValid);

  if (!isAuthenticated) {
    const target = `${location.pathname}${location.search}${location.hash}`;
    const params = new URLSearchParams({ redirect: target });
    return <Navigate to={`/login?${params}`} state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { Spinner } from './components/Brand';
import { useEffect } from 'react';
import { createBrowserRouter, Navigate, RouterProvider, useLocation } from 'react-router';
import { api, ApiError, onUnauthorized } from './lib/api';
import { startPwa } from './lib/pwa';
import { keys, useActions, useAppState } from './lib/queries';
import { ToastProvider } from './components/Toast';
import { SheetProvider } from './sheets/Sheets';
import { ApplicationPage } from './routes/ApplicationPage';
import { CallMode } from './routes/CallMode';
import { Layout } from './routes/Layout';
import { Pipeline } from './routes/Pipeline';
import { Reports } from './routes/Reports';
import { Companies, CompanyPage } from './routes/Companies';
import { Files, People } from './routes/Directory';
import { Stories } from './routes/Stories';
import { Questions } from './routes/Questions';
import { Home } from './routes/Home';
import { Login, SetupNeeded } from './routes/Login';
import { Settings } from './routes/Settings';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (n, e) => !(e instanceof ApiError && [401, 403, 404, 503].includes(e.status)) && n < 2,
      refetchOnWindowFocus: true,
    },
  },
});

startPwa();

/** /pipeline was renamed /jobs: old links keep their view choices (?view=…). */
function ToJobs() {
  const { search } = useLocation();
  return <Navigate to={`/jobs${search}`} replace />;
}

const router = createBrowserRouter([
  {
    // Call mode is full-screen: no tabs or sidebar, so it fits beside a video call.
    path: '/a/:id/call',
    element: (
      <SheetProvider>
        <CallMode />
      </SheetProvider>
    ),
  },
  {
    element: (
      <SheetProvider>
        <Layout />
      </SheetProvider>
    ),
    children: [
      { path: '/', element: <Home /> },
      { path: '/today', element: <Navigate to="/" replace /> },
      { path: '/jobs', element: <Pipeline /> },
      // Old links, notifications and push URLs.
      { path: '/pipeline', element: <ToJobs /> },
      { path: '/a/:id', element: <ApplicationPage /> },
      { path: '/companies', element: <Companies /> },
      { path: '/c/:id', element: <CompanyPage /> },
      { path: '/people', element: <People /> },
      { path: '/files', element: <Files /> },
      { path: '/stories', element: <Stories /> },
      { path: '/questions', element: <Questions /> },
      { path: '/reports', element: <Reports /> },
      { path: '/settings', element: <Settings /> },
      { path: '*', element: <Home /> },
    ],
  },
]);

/** Tells the server this device's time zone, so assistants speak in local dates. */
function SyncTimeZone() {
  const { data } = useAppState();
  const { saveSettings } = useActions();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  useEffect(() => {
    if (data && tz && data.settings.time_zone !== tz) void saveSettings({ time_zone: tz });
  }, [data, tz, saveSettings]);
  return null;
}

function Gate() {
  const qc = useQueryClient();
  const session = useQuery({
    queryKey: keys.session,
    queryFn: () => api.get<{ ok: true }>('/session'),
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  useEffect(
    () =>
      onUnauthorized(() => {
        qc.setQueryData(keys.session, null);
        qc.invalidateQueries({ queryKey: keys.session });
      }),
    [qc],
  );
  if (session.isPending)
    return (
      <div className="page-loading full">
        <Spinner size={48} />
      </div>
    );
  const err = session.error;
  if (err instanceof ApiError && err.status === 503) return <SetupNeeded message={err.message} />;
  // Offline before the session could be confirmed: show the app with cached data.
  const offline = err instanceof ApiError && err.status === 0;
  if (!offline && (err || !session.data)) return <Login />;
  return (
    <>
      {!offline && <SyncTimeZone />}
      <RouterProvider router={router} />
    </>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <Gate />
      </ToastProvider>
    </QueryClientProvider>
  );
}

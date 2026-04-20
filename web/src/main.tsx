import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Routes, Route } from "react-router-dom";
import App from "./App";
import "./index.css";

const BrowsePage = lazy(() => import("./pages/BrowsePage"));
const ListingDetailPage = lazy(() => import("./pages/ListingDetailPage"));
const CreatePage = lazy(() => import("./pages/CreatePage"));
const PurchasesPage = lazy(() => import("./pages/PurchasesPage"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage"));

const fallback = (
	<div className="flex items-center justify-center h-32">
		<div className="w-5 h-5 rounded-full border-2 border-polka-500 border-t-transparent animate-spin" />
	</div>
);

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<HashRouter>
			<Routes>
				<Route element={<App />}>
					<Route
						index
						element={
							<Suspense fallback={fallback}>
								<BrowsePage />
							</Suspense>
						}
					/>
					<Route
						path="listing/:id"
						element={
							<Suspense fallback={fallback}>
								<ListingDetailPage />
							</Suspense>
						}
					/>
					<Route
						path="upload"
						element={
							<Suspense fallback={fallback}>
								<CreatePage />
							</Suspense>
						}
					/>
					<Route
						path="purchases"
						element={
							<Suspense fallback={fallback}>
								<PurchasesPage />
							</Suspense>
						}
					/>
					<Route
						path="*"
						element={
							<Suspense fallback={fallback}>
								<NotFoundPage />
							</Suspense>
						}
					/>
				</Route>
			</Routes>
		</HashRouter>
	</StrictMode>,
);
